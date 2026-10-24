// Storyboarder (Opus): script + style → storyboard.json (per slide: concept, explainer type, interaction, steps, 3D spec).
import { z } from "zod";
import type { Style } from "../contract.ts";
import { MODELS, type Llm } from "../llm.ts";
import { loadPrompt } from "./prompts.ts";
import { Storyboard, type Brief, type Script } from "./schemas.ts";

const LIGHT_INTERACTIONS = new Set(["none", "click", "hover", "toggle"]);

/** Problems with a storyboard against the script's ids and the style's hard limits (empty when it complies). */
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
  const typographic = sb.slides.filter((s) => s.explainer === "typographic").length;
  if (typographic > Math.max(1, Math.floor(sb.slides.length / 6))) problems.push(`${typographic} typographic slides is too many; show mechanisms instead`);
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
  opts: { model?: string } = {},
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
    system: loadPrompt("storyboard"),
    user:
      `Topic: ${brief.topic}\nAudience: ${brief.audience}\n\nStyle:\n${JSON.stringify(styleBrief, null, 2)}\n\n` +
      `Script (titles, callouts and notes per slide):\n${JSON.stringify(script, null, 2)}\n\nResearch notes:\n${researchMd}`,
    maxTokens: 32000,
    timeoutMs: 15 * 60_000,
    tool: { name: "write_storyboard", description: "Write the storyboard for every slide.", schema: storyboardSchema(ids, style) },
  });
  return data;
}
