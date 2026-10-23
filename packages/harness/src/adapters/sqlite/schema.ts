import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { JobStatus, StageName, StageStatus } from "../../kernel/contracts.ts";

// Times are epoch ms; *_json columns hold JSON text.
export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    status: text("status").$type<JobStatus>().notNull(),
    briefJson: text("brief_json").notNull(),
    choicesJson: text("choices_json").notNull(),
    ownerId: text("owner_id").notNull(),
    heartbeatAt: integer("heartbeat_at").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    errorJson: text("error_json"),
    usageJson: text("usage_json").notNull(),
    distDir: text("dist_dir"),
  },
  (t) => [index("jobs_created_at_idx").on(t.createdAt), index("jobs_status_idx").on(t.status)],
);

export const stages = sqliteTable(
  "stages",
  {
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    stage: text("stage").$type<StageName>().notNull(),
    iteration: integer("iteration").notNull(),
    status: text("status").$type<StageStatus>().notNull(),
    inputHash: text("input_hash").notNull(),
    artifactPath: text("artifact_path"),
    startedAt: integer("started_at").notNull(),
    finishedAt: integer("finished_at"),
    durationMs: integer("duration_ms"),
    backoffMs: integer("backoff_ms").notNull(),
    attempts: integer("attempts").notNull(),
    usageJson: text("usage_json").notNull(),
    summaryJson: text("summary_json"),
    errorJson: text("error_json"),
  },
  (t) => [primaryKey({ columns: [t.jobId, t.stage, t.iteration] })],
);

export const events = sqliteTable(
  "events",
  {
    seq: integer("seq").primaryKey({ autoIncrement: true }),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    stage: text("stage").$type<StageName>(),
    at: integer("at").notNull(),
    /** The whole StageEvent. */
    payloadJson: text("payload_json").notNull(),
  },
  (t) => [index("events_job_seq_idx").on(t.jobId, t.seq)],
);
