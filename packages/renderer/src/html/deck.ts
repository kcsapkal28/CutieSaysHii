import type { Catalog } from "@deckforge/catalog";
import type { Block, DeckSpec, InteractionPlan, MotionPlan, Slide, ThemeSpec } from "@deckforge/schemas";
import type Handlebars from "handlebars";
import { emphasize, escapeHtml } from "../blocks/escape.ts";
import { renderBlock, type BlockContext } from "../blocks/render.ts";

export type RenderInput = {
  deck: DeckSpec;
  theme: ThemeSpec;
  motion: MotionPlan;
  interaction: InteractionPlan;
  catalog: Catalog;
  templates: Map<string, Handlebars.TemplateDelegate>;
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
};

type SlideTypeDef = Catalog["slideTypes"]["types"][number];

// Opening tags that carry data-motion-el, per block type. Bullet items and timeline steps repeat.
const MOTION_TAGS: Partial<Record<Block["type"], string[]>> = {
  Bullets: ["<li"],
  Paragraph: ['<p class="df-paragraph"'],
  Stat: ['<div class="df-stat"'],
  Quote: ['<figure class="df-quote"'],
  Diagram: ['<figure class="df-diagram"'],
  Chart: ['<figure class="df-chart"'],
  Compare: ['<table class="df-compare"'],
  Timeline: ['<li class="df-timeline-step"'],
  Code: ['<pre class="df-code"'],
  Image: ['<figure class="df-image"'],
  Quiz: ['<div class="df-quiz"'],
};

const addAttr = (html: string, open: string, attr: string) =>
  html.replaceAll(open, open.replace(/^<\w+/, (tag) => `${tag} ${attr}`));

// Block output is escaped everywhere except the markup it emits, so a literal xmlns URL can only
// come from inline SVG; HTML5 does not need it and the deck must contain no remote URLs.
const stripXmlns = (html: string) => html.replace(/ xmlns(?::\w+)?="https?:\/\/[^"]*"/g, "");

function blockHtml(block: Block, ctx: BlockContext): string {
  let html = stripXmlns(renderBlock(block, ctx));
  for (const open of MOTION_TAGS[block.type] ?? []) html = addAttr(html, open, "data-motion-el");
  if (block.type === "Stat") html = addAttr(html, '<div class="df-stat-value"', "data-count-up");
  return html;
}

const renderAll = (blocks: Block[], ctx: BlockContext) => blocks.map((b) => blockHtml(b, ctx)).join("");

function compareColumns(block: Extract<Block, { type: "Compare" }>, emphasis: string[]) {
  const em = (s: string) => emphasize(s, emphasis);
  const col = (title: string, cells: string[]) =>
    `<div class="df-compare-col" data-motion-el><h3 class="df-compare-title">${em(title)}</h3><ul class="df-compare-list">${cells.map((c) => `<li>${em(c)}</li>`).join("")}</ul></div>`;
  return {
    left: col(block.leftTitle, block.rows.map((r) => r.left)),
    right: col(block.rightTitle, block.rows.map((r) => r.right)),
  };
}

const isType = <T extends Block["type"]>(type: T) => (b: Block): b is Extract<Block, { type: T }> => b.type === type;

function footerFor(accepted: Block[], slide: Slide): string {
  const first = accepted[0];
  if (first?.type === "Stat") {
    return accepted.filter(isType("Stat")).map((b) => escapeHtml(b.label)).join(" · ");
  }
  if (first?.type === "Chart") {
    const units = accepted.filter(isType("Chart")).flatMap((b) => (b.unit ? [b.unit] : []));
    return [...new Set(units)].map(escapeHtml).join(" · ");
  }
  return escapeHtml(slide.title ?? "");
}

function buildRegions(
  slide: Slide,
  def: SlideTypeDef,
  deck: DeckSpec,
  ctx: BlockContext,
  warnings: string[],
): Record<string, string> {
  const has = (r: string) => def.regions.includes(r);
  const em = (s: string) => emphasize(s, slide.emphasisTargets);
  const cover = has("meta");
  const regions: Record<string, string> = Object.fromEntries(def.regions.map((r) => [r, ""]));

  const accepted = slide.body.filter((b) => def.accepts.includes(b.type));
  let extra = slide.body.filter((b) => !def.accepts.includes(b.type));

  regions.title = escapeHtml(cover ? deck.title : (slide.title ?? ""));

  if (cover) {
    regions.subtitle = escapeHtml(deck.subtitle);
    regions.meta = slide.title && slide.title !== deck.title ? escapeHtml(slide.title) : "";
  } else if (has("subtitle")) {
    const paragraphs = extra.filter(isType("Paragraph"));
    extra = extra.filter((b) => b.type !== "Paragraph");
    regions.subtitle = paragraphs.map((p) => em(p.text)).join(" ");
  }

  if (has("left") && has("right")) {
    const compare = accepted.find(isType("Compare"));
    if (compare) Object.assign(regions, compareColumns(compare, slide.emphasisTargets));
  } else if (has("body")) {
    regions.body = renderAll(accepted, ctx);
  }

  if (has("aside")) {
    regions.aside = renderAll(extra, ctx);
    extra = [];
  } else if (has("caption")) {
    const paragraphs = extra.filter(isType("Paragraph"));
    extra = extra.filter((b) => b.type !== "Paragraph");
    const alt = accepted.find(isType("Image"))?.alt ?? "";
    regions.caption = paragraphs.length > 0 ? paragraphs.map((p) => em(p.text)).join(" ") : escapeHtml(alt);
  } else if (has("body")) {
    regions.body += renderAll(extra, ctx);
    extra = [];
  }

  if (has("footer")) regions.footer = footerFor(accepted, slide);

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

  const sections = deck.slides.map((slide, index) => {
    const template = templates.get(slide.type);
    if (!template) throw new RenderError(`no template for slide type "${slide.type}" (slide ${slide.id})`);
    const def = catalog.slideTypes.types.find((t) => t.id === slide.type);
    if (!def) throw new RenderError(`slide type "${slide.type}" is not in the catalog (slide ${slide.id})`);
    const m = motion.slides[slide.id];
    if (!m) throw new RenderError(`motion plan has no entry for slide "${slide.id}"`);

    const ctx: BlockContext = {
      emphasis: slide.emphasisTargets,
      fragments: fragmentsFor(slide, interaction, warnings),
      diagrams,
    };
    const regions = buildRegions(slide, def, deck, ctx, warnings);
    const context: TemplateContext = {
      slide,
      title: slide.title ?? "",
      subtitle: deck.subtitle,
      deckTitle: deck.title,
      regions,
      index,
      total: deck.slides.length,
    };
    const attrs = [
      `id="${escapeHtml(slide.id)}"`,
      `data-slide-type="${escapeHtml(slide.type)}"`,
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
