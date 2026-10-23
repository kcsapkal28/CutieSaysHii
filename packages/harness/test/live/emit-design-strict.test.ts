import { describe, expect, it } from "vitest";
import { designWireSchema } from "../../src/validate/design-wire.ts";
import { compileWireSchema } from "../../src/wire/schema.ts";
import { testCatalog } from "../helpers/context.ts";
import { finalDesignEnums } from "../validate/fixtures.ts";

// Opt-in (DECKFORGE_LIVE=1): proves the proxy compiles the strict emit_design grammar. max_tokens 32
// keeps it cheap; a stop on max_tokens is fine, only a 400 (grammar too large, union count) fails.
const LIVE = process.env.DECKFORGE_LIVE === "1";

describe.skipIf(!LIVE)("live: emit_design strict grammar", () => {
  it("the proxy accepts emit_design with strict:true", async () => {
    const baseUrl = (process.env.LLM_BASE_URL ?? "http://localhost:4001").replace(/\/+$/, "");
    const apiKey = process.env.LLM_API_KEY;
    if (!apiKey) throw new Error("DECKFORGE_LIVE=1 needs LLM_API_KEY");
    const c = await testCatalog();
    const { jsonSchema } = compileWireSchema(designWireSchema(finalDesignEnums(c)));

    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
        "x-api-key": apiKey,
        "x-proxy-max-retries": "0",
      },
      body: JSON.stringify({
        model: process.env.LLM_MODEL_DESIGN ?? "claude-sonnet-5-5",
        max_tokens: 32,
        messages: [{ role: "user", content: "Call the emit_design tool with an empty design." }],
        tools: [{ name: "emit_design", description: "Emit the design plan.", input_schema: jsonSchema, strict: true }],
        tool_choice: { type: "auto" },
      }),
    });
    const body = await res.text();
    expect(res.status, body).not.toBe(400);
    expect(res.ok, body).toBe(true);
    const message = JSON.parse(body) as { type?: string; stop_reason?: string };
    expect(message.type, body).toBe("message");
    expect(["max_tokens", "tool_use", "end_turn"], body).toContain(message.stop_reason);
  });
});
