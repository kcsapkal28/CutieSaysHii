import type {
  BriefSpec,
  Choices,
  DeckSpec,
  InteractionPlan,
  MotionPlan,
  QAReport,
  RenderManifest,
  ThemeSpec,
} from "@deckforge/schemas";
import type {
  AcceptedDoc,
  AcceptedDocOf,
  AcceptedKind,
  JobRecord,
  JobStatus,
  StageArtifact,
  StageKey,
  StageName,
  StageRecord,
} from "./contracts.ts";
import type { ErrorInfo } from "./errors.ts";
import type { EventEnvelope, StageEvent } from "./events.ts";

/** Epoch milliseconds throughout. */
export interface Clock {
  now(): number;
  /** Resolves after `ms`; once the signal aborts, clears its timer and rejects with `signal.reason`. */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  /** Calls `fn` every `ms` until the returned stop function is called. */
  every(ms: number, fn: () => void): () => void;
}

export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

export interface IdSource {
  jobId(): string;
  /** Identifies this harness process as a job owner. */
  instanceId(): string;
}

export type RenderRequest = {
  jobId: string;
  deck: DeckSpec;
  theme: ThemeSpec;
  motion: MotionPlan;
  interaction: InteractionPlan;
  outDir: string;
};

export interface RendererPort {
  build(req: RenderRequest, signal: AbortSignal): Promise<RenderManifest>;
}

export type QaRequest = { distDir: string; manifest: RenderManifest; deck: DeckSpec; wordCap: number };

export interface QaPort {
  run(req: QaRequest, signal: AbortSignal): Promise<QAReport>;
}

export type JobListQuery = { limit: number; status?: JobStatus };

export interface JobReads {
  get(id: string): Promise<JobRecord | undefined>;
  /** Newest first. */
  list(query: JobListQuery): Promise<JobRecord[]>;
}

export interface StageReads {
  get(jobId: string, stage: StageName, iteration: number): Promise<StageRecord | undefined>;
  list(jobId: string): Promise<StageRecord[]>;
}

export interface EventReads {
  /** In seq order; only events with seq > afterSeq when given. */
  list(jobId: string, afterSeq?: number): Promise<EventEnvelope[]>;
}

/** Reads return undefined for a missing file and throw CorruptArtifactError for an unreadable one. */
export interface ArtifactReads {
  read(jobId: string, stage: StageName, iteration: number): Promise<StageArtifact | undefined>;
  readAccepted<K extends AcceptedKind>(jobId: string, kind: K): Promise<AcceptedDocOf<K> | undefined>;
  jobDir(jobId: string): string;
}

export type NewJob = { id: string; brief: BriefSpec; choices: Choices; ownerId: string; now: number };

export type JobPatch = Partial<Pick<JobRecord, "status" | "choices" | "error" | "usage" | "distDir">> & {
  updatedAt: number;
};

/**
 * The only way to write a job. Every write is conditional on the session's ownerId; a write that
 * affects 0 rows throws CancelledError("ownership lost"). Filesystem writes run after a fenced
 * ownership check, so a small check-then-write window remains.
 */
export interface JobSession {
  readonly jobId: string;
  readonly ownerId: string;
  /** false when this session no longer owns the job. */
  heartbeat(now: number): Promise<boolean>;
  updateJob(patch: JobPatch): Promise<void>;
  upsertStage(record: StageRecord): Promise<void>;
  /** Deletes the job's stage rows not listed in `keep`. */
  retainOnly(keep: readonly StageKey[]): Promise<void>;
  /** Returns the event's seq. */
  appendEvent(event: StageEvent): Promise<number>;
  /** Returns the artifact's path relative to the jobs dir. */
  writeArtifact(artifact: StageArtifact): Promise<string>;
  removeArtifact(stage: StageName, iteration: number): Promise<void>;
  writeAccepted(doc: AcceptedDoc): Promise<void>;
}

export interface Store {
  readonly jobs: JobReads;
  readonly stages: StageReads;
  readonly events: EventReads;
  readonly artifacts: ArtifactReads;
  createJob(job: NewJob): Promise<JobSession>;
  /**
   * Takes ownership in one conditional UPDATE: only when the job is not queued/running, or its
   * heartbeat is older than `staleBefore`. Returns null otherwise.
   */
  claim(id: string, ownerId: string, now: number, staleBefore: number): Promise<JobSession | null>;
  /** Fails stale queued/running jobs and their running stage rows in one transaction; returns their ids. */
  reclaimStale(staleBefore: number, error: ErrorInfo): Promise<string[]>;
  close(): Promise<void>;
}
