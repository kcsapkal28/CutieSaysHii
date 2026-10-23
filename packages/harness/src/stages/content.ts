import { BriefSpecSchema, DeckSpecSchema, type DeckSpec } from "@deckforge/schemas";
import { z } from "zod";
import {
  buildContentRequest,
  DEFAULT_CONTENT_EFFORT,
  parseDeck,
  type ContentInput,
  type ContentRequestOptions,
} from "../agents/deck-tool.ts";
import { invokeTool } from "../agents/invoke-tool.ts";
import { requestFingerprintOf } from "../agents/messages.ts";
import { ContentChoicesSchema } from "../kernel/contracts.ts";
import { STAGE_TIMEOUTS_MS, type StageDef } from "../kernel/stage.ts";

const ContentInputSchema = z.object({ brief: BriefSpecSchema, choices: ContentChoicesSchema });

/** Agent A: brief + content choices → DeckSpec via emit_deck. */
export function createContentStage(opts: ContentRequestOptions): StageDef<ContentInput, DeckSpec> {
  const o = { ...opts, effort: opts.effort ?? DEFAULT_CONTENT_EFFORT };
  return {
    name: "content",
    version: `${o.prompt.name}/${o.model}/${o.effort}`,
    timeoutMs: STAGE_TIMEOUTS_MS.content,
    retry: { validation: 2 },
    dependsOn: [],
    input: ContentInputSchema,
    output: DeckSpecSchema,
    select: (s) => ({ brief: s.brief, choices: ContentChoicesSchema.parse(s.choices) }),
    reduce: (s, deck) => ({ ...s, deck }),
    fingerprint: (i, c) => requestFingerprintOf(buildContentRequest(i, c, o)),
    summarize: (deck) => ({ stage: "content", slideCount: deck.slides.length, slideTypes: deck.slides.map((s) => s.type) }),
    run: (i, ctx) => invokeTool(ctx, buildContentRequest(i, ctx.catalog, o), parseDeck(ctx.catalog, i.choices)),
  };
}
