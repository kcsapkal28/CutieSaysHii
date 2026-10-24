import { APIConnectionError, RateLimitError } from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { toJsonSchema } from "../src/agents/json-schema.ts";
import { createLlm, type WireRequest, type WireResponse } from "../src/llm.ts";
import { PNG } from "./fakes.ts";

const usage = { input_tokens: 50, output_tokens: 5 };
const toolReply = (input: unknown, id = "tu_1"): WireResponse => ({
  content: [{ type: "tool_use", id, name: "answer", input }],
  stop_reason: "tool_use",
  usage,
});
const schema = z.object({ n: z.number().int().min(1) });
const call = (llm: ReturnType<typeof createLlm>, user: Parameters<typeof llm.callText>[0]["user"] = "go") =>
  llm.callTool({ label: "t", model: "m", system: "sys", user, tool: { name: "answer", description: "d", schema } });

describe("callTool", () => {
  it("retries once with the validation error fed back, then returns the parsed data", async () => {
    const seen: WireRequest[] = [];
    const replies = [toolReply({ n: "seven" }, "tu_a"), toolReply({ n: 7 }, "tu_b")];
    const llm = createLlm({ transport: async (req) => (seen.push(structuredClone(req)), replies.shift()!) });

    const r = await call(llm);

    expect(r.data).toEqual({ n: 7 });
    expect(seen).toHaveLength(2);
    expect(r.usage.input).toBe(100);
    const retry = seen[1]!.messages;
    expect(retry[1]).toEqual({ role: "assistant", content: [{ type: "tool_use", id: "tu_a", name: "answer", input: { n: "seven" } }] });
    const fed = retry[2]!.content[0]!;
    expect(fed.type).toBe("tool_result");
    expect(fed).toMatchObject({ tool_use_id: "tu_a", is_error: true });
    expect((fed as { content: string }).content).toMatch(/n: Expected number/);
  });

  it("gives up after the retry is also invalid", async () => {
    const llm = createLlm({ transport: async () => toolReply({ n: 0 }) });
    await expect(call(llm)).rejects.toThrow(/invalid answer output after a retry/);
  });

  it("asks again when the model answers in text instead of calling the tool", async () => {
    const replies: WireResponse[] = [{ content: [{ type: "text", text: "7" }], stop_reason: "end_turn", usage }, toolReply({ n: 7 })];
    const seen: WireRequest[] = [];
    const llm = createLlm({ transport: async (req) => (seen.push(structuredClone(req)), replies.shift()!) });
    expect((await call(llm)).data).toEqual({ n: 7 });
    expect(JSON.stringify(seen[1]!.messages.at(-1))).toMatch(/Call the answer tool/);
  });

  it("sends the tool with a JSON schema and PNG parts as base64 image blocks", async () => {
    const seen: WireRequest[] = [];
    const llm = createLlm({ transport: async (req) => (seen.push(req), toolReply({ n: 1 })) });
    await call(llm, [{ type: "text", text: "look" }, { type: "image", png: PNG }]);
    expect(seen[0]!.tools![0]!.input_schema).toEqual({
      type: "object",
      properties: { n: { type: "integer", minimum: 1 } },
      required: ["n"],
      additionalProperties: false,
    });
    expect(seen[0]!.messages[0]!.content[1]).toEqual({ type: "image", source: { type: "base64", media_type: "image/png", data: PNG.toString("base64") } });
  });
});

describe("transport errors", () => {
  it("retries 429 and overloaded errors with backoff", async () => {
    const sleep = vi.fn(async () => {});
    let n = 0;
    const llm = createLlm({
      sleep,
      transport: async () => {
        n++;
        if (n === 1) throw new RateLimitError(429, { error: { message: "slow down" } }, "429", new Headers());
        if (n === 2) throw Object.assign(new Error("Overloaded"), { status: 529 });
        return toolReply({ n: 3 });
      },
    });
    expect((await call(llm)).data).toEqual({ n: 3 });
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("reports a refused connection as the proxy not running", async () => {
    const refused = new APIConnectionError({ cause: Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }) });
    const llm = createLlm({ baseUrl: "http://localhost:4001", transport: async () => Promise.reject(refused) });
    await expect(call(llm)).rejects.toThrow("proxy not running on http://localhost:4001");
  });

  it("does not retry a 400", async () => {
    const transport = vi.fn(async () => Promise.reject(Object.assign(new Error("bad"), { status: 400 })));
    const llm = createLlm({ transport, sleep: async () => {} });
    await expect(call(llm)).rejects.toThrow(/bad/);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("times out a hung call", async () => {
    const llm = createLlm({
      maxRetries: 0,
      transport: (_req, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason))),
    });
    await expect(llm.callText({ label: "t", model: "m", system: "s", user: "u", timeoutMs: 20 })).rejects.toThrow(/timed out after 20ms/);
  });
});

describe("hung calls", () => {
  it("retries a timed-out call only once, then fails fast", async () => {
    const transport = vi.fn((_req: WireRequest, { signal }: { signal: AbortSignal }) =>
      new Promise<WireResponse>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason))),
    );
    const llm = createLlm({ transport, sleep: async () => {} });
    await expect(llm.callText({ label: "t", model: "m", system: "s", user: "u", timeoutMs: 10 })).rejects.toThrow(/timed out after 10ms after 2 attempts/);
    expect(transport).toHaveBeenCalledTimes(2);
  });
});

describe("toJsonSchema", () => {
  it("converts optional fields, enums, literal unions, arrays and refinements", () => {
    const s = z.object({
      a: z.string().regex(/^#[0-9a-f]{6}$/),
      b: z.enum(["x", "y"]).optional(),
      c: z.union([z.literal(0), z.literal(1)]),
      d: z.array(z.object({ e: z.boolean() })).min(1),
      f: z.string().superRefine(() => {}),
    });
    expect(toJsonSchema(s)).toEqual({
      type: "object",
      additionalProperties: false,
      required: ["a", "c", "d", "f"],
      properties: {
        a: { type: "string", pattern: "^#[0-9a-f]{6}$" },
        b: { type: "string", enum: ["x", "y"] },
        c: { type: "number", enum: [0, 1] },
        d: { type: "array", minItems: 1, items: { type: "object", properties: { e: { type: "boolean" } }, required: ["e"], additionalProperties: false } },
        f: { type: "string" },
      },
    });
  });
});
