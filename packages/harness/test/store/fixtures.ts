import type { DeckSpec } from "@deckforge/schemas";
import { ZERO_USAGE, type StageArtifact, type StageName, type StageRecord } from "../../src/kernel/contracts.ts";
import type { StageEvent } from "../../src/kernel/events.ts";
import type { NewJob } from "../../src/kernel/ports.ts";
import { toyState, toySummary } from "../helpers/stages.ts";

export function newJob(id: string, now = 1_000, ownerId = "A"): NewJob {
  const { brief, choices } = toyState();
  return { id, brief, choices, ownerId, now };
}

export function stageRow(jobId: string, stage: StageName, iteration = 0, patch: Partial<StageRecord> = {}): StageRecord {
  return {
    jobId,
    stage,
    iteration,
    status: "running",
    inputHash: `h-${stage}-${iteration}`,
    artifactPath: null,
    startedAt: 1_000,
    finishedAt: null,
    durationMs: null,
    backoffMs: 0,
    attempts: 0,
    usage: { ...ZERO_USAGE },
    summary: null,
    error: null,
    ...patch,
  };
}

export function progress(jobId: string, message: string, at = 1_000): StageEvent {
  return { type: "stage:progress", jobId, at, stage: "content", iteration: 0, message };
}

export function artifactOf(jobId: string, stage: StageName, iteration: number): StageArtifact {
  return {
    jobId,
    stage,
    iteration,
    version: "v1",
    inputHash: "abc",
    fingerprint: { model: "m" },
    input: { topic: "t" },
    output: { ok: true },
    error: null,
    startedAt: 1_000,
    durationMs: 5,
    backoffMs: 0,
    usage: { ...ZERO_USAGE },
    attempts: [{ n: 1, outcome: "ok", usage: { ...ZERO_USAGE }, usageKnown: true, durationMs: 5 }],
  };
}

export const tinyDeck: DeckSpec = {
  title: "Solar",
  subtitle: "How cells work",
  slides: [
    {
      id: "s1",
      type: "title",
      title: "Solar",
      body: [{ type: "Paragraph", text: "Light in, current out." }],
      notes: "Open with the sun.",
      emphasisTargets: [],
    },
  ],
};

export { toySummary };
