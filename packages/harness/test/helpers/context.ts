import type { Catalog } from "@deckforge/catalog";
import { loadCatalog } from "@deckforge/catalog/node";
import type { AttemptRecord, StageName } from "../../src/kernel/contracts.ts";
import { InternalError } from "../../src/kernel/errors.ts";
import type { StageEvent } from "../../src/kernel/events.ts";
import type { LlmPort } from "../../src/kernel/llm-port.ts";
import { TokenMeter } from "../../src/kernel/meter.ts";
import type { Logger, QaPort, RendererPort } from "../../src/kernel/ports.ts";
import type { StageContext, StageReporter } from "../../src/kernel/stage.ts";
import { FakeClock } from "./clock.ts";

export type TestContextOptions = Partial<StageContext> & {
  /** Stage named in the reporter's events (default "content"). */
  stage?: StageName;
  tokenBudget?: number;
};

export type LogEntry = { level: keyof Logger; message: string; data?: Record<string, unknown> };

export type TestContext = {
  ctx: StageContext;
  /** Events emitted through ctx.report. */
  events: StageEvent[];
  attempts: AttemptRecord[];
  meter: TokenMeter;
  logs: LogEntry[];
  probe: { beginAttempts: number; extendedMs: number };
};

let catalogOnce: Promise<Catalog> | undefined;
export function testCatalog(): Promise<Catalog> {
  catalogOnce ??= loadCatalog();
  return catalogOnce;
}

const reject = (what: string) => () => Promise.reject(new InternalError(`no ${what} in this test`));

export const throwingLlm: LlmPort = { preflight: reject("llm"), complete: reject("llm") };
export const rejectingRenderer: RendererPort = { build: reject("renderer") };
export const rejectingQa: QaPort = { run: reject("qa") };

export function recordingLogger(logs: LogEntry[]): Logger {
  const at = (level: keyof Logger) => (message: string, data?: Record<string, unknown>) => {
    logs.push(data === undefined ? { level, message } : { level, message, data });
  };
  return { debug: at("debug"), info: at("info"), warn: at("warn"), error: at("error") };
}

/** A StageContext with safe defaults: the llm throws, renderer and qa reject, the catalog is the real one. */
export async function makeTestContext(overrides: TestContextOptions = {}): Promise<TestContext> {
  const { stage = "content", tokenBudget = 250_000, ...ports } = overrides;
  const events: StageEvent[] = [];
  const attempts: AttemptRecord[] = [];
  const logs: LogEntry[] = [];
  const meter = new TokenMeter(tokenBudget);
  const probe = { beginAttempts: 0, extendedMs: 0 };
  const clock = ports.clock ?? new FakeClock();
  const jobId = ports.jobId ?? "j_test";
  const iteration = ports.iteration ?? 0;
  const common = () => ({ jobId, at: clock.now(), stage, iteration });

  const report: StageReporter = {
    progress: (message) => events.push({ type: "stage:progress", ...common(), message }),
    warn: (message) => events.push({ type: "stage:warning", ...common(), message }),
    retry: (notice) => events.push({ type: "stage:retry", ...common(), ...notice }),
    attempt: (record) => attempts.push(record),
    usage: (usage) => meter.add(usage),
    beginAttempt: () => {
      meter.assertCanSpend();
      probe.beginAttempts += 1;
    },
    extendDeadline: (ms) => {
      probe.extendedMs += ms;
    },
  };

  const ctx: StageContext = {
    jobId,
    iteration,
    llm: throwingLlm,
    renderer: rejectingRenderer,
    qa: rejectingQa,
    logger: recordingLogger(logs),
    signal: new AbortController().signal,
    paths: { distDir: "jobs/j_test/dist" },
    retry: { validation: 2 },
    report,
    ...ports,
    catalog: ports.catalog ?? (await testCatalog()),
    clock,
  };
  return { ctx, events, attempts, meter, logs, probe };
}
