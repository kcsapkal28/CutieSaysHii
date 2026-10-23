import { goldenChoices, wordsPerSlideMax, type Catalog } from "@deckforge/catalog";
import type { BriefSpec, Choices, DeckSpec } from "@deckforge/schemas";
import { beforeAll, describe, expect, it } from "vitest";
import { buildContentRequest, DEFAULT_CONTENT_EFFORT } from "../../src/agents/deck-tool.ts";
import type { AgentPrompt } from "../../src/agents/messages.ts";
import { FakeLlm, type FakeReply } from "../../src/fakes/llm.ts";
import { ContentChoicesSchema, type PipelineState } from "../../src/kernel/contracts.ts";
import type { StageEvent } from "../../src/kernel/events.ts";
import { STAGE_TIMEOUTS_MS } from "../../src/kernel/stage.ts";
import { createContentStage } from "../../src/stages/content.ts";
import { makeTestContext, testCatalog } from "../helpers/context.ts";
import { STANDARD_DECK } from "../validate/fixtures.ts";

const PROMPT: AgentPrompt = { name: "content.v1", text: "Call emit_deck once." };
const MODEL = "claude-sonnet-5-5";
const BRIEF: BriefSpec = {
  topic: "How solar cells work",
  brief: "Explain how a photovoltaic cell turns sunlight into electric current, for a curious general audience.",
  audience: "general",
  durationMin: 10,
  language: "en",
};

let c: Catalog;
let linear: Choices;
let assessment: Choices;
beforeAll(async () => {
  c = await testCatalog();
  // goldenChoices[0] is the fixture's combination (standard depth, linear mode).
  linear = goldenChoices(c)[0]!;
  assessment = goldenChoices(c).find((g) => g.questionCount !== undefined)!;
});

type Rules = {
  slides: [number, number];
  wordsPerSlideMax: number;
  notesWords: [number, number];
  quizSlides: number;
  requiredTypes: string[];
  slideTypes: Record<string, unknown>[];
};
type Input = { brief: BriefSpec; rules: Rules };

const inputOf = (choices: Choices) => ({ brief: BRIEF, choices: ContentChoicesSchema.parse(choices) });
const request = (choices: Choices, o: { prompt?: AgentPrompt; model?: string; effort?: "high" } = {}) =>
  buildContentRequest(inputOf(choices), c, { prompt: PROMPT, model: MODEL, ...o });
const rulesOf = (choices: Choices) => (request(choices).input as Input).rules;

const deck = (edit?: (d: DeckSpec & Record<string, unknown>) => void): unknown => {
  const d = structuredClone(STANDARD_DECK) as DeckSpec & Record<string, unknown>;
  edit?.(d);
  return d;
};

async function runStage(replies: FakeReply[], choices = linear) {
  const fake = new FakeLlm({ replies: { emit_deck: replies } });
  const t = await makeTestContext({ llm: fake });
  const stage = createContentStage({ prompt: PROMPT, model: MODEL });
  const state: PipelineState = { brief: BRIEF, choices };
  const result = stage.run(stage.input.parse(stage.select(state, c)), t.ctx);
  return { fake, stage, result, ...t };
}

const feedbackOf = (fake: FakeLlm, call: number) => JSON.stringify(fake.calls[call]!.messages.at(-1));

describe("buildContentRequest", () => {
  it("request: model, emit_deck, slide-type enum in catalog order, effort, maxTokens 16000", () => {
    const req = request(linear);
    expect(req.model).toBe(MODEL);
    expect(req.system).toBe(PROMPT.text);
    expect(req.tool).toMatchObject({ name: "emit_deck", strict: false });
    const schema = req.tool.inputSchema as { properties: { slides: { items: { properties: { type: { enum: string[] } } } } } };
    expect(schema.properties.slides.items.properties.type.enum).toEqual(c.slideTypes.types.map((t) => t.id));
    expect(DEFAULT_CONTENT_EFFORT).toBe("medium");
    expect(req.effort).toBe("medium");
    expect(request(linear, { effort: "high" }).effort).toBe("high");
    expect(req.maxTokens).toBe(16000);
    expect(req.normalize({ title: "T", subtitle: "S", slides: [{ title: null }] })).toEqual({ title: "T", subtitle: "S", slides: [{}] });
  });

  it("standard rules: slides [10,14], notesWords [60,120], wordsPerSlideMax = wordsPerSlideMax(c,\"standard\",family), quizSlides 0, agenda required", () => {
    const req = request(linear);
    expect(Object.keys(req.input as object)).toEqual(["brief", "rules"]);
    expect((req.input as Input).brief).toEqual(BRIEF);
    const rules = rulesOf(linear);
    expect(rules).toMatchObject({
      slides: [10, 14],
      notesWords: [60, 120],
      wordsPerSlideMax: wordsPerSlideMax(c, "standard", linear.styleFamilyId),
      quizSlides: 0,
      requiredTypes: ["agenda"],
    });
    expect(rulesOf({ ...linear, depth: "overview" }).requiredTypes).toEqual([]);
  });

  it("slideTypes carry id, name, accepts, limits and the placement rules only", () => {
    const types = rulesOf(linear).slideTypes;
    expect(types.map((t) => t.id)).toEqual(c.slideTypes.types.map((t) => t.id));
    expect(types[0]).toEqual({ id: "title", name: "Title", accepts: [], limits: { titleWords: 8, subtitleWords: 14 }, required: "first" });
    expect(types.find((t) => t.id === "quiz")).toMatchObject({ onlyIn: ["assessment"] });
    for (const t of types) expect(Object.keys(t).every((k) => ["id", "name", "accepts", "limits", "required", "onlyIn"].includes(k))).toBe(true);
  });

  it("assessment questionCount 4 → quizSlides 4", () => {
    expect(assessment.questionCount).toBe(4);
    expect(rulesOf(assessment).quizSlides).toBe(4);
    expect(rulesOf({ ...assessment, questionCount: 6 }).quizSlides).toBe(6);
  });
});

describe("content stage", () => {
  it("has the content timeout, two validation retries and no upstream", () => {
    const stage = createContentStage({ prompt: PROMPT, model: MODEL });
    expect(stage).toMatchObject({ name: "content", timeoutMs: STAGE_TIMEOUTS_MS.content, retry: { validation: 2 }, dependsOn: [] });
    expect(stage.version).toContain("content.v1");
    expect(stage.version).toContain(MODEL);
  });

  it("fixture accepted; optional null title removed", async () => {
    const wire = deck((d) => {
      (d.slides[0] as Record<string, unknown>).title = null;
      (d.slides.find((s) => s.type === "chart")!.body[0] as Record<string, unknown>).unit = null;
    });
    const { result, fake, stage } = await runStage([{ kind: "tool", input: wire }]);
    const out = await result;
    expect(fake.calls).toHaveLength(1);
    expect("title" in out.slides[0]!).toBe(false);
    expect("unit" in out.slides.find((s) => s.type === "chart")!.body[0]!).toBe(false);
    const expected = structuredClone(STANDARD_DECK);
    delete expected.slides[0]!.title;
    delete (expected.slides.find((s) => s.type === "chart")!.body[0] as { unit?: string }).unit;
    expect(out).toEqual(expected);
    expect(stage.output.parse(out)).toEqual(out);
    expect(stage.summarize(out)).toEqual({ stage: "content", slideCount: 12, slideTypes: STANDARD_DECK.slides.map((s) => s.type) });
    expect(stage.reduce({ brief: BRIEF, choices: linear }, out)).toEqual({ brief: BRIEF, choices: linear, deck: out });
  });

  it("slide-count violation retried", async () => {
    const short = deck((d) => {
      d.slides = d.slides.filter((s) => !["s05", "s07", "s08"].includes(s.id));
    });
    const { result, fake, events } = await runStage([{ kind: "tool", input: short }, { kind: "tool", input: deck() }]);
    await expect(result).resolves.toEqual(STANDARD_DECK);
    expect(fake.calls).toHaveLength(2);
    expect(feedbackOf(fake, 1)).toContain('"isError":true');
    expect(feedbackOf(fake, 1)).toContain("deck has 9 slides; standard needs 10–14");
    expect(events.filter((e) => e.type === "stage:retry")).toEqual([expect.objectContaining({ reason: "validation", attempt: 1, maxAttempts: 3 })]);
  });

  it("notes-length feedback names the short slide verbatim", async () => {
    const shortNotes = deck((d) => {
      d.slides.find((s) => s.id === "s04")!.notes = "Too short here.";
    });
    const { result, fake } = await runStage([{ kind: "tool", input: shortNotes }, { kind: "tool", input: deck() }]);
    await result;
    expect(feedbackOf(fake, 1)).toContain("slide s04 notes have 3 words; need 60–120 at standard depth");
  });

  it("schema errors are fed back too", async () => {
    const broken = deck((d) => {
      (d.slides[1] as Record<string, unknown>).notes = 7;
    });
    const { result, fake } = await runStage([{ kind: "tool", input: broken }, { kind: "tool", input: deck() }]);
    await result;
    expect(feedbackOf(fake, 1)).toContain("slides[1].notes");
  });

  it("select exposes only ContentChoices fields", async () => {
    const stage = createContentStage({ prompt: PROMPT, model: MODEL });
    const selected = stage.select({ brief: BRIEF, choices: linear }, c);
    expect(selected.brief).toEqual(BRIEF);
    expect(Object.keys(selected.choices).sort()).toEqual(["depth", "interactionModeId", "styleFamilyId"]);
    expect(Object.keys(stage.select({ brief: BRIEF, choices: assessment }, c).choices).sort()).toEqual([
      "depth",
      "interactionModeId",
      "questionCount",
      "styleFamilyId",
    ]);
  });

  it("fingerprint changes with prompt text, model, effort and catalog slide types; not with paletteId, typeFamilyId or motionTemplateId", () => {
    const fp = (o: { prompt?: AgentPrompt; model?: string; effort?: "high" } = {}, choices = linear, catalog = c) => {
      const stage = createContentStage({ prompt: PROMPT, model: MODEL, ...o });
      return JSON.stringify(stage.fingerprint(stage.select({ brief: BRIEF, choices }, catalog), catalog));
    };
    const base = fp();
    expect(fp({ prompt: { ...PROMPT, text: `${PROMPT.text} ` } })).not.toBe(base);
    expect(fp({ model: "claude-opus-5-5" })).not.toBe(base);
    expect(fp({ effort: "high" })).not.toBe(base);
    const renamed = structuredClone(c);
    renamed.slideTypes.types[3]!.name = "Bullet list";
    expect(fp({}, linear, renamed)).not.toBe(base);
    expect(fp({}, { ...linear, depth: "deep" })).not.toBe(base);

    expect(fp({}, { ...linear, paletteId: "another-palette" })).toBe(base);
    expect(fp({}, { ...linear, typeFamilyId: "another-type" })).toBe(base);
    expect(fp({}, { ...linear, motionTemplateId: "another-motion" })).toBe(base);
    expect(fp({}, { ...linear, threeJs: !linear.threeJs })).toBe(base);
  });

  it("emits progress", async () => {
    const { result, events } = await runStage([{ kind: "tool", input: deck() }]);
    await result;
    const progress = events.filter((e): e is Extract<StageEvent, { type: "stage:progress" }> => e.type === "stage:progress");
    expect(progress.map((e) => e.message)).toEqual([`calling ${MODEL} (attempt 1/3)`]);
  });
});
