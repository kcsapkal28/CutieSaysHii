// Minimal Zod (v3 API) → JSON Schema for tool input schemas. Covers the shapes the agent schemas use;
// refinements are enforced by Zod after the call (and fed back on failure), not by the schema.
import { z } from "zod";

type Json = Record<string, unknown>;

export function toJsonSchema(schema: z.ZodTypeAny): Json {
  const out = convert(schema);
  return out.type === "object" ? out : { type: "object", properties: { value: out }, required: ["value"] };
}

function convert(s: z.ZodTypeAny): Json {
  const desc = s.description ? { description: s.description } : {};
  const def = s._def as { typeName: z.ZodFirstPartyTypeKind };
  switch (def.typeName) {
    case z.ZodFirstPartyTypeKind.ZodString: {
      const checks = (s as z.ZodString)._def.checks;
      const regex = checks.find((c) => c.kind === "regex") as { regex: RegExp } | undefined;
      const min = checks.find((c) => c.kind === "min") as { value: number } | undefined;
      const max = checks.find((c) => c.kind === "max") as { value: number } | undefined;
      return {
        type: "string",
        ...(regex ? { pattern: regex.regex.source } : {}),
        ...(min ? { minLength: min.value } : {}),
        ...(max ? { maxLength: max.value } : {}),
        ...desc,
      };
    }
    case z.ZodFirstPartyTypeKind.ZodNumber: {
      const checks = (s as z.ZodNumber)._def.checks;
      const int = checks.some((c) => c.kind === "int");
      const min = checks.find((c) => c.kind === "min") as { value: number } | undefined;
      const max = checks.find((c) => c.kind === "max") as { value: number } | undefined;
      return { type: int ? "integer" : "number", ...(min ? { minimum: min.value } : {}), ...(max ? { maximum: max.value } : {}), ...desc };
    }
    case z.ZodFirstPartyTypeKind.ZodBoolean:
      return { type: "boolean", ...desc };
    case z.ZodFirstPartyTypeKind.ZodLiteral: {
      const v = (s as z.ZodLiteral<unknown>).value;
      return { type: typeof v, const: v, ...desc };
    }
    case z.ZodFirstPartyTypeKind.ZodEnum:
      return { type: "string", enum: (s as z.ZodEnum<[string, ...string[]]>).options, ...desc };
    case z.ZodFirstPartyTypeKind.ZodArray: {
      const a = (s as z.ZodArray<z.ZodTypeAny>)._def;
      return {
        type: "array",
        items: convert(a.type),
        ...(a.minLength ? { minItems: a.minLength.value } : {}),
        ...(a.maxLength ? { maxItems: a.maxLength.value } : {}),
        ...desc,
      };
    }
    case z.ZodFirstPartyTypeKind.ZodObject: {
      const shape = (s as z.ZodObject<z.ZodRawShape>).shape;
      const properties: Json = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = convert(value);
        if (!value.isOptional()) required.push(key);
      }
      return { type: "object", properties, required, additionalProperties: false, ...desc };
    }
    case z.ZodFirstPartyTypeKind.ZodUnion: {
      const options = (s as z.ZodUnion<[z.ZodTypeAny, ...z.ZodTypeAny[]]>).options as z.ZodTypeAny[];
      const literals = options.every((o) => o instanceof z.ZodLiteral);
      if (literals) {
        const values = options.map((o) => (o as z.ZodLiteral<unknown>).value);
        return { type: typeof values[0], enum: values, ...desc };
      }
      return { anyOf: options.map(convert), ...desc };
    }
    case z.ZodFirstPartyTypeKind.ZodOptional:
    case z.ZodFirstPartyTypeKind.ZodNullable:
      return { ...convert((s as z.ZodOptional<z.ZodTypeAny>).unwrap()), ...desc };
    case z.ZodFirstPartyTypeKind.ZodDefault:
      return { ...convert((s as z.ZodDefault<z.ZodTypeAny>).removeDefault()), ...desc };
    case z.ZodFirstPartyTypeKind.ZodEffects:
      return { ...convert((s as z.ZodEffects<z.ZodTypeAny>).innerType()), ...desc };
    case z.ZodFirstPartyTypeKind.ZodRecord:
      return { type: "object", additionalProperties: convert((s as z.ZodRecord).valueSchema), ...desc };
    default:
      return { ...desc };
  }
}
