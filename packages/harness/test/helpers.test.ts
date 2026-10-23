import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BudgetError,
  CancelledError,
  ERROR_KINDS,
  errorFromInfo as kernelErrorFromInfo,
  InternalError,
  LlmQuotaError,
} from "../src/kernel/errors.ts";
import { FakeClock } from "./helpers/clock.ts";
import { makeTestContext } from "./helpers/context.ts";
import { echoStage, errorFromInfo, errorOfKind, hangStage, throwStage, toyState } from "./helpers/stages.ts";
import type { AnyStageDef } from "../src/kernel/stage.ts";

const usage = (n: number) => ({ inputTokens: n, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });

describe("FakeClock", () => {
  it("resolves sleeps in due order as time advances", async () => {
    const clock = new FakeClock(1_000);
    const order: string[] = [];
    void clock.sleep(30).then(() => order.push(`b@${clock.now()}`));
    void clock.sleep(10).then(() => order.push(`a@${clock.now()}`));
    await clock.advance(29);
    expect(order).toEqual(["a@1010"]);
    await clock.advance(1);
    expect(order).toEqual(["a@1010", "b@1030"]);
    expect(clock.now()).toBe(1_030);
  });

  it("runs timers scheduled by callbacks within the same advance", async () => {
    const clock = new FakeClock();
    const at: number[] = [];
    void clock.sleep(10).then(async () => {
      at.push(clock.now());
      await clock.sleep(10);
      at.push(clock.now());
    });
    await clock.advance(25);
    expect(at).toEqual([10, 20]);
  });

  it("rejects a sleep with the abort reason and clears its timer", async () => {
    const clock = new FakeClock();
    const ac = new AbortController();
    const slept = clock.sleep(100, ac.signal);
    ac.abort(new CancelledError("stop"));
    await expect(slept).rejects.toThrow("stop");
    expect(clock.pendingTimers()).toBe(0);
    await expect(clock.sleep(1, ac.signal)).rejects.toBeInstanceOf(CancelledError);
  });

  it("runUntilIdle fires timers in order and waits for tracked I/O between them", async () => {
    const clock = new FakeClock();
    const dir = await mkdtemp(join(tmpdir(), "fake-clock-"));
    const trail: string[] = [];
    const work = (async () => {
      await clock.sleep(100);
      await clock.track(writeFile(join(dir, "a.json"), "{}"));
      trail.push(`wrote@${clock.now()}`);
      await clock.sleep(50);
      await clock.track(rename(join(dir, "a.json"), join(dir, "b.json")));
      trail.push(`renamed@${clock.now()}`);
    })();
    const deadline = clock.sleep(1_000).then(() => trail.push(`deadline@${clock.now()}`));
    await clock.runUntilIdle();
    await Promise.all([work, deadline]);
    expect(trail).toEqual(["wrote@100", "renamed@150", "deadline@1000"]);
    expect(clock.pendingTimers()).toBe(0);
    await rm(dir, { recursive: true });
  });

  it("runUntilIdle waits for I/O tracked by a continuation of tracked I/O", async () => {
    const clock = new FakeClock();
    const trail: string[] = [];
    const slow = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
    void (async () => {
      await clock.sleep(10);
      await clock.track(slow(15));
      await clock.track(slow(15));
      trail.push(`io@${clock.now()}`);
    })();
    void clock.sleep(20).then(() => trail.push(`timer@${clock.now()}`));
    await clock.runUntilIdle();
    expect(trail).toEqual(["io@10", "timer@20"]);
  });

  it("advance waits for tracked I/O before firing the next due timer", async () => {
    const clock = new FakeClock();
    const trail: string[] = [];
    void (async () => {
      await clock.sleep(10);
      await clock.track(new Promise<void>((resolve) => setTimeout(resolve, 15)));
      trail.push(`io@${clock.now()}`);
    })();
    void clock.sleep(20).then(() => trail.push(`timer@${clock.now()}`));
    await clock.advance(30);
    expect(trail).toEqual(["io@10", "timer@20"]);
  });

  it("track returns the promise's own outcome", async () => {
    const clock = new FakeClock();
    expect(await clock.track(Promise.resolve(7))).toBe(7);
    await expect(clock.track(Promise.reject(new Error("io failed")))).rejects.toThrow("io failed");
    await clock.runUntilIdle();
  });

  it("runUntilIdle fails clearly when tracked I/O never settles", async () => {
    const clock = new FakeClock(0, { settleTimeoutMs: 20 });
    void clock.track(clock.sleep(10));
    await expect(clock.runUntilIdle()).rejects.toThrow("tracked I/O did not settle within 20 ms");
    await expect(clock.advance(5)).rejects.toThrow("tracked I/O did not settle within 20 ms");
  });

  it("runUntilIdle defaults to failing fast on a forgotten every()", async () => {
    const clock = new FakeClock();
    const stop = clock.every(5, () => {});
    await expect(clock.runUntilIdle()).rejects.toThrow("still pending after 200 timers");
    stop();
  });

  it("runUntilIdle refuses to spin on a repeating timer", async () => {
    const clock = new FakeClock();
    const stop = clock.every(5, () => {});
    await expect(clock.runUntilIdle({ ioGraceMs: 0, maxTimers: 10 })).rejects.toThrow("still pending after 10 timers");
    stop();
  });

  it("every repeats until stopped", async () => {
    const clock = new FakeClock();
    const ticks: number[] = [];
    const stop = clock.every(5, () => ticks.push(clock.now()));
    await clock.advance(12);
    stop();
    await clock.advance(20);
    expect(ticks).toEqual([5, 10]);
    expect(clock.pendingTimers()).toBe(0);
  });
});

describe("makeTestContext", () => {
  it("defaults: throwing llm, rejecting renderer and qa, the real catalog", async () => {
    const { ctx } = await makeTestContext();
    await expect(ctx.llm.preflight(ctx.signal)).rejects.toBeInstanceOf(InternalError);
    await expect(ctx.llm.complete({} as never, { signal: ctx.signal })).rejects.toThrow("no llm in this test");
    await expect(ctx.renderer.build({} as never, ctx.signal)).rejects.toThrow("no renderer in this test");
    await expect(ctx.qa.run({} as never, ctx.signal)).rejects.toThrow("no qa in this test");
    expect(ctx.catalog.slideTypes.types.length).toBeGreaterThan(0);
    expect(ctx.iteration).toBe(0);
    expect(ctx.signal.aborted).toBe(false);
  });

  it("reporter records events, attempts, usage and deadline calls", async () => {
    const clock = new FakeClock(500);
    const { ctx, events, attempts, meter, probe } = await makeTestContext({ stage: "design", iteration: 2, clock });
    ctx.report.progress("calling");
    ctx.report.warn("careful");
    const notice = { reason: "validation", attempt: 1, maxAttempts: 3, waitMs: 0, detail: "bad", extra: "dropped" } as const;
    ctx.report.retry(notice);
    ctx.report.attempt({ n: 1, outcome: "ok", usage: usage(5), usageKnown: true, durationMs: 3 });
    ctx.report.usage(usage(5));
    ctx.report.beginAttempt();
    ctx.report.extendDeadline(2_000, "rate-limit");
    const common = { jobId: ctx.jobId, at: 500, stage: "design", iteration: 2 };
    expect(events).toEqual([
      { type: "stage:progress", ...common, message: "calling" },
      { type: "stage:warning", ...common, message: "careful" },
      { type: "stage:retry", ...common, reason: "validation", attempt: 1, maxAttempts: 3, waitMs: 0, detail: "bad" },
    ]);
    expect(attempts).toHaveLength(1);
    expect(meter.total).toBe(5);
    expect(probe).toEqual({ beginAttempts: 1, extendedMs: 2_000 });
  });

  it("usage throws BudgetError over the budget and beginAttempt refuses once it is spent", async () => {
    const { ctx } = await makeTestContext({ tokenBudget: 10 });
    ctx.report.usage(usage(10));
    expect(() => ctx.report.beginAttempt()).toThrow(BudgetError);
    expect(() => ctx.report.usage(usage(1))).toThrow(BudgetError);
  });

  it("overrides replace ports", async () => {
    const catalog = (await makeTestContext()).ctx.catalog;
    const ac = new AbortController();
    const { ctx } = await makeTestContext({ catalog, signal: ac.signal, jobId: "j_9", paths: { distDir: "/x/dist" } });
    expect(ctx.catalog).toBe(catalog);
    expect(ctx.signal).toBe(ac.signal);
    expect(ctx.jobId).toBe("j_9");
    expect(ctx.paths.distDir).toBe("/x/dist");
  });
});

describe("toy stages", () => {
  it("echo selects the topic and returns it", async () => {
    const { ctx } = await makeTestContext();
    const def: AnyStageDef = echoStage({ name: "render" });
    const state = toyState();
    const input = def.input.parse(def.select(state, ctx.catalog));
    expect(input).toEqual({ topic: state.brief.topic });
    const out = await def.run(input, ctx);
    expect(def.output.parse(out)).toEqual(input);
    expect(def.summarize(out).stage).toBe("render");
    expect(def.reduce(state, out)).toEqual(state);
    expect(def.fingerprint(input, ctx.catalog)).toEqual(input);
  });

  it("hang waits for abort, then settles after its delay with the abort reason", async () => {
    const clock = new FakeClock();
    const ac = new AbortController();
    const { ctx } = await makeTestContext({ clock, signal: ac.signal });
    const hang = hangStage({ settleMs: 100 });
    const running = hang.def.run({ topic: "t" }, ctx);
    const outcome = running.catch((e: unknown) => e);
    await clock.advance(1_000);
    expect(hang.probe).toEqual({ started: true, settled: false });
    ac.abort(new CancelledError("stop"));
    await clock.advance(99);
    expect(hang.probe.settled).toBe(false);
    await clock.advance(1);
    expect(hang.probe.settled).toBe(true);
    expect(await outcome).toBeInstanceOf(CancelledError);
  });

  it("throw rejects with an error of the given kind", async () => {
    const { ctx } = await makeTestContext();
    await expect(throwStage("llm_quota").run({ topic: "t" }, ctx)).rejects.toBeInstanceOf(LlmQuotaError);
    for (const kind of ERROR_KINDS) expect(errorOfKind(kind).kind).toBe(kind);
    expect(errorOfKind("llm_auth", "nope").message).toBe("nope");
    expect(errorFromInfo).toBe(kernelErrorFromInfo);
  });
});
