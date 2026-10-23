import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openSqlite } from "../../src/adapters/sqlite/db.ts";
import { createSqliteStore } from "../../src/adapters/sqlite/store.ts";
import { CancelledError, OWNERSHIP_LOST } from "../../src/kernel/errors.ts";
import type { Store } from "../../src/kernel/ports.ts";
import { memoryStore, type MemoryStore } from "../helpers/store.ts";
import { artifactOf, newJob, progress, stageRow, tinyDeck, toySummary } from "./fixtures.ts";

const columns = (db: Awaited<ReturnType<typeof openSqlite>>, table: string) =>
  (db.raw.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);

describe("openSqlite", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "deckforge-db-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("migrates to jobs, stages, events with the listed columns", async () => {
    const db = await openSqlite(join(dir, "a.sqlite"));
    expect(columns(db, "jobs")).toEqual([
      "id",
      "status",
      "brief_json",
      "choices_json",
      "owner_id",
      "heartbeat_at",
      "created_at",
      "updated_at",
      "error_json",
      "usage_json",
      "dist_dir",
    ]);
    expect(columns(db, "stages")).toEqual([
      "job_id",
      "stage",
      "iteration",
      "status",
      "input_hash",
      "artifact_path",
      "started_at",
      "finished_at",
      "duration_ms",
      "backoff_ms",
      "attempts",
      "usage_json",
      "summary_json",
      "error_json",
    ]);
    expect(columns(db, "events")).toEqual(["seq", "job_id", "type", "stage", "at", "payload_json"]);
    const pk = (db.raw.prepare("PRAGMA table_info(stages)").all() as { name: string; pk: number }[])
      .filter((c) => c.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map((c) => c.name);
    expect(pk).toEqual(["job_id", "stage", "iteration"]);
    const indexes = db.raw.prepare("PRAGMA index_list(events)").all() as { name: string }[];
    const indexed = indexes.map((i) => (db.raw.prepare(`PRAGMA index_info(${i.name})`).all() as { name: string }[]).map((c) => c.name));
    expect(indexed).toContainEqual(["job_id", "seq"]);
    expect(db.raw.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
    expect(db.raw.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    db.close();
  });

  it("migrations idempotent across two opens", async () => {
    const path = join(dir, "b.sqlite");
    const first = await createSqliteStore({ dbPath: path, jobsDir: dir });
    await first.createJob(newJob("j_1"));
    await first.close();
    const second = await createSqliteStore({ dbPath: path, jobsDir: dir });
    expect((await second.jobs.get("j_1"))?.id).toBe("j_1");
    await second.close();
    const db = await openSqlite(path);
    expect(db.raw.prepare("SELECT count(*) AS n FROM __drizzle_migrations").get()).toEqual({ n: 1 });
    db.close();
  });
});

describe("sqlite store", () => {
  let m: MemoryStore;
  let store: Store;
  beforeEach(async () => {
    m = await memoryStore();
    store = m.store;
  });
  afterEach(async () => {
    await m.dispose();
  });

  it("createJob returns a session; jobs round-trip", async () => {
    const job = newJob("j_1", 1_000, "A");
    const session = await store.createJob(job);
    expect(session).toMatchObject({ jobId: "j_1", ownerId: "A" });
    expect(await store.jobs.get("j_1")).toEqual({
      id: "j_1",
      status: "queued",
      brief: job.brief,
      choices: job.choices,
      ownerId: "A",
      heartbeatAt: 1_000,
      createdAt: 1_000,
      updatedAt: 1_000,
      error: null,
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      distDir: null,
    });
    const usage = { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4 };
    const choices = { ...job.choices, paletteId: "other" };
    await session.updateJob({
      status: "failed",
      choices,
      error: { kind: "render", message: "boom" },
      usage,
      distDir: "j_1/dist",
      updatedAt: 2_000,
    });
    expect(await store.jobs.get("j_1")).toMatchObject({
      status: "failed",
      choices,
      error: { kind: "render", message: "boom" },
      usage,
      distDir: "j_1/dist",
      updatedAt: 2_000,
      createdAt: 1_000,
    });
    await session.updateJob({ status: "running", error: null, distDir: null, updatedAt: 3_000 });
    expect(await store.jobs.get("j_1")).toMatchObject({ status: "running", error: null, distDir: null, usage });
    expect(await store.jobs.get("nope")).toBeUndefined();
  });

  it("list newest first; status filter", async () => {
    await store.createJob(newJob("j_a", 1_000));
    const b = await store.createJob(newJob("j_b", 2_000));
    await store.createJob(newJob("j_c", 2_000));
    await b.updateJob({ status: "succeeded", updatedAt: 3_000 });
    expect((await store.jobs.list({ limit: 10 })).map((j) => j.id)).toEqual(["j_c", "j_b", "j_a"]);
    expect((await store.jobs.list({ limit: 2 })).map((j) => j.id)).toEqual(["j_c", "j_b"]);
    expect((await store.jobs.list({ limit: 10, status: "queued" })).map((j) => j.id)).toEqual(["j_c", "j_a"]);
    expect((await store.jobs.list({ limit: 10, status: "succeeded" })).map((j) => j.id)).toEqual(["j_b"]);
  });

  it("stage upsert idempotent on (jobId, stage, iteration)", async () => {
    const s = await store.createJob(newJob("j_1"));
    await s.upsertStage(stageRow("j_1", "qa", 1));
    const done = stageRow("j_1", "qa", 1, {
      status: "succeeded",
      artifactPath: "j_1/qa.1.json",
      finishedAt: 1_500,
      durationMs: 500,
      backoffMs: 20,
      attempts: 2,
      usage: { inputTokens: 5, outputTokens: 6, cacheReadTokens: 0, cacheWriteTokens: 0 },
      summary: toySummary("qa"),
    });
    await s.upsertStage(done);
    await s.upsertStage(done);
    expect(await store.stages.list("j_1")).toEqual([done]);
    expect(await store.stages.get("j_1", "qa", 1)).toEqual(done);
    expect(await store.stages.get("j_1", "qa", 2)).toBeUndefined();
    const failed = stageRow("j_1", "qa", 1, { status: "failed", error: { kind: "timeout", message: "stage qa exceeded 5 ms" } });
    await s.upsertStage(failed);
    expect(await store.stages.get("j_1", "qa", 1)).toEqual(failed);
  });

  it("stages list in pipeline order", async () => {
    const s = await store.createJob(newJob("j_1"));
    for (const [stage, i] of [["qa", 1], ["render", 0], ["patch", 1], ["content", 0], ["qa", 0], ["design", 0], ["render", 1]] as const) {
      await s.upsertStage(stageRow("j_1", stage, i));
    }
    expect((await store.stages.list("j_1")).map((r) => `${r.stage}.${r.iteration}`)).toEqual([
      "content.0",
      "design.0",
      "render.0",
      "qa.0",
      "patch.1",
      "render.1",
      "qa.1",
    ]);
  });

  it("retainOnly", async () => {
    const s = await store.createJob(newJob("j_1"));
    const other = await store.createJob(newJob("j_2"));
    for (const [stage, i] of [["content", 0], ["design", 0], ["render", 0], ["qa", 0], ["patch", 1]] as const) {
      await s.upsertStage(stageRow("j_1", stage, i));
    }
    await other.upsertStage(stageRow("j_2", "render", 0));
    await s.retainOnly([
      { stage: "content", iteration: 0 },
      { stage: "design", iteration: 0 },
    ]);
    expect((await store.stages.list("j_1")).map((r) => r.stage)).toEqual(["content", "design"]);
    await s.retainOnly([{ stage: "content", iteration: 0 }]);
    await s.retainOnly([{ stage: "content", iteration: 0 }]);
    expect((await store.stages.list("j_1")).map((r) => r.stage)).toEqual(["content"]);
    await s.retainOnly([]);
    expect(await store.stages.list("j_1")).toEqual([]);
    expect(await store.stages.list("j_2")).toHaveLength(1);
  });

  it("events seq increasing; list afterSeq", async () => {
    const a = await store.createJob(newJob("j_a"));
    const b = await store.createJob(newJob("j_b"));
    const s1 = await a.appendEvent(progress("j_a", "one"));
    const s2 = await b.appendEvent(progress("j_b", "other"));
    const s3 = await a.appendEvent(progress("j_a", "two"));
    const s4 = await a.appendEvent({ type: "job:queued", jobId: "j_a", at: 1_100 });
    expect(s1).toBeGreaterThanOrEqual(1);
    expect([s1, s2, s3, s4]).toEqual([...[s1, s2, s3, s4]].sort((x, y) => x - y));
    expect(new Set([s1, s2, s3, s4]).size).toBe(4);
    expect(await store.events.list("j_a")).toEqual([
      { seq: s1, event: progress("j_a", "one") },
      { seq: s3, event: progress("j_a", "two") },
      { seq: s4, event: { type: "job:queued", jobId: "j_a", at: 1_100 } },
    ]);
    expect((await store.events.list("j_a", s1)).map((e) => e.seq)).toEqual([s3, s4]);
    expect((await store.events.list("j_a", s2)).map((e) => e.seq)).toEqual([s3, s4]);
    expect(await store.events.list("j_a", s4)).toEqual([]);
    expect(await store.events.list("j_b")).toEqual([{ seq: s2, event: progress("j_b", "other") }]);
  });

  it("heartbeat moves heartbeatAt and keeps updatedAt", async () => {
    const s = await store.createJob(newJob("j_1", 1_000));
    expect(await s.heartbeat(6_000)).toBe(true);
    expect(await store.jobs.get("j_1")).toMatchObject({ heartbeatAt: 6_000, updatedAt: 1_000 });
  });

  describe("ownership", () => {
    const ownershipLost = (p: Promise<unknown>) =>
      expect(p).rejects.toSatisfy((e) => e instanceof CancelledError && e.reason === OWNERSHIP_LOST);

    it("stolen-ownership writer", async () => {
      const a = await store.createJob(newJob("j_1", 1_000, "A"));
      await a.upsertStage(stageRow("j_1", "content", 0));
      const seq = await a.appendEvent(progress("j_1", "mine"));
      const path = await a.writeArtifact(artifactOf("j_1", "content", 0));
      await a.heartbeat(2_000);

      // A stops heartbeating; B finds it stale 30 s later.
      const b = await store.claim("j_1", "B", 40_000, 10_000);
      expect(b).toMatchObject({ jobId: "j_1", ownerId: "B" });
      const job = await store.jobs.get("j_1");
      expect(job).toMatchObject({ ownerId: "B", heartbeatAt: 40_000, updatedAt: 40_000, status: "queued" });
      const stages = await store.stages.list("j_1");
      const files = await readdir(join(m.jobsDir, "j_1"));
      const artifact = await readFile(join(m.jobsDir, path), "utf8");

      await ownershipLost(a.upsertStage(stageRow("j_1", "content", 0, { status: "succeeded" })));
      await ownershipLost(a.upsertStage(stageRow("j_1", "design", 0)));
      await ownershipLost(a.appendEvent(progress("j_1", "late")));
      await ownershipLost(a.updateJob({ status: "succeeded", updatedAt: 41_000 }));
      await ownershipLost(a.retainOnly([]));
      await ownershipLost(a.writeArtifact({ ...artifactOf("j_1", "content", 0), output: { stolen: true } }));
      await ownershipLost(a.writeArtifact(artifactOf("j_1", "design", 0)));
      await ownershipLost(a.removeArtifact("content", 0));
      await ownershipLost(
        a.writeAccepted({ kind: "deck", revision: 1, source: { stage: "content", iteration: 0 }, deck: tinyDeck }),
      );
      expect(await a.heartbeat(41_000)).toBe(false);

      expect(await store.jobs.get("j_1")).toEqual(job);
      expect(await store.stages.list("j_1")).toEqual(stages);
      expect(await store.events.list("j_1")).toEqual([{ seq, event: progress("j_1", "mine") }]);
      expect(await readdir(join(m.jobsDir, "j_1"))).toEqual(files);
      expect(await readFile(join(m.jobsDir, path), "utf8")).toBe(artifact);

      await b!.appendEvent(progress("j_1", "B's"));
      expect(await b!.heartbeat(42_000)).toBe(true);
    });

    it("claim of a missing job returns null", async () => {
      expect(await store.claim("missing", "A", 1_000, 2_000)).toBeNull();
    });

    it("claim refuses a running job with a fresh heartbeat", async () => {
      const a = await store.createJob(newJob("j_1", 1_000, "A"));
      await a.updateJob({ status: "running", updatedAt: 1_000 });
      await a.heartbeat(20_000);
      expect(await store.claim("j_1", "B", 25_000, 20_000)).toBeNull();
      expect(await store.claim("j_1", "A", 25_000, 20_000)).toBeNull();
      expect(await store.jobs.get("j_1")).toMatchObject({ ownerId: "A", heartbeatAt: 20_000 });
      expect(await a.heartbeat(26_000)).toBe(true);
      // Queued counts as live too.
      await store.createJob(newJob("j_2", 30_000, "A"));
      expect(await store.claim("j_2", "B", 31_000, 1_000)).toBeNull();
    });

    it("claim succeeds on a finished job", async () => {
      const a = await store.createJob(newJob("j_1", 1_000, "A"));
      await a.updateJob({ status: "succeeded", updatedAt: 2_000 });
      await a.heartbeat(2_000);
      const b = await store.claim("j_1", "B", 3_000, 0);
      expect(b).toMatchObject({ jobId: "j_1", ownerId: "B" });
      expect(await store.jobs.get("j_1")).toMatchObject({ ownerId: "B", status: "succeeded", heartbeatAt: 3_000 });
      await b!.updateJob({ status: "running", updatedAt: 3_000 });
      expect(await a.heartbeat(3_000)).toBe(false);
    });

    it("reclaimStale fails only stale jobs and their running stage rows", async () => {
      const error = { kind: "internal", message: "owner stopped heartbeating" } as const;
      const stale = await store.createJob(newJob("j_stale", 1_000));
      await stale.updateJob({ status: "running", updatedAt: 1_000 });
      await stale.upsertStage(stageRow("j_stale", "content", 0, { status: "succeeded", summary: toySummary("content") }));
      await stale.upsertStage(stageRow("j_stale", "design", 0));
      await store.createJob(newJob("j_queued", 2_000));
      const fresh = await store.createJob(newJob("j_fresh", 1_000));
      await fresh.updateJob({ status: "running", updatedAt: 1_000 });
      await fresh.upsertStage(stageRow("j_fresh", "content", 0));
      await fresh.heartbeat(50_000);
      const done = await store.createJob(newJob("j_done", 1_000));
      await done.updateJob({ status: "succeeded", updatedAt: 1_000 });

      expect((await store.reclaimStale(40_000, error)).sort()).toEqual(["j_queued", "j_stale"]);

      expect(await store.jobs.get("j_stale")).toMatchObject({ status: "failed", error });
      expect(await store.jobs.get("j_queued")).toMatchObject({ status: "failed", error });
      expect(await store.jobs.get("j_fresh")).toMatchObject({ status: "running", error: null });
      expect(await store.jobs.get("j_done")).toMatchObject({ status: "succeeded", error: null });
      expect((await store.stages.list("j_stale")).map((r) => [r.stage, r.status, r.error])).toEqual([
        ["content", "succeeded", null],
        ["design", "failed", error],
      ]);
      expect(await store.stages.get("j_fresh", "content", 0)).toMatchObject({ status: "running", error: null });
      expect(await store.reclaimStale(40_000, error)).toEqual([]);
    });
  });
});
