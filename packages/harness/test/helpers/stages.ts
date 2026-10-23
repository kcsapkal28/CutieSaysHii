import { z } from "zod";
import type { PipelineState, StageName, StageSummary } from "../../src/kernel/contracts.ts";
import {
  BudgetError,
  CancelledError,
  InputError,
  InternalError,
  LlmAuthError,
  LlmBadRequestError,
  LlmConfigError,
  LlmQuotaError,
  LlmRefusalError,
  LlmTransientError,
  LlmUnreachableError,
  RenderFailedError,
  TimeoutError,
  ValidationError,
  type ErrorKind,
  type HarnessError,
} from "../../src/kernel/errors.ts";
import type { RetryPolicy, StageContext, StageDef } from "../../src/kernel/stage.ts";

export const ToyIoSchema = z.object({ topic: z.string() });
export type ToyIo = z.infer<typeof ToyIoSchema>;

export type ToyOptions = {
  name?: StageName;
  version?: string;
  timeoutMs?: number;
  retry?: RetryPolicy;
  dependsOn?: StageName[];
};

export function toyState(): PipelineState {
  return {
    brief: {
      topic: "How solar cells work",
      brief: "Explain the photovoltaic effect to a general audience in plain words.",
      audience: "general",
      durationMin: 10,
      language: "en",
    },
    choices: {
      depth: "standard",
      styleFamilyId: "toy-family",
      paletteId: "toy-palette",
      typeFamilyId: "toy-type",
      motionTemplateId: "toy-motion",
      interactionModeId: "toy-mode",
      threeJs: false,
    },
  };
}

export function toySummary(stage: StageName): StageSummary {
  switch (stage) {
    case "content":
      return { stage, slideCount: 0, slideTypes: [] };
    case "design":
      return { stage, overrides: 0, placements: 0 };
    case "render":
      return { stage, slideIds: [], totalBytes: 0, warnings: [] };
    case "qa":
      return { stage, pass: true, failures: [] };
    case "patch":
      return { stage, patches: [] };
  }
}

function toyStage(o: ToyOptions, run: (input: ToyIo, ctx: StageContext) => Promise<ToyIo>): StageDef<ToyIo, ToyIo> {
  const name = o.name ?? "content";
  return {
    name,
    version: o.version ?? `toy-${name}.v1`,
    timeoutMs: o.timeoutMs ?? 1_000,
    retry: o.retry ?? { validation: 0 },
    dependsOn: o.dependsOn ?? [],
    input: ToyIoSchema,
    output: ToyIoSchema,
    select: (state) => ({ topic: state.brief.topic }),
    reduce: (state) => state,
    fingerprint: (input) => input,
    summarize: () => toySummary(name),
    run,
  };
}

/** Returns its input. */
export function echoStage(o: ToyOptions = {}): StageDef<ToyIo, ToyIo> {
  return toyStage(o, async (input) => input);
}

const aborted = (signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener("abort", () => resolve(), { once: true });
  });

/** Runs until ctx.signal aborts, then takes `settleMs` on ctx.clock before rejecting with the abort reason. */
export function hangStage(o: ToyOptions & { settleMs?: number } = {}) {
  const probe = { started: false, settled: false };
  const def = toyStage(o, async (_input, ctx) => {
    probe.started = true;
    await aborted(ctx.signal);
    if (o.settleMs) await ctx.clock.sleep(o.settleMs);
    probe.settled = true;
    throw ctx.signal.reason;
  });
  return { def, probe };
}

/** Rejects with an error of the given kind. */
export function throwStage(kind: ErrorKind, o: ToyOptions = {}): StageDef<ToyIo, ToyIo> {
  return toyStage(o, async () => {
    throw errorOfKind(kind);
  });
}

export function errorOfKind(kind: ErrorKind, message = `toy ${kind}`): HarnessError {
  switch (kind) {
    case "input":
      return new InputError(message);
    case "validation":
      return new ValidationError([{ path: "", code: "toy", message }], 1);
    case "timeout":
      return new TimeoutError("content", 50);
    case "budget":
      return new BudgetError(11, 10);
    case "cancelled":
      return new CancelledError(message);
    case "llm_unreachable":
      return new LlmUnreachableError("http://127.0.0.1:9");
    case "llm_config":
      return new LlmConfigError(message);
    case "llm_auth":
      return new LlmAuthError(message);
    case "llm_quota":
      return new LlmQuotaError(message);
    case "llm_transient":
      return new LlmTransientError(message);
    case "llm_refusal":
      return new LlmRefusalError("toy");
    case "llm_bad_request":
      return new LlmBadRequestError(message);
    case "render":
      return new RenderFailedError(message);
    case "internal":
      return new InternalError(message);
  }
}
