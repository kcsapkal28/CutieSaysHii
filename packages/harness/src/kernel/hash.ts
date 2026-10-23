import { sha256Hex } from "@deckforge/renderer/hash";

/** JSON.stringify semantics with object keys sorted at every level, so equal values hash equally. */
export function canonicalJson(value: unknown): string {
  const out = encode(value);
  if (out === undefined) throw new TypeError(`cannot canonicalise ${typeof value}`);
  return out;
}

function encode(value: unknown): string | undefined {
  const v = hasToJson(value) ? value.toJSON() : value;
  if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") return JSON.stringify(v);
  if (typeof v === "bigint") throw new TypeError("cannot canonicalise bigint");
  if (typeof v !== "object") return undefined;
  if (Array.isArray(v)) return `[${v.map((item) => encode(item) ?? "null").join(",")}]`;
  const record = v as Record<string, unknown>;
  const fields = Object.keys(record)
    .sort()
    .flatMap((key) => {
      const encoded = encode(record[key]);
      return encoded === undefined ? [] : [`${JSON.stringify(key)}:${encoded}`];
    });
  return `{${fields.join(",")}}`;
}

function hasToJson(v: unknown): v is { toJSON(): unknown } {
  return typeof v === "object" && v !== null && typeof (v as { toJSON?: unknown }).toJSON === "function";
}

export function hashOf(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
