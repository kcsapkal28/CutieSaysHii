import { describe, expect, it } from "vitest";
import {
  CancelledError,
  InternalError,
  LlmConfigError,
  LlmQuotaError,
  LlmRefusalError,
  LlmUnreachableError,
} from "../../src/kernel/errors.ts";
import {
  requestFingerprint,
  type LlmCallOptions,
  type LlmRequest,
  type LlmRetryInfo,
  type ToolName,
} from "../../src/kernel/llm-port.ts";
import { CassetteSchema, FakeLlm } from "../../src/fakes/llm.ts";

const RERECORD = "re-record with: pnpm --filter @deckforge/harness record:golden";

function request(tool: ToolName, system = "You write decks.", firstUser = "<input>\n{}\n</input>"): LlmRequest {
  return {
    model: "claude-sonnet-5-5",
    system,
    tool: { name: tool, description: `Emit via ${tool}.`, inputSchema: { type: "object" }, strict: tool === "emit_design" },
    effort: "medium",
    maxTokens: 16_000,
    messages: [{ role: "user", content: [{ type: "text", text: firstUser }] }],
  };
}

const opts = (extra: Partial<LlmCallOptions> = {}): LlmCallOptions => ({ signal: new AbortController().signal, ...extra });

describe("FakeLlm", () => {
  it("replays per tool in order and records calls", async () => {
    const fake = new FakeLlm({
      replies: {
        emit_deck: [
          { kind: "tool", input: { title: "one" } },
          { kind: "tool", input: { title: "two" }, usage: { inputTokens: 7, outputTokens: 3, cacheReadTokens: 2, cacheWriteTokens: 1 } },
        ],
        emit_design: [{ kind: "tool", input: { slides: [] } }],
      },
    });
    expect(fake.remaining()).toBe(3);

    const design = await fake.complete(request("emit_design"), opts());
    const deck1 = await fake.complete(request("emit_deck"), opts());
    const deck2 = await fake.complete(request("emit_deck"), opts());

    expect(design.toolCall).toMatchObject({ name: "emit_design", input: { slides: [] } });
    expect(deck1.toolCall).toMatchObject({ name: "emit_deck", input: { title: "one" } });
    expect(deck1).toMatchObject({
      text: "",
      stopReason: "tool_use",
      refusalCategory: null,
      usage: { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 },
    });
    expect(deck1.turn).toEqual({ role: "assistant", content: [{ type: "tool_use", ...deck1.toolCall }] });
    expect(deck1.toolUseIds).toEqual([deck1.toolCall?.id]);
    expect(deck2.toolCall?.input).toEqual({ title: "two" });
    expect(deck2.usage).toEqual({ inputTokens: 7, outputTokens: 3, cacheReadTokens: 2, cacheWriteTokens: 1 });
    expect(new Set([design, deck1, deck2].map((c) => c.toolCall?.id)).size).toBe(3);

    expect(fake.calls.map((c) => c.tool.name)).toEqual(["emit_design", "emit_deck", "emit_deck"]);
    expect(fake.remaining()).toBe(0);

    fake.push("emit_patches", { kind: "tool", input: { patches: [] } });
    expect(fake.remaining()).toBe(1);
    expect(fake.remaining("emit_deck")).toBe(0);
    expect((await fake.complete(request("emit_patches"), opts())).toolCall?.input).toEqual({ patches: [] });
  });

  it("snapshots each request's messages so later appends don't rewrite history", async () => {
    const fake = new FakeLlm({ replies: { emit_deck: [{ kind: "text", text: "no tool" }] } });
    const req = request("emit_deck");
    await fake.complete(req, opts());
    req.messages.push({ role: "assistant", content: [] });
    expect(fake.calls[0]!.messages).toHaveLength(1);
  });

  it("exhausted script message", async () => {
    const fake = new FakeLlm({ replies: { emit_deck: [{ kind: "tool", input: {} }] }, source: "unit" });
    await fake.complete(request("emit_deck"), opts());
    const err = await fake.complete(request("emit_deck"), opts()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InternalError);
    expect((err as Error).message).toBe("fake LLM script unit has no reply for emit_deck #2");

    const cassette = FakeLlm.fromCassette({ version: 1, replies: {} }, "golden/1.cassette.json");
    await expect(cassette.complete(request("emit_design"), opts())).rejects.toThrow(
      `cassette golden/1.cassette.json has no reply for emit_design #1 — ${RERECORD}`,
    );
  });

  it("expect mismatch → stale message naming toolSchemaHash", async () => {
    const recorded = request("emit_deck");
    const changed = { ...recorded, tool: { ...recorded.tool, strict: true } };
    const fake = FakeLlm.fromCassette(
      { version: 1, replies: { emit_deck: [{ kind: "tool", input: {}, expect: requestFingerprint(recorded) }] } },
      "golden/3.cassette.json",
    );
    await expect(fake.complete(changed, opts())).rejects.toThrow(
      `cassette golden/3.cassette.json is stale at emit_deck #1: toolSchemaHash differs — ${RERECORD}`,
    );

    const prompt = FakeLlm.fromCassette(
      { version: 1, replies: { emit_deck: [{ kind: "tool", input: {}, expect: requestFingerprint(recorded) }] } },
      "c.json",
    );
    await expect(prompt.complete(request("emit_deck", "Edited prompt."), opts())).rejects.toThrow(
      `cassette c.json is stale at emit_deck #1: systemHash differs — ${RERECORD}`,
    );
  });

  it("stale message shows cassette vs request values for model, effort and maxTokens", async () => {
    const recorded = request("emit_deck");
    const cassette = () =>
      FakeLlm.fromCassette({ version: 1, replies: { emit_deck: [{ kind: "hang", expect: requestFingerprint(recorded) }] } }, "c.json");
    await expect(cassette().complete({ ...recorded, model: "claude-haiku-5-5" }, opts())).rejects.toThrow(
      `cassette c.json is stale at emit_deck #1: model differs (cassette claude-sonnet-5-5, request claude-haiku-5-5) — ${RERECORD}`,
    );
    await expect(cassette().complete({ ...recorded, effort: "low" }, opts())).rejects.toThrow(
      "effort differs (cassette medium, request low)",
    );
    await expect(cassette().complete({ ...recorded, maxTokens: 8_000 }, opts())).rejects.toThrow(
      "maxTokens differs (cassette 16000, request 8000)",
    );
  });

  it("matching expect replays, also on later feedback turns", async () => {
    const req = request("emit_deck");
    const fake = new FakeLlm({
      replies: {
        emit_deck: [
          { kind: "text", text: "thinking", expect: requestFingerprint(req) },
          { kind: "tool", input: { ok: true }, expect: requestFingerprint(req) },
        ],
      },
    });
    expect((await fake.complete(req, opts())).text).toBe("thinking");
    const feedback: LlmRequest = {
      ...req,
      messages: [...req.messages, { role: "assistant", content: [] }, { role: "user", content: [{ type: "text", text: "Call the tool." }] }],
    };
    expect((await fake.complete(feedback, opts())).toolCall?.input).toEqual({ ok: true });
  });

  it("rateLimitFirst calls onRetry", async () => {
    const retries: LlmRetryInfo[] = [];
    const fake = new FakeLlm({ replies: { emit_design: [{ kind: "tool", input: {}, rateLimitFirst: { waitMs: 1500 } }] } });
    const c = await fake.complete(request("emit_design"), opts({ onRetry: (info) => retries.push(info) }));
    expect(c.toolCall).not.toBeNull();
    expect(retries).toEqual([
      { reason: "rate-limit", status: 429, attempt: 1, maxAttempts: 4, waitMs: 1500, detail: expect.any(String) },
    ]);
  });

  it("error reply kind", async () => {
    const fake = new FakeLlm({
      replies: {
        emit_deck: [
          { kind: "error", error: { kind: "llm_quota", message: "Extra usage is required" } },
          { kind: "error", error: { kind: "llm_unreachable", message: new LlmUnreachableError("http://x").message } },
        ],
      },
    });
    const quota = await fake.complete(request("emit_deck"), opts()).catch((e: unknown) => e);
    expect(quota).toBeInstanceOf(LlmQuotaError);
    expect((quota as Error).message).toBe("Extra usage is required");
    const unreachable = await fake.complete(request("emit_deck"), opts()).catch((e: unknown) => e);
    expect(unreachable).toBeInstanceOf(LlmUnreachableError);
    expect((unreachable as LlmUnreachableError).baseUrl).toBe("http://x");
  });

  it("refusal", async () => {
    const fake = new FakeLlm({ replies: { emit_deck: [{ kind: "refusal", category: "cyber" }, { kind: "refusal" }] } });
    const first = await fake.complete(request("emit_deck"), opts());
    expect(first).toMatchObject({ toolCall: null, stopReason: "refusal", refusalCategory: "cyber" });
    expect((await fake.complete(request("emit_deck"), opts())).refusalCategory).toBeNull();
  });

  it("a truncated tool reply keeps max_tokens and its partial tool_use block", async () => {
    const fake = new FakeLlm({ replies: { emit_deck: [{ kind: "tool", input: { title: "Sol" }, stopReason: "max_tokens" }] } });
    const cut = await fake.complete(request("emit_deck"), opts());
    expect(cut.stopReason).toBe("max_tokens");
    expect(cut.toolCall).toMatchObject({ name: "emit_deck", input: { title: "Sol" } });
    expect(cut.turn.content).toEqual([{ type: "tool_use", ...cut.toolCall }]);
  });

  it("text reply keeps its stop reason", async () => {
    const fake = new FakeLlm({ replies: { emit_deck: [{ kind: "text", text: "cut", stopReason: "max_tokens" }, { kind: "text", text: "hi" }] } });
    const cut = await fake.complete(request("emit_deck"), opts());
    expect(cut).toMatchObject({ toolCall: null, text: "cut", stopReason: "max_tokens" });
    expect(cut.turn.content).toEqual([{ type: "text", text: "cut" }]);
    expect((await fake.complete(request("emit_deck"), opts())).stopReason).toBe("end_turn");
  });

  it("text and refusal replies serve their usage, defaulting otherwise", async () => {
    const usage = { inputTokens: 9, outputTokens: 8, cacheReadTokens: 7, cacheWriteTokens: 6 };
    const fake = new FakeLlm({
      replies: { emit_deck: [{ kind: "text", text: "t", usage }, { kind: "refusal", usage }, { kind: "refusal" }] },
    });
    expect((await fake.complete(request("emit_deck"), opts())).usage).toEqual(usage);
    expect((await fake.complete(request("emit_deck"), opts())).usage).toEqual(usage);
    expect((await fake.complete(request("emit_deck"), opts())).usage).toEqual({
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
  });

  it("serves a copy of the scripted input", async () => {
    const input = { title: "one", tags: ["a"] };
    const fake = new FakeLlm({ replies: { emit_deck: [{ kind: "tool", input }] } });
    const c = await fake.complete(request("emit_deck"), opts());
    (c.toolCall!.input as { tags: string[] }).tags.push("mutated");
    expect(input.tags).toEqual(["a"]);
    expect(c.toolCall!.input).not.toBe(input);
  });

  it("hang + abort → CancelledError", async () => {
    const fake = new FakeLlm({ replies: { emit_deck: [{ kind: "hang" }, { kind: "hang" }] } });
    const controller = new AbortController();
    const pending = fake.complete(request("emit_deck"), { signal: controller.signal });
    controller.abort();
    const err = await pending.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CancelledError);

    const owner = new AbortController();
    const lost = fake.complete(request("emit_deck"), { signal: owner.signal });
    owner.abort(CancelledError.ownershipLost());
    await expect(lost).rejects.toThrow("ownership lost");
    expect(fake.remaining()).toBe(0);
  });

  it("an already-aborted call is cancelled without consuming a reply", async () => {
    const fake = new FakeLlm({ replies: { emit_deck: [{ kind: "tool", input: {} }] } });
    const controller = new AbortController();
    controller.abort();
    await expect(fake.complete(request("emit_deck"), { signal: controller.signal })).rejects.toBeInstanceOf(CancelledError);
    expect(fake.remaining()).toBe(1);
  });

  it("preflightError", async () => {
    const signal = new AbortController().signal;
    await expect(new FakeLlm().preflight(signal)).resolves.toBeUndefined();
    const info = new FakeLlm({ preflightError: { kind: "llm_config", message: "lacks controls" } });
    await expect(info.preflight(signal)).rejects.toBeInstanceOf(LlmConfigError);
    const thrown = new LlmUnreachableError("http://127.0.0.1:9");
    await expect(new FakeLlm({ preflightError: thrown }).preflight(signal)).rejects.toBe(thrown);
    const aborted = new AbortController();
    aborted.abort();
    await expect(new FakeLlm().preflight(aborted.signal)).rejects.toBeInstanceOf(CancelledError);
  });

  it("an llm_refusal error reply rebuilds a typed LlmRefusalError via errorFromInfo", async () => {
    const fake = new FakeLlm({ replies: { emit_deck: [{ kind: "error", error: { kind: "llm_refusal", message: "the model refused the request (bio)" } }] } });
    const err = await fake.complete(request("emit_deck"), opts()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmRefusalError);
    expect((err as LlmRefusalError).category).toBe("bio");
  });
});

describe("CassetteSchema", () => {
  const expectFp = requestFingerprint(request("emit_deck"));

  it("CassetteSchema rejects a reply without expect", () => {
    expect(CassetteSchema.safeParse({ version: 1, replies: { emit_deck: [{ kind: "tool", input: {} }] } }).success).toBe(false);
    expect(CassetteSchema.safeParse({ version: 1, replies: { emit_deck: [{ kind: "tool", input: {}, expect: expectFp }] } }).success).toBe(true);
  });

  it("rejects other versions, unknown tools and unknown reply fields", () => {
    const reply = { kind: "hang", expect: expectFp };
    expect(CassetteSchema.safeParse({ version: 2, replies: {} }).success).toBe(false);
    expect(CassetteSchema.safeParse({ version: 1, replies: { emit_html: [reply] } }).success).toBe(false);
    expect(CassetteSchema.safeParse({ version: 1, replies: { emit_deck: [{ ...reply, extra: 1 }] } }).success).toBe(false);
  });

  it("fromCassette rejects an invalid cassette naming its source", () => {
    expect(() => FakeLlm.fromCassette({ version: 1, replies: { emit_deck: [{ kind: "hang" }] } }, "bad.json")).toThrow(
      /^cassette bad\.json is invalid:\n- replies\.emit_deck\[0\]\.expect: Required/,
    );
  });
});
