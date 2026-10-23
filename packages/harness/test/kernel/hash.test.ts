import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJson, hashOf } from "../../src/kernel/hash.ts";

describe("canonicalJson", () => {
  it("sorts keys recursively and is insensitive to insertion order", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: "x" } })).toBe('{"a":{"c":"x","d":[3,{"y":2,"z":1}]},"b":1}');
    expect(canonicalJson({ x: 1, y: 2 })).toBe(canonicalJson({ y: 2, x: 1 }));
  });

  it("follows JSON.stringify for undefined, non-finite numbers, toJSON and primitives", () => {
    expect(canonicalJson({ a: undefined, b: null })).toBe('{"b":null}');
    expect(canonicalJson([undefined, Number.NaN, Infinity])).toBe("[null,null,null]");
    expect(canonicalJson(new Date(0))).toBe('"1970-01-01T00:00:00.000Z"');
    expect(canonicalJson("é\n")).toBe(JSON.stringify("é\n"));
    expect(canonicalJson(true)).toBe("true");
  });

  it("rejects values JSON cannot represent", () => {
    expect(() => canonicalJson(undefined)).toThrow(TypeError);
    expect(() => canonicalJson({ n: 1n })).toThrow(TypeError);
  });
});

describe("hashOf", () => {
  it("hashOf equals node:crypto sha256 of canonicalJson", () => {
    const value = { stage: "content", version: "content.v1", fingerprint: { model: "m", nested: [1, "ü", { b: 2, a: 1 }] } };
    const expected = createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
    expect(hashOf(value)).toBe(expected);
    expect(hashOf(value)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable across key order and changes with content", () => {
    expect(hashOf({ a: 1, b: 2 })).toBe(hashOf({ b: 2, a: 1 }));
    expect(hashOf({ a: 1 })).not.toBe(hashOf({ a: 2 }));
  });
});
