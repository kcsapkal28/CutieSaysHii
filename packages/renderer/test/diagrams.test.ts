import { createRequire } from "node:module";
import { JSDOM } from "jsdom";
import { chromium, type Page } from "playwright";
import { goldenChoices, resolveTheme } from "@deckforge/catalog";
import { loadCatalog } from "@deckforge/catalog/node";
import type { ThemeSpec } from "@deckforge/schemas";
import { beforeAll, describe, expect, it } from "vitest";
import { diagramKey } from "../src/blocks/render.ts";
import { bundleDiagramPage } from "../src/bundle.ts";
import { mermaidConfig, renderDiagrams } from "../src/diagrams.ts";

// url(http://evil.example/escN.png) written with CSS escapes, each backslash re-escaped N-1 more times.
function escapeLayers(n: number): string {
  let css = "\\75 rl(\\68 ttp\\3a \\2f \\2f evil.example/esc" + n + ".png)";
  for (let i = 1; i < n; i++) css = css.replaceAll("\\", "\\5c ");
  return css;
}

type SanitiserGlobal = { deckforgeDiagrams: { sanitiseSvg: (s: string) => string } };

const spanStyle = (css: string) => `graph TD\n A["<span style='${css}'>x</span>"] --> B`;

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
  // Once a value is judged safe it must be emitted unchanged, so stripping `<` can never mint a url(.
  spanStyle("background:u&lt;rl(h&lt;ttp:evil.example/lt.png)"),
  spanStyle("background:u&lt;rl(h&lt;ttps:evil.example/lts.png)"),
  spanStyle("background:ur&lt;l(h&lt;ttp:evil.example/lt6.png)"),
  spanStyle("background-image:image&lt;-set(h&lt;ttp:evil.example/lt7.png 1x)"),
  spanStyle("background:url(http:evil.example/a.png)"),
  spanStyle("background:url(data:image/gif,x)"),
  ...[1, 2, 3, 4, 5].flatMap((n) => [
    `graph TD\n A["<span style='background:${escapeLayers(n)}'>x</span>"] --> B`,
    `graph TD\n A["<style>.x{background:${escapeLayers(n)}}</style>y"] --> B`,
  ]),
];

const BENIGN = {
  flowchart: "graph TD\n A[Hello] -->|yes| B{World}\n B --> C((End))\n subgraph S\n D[x]-->E[y]\n end",
  sequence: "sequenceDiagram\n participant Alice\n participant Bob\n Alice->>Bob: Hello\n Bob-->>Alice: Hi\n Note over Alice,Bob: note",
  class: "classDiagram\n class Animal{\n +String name\n +eat()\n }\n class Dog\n Animal <|-- Dog",
};

const styleTexts = (svg: string) =>
  Array.from(new JSDOM(svg).window.document.querySelectorAll("style"), (el) => el.textContent ?? "");
const ruleCount = (svg: string) => styleTexts(svg).join("").split("}").length - 1;

async function withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route("**/*", (route) => route.abort());
    await page.setContent("<!doctype html><html><body></body></html>");
    return await fn(page);
  } finally {
    await browser.close();
  }
}

// Fed straight to the sanitiser: mermaid would strip most of this itself, so it reaches the CSS path directly.
const RAW_HOSTILE_SVG = [
  `<svg><style>.a{background:u&lt;rl(h&lt;ttp:evil.example/s1.png)}</style><rect class="a"/></svg>`,
  `<svg><style>.a{background:url(http:evil.example/s2.png)}</style><rect class="a"/></svg>`,
  `<svg><style>@import "http://evil.example/s3.css";@import 'h&lt;ttp:evil.example/s4.css';</style></svg>`,
  `<svg><style>@font-face{font-family:x;src:url(http:evil.example/s5.woff)}.a{font-family:x}</style><text class="a">x</text></svg>`,
  `<svg><foreignObject><div><style>.b{background:url(https:evil.example/s6.png)}</style><span class="b">x</span></div></foreignObject></svg>`,
  `<svg><rect fill="url(http:evil.example/s7.svg#a)" filter="u&lt;rl(http:evil.example/s8.svg#f)" style="fill:url(data:image/gif,x)"/></svg>`,
  `<svg><style>.c{background:image-set("h&lt;ttp:evil.example/s9.png" 1x)}.d{background:u/**/rl(http:evil.example/s10.png)}</style><rect class="c d"/></svg>`,
  `<svg><style>.e{content:"a;}.f{background:url(http:evil.example/s11.png)}"}</style><rect class="e f"/></svg>`,
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

  // The deck sizes the diagram to its region, and node labels (text colour) sit on surface, the AA-checked pair.
  it("svg has no fixed max-width and nodes are filled with the surface colour", async () => {
    const source = "graph LR; A[Sunlight]-->B[Current]";
    const svg = (await renderDiagrams([source], theme)).svgs.get(diagramKey(source)) ?? "";
    const root = new JSDOM(svg).window.document.querySelector("svg");
    expect(root?.getAttribute("style") ?? "").not.toMatch(/max-width/);
    expect(svg.toLowerCase()).toMatch(new RegExp(`\\.node rect[^{]*\\{[^}]*fill:${theme.roles.surface.toLowerCase()}`));
  }, 60_000);

  // Dropping max-width removes that one root declaration verbatim; nothing kept is rewritten.
  it("only the root svg's max-width declaration is dropped and the rest is emitted unchanged", async () => {
    const raw =
      `<svg style="max-width: 120px; background-color: white;"><foreignObject>` +
      `<div style="max-width: 200px; text-align: center;">x</div></foreignObject></svg>`;
    const out = await withPage(async (page) => {
      await page.addScriptTag({ content: await bundleDiagramPage() });
      return page.evaluate((svg) => (globalThis as unknown as SanitiserGlobal).deckforgeDiagrams.sanitiseSvg(svg), raw);
    });
    const doc = new JSDOM(out).window.document;
    expect(doc.querySelector("svg")?.getAttribute("style")).toBe("; background-color: white;");
    expect(doc.querySelector("div")?.getAttribute("style")).toBe("max-width: 200px; text-align: center;");
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
      for (const el of Array.from(doc.querySelectorAll("[style], style"))) {
        expect(el.getAttribute("style") ?? "").not.toContain("\\");
        if (el.localName === "style") expect(el.textContent ?? "").not.toContain("\\");
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

  it("re-sanitising any emitted svg is a no-op", async () => {
    const svgs = [...(await hostileSvgs()).values(), ...(await renderDiagrams(Object.values(BENIGN), theme)).svgs.values()];
    const again = await withPage(async (page) => {
      await page.addScriptTag({ content: await bundleDiagramPage() });
      return page.evaluate(
        (list) => list.map((svg) => (globalThis as unknown as SanitiserGlobal).deckforgeDiagrams.sanitiseSvg(svg)),
        svgs,
      );
    });
    expect(again).toEqual(svgs);
  }, 60_000);

  it("the sanitiser itself drops hostile css and stays idempotent", async () => {
    await withPage(async (page) => {
      const requested: string[] = [];
      page.on("request", (r) => {
        if (!/^(about|data):/.test(r.url())) requested.push(r.url());
      });
      await page.addScriptTag({ content: await bundleDiagramPage() });
      const { once, twice } = await page.evaluate((list) => {
        const sanitise = (globalThis as unknown as SanitiserGlobal).deckforgeDiagrams.sanitiseSvg;
        const once = list.map(sanitise);
        return { once, twice: once.map(sanitise) };
      }, RAW_HOSTILE_SVG);
      expect(twice).toEqual(once);
      for (const svg of once) {
        expect(svg.startsWith("<svg")).toBe(true);
        expect(svg).not.toMatch(/evil\.example|url\(\s*['"]?\s*(?!#)|@import|@font-face|image-set/i);
      }
      await page.setContent(`<!doctype html><html><body>${once.join("")}</body></html>`);
      await page.waitForTimeout(500);
      expect(requested).toEqual([]);
    });
  }, 60_000);

  it("benign diagrams keep mermaid's style rules and visible labels", async () => {
    const sources = Object.values(BENIGN);
    const { svgs, warnings } = await renderDiagrams(sources, theme);
    expect(warnings).toEqual([]);
    const raw = await withPage(async (page) => {
      await page.addScriptTag({ path: createRequire(import.meta.url).resolve("mermaid/dist/mermaid.min.js") });
      return page.evaluate(
        async ({ config, jobs }) => {
          const m = (globalThis as unknown as {
            mermaid: { initialize(c: unknown): void; render(id: string, s: string): Promise<{ svg: string }> };
          }).mermaid;
          m.initialize(config);
          const out: string[] = [];
          for (const [id, source] of jobs) out.push((await m.render(id, source)).svg);
          return out;
        },
        { config: mermaidConfig(theme), jobs: sources.map((s) => [`d-${diagramKey(s)}`, s] as [string, string]) },
      );
    });
    sources.forEach((source, i) => {
      const clean = svgs.get(diagramKey(source)) ?? "";
      expect(ruleCount(raw[i] ?? "")).toBeGreaterThan(50);
      expect(ruleCount(clean)).toBe(ruleCount(raw[i] ?? ""));
      expect(styleTexts(clean)).toEqual(styleTexts(raw[i] ?? ""));
    });
    await withPage(async (page) => {
      await page.setContent(`<!doctype html><html><body>${svgs.get(diagramKey(BENIGN.flowchart))}</body></html>`);
      const hello = page.getByText("Hello", { exact: true });
      const world = page.getByText("World", { exact: true });
      expect(await hello.isVisible()).toBe(true);
      expect(await world.isVisible()).toBe(true);
    });
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
