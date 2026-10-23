import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import type { JobRecord, StageRecord } from "../../kernel/contracts.ts";
import type { EventEnvelope } from "../../kernel/events.ts";
import type { EventReads, JobReads, StageReads } from "../../kernel/ports.ts";
import type { Db } from "./db.ts";
import { events, jobs, stages } from "./schema.ts";

type JobRow = typeof jobs.$inferSelect;
type StageRow = typeof stages.$inferSelect;

export const json = (value: unknown): string => JSON.stringify(value);
export const jsonOrNull = (value: unknown): string | null => (value == null ? null : JSON.stringify(value));
const parseOrNull = <T>(text: string | null): T | null => (text === null ? null : (JSON.parse(text) as T));

export function toJobRecord(row: JobRow): JobRecord {
  return {
    id: row.id,
    status: row.status,
    brief: JSON.parse(row.briefJson),
    choices: JSON.parse(row.choicesJson),
    ownerId: row.ownerId,
    heartbeatAt: row.heartbeatAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    error: parseOrNull(row.errorJson),
    usage: JSON.parse(row.usageJson),
    distDir: row.distDir,
  };
}

export function toStageRecord(row: StageRow): StageRecord {
  return {
    jobId: row.jobId,
    stage: row.stage,
    iteration: row.iteration,
    status: row.status,
    inputHash: row.inputHash,
    artifactPath: row.artifactPath,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    durationMs: row.durationMs,
    backoffMs: row.backoffMs,
    attempts: row.attempts,
    usage: JSON.parse(row.usageJson),
    summary: parseOrNull(row.summaryJson),
    error: parseOrNull(row.errorJson),
  };
}

/** Column values for a stage row, in schema order minus the key. */
export function stageColumns(r: StageRecord) {
  return {
    status: r.status,
    inputHash: r.inputHash,
    artifactPath: r.artifactPath,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    durationMs: r.durationMs,
    backoffMs: r.backoffMs,
    attempts: r.attempts,
    usageJson: json(r.usage),
    summaryJson: jsonOrNull(r.summary),
    errorJson: jsonOrNull(r.error),
  };
}

// Within an iteration the pipeline runs patch → render → qa; content and design only run at 0.
const STAGE_ORDER = sql`CASE ${stages.stage} WHEN 'content' THEN 0 WHEN 'design' THEN 1 WHEN 'patch' THEN 2 WHEN 'render' THEN 3 WHEN 'qa' THEN 4 END`;

export function jobReads(db: Db): JobReads {
  return {
    async get(id) {
      const row = await db.select().from(jobs).where(eq(jobs.id, id)).get();
      return row && toJobRecord(row);
    },
    async list({ limit, status }) {
      const rows = await db
        .select()
        .from(jobs)
        .where(status ? eq(jobs.status, status) : undefined)
        .orderBy(desc(jobs.createdAt), desc(sql`rowid`))
        .limit(limit);
      return rows.map(toJobRecord);
    },
  };
}

export function stageReads(db: Db): StageReads {
  return {
    async get(jobId, stage, iteration) {
      const row = await db
        .select()
        .from(stages)
        .where(and(eq(stages.jobId, jobId), eq(stages.stage, stage), eq(stages.iteration, iteration)))
        .get();
      return row && toStageRecord(row);
    },
    async list(jobId) {
      const rows = await db
        .select()
        .from(stages)
        .where(eq(stages.jobId, jobId))
        .orderBy(asc(stages.iteration), asc(STAGE_ORDER));
      return rows.map(toStageRecord);
    },
  };
}

export function eventReads(db: Db): EventReads {
  return {
    async list(jobId, afterSeq) {
      const rows = await db
        .select({ seq: events.seq, payloadJson: events.payloadJson })
        .from(events)
        .where(and(eq(events.jobId, jobId), afterSeq === undefined ? undefined : gt(events.seq, afterSeq)))
        .orderBy(asc(events.seq));
      return rows.map((r): EventEnvelope => ({ seq: r.seq, event: JSON.parse(r.payloadJson) }));
    },
  };
}
