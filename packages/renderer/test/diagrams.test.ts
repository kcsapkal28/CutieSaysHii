import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { JSDOM } from "jsdom";
import { chromium, type Page } from "playwright";
import { contrastRatio, defaultsForFamily, goldenChoices, resolveTheme, type Catalog } from "@deckforge/catalog";
import { loadCatalog } from "@deckforge/catalog/node";
import type { DeckSpec, ThemeSpec } from "@deckforge/schemas";
import { beforeAll, describe, expect, it } from "vitest";
import { diagramKey } from "../src/blocks/render.ts";
import { bundleDiagramPage } from "../src/bundle.ts";
import { mermaidThemeVariables } from "../src/diagram-theme.ts";
import { mermaidConfig, renderDiagrams, reservedClassNames } from "../src/diagrams.ts";

// url(http://evil.example/escN.png) written with CSS escapes, each backslash re-escaped N-1 more times.
function escapeLayers(n: number): string {
  let css = "\\75 rl(\\68 ttp\\3a \\2f \\2f evil.example/esc" + n + ".png)";
  for (let i = 1; i < n; i++) css = css.replaceAll("\\", "\\5c ");
  return css;
}

type SanitiseOptions = { idPrefix: string; reservedClasses: readonly string[] };
type SanitiserGlobal = { deckforgeDiagrams: { sanitiseSvg: (s: string, o: SanitiseOptions) => string } };

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

// Kinds whose mermaid output depends on Math.random or the clock unless the diagram page pins them.
const RANDOMISED = {
  gantt: "gantt\n title Plan\n dateFormat YYYY-MM-DD\n section Build\n Design :a1, 2024-01-01, 30d\n Ship :after a1, 14d",
  ganttFrontmatter: "---\ntitle: Plan\n---\n%% roadmap\ngantt\n dateFormat YYYY-MM-DD\n section A\n Build :a1, 2024-03-01, 10d",
  gitGraph: "gitGraph\n commit\n branch dev\n checkout dev\n commit\n checkout main\n merge dev\n commit",
  handDrawn: "---\nconfig:\n  look: handDrawn\n---\nflowchart LR\n A[Start] --> B{Check} --> C[End]",
};

const styleTexts = (svg: string) =>
  Array.from(new JSDOM(svg).window.document.querySelectorAll("style"), (el) => el.textContent ?? "");
// Zero-request checks allow only an exact about:blank. Chromium serves data: URLs in the renderer, so Playwright
// never reports them as requests: the html itself is checked for data: instead.
const DATA_URL = /\bdata:/i;

const ruleCount = (svg: string) => styleTexts(svg).join("").split("}").length - 1;

const NAMED_COLOURS: Record<string, string> = {
  white: "#FFFFFF", black: "#000000", grey: "#808080", gray: "#808080", lightgrey: "#D3D3D3", lightgray: "#D3D3D3",
};
const COLOUR = /#([0-9a-f]{3,8})\b|\b(rgb|hsl)a?\(([^)]*)\)|\b(white|black|gr[ae]y|lightgr[ae]y)\b/gi;
const hex6 = (rgb: number[]) => `#${rgb.map((x) => Math.round(Math.min(255, Math.max(0, x))).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
function hslToRgb(h: number, s: number, l: number): number[] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (((n + h / 30) % 12) + 12) % 12;
    return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  };
  return [f(0), f(8), f(4)];
}
/** A CSS colour value (hex, rgb(a), hsl(a) or a few names) as #RRGGBB with alpha dropped. */
function normaliseColour([whole, hex, fn, args, name]: RegExpMatchArray): string {
  if (name) return NAMED_COLOURS[name.toLowerCase()]!;
  if (hex) return `#${(hex.length <= 4 ? [...hex.slice(0, 3)].map((x) => x + x).join("") : hex.slice(0, 6))}`.toUpperCase();
  const n = (args ?? "").split(/[\s,/]+/).filter(Boolean).map(parseFloat);
  if (fn?.toLowerCase() === "rgb") return hex6(n.slice(0, 3));
  if (fn?.toLowerCase() === "hsl") return hex6(hslToRgb(n[0]!, n[1]! / 100, n[2]! / 100));
  throw new Error(`unparsed colour ${whole}`);
}

// Pseudo-classes and elements jsdom cannot match against a static document.
const DYNAMIC = /::?(?:hover|focus(?:-visible|-within)?|active|before|after|marker)\b/g;
/**
 * Every colour in the declarations of an svg's <style> rules. With `paintedOnly`, only rules whose selector
 * matches an element of the svg: Mermaid hard-codes colours for elements this diagram never draws
 * (`.node .katex path`, `[data-look="neo"] … .state-start`). A selector jsdom cannot evaluate counts.
 */
function styleColours(svg: string, paintedOnly: boolean): Set<string> {
  const doc = new JSDOM(svg).window.document;
  const out = new Set<string>();
  for (const [, selector, body] of styleTexts(svg).join("").matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    let used = true;
    if (paintedOnly) {
      try {
        used = doc.querySelector(selector!.replace(DYNAMIC, "").trim()) !== null;
      } catch {
        // kept: fail towards counting it
      }
    }
    if (!used) continue;
    for (const decl of body!.split(";")) {
      const value = decl.slice(decl.indexOf(":") + 1);
      if (decl.includes(":")) for (const m of value.matchAll(COLOUR)) out.add(normaliseColour(m));
    }
  }
  return out;
}

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

let c: Catalog;
let theme: ThemeSpec;
let hostileRun: Promise<Map<string, string>> | undefined;
const hostileSvgs = () => (hostileRun ??= renderDiagrams(HOSTILE, theme).then((r) => r.svgs));
beforeAll(async () => {
  c = await loadCatalog();
  const choices = goldenChoices(c)[0];
  if (!choices) throw new Error("no golden choices");
  theme = resolveTheme(c, choices);
});

/** The family's golden choices with its default type and motion, and optionally another allowed palette. */
function themeFor(familyId: string, paletteId?: string): ThemeSpec {
  const golden = goldenChoices(c).find((g) => g.styleFamilyId === familyId);
  if (!golden) throw new Error(`no golden choices for ${familyId}`);
  return resolveTheme(c, { ...golden, ...defaultsForFamily(c, familyId), ...(paletteId ? { paletteId } : {}) });
}

const combos = () =>
  c.styles.families.flatMap((f) =>
    f.allowedPalettes.map((paletteId) => ({ label: `${f.id} + ${paletteId}`, theme: themeFor(f.id, paletteId) })),
  );

const SIX = [1, 2, 3, 4, 5, 6];
const TWELVE = Array.from({ length: 12 }, (_, n) => n);
const THEMED_KEYS = [
  ...["primary", "secondary", "tertiary"].flatMap((k) => [`${k}Color`, `${k}TextColor`, `${k}BorderColor`]),
  "mainBkg", "nodeBorder", "nodeTextColor",
  "textColor", "titleColor", "lineColor", "background", "edgeLabelBackground",
  "clusterBkg", "clusterBorder", "noteBkgColor", "noteTextColor", "noteBorderColor",
  "actorBkg", "actorBorder", "actorTextColor", "actorLineColor", "signalColor", "signalTextColor",
  "labelBoxBkgColor", "labelBoxBorderColor", "labelTextColor", "loopTextColor",
  ...SIX.map((n) => `pie${n}`),
  "pieStrokeColor", "pieOuterStrokeColor", "pieTitleTextColor", "pieLegendTextColor",
  "pieSectionTextColor", "pieSectionTextSize",
  ...TWELVE.flatMap((n) => [`cScale${n}`, `cScaleLabel${n}`]),
  "fontFamily", "fontSize", "darkMode",
];
const NOT_COLOURS = ["pieSectionTextSize", "fontFamily", "fontSize", "darkMode"];

// Each text colour and the fill Mermaid draws it on.
const TEXT_ON: [string, string][] = [
  ["primaryTextColor", "primaryColor"],
  ["secondaryTextColor", "secondaryColor"],
  ["tertiaryTextColor", "tertiaryColor"],
  ["nodeTextColor", "mainBkg"],
  ["textColor", "background"],
  ["textColor", "edgeLabelBackground"],
  ["titleColor", "background"],
  ["titleColor", "clusterBkg"],
  ["noteTextColor", "noteBkgColor"],
  ["actorTextColor", "actorBkg"],
  ["signalTextColor", "background"],
  ["labelTextColor", "labelBoxBkgColor"],
  ["loopTextColor", "background"],
  ["pieTitleTextColor", "background"],
  ["pieLegendTextColor", "background"],
  ...TWELVE.map((n): [string, string] => [`cScaleLabel${n}`, `cScale${n}`]),
];
const LINES = ["lineColor", "signalColor", "actorLineColor", "nodeBorder", "clusterBorder", ...SIX.map((n) => `pie${n}`)];

describe("mermaidThemeVariables", () => {
  it("mermaid theme variables cover every themed key", () => {
    const vars = mermaidThemeVariables(theme);
    expect(Object.keys(vars).sort()).toEqual([...THEMED_KEYS].sort());
    for (const [key, value] of Object.entries(vars))
      if (!NOT_COLOURS.includes(key)) expect(value, key).toMatch(/^#[0-9A-F]{6}$/);
    expect(vars.fontSize).toBe("28px");
    expect(vars.fontFamily).toBe(`"${theme.type.body.font}", sans-serif`);
  });

  it("every mermaid text pair passes AA and every line 3:1 for every family × allowed palette", () => {
    const failures: string[] = [];
    for (const { label, theme } of combos()) {
      const v = mermaidThemeVariables(theme) as Record<string, string>;
      const ratio = (a: string, b: string) => contrastRatio(v[a]!, v[b]!);
      for (const [fg, bg] of TEXT_ON) if (ratio(fg, bg) < 4.5) failures.push(`${label} ${fg}/${bg} ${ratio(fg, bg).toFixed(2)}`);
      for (const line of LINES) if (ratio(line, "background") < 3) failures.push(`${label} ${line} ${ratio(line, "background").toFixed(2)}`);
      // Wedge labels are drawn only when they pass AA on every wedge; otherwise the legend carries the values.
      const wedge = Math.min(...SIX.map((n) => ratio("pieSectionTextColor", `pie${n}`)));
      const other = v.pieSectionTextColor === v.textColor ? "background" : "textColor";
      const otherWedge = Math.min(...SIX.map((n) => contrastRatio(v[other]!, v[`pie${n}`]!)));
      expect(wedge, label).toBeGreaterThanOrEqual(otherWedge);
      expect(v.pieSectionTextSize, label).toBe(wedge < 4.5 ? "0px" : "24px");
    }
    expect(failures).toEqual([]);
  });

  it("darkMode follows the palette mode", () => {
    const modes = new Set<string>();
    for (const { label, theme } of combos()) {
      expect(mermaidThemeVariables(theme).darkMode, label).toBe(theme.mode === "dark");
      modes.add(theme.mode);
    }
    expect([...modes].sort()).toEqual(["dark", "light"]);
  });

  it("normalises role case and rejects a role that is not a hex", () => {
    const lower = { ...theme, roles: Object.fromEntries(Object.entries(theme.roles).map(([k, v]) => [k, v.toLowerCase()])) };
    const vars = mermaidThemeVariables(lower as ThemeSpec);
    expect(vars).toEqual(mermaidThemeVariables(theme));
    expect(vars.background).toBe(theme.roles.bg.toUpperCase());
    expect(() => mermaidThemeVariables({ ...theme, roles: { ...theme.roles, accent: "red}" } })).toThrow(/roles\.accent/);
  });

  it("mermaidConfig uses the theme variables on Mermaid's base theme", () => {
    const config = mermaidConfig(theme);
    expect(config.theme).toBe("base");
    expect(config.themeVariables).toEqual(mermaidThemeVariables(theme));
  });
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
      return page.evaluate(
        (svg) => (globalThis as unknown as SanitiserGlobal).deckforgeDiagrams.sanitiseSvg(svg, { idPrefix: "d-x", reservedClasses: [] }),
        raw,
      );
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
        if (r.url() !== "about:blank") requested.push(r.url());
      });
      await page.route("**/*", (route) => route.abort());
      const html = `<!doctype html><html><body>${[...svgs.values(), ...benign.svgs.values()].join("")}</body></html>`;
      expect(html).not.toMatch(DATA_URL);
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
    const entries = [...(await hostileSvgs()), ...(await renderDiagrams(Object.values(BENIGN), theme)).svgs];
    const reservedClasses = await reservedClassNames();
    const again = await withPage(async (page) => {
      await page.addScriptTag({ content: await bundleDiagramPage() });
      return page.evaluate(
        ({ list, reservedClasses }) =>
          list.map(([key, svg]) =>
            (globalThis as unknown as SanitiserGlobal).deckforgeDiagrams.sanitiseSvg(svg, { idPrefix: `d-${key}`, reservedClasses }),
          ),
        { list: entries, reservedClasses },
      );
    });
    expect(again).toEqual(entries.map(([, svg]) => svg));
  }, 60_000);

  it("the sanitiser itself drops hostile css and stays idempotent", async () => {
    await withPage(async (page) => {
      const requested: string[] = [];
      page.on("request", (r) => {
        if (r.url() !== "about:blank") requested.push(r.url());
      });
      await page.addScriptTag({ content: await bundleDiagramPage() });
      const reservedClasses = await reservedClassNames();
      const { once, twice } = await page.evaluate(
        ({ list, reservedClasses }) => {
          const { sanitiseSvg } = (globalThis as unknown as SanitiserGlobal).deckforgeDiagrams;
          const sanitise = (svg: string) => sanitiseSvg(svg, { idPrefix: "d-x", reservedClasses });
          const once = list.map(sanitise);
          return { once, twice: once.map(sanitise) };
        },
        { list: RAW_HOSTILE_SVG, reservedClasses },
      );
      expect(twice).toEqual(once);
      for (const svg of once) {
        expect(svg.startsWith("<svg")).toBe(true);
        expect(svg).not.toMatch(/evil\.example|url\(\s*['"]?\s*(?!#)|@import|@font-face|image-set/i);
      }
      const html = `<!doctype html><html><body>${once.join("")}</body></html>`;
      expect(html).not.toMatch(DATA_URL);
      await page.setContent(html);
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

  // Review Focus 5: theme "base" alone leaves clusters, edge labels and notes in Mermaid's light defaults.
  it("a dark-theme flowchart with a cluster and edge label carries no mermaid default colours", async () => {
    const stress = JSON.parse(await readFile(new URL("../fixtures/stress.deck.json", import.meta.url), "utf8")) as DeckSpec;
    const source = stress.slides
      .flatMap((s) => s.body.flatMap((b) => (b.type === "Diagram" ? [b.mermaid] : [])))
      .find((m) => /^flowchart[\s\S]*subgraph[\s\S]*-->\|/.test(m));
    if (!source) throw new Error("stress deck has no flowchart with a cluster and edge label");
    const dark = themeFor("atmospheric");
    expect(dark.mode).toBe("dark");

    const vars = mermaidThemeVariables(dark);
    // Control: only the node, line and background keys this pass started from, which must leak a default.
    const partial = Object.fromEntries(
      ["primaryColor", "primaryBorderColor", "primaryTextColor", "lineColor", "background", "fontFamily"].map((k) => [k, vars[k]]),
    );
    const [rawDefaults, rawPartial] = await withPage(async (page) => {
      await page.addScriptTag({ path: createRequire(import.meta.url).resolve("mermaid/dist/mermaid.min.js") });
      return page.evaluate(
        async ({ src, configs }) => {
          const m = (globalThis as unknown as {
            mermaid: { initialize(c: unknown): void; render(id: string, s: string): Promise<{ svg: string }> };
          }).mermaid;
          const out: string[] = [];
          for (const [i, config] of configs.entries()) {
            m.initialize({ startOnLoad: false, securityLevel: "strict", theme: "base", ...config });
            out.push((await m.render(`d-raw${i}`, src)).svg);
          }
          return out;
        },
        { src: source, configs: [{}, { themeVariables: partial }] },
      );
    });
    const defaults = styleColours(rawDefaults ?? "", false);
    const ours = new Set(Object.values(vars).flatMap((v) => (typeof v === "string" && /^#[0-9A-F]{6}$/.test(v) ? [v] : [])));
    const leaks = (svg: string) => [...styleColours(svg, true)].filter((h) => defaults.has(h) && !ours.has(h));
    expect(defaults.size).toBeGreaterThan(0);
    expect(leaks(rawPartial ?? "")).not.toEqual([]);

    const { svgs, warnings } = await renderDiagrams([source], dark);
    expect(warnings).toEqual([]);
    const svg = svgs.get(diagramKey(source)) ?? "";
    const painted = styleColours(svg, true);
    expect(painted.size).toBeGreaterThan(0);
    expect(leaks(svg)).toEqual([]);
    // Stronger: everything the diagram paints is one of the theme's own colours.
    expect([...painted].filter((h) => !ours.has(h))).toEqual([]);
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

  // Mermaid draws some shapes with seeded randomness (roughjs); a different seed each run would change the svg.
  it("rendering the same diagram twice gives byte-identical svg, whatever its siblings", async () => {
    const sources = [...Object.values(BENIGN), ...Object.values(RANDOMISED)];
    const first = await renderDiagrams(sources, theme);
    const second = await renderDiagrams(sources, theme);
    const alone = await renderDiagrams([BENIGN.class], theme);
    expect(first.svgs.size).toBe(sources.length);
    for (const source of sources) expect(second.svgs.get(diagramKey(source)), source).toBe(first.svgs.get(diagramKey(source)));
    expect(alone.svgs.get(diagramKey(BENIGN.class))).toBe(first.svgs.get(diagramKey(BENIGN.class)));
  }, 60_000);

  // Mermaid draws gantt's today line from the wall clock, so the same source would change from day to day.
  it("gantt charts carry no today marker unless the source sets one", async () => {
    const own = "gantt\n dateFormat YYYY-MM-DD\n todayMarker stroke:#000\n section A\n Build :a1, 2024-01-01, 30d";
    const { svgs, warnings } = await renderDiagrams([RANDOMISED.gantt, RANDOMISED.ganttFrontmatter, own], theme);
    expect(warnings).toEqual([]);
    expect(svgs.get(diagramKey(RANDOMISED.gantt))).not.toMatch(/class="today"/);
    expect(svgs.get(diagramKey(RANDOMISED.ganttFrontmatter))).not.toMatch(/class="today"/);
    expect(svgs.get(diagramKey(own))).toMatch(/class="today"/);
  }, 60_000);

  // Only Mermaid's own directive (todayMarker, whitespace, a value) counts as the author setting the marker.
  it("gantt today-marker detection sees past multi-line directives and tasks named todayMarker…", async () => {
    const task = (name: string) => `gantt\n dateFormat YYYY-MM-DD\n section A\n ${name} :a1, 2024-01-01, 30d`;
    const multiLine = `%%{init: {\n  "gantt": {"barHeight": 30}\n}}%%\n${task("Build")}`;
    const sources = [multiLine, task("todayMarker-review"), task("todayMarkers")];
    const { svgs, warnings } = await renderDiagrams(sources, theme);
    expect(warnings).toEqual([]);
    for (const source of sources) expect(svgs.get(diagramKey(source)), source).not.toMatch(/class="today"/);
  }, 60_000);

  it("a diagram's own init directive cannot switch theme or font size", async () => {
    const plain = "graph TD\n A[One] --> B[Two]";
    const hijack = `%%{init: {"theme": "forest", "fontSize": 8}}%%\n${plain}`;
    const { svgs, warnings } = await renderDiagrams([plain, hijack], theme);
    expect(warnings).toEqual([]);
    const [a, b] = [plain, hijack].map((s) => svgs.get(diagramKey(s)) ?? "");
    expect(styleColours(b!, false)).toEqual(styleColours(a!, false));
    expect(b).toMatch(/font-size:28px/);
  }, 60_000);

  it("a pie whose wedge labels are hidden shows its values in the legend", async () => {
    const source = 'pie title Fate\n  "Electricity" : 22\n  "Heat" : 55';
    const shown = combos().find(({ theme }) => mermaidThemeVariables(theme).pieSectionTextSize === "24px");
    const hidden = combos().find(({ theme }) => mermaidThemeVariables(theme).pieSectionTextSize === "0px");
    if (!shown || !hidden) throw new Error("expected palettes that both show and hide pie wedge labels");
    const legend = async (t: ThemeSpec) => {
      const svg = (await renderDiagrams([source], t)).svgs.get(diagramKey(source)) ?? "";
      return Array.from(new JSDOM(svg).window.document.querySelectorAll(".legend text"), (el) => el.textContent);
    };
    expect(await legend(hidden.theme)).toEqual(["Electricity [22]", "Heat [55]"]);
    expect(await legend(shown.theme)).toEqual(["Electricity", "Heat"]);
  }, 60_000);

  it("keeps good diagrams when a sibling fails", async () => {
    const { svgs, warnings } = await renderDiagrams(["graph TD; A-->", "graph TD; X-->Y"], theme);
    expect(svgs.size).toBe(1);
    expect(warnings).toHaveLength(1);
  }, 60_000);
});
