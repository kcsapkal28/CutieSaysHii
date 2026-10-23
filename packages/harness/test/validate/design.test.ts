import type { Catalog } from "@deckforge/catalog";
import { beforeAll, describe, expect, it } from "vitest";
import type { DeckSkeleton, DesignChoices } from "../../src/kernel/contracts.ts";
import type { Issue } from "../../src/kernel/issues.ts";
import type { DesignWire } from "../../src/validate/design-wire.ts";
import { validateDesign } from "../../src/validate/design.ts";
import { testCatalog } from "../helpers/context.ts";
import { skeletonOf, STANDARD_DECK } from "./fixtures.ts";

const EXPLORABLE: DesignChoices = { motionTemplateId: "calm", interactionModeId: "explorable" };
const SKELETON = skeletonOf(STANDARD_DECK);

type Override = DesignWire["motion"]["overrides"][number];
type Placement = DesignWire["interaction"]["placements"][number];

const override = (o: Partial<Override> = {}): Override => ({
  slideId: "s06",
  transition: "fade",
  enter: "scaleIn",
  emphasis: "countUp",
  exit: "fade",
  easing: null,
  reason: "Land the headline number",
  ...o,
});
const place = (slideId: string, componentId: string, blockIndex: number | null = 0, propsJson = "{}"): Placement => ({
  slideId,
  componentId,
  blockIndex,
  propsJson,
});

const VALID: DesignWire = {
  motion: { overrides: [override(), override({ slideId: "s14", easing: "power3.out", reason: "Close firmly" })] },
  interaction: {
    placements: [
      place("s01", "df-notes", null),
      place("s04", "df-fragment", 0, '{"mode":"one-by-one"}'),
      place("s09", "df-chart", 0, '{"kind":"bar","tooltip":true}'),
      place("s10", "df-compare", 0),
      place("s11", "df-timeline", 0),
    ],
  },
};

let c: Catalog;
beforeAll(async () => {
  c = await testCatalog();
});

const wire = (edit?: (w: DesignWire) => void): DesignWire => {
  const w = structuredClone(VALID);
  edit?.(w);
  return w;
};
const run = (w: DesignWire, choices: DesignChoices = EXPLORABLE, skel: DeckSkeleton = SKELETON): Issue[] =>
  validateDesign(c, choices, skel, w);
const codes = (issues: Issue[]) => issues.map((i) => i.code);

describe("validateDesign", () => {
  it("valid wire", () => {
    expect(run(VALID)).toEqual([]);
  });

  it("override on bullets", () => {
    const issues = run(wire((w) => w.motion.overrides.push(override({ slideId: "s04" }))));
    expect(issues).toEqual([
      { path: "motion.overrides[2].slideId", code: "override-slide-type", message: expect.stringMatching(/s04.*"bullets"/) },
    ]);
  });

  it("blank reason", () => {
    const issues = run(wire((w) => (w.motion.overrides[0]!.reason = "  ")));
    expect(issues).toEqual([{ path: "motion.overrides[0].reason", code: "override-reason", message: expect.any(String) }]);
  });

  it('enter "spin"', () => {
    const issues = run(wire((w) => (w.motion.overrides[0]!.enter = "spin")));
    expect(issues).toEqual([{ path: "motion.overrides[0].enter", code: "vocabulary", message: expect.stringContaining('"spin"') }]);
  });

  it("unknown easing is a vocabulary issue; null easing is not", () => {
    const issues = run(wire((w) => (w.motion.overrides[0]!.easing = "bouncy")));
    expect(codes(issues)).toEqual(["vocabulary"]);
    expect(issues[0]?.path).toBe("motion.overrides[0].easing");
  });

  it("duplicate override", () => {
    const issues = run(wire((w) => w.motion.overrides.push(override({ reason: "again" }))));
    expect(issues).toEqual([
      { path: "motion.overrides[2].slideId", code: "duplicate-override", message: expect.stringContaining("s06") },
    ]);
  });

  it("df-quiz in explorable", () => {
    const issues = run(wire((w) => w.interaction.placements.push(place("s05", "df-quiz"))));
    expect(issues).toEqual([
      { path: "interaction.placements[5].componentId", code: "component-not-in-mode", message: expect.stringContaining("df-quiz") },
    ]);
  });

  it("unknown component", () => {
    expect(codes(run(wire((w) => w.interaction.placements.push(place("s05", "df-nope")))))).toEqual(["component-not-in-mode"]);
  });

  it("3 interactive on one slide; df-notes not counted", () => {
    const two = wire((w) => w.interaction.placements.push(place("s10", "df-reveal"), place("s10", "df-notes", null)));
    expect(run(two)).toEqual([]);
    const three = wire((w) => w.interaction.placements.push(place("s10", "df-reveal"), place("s10", "df-tabs")));
    const issues = run(three);
    expect(codes(issues)).toEqual(["components-per-slide"]);
    expect(issues[0]?.message).toMatch(/s10.*3 interactive.*at most 2/);
  });

  it("12 slides with 2 interactive → components-density (needs 3)", () => {
    const issues = run(wire((w) => (w.interaction.placements = w.interaction.placements.slice(0, 3))));
    expect(issues).toEqual([{ path: "interaction.placements", code: "components-density", message: expect.stringContaining("needs 3") }]);
    expect(issues[0]?.message).toContain("got 2");
  });

  it("linear mode has no density minimum", () => {
    const linear: DesignChoices = { motionTemplateId: "calm", interactionModeId: "linear" };
    expect(run(wire((w) => (w.interaction.placements = [])), linear)).toEqual([]);
  });

  it("df-hotspot on title → component-slide-type", () => {
    const skel = structuredClone(SKELETON);
    skel.slides[0]!.blockTypes = ["Image"];
    const issues = run(wire((w) => w.interaction.placements.push(place("s01", "df-hotspot"))), EXPLORABLE, skel);
    expect(issues).toEqual([
      { path: "interaction.placements[5].slideId", code: "component-slide-type", message: expect.stringMatching(/df-hotspot.*"title"/) },
    ]);
  });

  it("df-chart on Bullets", () => {
    const issues = run(wire((w) => w.interaction.placements.push(place("s04", "df-chart", 0))));
    expect(issues).toEqual([
      { path: "interaction.placements[5].blockIndex", code: "component-binding", message: expect.stringMatching(/df-chart.*Bullets.*Chart/) },
    ]);
  });

  it("df-notes with blockIndex", () => {
    const issues = run(wire((w) => (w.interaction.placements[0]!.blockIndex = 0)));
    expect(issues).toEqual([{ path: "interaction.placements[0].blockIndex", code: "component-binding", message: expect.any(String) }]);
  });

  it("bound component needs an in-range blockIndex", () => {
    expect(codes(run(wire((w) => (w.interaction.placements[1]!.blockIndex = null))))).toEqual(["component-binding"]);
    expect(codes(run(wire((w) => (w.interaction.placements[1]!.blockIndex = 3))))).toEqual(["component-binding"]);
  });

  it('propsJson "[1]"', () => {
    for (const propsJson of ["[1]", "{", "null", '"x"']) {
      const issues = run(wire((w) => (w.interaction.placements[1]!.propsJson = propsJson)));
      expect(issues).toEqual([{ path: "interaction.placements[1].propsJson", code: "props-json", message: expect.any(String) }]);
    }
  });

  it("unknown slideId", () => {
    const issues = run(
      wire((w) => {
        w.motion.overrides.push(override({ slideId: "s99" }));
        w.interaction.placements.push(place("s98", "df-fragment"));
      }),
    );
    expect(issues).toEqual([
      { path: "motion.overrides[2].slideId", code: "unknown-slide", message: expect.stringContaining('"s99"') },
      { path: "interaction.placements[5].slideId", code: "unknown-slide", message: expect.stringContaining('"s98"') },
    ]);
  });

  it("duplicate placement", () => {
    const issues = run(wire((w) => w.interaction.placements.push(place("s04", "df-fragment", 0))));
    expect(issues).toEqual([
      { path: "interaction.placements[5]", code: "duplicate-placement", message: expect.stringMatching(/df-fragment.*s04/) },
    ]);
  });
});
