import { describe, expect, it } from "vitest";
import { loadEnv } from "../../src/env.ts";
import type { Clock, Logger } from "../../src/kernel/ports.ts";
import { createAnthropicLlm, createLlmClient } from "../../src/llm.ts";

// Opt-in: DECKFORGE_LIVE=1 with LLM_BASE_URL / LLM_API_KEY set. One small Haiku call.
const live = process.env.DECKFORGE_LIVE === "1";

const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      signal?.addEventListener("abort", () => (clearTimeout(t), reject(signal.reason)), { once: true });
    }),
  every: (ms, fn) => {
    const t = setInterval(fn, ms);
    return () => clearInterval(t);
  },
};

describe.skipIf(!live)("anthropic adapter (live)", () => {
  it("preflights and completes a strict tool call through the configured endpoint", async () => {
    const env = loadEnv(process.env);
    const warnings: string[] = [];
    const noop = () => {};
    const logger: Logger = { debug: noop, info: noop, error: noop, warn: (m) => warnings.push(m) };
    const llm = createAnthropicLlm(createLlmClient(env.llm), {
      baseUrl: env.llm.baseUrl,
      clock: realClock,
      logger,
      proxyControls: env.llm.proxyControls,
    });
    const signal = AbortSignal.timeout(60_000);

    await llm.preflight(signal);
    const out = await llm.complete(
      {
        model: env.llm.models.fast,
        system: "Answer only by calling the emit_design tool.",
        messages: [{ role: "user", content: [{ type: "text", text: "Call emit_design with ok set to true." }] }],
        tool: {
          name: "emit_design",
          description: "Report the result.",
          inputSchema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false },
          strict: true,
        },
        effort: "low",
        maxTokens: 256,
      },
      { signal },
    );

    expect(out.stopReason).toBe("tool_use");
    expect(out.toolCall).toMatchObject({ name: "emit_design", input: { ok: true } });
    expect(out.usage.outputTokens).toBeGreaterThan(0);
    expect(warnings).toEqual([]);
  }, 90_000);
});
