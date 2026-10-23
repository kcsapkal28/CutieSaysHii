import { JSDOM } from "jsdom";
import { chromium } from "playwright";
import { goldenChoices, resolveTheme } from "@deckforge/catalog";
import { loadCatalog } from "@deckforge/catalog/node";
import type { ThemeSpec } from "@deckforge/schemas";
import { beforeAll, describe, expect, it } from "vitest";
import { diagramKey } from "../src/blocks/render.ts";
import { renderDiagrams } from "../src/diagrams.ts";

const HOSTILE = [
  `graph TD\n A["<img src='http://evil.example/p.png'>"] --> B`,
  `graph TD\n A["<img src=x onerror=alert(1)>"] --> B`,
  `graph TD\n A["<script>alert(1)</script>"] --> B`,
  `graph TD\n A["<svg onload=alert(1)>"] --> B`,
  `graph TD\n A["<iframe src='http://evil.example/'></iframe>"] --> B`,
  `graph TD\n A-->B\n click A href "javascript:alert(1)"`,
  `%%{init: {"themeCSS": ".node{background:url(http://evil.example/p)}"}}%%\ngraph TD\n A-->B`,
  `%%{init: {"themeCSS": "@import url('http://evil.example/x.css');"}}%%\ngraph TD\n A-->B`,
  `graph TD\n A["<span style='background-image:image-set(#quot;http://evil.example/a.png#quot; 1x)'>x</span>"] --> B`,
  `graph TD\n A["<span style='background-image:image-set(&quot;http://evil.example/b.png&quot; 1x)'>x</span>"] --> B`,
  `graph TD\n A["<table background='http://evil.example/c.png'><tr><td>x</td></tr></table>"] --> B`,
  `graph TD\n A["<form action=http://evil.example/f><button>go</button></form>"] --> B`,
];

let theme: ThemeSpec;
let hostileRun: Promise<Map<string, string>> | undefined;
const hostileSvgs = () => (hostileRun ??= renderDiagrams(HOSTILE, theme).then((r) => r.svgs));
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
    const svgs = await hostileSvgs();
    expect(svgs.size).toBe(HOSTILE.length);
    for (const svg of svgs.values()) {
      const doc = new JSDOM(svg).window.document;
      expect(doc.querySelectorAll("script, iframe, img, image, object, embed, link, audio, video, table, form")).toHaveLength(0);
      for (const el of Array.from(doc.querySelectorAll("*"))) {
        for (const attr of Array.from(el.attributes)) {
          const name = attr.name.toLowerCase();
          expect(name.startsWith("on")).toBe(false);
          expect(["src", "srcset", "background", "action", "formaction", "poster", "data", "ping"]).not.toContain(name);
          if (/^(xlink:)?href$/i.test(name)) expect(attr.value.startsWith("#")).toBe(true);
          if (!name.startsWith("xmlns") && name !== "style") expect(attr.value).not.toMatch(/^\s*([a-z][a-z0-9+.-]*:|\/\/)/i);
        }
      }
      expect(svg).not.toMatch(/javascript:/i);
      expect(svg).not.toMatch(/url\(\s*['"]?\s*(?!#)/i);
      expect(svg).not.toMatch(/image-set|@import|@font-face/i);
      expect(svg).not.toMatch(/evil\.example/);
    }
  }, 60_000);

  it("viewing sanitised hostile svg in a browser makes zero requests", async () => {
    const svgs = await hostileSvgs();
    const benign = await renderDiagrams(["graph TD; A[Hello]-->B[World]"], theme);
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const requested: string[] = [];
      page.on("request", (r) => {
        if (!/^(about|data):/.test(r.url())) requested.push(r.url());
      });
      await page.route("**/*", (route) => route.abort());
      const html = `<!doctype html><html><body>${[...svgs.values(), ...benign.svgs.values()].join("")}</body></html>`;
      await page.setContent(html);
      await page.waitForTimeout(500);
      expect(requested).toEqual([]);
      const label = page.locator("svg").last().locator("foreignObject span.nodeLabel");
      expect(await label.allInnerTexts()).toEqual(["Hello", "World"]);
      expect(await label.first().isVisible()).toBe(true);
    } finally {
      await browser.close();
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
