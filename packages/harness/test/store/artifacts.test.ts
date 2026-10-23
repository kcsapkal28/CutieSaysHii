import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFsArtifacts, type FsArtifacts } from "../../src/adapters/fs-artifacts.ts";
import { openSqlite } from "../../src/adapters/sqlite/db.ts";
import { jobs } from "../../src/adapters/sqlite/schema.ts";
import { createSession } from "../../src/adapters/sqlite/session.ts";
import { createSqliteStore } from "../../src/adapters/sqlite/store.ts";
import type { AcceptedDoc } from "../../src/kernel/contracts.ts";
import { CancelledError, CorruptArtifactError, InputError, InternalError, OWNERSHIP_LOST } from "../../src/kernel/errors.ts";
import type { JobSession, Store } from "../../src/kernel/ports.ts";
import { FakeClock } from "../helpers/clock.ts";
import { recordingLogger, type LogEntry } from "../helpers/context.ts";
import { memoryStore, type MemoryStore } from "../helpers/store.ts";
import { artifactOf, newJob, tinyDeck } from "./fixtures.ts";

const corrupt = (relPath: string) => (e: unknown) => e instanceof CorruptArtifactError && e.relPath === relPath;

describe("artifacts", () => {
  let m: MemoryStore;
  let store: Store;
  let session: JobSession;
  beforeEach(async () => {
    m = await memoryStore();
    store = m.store;
    session = await store.createJob(newJob("j_1"));
  });
  afterEach(async () => {
    await m.dispose();
  });

  it("stage artifact round-trip at qa.2.json", async () => {
    const artifact = artifactOf("j_1", "qa", 2);
    expect(await session.writeArtifact(artifact)).toBe("j_1/qa.2.json");
    expect(JSON.parse(await readFile(join(m.jobsDir, "j_1", "qa.2.json"), "utf8"))).toEqual(artifact);
    expect(await store.artifacts.read("j_1", "qa", 2)).toEqual(artifact);
    expect(await session.writeArtifact(artifactOf("j_1", "content", 0))).toBe("j_1/content.json");

    const failed = { ...artifactOf("j_1", "qa", 2), output: null, error: { kind: "timeout", message: "late" } as const };
    await session.writeArtifact(failed);
    expect(await store.artifacts.read("j_1", "qa", 2)).toEqual(failed);

    await session.removeArtifact("qa", 2);
    await session.removeArtifact("qa", 2);
    expect(await store.artifacts.read("j_1", "qa", 2)).toBeUndefined();
    expect(store.artifacts.jobDir("j_1")).toBe(join(m.jobsDir, "j_1"));
  });

  it("accepted deck round-trip at accepted/deck.json with deck inline", async () => {
    const doc: AcceptedDoc = { kind: "deck", revision: 2, source: { stage: "patch", iteration: 1 }, deck: tinyDeck };
    await session.writeAccepted(doc);
    expect(JSON.parse(await readFile(join(m.jobsDir, "j_1", "accepted", "deck.json"), "utf8"))).toEqual(doc);
    expect(await store.artifacts.readAccepted("j_1", "deck")).toEqual(doc);

    expect(await store.artifacts.readAccepted("j_1", "design")).toBeUndefined();
    await session.writeAccepted({ ...doc, revision: 3 });
    expect(await store.artifacts.readAccepted("j_1", "deck")).toMatchObject({ revision: 3 });
  });

  it("no .tmp left", async () => {
    await session.writeArtifact(artifactOf("j_1", "content", 0));
    await session.writeArtifact(artifactOf("j_1", "content", 0));
    await session.writeAccepted({ kind: "deck", revision: 1, source: { stage: "content", iteration: 0 }, deck: tinyDeck });
    expect((await readdir(join(m.jobsDir, "j_1"), { recursive: true })).sort()).toEqual([
      "accepted",
      join("accepted", "deck.json"),
      "content.json",
    ]);
  });

  it("missing → undefined", async () => {
    expect(await store.artifacts.read("j_1", "content", 0)).toBeUndefined();
    expect(await store.artifacts.read("nope", "content", 0)).toBeUndefined();
    expect(await store.artifacts.readAccepted("j_1", "deck")).toBeUndefined();
    expect(await store.artifacts.readAccepted("nope", "design")).toBeUndefined();
  });

  it("corrupt → CorruptArtifactError naming the file", async () => {
    const dir = join(m.jobsDir, "j_1");
    await mkdir(join(dir, "accepted"), { recursive: true });

    await writeFile(join(dir, "accepted", "deck.json"), "{ not json");
    await expect(store.artifacts.readAccepted("j_1", "deck")).rejects.toSatisfy(corrupt("j_1/accepted/deck.json"));
    await expect(store.artifacts.readAccepted("j_1", "deck")).rejects.toThrow("artifact j_1/accepted/deck.json is missing or invalid");

    await writeFile(join(dir, "accepted", "deck.json"), JSON.stringify({ kind: "deck", revision: 1, source: { stage: "content", iteration: 0 }, deck: { title: "x" } }));
    await expect(store.artifacts.readAccepted("j_1", "deck")).rejects.toSatisfy(corrupt("j_1/accepted/deck.json"));

    // A deck document stored as design.json is the wrong kind.
    await writeFile(join(dir, "accepted", "design.json"), JSON.stringify({ kind: "deck", revision: 1, source: { stage: "content", iteration: 0 }, deck: tinyDeck }));
    await expect(store.artifacts.readAccepted("j_1", "design")).rejects.toSatisfy(corrupt("j_1/accepted/design.json"));

    await writeFile(join(dir, "render.1.json"), JSON.stringify({ jobId: "j_1", stage: "render" }));
    await expect(store.artifacts.read("j_1", "render", 1)).rejects.toSatisfy(corrupt("j_1/render.1.json"));
  });

  it("a read that fails for another reason than a missing file is an InternalError", async () => {
    await mkdir(join(m.jobsDir, "j_1", "qa.1.json"), { recursive: true });
    await mkdir(join(m.jobsDir, "j_1", "accepted", "deck.json"), { recursive: true });
    const notCorrupt = (e: unknown) => e instanceof InternalError && !(e instanceof CorruptArtifactError) && /j_1\/qa\.1\.json/.test(e.message);
    await expect(store.artifacts.read("j_1", "qa", 1)).rejects.toSatisfy(notCorrupt);
    await expect(store.artifacts.readAccepted("j_1", "deck")).rejects.toBeInstanceOf(InternalError);
  });

  it("claim and createJob sweep stale temp files left by a crashed writer", async () => {
    const dir = join(m.jobsDir, "j_1");
    await session.writeArtifact(artifactOf("j_1", "content", 0));
    await mkdir(join(dir, "accepted"), { recursive: true });
    await writeFile(join(dir, "content.json.0123456789ab.tmp"), "{");
    await writeFile(join(dir, "accepted", "deck.json.ba9876543210.tmp"), "{");
    await writeFile(join(dir, "notes.tmp.txt"), "kept");
    await session.updateJob({ status: "failed", updatedAt: 2_000 });
    await store.claim("j_1", "B", 3_000, 0);
    expect((await readdir(dir, { recursive: true })).sort()).toEqual(["accepted", "content.json", "notes.tmp.txt"]);

    const fresh = join(m.jobsDir, "j_2");
    await mkdir(fresh, { recursive: true });
    await writeFile(join(fresh, "content.json.0123456789ab.tmp"), "{");
    await store.createJob(newJob("j_2"));
    expect(await readdir(fresh)).toEqual([]);
  });

  it("file writes run after the fenced ownership check", async () => {
    await store.claim("j_1", "B", 1_000_000, 999_999);
    await expect(session.writeArtifact(artifactOf("j_1", "content", 0))).rejects.toThrow("ownership lost");
    await expect(readdir(join(m.jobsDir, "j_1"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("job ids cannot leave the jobs dir", async () => {
    const files = createFsArtifacts(m.jobsDir);
    for (const id of ["..", "a/b", "a\\b", ""]) {
      expect(() => files.jobDir(id)).toThrow(InputError);
      await expect(files.read(id, "content", 0)).rejects.toBeInstanceOf(InputError);
    }
  });
});

describe("temp sweep and rename races", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "deckforge-jobs-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("a failing temp sweep is logged and never strands claim or createJob", async () => {
    await mkdir(join(dir, "j_1"), { recursive: true });
    await writeFile(join(dir, "j_1", "accepted"), "a file where the accepted dir should be");
    const logs: LogEntry[] = [];
    const store = await createSqliteStore({ dbPath: ":memory:", jobsDir: dir, logger: recordingLogger(logs) });
    const a = await store.createJob(newJob("j_1"));
    await a.updateJob({ status: "failed", updatedAt: 2_000 });
    expect(await store.claim("j_1", "B", 3_000, 0)).toMatchObject({ ownerId: "B" });
    expect(logs.filter((l) => l.level === "warn").map((l) => [l.message, l.data?.jobId])).toEqual([
      ["temp file sweep failed", "j_1"],
      ["temp file sweep failed", "j_1"],
    ]);
    await store.close();

    const quiet = await createSqliteStore({ dbPath: ":memory:", jobsDir: dir });
    await expect(quiet.createJob(newJob("j_1"))).resolves.toMatchObject({ ownerId: "A" });
    await quiet.close();
  });

  it("a rename that fails with ENOENT is ownership lost when another owner took the job, else rethrown", async () => {
    const { db, close } = await openSqlite(":memory:");
    const row = { status: "running" as const, briefJson: "{}", choicesJson: "{}", heartbeatAt: 1, createdAt: 1, updatedAt: 1, usageJson: "{}" };
    await db.insert(jobs).values([
      { id: "j_1", ownerId: "A", ...row },
      { id: "j_2", ownerId: "A", ...row },
    ]);
    let stealFrom: string | undefined;
    // Stands in for B claiming the job and sweeping A's temp file between A's write and rename.
    const renameFails = async (jobId: string) => {
      if (stealFrom === jobId) await db.update(jobs).set({ ownerId: "B" }).where(eq(jobs.id, jobId));
      throw Object.assign(new Error("ENOENT: no such file or directory, rename"), { code: "ENOENT" });
    };
    const files: FsArtifacts = {
      ...createFsArtifacts(dir),
      write: (artifact) => renameFails(artifact.jobId),
      writeAccepted: (jobId) => renameFails(jobId),
    };
    const doc: AcceptedDoc = { kind: "deck", revision: 1, source: { stage: "content", iteration: 0 }, deck: tinyDeck };
    const s1 = createSession(db, files, "j_1", "A");
    const s2 = createSession(db, files, "j_2", "A");

    await expect(s1.writeArtifact(artifactOf("j_1", "content", 0))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(s2.writeAccepted(doc)).rejects.toMatchObject({ code: "ENOENT" });

    const lost = (e: unknown) => e instanceof CancelledError && e.reason === OWNERSHIP_LOST;
    stealFrom = "j_1";
    await expect(s1.writeArtifact(artifactOf("j_1", "content", 0))).rejects.toSatisfy(lost);
    stealFrom = "j_2";
    await expect(s2.writeAccepted(doc)).rejects.toSatisfy(lost);
    close();
  });
});

describe("memoryStore onIo", () => {
  it("lets FakeClock.runUntilIdle wait for every session write", async () => {
    const clock = new FakeClock(1_000);
    const { store, jobsDir, dispose } = await memoryStore({ onIo: (p) => clock.track(p) });
    const trail: string[] = [];
    const work = (async () => {
      const s = await store.createJob(newJob("j_1", clock.now()));
      await clock.sleep(100);
      await s.writeArtifact(artifactOf("j_1", "content", 0));
      await s.writeAccepted({ kind: "deck", revision: 1, source: { stage: "content", iteration: 0 }, deck: tinyDeck });
      trail.push(`wrote@${clock.now()}`);
      await clock.sleep(50);
      await s.removeArtifact("content", 0);
      trail.push(`removed@${clock.now()}`);
    })();
    void clock.sleep(120).then(async () => {
      trail.push(`check@${clock.now()}:${(await readdir(join(jobsDir, "j_1"))).sort().join(",")}`);
    });
    await clock.runUntilIdle();
    await work;
    expect(trail).toEqual(["wrote@1100", "check@1120:accepted,content.json", "removed@1150"]);
    await dispose();
  });

  it("also sees artifact reads", async () => {
    const seen: unknown[] = [];
    const { store, dispose } = await memoryStore({
      onIo: (p) => {
        seen.push(p);
        return p;
      },
    });
    await store.artifacts.read("j_1", "content", 0);
    await store.artifacts.readAccepted("j_1", "deck");
    expect(seen).toHaveLength(2);
    await dispose();
  });
});
