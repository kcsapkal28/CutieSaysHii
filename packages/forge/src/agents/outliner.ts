// Outliner: research + style → outline.json, in two passes.
//   1. The arc (one call): the deck's story, sections and slides; per slide its point, role, time budget, primary
//      explainer technique and composition, chosen across the whole deck so techniques and layouts vary.
//   2. The cards (one call per slide, run concurrently): each arc entry expanded into the slide's words and full visual
//      direction, given the whole arc, the research and the style.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Style } from "../contract.ts";
import { designBrief } from "../design-styles.ts";
import { MODELS, type Llm } from "../llm.ts";
import { FORGE_DIR, loadPrompt } from "./prompts.ts";
import { Explainer, Outline, ROLES, ScriptSlide, Storyboard, StoryboardSlide, Visual, type Brief, type OutlineSlide } from "./schemas.ts";

export const TECHNIQUES_FILE = join(FORGE_DIR, "fixtures", "exemplars", "TECHNIQUES.md");
const LIGHT_INTERACTIONS = new Set(["none", "click", "hover", "toggle"]);
const WORDY = new Set(["typographic", "quote"]);

export const slideId = (n: number) => `s${String(n).padStart(2, "0")}`;

/** Scales budgets so they add up to the talk length, rounded to 5 s (the last slide absorbs the rounding). */
export function normalizeBudgets(budgets: number[], totalSec: number): number[] {
  const sum = budgets.reduce((a, b) => a + b, 0) || 1;
  const scaled = budgets.map((b) => Math.max(15, Math.round((b * totalSec) / sum / 5) * 5));
  const drift = totalSec - scaled.reduce((a, b) => a + b, 0);
  if (scaled.length) scaled[scaled.length - 1] = Math.max(15, scaled[scaled.length - 1]! + drift);
  return scaled;
}

/** Technique ids defined in the catalogue ("## `id`" headings). */
export function catalogueIds(file = TECHNIQUES_FILE): string[] {
  if (!existsSync(file)) return [];
  return [...readFileSync(file, "utf8").matchAll(/^## `([a-z0-9-]+)`/gm)].map((m) => m[1]!);
}

/** Prompt wiring for the engine's technique catalogue: a pointer after the explainer list and the full catalogue appended. */
function techniquePrompt(file: string): { pointer: string; appendix: string } {
  if (!existsSync(file)) return { pointer: "", appendix: "" };
  return {
    pointer:
      "\nThen set `technique` to the catalogue id(s) that implement it (see the Technique catalogue at the end; comma-separate when a slide combines two, e.g. `exploded-3d, annotated-labels`). The engineer studies hand-built exemplars of each technique.\n",
    appendix: `\n\n# Technique catalogue\n\n${readFileSync(file, "utf8").trim()}\n`,
  };
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
export function arcProblems(slides: (ArcSlide & { id: string })[], style: Style, techniqueIds: string[] = []): string[] {
  const problems: string[] = [];
  if (techniqueIds.length) {
    for (const s of slides) {
      const unknown = s.technique.split(/[\s,+/]+/).filter((t) => t && !techniqueIds.includes(t));
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

export const CardDraft = z.object({
  title: ScriptSlide.shape.title,
  kicker: ScriptSlide.shape.kicker,
  subtitle: ScriptSlide.shape.subtitle,
  callouts: ScriptSlide.shape.callouts,
  notes: ScriptSlide.shape.notes,
  visual: Visual.omit({ explainer: true, technique: true }).extend({
    entry: z.string().describe("The state at step 1, picking up the previous slide's handoff (or a clean start after a cut)."),
    exit: z.string().describe("The state at the last step, setting up this slide's handoff to the next slide."),
  }),
});
export type CardDraft = z.infer<typeof CardDraft>;

export function cardSchema(slide: { id: string; explainer: string }, style: Style) {
  return CardDraft.superRefine((card, ctx) => {
    const planned = { id: slide.id, explainer: slide.explainer, interaction: card.visual.interaction.kind, object3d: card.visual.object3d, simulation: card.visual.simulation };
    for (const message of styleProblems(planned, style, { specs: true })) ctx.addIssue({ code: z.ZodIssueCode.custom, message });
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
  model?: string;
  /** Card calls in flight at once. */
  concurrency?: number;
  techniquesFile?: string;
  /** The arc is planned (before any card is written). */
  onArc?: (arc: { title: string; sections: number; slides: { id: string; point: string }[] }) => void;
  /** A slide's card is written (`done` of `total`). */
  onCard?: (card: { id: string; title: string; done: number; total: number }) => void;
};

export async function runOutline(llm: Llm, input: OutlineInput, opts: OutlineOptions = {}): Promise<Outline> {
  const { brief, style, researchMd } = input;
  const model = opts.model ?? MODELS.opus;
  const techniqueFile = opts.techniquesFile ?? TECHNIQUES_FILE;
  const technique = techniquePrompt(techniqueFile);
  const totalSec = Math.round(brief.minutes * 60);
  const styleBrief = {
    look: style.look,
    colors: style.theme.colors,
    fonts: style.theme.fonts,
    motion: style.motion,
    use3d: style.use3d,
    interactivity: style.interactivity,
    density: style.density,
  };
  const context =
    `Topic: ${brief.topic}\nAudience: ${brief.audience}\nTalk length: ${brief.minutes} minutes (${totalSec} s)\n\n` +
    `Style:\n${JSON.stringify(styleBrief, null, 2)}\n\n${designBrief(style)}\n\nResearch notes:\n${researchMd}`;

  const { data: arc } = await llm.callTool({
    label: "outline:arc",
    model,
    system: loadPrompt("outline", { techniques: technique.pointer }) + technique.appendix,
    user: context,
    maxTokens: 8000,
    timeoutMs: 10 * 60_000,
    validationRetries: 2,
    tool: { name: "plan_arc", description: "Plan the deck's arc: sections and slides, with each slide's point, time and visual approach.", schema: arcSchema(style, catalogueIds(techniqueFile)) },
  });
  const planned = arcSlides(arc);
  const budgets = normalizeBudgets(planned.map((s) => s.budgetSec), totalSec);
  const slides = planned.map((s, i) => ({ ...s, budgetSec: budgets[i]! }));
  opts.onArc?.({ title: arc.title, sections: arc.sections.length, slides: slides.map((s) => ({ id: s.id, point: s.point })) });

  // Every card call shares the same system prompt and context prefix; only the closing slide brief differs.
  const arcView = {
    title: arc.title,
    throughline: arc.throughline,
    visualThroughline: arc.visualThroughline,
    motifs: arc.motifs,
    slides: slides.map((s) => ({
      id: s.id,
      section: s.section,
      point: s.point,
      role: s.role,
      budgetSec: s.budgetSec,
      explainer: s.explainer,
      technique: s.technique,
      composition: s.composition,
      interaction: s.interaction,
      handoff: s.handoff,
    })),
  };
  const cardSystem = loadPrompt("outline-card") + technique.appendix;
  const shared = `${context}\n\nThe deck's arc (fixed):\n${JSON.stringify(arcView, null, 2)}`;
  let done = 0;
  const cards = await mapPool(slides, opts.concurrency ?? 6, async (s, i) => {
    const prev = slides[i - 1];
    const next = slides[i + 1];
    const ask =
      `Write the card for ${s.id} (slide ${i + 1} of ${slides.length}, section "${s.section}"). Density: ${style.density}.\n` +
      `This slide in the arc:\n${JSON.stringify(arcView.slides[i], null, 2)}\n` +
      (prev ? `Previous slide ${prev.id} (${prev.explainer}, ${prev.composition}) hands off: ${prev.handoff}\n` : "This is the opening slide.\n") +
      (next ? `Next slide ${next.id} (${next.explainer}, ${next.composition}); your exit sets up your handoff: ${s.handoff}\n` : "This is the closing slide.\n");
    const { data } = await llm.callTool({
      label: `outline:${s.id}`,
      model,
      system: cardSystem,
      user: `${shared}\n\n${ask}`,
      maxTokens: 12000,
      timeoutMs: 10 * 60_000,
      tool: { name: "write_card", description: "Write this slide's card: its words and its visual direction.", schema: cardSchema(s, style) },
    });
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
