import { BlockSchema, BlockUnionSchema, DeckSpecSchema, PatchSchema } from "@deckforge/schemas";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  assertUnionBudget,
  compileWireSchema,
  UNION_PARAM_LIMIT,
  UnionBudgetError,
  UnsupportedSchemaError,
  type JsonSchema,
} from "../../src/wire/schema.ts";

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

function countUnionNodes(schema: JsonSchema): number {
  let count = 0;
  eachSchema(schema, (s) => {
    if (Array.isArray(s.anyOf) || Array.isArray(s.type)) count += 1;
  });
  return count;
}

function objectWithOptionals(n: number): z.AnyZodObject {
  return z.object(Object.fromEntries(Array.from({ length: n }, (_, i) => [`f${i}`, z.string().optional()])));
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

  it("nullable or optional of a union adds null to the existing anyOf instead of wrapping it", () => {
    const flat = compileWireSchema(z.union([z.string(), z.number()]).nullable());
    expect(flat.jsonSchema).toStrictEqual({ anyOf: [{ type: "string" }, { type: "number" }, NULL] });
    expect(flat.unionParamCount).toBe(1);

    const union = z.discriminatedUnion("k", [z.object({ k: z.literal("a") }), z.object({ k: z.literal("b") })]);
    const wire = compileWireSchema(z.object({ u: union.optional(), v: union.nullable() }));
    const props = wire.jsonSchema.properties as Record<string, JsonSchema>;
    expect(props.u?.anyOf).toHaveLength(3);
    expect(props.v?.anyOf).toHaveLength(3);
    expect((props.u?.anyOf as JsonSchema[])[2]).toStrictEqual(NULL);
    expect(wire.unionParamCount).toBe(2);
    expect(wire.normalize({ u: null, v: null })).toStrictEqual({ v: null });
    expect(wire.normalize({ u: { k: "a" }, v: { k: "b" } })).toStrictEqual({ u: { k: "a" }, v: { k: "b" } });
  });

  it("rejects nullish, optional array items, non-JSON literals and preprocess", () => {
    const cases: [z.ZodTypeAny, string, string][] = [
      [z.object({ a: z.string().nullish() }), "$.a", "ZodOptional"],
      [z.object({ a: z.string().optional().nullable() }), "$.a", "ZodNullable"],
      [z.object({ xs: z.array(z.string().optional()) }), "$.xs[]", "ZodOptional"],
      [z.object({ a: z.literal(null) }), "$.a", "ZodLiteral"],
      [z.literal(undefined), "$", "ZodLiteral"],
      [z.literal(1n), "$", "ZodLiteral"],
      [z.object({ a: z.preprocess((v) => v, z.string()) }), "$.a", "ZodEffects"],
    ];
    for (const [schema, path, typeName] of cases) {
      const err = unsupportedError(() => compileWireSchema(schema));
      expect({ path: err.path, typeName: err.typeName }).toStrictEqual({ path, typeName });
    }
    expect(compileWireSchema(z.literal(true)).jsonSchema).toStrictEqual({ const: true });
    expect(compileWireSchema(z.string().transform((s) => s.trim())).jsonSchema).toStrictEqual({ type: "string" });
  });
});

describe("union parameter budget", () => {
  it("DeckSpecSchema's unionParamCount matches its anyOf nodes and fits the limit", () => {
    const { jsonSchema, unionParamCount } = compileWireSchema(DeckSpecSchema);
    expect(unionParamCount).toBe(7);
    expect(unionParamCount).toBe(countUnionNodes(jsonSchema));
    expect(unionParamCount).toBeLessThanOrEqual(UNION_PARAM_LIMIT);
  });

  it("counts every inlined copy of a repeated subtree", () => {
    const once = compileWireSchema(BlockSchema).unionParamCount;
    const thrice = compileWireSchema(z.object({ a: BlockSchema, b: z.array(BlockSchema), c: BlockSchema.optional() }));
    expect(thrice.unionParamCount).toBe(3 * once);
    expect(thrice.unionParamCount).toBe(countUnionNodes(thrice.jsonSchema));
  });

  it("assertUnionBudget throws above 16 and names each schema's count", () => {
    expect(UNION_PARAM_LIMIT).toBe(16);
    expect(() => assertUnionBudget([compileWireSchema(objectWithOptionals(16))])).not.toThrow();
    expect(() => assertUnionBudget([compileWireSchema(objectWithOptionals(17))])).toThrow(UnionBudgetError);

    const schemas = [compileWireSchema(objectWithOptionals(8)), compileWireSchema(objectWithOptionals(9))];
    let caught: unknown;
    try {
      assertUnionBudget(schemas);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UnionBudgetError);
    const err = caught as UnionBudgetError;
    expect(err.counts).toStrictEqual([8, 9]);
    expect(err.total).toBe(17);
    expect(err.message).toContain("17");
    expect(err.message).toContain("#0: 8");
    expect(err.message).toContain("#1: 9");
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
  });

  it("normalize falls back to the union branch with the fewest issues when none parses", () => {
    const { normalize } = compileWireSchema(
      z.union([
        z.object({ n: z.number(), m: z.number(), tag: z.string().nullable() }),
        z.object({ s: z.string(), extra: z.number(), tag: z.string().optional() }),
      ]),
    );
    expect(normalize({ s: "x", tag: null })).toStrictEqual({ s: "x" });
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
