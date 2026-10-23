import {
  BriefSpecSchema,
  ChoicesSchema,
  DeckSpecSchema,
  InteractionPlanSchema,
  MotionPlanSchema,
  PatchSchema,
  type BriefSpec,
  type Choices,
  type DeckSpec,
  type QAReport,
  type RenderManifest,
} from "@deckforge/schemas";
import { z } from "zod";
import { ErrorInfoSchema, type ErrorInfo } from "./errors.ts";
import { IssueSchema } from "./issues.ts";

export const STAGE_NAMES = ["content", "design", "render", "qa", "patch"] as const;
export const StageNameSchema = z.enum(STAGE_NAMES);
export type StageName = z.infer<typeof StageNameSchema>;

export const RERUN_FROM = ["content", "design", "render", "qa"] as const;
export const RerunFromSchema = z.enum(RERUN_FROM);
export type RerunFrom = z.infer<typeof RerunFromSchema>;

export const JOB_STATUSES = ["queued", "running", "succeeded", "qa_failed", "failed", "cancelled"] as const;
export const JobStatusSchema = z.enum(JOB_STATUSES);
export type JobStatus = z.infer<typeof JobStatusSchema>;

const count = z.number().int().min(0);
const iteration = z.number().int().min(0);

export const TokenUsageSchema = z.object({
  inputTokens: count,
  outputTokens: count,
  cacheReadTokens: count,
  cacheWriteTokens: count,
});
export type TokenUsage = z.infer<typeof TokenUsageSchema>;

export const ZERO_USAGE: Readonly<TokenUsage> = Object.freeze({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
});

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
}

export function totalTokens(u: TokenUsage): number {
  return u.inputTokens + u.outputTokens + u.cacheReadTokens + u.cacheWriteTokens;
}

// N3: the theme is resolved from Choices at render time and is never part of the design plan.
export const DesignPlanSchema = z.object({ motion: MotionPlanSchema, interaction: InteractionPlanSchema });
export type DesignPlan = z.infer<typeof DesignPlanSchema>;

// What Agent B sees of the deck: structure only, no slide text (not even emphasis targets, only their count).
export const DeckSkeletonSchema = z.object({
  slides: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      emphasisCount: count,
      blockTypes: z.array(z.string()),
    }),
  ),
});
export type DeckSkeleton = z.infer<typeof DeckSkeletonSchema>;

export const ContentChoicesSchema = ChoicesSchema.pick({
  depth: true,
  styleFamilyId: true,
  interactionModeId: true,
  questionCount: true,
});
export type ContentChoices = z.infer<typeof ContentChoicesSchema>;

export const DesignChoicesSchema = ChoicesSchema.pick({
  motionTemplateId: true,
  interactionModeId: true,
  questionCount: true,
});
export type DesignChoices = z.infer<typeof DesignChoicesSchema>;

export const JobInputsSchema = z.object({ brief: BriefSpecSchema, choices: ChoicesSchema });
export type JobInputs = { brief: BriefSpec; choices: Choices };

export type PipelineState = JobInputs & {
  deck?: DeckSpec;
  design?: DesignPlan;
  manifest?: RenderManifest;
  report?: QAReport;
};

const revision = z.number().int().min(1);

// The job's current truth, written after content, design and every patch. `source` is provenance only.
export const AcceptedDocSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("deck"),
    revision,
    source: z.object({ stage: z.enum(["content", "patch"]), iteration }),
    deck: DeckSpecSchema,
  }),
  z.object({
    kind: z.literal("design"),
    revision,
    source: z.object({ stage: z.enum(["design", "patch"]), iteration }),
    design: DesignPlanSchema,
  }),
]);
export type AcceptedDoc = z.infer<typeof AcceptedDocSchema>;
export type AcceptedKind = AcceptedDoc["kind"];
export type AcceptedDocOf<K extends AcceptedKind> = Extract<AcceptedDoc, { kind: K }>;

export const StageSummarySchema = z.discriminatedUnion("stage", [
  z.object({ stage: z.literal("content"), slideCount: count, slideTypes: z.array(z.string()) }),
  z.object({ stage: z.literal("design"), overrides: count, placements: count }),
  z.object({ stage: z.literal("render"), slideIds: z.array(z.string()), totalBytes: count, warnings: z.array(z.string()) }),
  z.object({
    stage: z.literal("qa"),
    pass: z.boolean(),
    failures: z.array(z.object({ slideId: z.string(), reasons: z.array(z.string()) })),
  }),
  z.object({
    stage: z.literal("patch"),
    patches: z.array(z.object({ slideId: z.string(), op: PatchSchema.shape.op })),
  }),
]);
export type StageSummary = z.infer<typeof StageSummarySchema>;

export type JobRecord = {
  id: string;
  status: JobStatus;
  brief: BriefSpec;
  choices: Choices;
  ownerId: string;
  heartbeatAt: number;
  createdAt: number;
  updatedAt: number;
  error: ErrorInfo | null;
  usage: TokenUsage;
  distDir: string | null;
};

export type StageStatus = "running" | "succeeded" | "failed";

export type StageRecord = {
  jobId: string;
  stage: StageName;
  iteration: number;
  status: StageStatus;
  inputHash: string;
  artifactPath: string | null;
  startedAt: number;
  finishedAt: number | null;
  durationMs: number | null;
  backoffMs: number;
  /**
   * Number of LLM attempts the stage reported; the per-attempt detail lives in the artifact. Render
   * and QA report none, so their rows record 0.
   */
  attempts: number;
  usage: TokenUsage;
  summary: StageSummary | null;
  error: ErrorInfo | null;
};

export const AttemptRecordSchema = z.object({
  n: z.number().int().min(1),
  outcome: z.enum(["ok", "invalid", "no-tool-call", "truncated", "error"]),
  issues: z.array(IssueSchema).optional(),
  usage: TokenUsageSchema,
  /** false when the call was aborted and the provider never reported usage. */
  usageKnown: z.boolean(),
  durationMs: count,
});
export type AttemptRecord = z.infer<typeof AttemptRecordSchema>;

export const StageArtifactSchema = z.object({
  jobId: z.string(),
  stage: StageNameSchema,
  iteration,
  version: z.string(),
  inputHash: z.string(),
  fingerprint: z.unknown(),
  input: z.unknown(),
  output: z.unknown(),
  error: ErrorInfoSchema.nullable(),
  startedAt: z.number(),
  durationMs: count,
  backoffMs: count,
  usage: TokenUsageSchema,
  attempts: z.array(AttemptRecordSchema),
});
// z.unknown() infers optional keys; the artifact always writes them (output is null on failure).
export type StageArtifact = Omit<z.infer<typeof StageArtifactSchema>, "fingerprint" | "input" | "output"> & {
  fingerprint: unknown;
  input: unknown;
  output: unknown;
};

export type StageKey = { stage: StageName; iteration: number };

export function artifactFileName(stage: StageName, i: number): string {
  if (!Number.isInteger(i) || i < 0) throw new RangeError(`iteration must be a non-negative integer, got ${i}`);
  return i === 0 ? `${stage}.json` : `${stage}.${i}.json`;
}
