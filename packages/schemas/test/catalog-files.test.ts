import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CompatMatrixFileSchema,
  DesignStylesFileSchema,
  InteractionsFileSchema,
  MotionTemplatesFileSchema,
  PalettesFileSchema,
  SlideTypesFileSchema,
  TypeFamiliesFileSchema,
} from "../src/index.ts";

const read = (file: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../../catalog/${file}`, import.meta.url), "utf8"));

const files = [
  ["design-styles.json", DesignStylesFileSchema],
  ["palettes.json", PalettesFileSchema],
  ["type-families.json", TypeFamiliesFileSchema],
  ["motion-templates.json", MotionTemplatesFileSchema],
  ["interactions.json", InteractionsFileSchema],
  ["slide-types.json", SlideTypesFileSchema],
  ["compat-matrix.json", CompatMatrixFileSchema],
] as const;

describe("catalog file schemas", () => {
  it.each(files)("%s parses with its schema", (file, schema) => {
    const result = schema.safeParse(read(file));
    expect(result.success ? [] : result.error.issues).toEqual([]);
  });

  it("rejects an unknown key on a family", () => {
    const raw = read("design-styles.json") as { families: Record<string, unknown>[] };
    raw.families[0] = { ...raw.families[0], foo: 1 };
    expect(DesignStylesFileSchema.safeParse(raw).success).toBe(false);
  });

  it('rejects palette.mode "dim"', () => {
    const raw = read("palettes.json") as { palettes: Record<string, unknown>[] };
    raw.palettes[0] = { ...raw.palettes[0], mode: "dim" };
    expect(PalettesFileSchema.safeParse(raw).success).toBe(false);
  });
});
