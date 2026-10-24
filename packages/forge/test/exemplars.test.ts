import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkSlide, readProject } from "../src/index.ts";
import { usedWeights } from "../src/fonts.ts";

const ROOT = new URL("..", import.meta.url).pathname;
type Entry = { id: string; path: string; techniques: string[]; theme: string; whatMakesItGood: string; steps: number };
const index = JSON.parse(readFileSync(join(ROOT, "fixtures/exemplars/index.json"), "utf8")) as {
  decks: { id: string; dir: string }[];
  slides: Entry[];
};
const catalogue = [...readFileSync(join(ROOT, "fixtures/exemplars/TECHNIQUES.md"), "utf8").matchAll(/^## `([a-z0-9-]+)`/gm)].map((m) => m[1]);

describe("exemplar index", () => {
  it("catalogues about 15+ techniques", () => {
    expect(catalogue.length).toBeGreaterThanOrEqual(15);
  });

  it.each(index.slides.map((s) => [s.id, s] as const))("%s is valid, in its deck and uses catalogued techniques", (_id, s) => {
    expect(existsSync(join(ROOT, s.path)), s.path).toBe(true);
    for (const t of s.techniques) expect(catalogue, `technique ${t}`).toContain(t);
    expect(s.whatMakesItGood.length).toBeGreaterThan(60);
    const deck = index.decks.find((d) => d.id === s.theme);
    expect(deck, s.theme).toBeDefined();
    const slideId = s.path.match(/(s\d{2})\.html$/)![1]!;
    expect(readProject(join(ROOT, deck!.dir)).config.slides.map((x) => x.id)).toContain(slideId);
    expect(checkSlide(slideId, readFileSync(join(ROOT, s.path), "utf8")).issues).toEqual([]);
  });

  it("covers at least four themes and ten techniques", () => {
    expect(new Set(index.slides.map((s) => s.theme)).size).toBeGreaterThanOrEqual(4);
    expect(new Set(index.slides.flatMap((s) => s.techniques)).size).toBeGreaterThanOrEqual(10);
  });
});

describe("font weight detection", () => {
  it("reads font shorthand and canvas font strings", () => {
    expect(usedWeights(["#s01 .t { font: italic 300 150px/1 var(--df-font-display) }"])).toContain(300);
    expect(usedWeights(['ctx.font = "600 22px Inter"'])).toContain(600);
    expect(usedWeights(["#s01 .t { font-weight: 200 }"])).toContain(200);
  });
});
