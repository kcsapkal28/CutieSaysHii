import { z } from "zod";
import { TokenUsageSchema, type TokenUsage } from "../kernel/contracts.ts";
import {
  CancelledError,
  errorFromInfo,
  ErrorInfoSchema,
  HarnessError,
  InputError,
  InternalError,
  type ErrorInfo,
} from "../kernel/errors.ts";
import { formatIssues, zodToIssues } from "../kernel/issues.ts";
import {
  RequestFingerprintSchema,
  requestFingerprint,
  StopReasonSchema,
  ToolNameSchema,
  type LlmCallOptions,
  type LlmCompletion,
  type LlmPort,
  type LlmRequest,
  type RequestFingerprint,
  type ToolName,
} from "../kernel/llm-port.ts";

export const RERECORD_HINT = "re-record with: pnpm --filter @deckforge/harness record:golden";
export const FAKE_DEFAULT_USAGE: Readonly<TokenUsage> = Object.freeze({
  inputTokens: 1000,
  outputTokens: 500,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
});
/** Mirrors the Anthropic adapter's default retry count, so retry events read "1/4". */
const FAKE_MAX_RETRIES = 4;

function replySchema<E extends z.ZodTypeAny>(expect: E) {
  return z.discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("tool"),
        input: z.unknown(),
        /** "max_tokens" replays a truncated tool call; the default is "tool_use". */
        stopReason: StopReasonSchema.optional(),
        usage: TokenUsageSchema.optional(),
        rateLimitFirst: z.object({ waitMs: z.number().int().min(0) }).strict().optional(),
        expect,
      })
      .strict(),
    z
      .object({
        kind: z.literal("text"),
        text: z.string(),
        stopReason: StopReasonSchema.optional(),
        usage: TokenUsageSchema.optional(),
        expect,
      })
      .strict(),
    z
      .object({ kind: z.literal("refusal"), category: z.string().optional(), usage: TokenUsageSchema.optional(), expect })
      .strict(),
    z.object({ kind: z.literal("error"), error: ErrorInfoSchema, expect }).strict(),
    z.object({ kind: z.literal("hang"), expect }).strict(),
  ]);
}

export const FakeReplySchema = replySchema(RequestFingerprintSchema.optional());
export type FakeReply = z.infer<typeof FakeReplySchema>;

/** Recorded replies always carry the fingerprint of the request that produced them. */
export const CassetteReplySchema = replySchema(RequestFingerprintSchema);
export type CassetteReply = z.infer<typeof CassetteReplySchema>;

export const CassetteSchema = z
  .object({ version: z.literal(1), replies: z.record(ToolNameSchema, z.array(CassetteReplySchema)) })
  .strict();
export type Cassette = z.infer<typeof CassetteSchema>;

export type FakeScript = Partial<Record<ToolName, FakeReply[]>>;

export type FakeLlmOptions = {
  replies?: FakeScript;
  preflightError?: HarnessError | ErrorInfo;
  /** Names the script in error messages, e.g. the cassette path. */
  source?: string;
};

const FINGERPRINT_FIELDS = Object.keys(RequestFingerprintSchema.shape) as (keyof RequestFingerprint)[];

function cancelled(signal: AbortSignal): CancelledError {
  return signal.reason instanceof CancelledError ? signal.reason : new CancelledError("cancelled", { cause: signal.reason });
}

function hangUntilAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(cancelled(signal)), { once: true });
  });
}

/** A scripted LlmPort: replies are consumed per tool, in order. */
export class FakeLlm implements LlmPort {
  readonly calls: LlmRequest[] = [];
  readonly #script = new Map<ToolName, FakeReply[]>();
  readonly #served = new Map<ToolName, number>();
  readonly #preflightError: HarnessError | ErrorInfo | undefined;
  readonly #source: string;
  #fromCassette = false;
  #nextId = 1;

  constructor(options: FakeLlmOptions = {}) {
    this.#preflightError = options.preflightError;
    this.#source = options.source ?? "inline";
    for (const [tool, replies] of Object.entries(options.replies ?? {}) as [ToolName, FakeReply[]][]) {
      this.push(tool, ...replies);
    }
  }

  /** Validates `cassette` (parsed JSON) and replays it, checking every reply's fingerprint. */
  static fromCassette(cassette: unknown, source: string): FakeLlm {
    const parsed = CassetteSchema.safeParse(cassette);
    if (!parsed.success) throw new InputError(`cassette ${source} is invalid:\n${formatIssues(zodToIssues(parsed.error))}`);
    const fake = new FakeLlm({ replies: parsed.data.replies, source });
    fake.#fromCassette = true;
    return fake;
  }

  push(tool: ToolName, ...replies: FakeReply[]): void {
    const queue = this.#script.get(tool) ?? [];
    queue.push(...replies);
    this.#script.set(tool, queue);
  }

  remaining(tool?: ToolName): number {
    if (tool) return this.#script.get(tool)?.length ?? 0;
    return [...this.#script.values()].reduce((n, queue) => n + queue.length, 0);
  }

  preflight(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(cancelled(signal));
    const e = this.#preflightError;
    if (e === undefined) return Promise.resolve();
    return Promise.reject(e instanceof HarnessError ? e : errorFromInfo(e));
  }

  async complete(req: LlmRequest, { signal, onRetry }: LlmCallOptions): Promise<LlmCompletion> {
    if (signal.aborted) throw cancelled(signal);
    const tool = req.tool.name;
    const n = (this.#served.get(tool) ?? 0) + 1;
    const queue = this.#script.get(tool) ?? [];
    const reply = queue[0];
    if (!reply) throw new InternalError(this.#describe(`has no reply for ${tool} #${n}`));
    if (reply.expect) this.#checkFingerprint(reply.expect, req, tool, n);

    queue.shift();
    this.#served.set(tool, n);
    this.calls.push({ ...req, messages: [...req.messages] });

    switch (reply.kind) {
      case "tool": {
        if (reply.rateLimitFirst) {
          const { waitMs } = reply.rateLimitFirst;
          onRetry?.({ reason: "rate-limit", status: 429, attempt: 1, maxAttempts: FAKE_MAX_RETRIES, waitMs, detail: "429 rate limited (scripted)" });
          if (signal.aborted) throw cancelled(signal);
        }
        const toolCall = { id: `toolu_fake_${this.#nextId++}`, name: tool, input: structuredClone(reply.input) };
        return {
          toolCall,
          text: "",
          stopReason: reply.stopReason ?? "tool_use",
          refusalCategory: null,
          usage: { ...(reply.usage ?? FAKE_DEFAULT_USAGE) },
          turn: { role: "assistant", content: [{ type: "tool_use", ...toolCall }] },
        };
      }
      case "text":
        return {
          toolCall: null,
          text: reply.text,
          stopReason: reply.stopReason ?? "end_turn",
          refusalCategory: null,
          usage: { ...(reply.usage ?? FAKE_DEFAULT_USAGE) },
          turn: { role: "assistant", content: [{ type: "text", text: reply.text }] },
        };
      case "refusal":
        return {
          toolCall: null,
          text: "",
          stopReason: "refusal",
          refusalCategory: reply.category ?? null,
          usage: { ...(reply.usage ?? FAKE_DEFAULT_USAGE) },
          turn: { role: "assistant", content: [] },
        };
      case "error":
        throw errorFromInfo(reply.error);
      case "hang":
        return hangUntilAborted(signal);
    }
  }

  #checkFingerprint(expected: RequestFingerprint, req: LlmRequest, tool: ToolName, n: number): void {
    const actual = requestFingerprint(req);
    const field = FINGERPRINT_FIELDS.find((f) => actual[f] !== expected[f]);
    if (!field) return;
    const values = field.endsWith("Hash") ? "" : ` (cassette ${expected[field]}, request ${actual[field]})`;
    throw new InternalError(`cassette ${this.#source} is stale at ${tool} #${n}: ${field} differs${values} — ${RERECORD_HINT}`);
  }

  #describe(problem: string): string {
    return this.#fromCassette ? `cassette ${this.#source} ${problem} — ${RERECORD_HINT}` : `fake LLM script ${this.#source} ${problem}`;
  }
}
