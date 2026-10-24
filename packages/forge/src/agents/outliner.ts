// Outliner: research + style → outline.json, in two passes.
//   1. The arc (one call, the strongest model): the deck's story, sections and slides; per slide its point, role, time
//      budget, primary explainer technique, composition and the research items it draws on, chosen across the whole
//      deck so techniques and layouts vary.
//   2. The cards (one call per slide, run concurrently, a faster model by default): each arc entry expanded into the
//      slide's words and visual direction, given a compact view of the arc, the slide's own technique entries, the
//      research items the arc pointed it at and the style essentials.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Style } from "../contract.ts";
import { designBrief, designStyle } from "../design-styles.ts";
import { LlmError, MODELS, type Llm } from "../llm.ts";
import { OUTLINE_DEFAULTS } from "../pipeline/config.ts";
import { FORGE_DIR, loadPrompt } from "./prompts.ts";
import { Explainer, Object3d, Outline, ROLES, ScriptSlide, Storyboard, StoryboardSlide, Visual, type Brief, type OutlineSlide } from "./schemas.ts";

export const TECHNIQUES_FILE = join(FORGE_DIR, "fixtures", "exemplars", "TECHNIQUES.md");
const LIGHT_INTERACTIONS = new Set(["none", "click", "hover", "toggle"]);
const WORDY = new Set(["typographic", "quote"]);
const DATA_EXPLAINERS = new Set(["data-viz", "timeline", "map", "comparison"]);

export const slideId = (n: number) => `s${String(n).padStart(2, "0")}`;

/** Scales budgets so they add up to the talk length, rounded to 5 s (the last slide absorbs the rounding). */
export function normalizeBudgets(budgets: number[], totalSec: number): number[] {
  const sum = budgets.reduce((a, b) => a + b, 0) || 1;
  const scaled = budgets.map((b) => Math.max(15, Math.round((b * totalSec) / sum / 5) * 5));
  const drift = totalSec - scaled.reduce((a, b) => a + b, 0);
  if (scaled.length) scaled[scaled.length - 1] = Math.max(15, scaled[scaled.length - 1]! + drift);
  return scaled;
}

/** The catalogue's technique entries ("## `id`" sections) by id. */
export function catalogueEntries(file = TECHNIQUES_FILE): Map<string, string> {
  if (!existsSync(file)) return new Map();
  const parts = readFileSync(file, "utf8").split(/^(?=## )/m);
  return new Map(parts.flatMap((part) => {
    const id = /^## `([a-z0-9-]+)`/.exec(part)?.[1];
    return id ? [[id, part.trim()] as const] : [];
  }));
}

/** Technique ids defined in the catalogue ("## `id`" headings). */
export const catalogueIds = (file = TECHNIQUES_FILE): string[] => [...catalogueEntries(file).keys()];

/** The ids in a slide's `technique` field ("exploded-3d, annotated-labels"). */
const techniqueIdsOf = (technique: string) => technique.split(/[\s,+/]+/).filter(Boolean);

/** Prompt wiring for the engine's technique catalogue: a pointer after the explainer list and the full catalogue appended. */
function techniquePrompt(file: string): { pointer: string; appendix: string } {
  if (!existsSync(file)) return { pointer: "", appendix: "" };
  return {
    pointer:
      "\nThen set `technique` to the catalogue id(s) that implement it (see the Technique catalogue at the end; comma-separate when a slide combines two, e.g. `exploded-3d, annotated-labels`). The engineer studies hand-built exemplars of each technique.\n",
    appendix: `\n\n# Technique catalogue\n\n${readFileSync(file, "utf8").trim()}\n`,
  };
}

// ---- research items: the notes split into pieces the arc can point each slide at ----

export type ResearchItem = { id: string; section: string; text: string };

/**
 * Splits research markdown into items with ids R1, R2…: each top-level bullet or numbered line, each paragraph, and
 * each `###` block (with everything up to the next heading). Works on any markdown, including presenter edits.
 */
export function researchItems(md: string): ResearchItem[] {
  const items: ResearchItem[] = [];
  let section = "";
  let open: ResearchItem | undefined;
  let inBlock = false;
  const start = (text: string) => items.push((open = { id: `R${items.length + 1}`, section, text }));
  for (const line of md.split(/\r?\n/)) {
    if (/^#{1,2}\s/.test(line)) {
      if (/^##\s/.test(line)) section = line.replace(/^##\s+/, "").trim();
      open = undefined;
      inBlock = false;
    } else if (/^#{3,}\s/.test(line)) {
      start(line.replace(/^#+\s+/, ""));
      inBlock = true;
    } else if (!line.trim()) {
      if (inBlock && open) open.text += "\n";
      else open = undefined;
    } else if (open && (inBlock || /^\s/.test(line) || !/^(?:[-*+]|\d+[.)])\s/.test(line))) {
      open.text += `\n${line}`;
    } else {
      start(line.replace(/^[-*+]\s+/, ""));
    }
  }
  return items.map((i) => ({ ...i, text: i.text.replace(/\n{3,}/g, "\n\n").trim() }));
}

/** Items as labelled markdown under their section headings (only `keep`'s ids when given). */
export function renderResearch(items: ResearchItem[], keep?: Set<string>): string {
  let out = "";
  let section: string | undefined;
  for (const item of items) {
    if (keep && !keep.has(item.id)) continue;
    if (item.section !== section) {
      section = item.section;
      if (section) out += `${out ? "\n" : ""}## ${section}\n`;
    }
    out += `[${item.id}] ${item.text}\n`;
  }
  return out.trim();
}

// ---- pass 1: the arc ----

export const ArcSlide = z.object({
  point: z.string().describe("The single idea this slide lands, as a full sentence a viewer could repeat."),
  role: z.enum(ROLES),
  budgetSec: z.number().positive().describe("Seconds; rescaled in code so the deck fits the talk length."),
  explainer: Explainer,
  technique: StoryboardSlide.shape.technique,
  composition: z.string().describe('A short layout label, e.g. "hero object right, title left" or "full-bleed timeline". Neighbours must differ.'),
  interaction: StoryboardSlide.shape.interaction.shape.kind,
  handoff: z.string().describe('What carries visually into the next slide (an object, a colour, a line, a number), or "cut" for a clean break.'),
  facts: z
    .array(z.string())
    .describe('Ids of the research items this slide\'s point, words and visual need, e.g. ["R4", "R12", "R17"] (usually 3–8). Its writer sees only these.'),
});
export type ArcSlide = z.infer<typeof ArcSlide>;

export const ArcDraft = z.object({
  title: z.string().describe("Deck title, short and evocative."),
  subtitle: z.string(),
  throughline: z.string().describe("The one story the deck tells, in two sentences."),
  visualThroughline: Storyboard.shape.visualThroughline,
  motifs: Storyboard.shape.motifs,
  sections: z
    .array(z.object({ name: z.string().describe("1–2 words, used as a section tab."), slides: z.array(ArcSlide).min(1) }))
    .min(2),
});
export type ArcDraft = z.infer<typeof ArcDraft>;

type Planned = { id: string; explainer: string; interaction: string; object3d?: unknown; simulation?: unknown };

/** One slide's visual against the style's hard limits (3D, interactivity, required specs). */
export function styleProblems(s: Planned, style: Style, opts: { specs?: boolean } = {}): string[] {
  const problems: string[] = [];
  if (!style.use3d && (s.explainer === "3d-object" || s.object3d)) problems.push(`${s.id}: 3D is off for this deck; use a 2D explainer and drop object3d`);
  if (opts.specs && style.use3d && s.explainer === "3d-object" && !s.object3d) problems.push(`${s.id}: a 3d-object slide needs an object3d spec`);
  if (opts.specs && s.explainer === "simulation" && !s.simulation) problems.push(`${s.id}: a simulation slide needs a simulation spec`);
  if (style.interactivity === 0 && s.interaction !== "none") problems.push(`${s.id}: interactivity is 0 (static); the interaction kind must be "none"`);
  if (style.interactivity === 1 && !LIGHT_INTERACTIONS.has(s.interaction))
    problems.push(`${s.id}: interactivity is 1 (light); use click, hover or toggle, not ${s.interaction}`);
  return problems;
}

/** Problems with an arc: unknown technique ids, the style's hard limits and the variety rules (empty when it complies). */
export function arcProblems(slides: (Omit<ArcSlide, "facts"> & { id: string })[], style: Style, techniqueIds: string[] = []): string[] {
  const problems: string[] = [];
  if (techniqueIds.length) {
    for (const s of slides) {
      const unknown = techniqueIdsOf(s.technique).filter((t) => !techniqueIds.includes(t));
      if (unknown.length) problems.push(`${s.id}: unknown technique id(s) ${unknown.join(", ")}; use catalogue ids: ${techniqueIds.join(", ")}`);
    }
  }
  for (const s of slides) problems.push(...styleProblems(s, style));
  // Variety: no explainer three times in a row; at least three explainers in a deck of five or more; few wordy slides;
  // neighbours never share a composition.
  for (let i = 2; i < slides.length; i++) {
    const [a, b, c] = [slides[i - 2]!, slides[i - 1]!, slides[i]!];
    if (a.explainer === b.explainer && b.explainer === c.explainer) problems.push(`${a.id}–${c.id}: three ${c.explainer} slides in a row; vary the explainer`);
  }
  const kinds = new Set(slides.map((s) => s.explainer));
  if (slides.length >= 5 && kinds.size < 3) problems.push(`only ${kinds.size} explainer type(s) across ${slides.length} slides; use at least three`);
  const wordy = slides.filter((s) => WORDY.has(s.explainer)).length;
  if (wordy > Math.max(1, Math.ceil(slides.length / 5))) problems.push(`${wordy} typographic/quote slides is too many; show mechanisms, data or images instead`);
  const norm = (c: string) => c.trim().toLowerCase().replace(/\s+/g, " ");
  for (let i = 1; i < slides.length; i++) {
    const [a, b] = [slides[i - 1]!, slides[i]!];
    if (norm(a.composition) === norm(b.composition)) problems.push(`${a.id} and ${b.id} share the composition "${b.composition}"; vary the layout`);
  }
  return problems;
}

/** The arc's slides in order, with their ids. */
export const arcSlides = (arc: ArcDraft) =>
  arc.sections.flatMap((s, sectionIndex) => s.slides.map((sl) => ({ ...sl, section: s.name, sectionIndex }))).map((s, i) => ({ ...s, id: slideId(i + 1) }));

export function arcSchema(style: Style, techniqueIds: string[] = []) {
  return ArcDraft.superRefine((arc, ctx) => {
    for (const message of arcProblems(arcSlides(arc), style, techniqueIds)) ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  });
}

// ---- pass 2: one card per slide ----

/** Hard caps on a card's fields, generous next to the guidance in the descriptions: past them the card is sent back. */
export const CARD_LIMITS = { titleChars: 90, calloutChars: 60, callouts: 10, notesWords: 220, conceptChars: 1000, beatChars: 300 };

const oneSentence = (what: string) => z.string().describe(`${what}, in one sentence.`);

/** The visual direction the builder and critic read (via toStoryboard), with tight length guidance for the writer. */
const CardVisual = Visual.omit({ explainer: true, technique: true }).extend({
  concept: z
    .string()
    .describe(
      "What the viewer sees, in 2–4 sentences (about 600 characters at most): the objects, where they sit on the 1920×1080 canvas, their colours as theme tokens, what moves, in which direction and how fast.",
    ),
  why: oneSentence("Why this visual explains the point better than the alternatives"),
  layout: z.string().describe("One or two sentences (about 250 characters): where the title, the visual, the callouts and any caption sit."),
  interaction: z.object({
    kind: StoryboardSlide.shape.interaction.shape.kind,
    description: z.string().describe("One sentence: what the viewer does and what visibly changes. Empty when kind is none."),
  }),
  steps: z
    .array(
      z.object({
        beat: z.string().describe("The on-screen state at this step, as one short phrase (under about 140 characters)."),
        motion: z.string().describe('A few words, e.g. "tokens slide right, 0.8 s" or "none".'),
      }),
    )
    .min(1)
    .max(6)
    .describe("1–6 presenter clicks; each a state reachable in any order."),
  object3d: Object3d.optional().describe("For 3d-object slides: 4–10 parts, every field a short phrase."),
  simulation: z
    .object({
      model: z.string().describe("State and update rules precise enough to code, in at most 4 sentences or a formula."),
      controls: z.array(z.string()).describe('Each a short label with its range, e.g. "consumer rate 1–20 /s".'),
      readouts: z.array(z.string()).describe("Each a short label with its unit."),
    })
    .optional(),
  data: z
    .string()
    .optional()
    .describe('For data-viz, timeline, map and comparison: the actual values as a compact list ("label: value unit; …"), about 600 characters at most.'),
  reducedMotion: oneSentence("The still frame that tells the same story"),
  entry: oneSentence("The state at step 1, picking up the previous slide's handoff (or a clean start after a cut)"),
  exit: oneSentence("The state at the last step, setting up this slide's handoff to the next slide"),
});

export const CardDraft = z.object({
  title: ScriptSlide.shape.title,
  kicker: ScriptSlide.shape.kicker,
  subtitle: ScriptSlide.shape.subtitle,
  callouts: ScriptSlide.shape.callouts,
  notes: z.string().describe("Speaker notes in a natural spoken voice: about 2 words per second of the slide's budget, 40–160 words."),
  visual: CardVisual,
});
export type CardDraft = z.infer<typeof CardDraft>;

/** Problems with one card: the style's hard limits, the specs its explainer needs, and fields far past their guidance. */
export function cardProblems(slide: { id: string; explainer: string }, card: CardDraft, style: Style): string[] {
  const { id } = slide;
  const v = card.visual;
  const problems = styleProblems({ id, explainer: slide.explainer, interaction: v.interaction.kind, object3d: v.object3d, simulation: v.simulation }, style, { specs: true });
  if (DATA_EXPLAINERS.has(slide.explainer) && !v.data?.trim()) problems.push(`${id}: a ${slide.explainer} slide needs its actual values in visual.data`);
  const L = CARD_LIMITS;
  if (card.title.length > L.titleChars) problems.push(`${id}: the title is ${card.title.length} characters; state the claim in under 60`);
  if (card.callouts.length > L.callouts) problems.push(`${id}: ${card.callouts.length} callouts; keep to 8 at most`);
  const long = card.callouts.filter((c) => c.length > L.calloutChars);
  if (long.length) problems.push(`${id}: callouts are labels of at most 40 characters; shorten ${long.map((c) => JSON.stringify(c)).join(", ")}`);
  const words = card.notes.trim().split(/\s+/).filter(Boolean).length;
  if (words > L.notesWords) problems.push(`${id}: the notes are ${words} words; keep them to 160 at most`);
  if (v.concept.length > L.conceptChars) problems.push(`${id}: visual.concept is ${v.concept.length} characters; keep it to 2–4 sentences (about 600 characters)`);
  v.steps.forEach((s, i) => {
    if (s.beat.length > L.beatChars) problems.push(`${id}: visual.steps.${i}.beat is ${s.beat.length} characters; make each beat one short phrase`);
  });
  return problems;
}

export function cardSchema(slide: { id: string; explainer: string }, style: Style) {
  return CardDraft.superRefine((card, ctx) => {
    for (const message of cardProblems(slide, card, style)) ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  });
}

/** Runs `fn` over `items` with at most `limit` in flight; results keep the input order. */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return out;
}

export type OutlineInput = { brief: Brief; style: Style; researchMd: string };
export type OutlineOptions = {
  /** The arc's model. */
  model?: string;
  /** The cards' model. */
  cardModel?: string;
  /** Card calls in flight at once. */
  concurrency?: number;
  /** Card context, output cap, thinking and retries (defaults in config.ts). */
  cardContext?: "slim" | "full";
  cardMaxTokens?: number;
  cardThinking?: "off" | "model";
  cardRetries?: number;
  techniquesFile?: string;
  /** The arc is planned (before any card is written). */
  onArc?: (arc: { title: string; sections: number; slides: { id: string; point: string }[] }) => void;
  /** A slide's card is written (`done` of `total`). */
  onCard?: (card: { id: string; title: string; done: number; total: number }) => void;
};

export async function runOutline(llm: Llm, input: OutlineInput, opts: OutlineOptions = {}): Promise<Outline> {
  const { brief, style, researchMd } = input;
  const techniqueFile = opts.techniquesFile ?? TECHNIQUES_FILE;
  const technique = techniquePrompt(techniqueFile);
  const totalSec = Math.round(brief.minutes * 60);
  const items = researchItems(researchMd);
  const header = `Topic: ${brief.topic}\nAudience: ${brief.audience}\nTalk length: ${brief.minutes} minutes (${totalSec} s)`;
  const styleBrief = {
    look: style.look,
    colors: style.theme.colors,
    fonts: style.theme.fonts,
    motion: style.motion,
    use3d: style.use3d,
    interactivity: style.interactivity,
    density: style.density,
  };
  const arcContext =
    `${header}\n\nStyle:\n${JSON.stringify(styleBrief, null, 2)}\n\n${designBrief(style)}\n\n` +
    `Research notes (each item has an id; list the ones each slide needs in its \`facts\`):\n${renderResearch(items)}`;

  const { data: arc } = await llm.callTool({
    label: "outline:arc",
    model: opts.model ?? MODELS.opus,
    system: loadPrompt("outline", { techniques: technique.pointer }) + technique.appendix,
    user: arcContext,
    maxTokens: 8000,
    timeoutMs: 10 * 60_000,
    validationRetries: 2,
    tool: { name: "plan_arc", description: "Plan the deck's arc: sections and slides, with each slide's point, time, visual approach and research items.", schema: arcSchema(style, catalogueIds(techniqueFile)) },
  });
  const planned = arcSlides(arc);
  const budgets = normalizeBudgets(planned.map((s) => s.budgetSec), totalSec);
  const slides = planned.map((s, i) => ({ ...s, budgetSec: budgets[i]! }));
  opts.onArc?.({ title: arc.title, sections: arc.sections.length, slides: slides.map((s) => ({ id: s.id, point: s.point })) });

  // Every card call shares the system prompt and the start of the user turn (brief, style, arc); the slide's technique
  // entries, research items and brief come last.
  const slim = (opts.cardContext ?? OUTLINE_DEFAULTS.cardContext) === "slim";
  const entries = catalogueEntries(techniqueFile);
  const design = designStyle(style.designStyle);
  const cardStyle = { look: style.look, colors: style.theme.colors, motion: style.motion, use3d: style.use3d, interactivity: style.interactivity, density: style.density };
  const slideLine = (s: (typeof slides)[number]) =>
    `${s.id} [${s.section}] ${s.role}, ${s.budgetSec} s, ${s.explainer} (${s.technique}), composition "${s.composition}", interaction ${s.interaction}, handoff: ${s.handoff}\n  point: ${s.point}`;
  const arcText = [
    `Deck: "${arc.title}". ${arc.throughline}`,
    `Visual throughline: ${arc.visualThroughline}`,
    `Motifs: ${arc.motifs.join("; ")}`,
    "Slides:",
    ...slides.map((s) => `- ${slideLine(s)}`),
  ].join("\n");
  const shared = slim
    ? `${header}\n\nStyle: ${JSON.stringify(cardStyle)}\n${design ? `Design style: ${design.name}. ${design.prompt}\n` : ""}\nThe deck's arc (fixed):\n${arcText}`
    : `${arcContext}\n\nThe deck's arc (fixed):\n${arcText}`;
  const cardSystem = loadPrompt("outline-card") + (slim ? "" : technique.appendix);
  const thinking = (opts.cardThinking ?? OUTLINE_DEFAULTS.cardThinking) === "off" ? { thinking: "off" as const } : {};

  let done = 0;
  const cards = await mapPool(slides, opts.concurrency ?? OUTLINE_DEFAULTS.concurrency, async (s, i) => {
    const prev = slides[i - 1];
    const next = slides[i + 1];
    let own = "";
    if (slim) {
      const notes = techniqueIdsOf(s.technique).flatMap((t) => (entries.has(t) ? [entries.get(t)!] : []));
      // The first item (usually the summary) always; the whole notes when the arc's ids match nothing.
      const keep = new Set([items[0]?.id ?? "", ...s.facts.filter((f) => items.some((it) => it.id === f))]);
      const research = keep.size > 1 ? renderResearch(items, keep) : renderResearch(items);
      own =
        (notes.length ? `Technique notes for this slide (how the engineer builds it):\n${notes.join("\n\n")}\n\n` : "") +
        `Research for this slide:\n${research}\n\n`;
    }
    const required =
      s.explainer === "simulation"
        ? "Required: visual.simulation (state, update rules, controls with ranges, readouts with units); the card is rejected without it.\n"
        : s.explainer === "3d-object" && style.use3d
          ? "Required: visual.object3d (parts, camera, lighting, states); the card is rejected without it.\n"
          : DATA_EXPLAINERS.has(s.explainer)
            ? "Required: visual.data with the actual values; the card is rejected without it.\n"
            : "";
    const ask =
      `Write the card for ${s.id} (slide ${i + 1} of ${slides.length}, section "${s.section}"). Density: ${style.density}.\n` +
      required +
      `This slide in the arc: ${slideLine(s)}\n` +
      (prev ? `Previous slide ${prev.id} (${prev.explainer}, ${prev.composition}) hands off: ${prev.handoff}\n` : "This is the opening slide.\n") +
      (next ? `Next slide ${next.id} (${next.explainer}, ${next.composition}); your exit sets up your handoff: ${s.handoff}\n` : "This is the closing slide.\n");
    const cardModel = opts.cardModel ?? MODELS.sonnet;
    const write = (model: string, validationRetries: number) =>
      llm.callTool({
        label: `outline:${s.id}`,
        model,
        system: cardSystem,
        user: `${shared}\n\n${own}${ask}`,
        maxTokens: opts.cardMaxTokens ?? OUTLINE_DEFAULTS.cardMaxTokens,
        timeoutMs: 10 * 60_000,
        validationRetries,
        ...thinking,
        tool: { name: "write_card", description: "Write this slide's card: its words and its visual direction.", schema: cardSchema(s, style) },
      });
    let data: CardDraft;
    try {
      ({ data } = await write(cardModel, opts.cardRetries ?? OUTLINE_DEFAULTS.cardRetries));
    } catch (e) {
      // One slide's card must not sink the stage: when the card model never complies, the arc model writes it once.
      const arcModel = opts.model ?? MODELS.opus;
      if (!(e instanceof LlmError) || !/invalid write_card/.test(e.message) || arcModel === cardModel) throw e;
      ({ data } = await write(arcModel, 1));
    }
    opts.onCard?.({ id: s.id, title: data.title, done: ++done, total: slides.length });
    return data;
  });

  const card = new Map(slides.map((s, i) => [s.id, cards[i]!]));
  const toSlide = (s: (typeof slides)[number]): OutlineSlide => {
    const c = card.get(s.id)!;
    return {
      id: s.id,
      title: c.title,
      ...(c.kicker ? { kicker: c.kicker } : {}),
      ...(c.subtitle ? { subtitle: c.subtitle } : {}),
      point: s.point,
      role: s.role,
      callouts: c.callouts,
      notes: c.notes,
      budgetSec: s.budgetSec,
      visual: { explainer: s.explainer, technique: s.technique, ...c.visual },
    };
  };
  return Outline.parse({
    title: arc.title,
    subtitle: arc.subtitle,
    throughline: arc.throughline,
    totalSec,
    visualThroughline: arc.visualThroughline,
    motifs: arc.motifs,
    sections: arc.sections.map((sec, si) => ({ name: sec.name, slides: slides.filter((s) => s.sectionIndex === si).map(toSlide) })),
  });
}
