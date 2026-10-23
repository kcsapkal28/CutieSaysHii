import { z } from "zod";
import { JobStatusSchema, RerunFromSchema, StageNameSchema, StageSummarySchema, TokenUsageSchema } from "./contracts.ts";
import { ErrorInfoSchema } from "./errors.ts";

const ms = z.number().int().min(0);
const job = { jobId: z.string().min(1), at: z.number() };
const stage = { ...job, stage: StageNameSchema, iteration: z.number().int().min(0) };

export const StageEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("job:queued"), ...job }),
  z.object({
    type: z.literal("job:started"),
    ...job,
    from: RerunFromSchema.nullable(),
    mode: z.enum(["run", "rerun", "resume"]),
  }),
  z.object({
    type: z.literal("job:finished"),
    ...job,
    status: JobStatusSchema,
    error: ErrorInfoSchema.nullable(),
    usage: TokenUsageSchema,
    /** The promoted deck folder, null when no render succeeded. */
    distDir: z.string().nullable(),
  }),
  z.object({ type: z.literal("stage:start"), ...stage }),
  z.object({ type: z.literal("stage:progress"), ...stage, message: z.string() }),
  z.object({ type: z.literal("stage:warning"), ...stage, message: z.string() }),
  z.object({
    type: z.literal("stage:retry"),
    ...stage,
    reason: z.enum(["validation", "rate-limit", "transient"]),
    attempt: z.number().int().min(1),
    maxAttempts: z.number().int().min(1),
    waitMs: ms,
    detail: z.string(),
    /** HTTP status behind a rate-limit or transient retry. */
    status: z.number().int().optional(),
  }),
  z.object({
    type: z.literal("stage:done"),
    ...stage,
    durationMs: ms,
    backoffMs: ms,
    usage: TokenUsageSchema,
    inputHash: z.string(),
    summary: StageSummarySchema,
  }),
  z.object({ type: z.literal("stage:error"), ...stage, error: ErrorInfoSchema, durationMs: ms }),
]);
export type StageEvent = z.infer<typeof StageEventSchema>;
export type StageEventType = StageEvent["type"];
export type StageEventOf<T extends StageEventType> = Extract<StageEvent, { type: T }>;

export const STAGE_EVENT_TYPES = StageEventSchema.options.map((o) => o.shape.type.value) as StageEventType[];

export type RetryReason = StageEventOf<"stage:retry">["reason"];

/**
 * A persisted event. `seq` is assigned by the store on append: strictly increasing per job but not
 * contiguous (jobs share one sequence), so consumers dedupe with `seq <= lastSeen`, never `seq === last + 1`.
 */
export const EventEnvelopeSchema = z.object({ seq: z.number().int().min(1), event: StageEventSchema });
export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;
