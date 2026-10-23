import { describe, expect, it } from "vitest";
import { hashOf } from "../../src/kernel/hash.ts";
import {
  RequestFingerprintSchema,
  requestFingerprint,
  type LlmRequest,
  type ToolSpec,
} from "../../src/kernel/llm-port.ts";

const tool: ToolSpec = {
  name: "emit_deck",
  description: "Emit the deck.",
  inputSchema: { type: "object", properties: { title: { type: "string" } }, required: ["title"], additionalProperties: false },
  strict: false,
};

const request: LlmRequest = {
  model: "claude-sonnet-5-5",
  system: "You write decks.",
  tool,
  effort: "medium",
  maxTokens: 16_000,
  messages: [{ role: "user", content: [{ type: "text", text: "<input>\n{}\n</input>" }] }],
};

describe("requestFingerprint", () => {
  it("hashes system, tool and first user message; keeps model, effort and maxTokens", () => {
    const fp = requestFingerprint(request);
    expect(fp).toEqual({
      model: "claude-sonnet-5-5",
      systemHash: hashOf("You write decks."),
      toolSchemaHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      effort: "medium",
      maxTokens: 16_000,
      firstUserHash: hashOf(request.messages[0]!.content),
    });
    expect(RequestFingerprintSchema.parse(fp)).toEqual(fp);
  });

  it("requestFingerprint ignores later messages, changes with tool schema", () => {
    const later: LlmRequest = {
      ...request,
      messages: [
        ...request.messages,
        { role: "assistant", content: [{ type: "tool_use", id: "tu_1", name: "emit_deck", input: {} }] },
        { role: "user", content: [{ type: "tool_result", toolUseId: "tu_1", content: "- (root): bad (custom)", isError: true }] },
      ],
    };
    expect(requestFingerprint(later)).toEqual(requestFingerprint(request));

    const otherSchema: LlmRequest = {
      ...request,
      tool: { ...tool, inputSchema: { ...tool.inputSchema, properties: { title: { type: "integer" } } } },
    };
    expect(requestFingerprint(otherSchema).toolSchemaHash).not.toBe(requestFingerprint(request).toolSchemaHash);

    const strict: LlmRequest = { ...request, tool: { ...tool, strict: true } };
    expect(requestFingerprint(strict).toolSchemaHash).not.toBe(requestFingerprint(request).toolSchemaHash);
  });

  it("changes with model, system, effort, maxTokens and the first user message", () => {
    const base = requestFingerprint(request);
    expect(requestFingerprint({ ...request, model: "claude-haiku-5-5" })).not.toEqual(base);
    expect(requestFingerprint({ ...request, system: "Other." }).systemHash).not.toBe(base.systemHash);
    expect(requestFingerprint({ ...request, effort: "low" })).not.toEqual(base);
    expect(requestFingerprint({ ...request, maxTokens: 8_000 })).not.toEqual(base);
    const firstUser: LlmRequest = { ...request, messages: [{ role: "user", content: [{ type: "text", text: "other" }] }] };
    expect(requestFingerprint(firstUser).firstUserHash).not.toBe(base.firstUserHash);
  });
});
