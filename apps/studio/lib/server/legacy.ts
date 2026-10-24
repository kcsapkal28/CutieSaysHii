// studio.json from before the Outline, Script and Storyboard stages were merged holds approvals and run records for
// "script" and "storyboard". upgradeStudioState folds them into "outline": the Outline counts as approved only when
// all three were, and its record carries the three runs' logs and spend.
import type { Usage } from "../types";

export interface StageRecord {
  log: { at: string; message: string }[];
  usage: Usage;
  error?: string;
  updatedAt: string | null;
}

const MERGED = ["outline", "script", "storyboard"] as const;
const latest = (xs: (string | null | undefined)[]) => xs.filter((x): x is string => !!x).sort().at(-1);

/** Returns the upgraded state, or null when there is nothing to upgrade. Doesn't mutate its input. */
export function upgradeStudioState<S extends { approvals: Record<string, string | undefined>; stages: Record<string, StageRecord | undefined> }>(state: S): S | null {
  const old = (k: string) => k in state.approvals || k in state.stages;
  if (!old("script") && !old("storyboard")) return null;
  const approvals = { ...state.approvals };
  const stages = { ...state.stages };

  const approved = MERGED.map((s) => approvals[s]);
  for (const s of MERGED) delete approvals[s];
  if (approved.every(Boolean)) approvals.outline = latest(approved);

  const records = MERGED.map((s) => stages[s]).filter((r): r is StageRecord => !!r);
  for (const s of MERGED) delete stages[s];
  if (records.length) {
    const error = records.find((r) => r.error)?.error;
    stages.outline = {
      log: records.flatMap((r) => r.log).sort((a, b) => a.at.localeCompare(b.at)),
      usage: records.reduce<Usage>(
        (u, r) => ({ inputTokens: u.inputTokens + r.usage.inputTokens, outputTokens: u.outputTokens + r.usage.outputTokens, costUsd: u.costUsd + r.usage.costUsd }),
        { inputTokens: 0, outputTokens: 0, costUsd: 0 },
      ),
      ...(error ? { error } : {}),
      updatedAt: latest(records.map((r) => r.updatedAt)) ?? null,
    };
  }
  return { ...state, approvals, stages };
}
