// Progress events the pipeline emits (the CLI prints them; the Studio will stream them).
import type { CallRecord, Llm, Usage } from "../llm.ts";
import { addUsage, ZERO_USAGE } from "../llm.ts";
import type { Stage } from "./project.ts";

export type ForgeEvent =
  | { type: "stage:start"; stage: Stage; invalidated: Stage[] }
  | { type: "stage:done"; stage: Stage; ms: number; usage: Usage; calls: number }
  | { type: "stage:error"; stage: Stage; error: string }
  | { type: "usage"; stage: Stage; label: string; model: string; ms: number; usage: Usage }
  | { type: "slide:round"; id: string; round: number; phase: "build" | "bundle" | "shoot" | "critic" }
  | { type: "slide:verdict"; id: string; round: number; verdict: "pass" | "fix"; score: number; issues: number; errors: number }
  | { type: "slide:error"; id: string; round: number; error: string }
  | { type: "slide:done"; id: string; bestRound: number; rounds: number; verdict: "pass" | "fix" | "failed"; score: number }
  | { type: "deck:done"; version: number; file: string };

export type OnEvent = (e: ForgeEvent) => void;

/** Wraps an Llm so every call reports a usage event and adds to a running total. */
export function meteredLlm(llm: Llm, stage: Stage, onEvent: OnEvent): { llm: Llm; total: () => { usage: Usage; calls: number } } {
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
    },
    total: () => ({ usage, calls }),
  };
}
