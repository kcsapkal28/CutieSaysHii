import { goldenChoices, resolveMotionPlan, wordsPerSlideMax, type Catalog } from "@deckforge/catalog";
import type { Choices, QAReport } from "@deckforge/schemas";
import { beforeAll, describe, expect, it } from "vitest";
import { requestFingerprintOf, type AgentPrompt } from "../../src/agents/messages.ts";
import { buildPatchRequest, patchWireSchema, toDomainPatch, type WirePatch } from "../../src/agents/patch-tool.ts";
import { reconcileDesign } from "../../src/design/reconcile.ts";
import { FakeLlm, type FakeReply } from "../../src/fakes/llm.ts";
import { ContentChoicesSchema, type DesignPlan, type PipelineState } from "../../src/kernel/contracts.ts";
import { STAGE_TIMEOUTS_MS } from "../../src/kernel/stage.ts";
import { applyPatches } from "../../src/patches/apply.ts";
import { createPatchStage } from "../../src/stages/patch.ts";
import { deckRules } from "../../src/validate/rules.ts";
import { assertUnionBudget, compileWireSchema, UNION_PARAM_LIMIT } from "../../src/wire/schema.ts";
import { makeTestContext, testCatalog } from "../helpers/context.ts";
import { reportWith } from "../qa/fixtures.ts";
import { STANDARD_DECK } from "../validate/fixtures.ts";

const PROMPT: AgentPrompt = { name: "patch.v1", text: "Call emit_patches once." };
const FAST = "claude-haiku-5-5";
const BRIEF = { topic: "x", brief: "y", audience: "general" as const, durationMin: 10 as const, language: "en" as const };
const NOTES = Array.from({ length: 70 }, (_, i) => `word${i}`).join(" ");

let c: Catalog;
let choices: Choices;
let design: DesignPlan;
let wordCap: number;
beforeAll(async () => {
  c = await testCatalog();
  choices = goldenChoices(c)[0]!;
  wordCap = wordsPerSlideMax(c, choices.depth, choices.styleFamilyId);
  design = {
    motion: resolveMotionPlan(c, choices.motionTemplateId, STANDARD_DECK.slides),
    interaction: {
      modeId: choices.interactionModeId,
      slides: [
        { slideId: "s01", components: [{ componentId: "df-notes", props: {} }] },
        { slideId: "s04", components: [{ componentId: "df-fragment", blockIndex: 0, props: { mode: "one-by-one" } }] },
      ],
    },
  };
});

const FAILING_S04 = () => reportWith({ s04: { overflow: true } });
const state = (report: QAReport = FAILING_S04()): PipelineState => ({ brief: BRIEF, choices, deck: STANDARD_DECK, design, report });

const shorten = (o: Partial<Extract<WirePatch, { op: "shortenText" }>> = {}): WirePatch => ({
  op: "shortenText",
  slideId: "s04",
  title: "The effect in brief",
  body: [{ type: "Bullets", items: ["Photons carry energy", "Enough energy frees an electron", "The rest is lost as heat"] }],
  ...o,
});
const half = (title: string, items: string[]) => ({ title, body: [{ type: "Bullets" as const, items }], notes: NOTES, emphasisTargets: [] });
const split = (notes = NOTES): WirePatch => ({
  op: "splitSlide",
  slideId: "s04",
  halves: [
    { ...half("Light in", ["Photons carry energy", "Colour sets the energy"]), notes },
    { ...half("Electrons out", ["Enough energy frees an electron", "The rest is heat"]), notes },
  ],
});
const reply = (...patches: WirePatch[]): FakeReply => ({ kind: "tool", input: { patches } });

async function runStage(replies: FakeReply[], report?: QAReport) {
  const fake = new FakeLlm({ replies: { emit_patches: replies } });
  const t = await makeTestContext({ llm: fake, stage: "patch" });
  const stage = createPatchStage({ prompt: PROMPT, model: FAST });
  const input = stage.input.parse(stage.select(state(report), c));
  return { fake, stage, input, result: stage.run(input, t.ctx), ...t };
}

type Input = { report: { failures: { slideId: string; reasons: string[] }[] }; slides: { id: string }[]; wordCap: number; rules: Record<string, unknown> };

describe("patch request", () => {
  it("only failing slides sent", () => {
    const stage = createPatchStage({ prompt: PROMPT, model: FAST });
    const report = reportWith({ s09: { overflow: true }, s04: { wordCount: wordCap + 2 } });
    const req = buildPatchRequest(stage.select(state(report), c), c, { prompt: PROMPT, model: FAST });
    const input = req.input as Input;
    expect(Object.keys(input)).toEqual(["report", "slides", "wordCap", "rules"]);
    expect(input.report.failures).toEqual([
      { slideId: "s04", reasons: [`${wordCap + 2} words > ${wordCap}`] },
      { slideId: "s09", reasons: ["overflow"] },
    ]);
    expect(input.slides).toEqual(STANDARD_DECK.slides.filter((s) => ["s04", "s09"].includes(s.id)));
    expect(input.wordCap).toBe(wordCap);
    expect(input.rules).toMatchObject({ slides: [10, 14], wordsPerSlideMax: wordCap, slideCount: STANDARD_DECK.slides.length });
    const json = JSON.stringify(input);
    for (const s of STANDARD_DECK.slides.filter((x) => !["s04", "s09"].includes(x.id))) expect(json).not.toContain(JSON.stringify(s.notes));
  });

  it("fast model, emit_patches, effort low", () => {
    const stage = createPatchStage({ prompt: PROMPT, model: FAST });
    const req = buildPatchRequest(stage.select(state(), c), c, { prompt: PROMPT, model: FAST });
    expect(req).toMatchObject({ model: FAST, system: PROMPT.text, effort: "low", maxTokens: 8000 });
    expect(req.tool).toMatchObject({ name: "emit_patches", strict: false });
    expect(stage).toMatchObject({ name: "patch", timeoutMs: STAGE_TIMEOUTS_MS.patch, retry: { validation: 2 }, dependsOn: ["qa"] });
    expect(stage.version).toBe(`patch.v1/${FAST}/low`);
    expect(stage.fingerprint(stage.select(state(), c), c)).toEqual(requestFingerprintOf(req));
  });

  it("slideId enum = failing ids", () => {
    const stage = createPatchStage({ prompt: PROMPT, model: FAST });
    const report = reportWith({ s09: { overflow: true }, s04: { overflow: true } });
    const req = buildPatchRequest(stage.select(state(report), c), c, { prompt: PROMPT, model: FAST });
    type Branch = { properties: { op: { const: string }; slideId: { enum: string[] }; type?: { enum: string[] } } };
    const branches = (req.tool.inputSchema as { properties: { patches: { items: { anyOf: Branch[] } } } }).properties.patches.items.anyOf;
    expect(branches.map((b) => b.properties.op.const)).toEqual(["shortenText", "splitSlide", "swapLayout", "dropBlock"]);
    for (const b of branches) expect(b.properties.slideId.enum).toEqual(["s04", "s09"]);
    expect(branches[2]!.properties.type!.enum).toEqual(c.slideTypes.types.map((t) => t.id));
  });

  it("the patch wire stays within the union budget", () => {
    const wire = compileWireSchema(patchWireSchema({ slideIds: ["s04"], slideTypeIds: c.slideTypes.types.map((t) => t.id) }));
    expect(wire.unionParamCount).toBeLessThanOrEqual(UNION_PARAM_LIMIT);
    expect(() => assertUnionBudget([wire])).not.toThrow();
  });

  it("toDomainPatch moves everything but slideId and op into the payload", () => {
    expect(toDomainPatch({ op: "dropBlock", slideId: "s06", blockIndex: 2 })).toEqual({ slideId: "s06", op: "dropBlock", payload: { blockIndex: 2 } });
  });

  it("needs a failing report", () => {
    const stage = createPatchStage({ prompt: PROMPT, model: FAST });
    expect(() => stage.select(state(reportWith({})), c)).toThrow(/no failing slides/);
    expect(() => stage.select({ ...state(), report: undefined }, c)).toThrow(/report/);
  });
});

describe("patch stage", () => {
  it("patched deck + reconciled plan", async () => {
    const { result, stage, fake } = await runStage([reply(split())]);
    const out = await result;
    const patches = [toDomainPatch(split())];
    const applied = applyPatches(STANDARD_DECK, patches, deckRules(c, ContentChoicesSchema.parse(choices)));
    if (!applied.ok) throw new Error("fixture patch should apply");
    expect(fake.calls).toHaveLength(1);
    expect(out).toEqual({ patches, deck: applied.deck, design: reconcileDesign(c, choices, design, { before: STANDARD_DECK, after: applied.deck }) });
    expect(out.deck.slides.map((s) => s.id)).toContain("s04a");
    expect(Object.keys(out.design.motion.slides)).toEqual(out.deck.slides.map((s) => s.id));
    expect(out.design.interaction.slides.map((s) => s.slideId)).toEqual(["s01"]);
    expect(stage.output.parse(out)).toEqual(out);
    expect(stage.summarize(out)).toEqual({ stage: "patch", patches: [{ slideId: "s04", op: "splitSlide" }] });
    const next = stage.reduce(state(), out);
    expect(next.deck).toEqual(out.deck);
    expect(next.design).toEqual(out.design);
  });

  it("rule-breaking patch fed back", async () => {
    const swap: WirePatch = { op: "swapLayout", slideId: "s04", type: "stat" };
    const { result, fake, events } = await runStage([reply(swap), reply(shorten())]);
    const out = await result;
    expect(fake.calls).toHaveLength(2);
    const feedback = JSON.stringify(fake.calls[1]!.messages.at(-1));
    expect(feedback).toContain('"isError":true');
    expect(feedback).toContain("block-not-accepted");
    expect(events.filter((e) => e.type === "stage:retry")).toHaveLength(1);
    expect(out.patches).toEqual([toDomainPatch(shorten())]);
  });

  it("the patched deck must still pass the deck rules", async () => {
    const { result, fake } = await runStage([reply(split("Too short.")), reply(split())]);
    await result;
    const feedback = JSON.stringify(fake.calls[1]!.messages.at(-1));
    expect(feedback).toContain("notes-length");
    expect(feedback).toContain("s04a");
  });

  it("patches only the failing slides, and at least one", async () => {
    const other: WirePatch = { op: "dropBlock", slideId: "s06", blockIndex: 0 };
    const { result, fake } = await runStage([reply(other), reply(), reply(shorten())]);
    await result;
    expect(JSON.stringify(fake.calls[1]!.messages.at(-1))).toContain("patch-not-failing");
    expect(JSON.stringify(fake.calls[2]!.messages.at(-1))).toContain("no-patches");
  });

  it("null title keeps the original", async () => {
    const report = reportWith({ s06: { overflow: true } });
    const s06 = STANDARD_DECK.slides.find((s) => s.id === "s06")!;
    // As the model sends it: null for the kept title and for an absent optional block field.
    const body = [
      { type: "Stat", value: "22%", label: "panel efficiency", trend: null },
      { type: "Stat", value: "0.6 V", label: "one cell", trend: "flat" },
      { type: "Stat", value: "1,000 W/m²", label: "test sunlight", trend: null },
    ];
    const { result } = await runStage([{ kind: "tool", input: { patches: [{ op: "shortenText", slideId: "s06", title: null, body }] } }], report);
    const out = await result;
    const patched = out.deck.slides.find((s) => s.id === "s06")!;
    expect(patched.title).toBe(s06.title);
    expect(patched.body).toEqual([
      { type: "Stat", value: "22%", label: "panel efficiency" },
      { type: "Stat", value: "0.6 V", label: "one cell", trend: "flat" },
      { type: "Stat", value: "1,000 W/m²", label: "test sunlight" },
    ]);
    expect(out.patches[0]!.payload).toMatchObject({ title: null });
  });
});
