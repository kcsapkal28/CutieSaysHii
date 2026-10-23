import type { Catalog } from "@deckforge/catalog";
import type { z } from "zod";
import type { AttemptRecord, PipelineState, StageName, StageSummary, TokenUsage } from "./contracts.ts";
import type { StageEventOf } from "./events.ts";
import type { LlmPort } from "./llm-port.ts";
import type { Clock, Logger, QaPort, RendererPort } from "./ports.ts";

/** Corrective re-asks after invalid output; attempts = 1 + validation. */
export type RetryPolicy = { validation: number };

// Per LLM attempt; each stage is also capped at timeoutMs × (1 + retry.validation).
export const STAGE_TIMEOUTS_MS: Readonly<Record<StageName, number>> = Object.freeze({
  content: 90_000,
  design: 45_000,
  render: 30_000,
  qa: 60_000,
  patch: 45_000,
});
export const MAX_PATCH_LOOPS = 3;
export const MAX_BACKOFF_MS = 120_000;
export const SETTLE_GRACE_MS = 15_000;
export const HEARTBEAT_MS = 5_000;
export const STALE_AFTER_MS = 30_000;

type RetryEvent = StageEventOf<"stage:retry">;
export type RetryNotice = Pick<RetryEvent, "reason" | "attempt" | "maxAttempts" | "waitMs" | "detail" | "status">;

export interface StageReporter {
  progress(message: string): void;
  warn(message: string): void;
  retry(notice: RetryNotice): void;
  attempt(record: AttemptRecord): void;
  /** Adds to the job's meter; throws BudgetError when the job goes over its token budget. */
  usage(usage: TokenUsage): void;
  /** Call before each LLM attempt: restarts the per-attempt deadline; throws BudgetError once the budget is spent. */
  beginAttempt(): void;
  /** Postpones both stage deadlines (within MAX_BACKOFF_MS) and accrues the stage's backoffMs. */
  extendDeadline(ms: number, reason: "rate-limit"): void;
}

/** Everything a stage may touch. There is deliberately no store: the executor owns all persistence. */
export type StageContext = {
  jobId: string;
  iteration: number;
  llm: LlmPort;
  catalog: Catalog;
  renderer: RendererPort;
  qa: QaPort;
  clock: Clock;
  logger: Logger;
  signal: AbortSignal;
  paths: { distDir: string };
  retry: RetryPolicy;
  report: StageReporter;
};

export type StageDef<I, O> = {
  name: StageName;
  /** Recorded in the inputHash; bump when prompts, models or behaviour change. */
  version: string;
  timeoutMs: number;
  retry: RetryPolicy;
  /** Upstream stages whose output this stage reads (used for rerun checks). */
  dependsOn: readonly StageName[];
  input: z.ZodType<I, z.ZodTypeDef, unknown>;
  output: z.ZodType<O, z.ZodTypeDef, unknown>;
  select(state: PipelineState, catalog: Catalog): I;
  reduce(state: PipelineState, output: O): PipelineState;
  /** The request for agents, the input for render/QA. inputHash = hashOf({stage, version, fingerprint}). */
  fingerprint(input: I, catalog: Catalog): unknown;
  summarize(output: O): StageSummary;
  run(input: I, ctx: StageContext): Promise<O>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- registries hold stages of differing I/O
export type AnyStageDef = StageDef<any, any>;
