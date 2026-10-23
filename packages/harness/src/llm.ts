import Anthropic, { APIConnectionError, APIError, APIUserAbortError } from "@anthropic-ai/sdk";
import { ANTHROPIC_ORIGIN, type LlmEnv } from "./env.ts";
import type { TokenUsage } from "./kernel/contracts.ts";
import {
  CancelledError,
  InternalError,
  LlmAuthError,
  LlmBadRequestError,
  LlmConfigError,
  LlmQuotaError,
  LlmTransientError,
  LlmUnreachableError,
  toHarnessError,
  type HarnessError,
} from "./kernel/errors.ts";
import {
  StopReasonSchema,
  type LlmCallOptions,
  type LlmCompletion,
  type LlmMessage,
  type LlmPort,
  type LlmRequest,
  type LlmRetryInfo,
  type UserBlock,
} from "./kernel/llm-port.ts";
import type { Clock, Logger } from "./kernel/ports.ts";

// The only module that imports @anthropic-ai/sdk (architecture test). Only src/node.ts calls createLlmClient.

/** 429 bodies that mean the account is out of entitlement: retrying can't help. */
export const QUOTA_PATTERNS = ["Extra usage is required", "credit balance is too low", "credit balance too low"] as const;
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";
export const DEFAULT_LLM_MAX_RETRIES = 4;
export const PREFLIGHT_TIMEOUT_MS = 5_000;
const BACKOFF_BASE_MS = 500;
const BACKOFF_MAX_MS = 8_000;

const PROXY_CONTROLS_WARNING = "LLM_PROXY_CONTROLS=0: proxy-side retries are hidden from the harness";

/** One client per process; the adapter owns retries, so the SDK's and (via the header) the proxy's are off. */
export function createLlmClient(llm: Pick<LlmEnv, "baseUrl" | "apiKey" | "proxyControls">): Anthropic {
  return new Anthropic({
    baseURL: llm.baseUrl,
    apiKey: llm.apiKey,
    maxRetries: 0,
    ...(llm.proxyControls ? { defaultHeaders: { "x-proxy-max-retries": "0" } } : {}),
  });
}

export type AnthropicLlmOptions = {
  baseUrl: string;
  clock: Clock;
  logger: Logger;
  proxyControls: boolean;
  /** Retries after the first request for rate-limit and transient failures. */
  maxRetries?: number;
  /** Models sent through the server-side refusal fallback beta. */
  fallbackModels?: readonly string[];
};

type Retryable = { reason: LlmRetryInfo["reason"]; status: number | undefined; detail: string; headers: Headers | undefined; error: unknown };

export function createAnthropicLlm(client: Anthropic, o: AnthropicLlmOptions): LlmPort {
  const maxRetries = o.maxRetries ?? DEFAULT_LLM_MAX_RETRIES;
  const fallbackModels = new Set(o.fallbackModels ?? []);

  /** Maps a failed call; returns only what may be retried and throws everything else. */
  function classify(e: unknown, signal: AbortSignal): Retryable {
    if (signal.aborted || e instanceof APIUserAbortError) throw cancelled(signal, e);
    // Connection errors are APIErrors with no status, so they are matched first (spike S8).
    if (e instanceof APIConnectionError) {
      return { reason: "transient", status: undefined, detail: connectionDetail(e), headers: undefined, error: e };
    }
    if (!(e instanceof APIError) || e.status === undefined) throw toHarnessError(e);

    const { status } = e;
    const detail = `${status} ${apiMessage(e)}`;
    if (status === 401 || status === 403) throw authError(o.baseUrl, status, e);
    if (status === 429 && isQuota(e)) {
      throw new LlmQuotaError(`LLM account out of quota at ${o.baseUrl} (429): ${apiMessage(e)}`, { status, cause: e });
    }
    if (status === 429 || status === 529) return { reason: "rate-limit", status, detail, headers: e.headers, error: e };
    if (status === 408 || status === 409 || status >= 500) return { reason: "transient", status, detail, headers: e.headers, error: e };
    throw new LlmBadRequestError(`LLM request rejected by ${o.baseUrl} (${status}): ${apiMessage(e)}`, { status, cause: e });
  }

  async function send(req: LlmRequest, signal: AbortSignal) {
    const params = {
      model: req.model,
      max_tokens: req.maxTokens,
      system: req.system,
      messages: req.messages.map(toMessageParam),
      tools: [
        {
          name: req.tool.name,
          description: req.tool.description,
          input_schema: req.tool.inputSchema as Anthropic.Tool.InputSchema,
          strict: req.tool.strict,
        },
      ],
      tool_choice: { type: "auto" as const },
      output_config: { effort: req.effort },
      cache_control: { type: "ephemeral" as const },
    } satisfies Anthropic.MessageCreateParamsNonStreaming;

    if (!fallbackModels.has(req.model)) return client.messages.create(params, { signal });
    return client.beta.messages.create(
      { ...(params as Anthropic.Beta.MessageCreateParamsNonStreaming), betas: [FALLBACK_BETA], fallbacks: "default" },
      { signal },
    );
  }

  return {
    async preflight(signal) {
      let response: Response;
      try {
        ({ response } = await client.models
          .list({ limit: 1 }, { signal, timeout: PREFLIGHT_TIMEOUT_MS, maxRetries: 0 })
          .withResponse());
      } catch (e) {
        if (signal.aborted || e instanceof APIUserAbortError) throw cancelled(signal, e);
        if (e instanceof APIConnectionError) throw new LlmUnreachableError(o.baseUrl, { cause: e });
        if (!(e instanceof APIError) || e.status === undefined) throw toHarnessError(e);
        const { status } = e;
        if (status === 401 || status === 403) throw authError(o.baseUrl, status, e);
        const detail = `GET /v1/models returned ${status} ${apiMessage(e)}`;
        if (status === 408 || status === 429 || status >= 500) {
          throw new LlmTransientError(`LLM preflight against ${o.baseUrl} failed: ${detail}`, { status, cause: e });
        }
        // E.g. a 404 from something that isn't an Anthropic Messages endpoint (the proxy's OpenAI port 4000).
        throw new LlmConfigError(`LLM endpoint at ${o.baseUrl} failed preflight: ${detail}`, { status, cause: e });
      }
      if (o.proxyControls && response.headers.get("x-proxy-controls") !== "1") {
        throw new LlmConfigError(
          `LLM proxy at ${o.baseUrl} lacks passthrough controls (x-proxy-controls header missing) — update and restart it: cd ~/Documents/Cursor-Projects/claude-openai && git pull && bash stop.sh && bash start.sh`,
        );
      }
      if (!o.proxyControls && new URL(o.baseUrl).origin !== ANTHROPIC_ORIGIN) o.logger.warn(PROXY_CONTROLS_WARNING);
    },

    async complete(req: LlmRequest, { signal, onRetry }: LlmCallOptions): Promise<LlmCompletion> {
      for (let retry = 1; ; retry++) {
        let failure: Retryable;
        try {
          return toCompletion(await send(req, signal));
        } catch (e) {
          failure = classify(e, signal);
        }
        if (retry > maxRetries) throw exhausted(failure, retry, o.baseUrl);

        const waitMs = retryWaitMs(failure.headers, retry, o.clock.now());
        onRetry?.({ reason: failure.reason, status: failure.status, attempt: retry, maxAttempts: maxRetries, waitMs, detail: failure.detail });
        try {
          await o.clock.sleep(waitMs, signal);
        } catch (e) {
          throw cancelled(signal, e);
        }
      }
    },
  };
}

function toMessageParam(m: LlmMessage): Anthropic.MessageParam {
  // The provider's own content blocks, replayed verbatim.
  if (m.role === "assistant") return { role: "assistant", content: m.content as Anthropic.ContentBlockParam[] };
  return { role: "user", content: m.content.map(toUserBlockParam) };
}

function toUserBlockParam(b: UserBlock): Anthropic.ContentBlockParam {
  return b.type === "text"
    ? { type: "text", text: b.text }
    : { type: "tool_result", tool_use_id: b.toolUseId, content: b.content, is_error: b.isError };
}

type ProviderMessage = {
  content: unknown[];
  stop_reason: string | null;
  stop_details?: { category?: string | null } | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  };
};

function toCompletion(msg: ProviderMessage): LlmCompletion {
  const stop = StopReasonSchema.safeParse(msg.stop_reason);
  if (!stop.success) throw new InternalError(`unexpected stop_reason from the LLM: ${JSON.stringify(msg.stop_reason)}`);

  const blocks = msg.content as Array<{ type: string; id?: string; name?: string; input?: unknown; text?: string }>;
  const tool = blocks.find((b) => b.type === "tool_use");
  const usage: TokenUsage = {
    inputTokens: msg.usage.input_tokens,
    outputTokens: msg.usage.output_tokens,
    cacheReadTokens: msg.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: msg.usage.cache_creation_input_tokens ?? 0,
  };
  return {
    toolCall: tool ? { id: tool.id ?? "", name: tool.name ?? "", input: tool.input } : null,
    toolUseIds: blocks.flatMap((b) => (b.type === "tool_use" ? [b.id ?? ""] : [])),
    text: blocks.flatMap((b) => (b.type === "text" && typeof b.text === "string" ? [b.text] : [])).join(""),
    stopReason: stop.data,
    refusalCategory: msg.stop_details?.category ?? null,
    usage,
    turn: { role: "assistant", content: msg.content },
  };
}

/** `retry-after-ms`, then `retry-after` (seconds or an HTTP date), then capped exponential backoff. */
function retryWaitMs(headers: Headers | undefined, retry: number, now: number): number {
  const ms = Number(headers?.get("retry-after-ms") ?? NaN);
  if (Number.isFinite(ms) && ms >= 0) return Math.round(ms);

  const after = headers?.get("retry-after");
  if (after) {
    const seconds = Number(after);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
    const at = Date.parse(after);
    if (Number.isFinite(at)) return Math.max(0, at - now);
  }
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (retry - 1));
}

function exhausted(f: Retryable, attempts: number, baseUrl: string): HarnessError {
  if (isConnectionRefused(f.error)) return new LlmUnreachableError(baseUrl, { cause: f.error });
  return new LlmTransientError(`LLM call failed after ${attempts} attempts: ${f.detail}`, { status: f.status, cause: f.error });
}

/** An abort keeps a CancelledError reason (e.g. "ownership lost"); the executor tells timeouts apart by its own signals. */
function cancelled(signal: AbortSignal, cause: unknown): CancelledError {
  return signal.reason instanceof CancelledError ? signal.reason : new CancelledError("cancelled", { cause });
}

function authError(baseUrl: string, status: number, cause: unknown): LlmAuthError {
  return new LlmAuthError(`LLM_API_KEY rejected by ${baseUrl} (${status})`, { status, cause });
}

/** The OS error sits two levels down: APIConnectionError → TypeError "fetch failed" → Error{code} (spike S8b). */
function isConnectionRefused(e: unknown): boolean {
  return e instanceof APIConnectionError && (e.cause as { cause?: { code?: unknown } } | undefined)?.cause?.code === "ECONNREFUSED";
}

function connectionDetail(e: APIConnectionError): string {
  const code = (e.cause as { cause?: { code?: unknown } } | undefined)?.cause?.code;
  return typeof code === "string" ? `${e.message} (${code})` : e.message;
}

/** Upstream bodies are {type, error:{type, message}}; proxy-local ones are {error:{message, …}} (spike S9d). */
function apiMessage(e: APIError): string {
  const body = e.error as { error?: { message?: unknown }; message?: unknown } | undefined;
  const message = body?.error?.message ?? body?.message;
  return typeof message === "string" ? message : e.message;
}

function isQuota(e: APIError): boolean {
  const text = `${apiMessage(e)} ${JSON.stringify(e.error ?? null)}`;
  return QUOTA_PATTERNS.some((p) => text.includes(p));
}
