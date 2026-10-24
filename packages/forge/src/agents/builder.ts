// Builder: one slide's script + storyboard + style → slides/<id>.html, following the slide contract.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Style } from "../contract.ts";
import { designBrief } from "../design-styles.ts";
import { MODELS, type ImageData, type Llm, type Part } from "../llm.ts";
import { FORGE_DIR, loadPrompt } from "./prompts.ts";
import { exemplarSection, loadExemplars, pickExemplars, type Exemplar } from "./exemplars.ts";
import type { Issue, ScriptSlide, Storyboard, StoryboardSlide } from "./schemas.ts";
import { checkSlideHtml } from "./slide-check.ts";

const SHELL_TYPES = join(FORGE_DIR, "src", "shell", "types.ts");
const SHELL_CSS = join(FORGE_DIR, "src", "shell", "shell.css");

export type BuildFix = {
  previousHtml: string;
  issues: Issue[];
  errors: string[];
  /** One screenshot of the previous render (the last step), so the builder sees what the critic saw. */
  screenshot?: ImageData;
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

export function builderSystem(
  exemplars: Exemplar[],
  board?: Pick<StoryboardSlide, "explainer" | "technique">,
  shellTypesFile = SHELL_TYPES,
  shellCssFile = SHELL_CSS,
): string {
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
  system += exemplarSection(exemplars, board);
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
    designBrief(style),
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
    if (fix.screenshot) parts.push({ type: "image", ...fix.screenshot });
  }
  return parts;
}

export async function runBuilder(
  llm: Llm,
  input: BuilderInput,
  opts: { model?: string; exemplars?: Exemplar[]; thinking?: "off" | "model" } = {},
): Promise<{ html: string; steps: number; summary: string }> {
  // Exemplars by technique; ties lean away from decks that look like this one (its look and topic words).
  const exemplars = pickExemplars(opts.exemplars ?? loadExemplars(), input.board, { avoid: `${input.style.look} ${input.deckTitle}` });
  const { data } = await llm.callTool({
    label: `builder:${input.slide.id}`,
    model: opts.model ?? MODELS.sonnet,
    system: builderSystem(exemplars, input.board),
    user: builderUser(input),
    maxTokens: 48000,
    timeoutMs: 15 * 60_000,
    // Thinking before a long code answer multiplied output 3-6x (and hit max_tokens); off unless asked for.
    ...((opts.thinking ?? "off") === "off" ? { thinking: "off" as const } : {}),
    tool: { name: "write_slide", description: "Write the slide fragment.", schema: builderSchema(input.slide.id) },
  });
  return data;
}
export type { Exemplar };
