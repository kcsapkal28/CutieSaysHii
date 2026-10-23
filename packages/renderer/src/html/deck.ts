import type { Catalog } from "@deckforge/catalog";
import type { Block, DeckSpec, InteractionPlan, LayoutSpec, MotionPlan, Slide, ThemeSpec } from "@deckforge/schemas";
import type Handlebars from "handlebars";
import { emphasize, escapeHtml } from "../blocks/escape.ts";
import { compareSide, diagramKey, renderBlock, type BlockContext } from "../blocks/render.ts";
import { titleCase } from "../blocks/title-case.ts";
import { decorates, itemCount, kickerFor, lengthClass, sectionNumber, type LengthClass } from "./context.ts";

export type RenderInput = {
  deck: DeckSpec;
  theme: ThemeSpec;
  motion: MotionPlan;
  interaction: InteractionPlan;
  catalog: Catalog;
  templates: ReadonlyMap<string, Handlebars.TemplateDelegate>;
  diagrams: Map<string, string>;
  assets: { css: string[]; js: string[] };
};

export class RenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RenderError";
  }
}

export type TemplateContext = {
  slide: Slide;
  title: string;
  subtitle: string;
  deckTitle: string;
  regions: Record<string, string>;
  index: number;
  total: number;
  kicker: string;
  kickerAriaHidden: boolean;
  sectionNumber: string;
  titleLen: LengthClass;
  itemCount: number;
  decorate: boolean;
};

type SlideTypeDef = Catalog["slideTypes"]["types"][number];

// Per-slide block context plus deck-wide state: title casing and how often each diagram has been placed.
type SlideContext = BlockContext & { heading: (s: string) => string; diagramUses: Map<string, number> };

// Opening tags that carry data-motion-el, per block type. Bullet items and timeline steps repeat.
const MOTION_TAGS: Partial<Record<Block["type"], string[]>> = {
  Bullets: ["<li"],
  Paragraph: ['<p class="df-paragraph"'],
  Stat: ['<div class="df-stat"'],
  Quote: ['<figure class="df-quote"'],
  Diagram: ['<figure class="df-diagram"'],
  Chart: ['<figure class="df-chart"'],
  Compare: ['<div class="df-compare-grid"'],
  Timeline: ['<li class="df-timeline-step"'],
  Code: ['<pre class="df-code"'],
  Image: ['<figure class="df-image"'],
  Quiz: ['<div class="df-quiz"'],
};

// Root attribute name → layout token. Stylesheets select on these values, never on family ids.
const LAYOUT_ATTRS = [
  ["align", "align"],
  ["cover", "coverAnchor"],
  ["kicker", "kicker"],
  ["stat", "stat"],
  ["panel", "panel"],
  ["divider", "divider"],
  ["decoration", "decoration"],
  ["image-layout", "imageLayout"],
  ["emphasis", "emphasis"],
  ["tracking", "tracking"],
] as const satisfies readonly (readonly [string, keyof LayoutSpec])[];

const addAttr = (html: string, open: string, attr: string) =>
  html.replaceAll(open, open.replace(/^<\w+/, (tag) => `${tag} ${attr}`));

// Block output is escaped everywhere except the markup it emits, so a literal xmlns URL can only
// come from inline SVG; HTML5 does not need it and the deck must contain no remote URLs.
const stripXmlns = (html: string) => html.replace(/ xmlns(?::\w+)?="https?:\/\/[^"]*"/g, "");

// Whitespace-only text would make a visible but empty heading or motion target.
const visible = (s: string) => (s.trim() ? s : "");

// Mermaid prefixes every id in a diagram with d-<key>, so the n-th repeat of a diagram is renamed d-<key>-<n>.
function uniqueDiagramIds(html: string, key: string, ctx: SlideContext): string {
  if (!ctx.diagrams.has(key)) return html;
  const n = ctx.diagramUses.get(key) ?? 0;
  ctx.diagramUses.set(key, n + 1);
  return n === 0 ? html : html.replaceAll(`d-${key}`, `d-${key}-${n}`);
}

function blockHtml(block: Block, ctx: SlideContext): string {
  let html = stripXmlns(renderBlock(block, ctx));
  for (const open of MOTION_TAGS[block.type] ?? []) html = addAttr(html, open, "data-motion-el");
  // countUp rewrites its target's text, so it targets the number alone; an emphasised number is already
  // counted through its <mark data-emphasis>, and nesting a second target around it would count it twice.
  if (block.type === "Stat" && !emphasize(block.value, ctx.emphasis).includes("<"))
    html = addAttr(html, '<span class="df-stat-number"', "data-count-up");
  if (block.type === "Diagram") html = uniqueDiagramIds(html, diagramKey(block.mermaid), ctx);
  return html;
}

const renderAll = (blocks: Block[], ctx: SlideContext) => blocks.map((b) => blockHtml(b, ctx)).join("");

function compareColumns(block: Extract<Block, { type: "Compare" }>, ctx: SlideContext) {
  const em = (s: string) => emphasize(s, ctx.emphasis);
  return {
    left: compareSide(em(ctx.heading(block.leftTitle)), block.rows.map((r) => em(r.left))),
    right: compareSide(em(ctx.heading(block.rightTitle)), block.rows.map((r) => em(r.right))),
  };
}

const isType = <T extends Block["type"]>(type: T) => (b: Block): b is Extract<Block, { type: T }> => b.type === type;

const isCover = (def: SlideTypeDef) => def.regions.includes("meta");

function buildRegions(
  slide: Slide,
  def: SlideTypeDef,
  deck: DeckSpec,
  ctx: SlideContext,
  warnings: string[],
): Record<string, string> {
  const has = (r: string) => def.regions.includes(r);
  const em = (s: string) => emphasize(s, slide.emphasisTargets);
  const heading = (s: string) => escapeHtml(ctx.heading(visible(s)));
  const cover = isCover(def);
  const regions: Record<string, string> = Object.fromEntries(def.regions.map((r) => [r, ""]));

  const accepted = slide.body.filter((b) => def.accepts.includes(b.type));
  let extra = slide.body.filter((b) => !def.accepts.includes(b.type));
  const takeParagraphs = () => {
    const paragraphs = extra.filter(isType("Paragraph"));
    extra = extra.filter((b) => b.type !== "Paragraph");
    return visible(paragraphs.map((p) => em(p.text)).join(" "));
  };

  regions.title = heading(cover ? deck.title : (slide.title ?? ""));

  if (cover) {
    regions.subtitle = escapeHtml(visible(deck.subtitle));
    regions.meta = slide.title && slide.title !== deck.title ? heading(slide.title) : "";
  } else if (has("subtitle")) {
    regions.subtitle = takeParagraphs();
  }

  if (has("left") && has("right")) {
    const compare = accepted.find(isType("Compare"));
    if (compare) Object.assign(regions, compareColumns(compare, ctx));
  } else if (has("body")) {
    regions.body = renderAll(accepted, ctx);
  }

  // The stat footer repeats the labels for a hidden summary; a chart's footer is its caption; any other footer
  // names the slide. A chart's unit is on its axis, so it is never repeated here.
  if (has("footer")) {
    if (def.accepts.includes("Stat")) regions.footer = accepted.filter(isType("Stat")).map((b) => escapeHtml(b.label)).join(" · ");
    else if (def.accepts.includes("Chart")) regions.footer = takeParagraphs();
    else regions.footer = heading(slide.title ?? "");
  }

  if (has("aside")) {
    regions.aside = renderAll(extra, ctx);
    extra = [];
  } else if (has("caption")) {
    const caption = takeParagraphs();
    regions.caption = caption || escapeHtml(visible(accepted.find(isType("Image"))?.alt ?? ""));
  } else if (has("body")) {
    regions.body += renderAll(extra, ctx);
    extra = [];
  }

  if (extra.length > 0) {
    const kinds = [...new Set(extra.map((b) => b.type))].join(", ");
    warnings.push(`slide ${slide.id}: ${extra.length} block(s) (${kinds}) have no region in ${slide.type} and were not rendered`);
  }
  return regions;
}

function fragmentsFor(slide: Slide, interaction: InteractionPlan, warnings: string[]): boolean {
  const plan = interaction.slides.find((s) => s.slideId === slide.id);
  let fragments = false;
  for (const c of plan?.components ?? []) {
    if (c.componentId === "df-fragment" && c.props.mode === "one-by-one") fragments = true;
    else if (c.componentId === "df-fragment" || c.componentId === "df-notes") continue;
    else warnings.push(`slide ${slide.id}: ${c.componentId} is not supported by this renderer yet; rendered statically`);
  }
  return fragments;
}

const NOT_RELATIVE = /^(?:\/|[a-z][a-z0-9+.-]*:)/i;

function assertRelative(urls: string[]) {
  for (const u of urls) {
    if (!u || NOT_RELATIVE.test(u)) throw new RenderError(`asset url must be relative, got "${u}"`);
  }
}

export function renderDeckHtml(input: RenderInput): { html: string; warnings: string[] } {
  const { deck, theme, motion, interaction, catalog, templates, diagrams, assets } = input;
  assertRelative([...assets.css, ...assets.js]);
  const warnings: string[] = [];
  const { layout } = theme;
  // Title Case is done on the text, before emphasis and escaping: CSS `capitalize` mangles "of" and "iPhone".
  const caseTitle = (s: string) => (theme.titleCase === "title" ? titleCase(s) : s);
  const diagramUses = new Map<string, number>();

  const sections = deck.slides.map((slide, index) => {
    const template = templates.get(slide.type);
    if (!template) throw new RenderError(`no template for slide type "${slide.type}" (slide ${slide.id})`);
    const def = catalog.slideTypes.types.find((t) => t.id === slide.type);
    if (!def) throw new RenderError(`slide type "${slide.type}" is not in the catalog (slide ${slide.id})`);
    const m = motion.slides[slide.id];
    if (!m) throw new RenderError(`motion plan has no entry for slide "${slide.id}"`);

    const ctx: SlideContext = {
      emphasis: slide.emphasisTargets,
      fragments: fragmentsFor(slide, interaction, warnings),
      diagrams,
      heading: caseTitle,
      diagramUses,
    };
    const regions = buildRegions(slide, def, deck, ctx, warnings);
    const decorate = decorates(layout, slide.type);
    const context: TemplateContext = {
      slide,
      title: slide.title ?? "",
      subtitle: deck.subtitle,
      deckTitle: deck.title,
      regions,
      index,
      total: deck.slides.length,
      kicker: escapeHtml(caseTitle(visible(kickerFor(deck.slides, index, layout)))),
      kickerAriaHidden: layout.kicker === "index",
      sectionNumber: sectionNumber(deck.slides, index),
      titleLen: lengthClass(isCover(def) ? deck.title : (slide.title ?? "")),
      itemCount: itemCount(slide.body.filter((b) => def.accepts.includes(b.type))),
      decorate,
    };
    const attrs = [
      `id="${escapeHtml(slide.id)}"`,
      `data-slide-type="${escapeHtml(slide.type)}"`,
      `data-df-variant="${index % 3}"`,
      ...(decorate ? ["data-df-decorate"] : []),
      `data-motion-transition="${escapeHtml(m.transition)}"`,
      `data-motion-enter="${escapeHtml(m.enter)}"`,
      `data-motion-emphasis="${escapeHtml(m.emphasis)}"`,
      `data-motion-exit="${escapeHtml(m.exit)}"`,
      `data-motion-easing="${escapeHtml(m.easing ?? motion.timing.easing)}"`,
    ].join(" ");
    return `<section ${attrs}>${template(context)}<aside class="notes">${escapeHtml(slide.notes)}</aside></section>`;
  });

  const rootAttrs = [
    'class="reveal"',
    `data-df-texture="${escapeHtml(theme.texture)}"`,
    `data-df-image="${escapeHtml(theme.imageTreatment)}"`,
    `data-df-mode="${escapeHtml(theme.mode)}"`,
    ...LAYOUT_ATTRS.map(([name, key]) => `data-df-${name}="${escapeHtml(layout[key])}"`),
    `data-motion-timing='${escapeHtml(JSON.stringify(motion.timing))}'`,
    `data-motion-reduced="${escapeHtml(motion.reducedMotion)}"`,
  ].join(" ");

  const links = assets.css.map((href) => `<link rel="stylesheet" href="${escapeHtml(href)}">`).join("\n");
  const scripts = assets.js.map((src) => `<script src="${escapeHtml(src)}"></script>`).join("\n");

  const html = [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(deck.title)}</title>`,
    links,
    "</head>",
    "<body>",
    `<div ${rootAttrs}>`,
    '<div class="slides">',
    sections.join("\n"),
    "</div>",
    "</div>",
    scripts,
    "</body>",
    "</html>",
    "",
  ].join("\n");

  return { html, warnings };
}
