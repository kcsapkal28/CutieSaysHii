import { errorInfo } from "../kernel/errors.ts";
import {
  requestFingerprint,
  type LlmCallOptions,
  type LlmCompletion,
  type LlmPort,
  type LlmRequest,
  type RequestFingerprint,
  type ToolName,
} from "../kernel/llm-port.ts";
import type { Cassette, CassetteReply } from "./llm.ts";

/** Checks refusal before the tool call, in invokeTool's order. */
function toReply(c: LlmCompletion, expect: RequestFingerprint): CassetteReply {
  const usage = { ...c.usage };
  if (c.stopReason === "refusal") {
    return c.refusalCategory === null
      ? { kind: "refusal", usage, expect }
      : { kind: "refusal", category: c.refusalCategory, usage, expect };
  }
  if (c.toolCall) {
    const input = structuredClone(c.toolCall.input);
    return c.stopReason === "tool_use"
      ? { kind: "tool", input, usage, expect }
      : { kind: "tool", input, stopReason: c.stopReason, usage, expect };
  }
  return { kind: "text", text: c.text, stopReason: c.stopReason, usage, expect };
}

/** Wraps a live LlmPort and records every reply, fingerprinted, for replay by FakeLlm.fromCassette. */
export class RecordingLlm implements LlmPort {
  readonly #inner: LlmPort;
  readonly #replies = new Map<ToolName, CassetteReply[]>();

  constructor(inner: LlmPort) {
    this.#inner = inner;
  }

  preflight(signal: AbortSignal): Promise<void> {
    return this.#inner.preflight(signal);
  }

  async complete(req: LlmRequest, opts: LlmCallOptions): Promise<LlmCompletion> {
    const expect = requestFingerprint(req);
    try {
      const completion = await this.#inner.complete(req, opts);
      this.#record(req.tool.name, toReply(completion, expect));
      return completion;
    } catch (e) {
      this.#record(req.tool.name, { kind: "error", error: errorInfo(e), expect });
      throw e;
    }
  }

  toCassette(): Cassette {
    const replies: Cassette["replies"] = {};
    for (const [tool, list] of this.#replies) replies[tool] = [...list];
    return { version: 1, replies };
  }

  #record(tool: ToolName, reply: CassetteReply): void {
    const list = this.#replies.get(tool) ?? [];
    list.push(reply);
    this.#replies.set(tool, list);
  }
}
