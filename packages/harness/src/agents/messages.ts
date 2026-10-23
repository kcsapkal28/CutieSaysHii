import { formatIssues, type Issue } from "../kernel/issues.ts";
import {
  requestFingerprint,
  type Effort,
  type LlmCompletion,
  type LlmMessage,
  type LlmRequest,
  type RequestFingerprint,
  type ToolName,
  type ToolSpec,
} from "../kernel/llm-port.ts";

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

export const truncatedFeedback = (tool: ToolName, maxTokens: number): string =>
  `Your reply was cut off at the ${maxTokens}-token output limit before the ${tool} call was complete. ` +
  `Call the ${tool} tool again exactly once with the complete result, written more concisely so it fits.`;

export const invalidFeedback = (tool: ToolName, issues: readonly Issue[]): string =>
  `The ${tool} call failed validation. Fix every issue below, keep everything else, and call ${tool} again exactly once with the complete corrected result.\n${formatIssues(issues)}`;

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
