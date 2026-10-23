import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { and, eq, inArray, lt, notInArray, or } from "drizzle-orm";
import { ZERO_USAGE, type JobStatus } from "../../kernel/contracts.ts";
import type { Logger, Store } from "../../kernel/ports.ts";
import { createFsArtifacts } from "../fs-artifacts.ts";
import { allSync, changesOf, immediate, openSqlite, runSync } from "./db.ts";
import { eventReads, jobReads, json, stageReads } from "./repos.ts";
import { createSession } from "./session.ts";
import { jobs, stages } from "./schema.ts";

const LIVE: JobStatus[] = ["queued", "running"];

export type SqliteStoreOptions = {
  /** A file path, or ":memory:". */
  dbPath: string;
  jobsDir: string;
  /** Receives best-effort failures, such as a temp file sweep that could not finish. */
  logger?: Logger;
};

export async function createSqliteStore({ dbPath, jobsDir, logger }: SqliteStoreOptions): Promise<Store> {
  if (dbPath !== ":memory:") await mkdir(dirname(dbPath), { recursive: true });
  const { db, raw } = await openSqlite(dbPath);
  const files = createFsArtifacts(jobsDir);

  // Runs after ownership is committed, so it must never fail the claim or createJob.
  const sweep = async (jobId: string) => {
    try {
      await files.sweepTemp(jobId);
    } catch (e) {
      logger?.warn("temp file sweep failed", { jobId, error: e instanceof Error ? e.message : String(e) });
    }
  };

  return {
    jobs: jobReads(db),
    stages: stageReads(db),
    events: eventReads(db),
    artifacts: { read: files.read, readAccepted: files.readAccepted, jobDir: files.jobDir },

    async createJob({ id, brief, choices, ownerId, now }) {
      await db.insert(jobs).values({
        id,
        status: "queued",
        briefJson: json(brief),
        choicesJson: json(choices),
        ownerId,
        heartbeatAt: now,
        createdAt: now,
        updatedAt: now,
        errorJson: null,
        usageJson: json(ZERO_USAGE),
        distDir: null,
      });
      await sweep(id);
      return createSession(db, files, id, ownerId);
    },

    async claim(id, ownerId, now, staleBefore) {
      const result = await db
        .update(jobs)
        .set({ ownerId, heartbeatAt: now, updatedAt: now })
        .where(and(eq(jobs.id, id), or(notInArray(jobs.status, LIVE), lt(jobs.heartbeatAt, staleBefore))));
      if (changesOf(result).changes === 0) return null;
      // A previous owner may have crashed mid-write; its temp files are ours to clear now.
      await sweep(id);
      return createSession(db, files, id, ownerId);
    },

    async reclaimStale(staleBefore, error) {
      const errorJson = json(error);
      const stale = and(inArray(jobs.status, LIVE), lt(jobs.heartbeatAt, staleBefore));
      // Synchronous on purpose: see `immediate`.
      return immediate(raw, () => {
        const ids = allSync<{ id: string }>(raw, db.select({ id: jobs.id }).from(jobs).where(stale).orderBy(jobs.id)).map(
          (r) => r.id,
        );
        if (ids.length === 0) return [];
        runSync(raw, db.update(stages).set({ status: "failed", errorJson }).where(and(inArray(stages.jobId, ids), eq(stages.status, "running"))));
        runSync(raw, db.update(jobs).set({ status: "failed", errorJson }).where(inArray(jobs.id, ids)));
        return ids;
      });
    },

    async close() {
      if (raw.isOpen) raw.close();
    },
  };
}
