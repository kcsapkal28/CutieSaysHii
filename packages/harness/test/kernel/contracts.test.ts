import { describe, expect, it } from "vitest";
import {
  AcceptedDocSchema,
  artifactFileName,
  ContentChoicesSchema,
  DeckSkeletonSchema,
  DesignChoicesSchema,
  DesignPlanSchema,
  JOB_STATUSES,
  RERUN_FROM,
  STAGE_NAMES,
  StageArtifactSchema,
  ZERO_USAGE,
  type StageArtifact,
} from "../../src/kernel/contracts.ts";
import {
  HEARTBEAT_MS,
  MAX_BACKOFF_MS,
  MAX_PATCH_LOOPS,
  SETTLE_GRACE_MS,
  STAGE_TIMEOUTS_MS,
  STALE_AFTER_MS,
} from "../../src/kernel/stage.ts";

const choices = {
  depth: "standard",
  styleFamilyId: "fam",
  paletteId: "pal",
  typeFamilyId: "type",
  motionTemplateId: "motion",
  interactionModeId: "mode",
  threeJs: false,
  questionCount: 3,
} as const;

const design = {
  motion: {
    templateId: "motion",
    reducedMotion: "fade",
    timing: { enter: 400, stagger: 80, transition: 600, easing: "ease-out" },
    slides: { s01: { transition: "fade", enter: "rise", emphasis: "none", exit: "fade" } },
  },
  interaction: { modeId: "mode", slides: [{ slideId: "s01", components: [{ componentId: "df-notes", props: {} }] }] },
};

describe("names and constants", () => {
  it("stage names, rerun points and statuses", () => {
    expect(STAGE_NAMES).toEqual(["content", "design", "render", "qa", "patch"]);
    expect(RERUN_FROM).toEqual(["content", "design", "render", "qa"]);
    expect(JOB_STATUSES).toEqual(["queued", "running", "succeeded", "qa_failed", "failed", "cancelled"]);
  });

  it("timeouts and loop limits", () => {
    expect(STAGE_TIMEOUTS_MS).toEqual({ content: 90_000, design: 45_000, render: 30_000, qa: 60_000, patch: 45_000 });
    expect(MAX_PATCH_LOOPS).toBe(3);
    expect(MAX_BACKOFF_MS).toBe(120_000);
    expect(SETTLE_GRACE_MS).toBe(15_000);
    expect(HEARTBEAT_MS).toBe(5_000);
    expect(STALE_AFTER_MS).toBe(30_000);
  });
});

describe("artifactFileName", () => {
  it('"content.json" for iteration 0, "qa.2.json" for 2', () => {
    expect(artifactFileName("content", 0)).toBe("content.json");
    expect(artifactFileName("qa", 2)).toBe("qa.2.json");
    expect(artifactFileName("patch", 1)).toBe("patch.1.json");
  });

  it("rejects negative or fractional iterations", () => {
    expect(() => artifactFileName("qa", -1)).toThrow(RangeError);
    expect(() => artifactFileName("qa", 1.5)).toThrow(RangeError);
  });
});

describe("narrowed choices", () => {
  it("ContentChoices keeps depth, family, mode and questionCount only", () => {
    expect(ContentChoicesSchema.parse(choices)).toEqual({
      depth: "standard",
      styleFamilyId: "fam",
      interactionModeId: "mode",
      questionCount: 3,
    });
  });

  it("DesignChoices keeps motion template, mode and questionCount only", () => {
    expect(DesignChoicesSchema.parse(choices)).toEqual({ motionTemplateId: "motion", interactionModeId: "mode", questionCount: 3 });
  });
});

describe("documents", () => {
  it("DesignPlan is motion + interaction with no theme (N3)", () => {
    expect(Object.keys(DesignPlanSchema.shape)).toEqual(["motion", "interaction"]);
    expect(DesignPlanSchema.parse({ ...design, theme: { paletteId: "pal" } })).toEqual(design);
  });

  it("DeckSkeleton has ids, types, emphasis targets and block types only", () => {
    const skel = { slides: [{ id: "s01", type: "title", emphasisTargets: ["solar"], blockTypes: ["Paragraph"] }] };
    expect(DeckSkeletonSchema.parse(skel)).toEqual(skel);
    expect(DeckSkeletonSchema.safeParse({ slides: [{ id: "s01", type: "title", emphasisTargets: [] }] }).success).toBe(false);
  });

  it("AcceptedDoc carries its content inline, discriminated by kind", () => {
    const deck = { title: "T", subtitle: "S", slides: [{ id: "s01", type: "title", body: [], notes: "", emphasisTargets: [] }] };
    const deckDoc = { kind: "deck", revision: 2, source: { stage: "patch", iteration: 1 }, deck };
    const designDoc = { kind: "design", revision: 1, source: { stage: "design", iteration: 0 }, design };
    expect(AcceptedDocSchema.parse(deckDoc)).toEqual(deckDoc);
    expect(AcceptedDocSchema.parse(designDoc)).toEqual(designDoc);
    expect(AcceptedDocSchema.safeParse({ ...deckDoc, source: { stage: "design", iteration: 0 } }).success).toBe(false);
    expect(AcceptedDocSchema.safeParse({ ...designDoc, source: { stage: "content", iteration: 0 } }).success).toBe(false);
    expect(AcceptedDocSchema.safeParse({ ...deckDoc, revision: 0 }).success).toBe(false);
  });

  it("StageArtifact round-trips with output or error", () => {
    const artifact: StageArtifact = {
      jobId: "j_1",
      stage: "content",
      iteration: 0,
      version: "content.v1",
      inputHash: "ab".repeat(32),
      fingerprint: { model: "m" },
      input: { brief: {} },
      output: null,
      error: { kind: "validation", message: "bad", issues: [] },
      startedAt: 1,
      durationMs: 2,
      backoffMs: 0,
      usage: ZERO_USAGE,
      attempts: [
        { n: 1, outcome: "invalid", issues: [{ path: "", code: "x", message: "y" }], usage: ZERO_USAGE, usageKnown: true, durationMs: 1 },
        { n: 2, outcome: "error", usage: ZERO_USAGE, usageKnown: false, durationMs: 1 },
      ],
    };
    expect(StageArtifactSchema.parse(JSON.parse(JSON.stringify(artifact)))).toEqual(artifact);
  });
});
