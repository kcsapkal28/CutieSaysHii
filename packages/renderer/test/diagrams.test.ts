import { goldenChoices, resolveTheme } from "@deckforge/catalog";
import { loadCatalog } from "@deckforge/catalog/node";
import type { ThemeSpec } from "@deckforge/schemas";
import { beforeAll, describe, expect, it } from "vitest";
import { diagramKey } from "../src/blocks/render.ts";
import { renderDiagrams } from "../src/diagrams.ts";

let theme: ThemeSpec;
beforeAll(async () => {
  const c = await loadCatalog();
  const choices = goldenChoices(c)[0];
  if (!choices) throw new Error("no golden choices");
  theme = resolveTheme(c, choices);
});

describe("renderDiagrams", () => {
  it("renders a valid flowchart to svg", async () => {
    const source = "graph TD; A-->B";
    const { svgs, warnings } = await renderDiagrams([source], theme);
    expect(warnings).toEqual([]);
    expect(svgs.size).toBe(1);
    expect(svgs.get(diagramKey(source))?.startsWith("<svg")).toBe(true);
  }, 60_000);

  it("invalid mermaid yields a warning, not a throw", async () => {
    const source = "graph TD; A-->";
    const { svgs, warnings } = await renderDiagrams([source], theme);
    expect(svgs.size).toBe(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(new RegExp(`^diagram ${diagramKey(source)}: .+`));
    expect(warnings[0]).not.toContain("\n");
  }, 60_000);

  it("svg contains no script", async () => {
    const { svgs } = await renderDiagrams(["graph TD; A-->B"], theme);
    const svg = [...svgs.values()][0] ?? "";
    expect(svg).not.toMatch(/<script/i);
    expect(svg).not.toMatch(/\son\w+=/i);
  }, 60_000);

  it("empty input launches nothing", async () => {
    const t0 = performance.now();
    const out = await renderDiagrams([], theme);
    expect(performance.now() - t0).toBeLessThan(50);
    expect(out.svgs.size).toBe(0);
    expect(out.warnings).toEqual([]);
  });

  it("same source twice gives one key", async () => {
    const { svgs } = await renderDiagrams(["graph TD; A-->B", "graph TD; A-->B"], theme);
    expect(svgs.size).toBe(1);
  }, 60_000);

  it("keeps good diagrams when a sibling fails", async () => {
    const { svgs, warnings } = await renderDiagrams(["graph TD; A-->", "graph TD; X-->Y"], theme);
    expect(svgs.size).toBe(1);
    expect(warnings).toHaveLength(1);
  }, 60_000);
});
