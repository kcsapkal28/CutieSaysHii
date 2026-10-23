import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFsArtifacts } from "../../src/adapters/fs-artifacts.ts";
import type { AcceptedDoc } from "../../src/kernel/contracts.ts";
import { CorruptArtifactError, InputError } from "../../src/kernel/errors.ts";
import type { JobSession, Store } from "../../src/kernel/ports.ts";
import { FakeClock } from "../helpers/clock.ts";
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
});
