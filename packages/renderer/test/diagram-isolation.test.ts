// Diagram markup must not reach into the deck: no Reveal/Tailwind classes, no ids outside the diagram's own
// d-<key> namespace, no data-* hooks the runtime reads, nothing that clobbers globals or slide ids.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";
import { chromium, type Page } from "playwright";
import { defaultsForFamily, resolveMotionPlan, resolveTheme, type Catalog } from "@deckforge/catalog";
import { loadCatalog } from "@deckforge/catalog/node";
import type { DeckSpec, InteractionPlan, ThemeSpec } from "@deckforge/schemas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { diagramKey } from "../src/blocks/render.ts";
import { build } from "../src/build.ts";
import { bundleDiagramPage } from "../src/bundle.ts";
import { compileDeckCss } from "../src/css.ts";
import { renderDiagrams, reservedClassNames, selectorClassNames } from "../src/diagrams.ts";

type SanitiseOptions = { idPrefix: string; reservedClasses: readonly string[] };
type PageGlobal = { deckforgeDiagrams: { sanitiseSvg: (s: string, o: SanitiseOptions) => string } };

const read = async <T>(rel: string) =>
  JSON.parse(await readFile(fileURLToPath(new URL(rel, import.meta.url)), "utf8")) as T;

const HIDDEN = "graph TD\n A[Shown] --> H[Hidden node]\n classDef hidden fill:#eef\n class H hidden";
const FRAGMENT = "graph TD\n A[Frag] --> B[Other]\n class A fragment";
const CLOBBER = `graph TD\n A["<span id=deck class=reveal>x</span>"] --> B`;
const SLIDE_ID = `graph TD\n A["<span id='s15'>y</span>"] --> B`;
const HOOKS =
  `graph TD\n A["<span data-df-final=9 data-motion-el data-region=body tabindex=0 aria-hidden=true name=n>z</span>"] --> B`;

let catalog: Catalog;
let theme: ThemeSpec;
let svgs: Map<string, string>;
const svgOf = (source: string) => {
  const svg = svgs.get(diagramKey(source));
  if (svg === undefined) throw new Error(`no svg for ${source}`);
  return new JSDOM(svg).window.document;
};

beforeAll(async () => {
  catalog = await loadCatalog();
  const d = defaultsForFamily(catalog, "minimal");
  theme = resolveTheme(catalog, {
    depth: "standard",
    styleFamilyId: "minimal",
    paletteId: d.paletteId,
    typeFamilyId: d.typeFamilyId,
    motionTemplateId: "calm",
    interactionModeId: "linear",
    threeJs: false,
  });
  const out = await renderDiagrams([HIDDEN, FRAGMENT, CLOBBER, SLIDE_ID, HOOKS], theme);
  expect(out.warnings).toEqual([]);
  svgs = out.svgs;
}, 120_000);

async function withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route("**/*", (route) => route.abort());
    await page.setContent("<!doctype html><html><body></body></html>");
    await page.addScriptTag({ content: await bundleDiagramPage() });
    return await fn(page);
  } finally {
    await browser.close();
  }
}

const sanitiseInPage = (list: string[], options: SanitiseOptions) =>
  withPage((page) =>
    page.evaluate(
      ({ list, options }) => list.map((s) => (globalThis as unknown as PageGlobal).deckforgeDiagrams.sanitiseSvg(s, options)),
      { list, options },
    ),
  );

describe("reserved class names", () => {
  it("decodes every class a deck.css selector names, and nothing from declarations", () => {
    const css =
      ".hidden{display:none}.w-1\\/4{width:25%}.\\[\\&_p\\]\\:m-0 p{margin:0}" +
      "@media (min-width:40rem){.md\\:flex{display:flex}}.reveal .slides section.present:not(.stack){x:url(a.woff2);y:.5rem}" +
      '.\\31 0x{content:".nope{"}';
    expect(selectorClassNames(css).sort()).toEqual(
      ["10x", "[&_p]:m-0", "hidden", "md:flex", "present", "reveal", "slides", "stack", "w-1/4"].sort(),
    );
  });

  it("covers Reveal's state classes and every utility in the compiled deck.css", async () => {
    const reserved = new Set(await reservedClassNames());
    for (const c of ["fragment", "visible", "current-fragment", "present", "past", "future", "stack", "reveal", "slides"])
      expect(reserved.has(c), c).toBe(true);
    for (const c of ["notes", "controls", "progress", "slide-number", "backgrounds", "hidden", "flex", "w-full"])
      expect(reserved.has(c), c).toBe(true);
    for (const c of selectorClassNames(await compileDeckCss())) expect(reserved.has(c), c).toBe(true);
    // Mermaid's own structural classes stay usable.
    for (const c of ["node", "nodeLabel", "edgeLabel", "label", "cluster", "flowchart-link"]) expect(reserved.has(c), c).toBe(false);
  });
});

describe("rendered diagrams stay out of the deck's namespace", () => {
  it("drops a classDef named after a deck utility", () => {
    const node = svgOf(HIDDEN).querySelector('[id*="-flowchart-H-"]');
    expect(node).not.toBeNull();
    expect(node?.classList.contains("hidden")).toBe(false);
    expect(node?.classList.contains("node")).toBe(true);
  });

  it("drops the fragment token mermaid copied onto the node", () => {
    const doc = svgOf(FRAGMENT);
    expect(doc.querySelectorAll(".fragment")).toHaveLength(0);
    expect(doc.querySelectorAll(".node")).not.toHaveLength(0);
  });

  it("a label <span id=deck class=reveal> loses both", () => {
    const doc = svgOf(CLOBBER);
    expect(doc.getElementById("deck")).toBeNull();
    expect(doc.querySelectorAll(".reveal")).toHaveLength(0);
  });

  it("a label id that matches a slide id is dropped", () => {
    expect(svgOf(SLIDE_ID).getElementById("s15")).toBeNull();
  });

  it("every id kept is in the diagram's own d-<key> namespace", () => {
    for (const [key, svg] of svgs) {
      for (const el of Array.from(new JSDOM(svg).window.document.querySelectorAll("[id]")))
        expect(el.id.startsWith(`d-${key}`), el.id).toBe(true);
    }
  });

  it("no data-*, tabindex, name or aria-hidden survives", () => {
    for (const svg of svgs.values()) {
      for (const el of Array.from(new JSDOM(svg).window.document.querySelectorAll("*"))) {
        for (const attr of Array.from(el.attributes)) {
          expect(attr.name.startsWith("data-"), attr.name).toBe(false);
          expect(["tabindex", "name", "aria-hidden"]).not.toContain(attr.name);
        }
      }
    }
  });
});

describe("the sanitiser's attribute policy", () => {
  const options: SanitiseOptions = { idPrefix: "d-k", reservedClasses: ["hidden", "fragment", "present"] };
  const RAW = [
    `<svg id="d-k"><g id="s15" class="node fragment r-stack df-slide hidden x" data-motion-el="" tabindex="0" name="n" ` +
      `aria-hidden="true" role="img"><text id="d-k-label">t</text></g></svg>`,
    `<svg id="d-k"><foreignObject><div xmlns="http://www.w3.org/1999/xhtml" id="d-k-x" title="t" role="note" ` +
      `class="nodeLabel present hidden" style="color: red;"><span class="fragment">x</span></div></foreignObject></svg>`,
  ];

  it("filters class tokens, foreign ids and runtime hooks, and stays idempotent", async () => {
    const once = await sanitiseInPage(RAW, options);
    const twice = await sanitiseInPage(once, options);
    expect(twice).toEqual(once);

    const svgDoc = new JSDOM(once[0]).window.document;
    const g = svgDoc.querySelector("g");
    expect(g?.getAttribute("id")).toBeNull();
    expect(g?.getAttribute("class")).toBe("node x");
    expect(g?.getAttribute("role")).toBe("img");
    for (const name of ["data-motion-el", "tabindex", "name", "aria-hidden"]) expect(g?.hasAttribute(name), name).toBe(false);
    expect(svgDoc.querySelector("text")?.getAttribute("id")).toBe("d-k-label");
    expect(svgDoc.querySelector("svg")?.getAttribute("id")).toBe("d-k");

    // HTML label content keeps only class, style and xmlns; a class left with no tokens is dropped whole.
    const div = new JSDOM(once[1]).window.document.querySelector("div");
    expect(div?.getAttributeNames().sort()).toEqual(["class", "style", "xmlns"]);
    expect(div?.getAttribute("class")).toBe("nodeLabel");
    expect(div?.getAttribute("style")).toBe("color: red;");
    expect(div?.querySelector("span")?.hasAttribute("class")).toBe(false);
  }, 60_000);

  it("a class value with nothing reserved is emitted unchanged", async () => {
    const raw = `<svg id="d-k"><g class="  node   default "></g></svg>`;
    const [out] = await sanitiseInPage([raw], options);
    expect(new JSDOM(out).window.document.querySelector("g")?.getAttribute("class")).toBe("  node   default ");
  }, 60_000);
});

describe("in a built deck", () => {
  let dir: string;
  beforeAll(async () => {
    const fixture = await read<DeckSpec>("../fixtures/solar.deck.json");
    const deck: DeckSpec = {
      ...fixture,
      slides: fixture.slides.map((s) =>
        s.type === "diagram" ? { ...s, body: s.body.map((b) => (b.type === "Diagram" ? { ...b, mermaid: HIDDEN } : b)) } : s,
      ),
    };
    dir = await mkdtemp(join(tmpdir(), "deckforge-isolation-"));
    await build({
      jobId: "isolation",
      deck,
      theme,
      motion: resolveMotionPlan(catalog, "calm", deck.slides),
      interaction: await read<InteractionPlan>("../fixtures/solar.interaction.json"),
      catalog,
      outDir: dir,
    });
  }, 180_000);
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("a classDef hidden node is still displayed", async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const index = (await read<DeckSpec>("../fixtures/solar.deck.json")).slides.findIndex((s) => s.type === "diagram");
      await page.goto(`${pathToFileURL(join(dir, "index.html")).href}?df-motion=off#/${index}`);
      await page.waitForFunction(() => (window as unknown as { Reveal?: { isReady(): boolean } }).Reveal?.isReady());
      const node = page.locator("section.present .df-diagram g.node", { hasText: "Hidden node" });
      expect(await node.count()).toBe(1);
      expect(await node.evaluate((el) => getComputedStyle(el).display)).not.toBe("none");
      expect(await node.isVisible()).toBe(true);
    } finally {
      await browser.close();
    }
  }, 60_000);
});
