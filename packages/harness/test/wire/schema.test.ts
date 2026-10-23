import { BlockSchema, BlockUnionSchema, DeckSpecSchema, PatchSchema } from "@deckforge/schemas";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { compileWireSchema, UnsupportedSchemaError, type JsonSchema } from "../../src/wire/schema.ts";

const NULL = { type: "null" };
const FORBIDDEN = [
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minItems",
  "maxItems",
  "pattern",
];

function eachSchema(schema: JsonSchema, fn: (s: JsonSchema) => void): void {
  fn(schema);
  const children = [
    ...Object.values((schema.properties ?? {}) as Record<string, JsonSchema>),
    ...((schema.anyOf ?? []) as JsonSchema[]),
    ...(schema.items ? [schema.items as JsonSchema] : []),
  ];
  for (const child of children) eachSchema(child, fn);
}

function unsupportedError(fn: () => unknown): UnsupportedSchemaError {
  try {
    fn();
  } catch (err) {
    if (err instanceof UnsupportedSchemaError) return err;
    throw err;
  }
  throw new Error("expected UnsupportedSchemaError");
}

describe("compileWireSchema → jsonSchema", () => {
  it("object: every key required, additionalProperties false", () => {
    const { jsonSchema } = compileWireSchema(z.object({ a: z.string(), b: z.boolean() }));
    expect(jsonSchema).toStrictEqual({
      type: "object",
      properties: { a: { type: "string" }, b: { type: "boolean" } },
      required: ["a", "b"],
      additionalProperties: false,
    });
  });

  it("optional and nullable both become anyOf [T, null] and stay required", () => {
    const { jsonSchema } = compileWireSchema(z.object({ a: z.string().optional(), b: z.number().nullable() }));
    expect(jsonSchema).toStrictEqual({
      type: "object",
      properties: {
        a: { anyOf: [{ type: "string" }, NULL] },
        b: { anyOf: [{ type: "number" }, NULL] },
      },
      required: ["a", "b"],
      additionalProperties: false,
    });
  });

  it("int().min(0) → integer; string().min(3) → string", () => {
    expect(compileWireSchema(z.number().int().min(0)).jsonSchema).toStrictEqual({ type: "integer" });
    expect(compileWireSchema(z.number().min(1).max(5)).jsonSchema).toStrictEqual({ type: "number" });
    expect(compileWireSchema(z.string().min(3)).jsonSchema).toStrictEqual({ type: "string" });
    expect(compileWireSchema(z.string().regex(/^#[0-9a-f]{6}$/)).jsonSchema).toStrictEqual({ type: "string" });
    expect(compileWireSchema(z.array(z.boolean()).min(1).max(3)).jsonSchema).toStrictEqual({
      type: "array",
      items: { type: "boolean" },
    });
  });

  it("literal/enum/discriminatedUnion mapping", () => {
    expect(compileWireSchema(z.literal("x")).jsonSchema).toStrictEqual({ const: "x" });
    expect(compileWireSchema(z.enum(["a", "b"])).jsonSchema).toStrictEqual({ type: "string", enum: ["a", "b"] });
    expect(compileWireSchema(z.union([z.literal(5), z.literal(10)])).jsonSchema).toStrictEqual({
      anyOf: [{ const: 5 }, { const: 10 }],
    });
    const union = z.discriminatedUnion("k", [
      z.object({ k: z.literal("a") }),
      z.object({ k: z.literal("b"), n: z.number() }),
    ]);
    expect(compileWireSchema(union).jsonSchema).toStrictEqual({
      anyOf: [
        { type: "object", properties: { k: { const: "a" } }, required: ["k"], additionalProperties: false },
        {
          type: "object",
          properties: { k: { const: "b" }, n: { type: "number" } },
          required: ["k", "n"],
          additionalProperties: false,
        },
      ],
    });
  });

  it("superRefine unwrapped", () => {
    expect(compileWireSchema(z.string().superRefine(() => {})).jsonSchema).toStrictEqual({ type: "string" });
    const block = compileWireSchema(BlockSchema).jsonSchema;
    expect(block).toStrictEqual(compileWireSchema(BlockUnionSchema).jsonSchema);
    expect(block.anyOf).toHaveLength(BlockUnionSchema.options.length);
  });

  it('record throws UnsupportedSchemaError at "$.payload"', () => {
    const err = unsupportedError(() => compileWireSchema(PatchSchema));
    expect(err.path).toBe("$.payload");
    expect(err.typeName).toBe("ZodRecord");
    expect(err.message).toContain("$.payload");
  });

  it("reports array item paths for unsupported nodes", () => {
    const err = unsupportedError(() => compileWireSchema(z.object({ xs: z.array(z.object({ d: z.date() })) })));
    expect(err.path).toBe("$.xs[].d");
    expect(err.typeName).toBe("ZodDate");
  });

  it("DeckSpecSchema has no forbidden keywords", () => {
    const { jsonSchema } = compileWireSchema(DeckSpecSchema);
    let objects = 0;
    eachSchema(jsonSchema, (s) => {
      for (const key of FORBIDDEN) expect(s).not.toHaveProperty(key);
      if (s.type === "object") {
        objects += 1;
        expect(s.additionalProperties).toBe(false);
        expect(s.required).toStrictEqual(Object.keys(s.properties as object));
      }
    });
    expect(objects).toBeGreaterThan(BlockUnionSchema.options.length);
  });
});

describe("compileWireSchema → normalize", () => {
  it("normalize deletes null only for optional fields", () => {
    const { normalize } = compileWireSchema(z.object({ a: z.string().optional(), b: z.string().nullable() }));
    expect(normalize({ a: null, b: null })).toStrictEqual({ b: null });
    expect(normalize({ a: "x", b: "y" })).toStrictEqual({ a: "x", b: "y" });
  });

  it("normalize picks the union branch by discriminator", () => {
    const { normalize } = compileWireSchema(BlockSchema);
    expect(normalize({ type: "Stat", value: "42%", label: "growth", trend: null })).toStrictEqual({
      type: "Stat",
      value: "42%",
      label: "growth",
    });
    expect(normalize({ type: "Unknown", trend: null })).toStrictEqual({ type: "Unknown", trend: null });
  });

  it("normalize picks the first union branch that parses after normalisation", () => {
    const { normalize } = compileWireSchema(
      z.union([
        z.object({ n: z.number(), tag: z.string().optional() }),
        z.object({ s: z.string(), tag: z.string().nullable() }),
      ]),
    );
    expect(normalize({ n: 1, tag: null })).toStrictEqual({ n: 1 });
    expect(normalize({ s: "x", tag: null })).toStrictEqual({ s: "x", tag: null });
    expect(normalize({ q: true, tag: null })).toStrictEqual({ q: true, tag: null });
  });

  it("round-trip: schema.parse(normalize(raw)) succeeds for raw values with nulls wherever allowed", () => {
    const raw = {
      title: "Solar",
      subtitle: "Why now",
      slides: [
        {
          id: "s1",
          type: "title",
          title: null,
          body: [
            { type: "Stat", value: "3x", label: "cheaper", trend: null },
            { type: "Diagram", mermaid: "graph TD; A-->B", hotspots: null },
            { type: "Chart", kind: "bar", labels: ["a"], series: [{ name: "x", values: [1] }], unit: null },
            { type: "Timeline", steps: [{ label: "now", detail: "d", date: null }] },
            { type: "Code", lang: "ts", code: "1", highlightLines: null },
          ],
          notes: "n",
          emphasisTargets: [],
        },
      ],
    };
    const { normalize } = compileWireSchema(DeckSpecSchema);
    expect(DeckSpecSchema.safeParse(raw).success).toBe(false);
    const deck = DeckSpecSchema.parse(normalize(raw));
    expect(deck.slides[0]).not.toHaveProperty("title");
    expect(deck.slides[0]?.body[0]).not.toHaveProperty("trend");
  });
});
