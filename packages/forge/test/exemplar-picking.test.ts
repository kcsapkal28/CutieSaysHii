import { describe, expect, it } from "vitest";
import { catalogueText, exemplarSection, loadCatalogue, loadExemplars, pickExemplars, type Exemplar } from "../src/agents/exemplars.ts";
import { catalogueIds, storyboardProblems } from "../src/agents/storyboarder.ts";
import { Style } from "../src/contract.ts";
import { Storyboard } from "../src/agents/schemas.ts";
import { storyboardOut, styleOut } from "./fakes.ts";

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

  it("the storyboard must use catalogue technique ids", () => {
    const ids = catalogueIds();
    expect(ids).toContain("map-geo");
    const sb = storyboardOut(["s01", "s02"]);
    sb.slides[0]!.technique = "made-up-technique";
    const style = Style.parse({
      look: "x",
      theme: { colors: styleOut().colors, fonts: styleOut().fonts },
      motion: "rich",
      use3d: true,
      interactivity: 2,
      density: "balanced",
      features: {},
    });
    expect(storyboardProblems(Storyboard.parse(sb), ["s01", "s02"], style, ids).join("\n")).toMatch(/unknown technique id\(s\) made-up-technique/);
    for (const s of sb.slides) s.technique = "parametric-sim, annotated-labels";
    expect(storyboardProblems(Storyboard.parse(sb), ["s01", "s02"], style, ids)).toEqual([]);
  });
});
