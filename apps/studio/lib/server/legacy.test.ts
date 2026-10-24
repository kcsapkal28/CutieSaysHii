import { describe, expect, it } from "vitest";
import { upgradeStudioState, type StageRecord } from "./legacy";

const rec = (at: string, cost: number, extra: Partial<StageRecord> = {}): StageRecord => ({
  log: [{ at, message: `ran at ${at}` }],
  usage: { inputTokens: 10, outputTokens: 1, costUsd: cost },
  updatedAt: at,
  ...extra,
});

describe("upgrading studio.json from the three-stage outline", () => {
  it("approves the Outline only when outline, script and storyboard were all approved, and merges their records", () => {
    const st = {
      approvals: { research: "t0", outline: "t1", script: "t2", storyboard: "t3", build: "t4" },
      stages: { research: rec("t0", 0.1), outline: rec("t1", 0.2), script: rec("t2", 0.3), storyboard: rec("t3", 1) },
    };
    const up = upgradeStudioState(st)!;
    expect(up.approvals).toEqual({ research: "t0", outline: "t3", build: "t4" });
    expect(Object.keys(up.stages).sort()).toEqual(["outline", "research"]);
    expect(up.stages.outline).toEqual({
      log: ["t1", "t2", "t3"].map((at) => ({ at, message: `ran at ${at}` })),
      usage: { inputTokens: 30, outputTokens: 3, costUsd: 1.5 },
      updatedAt: "t3",
    });
    expect(st.approvals).toHaveProperty("script"); // input untouched
  });

  it("leaves the Outline unapproved when the storyboard wasn't, and keeps a failed run's error", () => {
    const up = upgradeStudioState({
      approvals: { research: "t0", outline: "t1", script: "t2" },
      stages: { outline: rec("t1", 0.2), storyboard: rec("t3", 0, { error: "HTTP 529" }) },
    })!;
    expect(up.approvals).toEqual({ research: "t0" });
    expect(up.stages.outline).toMatchObject({ error: "HTTP 529", updatedAt: "t3" });
  });

  it("returns null for a state that is already current", () => {
    expect(upgradeStudioState({ approvals: { research: "t0", outline: "t1" }, stages: { outline: rec("t1", 0.2) } })).toBeNull();
  });
});
