import { afterEach, describe, expect, it } from "vitest";
import {
  CancelledError,
  LlmAuthError,
  LlmBadRequestError,
  LlmConfigError,
  LlmQuotaError,
  LlmTransientError,
  LlmUnreachableError,
} from "../../src/kernel/errors.ts";
import type { LlmPort, LlmRequest, LlmRetryInfo, ToolSpec } from "../../src/kernel/llm-port.ts";
import type { Clock, Logger } from "../../src/kernel/ports.ts";
import { createAnthropicLlm, createLlmClient, FALLBACK_BETA } from "../../src/llm.ts";
import { apiError, closedPort, startFakeServer, toolMessage, type FakeServer, type FakeServerOptions } from "./fake-server.ts";

const designTool: ToolSpec = {
  name: "emit_design",
  description: "Emit the design plan.",
  inputSchema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false },
  strict: true,
};
const deckTool: ToolSpec = { ...designTool, name: "emit_deck", description: "Emit the deck.", strict: false };

const request = (over: Partial<LlmRequest> = {}): LlmRequest => ({
  model: "claude-sonnet-5-5",
  system: "You design decks.",
  messages: [{ role: "user", content: [{ type: "text", text: "<input>{}</input>" }] }],
  tool: designTool,
  effort: "low",
  maxTokens: 8000,
  ...over,
});

/** Real time is never spent: sleeps resolve at once (or reject on abort) and are recorded. */
function instantClock(): Clock & { sleeps: number[] } {
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => 0,
    sleep: (ms, signal) => {
      sleeps.push(ms);
      return signal?.aborted ? Promise.reject(signal.reason) : Promise.resolve();
    },
    every: () => () => {},
  };
}

function captureLogger(): Logger & { warnings: string[] } {
  const warnings: string[] = [];
  const noop = () => {};
  return { warnings, debug: noop, info: noop, error: noop, warn: (m) => warnings.push(m) };
}

const servers: FakeServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

type Setup = { server: FakeServer; llm: LlmPort; clock: ReturnType<typeof instantClock>; logger: ReturnType<typeof captureLogger> };

async function setup(
  o: { server?: FakeServerOptions; proxyControls?: boolean; fallbackModels?: string[]; baseUrl?: string } = {},
): Promise<Setup> {
  const server = await startFakeServer(o.server);
  servers.push(server);
  const baseUrl = o.baseUrl ?? server.baseUrl;
  const proxyControls = o.proxyControls ?? true;
  const clock = instantClock();
  const logger = captureLogger();
  const client = createLlmClient({ baseUrl, apiKey: "test-key", proxyControls });
  const llm = createAnthropicLlm(client, { baseUrl, clock, logger, proxyControls, fallbackModels: o.fallbackModels });
  return { server, llm, clock, logger };
}

const signal = () => new AbortController().signal;
const messagesBody = (s: FakeServer, i = 0) => s.requests.filter((r) => r.path.startsWith("/v1/messages"))[i]?.body as Record<string, unknown>;

describe("preflight", () => {
  // SDK 1.1.0 presents apiKey as `Authorization: Bearer`, not x-api-key; the proxy's 4001 port accepts both.
  it("GETs /v1/models with the API key", async () => {
    const { server, llm } = await setup();
    await llm.preflight(signal());
    expect(server.requests).toHaveLength(1);
    const [req] = server.requests;
    expect(req?.method).toBe("GET");
    expect(req?.path).toBe("/v1/models?limit=1");
    expect(req?.headers.authorization).toBe("Bearer test-key");
  });

  it("against a closed port → exact LlmUnreachableError message", async () => {
    const baseUrl = `http://127.0.0.1:${await closedPort()}`;
    const { llm } = await setup({ baseUrl });
    const err = await llm.preflight(signal()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmUnreachableError);
    expect((err as Error).message).toBe(
      `LLM proxy not reachable at ${baseUrl} — start it with: cd ~/Documents/Cursor-Projects/claude-openai && bash start.sh`,
    );
  });

  it("401 → LlmAuthError", async () => {
    const { llm, server } = await setup({ server: { models: apiError(401, "authentication_error", "invalid x-api-key") } });
    const err = await llm.preflight(signal()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmAuthError);
    expect((err as Error).message).toBe(`LLM_API_KEY rejected by ${server.baseUrl} (401)`);
  });

  it("404 (not a Messages endpoint) → LlmConfigError; 503 → LlmTransientError", async () => {
    const notFound = await setup({ server: { models: { status: 404, body: { error: { message: "Not found" } } } } });
    const e404 = await notFound.llm.preflight(signal()).catch((e: unknown) => e);
    expect(e404).toBeInstanceOf(LlmConfigError);
    expect((e404 as Error).message).toBe(`LLM endpoint at ${notFound.server.baseUrl} failed preflight: GET /v1/models returned 404 Not found`);

    const down = await setup({ server: { models: apiError(503, "api_error", "upstream down") } });
    const e503 = await down.llm.preflight(signal()).catch((e: unknown) => e);
    expect(e503).toBeInstanceOf(LlmTransientError);
    expect(down.server.requests).toHaveLength(1);
  });

  it("without x-proxy-controls → LlmConfigError (controls on)", async () => {
    const { llm, server } = await setup({ server: { controls: false } });
    const err = await llm.preflight(signal()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmConfigError);
    expect((err as Error).message).toBe(
      `LLM proxy at ${server.baseUrl} lacks passthrough controls (x-proxy-controls header missing) — update and restart it: cd ~/Documents/Cursor-Projects/claude-openai && git pull && bash stop.sh && bash start.sh`,
    );
  });

  it("without x-proxy-controls → warning only (controls off)", async () => {
    const { llm, logger } = await setup({ server: { controls: false }, proxyControls: false });
    await llm.preflight(signal());
    expect(logger.warnings).toEqual(["LLM_PROXY_CONTROLS=0: proxy-side retries are hidden from the harness"]);
  });

  it("with controls on and the marker present, logs nothing", async () => {
    const { llm, logger } = await setup();
    await llm.preflight(signal());
    expect(logger.warnings).toEqual([]);
  });

  it("aborted → CancelledError", async () => {
    const { llm, server } = await setup();
    const ac = new AbortController();
    ac.abort();
    await expect(llm.preflight(ac.signal)).rejects.toBeInstanceOf(CancelledError);
    expect(server.requests).toHaveLength(0);
  });
});

describe("request", () => {
  it("sends x-proxy-max-retries: 0 when proxyControls; omits it otherwise", async () => {
    const on = await setup();
    on.server.reply({ body: toolMessage() });
    await on.llm.complete(request(), { signal: signal() });
    await on.llm.preflight(signal());
    expect(on.server.requests.map((r) => r.headers["x-proxy-max-retries"])).toEqual(["0", "0"]);

    const off = await setup({ proxyControls: false });
    off.server.reply({ body: toolMessage() });
    await off.llm.complete(request(), { signal: signal() });
    await off.llm.preflight(signal());
    expect(off.server.requests.map((r) => r.headers["x-proxy-max-retries"])).toEqual([undefined, undefined]);
  });

  it("body: the tool's own strict flag, auto tool_choice, effort, cache_control; no sampling params or thinking", async () => {
    const { llm, server } = await setup();
    server.reply({ body: toolMessage() }, { body: toolMessage() });
    await llm.complete(request({ tool: designTool }), { signal: signal() });
    await llm.complete(request({ tool: deckTool, effort: "medium", maxTokens: 16000 }), { signal: signal() });

    const strict = messagesBody(server, 0);
    expect(server.requests[0]?.path).toBe("/v1/messages");
    expect(strict).toEqual({
      model: "claude-sonnet-5-5",
      max_tokens: 8000,
      system: "You design decks.",
      messages: [{ role: "user", content: [{ type: "text", text: "<input>{}</input>" }] }],
      tools: [{ name: "emit_design", description: "Emit the design plan.", input_schema: designTool.inputSchema, strict: true }],
      tool_choice: { type: "auto" },
      output_config: { effort: "low" },
      cache_control: { type: "ephemeral" },
    });

    const loose = messagesBody(server, 1);
    expect(loose.tools).toEqual([{ name: "emit_deck", description: "Emit the deck.", input_schema: deckTool.inputSchema, strict: false }]);
    expect(loose.output_config).toEqual({ effort: "medium" });
    expect(loose.max_tokens).toBe(16000);
    for (const body of [strict, loose]) {
      for (const banned of ["temperature", "top_p", "top_k", "thinking", "stream"]) expect(body).not.toHaveProperty(banned);
    }
  });

  it("maps a tool_result user block", async () => {
    const { llm, server } = await setup();
    server.reply({ body: toolMessage() });
    await llm.complete(
      request({
        messages: [
          { role: "user", content: [{ type: "text", text: "go" }] },
          { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "emit_design", input: {} }] },
          { role: "user", content: [{ type: "tool_result", toolUseId: "toolu_1", content: "ok is required", isError: true }] },
        ],
      }),
      { signal: signal() },
    );
    expect((messagesBody(server).messages as unknown[])[2]).toEqual({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "ok is required", is_error: true }],
    });
  });
});

describe("response", () => {
  it("maps usage and tool call", async () => {
    const { llm, server } = await setup();
    server.reply({
      body: toolMessage({
        content: [
          { type: "text", text: "Here is " },
          { type: "text", text: "the plan." },
          { type: "tool_use", id: "toolu_9", name: "emit_design", input: { ok: true } },
          { type: "tool_use", id: "toolu_10", name: "emit_design", input: { ok: false } },
        ],
        usage: { input_tokens: 4, output_tokens: 2516, cache_read_input_tokens: null, cache_creation_input_tokens: 3275 },
      }),
    });
    const out = await llm.complete(request(), { signal: signal() });
    expect(out.toolCall).toEqual({ id: "toolu_9", name: "emit_design", input: { ok: true } });
    expect(out.text).toBe("Here is the plan.");
    expect(out.stopReason).toBe("tool_use");
    expect(out.refusalCategory).toBeNull();
    expect(out.usage).toEqual({ inputTokens: 4, outputTokens: 2516, cacheReadTokens: 0, cacheWriteTokens: 3275 });
  });

  it("a text-only reply has no tool call", async () => {
    const { llm, server } = await setup();
    server.reply({ body: toolMessage({ content: [{ type: "text", text: "I can't." }], stop_reason: "end_turn" }) });
    const out = await llm.complete(request(), { signal: signal() });
    expect(out.toolCall).toBeNull();
    expect(out.stopReason).toBe("end_turn");
  });

  it("replays the assistant turn verbatim", async () => {
    const { llm, server } = await setup();
    const content = [
      { type: "thinking", thinking: "", signature: "sig-abc" },
      { type: "text", text: "Plan:", citations: null },
      { type: "tool_use", id: "toolu_1", name: "emit_design", input: { ok: "nope", extra: [1, { deep: null }] } },
    ];
    server.reply({ body: toolMessage({ content }) }, { body: toolMessage() });
    const first = await llm.complete(request(), { signal: signal() });
    expect(first.turn).toEqual({ role: "assistant", content });

    const followUp = request({
      messages: [
        ...request().messages,
        first.turn,
        { role: "user", content: [{ type: "tool_result", toolUseId: "toolu_1", content: "ok must be boolean", isError: true }] },
      ],
    });
    await llm.complete(followUp, { signal: signal() });
    expect((messagesBody(server, 1).messages as unknown[])[1]).toEqual({ role: "assistant", content });
  });

  it("refusal mapping", async () => {
    const { llm, server } = await setup();
    server.reply({
      body: toolMessage({ content: [], stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber", explanation: null } }),
    });
    const out = await llm.complete(request(), { signal: signal() });
    expect(out.stopReason).toBe("refusal");
    expect(out.refusalCategory).toBe("cyber");
    expect(out.toolCall).toBeNull();
  });
});

describe("retries", () => {
  const retries = (infos: LlmRetryInfo[]) => ({ signal: signal(), onRetry: (i: LlmRetryInfo) => infos.push(i) });

  it("429 with retry-after-ms: 5 then 200 → one onRetry {reason: rate-limit, status: 429, waitMs: 5}", async () => {
    const { llm, server, clock } = await setup();
    server.reply(apiError(429, "rate_limit_error", "slow down", { "retry-after-ms": "5" }), { body: toolMessage() });
    const infos: LlmRetryInfo[] = [];
    const out = await llm.complete(request(), retries(infos));
    expect(out.toolCall?.name).toBe("emit_design");
    expect(infos).toHaveLength(1);
    expect(infos[0]).toMatchObject({ reason: "rate-limit", status: 429, waitMs: 5, attempt: 1, maxAttempts: 4 });
    expect(infos[0]?.detail).toContain("slow down");
    expect(clock.sleeps).toEqual([5]);
    expect(server.requests).toHaveLength(2);
  });

  it("retry-after (seconds) is honoured when retry-after-ms is absent", async () => {
    const { llm, server, clock } = await setup();
    server.reply(apiError(429, "rate_limit_error", "slow down", { "retry-after": "3" }), { body: toolMessage() });
    await llm.complete(request(), { signal: signal() });
    expect(clock.sleeps).toEqual([3000]);
  });

  it("529 is rate-limit", async () => {
    const { llm, server } = await setup();
    server.reply(apiError(529, "overloaded_error", "Overloaded"), { body: toolMessage() });
    const infos: LlmRetryInfo[] = [];
    await llm.complete(request(), retries(infos));
    expect(infos.map((i) => [i.reason, i.status])).toEqual([["rate-limit", 529]]);
  });

  it("500 is transient, with exponential backoff when no header says otherwise", async () => {
    const { llm, server, clock } = await setup();
    server.reply(apiError(500, "api_error", "boom"), apiError(503, "api_error", "boom"), { body: toolMessage() });
    const infos: LlmRetryInfo[] = [];
    await llm.complete(request(), retries(infos));
    expect(infos.map((i) => [i.reason, i.status, i.attempt, i.waitMs])).toEqual([
      ["transient", 500, 1, 500],
      ["transient", 503, 2, 1000],
    ]);
    expect(clock.sleeps).toEqual([500, 1000]);
  });

  it("gives up after 4 retries (5 requests)", async () => {
    const { llm, server, clock } = await setup();
    server.reply(...Array.from({ length: 6 }, () => apiError(529, "overloaded_error", "Overloaded")));
    const infos: LlmRetryInfo[] = [];
    const err = await llm.complete(request(), retries(infos)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmTransientError);
    expect((err as LlmTransientError).status).toBe(529);
    expect(server.requests).toHaveLength(5);
    expect(infos.map((i) => i.attempt)).toEqual([1, 2, 3, 4]);
    expect(clock.sleeps).toEqual([500, 1000, 2000, 4000]);
  });

  it("a refused connection retries, then fails as LlmUnreachableError", async () => {
    const baseUrl = `http://127.0.0.1:${await closedPort()}`;
    const { llm } = await setup({ baseUrl });
    const infos: LlmRetryInfo[] = [];
    const err = await llm.complete(request(), retries(infos)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmUnreachableError);
    expect((err as Error).message).toContain(`LLM proxy not reachable at ${baseUrl}`);
    expect(infos).toHaveLength(4);
    expect(infos.every((i) => i.reason === "transient" && i.status === undefined)).toBe(true);
  });

  it("entitlement 429 → LlmQuotaError after 1 request", async () => {
    for (const message of [
      "Extra usage is required for this request.",
      "Your credit balance is too low to access the Anthropic API.",
      "credit balance too low",
    ]) {
      const { llm, server } = await setup();
      server.reply(apiError(429, "rate_limit_error", message, { "retry-after": "1" }));
      const infos: LlmRetryInfo[] = [];
      const err = await llm.complete(request(), retries(infos)).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(LlmQuotaError);
      expect((err as Error).message).toContain(message);
      expect(server.requests).toHaveLength(1);
      expect(infos).toEqual([]);
    }
  });

  it("400 → LlmBadRequestError after 1 request", async () => {
    const { llm, server } = await setup();
    server.reply(apiError(400, "invalid_request_error", "The compiled grammar is too large"));
    const err = await llm.complete(request(), { signal: signal() }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmBadRequestError);
    expect((err as LlmBadRequestError).status).toBe(400);
    expect((err as Error).message).toContain("The compiled grammar is too large");
    expect(server.requests).toHaveLength(1);
  });

  it("a proxy-local 400 body (no top-level type) still maps to LlmBadRequestError", async () => {
    const { llm, server } = await setup();
    server.reply({ status: 400, body: { error: { message: "x-proxy-max-retries must be an integer 0-10", type: "invalid_request_error" } } });
    const err = await llm.complete(request(), { signal: signal() }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmBadRequestError);
    expect((err as Error).message).toContain("x-proxy-max-retries must be an integer 0-10");
  });

  it("401/403 → LlmAuthError, no retry", async () => {
    for (const status of [401, 403]) {
      const { llm, server } = await setup();
      server.reply(apiError(status, "authentication_error", "nope"));
      const err = await llm.complete(request(), { signal: signal() }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(LlmAuthError);
      expect((err as Error).message).toBe(`LLM_API_KEY rejected by ${server.baseUrl} (${status})`);
      expect(server.requests).toHaveLength(1);
    }
  });
});

describe("abort", () => {
  it("abort mid-request → CancelledError, and the request is closed", async () => {
    const { llm, server } = await setup();
    server.reply({ hang: true });
    const ac = new AbortController();
    const pending = llm.complete(request(), { signal: ac.signal });
    await expect.poll(() => server.requests.length).toBe(1);
    ac.abort();
    const err = await pending.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CancelledError);
    expect((err as CancelledError).reason).toBe("cancelled");
    await expect.poll(() => server.closedHangs()).toBe(1);
  });

  it("abort during backoff → CancelledError, no further request", async () => {
    const { llm, server } = await setup();
    server.reply(apiError(429, "rate_limit_error", "slow down"), { body: toolMessage() });
    const ac = new AbortController();
    const err = await llm
      .complete(request(), { signal: ac.signal, onRetry: () => ac.abort() })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CancelledError);
    expect(server.requests).toHaveLength(1);
  });

  it("keeps a CancelledError abort reason (ownership lost)", async () => {
    const { llm, server } = await setup();
    server.reply({ hang: true });
    const ac = new AbortController();
    const pending = llm.complete(request(), { signal: ac.signal });
    await expect.poll(() => server.requests.length).toBe(1);
    ac.abort(CancelledError.ownershipLost());
    await expect(pending).rejects.toMatchObject({ kind: "cancelled", reason: "ownership lost" });
  });
});

describe("fallback models", () => {
  it("a fallback model uses the beta endpoint; others don't", async () => {
    const { llm, server } = await setup({ fallbackModels: ["claude-sonnet-5-5"] });
    server.reply({ body: toolMessage() }, { body: toolMessage() });
    await llm.complete(request({ model: "claude-sonnet-5-5" }), { signal: signal() });
    await llm.complete(request({ model: "claude-haiku-5-5" }), { signal: signal() });

    const [beta, plain] = server.requests;
    expect(beta?.path).toBe("/v1/messages?beta=true");
    expect(beta?.headers["anthropic-beta"]).toBe(FALLBACK_BETA);
    expect(beta?.body).toMatchObject({ model: "claude-sonnet-5-5", fallbacks: "default", tool_choice: { type: "auto" } });
    expect(beta?.body).not.toHaveProperty("betas");

    expect(plain?.path).toBe("/v1/messages");
    expect(plain?.headers["anthropic-beta"]).toBeUndefined();
    expect(plain?.body).not.toHaveProperty("fallbacks");
  });
});
