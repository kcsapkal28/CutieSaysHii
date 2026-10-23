import { describe, expect, it } from "vitest";
import { invokeTool, type ParseResult } from "../../src/agents/invoke-tool.ts";
import { renderInput, type AgentRequest } from "../../src/agents/messages.ts";
import { FakeLlm, type FakeReply } from "../../src/fakes/llm.ts";
import { BudgetError, CancelledError, LlmRefusalError, ValidationError } from "../../src/kernel/errors.ts";
import type { StageEvent, StageEventOf } from "../../src/kernel/events.ts";
import { formatIssues, type Issue } from "../../src/kernel/issues.ts";
import type { LlmCompletion, LlmPort, LlmRequest } from "../../src/kernel/llm-port.ts";
import { makeTestContext, type TestContextOptions } from "../helpers/context.ts";

const NOT_OK: Issue = { path: "ok", code: "not-ok", message: "ok must be true" };

const request: AgentRequest = {
  model: "claude-sonnet-5-5",
  effort: "medium",
  maxTokens: 16000,
  system: "Call emit_deck.",
  input: { topic: "solar" },
  tool: {
    name: "emit_deck",
    description: "Emit it.",
    inputSchema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false },
    strict: false,
  },
  normalize: (raw) => raw,
};

const parsed: string[] = [];
const parse = (input: unknown): ParseResult<{ ok: true }> => {
  parsed.push(JSON.stringify(input));
  return (input as { ok?: unknown }).ok === true ? { ok: true, value: { ok: true } } : { ok: false, issues: [NOT_OK] };
};

const valid: FakeReply = { kind: "tool", input: { ok: true } };
const invalid: FakeReply = { kind: "tool", input: { ok: false } };

async function setup(replies: FakeReply[], o: TestContextOptions = {}) {
  const fake = new FakeLlm({ replies: { emit_deck: replies } });
  const t = await makeTestContext({ llm: fake, ...o });
  return { fake, ...t };
}

const retries = (events: StageEvent[]) => events.filter((e): e is StageEventOf<"stage:retry"> => e.type === "stage:retry");

describe("invokeTool", () => {
  it("valid first reply", async () => {
    const { fake, ctx, attempts, meter } = await setup([valid]);
    await expect(invokeTool(ctx, request, parse)).resolves.toEqual({ ok: true });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toEqual({
      model: "claude-sonnet-5-5",
      system: "Call emit_deck.",
      tool: request.tool,
      effort: "medium",
      maxTokens: 16000,
      messages: [{ role: "user", content: [{ type: "text", text: renderInput({ topic: "solar" }) }] }],
    });
    expect(attempts).toEqual([
      { n: 1, outcome: "ok", usage: expect.any(Object), usageKnown: true, durationMs: expect.any(Number) },
    ]);
    expect(meter.total).toBe(1500);
  });

  it("renderInput wraps pretty JSON in input tags", () => {
    expect(renderInput({ a: [1] })).toBe('<input>\n{\n  "a": [\n    1\n  ]\n}\n</input>');
  });

  it("issues fed back as is_error tool_result; retry event validation 1/3", async () => {
    const { fake, ctx, events, attempts } = await setup([invalid, valid]);
    await invokeTool(ctx, request, parse);

    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[0]!.messages).toHaveLength(1);
    const [first, turn, feedback] = fake.calls[1]!.messages;
    expect(first).toEqual(fake.calls[0]!.messages[0]);
    expect(turn).toEqual({ role: "assistant", content: [{ type: "tool_use", id: "toolu_fake_1", name: "emit_deck", input: { ok: false } }] });
    expect(feedback).toEqual({
      role: "user",
      content: [{ type: "tool_result", toolUseId: "toolu_fake_1", isError: true, content: expect.stringContaining(formatIssues([NOT_OK])) }],
    });
    expect(retries(events)).toEqual([
      expect.objectContaining({ reason: "validation", attempt: 1, maxAttempts: 3, waitMs: 0, detail: expect.stringContaining("ok must be true") }),
    ]);
    expect(attempts.map((a) => a.outcome)).toEqual(["invalid", "ok"]);
    expect(attempts[0]!.issues).toEqual([NOT_OK]);
  });

  it("ValidationError after 3 invalid replies", async () => {
    const { fake, ctx, events, attempts } = await setup([invalid, invalid, invalid]);
    const error = await invokeTool(ctx, request, parse).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect(error).toMatchObject({ issues: [NOT_OK], attempts: 3 });
    expect(fake.calls).toHaveLength(3);
    expect(fake.calls[2]!.messages).toHaveLength(5);
    expect(retries(events).map((e) => e.attempt)).toEqual([1, 2]);
    expect(attempts.map((a) => a.outcome)).toEqual(["invalid", "invalid", "invalid"]);
  });

  it("honours ctx.retry.validation", async () => {
    const { fake, ctx } = await setup([invalid], { retry: { validation: 0 } });
    await expect(invokeTool(ctx, request, parse)).rejects.toMatchObject({ attempts: 1 });
    expect(fake.calls).toHaveLength(1);
  });

  it("text-only feedback exact", async () => {
    const { fake, ctx, attempts } = await setup([{ kind: "text", text: "Here is my plan." }, valid]);
    await invokeTool(ctx, request, parse);
    expect(fake.calls[1]!.messages.slice(1)).toEqual([
      { role: "assistant", content: [{ type: "text", text: "Here is my plan." }] },
      { role: "user", content: [{ type: "text", text: "Call the emit_deck tool exactly once with the complete result." }] },
    ]);
    expect(attempts[0]).toMatchObject({ outcome: "no-tool-call" });
  });

  it("max_tokens feedback", async () => {
    // A truncated call is never parsed, even when its partial input happens to be valid.
    const { fake, ctx, attempts, events } = await setup([{ kind: "tool", input: { ok: true }, stopReason: "max_tokens" }, valid]);
    parsed.length = 0;
    await invokeTool(ctx, request, parse);
    expect(parsed).toHaveLength(1);
    const feedback = fake.calls[1]!.messages[2];
    expect(feedback).toEqual({
      role: "user",
      content: [{ type: "tool_result", toolUseId: "toolu_fake_1", isError: true, content: expect.stringMatching(/cut off.*16000/s) }],
    });
    expect(attempts[0]).toMatchObject({ outcome: "truncated" });
    expect(retries(events)).toEqual([expect.objectContaining({ reason: "validation", attempt: 1, detail: expect.stringContaining("max_tokens") })]);
  });

  it("max_tokens without a tool call is fed back as text", async () => {
    const { fake, ctx } = await setup([{ kind: "text", text: "Let me think", stopReason: "max_tokens" }, valid]);
    await invokeTool(ctx, request, parse);
    expect(fake.calls[1]!.messages[2]).toEqual({ role: "user", content: [{ type: "text", text: expect.stringMatching(/cut off/) }] });
  });

  it("a final truncated reply fails validation with code truncated", async () => {
    const cut: FakeReply = { kind: "tool", input: {}, stopReason: "max_tokens" };
    const { ctx } = await setup([cut, cut, cut]);
    await expect(invokeTool(ctx, request, parse)).rejects.toMatchObject({ issues: [{ code: "truncated" }], attempts: 3 });
  });

  it("answers every tool_use id in the turn", async () => {
    const calls: LlmRequest[] = [];
    const twoCalls: LlmCompletion = {
      toolCall: { id: "toolu_a", name: "emit_deck", input: { ok: false } },
      toolUseIds: ["toolu_a", "toolu_b"],
      text: "",
      stopReason: "tool_use",
      refusalCategory: null,
      usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
      turn: { role: "assistant", content: ["opaque"] },
    };
    const llm: LlmPort = {
      preflight: () => Promise.resolve(),
      complete: (req) => {
        calls.push({ ...req, messages: [...req.messages] });
        return Promise.resolve(calls.length === 1 ? twoCalls : { ...twoCalls, toolCall: { ...twoCalls.toolCall!, input: { ok: true } } });
      },
    };
    const { ctx } = await makeTestContext({ llm });
    await invokeTool(ctx, request, parse);
    expect(calls[1]!.messages[1]).toEqual({ role: "assistant", content: ["opaque"] });
    const feedback = calls[1]!.messages[2] as { content: { type: string; toolUseId: string; isError: boolean }[] };
    expect(feedback.content.map((b) => [b.type, b.toolUseId, b.isError])).toEqual([
      ["tool_result", "toolu_a", true],
      ["tool_result", "toolu_b", true],
    ]);
  });

  it("refusal no retry", async () => {
    const { fake, ctx, events, attempts, meter } = await setup([{ kind: "refusal", category: "cyber" }, valid]);
    await expect(invokeTool(ctx, request, parse)).rejects.toBeInstanceOf(LlmRefusalError);
    expect(fake.calls).toHaveLength(1);
    expect(retries(events)).toEqual([]);
    expect(attempts).toEqual([expect.objectContaining({ n: 1, outcome: "error", usageKnown: true })]);
    expect(meter.total).toBe(1500);
  });

  it("budget stop", async () => {
    // The first reply spends the whole budget; the pre-call check stops attempt 2 before any LLM call.
    const { fake, ctx } = await setup([invalid, valid], { tokenBudget: 1500 });
    await expect(invokeTool(ctx, request, parse)).rejects.toBeInstanceOf(BudgetError);
    expect(fake.calls).toHaveLength(1);
  });

  it("usage over the budget stops at once", async () => {
    const { fake, ctx, attempts } = await setup([valid], { tokenBudget: 1000 });
    await expect(invokeTool(ctx, request, parse)).rejects.toBeInstanceOf(BudgetError);
    expect(fake.calls).toHaveLength(1);
    expect(attempts).toHaveLength(1);
  });

  it("rate-limit extends the deadline and accrues backoff", async () => {
    const { ctx, events, probe } = await setup([{ kind: "tool", input: { ok: true }, rateLimitFirst: { waitMs: 2000 } }]);
    await invokeTool(ctx, request, parse);
    expect(retries(events)).toEqual([
      expect.objectContaining({ reason: "rate-limit", status: 429, attempt: 1, maxAttempts: 4, waitMs: 2000 }),
    ]);
    expect(probe.extendedMs).toBe(2000);
  });

  it("transient retries are reported without extending the deadline", async () => {
    const llm: LlmPort = {
      preflight: () => Promise.resolve(),
      complete: async (req, { onRetry }) => {
        onRetry?.({ reason: "transient", status: 503, attempt: 1, maxAttempts: 4, waitMs: 500, detail: "503 overloaded" });
        return new FakeLlm({ replies: { emit_deck: [valid] } }).complete(req, { signal: new AbortController().signal });
      },
    };
    const { ctx, events, probe } = await makeTestContext({ llm });
    await invokeTool(ctx, request, parse);
    expect(retries(events)).toEqual([expect.objectContaining({ reason: "transient", status: 503, waitMs: 500 })]);
    expect(probe.extendedMs).toBe(0);
  });

  it("beginAttempt once per attempt", async () => {
    const fake = new FakeLlm({ replies: { emit_deck: [invalid, { kind: "text", text: "hm" }, valid] } });
    const seen: number[] = [];
    const t = await makeTestContext();
    const llm: LlmPort = {
      preflight: (s) => fake.preflight(s),
      complete: (req, opts) => {
        seen.push(t.probe.beginAttempts);
        return fake.complete(req, opts);
      },
    };
    const ctx = { ...t.ctx, llm };
    await invokeTool(ctx, request, parse);
    expect(seen).toEqual([1, 2, 3]);
    expect(t.probe.beginAttempts).toBe(3);
    expect(t.events.filter((e) => e.type === "stage:progress").map((e) => (e as { message: string }).message)).toEqual([
      "calling claude-sonnet-5-5 (attempt 1/3)",
      "calling claude-sonnet-5-5 (attempt 2/3)",
      "calling claude-sonnet-5-5 (attempt 3/3)",
    ]);
  });

  it("an aborted call records usageKnown false and rethrows", async () => {
    const controller = new AbortController();
    const { fake, ctx, attempts, meter } = await setup([{ kind: "hang" }], { signal: controller.signal });
    const run = invokeTool(ctx, request, parse);
    await Promise.resolve();
    controller.abort(new CancelledError("ownership lost"));
    await expect(run).rejects.toMatchObject({ message: "ownership lost" });
    expect(fake.calls).toHaveLength(1);
    expect(attempts).toEqual([expect.objectContaining({ n: 1, outcome: "error", usageKnown: false })]);
    expect(meter.total).toBe(0);
  });
});
