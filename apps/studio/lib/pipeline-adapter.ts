// Maps the agent pipeline's events (packages/forge/src/pipeline/events.ts, `ForgeEvent`, on feat/v2-agents at the time
// of writing) onto the Studio's PipelineEvent stream (lib/events.ts). The real StudioBackend adapter feeds every
// `onEvent` callback through this and yields the results from runStage / reviseSlide.
//
// `ForgeEvent` is mirrored structurally below so this file compiles before the pipeline merges. After the merge,
// replace the mirror with `import type { ForgeEvent } from "@deckforge/forge"` (the shapes are copied verbatim).
import type { PipelineEvent } from "./events";
import { STAGES, type StageName, type Usage } from "./types";

type ForgeStage = "style" | StageName;
type ForgeUsage = { input: number; output: number; cacheRead: number; cacheWrite: number };
type ForgeVerdict = "pass" | "fix";

export type ForgeEventMirror =
  | { type: "stage:start"; stage: ForgeStage; invalidated: ForgeStage[] }
  | { type: "stage:done"; stage: ForgeStage; ms: number; usage: ForgeUsage; calls: number }
  | { type: "stage:error"; stage: ForgeStage; error: string }
  | { type: "usage"; stage: ForgeStage | "revise"; label: string; model: string; ms: number; usage: ForgeUsage }
  | { type: "slide:round"; id: string; round: number; phase: "build" | "bundle" | "shoot" | "critic"; model?: string; escalated?: boolean }
  | { type: "slide:shots"; id: string; round: number; files: string[] }
  | { type: "slide:verdict"; id: string; round: number; verdict: ForgeVerdict; score: number; issues: number; errors: number }
  | { type: "slide:error"; id: string; round: number; error: string }
  | { type: "slide:escalate"; id: string; round: number; model: string }
  | { type: "slide:done"; id: string; bestRound: number; rounds: number; verdict: ForgeVerdict | "failed"; score: number }
  | { type: "deck:done"; version: number; file: string };

/** USD per million tokens [input, output]; cache reads at 10% of input, writes at 125%. Unknown models cost 0. */
const PRICE: [RegExp, number, number][] = [
  [/opus/i, 15, 75],
  [/sonnet/i, 3, 15],
  [/haiku/i, 1, 5],
];

function cost(model: string, u: ForgeUsage): number {
  const p = PRICE.find(([re]) => re.test(model));
  if (!p) return 0;
  return (u.input * p[1] + u.cacheRead * p[1] * 0.1 + u.cacheWrite * p[1] * 1.25 + u.output * p[2]) / 1e6;
}

const isStage = (s: string): s is StageName => (STAGES as readonly string[]).includes(s);

/**
 * Returns a stateful mapper for one run. `context` is the stage being run ("build" for reviseSlide), used for
 * events that carry no stage of their own.
 */
export function createForgeEventAdapter(context: StageName, opts: { note?: string } = {}) {
  let total: Usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  const started = new Set<string>();
  const now = () => new Date().toISOString();

  return (e: ForgeEventMirror): PipelineEvent[] => {
    switch (e.type) {
      case "stage:start":
        return isStage(e.stage) ? [{ type: "stage.start", stage: e.stage, at: now() }] : [];
      case "stage:done":
        return isStage(e.stage) ? [{ type: "stage.done", stage: e.stage, at: now() }] : [];
      case "stage:error":
        return [{ type: "error", stage: isStage(e.stage) ? e.stage : context, message: e.error, retryable: true }];
      case "usage": {
        total = {
          inputTokens: total.inputTokens + e.usage.input + e.usage.cacheRead + e.usage.cacheWrite,
          outputTokens: total.outputTokens + e.usage.output,
          costUsd: total.costUsd + cost(e.model, e.usage),
        };
        return [
          { type: "usage", model: e.model, usage: { ...total } },
          { type: "progress", stage: context, message: `${e.label} finished in ${(e.ms / 1000).toFixed(1)} s`, at: now() },
        ];
      }
      case "slide:round": {
        const out: PipelineEvent[] = [];
        if (!started.has(e.id)) {
          started.add(e.id);
          out.push({ type: "slide.start", slideId: e.id, title: e.id });
        }
        const phase = e.phase === "build" ? "build" : e.phase === "critic" ? "critique" : "shoot";
        out.push({ type: "slide.round", slideId: e.id, round: e.round, phase });
        return out;
      }
      case "slide:verdict": {
        const issues =
          e.verdict === "pass" ? [] : [`${e.issues} issue${e.issues === 1 ? "" : "s"}${e.errors ? `, ${e.errors} console error${e.errors === 1 ? "" : "s"}` : ""} (score ${e.score}/10)`];
        return [{ type: "critic.verdict", slideId: e.id, round: e.round, verdict: e.verdict === "pass" ? "pass" : "revise", issues }];
      }
      case "slide:error":
        return [{ type: "progress", stage: context, slideId: e.id, message: `${e.id} round ${e.round} failed: ${e.error}`, at: now() }];
      case "slide:escalate":
        return [{ type: "progress", stage: context, slideId: e.id, message: `${e.id}: one more round on ${e.model}`, at: now() }];
      case "slide:shots":
        return [];
      case "slide:done":
        return [{ type: "slide.done", slideId: e.id, rounds: e.rounds, verdict: e.verdict === "pass" ? "pass" : "revise" }];
      case "deck:done":
        return [{ type: "version", version: e.version, note: opts.note ?? "Build" }];
    }
  };
}
