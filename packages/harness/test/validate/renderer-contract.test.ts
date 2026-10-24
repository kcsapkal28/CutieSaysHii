import { goldenChoices, resolveMotionPlan, resolveTheme, type Catalog } from "@deckforge/catalog";
import { diagramKey, renderDeckHtml } from "@deckforge/renderer";
import { loadTemplates } from "@deckforge/renderer/node";
import { BlockUnionSchema, type Block, type DeckSpec, type Slide } from "@deckforge/schemas";
import { beforeAll, describe, expect, it } from "vitest";
import { acceptedBlocks, COVER_REGION, coverTypeIds, PARAGRAPH_REGIONS } from "../../src/validate/rules.ts";
import { emphasisTexts, visibleTexts } from "../../src/validate/words.ts";
import { testCatalog } from "../helpers/context.ts";

// Contract between the validator's word and emphasis sets and what the real renderer prints. Every
// free-text field gets a unique sentinel; the fixture deck has one slide per (slide type, accepted
// block type) plus one empty slide per type. Built against the pre-design-pass renderer.

const BLOCK_TYPES = BlockUnionSchema.options.map((o) => o.shape.type.value);

type Sentinel = { value: string; field: string };

/** Where the validator knowingly differs from the renderer. Counting more than is shown is conservative. */
const KNOWN_VISIBLE_DIFFERENCES = [
  // A single-series chart has no legend; the series name is only in the SVG's <title>.
  "chart Chart.series.name: counted, not shown",
  // Axis ticks and the footer print the unit; it is a symbol, not words.
  "chart Chart.unit: shown, not counted",
  // Code is bounded by the lines/cols limits instead.
  "code Code.code: shown, not counted",
  // image.hbs has no title region and no footer.
  "image title: counted, not shown",
];
const KNOWN_EMPHASIS_DIFFERENCES: string[] = [];

function sentinels() {
  const all: Sentinel[] = [];
  const next = (field: string) => {
    const value = `zq${String(all.length).padStart(3, "0")}x`;
    all.push({ value, field });
    return value;
  };
  return { all, next };
}

function sample(type: Block["type"], next: (field: string) => string): Block {
  const f = (field: string) => next(`${type}.${field}`);
  switch (type) {
    case "Bullets":
      return { type, items: [f("items"), f("items")] };
    case "Paragraph":
      return { type, text: f("text") };
    case "Stat":
      return { type, value: f("value"), label: f("label"), trend: "up" };
    case "Quote":
      return { type, text: f("text"), attribution: f("attribution") };
    case "Diagram":
      return { type, mermaid: `graph LR\n  A[${f("mermaid")}] --> B`, hotspots: [{ nodeId: "A", label: f("hotspots.label"), detail: f("hotspots.detail") }] };
    case "Chart":
      return { type, kind: "bar", labels: [f("labels"), f("labels")], series: [{ name: f("series.name"), values: [1, 2] }], unit: f("unit") };
    case "Compare":
      return { type, leftTitle: f("leftTitle"), rightTitle: f("rightTitle"), rows: [{ left: f("rows.left"), right: f("rows.right") }] };
    case "Timeline":
      return { type, steps: [{ label: f("steps.label"), detail: f("steps.detail"), date: f("steps.date") }] };
    case "Code":
      return { type, lang: f("lang"), code: `const ${f("code")} = 1;` };
    case "Image":
      return { type, prompt: f("prompt"), alt: f("alt") };
    case "Quiz":
      return { type, question: f("question"), options: [f("options"), f("options"), f("options")], answerIndex: 0, explanation: f("explanation") };
  }
}

type Rendered = { slide: Slide; cover: boolean; html: string; fields: Sentinel[] };

let c: Catalog;
let deck: DeckSpec;
let rendered: Rendered[];
let warnings: string[];
let deckFields: Sentinel[];

beforeAll(async () => {
  c = await testCatalog();
  const covers = coverTypeIds(c);
  const { all, next } = sentinels();
  next("deck.title");
  next("deck.subtitle");
  deckFields = all.slice(0, 2);
  const slides: { slide: Slide; fields: Sentinel[] }[] = c.slideTypes.types.flatMap((t) =>
    [undefined, ...acceptedBlocks(t, covers.includes(t.id))].map((blockType) => {
      const from = all.length;
      const title = next("title");
      const body = blockType ? [sample(blockType as Block["type"], next)] : [];
      const fields = all.slice(from);
      const slide: Slide = { id: `${t.id}-${blockType ?? "empty"}`, type: t.id, title, body, notes: next("notes"), emphasisTargets: fields.map((s) => s.value) };
      return { slide, fields };
    }),
  );
  deck = { title: deckFields[0]!.value, subtitle: deckFields[1]!.value, slides: slides.map((s) => s.slide) };

  const choices = goldenChoices(c)[0]!;
  const sources = deck.slides.flatMap((s) => s.body.flatMap((b) => (b.type === "Diagram" ? [b.mermaid] : [])));
  const out = renderDeckHtml({
    deck,
    theme: resolveTheme(c, choices),
    motion: resolveMotionPlan(c, choices.motionTemplateId, deck.slides),
    interaction: { modeId: choices.interactionModeId, slides: [] },
    catalog: c,
    templates: loadTemplates(),
    diagrams: new Map(sources.map((src) => [diagramKey(src), "<svg></svg>"])),
    assets: { css: ["assets/deck.css"], js: ["assets/deck.js"] },
  });
  warnings = out.warnings;
  const sections = new Map([...out.html.matchAll(/<section id="([^"]+)"[^>]*>([\s\S]*?)<\/section>/g)].map((m) => [m[1]!, m[2]!]));
  rendered = slides.map(({ slide, fields }) => ({
    slide,
    cover: covers.includes(slide.type),
    html: sections.get(slide.id) ?? "",
    fields: covers.includes(slide.type) ? [...fields, ...deckFields] : fields,
  }));
});

/** Removes each element whose opening tag matches `hide`, up to its closing tag (the renderer never nests these). */
function removeElements(html: string, hide: (tag: string, attrs: string) => boolean): string {
  const open = /<(\w+)([^>]*)>/g;
  for (let m = open.exec(html); m; m = open.exec(html)) {
    if (!hide(m[1]!, m[2]!)) continue;
    const close = html.indexOf(`</${m[1]}>`, open.lastIndex);
    html = html.slice(0, m.index) + (close < 0 ? "" : html.slice(close + m[1]!.length + 3));
    open.lastIndex = m.index;
  }
  return html;
}

const classesOf = (attrs: string) => /\bclass="([^"]*)"/.exec(attrs)?.[1]?.split(/\s+/) ?? [];

/**
 * The text a viewer sees: no speaker notes, no hidden elements, no SVG <title>, no attributes.
 * Classes the template hides with a "[&_.x]:hidden" utility count as hidden; matched as whole tokens,
 * since that utility itself sits in the region's class list.
 */
function shownText(section: string): string {
  const hiddenClasses = [...section.matchAll(/\[&_\.([\w-]+)\]:hidden/g)].map((m) => m[1]!);
  const html = removeElements(section, (tag, attrs) => {
    const classes = classesOf(attrs);
    return (
      tag === "title" ||
      (tag === "aside" && classes.includes("notes")) ||
      /\shidden(\s|=|$)/.test(attrs) ||
      classes.some((c) => hiddenClasses.includes(c))
    );
  });
  return html.replace(/<[^>]*>/g, " ");
}

const has = (texts: string[], value: string) => texts.some((t) => t.includes(value));
const label = (r: Rendered, s: Sentinel) => `${r.slide.type} ${s.field}`;

describe("validator ↔ renderer contract", () => {
  it("renders one section per fixture slide and every accepted block without a missing-region warning", () => {
    expect(rendered.every((r) => r.html.length > 0)).toBe(true);
    expect(warnings.filter((w) => w.includes("not rendered"))).toEqual([]);
    const blockTypes = new Set(deck.slides.flatMap((s) => s.body.map((b) => b.type)));
    expect([...blockTypes].sort()).toEqual([...BLOCK_TYPES].sort());
  });

  it("the cover types are those with a meta region, and the renderer draws them as the cover", () => {
    expect(coverTypeIds(c)).toEqual(c.slideTypes.types.filter((t) => t.regions.includes(COVER_REGION)).map((t) => t.id));
    for (const r of rendered) expect(shownText(r.html).includes(deck.title), r.slide.id).toBe(r.cover);
  });

  it("off the cover, a Paragraph is accepted wherever a Paragraph region exists", () => {
    for (const t of c.slideTypes.types.filter((x) => !coverTypeIds(c).includes(x.id))) {
      const region = t.regions.some((r) => PARAGRAPH_REGIONS.includes(r));
      if (region || t.accepts.includes("Paragraph")) expect(acceptedBlocks(t, false), t.id).toContain("Paragraph");
    }
  });

  it("visible words: every counted text is shown and every shown text is counted", () => {
    const differences = new Set<string>();
    for (const r of rendered) {
      const counted = visibleTexts(r.slide, r.cover ? deck : undefined);
      const shown = shownText(r.html);
      for (const s of r.fields.filter((x) => x.field !== "notes")) {
        const isCounted = has(counted, s.value);
        const isShown = shown.includes(s.value);
        if (isCounted && !isShown) differences.add(`${label(r, s)}: counted, not shown`);
        if (!isCounted && isShown) differences.add(`${label(r, s)}: shown, not counted`);
      }
    }
    expect([...differences].sort()).toEqual([...KNOWN_VISIBLE_DIFFERENCES].sort());
  });

  it("emphasis: a target is marked exactly where the validator says it can be", () => {
    const differences = new Set<string>();
    for (const r of rendered) {
      const markable = r.cover ? [] : emphasisTexts(r.slide);
      for (const s of r.fields.filter((x) => x.field !== "notes" && !x.field.startsWith("deck."))) {
        const expected = has(markable, s.value);
        const marked = r.html.includes(`data-emphasis>${s.value}</mark>`);
        if (expected !== marked) differences.add(`${label(r, s)}: ${expected ? "expected a mark, none printed" : "marked, not expected"}`);
      }
    }
    expect([...differences].sort()).toEqual(KNOWN_EMPHASIS_DIFFERENCES);
  });
});
