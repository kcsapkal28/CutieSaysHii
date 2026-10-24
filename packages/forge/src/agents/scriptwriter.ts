// Script writer: research → outline.json (sections, slides, key messages, time budget) → script.json (per-slide words).
import { z } from "zod";
import type { Style } from "../contract.ts";
import { MODELS, type Llm } from "../llm.ts";
import { loadPrompt } from "./prompts.ts";
import { OutlineDraft, ScriptSlide, type Brief, type Outline, type Script } from "./schemas.ts";

export const slideId = (n: number) => `s${String(n).padStart(2, "0")}`;

/** Scales budgets so they add up to the talk length, rounded to 5 s (the last slide absorbs the rounding). */
export function normalizeBudgets(budgets: number[], totalSec: number): number[] {
  const sum = budgets.reduce((a, b) => a + b, 0) || 1;
  const scaled = budgets.map((b) => Math.max(15, Math.round((b * totalSec) / sum / 5) * 5));
  const drift = totalSec - scaled.reduce((a, b) => a + b, 0);
  if (scaled.length) scaled[scaled.length - 1] = Math.max(15, scaled[scaled.length - 1]! + drift);
  return scaled;
}

export async function runOutline(llm: Llm, brief: Brief, researchMd: string, opts: { model?: string } = {}): Promise<Outline> {
  const { data } = await llm.callTool({
    label: "outline",
    model: opts.model ?? MODELS.sonnet,
    system: loadPrompt("outline"),
    user: `Topic: ${brief.topic}\nAudience: ${brief.audience}\nTalk length: ${brief.minutes} minutes (${Math.round(brief.minutes * 60)} s)\n\n${researchMd}`,
    maxTokens: 4000,
    tool: { name: "plan_outline", description: "Plan the deck outline.", schema: OutlineDraft },
  });
  const totalSec = Math.round(brief.minutes * 60);
  const budgets = normalizeBudgets(data.sections.flatMap((s) => s.slides.map((sl) => sl.budgetSec)), totalSec);
  let n = 0;
  return {
    title: data.title,
    subtitle: data.subtitle,
    throughline: data.throughline,
    totalSec,
    sections: data.sections.map((s) => ({
      name: s.name,
      slides: s.slides.map((sl) => {
        const id = slideId(++n);
        return { id, keyMessage: sl.keyMessage, role: sl.role, budgetSec: budgets[n - 1]! };
      }),
    })),
  };
}

export function scriptSchema(ids: string[]) {
  return z.object({
    slides: z
      .array(ScriptSlide)
      .superRefine((slides, ctx) => {
        const got = slides.map((s) => s.id).join(",");
        if (got !== ids.join(",")) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `slide ids must be exactly [${ids.join(", ")}] in order; got [${got}]` });
      }),
  });
}

export async function runScript(
  llm: Llm,
  input: { brief: Brief; style: Style; outline: Outline; researchMd: string },
  opts: { model?: string } = {},
): Promise<Script> {
  const { brief, style, outline, researchMd } = input;
  const ids = outline.sections.flatMap((s) => s.slides.map((sl) => sl.id));
  const { data } = await llm.callTool({
    label: "script",
    model: opts.model ?? MODELS.sonnet,
    system: loadPrompt("script"),
    user:
      `Topic: ${brief.topic}\nAudience: ${brief.audience}\nDensity: ${style.density}\n\n` +
      `Outline:\n${JSON.stringify(outline, null, 2)}\n\nResearch notes:\n${researchMd}`,
    maxTokens: 12000,
    tool: { name: "write_script", description: "Write every slide's on-slide copy and speaker notes.", schema: scriptSchema(ids) },
  });
  const sectionOf = new Map(outline.sections.flatMap((s) => s.slides.map((sl) => [sl.id, { section: s.name, budgetSec: sl.budgetSec }] as const)));
  return {
    title: outline.title,
    slides: data.slides.map((s) => ({ ...s, section: sectionOf.get(s.id)!.section, budgetSec: sectionOf.get(s.id)!.budgetSec })),
  };
}
