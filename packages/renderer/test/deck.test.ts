import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { defaultsForFamily, resolveMotionPlan, resolveTheme, type Catalog } from "@deckforge/catalog";
import { loadCatalog } from "@deckforge/catalog/node";
import type { Block, DeckSpec, InteractionPlan, Slide } from "@deckforge/schemas";
import { JSDOM } from "jsdom";
import { beforeAll, describe, expect, it } from "vitest";
import { diagramKey } from "../src/blocks/render.ts";
import { renderDeckHtml, RenderError, type RenderInput } from "../src/html/deck.ts";
import { loadTemplates } from "../src/html/templates.ts";

const read = async <T>(rel: string) =>
  JSON.parse(await readFile(fileURLToPath(new URL(rel, import.meta.url)), "utf8")) as T;

let catalog: Catalog;
let fixture: DeckSpec;
let interaction: InteractionPlan;
const templates = loadTemplates();

beforeAll(async () => {
  catalog = await loadCatalog();
  fixture = await read<DeckSpec>("../fixtures/solar.deck.json");
  interaction = await read<InteractionPlan>("../fixtures/solar.interaction.json");
});

function inputFor(deck: DeckSpec, patch: Partial<RenderInput> = {}): RenderInput {
  const d = defaultsForFamily(catalog, "minimal");
  const theme = resolveTheme(catalog, {
    depth: "standard",
    styleFamilyId: "minimal",
    paletteId: d.paletteId,
    typeFamilyId: d.typeFamilyId,
    motionTemplateId: "calm",
    interactionModeId: "linear",
    threeJs: false,
  });
  return {
    deck,
    theme,
    motion: resolveMotionPlan(catalog, "calm", deck.slides),
    interaction: { modeId: "linear", slides: [] },
    catalog,
    templates,
    diagrams: new Map(),
    assets: { css: ["deck.css", "theme.css"], js: ["deck.js"] },
    ...patch,
  };
}

const dom = (html: string) => new JSDOM(html).window.document;
const slideOf = (type: string, body: Block[] = [], extra: Partial<Slide> = {}): Slide => ({
  id: "x1",
  type,
  title: "A title",
  body,
  notes: "notes",
  emphasisTargets: [],
  ...extra,
});
const deckOf = (...slides: Slide[]): DeckSpec => ({ title: "Deck", subtitle: "Sub", slides });

describe("templates", () => {
  it("has a template for every catalog slide type", () => {
    for (const t of catalog.slideTypes.types) expect(templates.has(t.id), t.id).toBe(true);
    expect(templates.size).toBe(catalog.slideTypes.types.length);
  });

  it("every template renders every catalog region", () => {
    for (const t of catalog.slideTypes.types) {
      const { html } = renderDeckHtml(inputFor(deckOf(slideOf(t.id))));
      const doc = dom(html);
      for (const r of t.regions) {
        expect(doc.querySelector(`section[data-slide-type="${t.id}"] [data-region="${r}"]`), `${t.id}:${r}`).not.toBeNull();
      }
    }
  });

  // A slide without a title must not leave an empty heading (and its flex gap) behind.
  it("every title region collapses when empty", () => {
    for (const t of catalog.slideTypes.types.filter((t) => t.regions.includes("title") && !t.regions.includes("meta"))) {
      const { html } = renderDeckHtml(inputFor(deckOf(slideOf(t.id, [], { title: undefined }))));
      const title = dom(html).querySelector(`[data-region="title"]`);
      expect(title?.innerHTML, t.id).toBe("");
      expect(title?.classList.contains("empty:hidden"), t.id).toBe(true);
    }
  });

  // The labels are already visible in every stat; a visually-hidden copy would overflow its 1px box.
  it("stat footer carries the labels but is hidden, not sr-only", () => {
    const stat = { type: "Stat", value: "22%", label: "efficiency" } as Block;
    const { html } = renderDeckHtml(inputFor(deckOf(slideOf("stat", [stat]))));
    const footer = dom(html).querySelector('[data-region="footer"]');
    expect(footer?.textContent).toBe("efficiency");
    expect(footer?.hasAttribute("hidden")).toBe(true);
    expect(footer?.classList.contains("sr-only")).toBe(false);
  });
});

describe("renderDeckHtml on the solar fixture", () => {
  it("renders 15 sections in order with ids s01..s15", () => {
    const { html } = renderDeckHtml(inputFor(fixture, { interaction }));
    const ids = [...dom(html).querySelectorAll(".reveal .slides > section")].map((s) => s.id);
    expect(ids).toEqual(Array.from({ length: 15 }, (_, i) => `s${String(i + 1).padStart(2, "0")}`));
  });

  it("every section has a non-empty aside.notes", () => {
    const { html } = renderDeckHtml(inputFor(fixture, { interaction }));
    const sections = [...dom(html).querySelectorAll("section")];
    expect(sections).toHaveLength(15);
    for (const s of sections) {
      expect(s.querySelector(":scope > aside.notes")?.textContent?.trim().length, s.id).toBeGreaterThan(0);
    }
  });

  it("fixture notes are 60-120 words and slide types follow the catalog (minus quiz)", () => {
    const types = catalog.slideTypes.types.map((t) => t.id).filter((id) => id !== "quiz");
    expect(fixture.slides.map((s) => s.type)).toEqual(types);
    for (const s of fixture.slides) {
      const words = s.notes.trim().split(/\s+/).length;
      expect(words, s.id).toBeGreaterThanOrEqual(60);
      expect(words, s.id).toBeLessThanOrEqual(120);
    }
  });

  it("section data-motion-* attributes equal the MotionPlan entry", () => {
    const input = inputFor(fixture, { interaction });
    const doc = dom(renderDeckHtml(input).html);
    for (const s of doc.querySelectorAll("section")) {
      const m = input.motion.slides[s.id]!;
      expect(s.getAttribute("data-motion-transition")).toBe(m.transition);
      expect(s.getAttribute("data-motion-enter")).toBe(m.enter);
      expect(s.getAttribute("data-motion-emphasis")).toBe(m.emphasis);
      expect(s.getAttribute("data-motion-exit")).toBe(m.exit);
      expect(s.getAttribute("data-motion-easing")).toBe(m.easing);
    }
  });

  it("reveal root carries theme and motion attributes", () => {
    const input = inputFor(fixture, { interaction });
    const root = dom(renderDeckHtml(input).html).querySelector(".reveal")!;
    expect(root.getAttribute("data-df-texture")).toBe(input.theme.texture);
    expect(root.getAttribute("data-df-image")).toBe(input.theme.imageTreatment);
    expect(root.getAttribute("data-df-mode")).toBe(input.theme.mode);
    expect(root.getAttribute("data-motion-reduced")).toBe(input.motion.reducedMotion);
    expect(JSON.parse(root.getAttribute("data-motion-timing")!)).toEqual(input.motion.timing);
  });

  it("links css in order in head and ends body with classic scripts", () => {
    const html = renderDeckHtml(inputFor(fixture, { interaction })).html;
    const doc = dom(html);
    expect([...doc.querySelectorAll("head link[rel=stylesheet]")].map((l) => l.getAttribute("href"))).toEqual([
      "deck.css",
      "theme.css",
    ]);
    const scripts = [...doc.querySelectorAll("body script")];
    expect(scripts.map((s) => s.getAttribute("src"))).toEqual(["deck.js"]);
    expect(scripts[0]!.hasAttribute("type")).toBe(false);
    expect(doc.body.lastElementChild).toBe(scripts[0]);
  });

  it("marks animatable children with data-motion-el, stat values with data-count-up", () => {
    const doc = dom(renderDeckHtml(inputFor(fixture, { interaction })).html);
    expect(doc.querySelectorAll("#s04 [data-motion-el]").length).toBeGreaterThanOrEqual(5);
    expect(doc.querySelectorAll("#s04 ul.df-bullets > li:not([data-motion-el])")).toHaveLength(0);
    expect(doc.querySelectorAll("#s06 .df-stat[data-motion-el]").length).toBe(3);
    expect(doc.querySelectorAll("#s06 .df-stat-value[data-count-up]").length).toBe(3);
    expect(doc.querySelectorAll("#s11 .df-timeline-step[data-motion-el]").length).toBeGreaterThanOrEqual(3);
    expect(doc.querySelector("#s12 pre.df-code[data-motion-el]")).not.toBeNull();
    expect(doc.querySelector("#s13 figure.df-image[data-motion-el]")).not.toBeNull();
    expect(doc.querySelector("#s07 figure.df-quote[data-motion-el]")).not.toBeNull();
    expect(doc.querySelectorAll("#s10 .df-compare-col[data-motion-el]")).toHaveLength(2);
    expect(doc.querySelector("#s01 h1[data-motion-el]")).not.toBeNull();
  });

  it("applies emphasis targets", () => {
    const doc = dom(renderDeckHtml(inputFor(fixture, { interaction })).html);
    expect(doc.querySelector("#s06 mark[data-emphasis]")).not.toBeNull();
    expect(doc.querySelector("#s07 mark[data-emphasis]")).not.toBeNull();
  });

  it("is deterministic", () => {
    const a = renderDeckHtml(inputFor(fixture, { interaction })).html;
    expect(renderDeckHtml(inputFor(fixture, { interaction })).html).toBe(a);
  });

  it("no absolute or remote URLs", () => {
    const { html } = renderDeckHtml(inputFor(fixture, { interaction }));
    expect(html).not.toMatch(/(src|href)="\//);
    expect(html).not.toMatch(/https?:/);
    expect(html).not.toMatch(/file:/);
  });

  it("falls back to the diagram source when no svg is supplied", () => {
    const { html } = renderDeckHtml(inputFor(fixture, { interaction }));
    expect(dom(html).querySelector("#s08 pre.df-diagram-fallback")?.textContent).toContain("graph");
  });

  it("uses a supplied diagram svg and strips remote xmlns", () => {
    const mermaid = (fixture.slides[7]!.body[0] as Extract<Block, { type: "Diagram" }>).mermaid;
    const svg = '<svg class="x-mm" xmlns="http://www.w3.org/2000/svg"><g></g></svg>';
    const diagrams = new Map([[diagramKey(mermaid), svg]]);
    const { html } = renderDeckHtml(inputFor(fixture, { interaction, diagrams }));
    const doc = dom(html);
    expect(doc.querySelector("#s08 svg.x-mm")).not.toBeNull();
    expect(doc.querySelector("#s08 pre.df-diagram-fallback")).toBeNull();
    expect(html).not.toMatch(/https?:/);
  });
});

describe("interaction", () => {
  it("one-by-one df-fragment marks every bullet li as .fragment", () => {
    const doc = dom(renderDeckHtml(inputFor(fixture, { interaction })).html);
    const lis = [...doc.querySelectorAll("#s04 ul.df-bullets > li")];
    expect(lis.length).toBeGreaterThan(1);
    for (const li of lis) expect(li.classList.contains("fragment")).toBe(true);
    expect(doc.querySelectorAll("#s14 li.fragment")).toHaveLength(0);
  });

  it("a supported component produces no warnings", () => {
    expect(renderDeckHtml(inputFor(fixture, { interaction })).warnings).toEqual([]);
  });

  it("unsupported component adds a warning and still renders", () => {
    const withChart: InteractionPlan = {
      modeId: "explorable",
      slides: [{ slideId: "s09", components: [{ componentId: "df-chart", blockIndex: 0, props: {} }] }],
    };
    const { html, warnings } = renderDeckHtml(inputFor(fixture, { interaction: withChart }));
    expect(warnings).toEqual(["slide s09: df-chart is not supported by this renderer yet; rendered statically"]);
    expect(dom(html).querySelector("#s09 figure.df-chart")).not.toBeNull();
  });

  it("df-notes is satisfied without a warning", () => {
    const notes: InteractionPlan = {
      modeId: "linear",
      slides: [{ slideId: "s01", components: [{ componentId: "df-notes", props: {} }] }],
    };
    expect(renderDeckHtml(inputFor(fixture, { interaction: notes })).warnings).toEqual([]);
  });
});

describe("escaping", () => {
  it("escapes hostile text in every region and in notes", () => {
    const evil = "</section><script>alert(1)</script>";
    const bodies: Record<string, Block[]> = {
      bullets: [{ type: "Bullets", items: ["{{x}}", evil] }],
      section: [{ type: "Paragraph", text: evil }],
      compare: [{ type: "Compare", leftTitle: evil, rightTitle: "{{x}}", rows: [{ left: evil, right: "{{x}}" }] }],
      image: [{ type: "Image", prompt: evil, alt: evil }, { type: "Paragraph", text: evil }],
      stat: [{ type: "Stat", value: evil, label: "{{x}}" }],
      quote: [{ type: "Quote", text: evil, attribution: "{{x}}" }],
    };
    for (const [type, body] of Object.entries(bodies)) {
      const slide = slideOf(type, body, { title: evil, notes: "<img src=x onerror=alert(1)>" });
      const { html } = renderDeckHtml(inputFor(deckOf(slide)));
      expect(html, type).not.toContain("<script>alert");
      expect(html, type).not.toContain("<img src=x");
      expect(dom(html).querySelectorAll("section").length, type).toBe(1);
      expect(dom(html).querySelector("aside.notes")?.textContent, type).toBe("<img src=x onerror=alert(1)>");
    }
    const bullets = renderDeckHtml(inputFor(deckOf(slideOf("bullets", bodies.bullets!)))).html;
    expect(bullets).toContain("{{x}}");
    const title = renderDeckHtml(inputFor(deckOf(slideOf("title", [], { title: evil })))).html;
    expect(title).not.toContain("<script>alert");
  });

  it("escapes the deck title on the title slide and in <title>", () => {
    const deck: DeckSpec = { title: "</title><script>alert(1)</script>", subtitle: "<b>&</b>", slides: [slideOf("title")] };
    const { html } = renderDeckHtml(inputFor(deck));
    expect(html).not.toContain("<script>alert");
    expect(dom(html).querySelector("h1")?.textContent).toBe(deck.title);
    expect(dom(html).querySelector("[data-region=subtitle]")?.textContent).toBe("<b>&</b>");
  });

  it("diagram without svg renders escaped fallback", () => {
    const src = "graph TD; A-->";
    const slide = slideOf("diagram", [{ type: "Diagram", mermaid: `${src}<script>alert(1)</script>` }]);
    const { html } = renderDeckHtml(inputFor(deckOf(slide)));
    expect(html).not.toContain("<script>alert");
    expect(dom(html).querySelector("pre.df-diagram-fallback")?.textContent).toContain(src);
  });
});

describe("errors", () => {
  it("throws RenderError for a slide type with no template", () => {
    expect(() => renderDeckHtml(inputFor(deckOf(slideOf("no-such-type"))))).toThrow(RenderError);
  });

  it("throws RenderError for a catalog type whose template was not supplied", () => {
    const partial = new Map(templates);
    partial.delete("bullets");
    expect(() => renderDeckHtml(inputFor(deckOf(slideOf("bullets")), { templates: partial }))).toThrow(RenderError);
  });

  it("throws RenderError when the motion plan lacks a slide id", () => {
    const input = inputFor(deckOf(slideOf("bullets")));
    input.motion = { ...input.motion, slides: {} };
    expect(() => renderDeckHtml(input)).toThrow(RenderError);
  });

  it("rejects absolute or remote asset urls", () => {
    for (const bad of ["/deck.css", "https://x.test/a.css", "file:///a.css"]) {
      const input = inputFor(deckOf(slideOf("bullets")), { assets: { css: [bad], js: [] } });
      expect(() => renderDeckHtml(input), bad).toThrow(RenderError);
    }
  });
});
