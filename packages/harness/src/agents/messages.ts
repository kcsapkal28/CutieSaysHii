import { formatIssues, type Issue } from "../kernel/issues.ts";
import {
  requestFingerprint,
  type Effort,
  type LlmCompletion,
  type LlmMessage,
  type LlmRequest,
  type RequestFingerprint,
  type StopReason,
  type ToolName,
  type ToolSpec,
} from "../kernel/llm-port.ts";
import { groupNotesLength } from "../validate/deck.ts";

/** A versioned system prompt; `name` is its file stem, e.g. "content.v1". */
export type AgentPrompt = { name: string; text: string };

/** Everything that shapes an agent's first request; `normalize` is the tool's compiled wire normaliser. */
export type AgentRequest = {
  model: string;
  effort: Effort;
  maxTokens: number;
  system: string;
  input: unknown;
  tool: ToolSpec;
  normalize(raw: unknown): unknown;
};

export function renderInput(payload: unknown): string {
  return `<input>\n${JSON.stringify(payload, null, 2)}\n</input>`;
}

export function firstUserMessage(r: AgentRequest): LlmMessage {
  return { role: "user", content: [{ type: "text", text: renderInput(r.input) }] };
}

export function toLlmRequest(r: AgentRequest, messages: LlmMessage[]): LlmRequest {
  return { model: r.model, system: r.system, messages, tool: r.tool, effort: r.effort, maxTokens: r.maxTokens };
}

export function requestFingerprintOf(r: AgentRequest): RequestFingerprint {
  return requestFingerprint(toLlmRequest(r, [firstUserMessage(r)]));
}

export const noToolCallFeedback = (tool: ToolName): string => `Call the ${tool} tool exactly once with the complete result.`;

/** Stop reasons that end a reply early; any tool call in it is incomplete and never parsed. */
export const TRUNCATING_STOPS: readonly StopReason[] = ["max_tokens", "model_context_window_exceeded", "pause_turn"];

export function truncatedIssue(tool: ToolName, stop: StopReason, maxTokens: number): Issue {
  const where = stop === "max_tokens" ? `cut off at max_tokens (${maxTokens})` : `stopped early (${stop})`;
  return { path: "", code: "truncated", message: `the reply was ${where} before the ${tool} call was complete` };
}

export function truncatedFeedback(tool: ToolName, stop: StopReason, maxTokens: number): string {
  const where = stop === "max_tokens" ? `was cut off at the ${maxTokens}-token output limit` : `stopped early (${stop})`;
  return (
    `Your reply ${where} before the ${tool} call was complete. ` +
    `Call the ${tool} tool again exactly once with the complete result, written more concisely so it fits.`
  );
}

/** Enough to cover a deck's worth of issues in one round; notes-length issues are folded into one line. */
export const FEEDBACK_MAX_ISSUES = 60;

export const invalidFeedback = (tool: ToolName, issues: readonly Issue[]): string =>
  `The ${tool} call failed validation. Fix every issue below, keep everything else, and call ${tool} again exactly once with the complete corrected result.\n` +
  formatIssues(groupNotesLength(issues), FEEDBACK_MAX_ISSUES);

const IGNORED_CALL = "Ignored: only the first call in a turn is used.";

/**
 * The user turn answering `c`. When the turn holds tool_use blocks, every id gets an is_error
 * tool_result (the API rejects a missing one): the first carries `text`, the rest a short note.
 */
export function feedbackMessage(c: LlmCompletion, text: string): LlmMessage {
  if (c.toolUseIds.length === 0) return { role: "user", content: [{ type: "text", text }] };
  const first = c.toolCall?.id ?? c.toolUseIds[0];
  return {
    role: "user",
    content: c.toolUseIds.map((id) => ({ type: "tool_result", toolUseId: id, isError: true, content: id === first ? text : IGNORED_CALL })),
  };
}
