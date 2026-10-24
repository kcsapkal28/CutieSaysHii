// Detached runs: a stage build takes minutes, so it must outlive the SSE request that started it. Each project has
// at most one run; it buffers every event it emits so a client that (re)connects gets a replay, then the live tail.
// The registry lives on globalThis so it survives Next dev hot reloads.
import type { PipelineEvent } from "../events";
import type { StageName } from "../types";

export interface Run {
  projectId: string;
  kind: "stage" | "revise";
  stage: StageName;
  slideId?: string;
  startedAt: string;
  events: PipelineEvent[];
  done: boolean;
  subs: Set<() => void>;
}

const g = globalThis as unknown as { __studioRuns?: Map<string, Run> };
const runs = (g.__studioRuns ??= new Map());

/** The run in progress for a project, if any. */
export function activeRun(projectId: string): Run | undefined {
  const r = runs.get(projectId);
  return r && !r.done ? r : undefined;
}

/**
 * Starts `exec` detached. `emit` appends to the buffer and wakes subscribers. `onEmit` sees every event first (to keep
 * live state for project loads). The run is dropped from the registry when exec settles.
 */
export function startRun(
  meta: Pick<Run, "projectId" | "kind" | "stage" | "slideId">,
  exec: (emit: (e: PipelineEvent) => void) => Promise<void>,
  onEmit?: (e: PipelineEvent) => void,
): Run {
  if (activeRun(meta.projectId)) throw new Error("A run is already in progress for this project.");
  const run: Run = { ...meta, startedAt: new Date().toISOString(), events: [], done: false, subs: new Set() };
  runs.set(meta.projectId, run);
  const wake = () => run.subs.forEach((f) => f());
  const emit = (e: PipelineEvent) => {
    onEmit?.(e);
    run.events.push(e);
    wake();
  };
  void exec(emit)
    .catch((e) => emit({ type: "error", stage: run.stage, message: (e as Error).message, retryable: true }))
    .finally(() => {
      run.done = true;
      if (runs.get(meta.projectId) === run) runs.delete(meta.projectId);
      wake();
    });
  return run;
}

/** Replays the run's events so far, then streams new ones until it ends or `signal` aborts (the run keeps going). */
export async function* subscribe(run: Run, signal?: AbortSignal): AsyncGenerator<PipelineEvent> {
  let i = 0;
  let wakeUp: (() => void) | null = null;
  const sub = () => {
    wakeUp?.();
    wakeUp = null;
  };
  run.subs.add(sub);
  const onAbort = () => sub();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    for (;;) {
      while (i < run.events.length) yield run.events[i++]!;
      if (run.done || signal?.aborted) return;
      await new Promise<void>((r) => (wakeUp = r));
    }
  } finally {
    run.subs.delete(sub);
    signal?.removeEventListener("abort", onAbort);
  }
}
