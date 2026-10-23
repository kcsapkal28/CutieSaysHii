import { z } from "zod";
import { buildDesignRequest, DESIGN_EFFORT, parseDesign, type DesignInput, type DesignRequestOptions } from "../agents/design-tool.ts";
import { invokeTool } from "../agents/invoke-tool.ts";
import { requestFingerprintOf } from "../agents/messages.ts";
import { toSkeleton } from "../design/skeleton.ts";
import { DeckSkeletonSchema, DesignChoicesSchema, DesignPlanSchema, type DesignPlan } from "../kernel/contracts.ts";
import { InternalError } from "../kernel/errors.ts";
import { STAGE_TIMEOUTS_MS, type StageDef } from "../kernel/stage.ts";

const DesignInputSchema = z.object({ choices: DesignChoicesSchema, skeleton: DeckSkeletonSchema });

/** Agent B: motion template, interaction mode and deck skeleton → DesignPlan via emit_design (N3: no theme). */
export function createDesignStage(o: DesignRequestOptions): StageDef<DesignInput, DesignPlan> {
  return {
    name: "design",
    version: `${o.prompt.name}/${o.model}/${DESIGN_EFFORT}`,
    timeoutMs: STAGE_TIMEOUTS_MS.design,
    retry: { validation: 2 },
    dependsOn: ["content"],
    input: DesignInputSchema,
    output: DesignPlanSchema,
    select: (s) => {
      if (!s.deck) throw new InternalError("the design stage needs a deck; run content first");
      return { choices: DesignChoicesSchema.parse(s.choices), skeleton: toSkeleton(s.deck) };
    },
    reduce: (s, design) => ({ ...s, design }),
    fingerprint: (i, c) => requestFingerprintOf(buildDesignRequest(i, c, o)),
    summarize: (plan) => ({
      stage: "design",
      overrides: Object.values(plan.motion.slides).filter((m) => m.overrideReason !== undefined).length,
      placements: plan.interaction.slides.reduce((n, s) => n + s.components.length, 0),
    }),
    run: (i, ctx) => invokeTool(ctx, buildDesignRequest(i, ctx.catalog, o), parseDesign(ctx.catalog, i)),
  };
}
