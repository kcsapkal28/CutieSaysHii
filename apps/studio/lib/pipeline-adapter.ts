// Maps the agent pipeline's events (`ForgeEvent`, packages/forge/src/pipeline/events.ts) onto the Studio's
// PipelineEvent stream (lib/events.ts). RealBackend feeds every `onEvent` callback through this and streams the results
// from runStage / reviseSlide.
import type { ForgeEvent, PrecheckKind, Usage as ForgeUsage } from "@deckforge/forge/pipeline";
import { costUsd } from "@deckforge/forge/pricing";
import type { PipelineEvent } from "./events";
import { STAGES, type StageName, type Usage } from "./types";

// The price table lives in the engine so the journal summary and `forge eval` use the same one.
const cost = costUsd;

const modelName = (model: string) => (/opus/i.test(model) ? "Opus" : /sonnet/i.test(model) ? "Sonnet" : /haiku/i.test(model) ? "Haiku" : model);
const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const PHASE_TEXT = { build: "builder is writing the slide", bundle: "bundling a one-slide preview", shoot: "taking screenshots of every step", critic: "critic is reviewing the screenshots" } as const;
const PRECHECK_TEXT: Record<PrecheckKind, string> = {
  "clipped-text": "text clipped",
  "off-canvas": "off canvas",
  "text-overlap": "overlapping text",
  "blank-render": "blank render",
  "dead-canvas": "canvas draws nothing",
  "tiny-text": "tiny text",
  "low-contrast": "low contrast",
  "dead-step": "a step changes nothing",
  "console-error": "console error",
  "external-request": "external request",
};

/** One LLM call's forge usage as the Studio shows it (cache tokens count as input). */
export function studioUsage(model: string, u: ForgeUsage): Usage {
  return { inputTokens: u.input + u.cacheRead + u.cacheWrite, outputTokens: u.output, costUsd: cost(model, u) };
}

const isStage = (s: string): s is StageName => (STAGES as readonly string[]).includes(s);

/**
 * Returns a stateful mapper for one run. `context` is the stage being run ("build" for reviseSlide), used for
 * events that carry no stage of their own.
 */
export function createForgeEventAdapter(context: StageName, opts: { note?: string; titles?: Record<string, string> } = {}) {
  let total: Usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  const started = new Set<string>();
  const now = () => new Date().toISOString();

  return (e: ForgeEvent): PipelineEvent[] => {
    switch (e.type) {
      case "stage:start": {
        if (!isStage(e.stage)) return [];
        const out: PipelineEvent[] = [{ type: "stage.start", stage: e.stage, at: now() }];
        if (e.invalidated.length) out.push({ type: "progress", stage: context, message: `Cleared outdated later steps: ${e.invalidated.join(", ")}`, at: now() });
        return out;
      }
      case "stage:done":
        return isStage(e.stage)
          ? [
              { type: "progress", stage: context, message: `${e.stage} finished in ${secs(e.ms)} · ${e.calls} model call${e.calls === 1 ? "" : "s"} · ${k(e.usage.input + e.usage.cacheRead + e.usage.cacheWrite)} in, ${k(e.usage.output)} out`, at: now() },
              { type: "stage.done", stage: e.stage, at: now() },
            ]
          : [];
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
          {
            type: "progress",
            stage: context,
            message: `${e.label} · ${modelName(e.model)} · ${secs(e.ms)} · ${k(e.usage.input + e.usage.cacheRead + e.usage.cacheWrite)} in, ${k(e.usage.output)} out · $${cost(e.model, e.usage).toFixed(3)}`,
            at: now(),
          },
        ];
      }
      case "outline:arc":
        return [{ type: "progress", stage: context, message: `Arc planned: ${e.slides.length} slide${e.slides.length === 1 ? "" : "s"} in ${e.sections} section${e.sections === 1 ? "" : "s"} · writing the cards`, at: now() }];
      case "outline:card":
        return [{ type: "progress", stage: context, slideId: e.id, message: `${e.id} card written: “${e.title}” (${e.done}/${e.total})`, at: now() }];
      case "slide:round": {
        const out: PipelineEvent[] = [];
        if (!started.has(e.id)) {
          started.add(e.id);
          out.push({ type: "slide.start", slideId: e.id, title: opts.titles?.[e.id] ?? e.id });
        }
        // "bundle" (the single-slide preview) is part of shooting as far as the UI is concerned.
        if (e.phase !== "bundle") out.push({ type: "slide.round", slideId: e.id, round: e.round, phase: e.phase === "critic" ? "critique" : e.phase });
        const how = e.mode === "patch" ? ", editing the previous version" : e.mode === "rewrite" ? ", rewriting" : "";
        const who = e.phase === "build" && e.model ? ` (${modelName(e.model)}${how}${e.escalated ? ", escalated round" : ""})` : "";
        out.push({ type: "progress", stage: context, slideId: e.id, message: `${e.id} round ${e.round}: ${PHASE_TEXT[e.phase]}${who}`, at: now() });
        return out;
      }
      case "slide:verdict": {
        const issues =
          e.verdict === "pass" ? [] : [`${e.issues} issue${e.issues === 1 ? "" : "s"}${e.errors ? `, ${e.errors} console error${e.errors === 1 ? "" : "s"}` : ""} (score ${e.score}/10)`];
        const detail = `${e.id} round ${e.round}: score ${e.score}/10 · ${e.issues} issue${e.issues === 1 ? "" : "s"} · ${e.errors} console error${e.errors === 1 ? "" : "s"}`;
        return [
          { type: "progress", stage: context, slideId: e.id, message: detail, at: now() },
          { type: "critic.verdict", slideId: e.id, round: e.round, verdict: e.verdict === "pass" ? "pass" : "revise", issues },
        ];
      }
      case "slide:precheck": {
        const what = e.kinds.slice(0, 3).map((kind) => PRECHECK_TEXT[kind]).join(", ");
        const n = e.errors || e.warnings;
        const message = e.errors
          ? `${e.id} round ${e.round}: ${n} ${e.kinds.some((kind) => kind === "console-error" || kind === "external-request") ? "" : "layout "}problem${n === 1 ? "" : "s"} found (${what}), fixing without the critic`
          : e.warnings
            ? `${e.id} round ${e.round}: layout checks passed, ${n} warning${n === 1 ? "" : "s"} for the critic (${what})`
            : `${e.id} round ${e.round}: layout checks passed`;
        return [{ type: "progress", stage: context, slideId: e.id, message, at: now() }];
      }
      case "slide:error":
        return [{ type: "progress", stage: context, slideId: e.id, message: `${e.id} round ${e.round} failed: ${e.error}`, at: now() }];
      case "slide:escalate":
        return [{ type: "progress", stage: context, slideId: e.id, message: `${e.id}: serious issue left, one more fix round on ${modelName(e.model)}`, at: now() }];
      case "slide:patch":
        return [
          {
            type: "progress",
            stage: context,
            slideId: e.id,
            message: e.applied
              ? `${e.id} round ${e.round}: ${e.edits} edit${e.edits === 1 ? "" : "s"} applied to the previous version`
              : `${e.id} round ${e.round}: edits dropped (${e.reason ?? "they did not apply"}), rewriting the slide`,
            at: now(),
          },
        ];
      case "slide:shots":
        return [{ type: "progress", stage: context, slideId: e.id, message: `${e.id} round ${e.round}: ${e.files.length} screenshot${e.files.length === 1 ? "" : "s"} taken`, at: now() }];
      case "slide:done":
        return [
          { type: "progress", stage: context, slideId: e.id, message: `${e.id} settled: ${e.verdict === "failed" ? "no round produced a slide" : `best was round ${e.bestRound} of ${e.rounds}, score ${e.score}/10`}`, at: now() },
          { type: "slide.done", slideId: e.id, rounds: e.rounds, verdict: e.verdict === "pass" ? "pass" : "revise" },
        ];
      case "deck:done":
        return [
          { type: "progress", stage: context, message: `Deck bundled as version ${e.version}`, at: now() },
          { type: "version", version: e.version, note: opts.note ?? "Build" },
        ];
    }
  };
}
