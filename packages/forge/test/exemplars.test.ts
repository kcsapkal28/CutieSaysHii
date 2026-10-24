import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkSlide, readProject } from "../src/index.ts";
import { usedWeights } from "../src/fonts.ts";
import { loadCatalogue, MAX_EXEMPLAR_CHARS, trimExemplar } from "../src/agents/exemplars.ts";

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

  it("teaches every catalogued technique with at least two exemplars from two different decks", () => {
    const thin = catalogue.flatMap((t) => {
      const slides = index.slides.filter((s) => s.techniques.includes(t!));
      const decks = new Set(slides.map((s) => s.theme));
      return slides.length >= 2 && decks.size >= 2 ? [] : [`${t}: ${slides.length} slide(s) from ${decks.size} deck(s)`];
    });
    expect(thin).toEqual([]);
  });

  it("indexes every slide of every exemplar deck, and no deck dominates the library", () => {
    for (const d of index.decks) {
      const ids = readProject(join(ROOT, d.dir)).config.slides.map((x) => x.id);
      for (const id of ids) expect(index.slides.map((s) => s.path), `${d.id}/${id}`).toContain(`${d.dir}/slides/${id}.html`);
    }
    const perDeck = index.decks.map((d) => index.slides.filter((s) => s.theme === d.id).length);
    expect(Math.max(...perDeck) / index.slides.length).toBeLessThanOrEqual(0.25);
  });

  it.each(index.slides.map((s) => [s.id, s] as const))("%s keeps its technique core when trimmed for the builder", (_id, s) => {
    const html = readFileSync(join(ROOT, s.path), "utf8");
    const slideId = s.path.match(/(s\d{2})\.html$/)![1]!;
    const trimmed = trimExemplar(html);
    expect(trimmed.length).toBeLessThanOrEqual(MAX_EXEMPLAR_CHARS);
    expect(trimmed).toContain(`<section class="df-slide" id="${slideId}"`);
    expect(trimmed).toContain(`DF.slide("${slideId}"`);
    // The lifecycle survives: after the last elision the script still shows how steps drive the picture.
    const tail = trimmed.slice(Math.max(0, trimmed.lastIndexOf("lines elided")));
    expect(tail).toMatch(/\b(steps?\s*[:(]|enter\s*\(|gsap\.\w+\()/);
    expect(tail).toMatch(/<\/script>\s*$/);
  });
});

describe("technique catalogue", () => {
  const md = readFileSync(join(ROOT, "fixtures/exemplars/TECHNIQUES.md"), "utf8");

  it("stays compact enough to send whole to the arc call", () => {
    expect(md.length).toBeLessThanOrEqual(16_000);
  });

  it("gives every technique a recipe: when, a layout in px, and its common failures", () => {
    const cat = loadCatalogue(join(ROOT, "fixtures/exemplars"))!;
    expect([...cat.techniques.keys()].sort()).toEqual([...catalogue].sort());
    for (const [id, entry] of cat.techniques) {
      expect(entry, id).toMatch(/\*\*When:\*\*/);
      expect(entry, id).toMatch(/\*\*Layout:\*\*.*\d+/);
      expect(entry, id).toMatch(/\*\*Pitfalls:\*\*/);
    }
  });
});

describe("font weight detection", () => {
  it("reads font shorthand and canvas font strings", () => {
    expect(usedWeights(["#s01 .t { font: italic 300 150px/1 var(--df-font-display) }"])).toContain(300);
    expect(usedWeights(['ctx.font = "600 22px Inter"'])).toContain(600);
    expect(usedWeights(["#s01 .t { font-weight: 200 }"])).toContain(200);
  });
});
