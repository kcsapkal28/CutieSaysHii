import { describe, expect, it } from "vitest";
import { STAGE_NAMES, StageSummarySchema, ZERO_USAGE, type StageSummary } from "../../src/kernel/contracts.ts";
import {
  EventEnvelopeSchema,
  STAGE_EVENT_TYPES,
  StageEventSchema,
  type StageEvent,
} from "../../src/kernel/events.ts";

const base = { jobId: "j_1", at: 1_700_000_000_000 };
const usage = { inputTokens: 10, outputTokens: 20, cacheReadTokens: 3, cacheWriteTokens: 4 };

const summaries: StageSummary[] = [
  { stage: "content", slideCount: 12, slideTypes: ["title", "bullets"] },
  { stage: "design", overrides: 2, placements: 4 },
  { stage: "render", slideIds: ["s01", "s02"], totalBytes: 123_456, warnings: ["slide s02: df-tabs is not supported"] },
  { stage: "qa", pass: false, failures: [{ slideId: "s02", reasons: ["overflow", "42 words > 40"] }] },
  { stage: "patch", patches: [{ slideId: "s02", op: "shortenText" }] },
];

const events: StageEvent[] = [
  { type: "job:queued", ...base },
  { type: "job:started", ...base, from: null, mode: "run" },
  { type: "job:started", ...base, from: "render", mode: "rerun" },
  { type: "job:finished", ...base, status: "succeeded", error: null, usage },
  { type: "job:finished", ...base, status: "failed", error: { kind: "timeout", message: "stage content exceeded 90000 ms" }, usage: ZERO_USAGE },
  { type: "stage:start", ...base, stage: "content", iteration: 0 },
  { type: "stage:progress", ...base, stage: "content", iteration: 0, message: "calling claude-sonnet-5-5 (attempt 1/3)" },
  { type: "stage:warning", ...base, stage: "render", iteration: 1, message: "slide s02: df-tabs is not supported" },
  {
    type: "stage:retry",
    ...base,
    stage: "content",
    iteration: 0,
    reason: "rate-limit",
    attempt: 1,
    maxAttempts: 5,
    waitMs: 2000,
    detail: "429",
  },
  ...summaries.map(
    (summary): StageEvent => ({
      type: "stage:done",
      ...base,
      stage: summary.stage,
      iteration: 0,
      durationMs: 41_200,
      backoffMs: 4000,
      usage,
      inputHash: "ab".repeat(32),
      summary,
    }),
  ),
  {
    type: "stage:error",
    ...base,
    stage: "design",
    iteration: 0,
    error: { kind: "validation", message: "invalid", issues: [{ path: "motion", code: "vocabulary", message: "x" }] },
    durationMs: 12,
  },
];

describe("StageEvent", () => {
  it("schema round-trips every event and summary", () => {
    expect(new Set(events.map((e) => e.type))).toEqual(new Set(STAGE_EVENT_TYPES));
    expect(new Set(summaries.map((s) => s.stage))).toEqual(new Set(STAGE_NAMES));
    for (const event of events) {
      expect(StageEventSchema.parse(JSON.parse(JSON.stringify(event)))).toEqual(event);
    }
    for (const summary of summaries) expect(StageSummarySchema.parse(summary)).toEqual(summary);
  });

  it("rejects unknown types, a missing jobId and a negative iteration", () => {
    expect(StageEventSchema.safeParse({ type: "stage:nope", ...base }).success).toBe(false);
    expect(StageEventSchema.safeParse({ type: "job:queued", at: 1 }).success).toBe(false);
    expect(StageEventSchema.safeParse({ type: "stage:start", ...base, stage: "content", iteration: -1 }).success).toBe(false);
  });

  it("envelopes carry a positive integer seq", () => {
    const env = { seq: 7, event: events[0] };
    expect(EventEnvelopeSchema.parse(env)).toEqual(env);
    expect(EventEnvelopeSchema.safeParse({ seq: 0, event: events[0] }).success).toBe(false);
  });
});
