import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
import { CorruptArtifactError, InputError } from "../kernel/errors.ts";
import type { ArtifactReads } from "../kernel/ports.ts";

/** Unfenced file access; sessions call the writes only after their ownership check. */
export type FsArtifacts = ArtifactReads & {
  /** Returns the path relative to the jobs dir. */
  write(artifact: StageArtifact): Promise<string>;
  remove(jobId: string, stage: StageName, iteration: number): Promise<void>;
  writeAccepted(jobId: string, doc: AcceptedDoc): Promise<void>;
};

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

  // Temp file + rename, so a reader never sees a half-written file.
  async function writeAtomic(rel: string, value: unknown): Promise<void> {
    const file = abs(rel);
    const tmp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
    await mkdir(join(file, ".."), { recursive: true });
    try {
      await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`);
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
      throw new CorruptArtifactError(rel, { cause: e });
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

    async read(jobId, stage, iteration) {
      assertJobId(jobId);
      const a = await readValid(stageRel(jobId, stage, iteration), StageArtifactSchema);
      return a && { ...a, fingerprint: a.fingerprint, input: a.input, output: a.output };
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
