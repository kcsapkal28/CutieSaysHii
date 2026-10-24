// Builder: one slide's script + storyboard + style → slides/<id>.html, following the slide contract.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Style } from "../contract.ts";
import { MODELS, type Llm, type Part } from "../llm.ts";
import { FORGE_DIR, loadPrompt } from "./prompts.ts";
import type { Issue, ScriptSlide, Storyboard, StoryboardSlide } from "./schemas.ts";
import { checkSlideHtml } from "./slide-check.ts";

export const EXEMPLAR_DIRS = [join(FORGE_DIR, "fixtures", "proof", "slides"), join(FORGE_DIR, "fixtures", "proof")];
const SHELL_TYPES = join(FORGE_DIR, "src", "shell", "types.ts");
const SHELL_CSS = join(FORGE_DIR, "src", "shell", "shell.css");
const MAX_EXEMPLAR_CHARS = 18_000;

export type Exemplar = { name: string; html: string };

/** Hand-built proof slides used as few-shot examples; empty when the engine's fixtures aren't there. */
export function loadExemplars(dirs = EXEMPLAR_DIRS): Exemplar[] {
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir)
      .filter((f) => /^s\d{2}\.html$/.test(f))
      .sort();
    if (files.length) return files.map((f) => ({ name: f, html: readFileSync(join(dir, f), "utf8") }));
  }
  return [];
}

/** Up to two exemplars: one that matches the slide's kind (3D or not), one that differs, shortest first. */
export function pickExemplars(all: Exemplar[], explainer: StoryboardSlide["explainer"], max = 2): Exemplar[] {
  const fits = all.filter((e) => e.html.length <= MAX_EXEMPLAR_CHARS);
  const is3d = (e: Exemplar) => /\.three\(/.test(e.html);
  const want3d = explainer === "3d-object";
  const byLen = (a: Exemplar, b: Exemplar) => a.html.length - b.html.length;
  const same = fits.filter((e) => is3d(e) === want3d).sort(byLen);
  const other = fits.filter((e) => is3d(e) !== want3d).sort(byLen);
  return [...same.slice(0, 1), ...other.slice(0, 1), ...same.slice(1)].slice(0, max);
}

export type BuildFix = {
  previousHtml: string;
  issues: Issue[];
  errors: string[];
  /** One screenshot of the previous render (the last step), so the builder sees what the critic saw. */
  screenshot?: Buffer;
  /** A presenter's change request (per-slide chat); it outranks the storyboard. */
  instruction?: string;
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

export function builderSchema(id: string) {
  return z.object({
    html: z
      .string()
      .min(200)
      .describe("The complete slide fragment: <section>, then optional <style>, then optional <script>.")
      .superRefine((html, ctx) => {
        for (const message of checkSlideHtml(html, id)) ctx.addIssue({ code: z.ZodIssueCode.custom, message });
      }),
    steps: z.number().int().min(1).max(8).describe("The number of steps the slide's step(i) supports."),
    summary: z.string().describe("Two sentences: what you built and how the steps progress."),
  });
}

export function builderSystem(exemplars: Exemplar[], shellTypesFile = SHELL_TYPES, shellCssFile = SHELL_CSS): string {
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
  if (exemplars.length) {
    system += "\n\n## Exemplar slides\n\nHand-built slides that meet the bar and follow the contract. Match their structure and craft, not their content.\n";
    for (const e of exemplars) system += `\n### ${e.name}\n\n\`\`\`html\n${e.html.trim()}\n\`\`\`\n`;
  }
  return system;
}

export function builderUser(input: BuilderInput): Part[] {
  const { style, slide, board, deck, fix } = input;
  const parts: Part[] = [];
  const text = [
    `Slide id: ${slide.id} (slide ${input.index + 1} of ${input.total}${slide.section ? `, section "${slide.section}"` : ""}) in the deck "${input.deckTitle}".`,
    "",
    "Style:",
    JSON.stringify({ look: style.look, motion: style.motion, use3d: style.use3d, interactivity: style.interactivity, density: style.density }, null, 2),
    "",
    "Theme tokens (CSS variables --df-* in CSS; api.theme in JS):",
    JSON.stringify(style.theme, null, 2),
    "",
    `Deck visual throughline: ${deck.visualThroughline}`,
    `Shared motifs:\n${deck.motifs.map((m) => `- ${m}`).join("\n")}`,
    "",
    "Script for this slide (use the words verbatim):",
    JSON.stringify(slide, null, 2),
    "",
    "Storyboard for this slide (build exactly this):",
    JSON.stringify(board, null, 2),
  ].join("\n");
  parts.push({ type: "text", text });
  if (fix?.instruction) {
    parts.push({
      type: "text",
      text: `\n\nThe presenter asked for this change (it outranks the storyboard where they conflict):\n${fix.instruction}`,
    });
  }
  if (fix) {
    const issues = fix.issues.map((i) => `- [${i.severity}] ${i.what} (where: ${i.where}). Fix: ${i.fix}`).join("\n") || "- (none)";
    const errors = fix.errors.length ? fix.errors.map((e) => `- ${e}`).join("\n") : "- (none)";
    parts.push({
      type: "text",
      text:
        `\n\nThis is a revision of the current version.\n\nReview issues:\n${issues}\n\n` +
        `Console, page and contract errors:\n${errors}\n\nCurrent version:\n\`\`\`html\n${fix.previousHtml}\n\`\`\`\n\n` +
        "Fix every issue and error while keeping what works. Return the complete revised fragment." +
        (fix.screenshot ? " The screenshot below is the current render of the last step." : ""),
    });
    if (fix.screenshot) parts.push({ type: "image", png: fix.screenshot });
  }
  return parts;
}

export async function runBuilder(
  llm: Llm,
  input: BuilderInput,
  opts: { model?: string; exemplars?: Exemplar[] } = {},
): Promise<{ html: string; steps: number; summary: string }> {
  const exemplars = pickExemplars(opts.exemplars ?? loadExemplars(), input.board.explainer);
  const { data } = await llm.callTool({
    label: `builder:${input.slide.id}`,
    model: opts.model ?? MODELS.sonnet,
    system: builderSystem(exemplars),
    user: builderUser(input),
    maxTokens: 32000,
    timeoutMs: 15 * 60_000,
    tool: { name: "write_slide", description: "Write the slide fragment.", schema: builderSchema(input.slide.id) },
  });
  return data;
}
