import { goldenChoices, resolveMotionPlan, type Catalog } from "@deckforge/catalog";
import type { DeckSpec, Slide } from "@deckforge/schemas";
import { beforeAll, describe, expect, it } from "vitest";
import { assembleDesign } from "../../src/design/assemble.ts";
import { reconcileDesign } from "../../src/design/reconcile.ts";
import { toSkeleton } from "../../src/design/skeleton.ts";
import { DesignChoicesSchema, DesignPlanSchema, type DesignChoices, type DesignPlan } from "../../src/kernel/contracts.ts";
import type { DesignWire } from "../../src/validate/design-wire.ts";
import { testCatalog } from "../helpers/context.ts";
import { STANDARD_DECK } from "../validate/fixtures.ts";

const reason = (r: string) => ({ transition: "fade", enter: "scaleIn", emphasis: "countUp", exit: "fade", easing: null, reason: r });
const WIRE: DesignWire = {
  motion: { overrides: [{ slideId: "s06", ...reason("Land the number") }, { slideId: "s14", ...reason("Close firmly") }] },
  interaction: {
    placements: [
      { slideId: "s01", componentId: "df-notes", blockIndex: null, propsJson: "{}" },
      { slideId: "s04", componentId: "df-fragment", blockIndex: 0, propsJson: '{"mode":"one-by-one"}' },
      { slideId: "s06", componentId: "df-reveal", blockIndex: 2, propsJson: "{}" },
      { slideId: "s09", componentId: "df-chart", blockIndex: 0, propsJson: "{}" },
      { slideId: "s14", componentId: "df-tabs", blockIndex: 0, propsJson: "{}" },
    ],
  },
};

let c: Catalog;
let choices: DesignChoices;
let plan: DesignPlan;
beforeAll(async () => {
  c = await testCatalog();
  choices = DesignChoicesSchema.parse(goldenChoices(c).find((g) => g.interactionModeId === "explorable"));
  plan = assembleDesign(c, choices, toSkeleton(STANDARD_DECK), WIRE);
});

const withSlides = (slides: Slide[]): DeckSpec => ({ ...STANDARD_DECK, slides });
const replace = (id: string, by: (s: Slide) => Slide[]) => withSlides(STANDARD_DECK.slides.flatMap((s) => (s.id === id ? by(s) : [s])));
const reconcile = (after: DeckSpec) => reconcileDesign(c, choices, plan, { before: STANDARD_DECK, after });
const placedOn = (p: DesignPlan) => p.interaction.slides.map((s) => s.slideId);

describe("reconcileDesign", () => {
  it("untouched keeps it", () => {
    expect(reconcile(STANDARD_DECK)).toEqual(plan);
    expect(plan.motion.slides.s06!.overrideReason).toBe("Land the number");
  });

  it("split gets base motion and loses placements", () => {
    const after = replace("s04", (s) => [{ ...s, id: "s04a" }, { ...s, id: "s04b" }]);
    const out = reconcile(after);
    const base = resolveMotionPlan(c, choices.motionTemplateId, after.slides);
    expect(out.motion.slides.s04a).toEqual(base.slides.s04a);
    expect(out.motion.slides.s04b).toEqual(base.slides.s04b);
    expect(out.motion.slides.s04).toBeUndefined();
    expect(placedOn(out)).toEqual(["s01", "s06", "s09", "s14"]);
    expect(out.motion.slides.s06).toEqual(plan.motion.slides.s06);
  });

  it("swap to non-overridable drops the override", () => {
    expect(c.compat.designRules.motionOverrideSlideTypes).not.toContain("bullets");
    const after = replace("s14", (s) => [{ ...s, type: "bullets" }]);
    const out = reconcile(after);
    expect(out.motion.slides.s14).toEqual(resolveMotionPlan(c, choices.motionTemplateId, after.slides).slides.s14);
    expect(out.motion.slides.s14!.overrideReason).toBeUndefined();
    expect(placedOn(out)).not.toContain("s14");
  });

  it("a retyped slide gets the base motion even when its new type allows overrides", () => {
    const after = replace("s06", (s) => [{ ...s, type: "quote" }]);
    expect(reconcile(after).motion.slides.s06).toEqual(resolveMotionPlan(c, choices.motionTemplateId, after.slides).slides.s06);
  });

  it("drops placements whose blockIndex no longer binds and keeps whole-slide ones", () => {
    const after = withSlides(
      STANDARD_DECK.slides.map((s) => (s.id === "s06" ? { ...s, body: s.body.slice(0, 2) } : s.id === "s04" ? { ...s, body: [] } : s)),
    );
    const out = reconcile(after);
    expect(placedOn(out)).toEqual(["s01", "s09", "s14"]);
    expect(out.motion.slides.s06).toEqual(plan.motion.slides.s06);
    expect(out.interaction.slides[0]).toEqual(plan.interaction.slides[0]);
  });

  it("every id has motion; parses", () => {
    const after = replace("s04", (s) => [{ ...s, id: "s04a" }, { ...s, id: "s04b" }]);
    const out = reconcile(withSlides(after.slides.filter((s) => s.id !== "s05")));
    expect(Object.keys(out.motion.slides).sort()).toEqual(after.slides.filter((s) => s.id !== "s05").map((s) => s.id).sort());
    expect(DesignPlanSchema.parse(out)).toEqual(out);
    expect(out.interaction.modeId).toBe(choices.interactionModeId);
    expect(out.motion).toMatchObject({ templateId: plan.motion.templateId, timing: plan.motion.timing });
  });
});
