import type { Choices } from "@deckforge/schemas";
import { beforeAll, describe, expect, it } from "vitest";
import {
  defaultsForFamily,
  depthOrder,
  goldenChoices,
  motionDisabledReason,
  slideCountRange,
  threeJsDefault,
  threeJsToggleVisible,
  validateChoices,
  wordsPerSlideMax,
} from "../src/compat.ts";
import type { Catalog } from "../src/files.ts";
import { loadCatalog } from "../src/load.ts";

let c: Catalog;
beforeAll(async () => {
  c = await loadCatalog();
});

function choicesFor(familyId: string, overrides: Partial<Choices> = {}): Choices {
  const d = defaultsForFamily(c, familyId);
  return {
    depth: "standard",
    styleFamilyId: familyId,
    paletteId: d.paletteId,
    typeFamilyId: d.typeFamilyId,
    motionTemplateId: d.motionTemplateId,
    interactionModeId: "linear",
    threeJs: d.threeJs,
    ...overrides,
  };
}

describe("compat resolver", () => {
  it("depth order follows slide-types.json", () => {
    expect(depthOrder(c)).toEqual(["overview", "standard", "deep"]);
  });

  it("wordsPerSlideMax is min(depth cap, family cap)", () => {
    expect(wordsPerSlideMax(c, "standard", "minimal")).toBe(35);
    expect(wordsPerSlideMax(c, "deep", "retro")).toBe(40);
  });

  it("slideCountRange(overview) is [6, 8]", () => {
    expect(slideCountRange(c, "overview")).toEqual([6, 8]);
  });

  it("motionDisabledReason names the family", () => {
    expect(motionDisabledReason(c, "brutalist", "calm")).toBe("Not available with Brutalist");
    expect(motionDisabledReason(c, "brutalist", "kinetic")).toBeNull();
  });

  it("threeJs toggle and default follow family + motion", () => {
    expect(threeJsToggleVisible(c, "glass-soft", "depth")).toBe(true);
    expect(threeJsToggleVisible(c, "glass-soft", "calm")).toBe(false);
    const never = c.styles.families.find((f) => f.threeJs === "never")!;
    for (const m of c.motion.templates) expect(threeJsToggleVisible(c, never.id, m.id)).toBe(false);
    expect(threeJsDefault(c, "glass-soft", "depth")).toBe(true);
    expect(threeJsDefault(c, "neon", "depth")).toBe(false);
  });

  it("defaultsForFamily turns threeJs on only for a 'default' family on a 3D motion", () => {
    expect(defaultsForFamily(c, "glass-soft")).toEqual({
      paletteId: "nordic-mist",
      typeFamilyId: c.styles.families.find((f) => f.id === "glass-soft")!.defaultType,
      motionTemplateId: "depth",
      threeJs: true,
    });
    expect(defaultsForFamily(c, "minimal").threeJs).toBe(false);
  });

  it("accepts each family's defaults", () => {
    for (const f of c.styles.families) expect(validateChoices(c, choicesFor(f.id)), f.id).toEqual([]);
  });

  it("palette from previous family is rejected", () => {
    const issues = validateChoices(c, choicesFor("minimal", { paletteId: "brutal-pop" }));
    expect(issues.map(({ code, field }) => ({ code, field }))).toEqual([
      { code: "palette-not-allowed", field: "paletteId" },
    ]);
  });

  it("type family from another family is rejected", () => {
    const issues = validateChoices(c, choicesFor("minimal", { typeFamilyId: "brutalist-mono" }));
    expect(issues.map((i) => i.code)).toEqual(["type-not-allowed"]);
  });

  it("disallowed motion is rejected", () => {
    const issues = validateChoices(c, choicesFor("brutalist", { motionTemplateId: "calm" }));
    expect(issues.map((i) => i.code)).toEqual(["motion-not-allowed"]);
  });

  it("stale threeJs toggle is rejected", () => {
    const issues = validateChoices(c, choicesFor("glass-soft", { motionTemplateId: "calm", threeJs: true }));
    expect(issues.map((i) => i.code)).toEqual(["threejs-unavailable"]);
  });

  it("assessment with overview depth is rejected", () => {
    const issues = validateChoices(
      c,
      choicesFor("retro", { depth: "overview", interactionModeId: "assessment", questionCount: 4 }),
    );
    expect(issues.map((i) => i.code)).toEqual(["assessment-depth"]);
  });

  it("assessment requires questionCount from catalog choices", () => {
    const base = choicesFor("retro", { interactionModeId: "assessment" });
    expect(validateChoices(c, base).map((i) => i.code)).toEqual(["question-count"]);
    expect(validateChoices(c, { ...base, questionCount: 3 }).map((i) => i.code)).toEqual(["question-count"]);
    expect(validateChoices(c, { ...base, questionCount: 4 })).toEqual([]);
  });

  it("questionCount on a mode without that option is rejected", () => {
    const issues = validateChoices(c, choicesFor("minimal", { questionCount: 4 }));
    expect(issues.map((i) => i.code)).toEqual(["question-count"]);
  });

  it("unknown family id gives unknown-id and does not throw", () => {
    const issues = validateChoices(c, choicesFor("minimal", { styleFamilyId: "vaporwave" }));
    expect(issues.map(({ code, field }) => ({ code, field }))).toEqual([
      { code: "unknown-id", field: "styleFamilyId" },
    ]);
  });

  it("unknown palette id gives unknown-id only", () => {
    const issues = validateChoices(c, choicesFor("minimal", { paletteId: "nope" }));
    expect(issues.map((i) => i.code)).toEqual(["unknown-id"]);
  });

  it("all 9 golden choices validate clean", () => {
    const golden = goldenChoices(c);
    expect(golden).toHaveLength(9);
    for (const g of golden) expect(validateChoices(c, g), JSON.stringify(g)).toEqual([]);
    expect(golden.find((g) => g.styleFamilyId === "glass-soft")?.threeJs).toBe(true);
    expect(golden.find((g) => g.interactionModeId === "assessment")?.questionCount).toBe(4);
  });
});
