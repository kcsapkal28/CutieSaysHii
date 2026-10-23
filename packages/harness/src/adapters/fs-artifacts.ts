import { randomBytes } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { z } from "zod";
import {
  AcceptedDocSchema,
  artifactFileName,
  StageArtifactSchema,
  type AcceptedDoc,
  type AcceptedDocOf,
  type AcceptedKind,
  type StageArtifact,
  type StageName,
} from "../kernel/contracts.ts";
import { CorruptArtifactError, InputError, InternalError } from "../kernel/errors.ts";
import type { ArtifactReads } from "../kernel/ports.ts";

/** Unfenced file access; sessions call the writes only after their ownership check. */
export type FsArtifacts = ArtifactReads & {
  /** Returns the path relative to the jobs dir. */
  write(artifact: StageArtifact): Promise<string>;
  remove(jobId: string, stage: StageName, iteration: number): Promise<void>;
  writeAccepted(jobId: string, doc: AcceptedDoc): Promise<void>;
  /**
   * Removes temp files a crashed writer left in the job dir; call only while owning the job. Tries
   * every file, then throws the first failure.
   */
  sweepTemp(jobId: string): Promise<void>;
};

const TEMP_FILE = /\.[0-9a-f]{12}\.tmp$/;

// A job id names one directory under the jobs dir.
function assertJobId(jobId: string): void {
  if (jobId === "" || jobId === "." || jobId === ".." || /[\\/\0]/.test(jobId)) {
    throw new InputError(`invalid job id ${JSON.stringify(jobId)}`);
  }
}

const stageRel = (jobId: string, stage: StageName, iteration: number) => `${jobId}/${artifactFileName(stage, iteration)}`;
const acceptedRel = (jobId: string, kind: AcceptedKind) => `${jobId}/accepted/${kind}.json`;

export function createFsArtifacts(jobsDir: string): FsArtifacts {
  const abs = (rel: string) => join(jobsDir, ...rel.split("/"));

  // Temp file, fsync, rename: a reader never sees a half-written file, and a crash after the
  // rename cannot leave an empty one.
  async function writeAtomic(rel: string, value: unknown): Promise<void> {
    const file = abs(rel);
    const tmp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
    await mkdir(dirname(file), { recursive: true });
    try {
      const handle = await open(tmp, "w");
      try {
        await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(tmp, file);
    } catch (e) {
      await rm(tmp, { force: true });
      throw e;
    }
  }

  async function readValid<S extends z.ZodTypeAny>(rel: string, schema: S): Promise<z.output<S> | undefined> {
    let text: string;
    try {
      text = await readFile(abs(rel), "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw new InternalError(`cannot read artifact ${rel}: ${(e as Error).message}`, { cause: e });
    }
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new CorruptArtifactError(rel, { cause: e });
    }
    const parsed = schema.safeParse(data);
    if (!parsed.success) throw new CorruptArtifactError(rel, { cause: parsed.error });
    return parsed.data;
  }

  return {
    jobDir(jobId) {
      assertJobId(jobId);
      return join(jobsDir, jobId);
    },

    async sweepTemp(jobId) {
      assertJobId(jobId);
      const failures: unknown[] = [];
      for (const dir of [abs(jobId), abs(`${jobId}/accepted`)]) {
        let names: string[];
        try {
          names = await readdir(dir);
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT") failures.push(e);
          continue;
        }
        const removals = names.filter((n) => TEMP_FILE.test(n)).map((n) => rm(join(dir, n), { force: true }));
        for (const r of await Promise.allSettled(removals)) if (r.status === "rejected") failures.push(r.reason);
      }
      if (failures.length > 0) throw failures[0];
    },

    async read(jobId, stage, iteration) {
      assertJobId(jobId);
      return (await readValid(stageRel(jobId, stage, iteration), StageArtifactSchema)) as StageArtifact | undefined;
    },

    async readAccepted<K extends AcceptedKind>(jobId: string, kind: K) {
      assertJobId(jobId);
      const rel = acceptedRel(jobId, kind);
      const doc = await readValid(rel, AcceptedDocSchema);
      if (doc && doc.kind !== kind) throw new CorruptArtifactError(rel);
      return doc as AcceptedDocOf<K> | undefined;
    },

    async write(artifact) {
      assertJobId(artifact.jobId);
      const rel = stageRel(artifact.jobId, artifact.stage, artifact.iteration);
      await writeAtomic(rel, artifact);
      return rel;
    },

    async remove(jobId, stage, iteration) {
      assertJobId(jobId);
      await rm(abs(stageRel(jobId, stage, iteration)), { force: true });
    },

    async writeAccepted(jobId, doc) {
      assertJobId(jobId);
      await writeAtomic(acceptedRel(jobId, doc.kind), doc);
    },
  };
}
