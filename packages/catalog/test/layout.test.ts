import { describe, expect, it } from "vitest";
import { checkLayout } from "../src/layout.ts";
import { loadCatalog } from "../src/load.ts";
import { parseCatalogFiles } from "../src/parse.ts";
import { rawCatalog, type Raw } from "./helpers.ts";

/** Mutates one family's layout and returns the paths of every layout issue. */
async function pathsAfter(familyId: string, mutate: (layout: Raw["styles"]["families"][number]["layout"]) => void) {
  const raw = await rawCatalog();
  const i = raw.styles.families.findIndex((f: { id: string }) => f.id === familyId);
  expect(i).toBeGreaterThanOrEqual(0);
  mutate(raw.styles.families[i].layout);
  const issues = checkLayout(parseCatalogFiles(raw));
  expect(issues.every((x) => x.file === "design-styles.json")).toBe(true);
  return { at: `families.${i}.layout`, paths: issues.map((x) => x.path) };
}

describe("checkLayout", () => {
  it("real catalog has no layout issues", async () => {
    expect(checkLayout(await loadCatalog())).toEqual([]);
  });

  it("flags start ≥ end", async () => {
    const { at, paths } = await pathsAfter("minimal", (l) => (l.grid.body = [9, 9]));
    expect(paths).toEqual([`${at}.grid.body`]);
  });

  it("flags aside outside wide", async () => {
    const { at, paths } = await pathsAfter("atmospheric", (l) => (l.grid.aside = [8, 13]));
    expect(paths).toEqual([`${at}.grid.aside`]);
  });

  it("flags an aside that starts at the wide start", async () => {
    const { at, paths } = await pathsAfter("minimal", (l) => (l.grid.aside = [1, 13]));
    expect(paths).toEqual([`${at}.grid.aside`]);
  });

  it("flags steps.title ≥ steps.display", async () => {
    const { at, paths } = await pathsAfter("minimal", (l) => {
      l.steps.title = 4;
      l.steps.display = 4;
    });
    expect(paths).toEqual([`${at}.steps.title`]);
  });

  it("flags steps.stat ≤ steps.title", async () => {
    const { at, paths } = await pathsAfter("minimal", (l) => {
      l.steps.title = 4;
      l.steps.display = 5;
      l.steps.stat = 4;
    });
    expect(paths).toEqual([`${at}.steps.stat`]);
  });

  it("flags an unknown decorationOn slide type", async () => {
    const { at, paths } = await pathsAfter("swiss", (l) => (l.decorationOn = ["cover"]));
    expect(paths).toEqual([`${at}.decorationOn.0`]);
  });

  it("flags decoration none with a non-empty decorationOn", async () => {
    const { at, paths } = await pathsAfter("minimal", (l) => (l.decorationOn = ["title"]));
    expect(paths).toEqual([`${at}.decorationOn`]);
  });

  it('flags decoration none with decorationOn "all"', async () => {
    const { at, paths } = await pathsAfter("minimal", (l) => (l.decorationOn = "all"));
    expect(paths).toEqual([`${at}.decorationOn`]);
  });

  it("flags a decoration with decorationOn []", async () => {
    const { at, paths } = await pathsAfter("swiss", (l) => (l.decorationOn = []));
    expect(paths).toEqual([`${at}.decorationOn`]);
  });
});
