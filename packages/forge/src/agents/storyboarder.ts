// Storyboarder (Opus): script + style → storyboard.json (per slide: concept, explainer + technique, interaction, steps, 3D spec).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Style } from "../contract.ts";
import { MODELS, type Llm } from "../llm.ts";
import { FORGE_DIR, loadPrompt } from "./prompts.ts";
import { Storyboard, type Brief, type Script } from "./schemas.ts";

export const TECHNIQUES_FILE = join(FORGE_DIR, "fixtures", "exemplars", "TECHNIQUES.md");
const LIGHT_INTERACTIONS = new Set(["none", "click", "hover", "toggle"]);
const WORDY = new Set(["typographic", "quote"]);

/** The engine's technique catalogue (fixtures/exemplars/TECHNIQUES.md), when present, as a prompt section. */
export function techniquesSection(file = TECHNIQUES_FILE): string {
  if (!existsSync(file)) return "";
  return (
    "\n   Technique catalogue (pick `technique` from these names; each has hand-built exemplars the engineer will study):\n\n" +
    readFileSync(file, "utf8")
      .trim()
      .split("\n")
      .map((l) => `   ${l}`)
      .join("\n") +
    "\n"
  );
}

/** Problems with a storyboard against the script's ids, the style's hard limits and the variety rules (empty when it complies). */
export function storyboardProblems(sb: Storyboard, ids: string[], style: Style): string[] {
  const problems: string[] = [];
  const got = sb.slides.map((s) => s.id);
  if (got.join(",") !== ids.join(",")) problems.push(`slide ids must be exactly [${ids.join(", ")}] in order; got [${got.join(", ")}]`);
  for (const s of sb.slides) {
    if (!style.use3d && (s.explainer === "3d-object" || s.object3d)) problems.push(`${s.id}: 3D is off for this deck; use a 2D explainer and drop object3d`);
    if (style.use3d && s.explainer === "3d-object" && !s.object3d) problems.push(`${s.id}: a 3d-object slide needs an object3d spec`);
    if (s.explainer === "simulation" && !s.simulation) problems.push(`${s.id}: a simulation slide needs a simulation spec`);
    if (style.interactivity === 0 && s.interaction.kind !== "none") problems.push(`${s.id}: interactivity is 0 (static); interaction.kind must be "none"`);
    if (style.interactivity === 1 && !LIGHT_INTERACTIONS.has(s.interaction.kind))
      problems.push(`${s.id}: interactivity is 1 (light); use click, hover or toggle, not ${s.interaction.kind}`);
  }
  // Variety: no explainer three times in a row; at least three explainers in a deck of five or more; few wordy slides.
  for (let i = 2; i < sb.slides.length; i++) {
    const [a, b, c] = [sb.slides[i - 2]!, sb.slides[i - 1]!, sb.slides[i]!];
    if (a.explainer === b.explainer && b.explainer === c.explainer) problems.push(`${a.id}–${c.id}: three ${c.explainer} slides in a row; vary the explainer`);
  }
  const kinds = new Set(sb.slides.map((s) => s.explainer));
  if (sb.slides.length >= 5 && kinds.size < 3) problems.push(`only ${kinds.size} explainer type(s) across ${sb.slides.length} slides; use at least three`);
  const wordy = sb.slides.filter((s) => WORDY.has(s.explainer)).length;
  if (wordy > Math.max(1, Math.ceil(sb.slides.length / 5))) problems.push(`${wordy} typographic/quote slides is too many; show mechanisms, data or images instead`);
  return problems;
}

export function storyboardSchema(ids: string[], style: Style) {
  return Storyboard.superRefine((sb, ctx) => {
    for (const message of storyboardProblems(sb, ids, style)) ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  });
}

export async function runStoryboarder(
  llm: Llm,
  input: { brief: Brief; style: Style; script: Script; researchMd: string },
  opts: { model?: string; techniquesFile?: string } = {},
): Promise<Storyboard> {
  const { brief, style, script, researchMd } = input;
  const ids = script.slides.map((s) => s.id);
  const styleBrief = {
    look: style.look,
    colors: style.theme.colors,
    fonts: style.theme.fonts,
    motion: style.motion,
    use3d: style.use3d,
    interactivity: style.interactivity,
    density: style.density,
  };
  const { data } = await llm.callTool({
    label: "storyboarder",
    model: opts.model ?? MODELS.opus,
    system: loadPrompt("storyboard", { techniques: techniquesSection(opts.techniquesFile) }),
    user:
      `Topic: ${brief.topic}\nAudience: ${brief.audience}\n\nStyle:\n${JSON.stringify(styleBrief, null, 2)}\n\n` +
      `Script (titles, callouts and notes per slide):\n${JSON.stringify(script, null, 2)}\n\nResearch notes:\n${researchMd}`,
    maxTokens: 32000,
    timeoutMs: 15 * 60_000,
    // The storyboard is long and expensive; allow two corrective retries before giving up.
    validationRetries: 2,
    tool: { name: "write_storyboard", description: "Write the storyboard for every slide.", schema: storyboardSchema(ids, style) },
  });
  return data;
}
