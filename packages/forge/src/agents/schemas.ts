// Stage file shapes (what lands in projects/<slug>/) and the agents' tool schemas.
import { z } from "zod";
import { Features, MotionLevel } from "../contract.ts";

// ---- brief.json ----

export const StylePrefs = z
  .object({
    /** Free-text wishes, e.g. "dark and cinematic, like a product teardown". */
    notes: z.string().optional(),
    dark: z.boolean().optional(),
    motion: MotionLevel.optional(),
    use3d: z.boolean().optional(),
    interactivity: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
    density: z.enum(["airy", "balanced", "dense"]).optional(),
    features: Features.partial().optional(),
    fonts: z.object({ display: z.string().optional(), body: z.string().optional(), mono: z.string().optional() }).optional(),
  })
  .default({});
export type StylePrefs = z.infer<typeof StylePrefs>;

export const Brief = z.object({
  topic: z.string().min(3),
  audience: z.string().min(1),
  minutes: z.number().positive().max(120),
  prefs: StylePrefs,
  createdAt: z.string(),
});
export type Brief = z.infer<typeof Brief>;

// ---- research (rendered to research.md) ----

export const Source = z.object({
  title: z.string(),
  url: z.string().optional().describe("Only for web results; never invent URLs."),
  kind: z.enum(["model-knowledge", "web"]),
  note: z.string().optional(),
});
export type Source = z.infer<typeof Source>;

export const Research = z.object({
  summary: z.string().describe("3–5 sentences: what the topic is and the one insight that makes it click."),
  keyFacts: z.array(z.object({ fact: z.string(), detail: z.string() })).min(5),
  numbers: z
    .array(z.object({ value: z.string().describe('e.g. "20–1000 Hz", "< 50 µs"'), what: z.string(), context: z.string() }))
    .min(3),
  mechanisms: z
    .array(z.object({ name: z.string(), howItWorks: z.string(), steps: z.array(z.string()) }))
    .min(2)
    .describe("Causal chains, in order: the things a visual can animate."),
  visualHooks: z.array(z.string()).min(3).describe("Concrete things a slide could show or let the viewer manipulate."),
  misconceptions: z.array(z.string()),
  glossary: z.array(z.object({ term: z.string(), definition: z.string() })),
  sources: z.array(Source).min(1),
});
export type Research = z.infer<typeof Research>;

// ---- legacy outline.json (before Outline, Script and Storyboard were one stage; see pipeline/migrate.ts) ----

export const LegacyOutline = z.object({
  title: z.string(),
  subtitle: z.string(),
  throughline: z.string(),
  totalSec: z.number().int(),
  sections: z.array(
    z.object({
      name: z.string(),
      slides: z.array(z.object({ id: z.string(), keyMessage: z.string(), role: z.string(), budgetSec: z.number().int() })),
    }),
  ),
});
export type LegacyOutline = z.infer<typeof LegacyOutline>;

// ---- the builder's and critic's inputs: Script and Storyboard, derived from outline.json (toScript, toStoryboard) ----

export const ScriptSlide = z.object({
  id: z.string(),
  title: z.string().describe('A sentence-case claim, e.g. "Five one-way channels, each with its own handshake". Max ~60 characters.'),
  kicker: z.string().optional().describe('Optional tiny overline, e.g. "PART 2 · THE CRISIS".'),
  subtitle: z.string().optional().describe("Optional one line under the title or a caption. Max ~110 characters."),
  callouts: z
    .array(z.string())
    .describe("The short on-slide text the visual needs: part labels, legend entries, readouts, one-line stats. 0–8 items, each ≤ 40 characters."),
  notes: z.string().describe("Speaker notes: what the presenter says, 60–180 words."),
  budgetSec: z.number().int().positive(),
});
export type ScriptSlide = z.infer<typeof ScriptSlide>;

export const Script = z.object({
  title: z.string(),
  slides: z.array(ScriptSlide.extend({ section: z.string() })),
});
export type Script = z.infer<typeof Script>;

export const EXPLAINERS = [
  "3d-object",
  "simulation",
  "animated-diagram",
  "data-viz",
  "timeline",
  "map",
  "comparison",
  "quote",
  "typographic",
  "image-led",
] as const;
export const Explainer = z.enum(EXPLAINERS);
export const COLOR_TOKENS = ["bg", "surface", "text", "muted", "line", "accent", "accent2", "accent3"] as const;

export const Object3d = z.object({
  name: z.string(),
  parts: z
    .array(
      z.object({
        name: z.string().describe("Stable part id, e.g. intake-valve"),
        label: z.string().describe("Callout text shown on the slide"),
        geometry: z.string().describe("How to model it from Three.js primitives (Lathe/Capsule/Cylinder/Torus/Box/Extrude…), with proportions"),
        material: z.string().describe("e.g. glossy white plastic (MeshPhysical, clearcoat 1, roughness .25)"),
        color: z.string().describe("A theme token name or a neutral material colour such as #f4f4f6 for white plastic"),
        placement: z.string().describe("Where it sits assembled and in the exploded view"),
      }),
    )
    .min(2),
  camera: z.string(),
  lighting: z.string(),
  states: z.array(z.string()).describe("Named states the object moves through, e.g. assembled → exploded → x-ray"),
});

export const StoryboardSlide = z.object({
  id: z.string(),
  concept: z.string().describe("What the viewer sees, concretely and vividly: objects, positions, colours, what moves."),
  explainer: Explainer,
  technique: z.string().describe("The specific explainer technique, by its catalogue name when a catalogue is given (e.g. \"exploded-3d-callouts\", \"particle-flow\", \"slider-simulation\")."),
  why: z.string().describe("Why this visual explains the key message better than any alternative."),
  layout: z.string().describe("Composition on the 1920×1080 canvas: where the title, visual, callouts and caption sit."),
  interaction: z.object({
    kind: z.enum(["none", "click", "hover", "toggle", "slider", "drag"]),
    description: z.string().describe("What the viewer can do and what visibly changes. Empty when kind is none."),
  }),
  steps: z
    .array(z.object({ beat: z.string().describe("What changes on screen at this step"), motion: z.string().describe("How it moves (or 'none')") }))
    .min(1)
    .max(8),
  object3d: Object3d.optional(),
  simulation: z
    .object({
      model: z.string().describe("State and update rules, precise enough to code"),
      controls: z.array(z.string()),
      readouts: z.array(z.string()),
    })
    .optional(),
  data: z.string().optional().describe("For data-viz, timeline, map and comparison: the actual values, units, dates, places or items"),
  reducedMotion: z.string().describe("What the slide shows when motion is off"),
  entry: z.string().optional().describe("What is on screen at step 1, picking up where the previous slide left off (or a clean cut)."),
  exit: z.string().optional().describe("The state at the last step, set up so the next slide can pick it up."),
});
export type StoryboardSlide = z.infer<typeof StoryboardSlide>;

export const Storyboard = z.object({
  visualThroughline: z.string().describe("The recurring visual idea that ties the deck together."),
  motifs: z.array(z.string()).describe("Shared visual vocabulary: label style, particle colours per signal, line weights."),
  slides: z.array(StoryboardSlide).min(1),
});
export type Storyboard = z.infer<typeof Storyboard>;

// ---- outline.json: the deck's arc plus one card per slide (the words and the visual direction together) ----

export const ROLES = ["opener", "context", "mechanism", "evidence", "comparison", "tradeoff", "recap", "closer"] as const;

/** A slide's visual direction: its storyboard entry without the id. */
export const Visual = StoryboardSlide.omit({ id: true });
export type Visual = z.infer<typeof Visual>;

export const OutlineSlide = z.object({
  id: z.string(),
  title: ScriptSlide.shape.title,
  kicker: ScriptSlide.shape.kicker,
  subtitle: ScriptSlide.shape.subtitle,
  point: z.string().describe("The single idea this slide lands, as a full sentence."),
  role: z.string(),
  callouts: ScriptSlide.shape.callouts,
  notes: ScriptSlide.shape.notes,
  budgetSec: z.number().int().positive(),
  visual: Visual,
});
export type OutlineSlide = z.infer<typeof OutlineSlide>;

export const Outline = z.object({
  title: z.string(),
  subtitle: z.string(),
  throughline: z.string(),
  /** The talk length the budgets were planned for (edits can make the slides' sum drift from it). */
  totalSec: z.number().int(),
  visualThroughline: Storyboard.shape.visualThroughline,
  motifs: Storyboard.shape.motifs,
  sections: z.array(z.object({ name: z.string(), slides: z.array(OutlineSlide) })),
});
export type Outline = z.infer<typeof Outline>;

/** Every slide in deck order, with its section name. */
export const outlineSlides = (o: Outline): (OutlineSlide & { section: string })[] =>
  o.sections.flatMap((s) => s.slides.map((sl) => ({ ...sl, section: s.name })));

/** The builder's script (the words per slide), derived from the outline. */
export function toScript(o: Outline): Script {
  return {
    title: o.title,
    slides: outlineSlides(o).map((s) => ({
      id: s.id,
      title: s.title,
      ...(s.kicker ? { kicker: s.kicker } : {}),
      ...(s.subtitle ? { subtitle: s.subtitle } : {}),
      callouts: s.callouts,
      notes: s.notes,
      budgetSec: s.budgetSec,
      section: s.section,
    })),
  };
}

/** The builder's and critic's storyboard (the visual direction per slide), derived from the outline. */
export function toStoryboard(o: Outline): Storyboard {
  return { visualThroughline: o.visualThroughline, motifs: o.motifs, slides: outlineSlides(o).map((s) => ({ id: s.id, ...s.visual })) };
}

// ---- critic ----

export const Issue = z.object({
  severity: z.enum(["high", "medium", "low"]),
  what: z.string(),
  where: z.string().describe("Step number and a CSS selector when you can tell it, else the region, e.g. 'step 2, #s03 .legend (bottom-left)'"),
  fix: z.string().describe("A concrete code-level fix, with the measured or target number when there is one"),
});
export type Issue = z.infer<typeof Issue>;

export const CriticReport = z.object({
  verdict: z.enum(["pass", "fix"]),
  score: z.number().min(0).max(10).describe("Polish against the reference decks: 10 = indistinguishable, 6 = decent but generic, 3 = broken."),
  summary: z.string(),
  issues: z.array(Issue).describe("At most 5, the most important first; leave out anything that doesn't matter."),
});
export type CriticReport = z.infer<typeof CriticReport>;
