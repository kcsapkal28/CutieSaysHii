import { describe, expect, it } from "vitest";
import { getPalette, UnknownIdError } from "../src/accessors.ts";
import { loadCatalog } from "../src/load.ts";
import { CatalogError, parseCatalog } from "../src/parse.ts";
import { rawCatalog } from "./helpers.ts";

describe("loadCatalog", () => {
  it("loads the real catalog", async () => {
    const c = await loadCatalog();
    expect(c.styles.families).toHaveLength(8);
    expect(c.palettes.palettes).toHaveLength(14);
    expect(c.types.families).toHaveLength(10);
    expect(c.motion.templates).toHaveLength(6);
    expect(c.interactions.modes).toHaveLength(3);
    expect(c.interactions.components).toHaveLength(12);
    expect(c.slideTypes.types).toHaveLength(16);
  });

  it("rejects a dangling defaultPalette", async () => {
    const raw = await rawCatalog();
    raw.styles.families[0].defaultPalette = "warm-minimalst";
    let err: unknown;
    try {
      parseCatalog(raw);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CatalogError);
    const ce = err as CatalogError;
    expect(ce.file).toBe("design-styles.json");
    expect(ce.issues.some((i) => i.message.includes("warm-minimalst"))).toBe(true);
  });

  it("names the file and JSON path on a schema error", async () => {
    const raw = await rawCatalog();
    raw.palettes.palettes[2].mode = "dim";
    expect(() => parseCatalog(raw)).toThrowError(/palettes\.json[\s\S]*palettes\.2\.mode/);
  });

  it('getPalette throws UnknownIdError for "nope"', async () => {
    const c = await loadCatalog();
    expect(() => getPalette(c, "nope")).toThrow(UnknownIdError);
  });
});
