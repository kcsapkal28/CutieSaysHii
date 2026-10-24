// Progress events the pipeline emits through `onEvent`. The CLI prints them; the Studio streams them (e.g. over SSE).
// Every event is a plain JSON-serialisable object discriminated by `type`.
import type { CallRecord, Llm, Usage } from "../llm.ts";
import { addUsage, ZERO_USAGE } from "../llm.ts";
import type { PrecheckKind } from "./precheck.ts";
import type { Stage } from "./project.ts";

export type Verdict = "pass" | "fix";

export type ForgeEvent =
  /** A stage began. `invalidated` lists the later stages whose files were deleted because this one re-ran. */
  | { type: "stage:start"; stage: Stage; invalidated: Stage[] }
  /** A stage finished and wrote its file(s). `usage`/`calls` total every LLM call the stage made. */
  | { type: "stage:done"; stage: Stage; ms: number; usage: Usage; calls: number }
  /** A stage failed; its outputs were not written. The error is also thrown to the caller. */
  | { type: "stage:error"; stage: Stage; error: string }
  /** One LLM call completed (`label` is the agent, e.g. "storyboarder" or "builder:s03"). */
  | { type: "usage"; stage: Stage | "revise"; label: string; model: string; ms: number; usage: Usage }
  /** Outline, first pass: the arc is planned (slide ids and points); the cards are written next. */
  | { type: "outline:arc"; title: string; sections: number; slides: { id: string; point: string }[] }
  /** Outline, second pass: one slide's card is written (`done` of `total`; cards finish in any order). */
  | { type: "outline:card"; id: string; title: string; done: number; total: number }
  /**
   * A slide's round moved to a new phase: build (the builder is writing it, with `model`), bundle (single-slide preview),
   * shoot (screenshots in Chromium), critic (vision review). `escalated` marks the extra Opus round. `mode` (build
   * phase): a full first draft, edits on the previous version, or a full rewrite of it.
   */
  | {
      type: "slide:round";
      id: string;
      round: number;
      phase: "build" | "bundle" | "shoot" | "critic";
      model?: string;
      escalated?: boolean;
      mode?: "draft" | "patch" | "rewrite";
    }
  /**
   * A fix round's edits on the previous version: `applied` with `edits` operations, or not (the edits didn't apply,
   * broke the contract, or the pre-check got worse: `reason`), in which case a full rewrite follows in the same round.
   */
  | { type: "slide:patch"; id: string; round: number; applied: boolean; edits: number; reason?: string }
  /** Screenshots of a round are on disk (`files` are absolute PNG paths, one per step). */
  | { type: "slide:shots"; id: string; round: number; files: string[] }
  /**
   * The deterministic pre-check of a round's screenshots (after shoot, before the critic). `errors` counts hard
   * failures (measured layout errors, console/page errors, external requests): when > 0 the critic is skipped and the
   * findings go straight back to the builder. `kinds` names the hard failures' kinds, or the warnings' when none.
   */
  | { type: "slide:precheck"; id: string; round: number; errors: number; warnings: number; kinds: PrecheckKind[] }
  /** The critic's verdict on a round. `score` is 0–10 against the reference decks. */
  | { type: "slide:verdict"; id: string; round: number; verdict: Verdict; score: number; issues: number; errors: number }
  /** A round failed before review (builder output invalid, contract error at bundle time, a crash). The loop continues. */
  | { type: "slide:error"; id: string; round: number; error: string }
  /** The final critique still had a high-severity issue, so one more fix attempt runs on the escalation model. */
  | { type: "slide:escalate"; id: string; round: number; model: string }
  /** The slide is settled: the best round was written to slides/<id>.html. `failed` = no round produced a slide. */
  | { type: "slide:done"; id: string; bestRound: number; rounds: number; verdict: Verdict | "failed"; score: number }
  /** A full deck was bundled to versions/<version>/deck.html. */
  | { type: "deck:done"; version: number; file: string };

export type OnEvent = (e: ForgeEvent) => void;

/** Wraps an Llm so every call reports a usage event and adds to a running total. */
export function meteredLlm(llm: Llm, stage: Stage | "revise", onEvent: OnEvent): { llm: Llm; total: () => { usage: Usage; calls: number } } {
  let usage = ZERO_USAGE;
  let calls = 0;
  const record = (r: CallRecord) => {
    usage = addUsage(usage, r.usage);
    calls++;
    onEvent({ type: "usage", stage, label: r.label, model: r.model, ms: r.ms, usage: r.usage });
  };
  return {
    llm: {
      async callTool(opts) {
        const r = await llm.callTool(opts);
        record(r);
        return r;
      },
      async callText(opts) {
        const r = await llm.callText(opts);
        record(r);
        return r;
      },
      ...(llm.warm
        ? {
            async warm(opts) {
              const r = await llm.warm!(opts);
              record(r);
              return r;
            },
          }
        : {}),
    },
    total: () => ({ usage, calls }),
  };
}
