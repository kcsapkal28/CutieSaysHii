import { existsSync } from "node:fs";
import { defaultsForFamily, resolveTheme, type Catalog } from "@deckforge/catalog";
import { loadCatalog } from "@deckforge/catalog/node";
import type { ThemeSpec } from "@deckforge/schemas";
import { beforeAll, describe, expect, it } from "vitest";
import { UnsafeThemeValueError } from "../src/theme/compile.ts";
import { fontFaces, fontSlug } from "../src/theme/fonts.ts";

let c: Catalog;
beforeAll(async () => {
  c = await loadCatalog();
});

function themeForType(typeFamilyId: string): ThemeSpec {
  const family = c.styles.families.find((f) => f.allowedTypes.includes(typeFamilyId));
  if (!family) throw new Error(`no style family allows ${typeFamilyId}`);
  return resolveTheme(c, {
    ...defaultsForFamily(c, family.id),
    styleFamilyId: family.id,
    typeFamilyId,
    depth: "standard",
    interactionModeId: "linear",
    threeJs: false,
  });
}

describe("fontSlug", () => {
  it("lowercases and hyphenates whitespace", () => {
    expect(fontSlug("Source Serif 4")).toBe("source-serif-4");
  });
});

describe("fontFaces", () => {
  it("every catalog font and weight resolves to an existing woff2", () => {
    expect(c.types.families.length).toBeGreaterThan(0);
    for (const tf of c.types.families) {
      const theme = themeForType(tf.id);
      const { files } = fontFaces(theme);
      const expected = (["display", "body", "mono"] as const).flatMap((role) =>
        theme.type[role].weights.map((w) => `fonts/${fontSlug(theme.type[role].font)}-${w}.woff2`),
      );
      expect(new Set(files.map((f) => f.to))).toEqual(new Set(expected));
      for (const f of files) expect(existsSync(f.from), `${tf.id}: ${f.from}`).toBe(true);
    }
  });

  it("dedupes a font used twice", () => {
    const base = themeForType(c.types.families[0]!.id);
    const role = { font: base.type.display.font, weights: [400] };
    const theme: ThemeSpec = { ...base, type: { ...base.type, display: role, body: role, mono: role } };
    const { css, files } = fontFaces(theme);
    expect(files).toHaveLength(1);
    expect(css.match(/@font-face/g)).toHaveLength(1);
  });

  it("emits swap font-face rules with relative woff2 urls", () => {
    const theme = themeForType(c.types.families[0]!.id);
    const { css, files } = fontFaces(theme);
    expect(css.match(/@font-face/g)).toHaveLength(files.length);
    expect(css).toContain("font-display: swap");
    for (const f of files) expect(css).toContain(`src: url("${f.to}") format("woff2")`);
    expect(css).not.toContain('url("/');
    expect(css).not.toContain('url("file:');
  });

  const withDisplayFont = (font: string): ThemeSpec => {
    const base = themeForType(c.types.families[0]!.id);
    return { ...base, type: { ...base.type, display: { ...base.type.display, font } } };
  };

  it("rejects a font name that breaks out of the CSS string", () => {
    const hostile = withDisplayFont('x"; } body { color: red } a {"');
    expect(() => fontFaces(hostile)).toThrow(UnsafeThemeValueError);
    try {
      fontFaces(hostile);
    } catch (e) {
      expect((e as UnsafeThemeValueError).field).toBe("type.display.font");
    }
  });

  it("rejects a path-traversal font name", () => {
    expect(() => fontFaces(withDisplayFont("../../foo/bar"))).toThrow(UnsafeThemeValueError);
    expect(() => fontFaces(withDisplayFont(""))).toThrow(UnsafeThemeValueError);
  });
});
