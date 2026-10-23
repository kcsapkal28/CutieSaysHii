import type { Catalog } from "@deckforge/catalog";
import type { z } from "zod";
import {
  addUsage,
  ZERO_USAGE,
  type AttemptRecord,
  type PipelineState,
  type StageName,
  type StageRecord,
  type StageSummary,
  type TokenUsage,
} from "../kernel/contracts.ts";
import { Deadline } from "../kernel/deadline.ts";
import {
  CancelledError,
  errorInfo,
  InternalError,
  OWNERSHIP_LOST,
  toHarnessError,
  type HarnessError,
} from "../kernel/errors.ts";
import type { StageEvent } from "../kernel/events.ts";
import { hashOf } from "../kernel/hash.ts";
import { formatIssues, zodToIssues } from "../kernel/issues.ts";
import type { TokenMeter } from "../kernel/meter.ts";
import type { JobSession } from "../kernel/ports.ts";
import {
  MAX_BACKOFF_MS,
  SETTLE_GRACE_MS,
  type AnyStageDef,
  type StageContext,
  type StageDef,
  type StageReporter,
} from "../kernel/stage.ts";

export type ExecutorEnv = {
  ports: Pick<StageContext, "llm" | "catalog" | "renderer" | "qa" | "clock" | "logger">;
  session: JobSession;
  /** Synchronous hand-off; the job's event log persists each event, then publishes it. */
  emit(e: StageEvent): void;
  meter: TokenMeter;
  distDir: string;
  /** Per-attempt timeouts overriding the stage defaults. */
  timeouts?: Partial<Record<StageName, number>>;
};

export type StageRequest = { iteration: number; state: PipelineState; signal: AbortSignal };

type Outcome<O> = { ok: true; output: O; summary: StageSummary } | { ok: false; error: HarnessError };

const ABORTED = Symbol("aborted");

/**
 * Runs one stage: validates its input and output, enforces its deadlines, and persists the row, the
 * artifact and the events through the job's fenced session. Every call runs the stage (no caching).
 */
export async function executeStage<I, O>(def: StageDef<I, O>, req: StageRequest, env: ExecutorEnv): Promise<O> {
  const { clock, catalog } = env.ports;
  const { session } = env;
  if (req.signal.aborted) throw toHarnessError(req.signal.reason);

  const { input, fingerprint } = prepare(def, req.state, catalog);
  const inputHash = hashOf({ stage: def.name, version: def.version, fingerprint });
  const key = { jobId: session.jobId, stage: def.name, iteration: req.iteration };
  const startedAt = clock.now();
  const attempts: AttemptRecord[] = [];
  let usage: TokenUsage = { ...ZERO_USAGE };
  let backoffMs = 0;
  let open = true;
  const emit = (e: StageEvent) => {
    if (open) env.emit(e);
  };

  emit({ type: "stage:start", ...key, at: startedAt });
  const row = (patch: Partial<StageRecord>): StageRecord => ({
    ...key,
    status: "running",
    inputHash,
    artifactPath: null,
    startedAt,
    finishedAt: null,
    durationMs: null,
    backoffMs,
    attempts: attempts.length,
    usage,
    summary: null,
    error: null,
    ...patch,
  });
  await session.upsertStage(row({}));

  const timeoutMs = env.timeouts?.[def.name] ?? def.timeoutMs;
  const deadlineOptions = { stage: def.name, maxExtensionMs: MAX_BACKOFF_MS, clock };
  const attempt = new Deadline(timeoutMs, deadlineOptions);
  const cap = new Deadline(timeoutMs * (1 + def.retry.validation), deadlineOptions);
  const signal = AbortSignal.any([req.signal, attempt.signal, cap.signal]);
  const common = () => ({ ...key, at: clock.now() });

  const report: StageReporter = {
    progress: (message) => emit({ type: "stage:progress", ...common(), message }),
    warn: (message) => emit({ type: "stage:warning", ...common(), message }),
    retry: ({ reason, attempt: n, maxAttempts, waitMs, detail, status }) =>
      emit({
        type: "stage:retry",
        ...common(),
        reason,
        attempt: n,
        maxAttempts,
        waitMs,
        detail,
        ...(status === undefined ? {} : { status }),
      }),
    attempt: (record) => void attempts.push(record),
    usage: (u) => {
      usage = addUsage(usage, u);
      env.meter.add(u);
    },
    beginAttempt: () => {
      env.meter.assertCanSpend();
      attempt.restart();
    },
    extendDeadline: (ms) => {
      backoffMs += Math.max(attempt.extend(ms), cap.extend(ms));
    },
  };
  const ctx: StageContext = {
    ...env.ports,
    jobId: session.jobId,
    iteration: req.iteration,
    signal,
    paths: { distDir: env.distDir },
    retry: def.retry,
    report,
  };

  let outcome: Outcome<O>;
  try {
    outcome = await runStage(def, input, ctx, req.signal, env.ports);
  } finally {
    // Before any write: a pending deadline must not fire mid-write.
    attempt.dispose();
    cap.dispose();
    open = false;
  }

  const finishedAt = clock.now();
  const durationMs = finishedAt - startedAt;
  const artifact = {
    ...key,
    version: def.version,
    inputHash,
    fingerprint,
    input,
    startedAt,
    durationMs,
    backoffMs,
    usage,
    attempts,
  };

  if (outcome.ok) {
    const { output, summary } = outcome;
    const artifactPath = await session.writeArtifact({ ...artifact, output, error: null });
    await session.upsertStage(row({ status: "succeeded", artifactPath, finishedAt, durationMs, summary }));
    env.emit({ type: "stage:done", ...key, at: finishedAt, durationMs, backoffMs, usage, inputHash, summary });
    return output;
  }

  const { error } = outcome;
  // The new owner holds the job now: write nothing, not even the failure.
  if (error instanceof CancelledError && error.reason === OWNERSHIP_LOST) throw error;
  const info = errorInfo(error);
  const artifactPath = await session.writeArtifact({ ...artifact, output: null, error: info });
  await session.upsertStage(row({ status: "failed", artifactPath, finishedAt, durationMs, error: info }));
  env.emit({ type: "stage:error", ...key, at: finishedAt, error: info, durationMs });
  throw error;
}

/**
 * Races the run against the stage signal. After an abort it waits up to SETTLE_GRACE_MS for the run
 * to settle, then reports the abort: a cancel (or lost ownership) outranks a deadline.
 */
async function runStage<I, O>(
  def: StageDef<I, O>,
  input: I,
  ctx: StageContext,
  requestSignal: AbortSignal,
  { clock, logger }: Pick<StageContext, "clock" | "logger">,
): Promise<Outcome<O>> {
  const settled = Promise.resolve()
    .then(() => def.run(input, ctx))
    .then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
  const first = await Promise.race([settled, aborted(ctx.signal)]);
  if (first === ABORTED) {
    const grace = new AbortController();
    const expired = clock.sleep(SETTLE_GRACE_MS, grace.signal).then(
      () => ABORTED,
      () => ABORTED,
    );
    if ((await Promise.race([settled, expired])) === ABORTED) {
      logger.warn(`stage ${def.name} did not settle within ${SETTLE_GRACE_MS} ms of its abort; abandoning it`, {
        jobId: ctx.jobId,
        iteration: ctx.iteration,
      });
    }
    grace.abort();
    const reason = requestSignal.aborted ? requestSignal.reason : ctx.signal.reason;
    return { ok: false, error: toHarnessError(reason) };
  }
  if (!first.ok) return { ok: false, error: toHarnessError(first.error) };
  try {
    const output = parseOrInternal(def.output, first.value, `stage ${def.name} output`);
    return { ok: true, output, summary: def.summarize(output) };
  } catch (e) {
    return { ok: false, error: toHarnessError(e) };
  }
}

function prepare<I, O>(def: StageDef<I, O>, state: PipelineState, catalog: Catalog): { input: I; fingerprint: unknown } {
  try {
    const input = parseOrInternal(def.input, def.select(state, catalog), `stage ${def.name} input`);
    return { input, fingerprint: def.fingerprint(input, catalog) };
  } catch (e) {
    if (e instanceof InternalError) throw e;
    throw new InternalError(`stage ${def.name} input: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
  }
}

function parseOrInternal<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, value: unknown, what: string): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new InternalError(`${what} failed its schema:\n${formatIssues(zodToIssues(parsed.error))}`, {
    cause: parsed.error,
  });
}

function aborted(signal: AbortSignal): Promise<typeof ABORTED> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve(ABORTED);
    else signal.addEventListener("abort", () => resolve(ABORTED), { once: true });
  });
}

/** Checks names, limits and dependencies; throws one InternalError listing every problem. */
export function validateRegistry(defs: readonly AnyStageDef[]): void {
  const problems: string[] = [];
  const byName = new Map<StageName, AnyStageDef>();
  for (const def of defs) {
    if (byName.has(def.name)) problems.push(`stage ${def.name} is registered twice`);
    byName.set(def.name, def);
    if (!def.version) problems.push(`stage ${def.name} needs a version`);
    if (!Number.isInteger(def.timeoutMs) || def.timeoutMs <= 0) {
      problems.push(`stage ${def.name} timeoutMs must be a positive integer, got ${def.timeoutMs}`);
    }
    if (!Number.isInteger(def.retry.validation) || def.retry.validation < 0) {
      problems.push(`stage ${def.name} retry.validation must be a non-negative integer, got ${def.retry.validation}`);
    }
  }
  for (const def of byName.values()) {
    for (const dep of def.dependsOn) {
      if (!byName.has(dep)) problems.push(`stage ${def.name} depends on unregistered stage ${dep}`);
    }
  }
  const cycle = findCycle(byName);
  if (cycle) problems.push(`dependency cycle: ${cycle.join(" → ")}`);
  if (problems.length > 0) throw new InternalError(`invalid stage registry:\n${problems.map((p) => `- ${p}`).join("\n")}`);
}

function findCycle(byName: ReadonlyMap<StageName, AnyStageDef>): StageName[] | undefined {
  const done = new Set<StageName>();
  const visit = (name: StageName, path: StageName[]): StageName[] | undefined => {
    const at = path.indexOf(name);
    if (at >= 0) return [...path.slice(at), name];
    if (done.has(name)) return undefined;
    for (const dep of byName.get(name)?.dependsOn ?? []) {
      const cycle = visit(dep, [...path, name]);
      if (cycle) return cycle;
    }
    done.add(name);
    return undefined;
  };
  for (const name of byName.keys()) {
    const cycle = visit(name, []);
    if (cycle) return cycle;
  }
  return undefined;
}

/** Every stage `name` reads from, directly or transitively, in registry order. */
export function upstreamOf(defs: readonly AnyStageDef[], name: StageName): StageName[] {
  const byName = new Map(defs.map((d) => [d.name, d] as const));
  const seen = new Set<StageName>();
  const walk = (n: StageName) => {
    const def = byName.get(n);
    if (!def) throw new InternalError(`stage ${n} is not registered`);
    for (const dep of def.dependsOn) {
      if (seen.has(dep)) continue;
      seen.add(dep);
      walk(dep);
    }
  };
  walk(name);
  return defs.map((d) => d.name).filter((n) => seen.has(n));
}
