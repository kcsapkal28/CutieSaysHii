import { z } from "zod";

export type JsonSchema = Record<string, unknown>;

export type WireSchema = { jsonSchema: JsonSchema; normalize(raw: unknown): unknown };

export class UnsupportedSchemaError extends Error {
  readonly path: string;
  readonly typeName: string;

  constructor(path: string, typeName: string) {
    super(`unsupported zod type ${typeName} at ${path}`);
    this.name = "UnsupportedSchemaError";
    this.path = path;
    this.typeName = typeName;
  }
}

const Kind = z.ZodFirstPartyTypeKind;
const identity = (raw: unknown): unknown => raw;

// One walk yields the strict tool schema and the normaliser. Strict tool use requires every key,
// so optional fields arrive as null and normalize deletes them; nullable fields keep their null.
export function compileWireSchema(schema: z.ZodTypeAny): WireSchema {
  return compile(schema, "$");
}

function compile(schema: z.ZodTypeAny, path: string): WireSchema {
  const typeName = (schema._def as { typeName?: string }).typeName;
  switch (typeName) {
    case Kind.ZodObject:
      return compileObject(schema as z.AnyZodObject, path);
    case Kind.ZodOptional: {
      const inner = compile((schema as z.ZodOptional<z.ZodTypeAny>).unwrap(), path);
      return { jsonSchema: orNull(inner.jsonSchema), normalize: (raw) => (raw === null ? undefined : inner.normalize(raw)) };
    }
    case Kind.ZodNullable: {
      const inner = compile((schema as z.ZodNullable<z.ZodTypeAny>).unwrap(), path);
      return { jsonSchema: orNull(inner.jsonSchema), normalize: (raw) => (raw === null ? null : inner.normalize(raw)) };
    }
    case Kind.ZodString:
      return leaf({ type: "string" });
    case Kind.ZodNumber: {
      const isInt = (schema as z.ZodNumber)._def.checks.some((check) => check.kind === "int");
      return leaf({ type: isInt ? "integer" : "number" });
    }
    case Kind.ZodBoolean:
      return leaf({ type: "boolean" });
    case Kind.ZodLiteral:
      return leaf({ const: (schema as z.ZodLiteral<unknown>).value });
    case Kind.ZodEnum:
      return leaf({ type: "string", enum: [...(schema as z.ZodEnum<[string, ...string[]]>).options] });
    case Kind.ZodDiscriminatedUnion:
      return compileDiscriminatedUnion(schema as z.ZodDiscriminatedUnion<string, z.AnyZodObject[]>, path);
    case Kind.ZodUnion:
      return compileUnion((schema as z.ZodUnion<[z.ZodTypeAny, ...z.ZodTypeAny[]]>).options, path);
    case Kind.ZodArray: {
      const items = compile((schema as z.ZodArray<z.ZodTypeAny>).element, `${path}[]`);
      return {
        jsonSchema: { type: "array", items: items.jsonSchema },
        normalize: (raw) => (Array.isArray(raw) ? raw.map((item) => items.normalize(item)) : raw),
      };
    }
    case Kind.ZodEffects:
      return compile((schema as z.ZodEffects<z.ZodTypeAny>).innerType(), path);
    default:
      throw new UnsupportedSchemaError(path, typeName ?? schema.constructor.name);
  }
}

function compileObject(schema: z.AnyZodObject, path: string): WireSchema {
  const fields = new Map<string, WireSchema>();
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
  };
}

function compileDiscriminatedUnion(schema: z.ZodDiscriminatedUnion<string, z.AnyZodObject[]>, path: string): WireSchema {
  const branches = new Map<z.ZodTypeAny, WireSchema>();
  for (const option of schema.options) branches.set(option, compile(option, path));
  return {
    jsonSchema: { anyOf: [...branches.values()].map((branch) => branch.jsonSchema) },
    normalize: (raw) => {
      if (!isPlainRecord(raw)) return raw;
      const option = schema.optionsMap.get(raw[schema.discriminator] as z.Primitive);
      const branch = option && branches.get(option);
      return branch ? branch.normalize(raw) : raw;
    },
  };
}

function compileUnion(options: readonly z.ZodTypeAny[], path: string): WireSchema {
  const branches = options.map((option) => ({ schema: option, wire: compile(option, path) }));
  return {
    jsonSchema: { anyOf: branches.map((branch) => branch.wire.jsonSchema) },
    normalize: (raw) => {
      for (const branch of branches) {
        const normalized = branch.wire.normalize(raw);
        if (branch.schema.safeParse(normalized).success) return normalized;
      }
      return raw;
    },
  };
}

function leaf(jsonSchema: JsonSchema): WireSchema {
  return { jsonSchema, normalize: identity };
}

function orNull(jsonSchema: JsonSchema): JsonSchema {
  return { anyOf: [jsonSchema, { type: "null" }] };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
