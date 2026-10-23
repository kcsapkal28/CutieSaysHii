import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { and, eq, inArray, lt, notInArray, or } from "drizzle-orm";
import { ZERO_USAGE, type JobStatus } from "../../kernel/contracts.ts";
import type { Store } from "../../kernel/ports.ts";
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
};

export async function createSqliteStore({ dbPath, jobsDir }: SqliteStoreOptions): Promise<Store> {
  if (dbPath !== ":memory:") await mkdir(dirname(dbPath), { recursive: true });
  const { db, raw } = await openSqlite(dbPath);
  const files = createFsArtifacts(jobsDir);

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
      return createSession(db, files, id, ownerId);
    },

    async claim(id, ownerId, now, staleBefore) {
      const result = await db
        .update(jobs)
        .set({ ownerId, heartbeatAt: now, updatedAt: now })
        .where(and(eq(jobs.id, id), or(notInArray(jobs.status, LIVE), lt(jobs.heartbeatAt, staleBefore))));
      return changesOf(result).changes > 0 ? createSession(db, files, id, ownerId) : null;
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
