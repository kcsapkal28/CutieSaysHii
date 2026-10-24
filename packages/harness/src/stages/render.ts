import { resolveTheme } from "@deckforge/catalog";
import { ChoicesSchema, DeckSpecSchema, RenderManifestSchema, type Choices, type DeckSpec, type RenderManifest } from "@deckforge/schemas";
import { z } from "zod";
import { DesignPlanSchema, type DesignPlan } from "../kernel/contracts.ts";
import { InternalError } from "../kernel/errors.ts";
import { STAGE_TIMEOUTS_MS, type StageDef } from "../kernel/stage.ts";

export type RenderInput = { deck: DeckSpec; design: DesignPlan; choices: Choices };

const RenderInputSchema = z.object({ deck: DeckSpecSchema, design: DesignPlanSchema, choices: ChoicesSchema });

/** Deck + design plan → a built dist. N3: the theme is resolved here from Choices, never by an agent. */
export function createRenderStage(): StageDef<RenderInput, RenderManifest> {
  return {
    name: "render",
    version: "render.v1",
    timeoutMs: STAGE_TIMEOUTS_MS.render,
    retry: { validation: 0 },
    dependsOn: ["content", "design"],
    input: RenderInputSchema,
    output: RenderManifestSchema,
    select: (s) => {
      if (!s.deck || !s.design) throw new InternalError("the render stage needs a deck and a design plan");
      return { deck: s.deck, design: s.design, choices: s.choices };
    },
    reduce: (s, manifest) => ({ ...s, manifest }),
    fingerprint: (i) => i,
    summarize: (m) => ({ stage: "render", slideIds: m.slideIds, totalBytes: m.totalBytes, warnings: m.warnings }),
    run: async (i, ctx) => {
      const theme = resolveTheme(ctx.catalog, i.choices);
      const manifest = await ctx.renderer.build(
        {
          jobId: ctx.jobId,
          iteration: ctx.iteration,
          deck: i.deck,
          theme,
          motion: i.design.motion,
          interaction: i.design.interaction,
          outDir: ctx.paths.distDir,
        },
        ctx.signal,
      );
      for (const warning of manifest.warnings) ctx.report.warn(warning);
      return manifest;
    },
  };
}
