import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSqliteStore } from "../../src/adapters/sqlite/store.ts";
import type { JobSession, Store } from "../../src/kernel/ports.ts";

/** Wraps a pending I/O promise; FakeClock#track fits, so runUntilIdle waits for the write. */
export type IoHook = <T>(p: Promise<T>) => Promise<T>;

export type MemoryStore = {
  store: Store;
  jobsDir: string;
  /** Closes the store and removes the jobs dir. */
  dispose(): Promise<void>;
};

const SESSION_METHODS = [
  "heartbeat",
  "updateJob",
  "upsertStage",
  "retainOnly",
  "appendEvent",
  "writeArtifact",
  "removeArtifact",
  "writeAccepted",
] as const satisfies readonly (keyof JobSession)[];

function hookSession(session: JobSession, onIo: IoHook): JobSession {
  const hooked = { jobId: session.jobId, ownerId: session.ownerId } as Record<string, unknown>;
  for (const name of SESSION_METHODS) {
    const method = session[name] as (...args: unknown[]) => Promise<unknown>;
    hooked[name] = (...args: unknown[]) => onIo(method.apply(session, args));
  }
  return hooked as unknown as JobSession;
}

/** An in-memory database over a temp jobs dir. `onIo` sees every session call and artifact read; production code is unchanged. */
export async function memoryStore(opts: { onIo?: IoHook } = {}): Promise<MemoryStore> {
  const jobsDir = await mkdtemp(join(tmpdir(), "deckforge-jobs-"));
  const inner = await createSqliteStore({ dbPath: ":memory:", jobsDir });
  const { onIo } = opts;
  const store: Store = onIo
    ? {
        jobs: inner.jobs,
        stages: inner.stages,
        events: inner.events,
        artifacts: {
          read: (...args) => onIo(inner.artifacts.read(...args)),
          readAccepted: (jobId, kind) => onIo(inner.artifacts.readAccepted(jobId, kind)),
          jobDir: (jobId) => inner.artifacts.jobDir(jobId),
        },
        createJob: async (job) => hookSession(await onIo(inner.createJob(job)), onIo),
        claim: async (...args) => {
          const session = await onIo(inner.claim(...args));
          return session && hookSession(session, onIo);
        },
        reclaimStale: (...args) => onIo(inner.reclaimStale(...args)),
        close: () => inner.close(),
      }
    : inner;
  return {
    store,
    jobsDir,
    dispose: async () => {
      await inner.close();
      await rm(jobsDir, { recursive: true, force: true });
    },
  };
}
