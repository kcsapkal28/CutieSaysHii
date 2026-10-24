import { wordsPerSlideMax } from "@deckforge/catalog";
import { DeckSpecSchema, QAReportSchema, RenderManifestSchema, type DeckSpec, type QAReport, type RenderManifest } from "@deckforge/schemas";
import { z } from "zod";
import { InternalError } from "../kernel/errors.ts";
import { STAGE_TIMEOUTS_MS, type StageDef } from "../kernel/stage.ts";
import { qaFailures } from "../qa/failures.ts";

export type QaInput = { deck: DeckSpec; manifest: RenderManifest; wordCap: number };
/** The cap travels with the report, so the summary and audit can state "<n> words > <cap>". */
export type QaOutput = { report: QAReport; wordCap: number };

const QaInputSchema = z.object({ deck: DeckSpecSchema, manifest: RenderManifestSchema, wordCap: z.number().int().min(1) });
const QaOutputSchema = z.object({ report: QAReportSchema, wordCap: z.number().int().min(1) });

/** The built dist → a QA report from the QA port. */
export function createQaStage(): StageDef<QaInput, QaOutput> {
  return {
    name: "qa",
    version: "qa.v1",
    timeoutMs: STAGE_TIMEOUTS_MS.qa,
    retry: { validation: 0 },
    dependsOn: ["content", "render"],
    input: QaInputSchema,
    output: QaOutputSchema,
    select: (s, c) => {
      if (!s.deck) throw new InternalError("the qa stage needs a deck");
      if (!s.manifest) throw new InternalError("the qa stage needs a render manifest; run render first");
      return { deck: s.deck, manifest: s.manifest, wordCap: wordsPerSlideMax(c, s.choices.depth, s.choices.styleFamilyId) };
    },
    reduce: (s, out) => ({ ...s, report: out.report }),
    fingerprint: (i) => i,
    summarize: ({ report, wordCap }) => ({ stage: "qa", pass: report.pass, failures: qaFailures(report, wordCap) }),
    run: async (i, ctx) => {
      const report = await ctx.qa.run({ distDir: ctx.paths.distDir, manifest: i.manifest, deck: i.deck, wordCap: i.wordCap }, ctx.signal);
      return { report, wordCap: i.wordCap };
    },
  };
}
