// The one LLM client every agent goes through: tool-forced structured output (Zod-validated) and plain text,
// via the local claude-openai proxy (Anthropic Messages passthrough). Ported and simplified from feat/harness.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic, { APIConnectionError, APIConnectionTimeoutError, APIError, APIUserAbortError } from "@anthropic-ai/sdk";
import type { z } from "zod";
import { toJsonSchema } from "./agents/json-schema.ts";

export const MODELS = { opus: "claude-opus-5-5", sonnet: "claude-sonnet-5-5" } as const;
export const DEFAULT_BASE_URL = "http://localhost:4001";
const DEFAULT_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_MAX_RETRIES = 4;
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 20_000;

export type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number };
export const ZERO_USAGE: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
export function addUsage(a: Usage, b: Usage): Usage {
  return { input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite };
}

export type ImageData = { data: Buffer; mediaType: "image/png" | "image/jpeg" };
/** A user-turn content part: text, or an image (critic screenshots). */
export type Part = { type: "text"; text: string } | ({ type: "image" } & ImageData);

type CallBase = {
  /** Who is calling (e.g. "storyboarder", "builder:s03"): shows up in usage records and errors. */
  label: string;
  model: string;
  system: string;
  user: string | Part[];
  maxTokens?: number;
  temperature?: number;
  /** "off": no thinking before the answer (fast, cheap code generation). Default: the model's own adaptive thinking. */
  thinking?: "off";
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type ToolCallOpts<S extends z.ZodTypeAny> = CallBase & {
  tool: { name: string; description: string; schema: S };
  /** Corrective retries after invalid output, each with the error fed back (default 1). */
  validationRetries?: number;
};

export type CallRecord = { label: string; model: string; ms: number; usage: Usage; attempts: number };
export type ToolResult<T> = CallRecord & { data: T };
export type TextResult = CallRecord & { text: string };

export interface Llm {
  callTool<S extends z.ZodTypeAny>(opts: ToolCallOpts<S>): Promise<ToolResult<z.infer<S>>>;
  callText(opts: CallBase): Promise<TextResult>;
}

// ---- transport: the only part that touches the network (tests swap it) ----

export type WireContent =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: ImageData["mediaType"]; data: string } }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };
export type WireMessage = { role: "user" | "assistant"; content: WireContent[] };
export type WireRequest = {
  model: string;
  max_tokens: number;
  system: string;
  messages: WireMessage[];
  temperature?: number;
  tools?: { name: string; description: string; input_schema: Record<string, unknown> }[];
  tool_choice?: { type: "auto" };
  /** These models reject {type:"disabled"}; "between_tools" means no thinking before answering. */
  thinking?: { type: "between_tools" };
  /** Automatic prompt caching (the builder and critic resend long system prompts per slide). */
  cache_control?: { type: "ephemeral" };
};
export type WireResponse = {
  content: WireContent[];
  stop_reason: string | null;
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };
};
export type Transport = (req: WireRequest, opts: { signal: AbortSignal }) => Promise<WireResponse>;

export class LlmError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LlmError";
  }
}

// ---- env ----

/** Finds the nearest `.env` walking up from `start` (worktrees resolve to the main checkout's file). */
export function findDotEnv(start: string): string | undefined {
  for (let dir = start; ; dir = dirname(dir)) {
    const file = join(dir, ".env");
    if (existsSync(file)) return file;
    if (dirname(dir) === dir) return undefined;
  }
}

function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trimStart().startsWith("#")) continue;
    out[m[1]!] = m[2]!.replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

export type LlmEnv = { baseUrl: string; apiKey: string };

/** `LLM_BASE_URL` / `LLM_API_KEY` from the process env, else the nearest `.env`. Never logs the key. */
export function loadLlmEnv(env: NodeJS.ProcessEnv = process.env, start = dirname(fileURLToPath(import.meta.url))): LlmEnv {
  const file = findDotEnv(start);
  const fromFile = file ? parseDotEnv(readFileSync(file, "utf8")) : {};
  const baseUrl = (env.LLM_BASE_URL || fromFile.LLM_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const apiKey = env.LLM_API_KEY || fromFile.LLM_API_KEY || "";
  if (!apiKey) throw new LlmError("LLM_API_KEY is not set (process env or repo-root .env)");
  return { baseUrl, apiKey };
}

// ---- real transport ----

export function sdkTransport({ baseUrl, apiKey }: LlmEnv): Transport {
  // SDK 1.x sends the key as `Authorization: Bearer`, which the proxy expects; retries are ours, so the SDK's are off.
  // The SDK's own timeout is a backstop; each call's timeoutMs (an abort signal) is what governs.
  const client = new Anthropic({ baseURL: baseUrl, apiKey, maxRetries: 0, timeout: 30 * 60_000 });
  return async (req, { signal }) => {
    // Streaming avoids the SDK's non-streaming guard on large max_tokens (builder output).
    const stream = client.messages.stream(req as Anthropic.MessageStreamParams, { signal });
    return (await stream.finalMessage()) as unknown as WireResponse;
  };
}

// ---- client ----

export type LlmOptions = {
  transport: Transport;
  baseUrl?: string;
  maxRetries?: number;
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
  onCall?: (rec: CallRecord) => void;
};

export function createLlm(o: LlmOptions): Llm {
  const maxRetries = o.maxRetries ?? DEFAULT_MAX_RETRIES;
  const sleep = o.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const baseUrl = o.baseUrl ?? DEFAULT_BASE_URL;

  /** One request with transport-level retries (429/529/overloaded/5xx) and a per-attempt timeout. */
  async function send(req: WireRequest, c: CallBase): Promise<{ res: WireResponse; attempts: number }> {
    let timeouts = 0;
    for (let attempt = 1; ; attempt++) {
      const timeout = AbortSignal.timeout(c.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      const signal = c.signal ? AbortSignal.any([c.signal, timeout]) : timeout;
      try {
        return { res: await o.transport(req, { signal }), attempts: attempt };
      } catch (e) {
        if (c.signal?.aborted) throw new LlmError(`${c.label}: cancelled`, { cause: e });
        if (isConnectionRefused(e)) throw new LlmError(`proxy not running on ${baseUrl}`, { cause: e });
        const timedOut = timeout.aborted || e instanceof APIConnectionTimeoutError;
        if (timedOut) timeouts++;
        // A hung call is retried once: a second timeout means the proxy or upstream is stuck, so fail fast.
        const retryable = timedOut ? timeouts < 2 : isRetryable(e);
        if (!retryable || attempt > maxRetries) {
          const why = timedOut ? `timed out after ${c.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms` : describe(e);
          throw new LlmError(`${c.label} (${c.model}): ${why}${attempt > 1 ? ` after ${attempt} attempts` : ""}`, { cause: e });
        }
        await sleep(retryWaitMs(e, attempt));
      }
    }
  }

  function userContent(user: string | Part[]): WireContent[] {
    if (typeof user === "string") return [{ type: "text", text: user }];
    return user.map((p) =>
      p.type === "text" ? p : { type: "image", source: { type: "base64", media_type: p.mediaType, data: p.data.toString("base64") } },
    );
  }

  return {
    async callTool(c) {
      const started = Date.now();
      const tool = { name: c.tool.name, description: c.tool.description, input_schema: toJsonSchema(c.tool.schema) };
      const messages: WireMessage[] = [{ role: "user", content: userContent(c.user) }];
      let usage = ZERO_USAGE;
      let attempts = 0;
      // Retries (one by default) with the validation error fed back as a tool_result.
      const rounds = 1 + (c.validationRetries ?? 1);
      for (let round = 1; round <= rounds; round++) {
        const req: WireRequest = {
          model: c.model,
          max_tokens: c.maxTokens ?? 8000,
          // These models reject forced tool_choice ("tool"/"any"), so the tool is required by instruction and enforced here.
          system: `${c.system}\n\nRespond only by calling the \`${c.tool.name}\` tool, exactly once, with no other text.`,
          messages,
          tools: [tool],
          tool_choice: { type: "auto" },
          cache_control: { type: "ephemeral" },
          ...(c.temperature === undefined ? {} : { temperature: c.temperature }),
          ...(c.thinking === "off" ? { thinking: { type: "between_tools" as const } } : {}),
        };
        const { res, attempts: a } = await send(req, c);
        attempts += a;
        usage = addUsage(usage, toUsage(res));
        const call = res.content.find((b): b is Extract<WireContent, { type: "tool_use" }> => b.type === "tool_use");
        const problem = !call
          ? `no ${c.tool.name} tool call in the response (stop_reason ${res.stop_reason})`
          : res.stop_reason === "max_tokens"
            ? `output was cut off at max_tokens (${req.max_tokens}); be more concise`
            : undefined;
        const parsed = call && !problem ? c.tool.schema.safeParse(call.input) : undefined;
        if (parsed?.success) {
          const rec = { label: c.label, model: c.model, ms: Date.now() - started, usage, attempts };
          o.onCall?.(rec);
          return { ...rec, data: parsed.data };
        }
        const why = problem ?? formatZodError(parsed!.error);
        if (round === rounds) {
          o.onCall?.({ label: c.label, model: c.model, ms: Date.now() - started, usage, attempts });
          throw new LlmError(`${c.label}: invalid ${c.tool.name} output after ${rounds - 1 === 1 ? "a retry" : `${rounds - 1} retries`}: ${why}`);
        }
        if (call) {
          messages.push({ role: "assistant", content: [call] });
          messages.push({
            role: "user",
            content: [{ type: "tool_result", tool_use_id: call.id, is_error: true, content: `Invalid input, call ${c.tool.name} again with every problem fixed:\n${why}` }],
          });
        } else {
          messages.push({ role: "user", content: [{ type: "text", text: `Your reply was unusable: ${why}. Call the ${c.tool.name} tool.` }] });
        }
      }
      throw new LlmError("unreachable");
    },

    async callText(c) {
      const started = Date.now();
      const req: WireRequest = {
        model: c.model,
        max_tokens: c.maxTokens ?? 8000,
        system: c.system,
        messages: [{ role: "user", content: userContent(c.user) }],
        cache_control: { type: "ephemeral" },
        ...(c.temperature === undefined ? {} : { temperature: c.temperature }),
        ...(c.thinking === "off" ? { thinking: { type: "between_tools" as const } } : {}),
      };
      const { res, attempts } = await send(req, c);
      const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      const rec = { label: c.label, model: c.model, ms: Date.now() - started, usage: toUsage(res), attempts };
      o.onCall?.(rec);
      return { ...rec, text };
    },
  };
}

/** The real client: env from process/.env, SDK transport through the proxy. */
export function createProxyLlm(opts: Omit<LlmOptions, "transport" | "baseUrl"> & { env?: LlmEnv } = {}): Llm {
  const env = opts.env ?? loadLlmEnv();
  return createLlm({ ...opts, transport: sdkTransport(env), baseUrl: env.baseUrl });
}

function toUsage(res: WireResponse): Usage {
  return {
    input: res.usage.input_tokens,
    output: res.usage.output_tokens,
    cacheRead: res.usage.cache_read_input_tokens ?? 0,
    cacheWrite: res.usage.cache_creation_input_tokens ?? 0,
  };
}

export function formatZodError(err: z.ZodError): string {
  return err.issues
    .slice(0, 20)
    .map((i) => `- ${i.path.length ? i.path.join(".") : "(root)"}: ${i.message}`)
    .join("\n");
}

/** Connection errors are APIErrors with no status, so they are matched first; the OS code sits two levels down. */
export function isConnectionRefused(e: unknown): boolean {
  const code = (e as { cause?: { cause?: { code?: unknown } } } | undefined)?.cause?.cause?.code;
  return e instanceof APIConnectionError ? code === "ECONNREFUSED" : (e as { code?: unknown })?.code === "ECONNREFUSED";
}

function statusOf(e: unknown): number | undefined {
  if (e instanceof APIConnectionError) return undefined;
  if (e instanceof APIError) return e.status;
  const s = (e as { status?: unknown } | undefined)?.status;
  return typeof s === "number" ? s : undefined;
}

function isRetryable(e: unknown): boolean {
  if (e instanceof APIUserAbortError) return false;
  if (e instanceof APIConnectionError) return true; // reset/timeout mid-flight; refused is handled before this
  const s = statusOf(e);
  if (s === 429 || s === 529 || s === 408 || s === 409 || (s !== undefined && s >= 500)) return true;
  return /overloaded/i.test(describe(e));
}

function retryWaitMs(e: unknown, attempt: number): number {
  const headers = (e as { headers?: Headers } | undefined)?.headers;
  const after = Number(headers?.get?.("retry-after"));
  if (Number.isFinite(after) && after > 0) return Math.min(60_000, after * 1000);
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (attempt - 1)) * (0.75 + Math.random() * 0.5);
}

function describe(e: unknown): string {
  if (e instanceof APIError) {
    const body = e.error as { error?: { message?: unknown }; message?: unknown } | undefined;
    const msg = body?.error?.message ?? body?.message;
    return `${e.status ?? "connection"} ${typeof msg === "string" ? msg : e.message}`;
  }
  return e instanceof Error ? e.message : String(e);
}

/** Repo root (the dir holding pnpm-workspace.yaml), for projects/ and fixtures. */
export function repoRoot(start = dirname(fileURLToPath(import.meta.url))): string {
  for (let dir = start; ; dir = dirname(dir)) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    if (dirname(dir) === dir) throw new Error(`no pnpm-workspace.yaml above ${start}`);
  }
}
