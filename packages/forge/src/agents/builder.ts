// Builder: one slide's script + storyboard + style → slides/<id>.html, following the slide contract.
// A first draft (and a full rewrite) returns the whole fragment; a fix round can instead return search/replace edits on
// the previous version, applied here deterministically and checked against the contract before they are accepted.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Style } from "../contract.ts";
import { designBrief } from "../design-styles.ts";
import { MODELS, type ImageData, type Llm, type Part, type SystemBlock, type Thinking } from "../llm.ts";
import { THEME_VARS } from "../theme.ts";
import { contrastRatio, HEX } from "./contrast.ts";
import { FORGE_DIR, loadPrompt } from "./prompts.ts";
import { exemplarSection, loadExemplars, MAX_EXEMPLAR_CHARS, MAX_EXEMPLARS, pickExemplars, techniqueRules, type Exemplar } from "./exemplars.ts";
import type { Issue, ScriptSlide, Storyboard, StoryboardSlide } from "./schemas.ts";
import { checkSlideHtml } from "./slide-check.ts";

const SHELL_TYPES = join(FORGE_DIR, "src", "shell", "types.ts");
const SHELL_CSS = join(FORGE_DIR, "src", "shell", "shell.css");

export type BuildFix = {
  previousHtml: string;
  issues: Issue[];
  errors: string[];
  /** One screenshot of the previous render (the step of the first measured failure, else the last step reviewed). */
  screenshot?: ImageData;
  /** A presenter's change request (per-slide chat); it outranks the storyboard. */
  instruction?: string;
  /** The critic's score for the previous version, when it was reviewed. */
  score?: number;
};

export type BuilderInput = {
  deckTitle: string;
  style: Style;
  slide: ScriptSlide & { section?: string };
  board: StoryboardSlide;
  deck: Pick<Storyboard, "visualThroughline" | "motifs">;
  index: number;
  total: number;
  fix?: BuildFix;
};

/** "draft": the whole fragment; "patch": edits on fix.previousHtml (or the whole fragment); "rewrite": the whole fragment. */
export type BuildMode = "draft" | "patch" | "rewrite";

export type Edit = { find: string; replace: string };

/** Applies search/replace edits in order. Each `find` must occur exactly once in the text as it stands at that edit. */
export function applyEdits(html: string, edits: Edit[]): { html: string; errors: string[] } {
  const errors: string[] = [];
  let out = html;
  edits.forEach((e, i) => {
    const at = out.indexOf(e.find);
    const again = at < 0 ? -1 : out.indexOf(e.find, at + 1);
    if (at < 0) errors.push(`edits[${i}].find does not occur in the current version (copy it exactly, whitespace included)`);
    else if (again >= 0) errors.push(`edits[${i}].find occurs more than once; include more surrounding text so it is unique`);
    else out = out.slice(0, at) + e.replace + out.slice(at + e.find.length);
  });
  return { html: out, errors };
}

/**
 * The write_slide tool. Its JSON schema is the same for every call (drafts, edits, any slide), so the tool definition
 * never breaks the cached prompt prefix; what a call may return is enforced here. With `previousHtml` the call may
 * answer with `edits`, which must all apply and give a fragment that passes the contract check.
 */
export function builderSchema(id: string, previousHtml?: string) {
  const edit = z.object({
    find: z.string().min(1).describe("Exact text from the current version, whitespace included, long enough to occur exactly once."),
    replace: z.string().describe("What replaces it (empty to delete)."),
  });
  return z
    .object({
      html: z
        .string()
        .optional()
        .describe("The complete slide fragment: <section>, then optional <style>, then optional <script>. Required unless the user message asks for edits."),
      edits: z
        .array(edit)
        .optional()
        .describe("Revisions only, when the user message asks for edits: search/replace operations applied in order to the current version."),
      steps: z.number().int().min(1).max(8).describe("The number of steps the slide's step(i) supports."),
      summary: z.string().describe("Two sentences: what you built (or changed) and how the steps progress."),
    })
    .superRefine((d, ctx) => {
      const fail = (message: string, path: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: [path] });
      let html = d.html;
      if (html === undefined) {
        if (!previousHtml) return fail("Give the complete fragment in html.", "html");
        if (!d.edits?.length) return fail("Give edits (or the complete fragment in html).", "edits");
        const applied = applyEdits(previousHtml, d.edits);
        if (applied.errors.length) return applied.errors.forEach((m) => fail(m, "edits"));
        html = applied.html;
      } else if (d.edits?.length) {
        return fail("Give either html or edits, not both.", "edits");
      }
      if (html.length < 200) fail("The fragment is too short to be a slide.", d.html === undefined ? "edits" : "html");
      for (const message of checkSlideHtml(html, id)) fail(message, d.html === undefined ? "edits" : "html");
    })
    .transform((d) => ({
      html: fixTokenNames(d.html ?? applyEdits(previousHtml!, d.edits!).html),
      steps: d.steps,
      summary: d.summary,
      edits: d.html === undefined ? d.edits!.length : 0,
    }));
}

/** Rules, API types and kit classes: identical for every builder call, so one cached prefix serves every slide. */
export function builderStatic(shellTypesFile = SHELL_TYPES, shellCssFile = SHELL_CSS): string {
  let system = loadPrompt("builder");
  if (existsSync(shellTypesFile)) {
    system += `\n\n## Exact API types (from the shell)\n\n\`\`\`ts\n${readFileSync(shellTypesFile, "utf8")}\n\`\`\`\n`;
  }
  if (existsSync(shellCssFile)) {
    const css = readFileSync(shellCssFile, "utf8");
    const at = css.indexOf("kit (optional, global)");
    const start = at < 0 ? -1 : css.lastIndexOf("/*", at);
    if (start >= 0) {
      system += `\n\n## Shell kit classes (global and already loaded: use them, and adjust under #<id> when needed)\n\n\`\`\`css\n${css.slice(start).trim()}\n\`\`\`\n`;
    }
  }
  return system + techniqueRules();
}

/**
 * Theme variable names models guess wrong (`--df-accent2` for `--df-accent-2`), mapped to the shell's. An undefined
 * var() renders black (SVG fills) or transparent/inherited (CSS), which reviews kept reporting as contrast and
 * missing-colour failures.
 */
export function fixTokenNames(html: string): string {
  return html.replace(/--df-accent-?([123])\b/g, (_, n: string) => (n === "1" ? "--df-accent" : `--df-accent-${n}`));
}

/**
 * The theme for the builder: each colour by its exact CSS variable with its value, its WCAG contrast on bg and
 * surface, and (for accents) which text colour reads on it as a fill; then fonts and backdrop.
 */
export function themeTokens(theme: Style["theme"]): string {
  const c = theme.colors;
  const ratio = (a: string, b: string) => (HEX.test(a) && HEX.test(b) ? contrastRatio(a, b) : NaN);
  const fmt = (r: number) => (Number.isNaN(r) ? "?" : `${r.toFixed(1)}:1`);
  const keys = Object.keys(THEME_VARS.colors) as (keyof typeof c)[];
  const lines = keys.map((k) => {
    const head = `- ${k} → var(${THEME_VARS.colors[k]}) = ${c[k]}`;
    if (k === "bg") return head;
    if (k === "surface") return `${head} (panels, chips)`;
    const onBg = ratio(c[k], c.bg);
    let line = `${head}: ${fmt(onBg)} on bg, ${fmt(ratio(c[k], c.surface))} on surface`;
    if (onBg < 3) line += "; never text, and shapes in it need a var(--df-text) outline";
    else if (onBg < 4.5) line += "; text from 24px and marks only";
    if (k.startsWith("accent")) {
      const [best] = (["bg", "text"] as const).map((t) => ({ t, r: ratio(c[t], c[k]) })).sort((a, b) => (b.r || 0) - (a.r || 0));
      line += `; text on an ${k} fill: var(${THEME_VARS.colors[best!.t]}) (${fmt(best!.r)})`;
    }
    return line;
  });
  return [
    "Theme tokens. In CSS use exactly these variable names (the storyboard's accent2 is var(--df-accent-2)); any other name (--df-accent2, --accent3, --blue) is undefined and renders black or transparent. In JS: api.theme.colors.<name>.",
    "Text under 24px needs 4.5:1 against what it sits on; larger text and meaningful lines or shapes 3:1, dimmed states included.",
    ...lines,
    `Fonts: ${JSON.stringify(theme.fonts)}; backdrop: ${theme.backdrop ?? "bg"}`,
  ].join("\n");
}

/** The deck-wide brief (style, design, theme tokens, throughline): identical for every slide of this deck. */
export function builderDeck(input: Pick<BuilderInput, "deckTitle" | "style" | "deck">): string {
  const { style, deck } = input;
  return [
    `## This deck: "${input.deckTitle}"`,
    "",
    "Style:",
    JSON.stringify({ look: style.look, motion: style.motion, use3d: style.use3d, interactivity: style.interactivity, density: style.density }),
    "",
    designBrief(style),
    "",
    themeTokens(style.theme),
    "",
    `Deck visual throughline: ${deck.visualThroughline}`,
    `Shared motifs:\n${deck.motifs.map((m) => `- ${m}`).join("\n")}`,
  ].join("\n");
}

/**
 * The builder's system prompt as three cached blocks, most stable first: the static rules (every slide, every deck),
 * the deck brief (every slide of this deck) and the slide's technique guide and exemplars (every round of this slide).
 */
export function builderSystem(
  input: Pick<BuilderInput, "deckTitle" | "style" | "deck">,
  exemplars: Exemplar[],
  board?: Pick<StoryboardSlide, "explainer" | "technique">,
  opts: { exemplarChars?: number } = {},
): SystemBlock[] {
  return [
    { text: builderStatic(), cache: true },
    { text: builderDeck(input), cache: true },
    { text: exemplarSection(exemplars, board, undefined, opts.exemplarChars ?? MAX_EXEMPLAR_CHARS).trim(), cache: true },
  ];
}

/** What the pre-check measures, first in every builder message (a failure sends the slide straight back). */
const HARD_CHECKS =
  "Hard checks on the rendered page (any failure sends the slide straight back): all text inside x 96…1824, y 72…1008; " +
  "no text under 18px; text never overlaps other text and never clips or overflows its box (no overflow:hidden on a box that holds copy); " +
  "every step visibly changes something; canvases draw; no console errors; nothing fetched from the network.";

const omit = <T extends object>(o: T, keys: string[]) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));

export function builderUser(input: BuilderInput, mode: BuildMode = input.fix ? "rewrite" : "draft"): Part[] {
  const { slide, board, fix } = input;
  const parts: Part[] = [];
  // Only the fields the builder uses: no ids, timing or rationale; compact JSON.
  const words = omit(slide, ["id", "section", "budgetSec"]);
  const visual = omit(board, ["id", "why"]);
  const text = [
    HARD_CHECKS,
    "",
    `Slide id: ${slide.id} (slide ${input.index + 1} of ${input.total}${slide.section ? `, section "${slide.section}"` : ""}).`,
    "",
    "Script for this slide (use the words verbatim):",
    JSON.stringify(words),
    "",
    "Storyboard for this slide (build exactly this):",
    JSON.stringify(visual),
  ].join("\n");
  parts.push({ type: "text", text });
  if (fix?.instruction) {
    parts.push({
      type: "text",
      text: `\n\nThe presenter asked for this change (it outranks the storyboard where they conflict):\n${fix.instruction}`,
    });
  }
  if (fix) {
    const issues = fix.issues.map((i) => `- [${i.severity}${i.kind ? `, ${i.kind}` : ""}] ${i.what} (where: ${i.where}). Fix: ${i.fix}`).join("\n") || "- (none)";
    const errors = fix.errors.length ? fix.errors.map((e) => `- ${e}`).join("\n") : "- (none)";
    const scored =
      fix.score === undefined
        ? ""
        : `The reviewer scored this version ${fix.score}/10. Change as little as possible: fix the issues below and keep everything else exactly as it is.\n\n`;
    const answer =
      mode === "patch"
        ? "Fix every issue and error while keeping what works. Answer with `edits`: search/replace operations applied in order to the current version. " +
          "Copy each `find` exactly from the current version (whitespace included), long enough to occur exactly once, and keep edits small and targeted. " +
          "Only if the fix needs most of the slide rewritten, answer with the complete fragment in `html` instead."
        : "Fix every issue and error while keeping what works. Return the complete revised fragment in `html`.";
    parts.push({
      type: "text",
      text:
        `\n\nThis is a revision of the current version.\n\n${scored}Review issues:\n${issues}\n\n` +
        `Console, page and contract errors:\n${errors}\n\nCurrent version:\n\`\`\`html\n${fix.previousHtml}\n\`\`\`\n\n` +
        answer +
        (fix.screenshot ? " The screenshot below is the current render of one step (the step of the first measured issue, otherwise the last step)." : ""),
    });
    if (fix.screenshot) parts.push({ type: "image", ...fix.screenshot });
  }
  return parts;
}

const TOOL = { name: "write_slide", description: "Write the slide fragment, or edit the current version." };

export type BuilderOpts = { model?: string; exemplars?: Exemplar[]; thinking?: Thinking; mode?: BuildMode; maxExemplars?: number; exemplarChars?: number };

/** The exemplars a slide's builder calls use (by technique; ties lean away from decks that look like this one). */
export function builderExemplars(input: Pick<BuilderInput, "style" | "deckTitle" | "board">, opts: Pick<BuilderOpts, "exemplars" | "maxExemplars"> = {}): Exemplar[] {
  return pickExemplars(opts.exemplars ?? loadExemplars(), input.board, { avoid: `${input.style.look} ${input.deckTitle}`, max: opts.maxExemplars ?? MAX_EXEMPLARS });
}

export async function runBuilder(
  llm: Llm,
  input: BuilderInput,
  opts: BuilderOpts = {},
): Promise<{ html: string; steps: number; summary: string; edits: number }> {
  const mode = opts.mode ?? (input.fix ? "rewrite" : "draft");
  const exemplars = builderExemplars(input, opts);
  const { data } = await llm.callTool({
    label: `builder:${input.slide.id}`,
    model: opts.model ?? MODELS.sonnet,
    system: builderSystem(input, exemplars, input.board, { ...(opts.exemplarChars ? { exemplarChars: opts.exemplarChars } : {}) }),
    user: builderUser(input, mode),
    maxTokens: 48000,
    timeoutMs: 6 * 60_000,
    // Thinking before a long code answer multiplied output 3-6x (and hit max_tokens); off unless asked for.
    thinking: opts.thinking ?? "off",
    tool: { ...TOOL, schema: builderSchema(input.slide.id, mode === "patch" ? input.fix?.previousHtml : undefined) },
  });
  return data;
}

/** Writes the builder's deck-wide prefix (static rules + deck brief) to the cache before slides start in parallel. */
export async function warmBuilder(llm: Llm, input: Pick<BuilderInput, "deckTitle" | "style" | "deck">, opts: { model?: string; thinking?: Thinking } = {}): Promise<void> {
  if (!llm.warm) return;
  await llm.warm({
    label: "builder:warm",
    model: opts.model ?? MODELS.sonnet,
    system: builderSystem(input, []).slice(0, 2),
    thinking: opts.thinking ?? "off",
    tool: { ...TOOL, schema: builderSchema("s00") },
  });
}
export type { Exemplar };
