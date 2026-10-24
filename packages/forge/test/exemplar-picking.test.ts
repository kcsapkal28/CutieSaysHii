import { describe, expect, it } from "vitest";
import { catalogueText, exemplarSection, loadCatalogue, loadExemplars, pickExemplars, type Exemplar } from "../src/agents/exemplars.ts";
import { ArcDraft, arcProblems, arcSlides, catalogueIds } from "../src/agents/outliner.ts";
import { Style } from "../src/contract.ts";
import { arcOut, styleOut } from "./fakes.ts";

const ex = (id: string, techniques: string[], deck: string, theme = deck, domain = deck): Exemplar => ({
  id,
  html: `<section>${id}</section>`,
  techniques,
  deck,
  theme,
  domain,
  why: "",
});

describe("exemplar selection by technique", () => {
  it("loads the engine's library and catalogue", () => {
    const all = loadExemplars();
    expect(all.length).toBeGreaterThanOrEqual(10);
    expect(all.every((e) => e.html.includes("df-slide") && e.techniques.length > 0)).toBe(true);
    const cat = loadCatalogue()!;
    expect(cat.techniques.has("parametric-sim")).toBe(true);
    expect(cat.rules).toMatch(/Universal rules/);
    expect(catalogueText()).toMatch(/## `timeline`/);
  });

  it("picks by technique id, spreading ties across decks", () => {
    const all = [ex("a/1", ["parametric-sim"], "a"), ex("a/2", ["parametric-sim"], "a"), ex("b/1", ["parametric-sim", "data-story"], "b"), ex("c/1", ["timeline"], "c")];
    const picks = pickExemplars(all, { explainer: "simulation", technique: "parametric-sim" }).map((e) => e.id);
    expect(picks.slice(0, 2).sort()).toEqual(["a/1", "b/1"]);
    expect(picks).not.toContain("c/1");
  });

  it("falls back to the explainer's usual techniques when the id is unknown, and prefers other looks on ties", () => {
    const all = [ex("dark/1", ["timeline"], "dark", "dark cinematic"), ex("paper/1", ["timeline"], "paper", "editorial paper")];
    const picks = pickExemplars(all, { explainer: "timeline", technique: "something-new" }, { avoid: "Warm editorial paper ground" });
    expect(picks[0]!.id).toBe("dark/1");
  });

  it("never offers a key-takeaways card grid unless asked", () => {
    const all = [ex("x/1", ["key-takeaways"], "x"), ex("y/1", ["comparison"], "y"), ex("z/1", ["data-story"], "z")];
    expect(pickExemplars(all, { explainer: "comparison", technique: "comparison" }).map((e) => e.id)).not.toContain("x/1");
  });

  it("gives the builder the technique guide and tells it not to copy", () => {
    const section = exemplarSection([ex("a/1", ["timeline"], "a")], { explainer: "timeline", technique: "timeline" });
    expect(section).toMatch(/## Technique guide/);
    expect(section).toMatch(/## `timeline`/);
    expect(section).toMatch(/Do not copy their subject, wording, palette, layout or composition/);
  });

  it("the outline's arc must use catalogue technique ids, vary explainers and compositions, and respect the style", () => {
    const ids = catalogueIds();
    expect(ids).toContain("map-geo");
    const arc = ArcDraft.parse(arcOut());
    arc.sections[0]!.slides[0]!.technique = "made-up-technique";
    const style = Style.parse({
      look: "x",
      theme: { colors: styleOut().colors, fonts: styleOut().fonts },
      motion: "rich",
      use3d: true,
      interactivity: 2,
      density: "balanced",
      features: {},
    });
    expect(arcProblems(arcSlides(arc), style, ids).join("\n")).toMatch(/s01: unknown technique id\(s\) made-up-technique/);
    arc.sections[0]!.slides[0]!.technique = "parametric-sim, annotated-labels";
    expect(arcProblems(arcSlides(arc), style, ids)).toEqual([]);

    // Neighbours sharing a composition, and too many interactive kinds for a light deck.
    arc.sections[1]!.slides[0]!.composition = " Hero right,  title left ";
    expect(arcProblems(arcSlides(arc), { ...style, interactivity: 1 }, ids)).toEqual([
      "s02: interactivity is 1 (light); use click, hover or toggle, not slider",
      's01 and s02 share the composition " Hero right,  title left "; vary the layout',
    ]);
  });

  it("the arc varies explainers across a longer deck", () => {
    const style = Style.parse({ look: "x", theme: { colors: styleOut().colors, fonts: styleOut().fonts }, motion: "rich", use3d: true, interactivity: 2, density: "balanced", features: {} });
    const slide = (explainer: string, i: number) => ({ ...arcOut().sections[0]!.slides[0]!, explainer, composition: `layout ${i}` });
    const arc = ArcDraft.parse({ ...arcOut(), sections: [{ name: "A", slides: ["timeline", "timeline", "timeline", "map", "map"].map(slide) }, arcOut().sections[1]] });
    const problems = arcProblems(arcSlides(arc), style);
    expect(problems).toContain("s01–s03: three timeline slides in a row; vary the explainer");
    expect(problems).toHaveLength(1);
  });
});
