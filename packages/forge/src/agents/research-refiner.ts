// Research refiner: answers a question about one passage of research.md and proposes a replacement for just that
// passage. Nothing is written here; the caller shows the suggestion and splices it in only when the user accepts.
import { z } from "zod";
import { MODELS, type Llm, type Usage } from "../llm.ts";
import { loadPrompt } from "./prompts.ts";
import type { Brief } from "./schemas.ts";

export type RefineInput = {
  brief: Pick<Brief, "topic" | "audience" | "minutes">;
  /** The whole research.md as the user sees it now. */
  markdown: string;
  /** The selected passage is markdown.slice(start, end). */
  start: number;
  end: number;
  /** The user's question or instruction about the passage. */
  question: string;
};

export type RefineResult = {
  answer: string;
  passage: string;
  replacement: string;
  /** false when the replacement is the passage unchanged. */
  changed: boolean;
  model: string;
  ms: number;
  usage: Usage;
};

const MAX_PASSAGE = 8000;
const MAX_QUESTION = 2000;
/** Context sent around the passage when its section is longer than this. */
const MAX_SECTION = 6000;

/** The response schema. A single-line passage must get a single-line replacement, or splicing it in breaks the markdown. */
export function refinementSchema(passage: string) {
  const inline = !passage.includes("\n");
  return z.object({
    answer: z.string().min(1).describe("1–4 sentences to the user: the answer, then what changed and why (or why nothing did)."),
    replacement: z
      .string()
      .refine((v) => v.trim().length > 0, "must not be empty; return the passage unchanged if nothing needs to change")
      .refine((v) => !inline || !v.trim().includes("\n"), "the passage is one line, so the replacement must be one line too (no line breaks)")
      .describe("Replaces exactly the selected passage, in the same markdown form. The passage itself, unchanged, when nothing needs to change."),
  });
}

/**
 * The section of `markdown` around [start, end): from the closest heading of level 1–2 at or before `start` to the
 * next heading of level 1–2 after `end`. Long sections are cut to a window around the passage.
 */
export function researchSection(markdown: string, start: number, end: number): string {
  const heading = /^#{1,2}\s/;
  let from = 0;
  let to = markdown.length;
  let at = 0;
  for (const line of markdown.split("\n")) {
    if (heading.test(line)) {
      if (at <= start) from = at;
      else if (at >= end) {
        to = at;
        break;
      }
    }
    at += line.length + 1;
  }
  if (to - from > MAX_SECTION) {
    const pad = Math.max(0, Math.floor((MAX_SECTION - (end - start)) / 2));
    from = Math.max(from, start - pad);
    to = Math.min(to, end + pad);
  }
  return markdown.slice(from, to).trim();
}

export async function refineResearch(llm: Llm, input: RefineInput, opts: { model?: string; signal?: AbortSignal } = {}): Promise<RefineResult> {
  const { markdown, start, end } = input;
  const question = input.question.trim();
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > markdown.length || start >= end)
    throw new Error("The selected passage is out of range. Select the text again.");
  const passage = markdown.slice(start, end);
  if (!passage.trim()) throw new Error("Select some text first.");
  if (passage.length > MAX_PASSAGE) throw new Error(`The selection is too long (${passage.length} characters). Select at most a section.`);
  if (!question) throw new Error("Type a question or an instruction first.");
  if (question.length > MAX_QUESTION) throw new Error("The question is too long.");

  const { brief } = input;
  const model = opts.model ?? MODELS.sonnet;
  const r = await llm.callTool({
    label: "researcher:refine",
    model,
    system: loadPrompt("research-refine"),
    user: [
      `Topic: ${brief.topic}`,
      `Audience: ${brief.audience}`,
      `Talk length: ${brief.minutes} minutes`,
      "",
      "The section of the research notes around the passage (context only):",
      "<section>",
      researchSection(markdown, start, end),
      "</section>",
      "",
      "The selected passage (your replacement takes its place, exactly):",
      "<passage>",
      passage,
      "</passage>",
      "",
      "The user's question or instruction:",
      "<question>",
      question,
      "</question>",
    ].join("\n"),
    maxTokens: 4000,
    tool: { name: "suggest_change", description: "Answer the user and give the replacement for the selected passage.", schema: refinementSchema(passage) },
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  // Keep the passage's own surrounding whitespace, so a stray trailing newline can't add a blank line.
  const edges = /^(\s*)[\s\S]*?(\s*)$/.exec(passage)!;
  const replacement = `${edges[1]}${r.data.replacement.trim()}${edges[2]}`;
  return { answer: r.data.answer.trim(), passage, replacement, changed: replacement !== passage, model, ms: r.ms, usage: r.usage };
}
