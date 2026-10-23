import { and, eq, getTableColumns, not, or, sql, type SQL } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import type { SqliteRemoteResult } from "drizzle-orm/sqlite-proxy";
import { CancelledError, InternalError } from "../../kernel/errors.ts";
import type { JobPatch, JobSession } from "../../kernel/ports.ts";
import type { FsArtifacts } from "../fs-artifacts.ts";
import { changesOf, type Db } from "./db.ts";
import { json, jsonOrNull, stageColumns } from "./repos.ts";
import { events, jobs, stages } from "./schema.ts";

/**
 * `INSERT … SELECT <values> WHERE <owned>`: inserts nothing unless the condition holds, so the
 * statement's change count doubles as the ownership check.
 */
function insertIf(table: SQLiteTable, values: Record<string, unknown>, condition: SQL, onConflict?: SQL): SQL {
  const columns = getTableColumns(table) as Record<string, SQLiteColumn>;
  const keys = Object.keys(values);
  const names = sql.join(
    keys.map((k) => sql.identifier(columns[k]!.name)),
    sql`, `,
  );
  const params = sql.join(
    keys.map((k) => sql`${values[k]}`),
    sql`, `,
  );
  return sql`INSERT INTO ${table} (${names}) SELECT ${params} WHERE ${condition}${onConflict ? sql` ${onConflict}` : sql``}`;
}

const STAGE_KEY = ["jobId", "stage", "iteration"] as const;

const upsertStageOnConflict = (() => {
  const columns = getTableColumns(stages);
  const name = (k: keyof typeof columns) => sql.identifier(columns[k].name);
  const updated = (Object.keys(columns) as (keyof typeof columns)[]).filter((k) => !(STAGE_KEY as readonly string[]).includes(k));
  return sql`ON CONFLICT (${sql.join(STAGE_KEY.map(name), sql`, `)}) DO UPDATE SET ${sql.join(
    updated.map((k) => sql`${name(k)} = excluded.${name(k)}`),
    sql`, `,
  )}`;
})();

function jobSet(patch: JobPatch): Partial<typeof jobs.$inferInsert> {
  const set: Partial<typeof jobs.$inferInsert> = { updatedAt: patch.updatedAt };
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.choices !== undefined) set.choicesJson = json(patch.choices);
  if (patch.error !== undefined) set.errorJson = jsonOrNull(patch.error);
  if (patch.usage !== undefined) set.usageJson = json(patch.usage);
  if (patch.distDir !== undefined) set.distDir = patch.distDir;
  return set;
}

/** A JobSession whose every write is conditional on `jobs.owner_id = ownerId`. */
export function createSession(db: Db, files: FsArtifacts, jobId: string, ownerId: string): JobSession {
  const owned = and(eq(jobs.id, jobId), eq(jobs.ownerId, ownerId))!;
  const ownsJob = sql`EXISTS (SELECT 1 FROM ${jobs} WHERE ${owned})`;

  const fenced = async (statement: PromiseLike<SqliteRemoteResult>): Promise<number> => {
    const { changes, lastInsertRowid } = changesOf(await statement);
    if (changes === 0) throw CancelledError.ownershipLost();
    return lastInsertRowid;
  };

  // Guards a write whose 0 rows can be legitimate, and every filesystem write (check-then-write).
  const assertOwner = async (): Promise<void> => {
    const row = await db.select({ ownerId: jobs.ownerId }).from(jobs).where(owned).get();
    if (!row) throw CancelledError.ownershipLost();
  };

  const assertJob = (what: string, id: string) => {
    if (id !== jobId) throw new InternalError(`${what} for job ${id} written through the session of job ${jobId}`);
  };

  return {
    jobId,
    ownerId,

    async heartbeat(now) {
      const result = await db.update(jobs).set({ heartbeatAt: now }).where(owned);
      return changesOf(result).changes > 0;
    },

    async updateJob(patch) {
      await fenced(db.update(jobs).set(jobSet(patch)).where(owned));
    },

    async upsertStage(record) {
      assertJob("stage row", record.jobId);
      const values = { jobId, stage: record.stage, iteration: record.iteration, ...stageColumns(record) };
      await fenced(db.run(insertIf(stages, values, ownsJob, upsertStageOnConflict)));
    },

    async retainOnly(keep) {
      const kept = keep.map((k) => and(eq(stages.stage, k.stage), eq(stages.iteration, k.iteration)));
      const result = await db
        .delete(stages)
        .where(and(eq(stages.jobId, jobId), ownsJob, kept.length > 0 ? not(or(...kept)!) : undefined));
      if (changesOf(result).changes === 0) await assertOwner();
    },

    async appendEvent(event) {
      assertJob("event", event.jobId);
      const values = {
        jobId,
        type: event.type,
        stage: "stage" in event ? event.stage : null,
        at: event.at,
        payloadJson: json(event),
      };
      return fenced(db.run(insertIf(events, values, ownsJob)));
    },

    async writeArtifact(artifact) {
      assertJob("artifact", artifact.jobId);
      await assertOwner();
      return files.write(artifact);
    },

    async removeArtifact(stage, iteration) {
      await assertOwner();
      await files.remove(jobId, stage, iteration);
    },

    async writeAccepted(doc) {
      await assertOwner();
      await files.writeAccepted(jobId, doc);
    },
  };
}
