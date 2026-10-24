import { wordsPerSlideMax } from "@deckforge/catalog";
import { DeckSpecSchema, PatchSchema, QAReportSchema, type DeckSpec, type Patch, type QAReport } from "@deckforge/schemas";
import { z } from "zod";
import { invokeTool } from "../agents/invoke-tool.ts";
import { requestFingerprintOf } from "../agents/messages.ts";
import { buildPatchRequest, parsePatches, PATCH_EFFORT, type PatchRequestOptions } from "../agents/patch-tool.ts";
import { reconcileDesign } from "../design/reconcile.ts";
import { DesignPlanSchema, PatchChoicesSchema, type DesignPlan, type PatchChoices } from "../kernel/contracts.ts";
import { InternalError } from "../kernel/errors.ts";
import { STAGE_TIMEOUTS_MS, type StageDef } from "../kernel/stage.ts";
import { failingSlideIds } from "../qa/failures.ts";

export type PatchInput = { deck: DeckSpec; design: DesignPlan; report: QAReport; choices: PatchChoices; wordCap: number };
export type PatchOutput = { patches: Patch[]; deck: DeckSpec; design: DesignPlan };

const PatchInputSchema = z.object({
  deck: DeckSpecSchema,
  design: DesignPlanSchema,
  report: QAReportSchema,
  choices: PatchChoicesSchema,
  wordCap: z.number().int().min(1),
});
const PatchOutputSchema = z.object({ patches: z.array(PatchSchema), deck: DeckSpecSchema, design: DesignPlanSchema });

/** Agent C: the failing QA report → patches via emit_patches, the patched deck and the reconciled design. */
export function createPatchStage(o: PatchRequestOptions): StageDef<PatchInput, PatchOutput> {
  return {
    name: "patch",
    version: `${o.prompt.name}/${o.model}/${PATCH_EFFORT}`,
    timeoutMs: STAGE_TIMEOUTS_MS.patch,
    retry: { validation: 2 },
    dependsOn: ["qa"],
    input: PatchInputSchema,
    output: PatchOutputSchema,
    select: (s, c) => {
      if (!s.deck || !s.design || !s.report) throw new InternalError("the patch stage needs a deck, a design and a QA report");
      const choices = PatchChoicesSchema.parse(s.choices);
      const wordCap = wordsPerSlideMax(c, choices.depth, choices.styleFamilyId);
      if (failingSlideIds(s.report, wordCap).length === 0) throw new InternalError("the patch stage ran on a QA report with no failing slides");
      return { deck: s.deck, design: s.design, report: s.report, choices, wordCap };
    },
    reduce: (s, out) => ({ ...s, deck: out.deck, design: out.design }),
    fingerprint: (i, c) => requestFingerprintOf(buildPatchRequest(i, c, o)),
    summarize: (out) => ({ stage: "patch", patches: out.patches.map((p) => ({ slideId: p.slideId, op: p.op })) }),
    run: async (i, ctx) => {
      const { patches, deck } = await invokeTool(ctx, buildPatchRequest(i, ctx.catalog, o), parsePatches(ctx.catalog, i));
      return { patches, deck, design: reconcileDesign(ctx.catalog, i.choices, i.design, { before: i.deck, after: deck }) };
    },
  };
}
