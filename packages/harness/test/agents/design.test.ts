import { getInteractionMode, goldenChoices, resolveMotionPlan, type Catalog } from "@deckforge/catalog";
import type { Choices } from "@deckforge/schemas";
import { beforeAll, describe, expect, it } from "vitest";
import { buildDesignRequest } from "../../src/agents/design-tool.ts";
import type { AgentPrompt } from "../../src/agents/messages.ts";
import { assembleDesign } from "../../src/design/assemble.ts";
import { toSkeleton } from "../../src/design/skeleton.ts";
import { FakeLlm, type FakeReply } from "../../src/fakes/llm.ts";
import { DesignChoicesSchema, DesignPlanSchema, type DesignChoices, type PipelineState } from "../../src/kernel/contracts.ts";
import { STAGE_TIMEOUTS_MS } from "../../src/kernel/stage.ts";
import type { DesignWire } from "../../src/validate/design-wire.ts";
import { createDesignStage } from "../../src/stages/design.ts";
import { makeTestContext, testCatalog } from "../helpers/context.ts";
import { STANDARD_DECK } from "../validate/fixtures.ts";

const PROMPT: AgentPrompt = { name: "design.v1", text: "Call emit_design once." };
const MODEL = "claude-sonnet-5-5";
const SKELETON = toSkeleton(STANDARD_DECK);

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

// Deliberately out of deck order: assembly groups by slide in deck order.
const WIRE: DesignWire = {
  motion: { overrides: [override(), override({ slideId: "s14", easing: "power3.out", reason: "Close firmly" })] },
  interaction: {
    placements: [
      place("s09", "df-chart", 0, '{"kind":"bar","tooltip":true}'),
      place("s04", "df-fragment", 0, '{"mode":"one-by-one"}'),
      place("s01", "df-notes", null),
      place("s10", "df-compare", 0),
      place("s04", "df-tabs", 0, '{"max":3}'),
      place("s11", "df-timeline", 0),
    ],
  },
};

let c: Catalog;
let full: Choices;
let choices: DesignChoices;
beforeAll(async () => {
  c = await testCatalog();
  full = goldenChoices(c).find((g) => g.interactionModeId === "explorable")!;
  choices = DesignChoicesSchema.parse(full);
});

const request = (o: { choices?: DesignChoices } = {}) =>
  buildDesignRequest({ choices: o.choices ?? choices, skeleton: SKELETON }, c, { prompt: PROMPT, model: MODEL });

async function runStage(replies: FakeReply[]) {
  const fake = new FakeLlm({ replies: { emit_design: replies } });
  const t = await makeTestContext({ llm: fake, stage: "design" });
  const stage = createDesignStage({ prompt: PROMPT, model: MODEL });
  const state: PipelineState = { brief: { topic: "x", brief: "y", audience: "general", durationMin: 10, language: "en" }, choices: full, deck: STANDARD_DECK };
  const result = stage.run(stage.input.parse(stage.select(state, c)), t.ctx);
  return { fake, stage, result, ...t };
}

describe("toSkeleton", () => {
  it("skeleton fields only", () => {
    expect(SKELETON.slides).toHaveLength(STANDARD_DECK.slides.length);
    for (const s of SKELETON.slides) expect(Object.keys(s).sort()).toEqual(["blockTypes", "emphasisCount", "id", "type"]);
    expect(SKELETON.slides.find((s) => s.id === "s06")).toEqual({
      id: "s06",
      type: "stat",
      emphasisCount: 2,
      blockTypes: ["Stat", "Stat", "Stat"],
    });
  });
});

describe("buildDesignRequest", () => {
  it("request contains no string from the deck's slide text (emphasis targets included)", () => {
    const json = JSON.stringify(request());
    // Every string in the deck except structural ids and enum values.
    const STRUCTURAL = new Set(["id", "type", "kind", "trend", "lang"]);
    const texts: string[] = [];
    const walk = (v: unknown, key?: string): void => {
      if (typeof v === "string") {
        if (!key || !STRUCTURAL.has(key)) texts.push(v);
      } else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
      else if (typeof v === "object" && v !== null) for (const [k, x] of Object.entries(v)) walk(x, k);
    };
    walk(STANDARD_DECK);
    expect(texts).toEqual(expect.arrayContaining(["22%", "0.6 V", "junction", STANDARD_DECK.title]));
    const leaked = texts.filter((t) => json.includes(JSON.stringify(t).slice(1, -1)));
    expect(leaked).toEqual([]);
  });

  it("request carries no theme, palette, type-family or family-token fields (N3)", () => {
    const req = request();
    expect(Object.keys(req.input as object)).toEqual(["motionTemplate", "vocabulary", "mode", "designRules", "skeleton"]);
    const json = JSON.stringify(req);
    expect(json).not.toMatch(/"(theme|paletteId|palette|typeFamilyId|typeFamily|styleFamilyId|threeJs|tokens|roles|threeBackground)"\s*:/);
    const ids = [
      ...c.palettes.palettes.map((p) => p.id),
      ...c.types.families.map((t) => t.id),
      ...c.styles.families.map((f) => f.id),
    ];
    for (const id of ids) expect(json).not.toContain(`"${id}"`);
  });

  it("request: model, emit_design (strict), effort low, maxTokens 8000, the template and mode", () => {
    const req = request();
    expect(req).toMatchObject({ model: MODEL, system: PROMPT.text, effort: "low", maxTokens: 8000 });
    expect(req.tool).toMatchObject({ name: "emit_design", strict: true });
    const input = req.input as Record<string, Record<string, unknown>>;
    expect(Object.keys(input.motionTemplate!)).toEqual(["id", "name", "intensity", "defaults", "bySlideType"]);
    expect(input.motionTemplate!.id).toBe(choices.motionTemplateId);
    expect(input.vocabulary).toEqual(c.motion.vocabulary);
    expect(input.designRules).toEqual(c.compat.designRules);
    expect(input.skeleton).toEqual(SKELETON);
    const mode = getInteractionMode(c, choices.interactionModeId);
    expect(input.mode).toMatchObject({ id: mode.id, minComponentsPerSlides: mode.minComponentsPerSlides, questionCount: null });
    const components = input.mode!.components as { id: string; binds: string[] }[];
    expect(components.map((x) => x.id)).toEqual(mode.components);
    expect(components.every((x) => Array.isArray(x.binds))).toBe(true);
  });

  it("tool enums from designRules/mode/vocabulary", () => {
    type Props = Record<string, { enum?: string[]; anyOf?: { enum?: string[] }[] }>;
    const schema = request().tool.inputSchema as {
      properties: {
        motion: { properties: { overrides: { items: { properties: Props } } } };
        interaction: { properties: { placements: { items: { properties: Props } } } };
      };
    };
    const o = schema.properties.motion.properties.overrides.items.properties;
    const p = schema.properties.interaction.properties.placements.items.properties;
    const overridable = SKELETON.slides.filter((s) => c.compat.designRules.motionOverrideSlideTypes.includes(s.type)).map((s) => s.id);
    expect(overridable).toEqual(["s01", "s06", "s07", "s14"]);
    expect(o.slideId!.enum).toEqual(overridable);
    expect(o.transition!.enum).toEqual(c.motion.vocabulary.transition);
    expect(o.enter!.enum).toEqual(c.motion.vocabulary.enter);
    expect(o.easing!.anyOf![0]!.enum).toEqual(c.motion.vocabulary.easing);
    expect(p.slideId!.enum).toEqual(SKELETON.slides.map((s) => s.id));
    expect(p.componentId!.enum).toEqual(getInteractionMode(c, choices.interactionModeId).components);
  });
});

describe("assembleDesign", () => {
  it("override carries overrideReason; others = resolveMotionPlan", () => {
    const plan = assembleDesign(c, choices, SKELETON, WIRE);
    const base = resolveMotionPlan(c, choices.motionTemplateId, SKELETON.slides);
    expect(plan.motion).toMatchObject({ templateId: base.templateId, reducedMotion: base.reducedMotion, timing: base.timing });
    expect(plan.motion.slides.s06).toEqual({
      transition: "fade",
      enter: "scaleIn",
      emphasis: "countUp",
      exit: "fade",
      easing: base.slides.s06!.easing,
      overrideReason: "Land the headline number",
    });
    for (const s of SKELETON.slides.filter((x) => !["s06", "s14"].includes(x.id))) expect(plan.motion.slides[s.id]).toEqual(base.slides[s.id]);
  });

  it("easing:null keeps the template easing", () => {
    const plan = assembleDesign(c, choices, SKELETON, WIRE);
    const base = resolveMotionPlan(c, choices.motionTemplateId, SKELETON.slides);
    expect(plan.motion.slides.s06!.easing).toBe(base.slides.s06!.easing);
    expect(plan.motion.slides.s14!.easing).toBe("power3.out");
  });

  it("placements grouped in deck order", () => {
    const plan = assembleDesign(c, choices, SKELETON, WIRE);
    expect(plan.interaction).toEqual({
      modeId: choices.interactionModeId,
      slides: [
        { slideId: "s01", components: [{ componentId: "df-notes", props: {} }] },
        {
          slideId: "s04",
          components: [
            { componentId: "df-fragment", blockIndex: 0, props: { mode: "one-by-one" } },
            { componentId: "df-tabs", blockIndex: 0, props: { max: 3 } },
          ],
        },
        { slideId: "s09", components: [{ componentId: "df-chart", blockIndex: 0, props: { kind: "bar", tooltip: true } }] },
        { slideId: "s10", components: [{ componentId: "df-compare", blockIndex: 0, props: {} }] },
        { slideId: "s11", components: [{ componentId: "df-timeline", blockIndex: 0, props: {} }] },
      ],
    });
    expect("blockIndex" in plan.interaction.slides[0]!.components[0]!).toBe(false);
  });
});

describe("design stage", () => {
  it("depends on content, has the design timeout and two validation retries", () => {
    const stage = createDesignStage({ prompt: PROMPT, model: MODEL });
    expect(stage).toMatchObject({ name: "design", timeoutMs: STAGE_TIMEOUTS_MS.design, retry: { validation: 2 }, dependsOn: ["content"] });
    expect(stage.version).toContain("design.v1");
    expect(stage.version).toContain(MODEL);
  });

  it("select gives DesignChoices and the skeleton; needs a deck", () => {
    const stage = createDesignStage({ prompt: PROMPT, model: MODEL });
    const brief = { topic: "x", brief: "y", audience: "general" as const, durationMin: 10 as const, language: "en" as const };
    expect(stage.select({ brief, choices: full, deck: STANDARD_DECK }, c)).toEqual({ choices, skeleton: SKELETON });
    expect(() => stage.select({ brief, choices: full }, c)).toThrow(/deck/);
  });

  it("fingerprint unchanged by paletteId/typeFamilyId/threeJs; changed by motionTemplateId", () => {
    const stage = createDesignStage({ prompt: PROMPT, model: MODEL });
    const brief = { topic: "x", brief: "y", audience: "general" as const, durationMin: 10 as const, language: "en" as const };
    const fp = (ch: Choices) => JSON.stringify(stage.fingerprint(stage.select({ brief, choices: ch, deck: STANDARD_DECK }, c), c));
    const base = fp(full);
    expect(fp({ ...full, paletteId: "another-palette" })).toBe(base);
    expect(fp({ ...full, typeFamilyId: "another-type" })).toBe(base);
    expect(fp({ ...full, threeJs: !full.threeJs })).toBe(base);
    expect(fp({ ...full, styleFamilyId: "another-family" })).toBe(base);
    const other = c.motion.templates.find((t) => t.id !== full.motionTemplateId)!.id;
    expect(fp({ ...full, motionTemplateId: other })).not.toBe(base);
  });

  it("override on bullets retried", async () => {
    const bad = structuredClone(WIRE);
    bad.motion.overrides.push(override({ slideId: "s04" }));
    const { result, fake, events } = await runStage([{ kind: "tool", input: bad }, { kind: "tool", input: WIRE }]);
    await result;
    expect(fake.calls).toHaveLength(2);
    const feedback = JSON.stringify(fake.calls[1]!.messages.at(-1));
    expect(feedback).toContain('"isError":true');
    expect(feedback).toContain("override-slide-type");
    expect(feedback).toContain("slide s04 is \\\"bullets\\\"");
    expect(events.filter((e) => e.type === "stage:retry")).toHaveLength(1);
  });

  it("output parses as DesignPlanSchema", async () => {
    const { result, stage } = await runStage([{ kind: "tool", input: WIRE }]);
    const plan = await result;
    expect(DesignPlanSchema.parse(plan)).toEqual(plan);
    expect(stage.output.parse(plan)).toEqual(plan);
    expect(plan).toEqual(assembleDesign(c, choices, SKELETON, WIRE));
    expect(stage.summarize(plan)).toEqual({ stage: "design", overrides: 2, placements: 6 });
  });
});
