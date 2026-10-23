import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ZERO_USAGE, type AttemptRecord, type StageName, type TokenUsage } from "../../src/kernel/contracts.ts";
import {
  BudgetError,
  CancelledError,
  InternalError,
  OWNERSHIP_LOST,
  TimeoutError,
  ValidationError,
} from "../../src/kernel/errors.ts";
import type { StageEvent } from "../../src/kernel/events.ts";
import { hashOf } from "../../src/kernel/hash.ts";
import type { LlmPort } from "../../src/kernel/llm-port.ts";
import { TokenMeter } from "../../src/kernel/meter.ts";
import type { JobSession } from "../../src/kernel/ports.ts";
import {
  MAX_BACKOFF_MS,
  SETTLE_GRACE_MS,
  type AnyStageDef,
  type RetryNotice,
  type StageContext,
  type StageDef,
} from "../../src/kernel/stage.ts";
import { executeStage, upstreamOf, validateRegistry, type ExecutorEnv } from "../../src/stages/execute.ts";
import { FakeClock } from "../helpers/clock.ts";
import {
  recordingLogger,
  rejectingQa,
  rejectingRenderer,
  testCatalog,
  throwingLlm,
  type LogEntry,
} from "../helpers/context.ts";
import { echoStage, hangStage, toyState, toySummary, type ToyIo, type ToyOptions } from "../helpers/stages.ts";
import { memoryStore, type MemoryStore } from "../helpers/store.ts";

const T0 = 1_000;
const TOPIC = toyState().brief.topic;
const usage = (n: number): TokenUsage => ({ ...ZERO_USAGE, inputTokens: n });

type Rig = {
  clock: FakeClock;
  m: MemoryStore;
  session: JobSession;
  env: ExecutorEnv;
  events: StageEvent[];
  logs: LogEntry[];
  meter: TokenMeter;
};

const rigs: Rig[] = [];
afterEach(async () => {
  await Promise.all(rigs.splice(0).map((r) => r.m.dispose()));
});

async function rig(opts: { tokenBudget?: number; llm?: LlmPort } = {}): Promise<Rig> {
  const clock = new FakeClock(T0);
  const m = await memoryStore({ onIo: (p) => clock.track(p) });
  const { brief, choices } = toyState();
  const session = await m.store.createJob({ id: "j_1", brief, choices, ownerId: "A", now: T0 });
  const events: StageEvent[] = [];
  const logs: LogEntry[] = [];
  const meter = new TokenMeter(opts.tokenBudget ?? 250_000);
  const env: ExecutorEnv = {
    ports: {
      llm: opts.llm ?? throwingLlm,
      catalog: await testCatalog(),
      renderer: rejectingRenderer,
      qa: rejectingQa,
      clock,
      logger: recordingLogger(logs),
    },
    session,
    emit: (e) => events.push(e),
    meter,
    distDir: join(m.jobsDir, "j_1", "dist"),
  };
  const r = { clock, m, session, env, events, logs, meter };
  rigs.push(r);
  return r;
}

type Outcome<O> = ({ ok: true; value: O } | { ok: false; error: unknown }) & { at: number };

/** Runs the stage and drives fake time until everything (timers and tracked I/O) is idle. */
async function exec<O>(
  r: Rig,
  def: StageDef<ToyIo, O>,
  opts: { iteration?: number; signal?: AbortSignal; onSettled?: () => void } = {},
): Promise<Outcome<O>> {
  const req = { iteration: opts.iteration ?? 0, state: toyState(), signal: opts.signal ?? new AbortController().signal };
  const outcome = executeStage(def, req, r.env).then(
    (value) => ({ ok: true as const, value, at: r.clock.now() }),
    (error: unknown) => ({ ok: false as const, error, at: r.clock.now() }),
  );
  void outcome.then(() => opts.onSettled?.());
  await r.clock.runUntilIdle();
  return outcome;
}

function stage(o: ToyOptions, run: (input: ToyIo, ctx: StageContext) => Promise<ToyIo>): StageDef<ToyIo, ToyIo> {
  return { ...echoStage(o), run };
}

/** One LLM-like attempt: the pre-call check, then `ms` of waiting on the stage signal. */
async function attempt(ctx: StageContext, ms: number): Promise<void> {
  ctx.report.beginAttempt();
  await ctx.clock.sleep(ms, ctx.signal);
}

const failure = (o: Outcome<unknown>) => {
  if (o.ok) throw new Error("expected the stage to fail");
  return o.error;
};

const types = (events: StageEvent[]) => events.map((e) => e.type);
const rowOf = (r: Rig, name: StageName = "content", iteration = 0) => r.m.store.stages.get("j_1", name, iteration);
const artifactOf = (r: Rig, name: StageName = "content", iteration = 0) => r.m.store.artifacts.read("j_1", name, iteration);

describe("executeStage", () => {
  it("runs, persists artifact + row, emits start→done with summary and inputHash", async () => {
    const r = await rig();
    const record: AttemptRecord = { n: 1, outcome: "ok", usage: usage(120), usageKnown: true, durationMs: 20 };
    const seen: Partial<StageContext> = {};
    let stageSignal: AbortSignal | undefined;
    const def = stage({ version: "toy.v7", retry: { validation: 2 } }, async (input, ctx) => {
      Object.assign(seen, { jobId: ctx.jobId, iteration: ctx.iteration, paths: ctx.paths, retry: ctx.retry });
      stageSignal = ctx.signal;
      await attempt(ctx, 20);
      ctx.report.usage(usage(120));
      ctx.report.attempt(record);
      return { topic: input.topic.toUpperCase() };
    });

    const out = await exec(r, def, { iteration: 2 });

    expect(out).toEqual({ ok: true, value: { topic: TOPIC.toUpperCase() }, at: T0 + 20 });
    expect(seen).toEqual({ jobId: "j_1", iteration: 2, paths: { distDir: r.env.distDir }, retry: { validation: 2 } });
    const inputHash = hashOf({ stage: "content", version: "toy.v7", fingerprint: { topic: TOPIC } });
    const common = { jobId: "j_1", stage: "content", iteration: 2 } as const;
    expect(r.events).toEqual([
      { type: "stage:start", ...common, at: T0 },
      {
        type: "stage:done",
        ...common,
        at: T0 + 20,
        durationMs: 20,
        backoffMs: 0,
        usage: usage(120),
        inputHash,
        summary: toySummary("content"),
      },
    ]);
    expect(await rowOf(r, "content", 2)).toEqual({
      ...common,
      status: "succeeded",
      inputHash,
      artifactPath: "j_1/content.2.json",
      startedAt: T0,
      finishedAt: T0 + 20,
      durationMs: 20,
      backoffMs: 0,
      attempts: 1,
      usage: usage(120),
      summary: toySummary("content"),
      error: null,
    });
    expect(await artifactOf(r, "content", 2)).toEqual({
      ...common,
      version: "toy.v7",
      inputHash,
      fingerprint: { topic: TOPIC },
      input: { topic: TOPIC },
      output: { topic: TOPIC.toUpperCase() },
      error: null,
      startedAt: T0,
      durationMs: 20,
      backoffMs: 0,
      usage: usage(120),
      attempts: [record],
    });
    expect(r.meter.usage).toEqual(usage(120));
    // The deadlines were disposed, not merely outrun: the idle clock fired everything left.
    expect(stageSignal?.aborted).toBe(false);
  });

  it("upserts the row running before the stage runs", async () => {
    const r = await rig();
    const rows: unknown[] = [];
    const def = stage({}, async (input) => {
      rows.push(await r.m.store.stages.get("j_1", "content", 0));
      return input;
    });
    await exec(r, def);
    expect(rows).toEqual([expect.objectContaining({ status: "running", finishedAt: null, artifactPath: null })]);
  });

  it("identical input runs again (no caching) and upserts the same row", async () => {
    const r = await rig();
    const run = vi.fn(async (input: ToyIo, ctx: StageContext) => {
      await ctx.clock.sleep(5, ctx.signal);
      return input;
    });
    const def = stage({}, run);

    await exec(r, def);
    const first = await rowOf(r);
    await exec(r, def);

    expect(run).toHaveBeenCalledTimes(2);
    const rows = await r.m.store.stages.list("j_1");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "succeeded", inputHash: first!.inputHash, startedAt: T0 + 5, finishedAt: T0 + 10 });
    expect(types(r.events)).toEqual(["stage:start", "stage:done", "stage:start", "stage:done"]);
  });

  it("warn → stage:warning; progress and retry pass through with picked fields", async () => {
    const r = await rig();
    const def = stage({}, async (input, ctx) => {
      ctx.report.progress("drafting");
      ctx.report.warn("component x is pending");
      const notice = { reason: "rate-limit", attempt: 1, maxAttempts: 5, waitMs: 300, detail: "429", status: 429 };
      ctx.report.retry({ ...notice, secret: "dropped" } as RetryNotice);
      ctx.report.retry({ reason: "validation", attempt: 2, maxAttempts: 3, waitMs: 0, detail: "bad output" });
      return input;
    });

    await exec(r, def);

    const common = { jobId: "j_1", at: T0, stage: "content", iteration: 0 } as const;
    expect(r.events.slice(1, -1)).toEqual([
      { type: "stage:progress", ...common, message: "drafting" },
      { type: "stage:warning", ...common, message: "component x is pending" },
      { type: "stage:retry", ...common, reason: "rate-limit", attempt: 1, maxAttempts: 5, waitMs: 300, detail: "429", status: 429 },
      { type: "stage:retry", ...common, reason: "validation", attempt: 2, maxAttempts: 3, waitMs: 0, detail: "bad output" },
    ]);
  });

  describe("deadlines", () => {
    it("per-attempt timeout with beginAttempt restarts succeeds", async () => {
      const r = await rig();
      const def = stage({ timeoutMs: 50, retry: { validation: 2 } }, async (input, ctx) => {
        for (let i = 0; i < 3; i++) await attempt(ctx, 40);
        return input;
      });

      const out = await exec(r, def);

      expect(out).toMatchObject({ ok: true, at: T0 + 120 });
      expect(await rowOf(r)).toMatchObject({ status: "succeeded", durationMs: 120 });
    });

    it("single attempt over 50 ms → \"stage content exceeded 50 ms\"", async () => {
      const r = await rig();
      const def = stage({ timeoutMs: 50, retry: { validation: 2 } }, async (input, ctx) => {
        await attempt(ctx, 60);
        return input;
      });

      const out = await exec(r, def);

      const error = failure(out);
      expect(error).toBeInstanceOf(TimeoutError);
      expect((error as TimeoutError).message).toBe("stage content exceeded 50 ms");
      expect(out.at).toBe(T0 + 50);
      const info = { kind: "timeout", message: "stage content exceeded 50 ms" };
      expect(await rowOf(r)).toMatchObject({ status: "failed", error: info, durationMs: 50, summary: null });
      expect(r.events.at(-1)).toEqual({
        type: "stage:error",
        jobId: "j_1",
        at: T0 + 50,
        stage: "content",
        iteration: 0,
        error: info,
        durationMs: 50,
      });
    });

    it("overall cap at timeout × 2 with retry.validation 1", async () => {
      const r = await rig();
      const def = stage({ timeoutMs: 50, retry: { validation: 1 } }, async (input, ctx) => {
        for (;;) await attempt(ctx, 40);
      });

      const out = await exec(r, def);

      expect(failure(out)).toMatchObject({ kind: "timeout", message: "stage content exceeded 100 ms" });
      expect(out.at).toBe(T0 + 100);
    });

    it("the timeout names the stage and honours env.timeouts", async () => {
      const r = await rig();
      r.env.timeouts = { render: 30 };
      const def = stage({ name: "render", timeoutMs: 50 }, async (input, ctx) => {
        await attempt(ctx, 40);
        return input;
      });

      const out = await exec(r, def);

      expect(failure(out)).toMatchObject({ kind: "timeout", message: "stage render exceeded 30 ms" });
      expect(out.at).toBe(T0 + 30);
    });

    it("extendDeadline postpones the timeout and is reported as backoffMs", async () => {
      const r = await rig();
      // validation 0: the cap equals the attempt deadline, so both must move.
      const def = stage({ timeoutMs: 50, retry: { validation: 0 } }, async (input, ctx) => {
        ctx.report.beginAttempt();
        await ctx.clock.sleep(30, ctx.signal);
        ctx.report.extendDeadline(40, "rate-limit");
        await ctx.clock.sleep(55, ctx.signal);
        return input;
      });

      const out = await exec(r, def);

      expect(out).toMatchObject({ ok: true, at: T0 + 85 });
      expect(r.events.at(-1)).toMatchObject({ type: "stage:done", backoffMs: 40, durationMs: 85 });
      expect(await rowOf(r)).toMatchObject({ backoffMs: 40 });
      expect(await artifactOf(r)).toMatchObject({ backoffMs: 40 });
    });

    it("backoffMs counts only the extension granted within MAX_BACKOFF_MS", async () => {
      const r = await rig();
      const def = stage({ timeoutMs: 50 }, async (input, ctx) => {
        ctx.report.beginAttempt();
        ctx.report.extendDeadline(MAX_BACKOFF_MS - 1_000, "rate-limit");
        ctx.report.extendDeadline(5_000, "rate-limit");
        await ctx.clock.sleep(MAX_BACKOFF_MS + 60, ctx.signal);
        return input;
      });

      const out = await exec(r, def);

      expect(failure(out)).toMatchObject({ kind: "timeout", message: "stage content exceeded 50 ms" });
      expect(out.at).toBe(T0 + 50 + MAX_BACKOFF_MS);
      expect(await rowOf(r)).toMatchObject({ status: "failed", backoffMs: MAX_BACKOFF_MS });
    });
  });

  describe("budget", () => {
    it("beginAttempt after the budget is spent → BudgetError, no LLM call", async () => {
      const complete = vi.fn<LlmPort["complete"]>();
      const r = await rig({ tokenBudget: 100, llm: { preflight: vi.fn(), complete } });
      r.meter.add(usage(100));
      const def = stage({}, async (input, ctx) => {
        ctx.report.beginAttempt();
        await ctx.llm.complete({} as never, { signal: ctx.signal });
        return input;
      });

      const out = await exec(r, def);

      expect(failure(out)).toBeInstanceOf(BudgetError);
      expect(failure(out)).toMatchObject({ message: "token budget exhausted: 100 of 100" });
      expect(complete).not.toHaveBeenCalled();
      expect(await rowOf(r)).toMatchObject({ status: "failed", error: { kind: "budget" } });
    });

    it("usage over budget → BudgetError", async () => {
      const r = await rig({ tokenBudget: 100 });
      const def = stage({}, async (input, ctx) => {
        ctx.report.beginAttempt();
        ctx.report.usage(usage(150));
        return input;
      });

      const out = await exec(r, def);

      expect(failure(out)).toBeInstanceOf(BudgetError);
      expect(failure(out)).toMatchObject({ message: "token budget exceeded: 150 > 100" });
      expect(await rowOf(r)).toMatchObject({ status: "failed", usage: usage(150), error: { kind: "budget" } });
      expect(await artifactOf(r)).toMatchObject({ usage: usage(150), output: null });
    });
  });

  describe("cancellation", () => {
    it("cancel is not reported as timeout", async () => {
      const r = await rig();
      const { def, probe } = hangStage({ timeoutMs: 50 });
      const ac = new AbortController();
      void r.clock.sleep(10).then(() => ac.abort(new CancelledError()));

      const out = await exec(r, def, { signal: ac.signal });

      expect(probe.settled).toBe(true);
      expect(failure(out)).toBeInstanceOf(CancelledError);
      expect(failure(out)).toMatchObject({ message: "cancelled" });
      expect(out.at).toBe(T0 + 10);
      expect(await rowOf(r)).toMatchObject({ status: "failed", error: { kind: "cancelled", message: "cancelled" } });
    });

    it("a bare abort() (DOMException AbortError) maps to CancelledError", async () => {
      const r = await rig();
      const { def } = hangStage({ timeoutMs: 50 });
      const ac = new AbortController();
      void r.clock.sleep(10).then(() => ac.abort());

      const out = await exec(r, def, { signal: ac.signal });

      expect(failure(out)).toBeInstanceOf(CancelledError);
      expect(await rowOf(r)).toMatchObject({ status: "failed", error: { kind: "cancelled" } });
    });

    it("a request aborted before the stage starts runs and writes nothing", async () => {
      const r = await rig();
      const run = vi.fn(async (input: ToyIo) => input);
      const ac = new AbortController();
      ac.abort(new CancelledError("stop"));

      const out = await exec(r, stage({}, run), { signal: ac.signal });

      expect(failure(out)).toMatchObject({ kind: "cancelled", message: "stop" });
      expect(run).not.toHaveBeenCalled();
      expect(r.events).toEqual([]);
      expect(await r.m.store.stages.list("j_1")).toEqual([]);
    });

    it("waits for the abandoned run to settle", async () => {
      const r = await rig();
      const { def, probe } = hangStage({ timeoutMs: 50, settleMs: 1_000 });
      const settledFirst: boolean[] = [];

      const out = await exec(r, def, { onSettled: () => settledFirst.push(probe.settled) });

      expect(settledFirst).toEqual([true]);
      expect(failure(out)).toMatchObject({ kind: "timeout", message: "stage content exceeded 50 ms" });
      expect(out.at).toBe(T0 + 1_050);
      expect(await rowOf(r)).toMatchObject({ status: "failed", finishedAt: T0 + 1_050, durationMs: 1_050 });
    });

    it("gives up on a run that outlives SETTLE_GRACE_MS, and logs it", async () => {
      const r = await rig();
      const { def, probe } = hangStage({ timeoutMs: 50, settleMs: SETTLE_GRACE_MS + 5_000 });
      const settledFirst: boolean[] = [];

      const out = await exec(r, def, { onSettled: () => settledFirst.push(probe.settled) });

      expect(settledFirst).toEqual([false]);
      expect(failure(out)).toMatchObject({ kind: "timeout" });
      expect(out.at).toBe(T0 + 50 + SETTLE_GRACE_MS);
      expect(r.logs).toContainEqual(expect.objectContaining({ level: "warn", message: expect.stringContaining("did not settle") }));
      expect(probe.settled).toBe(true);
      expect(types(r.events)).toEqual(["stage:start", "stage:error"]);
    });

    it("reporter calls from an abandoned run are dropped", async () => {
      const r = await rig();
      const def = stage({ timeoutMs: 50 }, async (input, ctx) => {
        await new Promise<void>((resolve) => ctx.signal.addEventListener("abort", () => resolve(), { once: true }));
        await ctx.clock.sleep(SETTLE_GRACE_MS + 10);
        ctx.report.warn("too late");
        return input;
      });

      await exec(r, def);

      expect(types(r.events)).toEqual(["stage:start", "stage:error"]);
    });
  });

  describe("ownership", () => {
    const stealAt = (r: Rig, ms: number, after?: () => void) =>
      r.clock.sleep(ms).then(async () => {
        await r.clock.track(r.m.store.claim("j_1", "B", r.clock.now(), r.clock.now() + 1));
        after?.();
      });

    const isOwnershipLost = (e: unknown) => e instanceof CancelledError && e.reason === OWNERSHIP_LOST;

    it("ownership lost mid-stage surfaces as CancelledError(\"ownership lost\") and writes nothing further", async () => {
      const r = await rig();
      const { def } = hangStage({ timeoutMs: 50 });
      const ac = new AbortController();
      // The heartbeat notices the new owner and aborts the job.
      void stealAt(r, 10, () => ac.abort(CancelledError.ownershipLost()));
      const write = vi.spyOn(r.session, "writeArtifact");
      const upsert = vi.spyOn(r.session, "upsertStage");

      const out = await exec(r, def, { signal: ac.signal });

      expect(failure(out)).toSatisfy(isOwnershipLost);
      expect(write).not.toHaveBeenCalled();
      expect(upsert.mock.calls.map(([row]) => row.status)).toEqual(["running"]);
      expect(await rowOf(r)).toMatchObject({ status: "running" });
      expect(await readdir(join(r.m.jobsDir, "j_1")).catch(() => [])).toEqual([]);
      expect(types(r.events)).toEqual(["stage:start"]);
    });

    it("ownership lost while a timed-out run settles outranks the timeout", async () => {
      const r = await rig();
      const { def, probe } = hangStage({ timeoutMs: 50, settleMs: 1_000 });
      const ac = new AbortController();
      void stealAt(r, 500, () => ac.abort(CancelledError.ownershipLost()));
      const write = vi.spyOn(r.session, "writeArtifact");

      const out = await exec(r, def, { signal: ac.signal });

      expect(probe.settled).toBe(true);
      expect(failure(out)).toSatisfy(isOwnershipLost);
      expect(out.at).toBe(T0 + 1_050);
      expect(write).not.toHaveBeenCalled();
      expect(types(r.events)).toEqual(["stage:start"]);
    });

    it("a fenced write that loses ownership surfaces as CancelledError(\"ownership lost\")", async () => {
      const r = await rig();
      const def = stage({ timeoutMs: 50 }, async (input, ctx) => {
        await ctx.clock.sleep(20, ctx.signal);
        return input;
      });
      // Taken over before the heartbeat noticed: the request signal never aborts.
      void stealAt(r, 10);

      const out = await exec(r, def);

      expect(failure(out)).toSatisfy(isOwnershipLost);
      expect(await rowOf(r)).toMatchObject({ status: "running" });
      expect(await artifactOf(r)).toBeUndefined();
      expect(types(r.events)).toEqual(["stage:start"]);
    });

    it("a failing stage whose failure write loses ownership surfaces as ownership lost", async () => {
      const r = await rig();
      const def = stage({ timeoutMs: 50 }, async (_input, ctx) => {
        await ctx.clock.sleep(20, ctx.signal);
        throw new ValidationError([], 3);
      });
      void stealAt(r, 10);

      const out = await exec(r, def);

      expect(failure(out)).toSatisfy(isOwnershipLost);
      expect(await artifactOf(r)).toBeUndefined();
      expect(types(r.events)).toEqual(["stage:start"]);
    });
  });

  describe("failures", () => {
    it("failed stage writes artifact with input and error", async () => {
      const r = await rig();
      const record: AttemptRecord = {
        n: 1,
        outcome: "invalid",
        issues: [{ path: "slides", code: "too_small", message: "too few" }],
        usage: usage(40),
        usageKnown: true,
        durationMs: 5,
      };
      const error = new ValidationError(record.issues!, 1);
      const def = stage({ version: "toy.v2" }, async (_input, ctx) => {
        await attempt(ctx, 5);
        ctx.report.usage(usage(40));
        ctx.report.attempt(record);
        throw error;
      });

      const out = await exec(r, def);

      expect(failure(out)).toBe(error);
      const info = { kind: "validation", message: error.message, issues: record.issues };
      const inputHash = hashOf({ stage: "content", version: "toy.v2", fingerprint: { topic: TOPIC } });
      expect(await artifactOf(r)).toEqual({
        jobId: "j_1",
        stage: "content",
        iteration: 0,
        version: "toy.v2",
        inputHash,
        fingerprint: { topic: TOPIC },
        input: { topic: TOPIC },
        output: null,
        error: info,
        startedAt: T0,
        durationMs: 5,
        backoffMs: 0,
        usage: usage(40),
        attempts: [record],
      });
      expect(await rowOf(r)).toMatchObject({
        status: "failed",
        artifactPath: "j_1/content.json",
        finishedAt: T0 + 5,
        attempts: 1,
        usage: usage(40),
        summary: null,
        error: info,
      });
      expect(r.events.at(-1)).toMatchObject({ type: "stage:error", error: info, durationMs: 5 });
    });

    it("a non-harness throw becomes an InternalError", async () => {
      const r = await rig();
      const def = stage({}, async () => {
        throw new Error("boom");
      });

      const out = await exec(r, def);

      expect(failure(out)).toBeInstanceOf(InternalError);
      expect(await rowOf(r)).toMatchObject({ status: "failed", error: { kind: "internal", message: "boom" } });
    });

    it("bad select → InternalError, before any write", async () => {
      const r = await rig();
      const badShape = { ...echoStage(), select: () => ({ topic: 42 }) as unknown as ToyIo };
      const throwing = {
        ...echoStage(),
        select: () => {
          throw new Error("no deck in state");
        },
      };

      for (const def of [badShape, throwing]) {
        const out = await exec(r, def);
        expect(failure(out)).toBeInstanceOf(InternalError);
        expect(failure(out)).toMatchObject({ message: expect.stringContaining("stage content input") });
      }
      expect(r.events).toEqual([]);
      expect(await r.m.store.stages.list("j_1")).toEqual([]);
    });

    it("output that fails its schema is an InternalError on a failed row", async () => {
      const r = await rig();
      const def = stage({}, async () => ({ topic: 7 }) as unknown as ToyIo);

      const out = await exec(r, def);

      expect(failure(out)).toBeInstanceOf(InternalError);
      expect(failure(out)).toMatchObject({ message: expect.stringContaining("stage content output") });
      expect(await rowOf(r)).toMatchObject({ status: "failed", error: { kind: "internal" } });
      expect(await artifactOf(r)).toMatchObject({ output: null, error: { kind: "internal" } });
    });
  });
});

describe("registry", () => {
  const def = (name: StageName, dependsOn: StageName[] = [], o: Partial<AnyStageDef> = {}): AnyStageDef => ({
    ...echoStage({ name, dependsOn }),
    ...o,
  });
  const pipeline = () => [
    def("content"),
    def("design", ["content"]),
    def("render", ["content", "design"]),
    def("qa", ["render"]),
    def("patch", ["qa", "content", "design"]),
  ];

  it("accepts the pipeline", () => {
    expect(() => validateRegistry(pipeline())).not.toThrow();
  });

  it("validateRegistry errors", () => {
    const check = (defs: AnyStageDef[]) => () => validateRegistry(defs);
    expect(check([def("content"), def("content")])).toThrow(/stage content is registered twice/);
    expect(check([def("content"), def("design", ["render"])])).toThrow(/stage design depends on unregistered stage render/);
    expect(check([def("content", ["content"])])).toThrow(/dependency cycle: content → content/);
    expect(check([def("content", ["qa"]), def("design", ["content"]), def("qa", ["design"])])).toThrow(
      /dependency cycle: content → qa → design → content/,
    );
    expect(check([def("content", [], { timeoutMs: 0 })])).toThrow(/stage content timeoutMs must be a positive integer/);
    expect(check([def("content", [], { retry: { validation: -1 } })])).toThrow(
      /stage content retry.validation must be a non-negative integer/,
    );
    expect(check([def("content", [], { version: "" })])).toThrow(/stage content needs a version/);
    expect(check([def("content", [], { timeoutMs: 1.5 }), def("content")])).toThrow(InternalError);
  });

  it("upstreamOf(\"qa\") = {render, content, design}, in registry order", () => {
    const defs = pipeline();
    expect(new Set(upstreamOf(defs, "qa"))).toEqual(new Set(["render", "content", "design"]));
    expect(upstreamOf(defs, "qa")).toEqual(["content", "design", "render"]);
    expect(upstreamOf(defs, "content")).toEqual([]);
    expect(upstreamOf(defs, "design")).toEqual(["content"]);
    expect(() => upstreamOf(defs.slice(0, 2), "qa")).toThrow(InternalError);
  });
});
