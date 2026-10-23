import { createHash } from "node:crypto";
import { sha256Hex } from "@deckforge/renderer/hash";
import { describe, expect, it } from "vitest";

describe("@deckforge/renderer/hash", () => {
  it("hash subpath matches node:crypto", () => {
    for (const input of ["", "abc", "é漢😀", "x".repeat(55), "y".repeat(56), "z".repeat(1000)]) {
      expect(sha256Hex(input)).toBe(createHash("sha256").update(input, "utf8").digest("hex"));
    }
  });
});
