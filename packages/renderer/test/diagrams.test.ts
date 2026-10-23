import { JSDOM } from "jsdom";
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

  it("hostile diagrams never yield active or network-reaching svg", async () => {
    const hostile = [
      `graph TD\n A["<img src='http://evil.example/p.png'>"] --> B`,
      `graph TD\n A["<img src=x onerror=alert(1)>"] --> B`,
      `graph TD\n A["<script>alert(1)</script>"] --> B`,
      `graph TD\n A["<svg onload=alert(1)>"] --> B`,
      `graph TD\n A["<iframe src='http://evil.example/'></iframe>"] --> B`,
      `graph TD\n A-->B\n click A href "javascript:alert(1)"`,
      `%%{init: {"themeCSS": ".node{background:url(http://evil.example/p)}"}}%%\ngraph TD\n A-->B`,
      `%%{init: {"themeCSS": "@import url('http://evil.example/x.css');"}}%%\ngraph TD\n A-->B`,
    ];
    const { svgs } = await renderDiagrams(hostile, theme);
    for (const svg of svgs.values()) {
      const doc = new JSDOM(svg).window.document;
      expect(doc.querySelectorAll("script, iframe, img, image, object, embed, link, audio, video")).toHaveLength(0);
      for (const el of Array.from(doc.querySelectorAll("*"))) {
        for (const attr of Array.from(el.attributes)) {
          expect(attr.name.toLowerCase().startsWith("on")).toBe(false);
          expect(attr.name.toLowerCase()).not.toBe("src");
          if (/^(xlink:)?href$/i.test(attr.name)) expect(attr.value.startsWith("#")).toBe(true);
        }
      }
      expect(svg).not.toMatch(/javascript:/i);
      expect(svg).not.toMatch(/url\(\s*['"]?\s*(?!#)/i);
      expect(svg).not.toMatch(/@import/i);
      expect(svg).not.toMatch(/evil\.example/);
    }
  }, 60_000);

  it("a rendered svg still carries the theme colours", async () => {
    const { svgs } = await renderDiagrams(["graph TD; A-->B"], theme);
    expect([...svgs.values()][0]?.toLowerCase()).toContain(theme.roles.primary.toLowerCase());
  }, 60_000);

  it("a diagram that exceeds the timeout becomes a warning, not a hang", async () => {
    const source = "graph TD; A-->B";
    const { svgs, warnings } = await renderDiagrams([source], theme, { timeoutMs: 1 });
    expect(svgs.size).toBe(0);
    expect(warnings).toEqual([`diagram ${diagramKey(source)}: timed out`]);
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
