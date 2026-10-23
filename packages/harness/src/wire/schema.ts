import { z } from "zod";

export type JsonSchema = Record<string, unknown>;

// unionParamCount: the anyOf nodes in jsonSchema, counting every inlined copy. Strict tool use caps
// these across all tools of one request; the walk never emits type arrays.
export type CompiledWire = { jsonSchema: JsonSchema; normalize(raw: unknown): unknown; unionParamCount: number };

export const UNION_PARAM_LIMIT = 16;

export class UnsupportedSchemaError extends Error {
  readonly path: string;
  readonly typeName: string;

  constructor(path: string, typeName: string, reason?: string) {
    super(`unsupported zod type ${typeName} at ${path}${reason ? `: ${reason}` : ""}`);
    this.name = "UnsupportedSchemaError";
    this.path = path;
    this.typeName = typeName;
  }
}

export class UnionBudgetError extends Error {
  readonly counts: number[];
  readonly total: number;

  constructor(counts: number[]) {
    const total = counts.reduce((sum, n) => sum + n, 0);
    const each = counts.map((n, i) => `#${i}: ${n}`).join(", ");
    super(`strict tool schemas use ${total} union-typed parameters, over the limit of ${UNION_PARAM_LIMIT} (${each})`);
    this.name = "UnionBudgetError";
    this.counts = counts;
    this.total = total;
  }
}

export function assertUnionBudget(schemas: CompiledWire[]): void {
  const counts = schemas.map((s) => s.unionParamCount);
  if (counts.reduce((sum, n) => sum + n, 0) > UNION_PARAM_LIMIT) throw new UnionBudgetError(counts);
}

const Kind = z.ZodFirstPartyTypeKind;
const identity = (raw: unknown): unknown => raw;

// One walk yields the strict tool schema, the normaliser and the union count. Strict tool use
// requires every key, so optional fields arrive as null and normalize deletes them; nullable
// fields keep their null.
export function compileWireSchema(schema: z.ZodTypeAny): CompiledWire {
  return compile(schema, "$");
}

function compile(schema: z.ZodTypeAny, path: string): CompiledWire {
  const typeName = typeNameOf(schema);
  switch (typeName) {
    case Kind.ZodObject:
      return compileObject(schema as z.AnyZodObject, path);
    case Kind.ZodOptional: {
      const inner = compileNullableInner((schema as z.ZodOptional<z.ZodTypeAny>).unwrap(), path, typeName);
      return orNull(inner, (raw) => (raw === null ? undefined : inner.normalize(raw)));
    }
    case Kind.ZodNullable: {
      const inner = compileNullableInner((schema as z.ZodNullable<z.ZodTypeAny>).unwrap(), path, typeName);
      return orNull(inner, (raw) => (raw === null ? null : inner.normalize(raw)));
    }
    case Kind.ZodString:
      return leaf({ type: "string" });
    case Kind.ZodNumber: {
      const isInt = (schema as z.ZodNumber)._def.checks.some((check) => check.kind === "int");
      return leaf({ type: isInt ? "integer" : "number" });
    }
    case Kind.ZodBoolean:
      return leaf({ type: "boolean" });
    case Kind.ZodLiteral: {
      const value: unknown = (schema as z.ZodLiteral<unknown>).value;
      if (!["string", "number", "boolean"].includes(typeof value)) {
        throw new UnsupportedSchemaError(path, typeName, `literal ${String(value)} is not a JSON const`);
      }
      return leaf({ const: value });
    }
    case Kind.ZodEnum:
      return leaf({ type: "string", enum: [...(schema as z.ZodEnum<[string, ...string[]]>).options] });
    case Kind.ZodDiscriminatedUnion:
      return compileDiscriminatedUnion(schema as z.ZodDiscriminatedUnion<string, z.AnyZodObject[]>, path);
    case Kind.ZodUnion:
      return compileUnion((schema as z.ZodUnion<[z.ZodTypeAny, ...z.ZodTypeAny[]]>).options, path);
    case Kind.ZodArray:
      return compileArray((schema as z.ZodArray<z.ZodTypeAny>).element, `${path}[]`);
    case Kind.ZodEffects: {
      const effects = schema as z.ZodEffects<z.ZodTypeAny>;
      if (effects._def.effect.type === "preprocess") {
        throw new UnsupportedSchemaError(path, typeName, "preprocess changes the input before the wire schema applies");
      }
      return compile(effects.innerType(), path);
    }
    default:
      throw new UnsupportedSchemaError(path, typeName ?? schema.constructor.name);
  }
}

// Optional and nullable each add one null branch; stacking them (nullish) would lose which one applies.
function compileNullableInner(inner: z.ZodTypeAny, path: string, outer: string): CompiledWire {
  const innerName = typeNameOf(unwrapEffects(inner));
  if (innerName === Kind.ZodOptional || innerName === Kind.ZodNullable) {
    throw new UnsupportedSchemaError(path, outer, `${outer} of ${innerName} (nullish) is not supported`);
  }
  return compile(inner, path);
}

function compileArray(element: z.ZodTypeAny, path: string): CompiledWire {
  if (typeNameOf(unwrapEffects(element)) === Kind.ZodOptional) {
    throw new UnsupportedSchemaError(path, Kind.ZodOptional, "array items cannot be optional");
  }
  const items = compile(element, path);
  return {
    jsonSchema: { type: "array", items: items.jsonSchema },
    normalize: (raw) => (Array.isArray(raw) ? raw.map((item) => items.normalize(item)) : raw),
    unionParamCount: items.unionParamCount,
  };
}

function compileObject(schema: z.AnyZodObject, path: string): CompiledWire {
  const fields = new Map<string, CompiledWire>();
  for (const [key, field] of Object.entries(schema.shape as z.ZodRawShape)) {
    fields.set(key, compile(field, `${path}.${key}`));
  }
  return {
    jsonSchema: {
      type: "object",
      properties: Object.fromEntries([...fields].map(([key, field]) => [key, field.jsonSchema])),
      required: [...fields.keys()],
      additionalProperties: false,
    },
    normalize: (raw) => {
      if (!isPlainRecord(raw)) return raw;
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(raw)) {
        const field = fields.get(key);
        const normalized = field ? field.normalize(value) : value;
        if (normalized !== undefined) {
          // defineProperty, so an own "__proto__" key in model output stays data, not a prototype.
          Object.defineProperty(out, key, { value: normalized, enumerable: true, writable: true, configurable: true });
        }
      }
      return out;
    },
    unionParamCount: sumCounts([...fields.values()]),
  };
}

function compileDiscriminatedUnion(schema: z.ZodDiscriminatedUnion<string, z.AnyZodObject[]>, path: string): CompiledWire {
  const branches = new Map<z.ZodTypeAny, CompiledWire>();
  for (const option of schema.options) branches.set(option, compile(option, path));
  return {
    jsonSchema: { anyOf: [...branches.values()].map((branch) => branch.jsonSchema) },
    normalize: (raw) => {
      if (!isPlainRecord(raw)) return raw;
      const option = schema.optionsMap.get(raw[schema.discriminator] as z.Primitive);
      const branch = option && branches.get(option);
      return branch ? branch.normalize(raw) : raw;
    },
    unionParamCount: 1 + sumCounts([...branches.values()]),
  };
}

// No branch parsing → the branch with the fewest issues, so retry feedback isn't polluted by nulls
// that only another branch's normalisation would have removed.
function compileUnion(options: readonly z.ZodTypeAny[], path: string): CompiledWire {
  const branches = options.map((option) => ({ schema: option, wire: compile(option, path) }));
  return {
    jsonSchema: { anyOf: branches.map((branch) => branch.wire.jsonSchema) },
    normalize: (raw) => {
      let best: { value: unknown; issues: number } | undefined;
      for (const branch of branches) {
        const value = branch.wire.normalize(raw);
        const result = branch.schema.safeParse(value);
        if (result.success) return value;
        if (!best || result.error.issues.length < best.issues) best = { value, issues: result.error.issues.length };
      }
      return best ? best.value : raw;
    },
    unionParamCount: 1 + sumCounts(branches.map((branch) => branch.wire)),
  };
}

function orNull(inner: CompiledWire, normalize: (raw: unknown) => unknown): CompiledWire {
  const NULL = { type: "null" };
  const anyOf = inner.jsonSchema.anyOf;
  if (Array.isArray(anyOf)) {
    return { jsonSchema: { ...inner.jsonSchema, anyOf: [...anyOf, NULL] }, normalize, unionParamCount: inner.unionParamCount };
  }
  return { jsonSchema: { anyOf: [inner.jsonSchema, NULL] }, normalize, unionParamCount: inner.unionParamCount + 1 };
}

function leaf(jsonSchema: JsonSchema): CompiledWire {
  return { jsonSchema, normalize: identity, unionParamCount: 0 };
}

function sumCounts(wires: CompiledWire[]): number {
  return wires.reduce((sum, wire) => sum + wire.unionParamCount, 0);
}

function typeNameOf(schema: z.ZodTypeAny): string | undefined {
  return (schema._def as { typeName?: string }).typeName;
}

function unwrapEffects(schema: z.ZodTypeAny): z.ZodTypeAny {
  return typeNameOf(schema) === Kind.ZodEffects ? unwrapEffects((schema as z.ZodEffects<z.ZodTypeAny>).innerType()) : schema;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
