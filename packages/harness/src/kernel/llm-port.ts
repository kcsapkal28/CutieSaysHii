import { z } from "zod";
import type { JsonSchema } from "../wire/schema.ts";
import type { TokenUsage } from "./contracts.ts";
import { hashOf } from "./hash.ts";

export const TOOL_NAMES = ["emit_deck", "emit_design", "emit_patches"] as const;
export const ToolNameSchema = z.enum(TOOL_NAMES);
export type ToolName = z.infer<typeof ToolNameSchema>;

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export const EffortSchema = z.enum(EFFORTS);
export type Effort = z.infer<typeof EffortSchema>;

export type ToolSpec = {
  name: ToolName;
  description: string;
  /** The compileWireSchema JSON Schema, sent as input_schema whether or not the tool is strict. */
  inputSchema: JsonSchema;
  /** Per tool: strict grammar-constrained decoding (emit_design) or schema-guided only (emit_deck, emit_patches). */
  strict: boolean;
};

export type UserBlock =
  | { type: "text"; text: string }
  | { type: "tool_result"; toolUseId: string; content: string; isError: boolean };

/** The provider's assistant content, replayed verbatim on the next attempt. */
export type AssistantTurn = { role: "assistant"; content: unknown[] };

export type LlmMessage = { role: "user"; content: UserBlock[] } | AssistantTurn;

/** One tool, offered with tool_choice auto; no sampling parameters are ever sent. */
export type LlmRequest = {
  model: string;
  system: string;
  messages: LlmMessage[];
  tool: ToolSpec;
  effort: Effort;
  maxTokens: number;
};

export const STOP_REASONS = [
  "end_turn",
  "max_tokens",
  "stop_sequence",
  "tool_use",
  "pause_turn",
  "refusal",
  "model_context_window_exceeded",
] as const;
export const StopReasonSchema = z.enum(STOP_REASONS);
export type StopReason = z.infer<typeof StopReasonSchema>;

export type ToolCall = { id: string; name: string; input: unknown };

export type LlmCompletion = {
  /** The first tool_use block, if any. */
  toolCall: ToolCall | null;
  /** The id of every tool_use block in the turn, in order; each needs a tool_result in the next user turn. */
  toolUseIds: string[];
  /** All text blocks joined. */
  text: string;
  stopReason: StopReason;
  refusalCategory: string | null;
  usage: TokenUsage;
  turn: AssistantTurn;
};

/** Reported before each adapter-level wait; the adapter then sleeps `waitMs` on the clock. */
export type LlmRetryInfo = {
  reason: "rate-limit" | "transient";
  status?: number;
  /** 1-based number of the retry about to happen. */
  attempt: number;
  maxAttempts: number;
  waitMs: number;
  detail: string;
};

export type LlmCallOptions = {
  signal: AbortSignal;
  onRetry?: (info: LlmRetryInfo) => void;
};

export interface LlmPort {
  preflight(signal: AbortSignal): Promise<void>;
  complete(req: LlmRequest, opts: LlmCallOptions): Promise<LlmCompletion>;
}

export const RequestFingerprintSchema = z.object({
  model: z.string(),
  systemHash: z.string(),
  toolSchemaHash: z.string(),
  effort: EffortSchema,
  maxTokens: z.number().int(),
  firstUserHash: z.string(),
});
export type RequestFingerprint = z.infer<typeof RequestFingerprintSchema>;

/** Identifies a request by everything that shapes the first reply; later (feedback) turns are ignored. */
export function requestFingerprint(req: LlmRequest): RequestFingerprint {
  const firstUser = req.messages.find((m) => m.role === "user");
  return {
    model: req.model,
    systemHash: hashOf(req.system),
    toolSchemaHash: hashOf(req.tool),
    effort: req.effort,
    maxTokens: req.maxTokens,
    firstUserHash: hashOf(firstUser?.content ?? null),
  };
}
