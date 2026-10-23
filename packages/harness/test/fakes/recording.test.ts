import { describe, expect, it } from "vitest";
import { LlmQuotaError } from "../../src/kernel/errors.ts";
import { requestFingerprint, type LlmRequest, type LlmRetryInfo, type ToolName } from "../../src/kernel/llm-port.ts";
import { CassetteSchema, FakeLlm } from "../../src/fakes/llm.ts";
import { RecordingLlm } from "../../src/fakes/recording.ts";

function request(tool: ToolName, firstUser: string): LlmRequest {
  return {
    model: "claude-sonnet-5-5",
    system: "System.",
    tool: { name: tool, description: tool, inputSchema: { type: "object" }, strict: false },
    effort: "low",
    maxTokens: 8_000,
    messages: [{ role: "user", content: [{ type: "text", text: firstUser }] }],
  };
}

const signal = new AbortController().signal;
const usage = { inputTokens: 11, outputTokens: 22, cacheReadTokens: 33, cacheWriteTokens: 44 };

describe("RecordingLlm", () => {
  it("recording round-trip incl. expect", async () => {
    const live = new FakeLlm({
      replies: {
        emit_deck: [
          { kind: "text", text: "Let me think.", stopReason: "end_turn" },
          { kind: "tool", input: { title: "Solar" }, usage },
        ],
        emit_design: [
          { kind: "refusal", category: "cyber" },
          { kind: "error", error: { kind: "llm_quota", message: "credit balance is too low" } },
        ],
      },
    });
    const recorder = new RecordingLlm(live);
    const deckReq = request("emit_deck", "deck");
    const designReq = request("emit_design", "design");

    await recorder.preflight(signal);
    const first = await recorder.complete(deckReq, { signal });
    const second = await recorder.complete(deckReq, { signal });
    const refusal = await recorder.complete(designReq, { signal });
    await expect(recorder.complete(designReq, { signal })).rejects.toBeInstanceOf(LlmQuotaError);

    const cassette = CassetteSchema.parse(JSON.parse(JSON.stringify(recorder.toCassette())));
    expect(cassette).toEqual({
      version: 1,
      replies: {
        emit_deck: [
          { kind: "text", text: "Let me think.", stopReason: "end_turn", expect: requestFingerprint(deckReq) },
          { kind: "tool", input: { title: "Solar" }, usage, expect: requestFingerprint(deckReq) },
        ],
        emit_design: [
          { kind: "refusal", category: "cyber", expect: requestFingerprint(designReq) },
          { kind: "error", error: { kind: "llm_quota", message: "credit balance is too low" }, expect: requestFingerprint(designReq) },
        ],
      },
    });

    const replay = FakeLlm.fromCassette(cassette, "round-trip");
    expect(await replay.complete(deckReq, { signal })).toMatchObject({ text: first.text, stopReason: first.stopReason, toolCall: null });
    const replayedTool = await replay.complete(deckReq, { signal });
    expect(replayedTool.toolCall?.input).toEqual(second.toolCall?.input);
    expect(replayedTool.usage).toEqual(second.usage);
    expect(await replay.complete(designReq, { signal })).toMatchObject({ stopReason: "refusal", refusalCategory: refusal.refusalCategory });
    await expect(replay.complete(designReq, { signal })).rejects.toBeInstanceOf(LlmQuotaError);
    expect(replay.remaining()).toBe(0);
  });

  it("passes call options through and delegates preflight errors", async () => {
    const retries: LlmRetryInfo[] = [];
    const inner = new FakeLlm({
      replies: { emit_deck: [{ kind: "tool", input: {}, rateLimitFirst: { waitMs: 5 } }] },
      preflightError: { kind: "llm_auth", message: "LLM_API_KEY rejected" },
    });
    const recorder = new RecordingLlm(inner);
    await expect(recorder.preflight(signal)).rejects.toThrow("LLM_API_KEY rejected");
    await recorder.complete(request("emit_deck", "x"), { signal, onRetry: (i) => retries.push(i) });
    expect(retries).toHaveLength(1);
    expect(recorder.toCassette().replies.emit_deck).toEqual([
      { kind: "tool", input: {}, usage: { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 }, expect: requestFingerprint(request("emit_deck", "x")) },
    ]);
  });

  it("toCassette returns a snapshot", async () => {
    const recorder = new RecordingLlm(new FakeLlm({ replies: { emit_deck: [{ kind: "text", text: "a" }, { kind: "text", text: "b" }] } }));
    await recorder.complete(request("emit_deck", "x"), { signal });
    const before = recorder.toCassette();
    await recorder.complete(request("emit_deck", "x"), { signal });
    expect(before.replies.emit_deck).toHaveLength(1);
    expect(recorder.toCassette().replies.emit_deck).toHaveLength(2);
  });
});
