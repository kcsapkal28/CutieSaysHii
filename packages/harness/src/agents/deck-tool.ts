import type { Catalog } from "@deckforge/catalog";
import { DeckSpecSchema, SlideSchema, type BriefSpec, type DeckSpec } from "@deckforge/schemas";
import { z } from "zod";
import type { ContentChoices } from "../kernel/contracts.ts";
import { zodToIssues } from "../kernel/issues.ts";
import type { Effort, ToolSpec } from "../kernel/llm-port.ts";
import { acceptedBlocks, deckRules, type DeckRules } from "../validate/rules.ts";
import { validateDeck } from "../validate/deck.ts";
import { enumOrString } from "../validate/design-wire.ts";
import { compileWireSchema } from "../wire/schema.ts";
import type { ParseResult } from "./invoke-tool.ts";
import type { AgentPrompt, AgentRequest } from "./messages.ts";

/** The spike's CONTENT_EFFORT: medium was no slower than low and well inside the per-attempt timeout. */
export const DEFAULT_CONTENT_EFFORT: Effort = "medium";
export const CONTENT_MAX_TOKENS = 16000;

export type ContentInput = { brief: BriefSpec; choices: ContentChoices };
export type ContentRequestOptions = { prompt: AgentPrompt; model: string; effort?: Effort };

// Non-strict (spike S2b: the strict grammar for the 11-way block union is too large); Zod and validateDeck guard it.
const DECK_TOOL = {
  name: "emit_deck",
  description: "Emit the complete slide deck (title, subtitle and every slide) in one call.",
  strict: false,
} as const;

export function deckWireSchema(c: Catalog) {
  const slide = SlideSchema.extend({ type: enumOrString(c.slideTypes.types.map((t) => t.id)) });
  return z.object({ title: z.string(), subtitle: z.string(), slides: z.array(slide) });
}

/** The rules Agent A writes against; every value comes from the catalog via deckRules. */
export function contentRules(c: Catalog, rules: DeckRules) {
  return {
    slides: rules.slides,
    wordsPerSlideMax: rules.wordsPerSlideMax,
    notesWords: rules.notesWords,
    quizSlides: rules.quizCount,
    requiredTypes: rules.requiredTypes,
    slideTypes: c.slideTypes.types.map((t) => ({
      id: t.id,
      name: t.name,
      accepts: acceptedBlocks(t, rules.coverTypes.includes(t.id)),
      limits: t.limits ?? {},
      ...(t.required === undefined ? {} : { required: t.required }),
      ...(t.onlyIn === undefined ? {} : { onlyIn: t.onlyIn }),
    })),
  };
}

export function buildContentRequest(i: ContentInput, c: Catalog, o: ContentRequestOptions): AgentRequest {
  const wire = compileWireSchema(deckWireSchema(c));
  const tool: ToolSpec = { ...DECK_TOOL, inputSchema: wire.jsonSchema };
  return {
    model: o.model,
    effort: o.effort ?? DEFAULT_CONTENT_EFFORT,
    maxTokens: CONTENT_MAX_TOKENS,
    system: o.prompt.text,
    input: { brief: i.brief, rules: contentRules(c, deckRules(c, i.choices)) },
    tool,
    normalize: wire.normalize,
  };
}

export function parseDeck(c: Catalog, choices: ContentChoices): (input: unknown) => ParseResult<DeckSpec> {
  const rules = deckRules(c, choices);
  return (input) => {
    const parsed = DeckSpecSchema.safeParse(input);
    if (!parsed.success) return { ok: false, issues: zodToIssues(parsed.error) };
    const issues = validateDeck(c, rules, parsed.data);
    return issues.length > 0 ? { ok: false, issues } : { ok: true, value: parsed.data };
  };
}
