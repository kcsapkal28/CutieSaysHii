import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ContractError } from "../src/check.ts";
import { MODELS, type WireRequest } from "../src/llm.ts";
import {
  createProject,
  listVersions,
  loadOutline,
  loadProject,
  loadScript,
  loadStoryboard,
  projectStatus,
  reviseSlide,
  runAll,
  runStage,
  saveStageFile,
  StageError,
  type ForgeEvent,
  type PipelineOptions,
  type Project,
} from "../src/pipeline/index.ts";
import { arcOut, cardOut, fakeEngine, fakeLlm, researchOut, review, slideHtml, styleOut, type FakeEngine, type FakeLlm, type Handler } from "./fakes.ts";

const slideOf = (req: WireRequest) => /Slide id: (s\d\d)|Slide (s\d\d)\./.exec(JSON.stringify(req.messages[0]))!.slice(1).find(Boolean)!;
const cardOf = (req: WireRequest) => /Write the card for (s\d\d)/.exec(JSON.stringify(req.messages[0]))![1]!;
const toolOf = (req: WireRequest) => req.tools?.[0]?.name;

function handlers(over: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    recommend_style: () => styleOut(),
    record_research: () => researchOut,
    plan_arc: () => arcOut(),
    write_card: (req) => cardOut(cardOf(req)),
    write_slide: (req) => ({ html: slideHtml(slideOf(req)), steps: 2, summary: "Built." }),
    review_slide: () => review("pass"),
    ...over,
  };
}

let root: string;
let project: Project;
let events: ForgeEvent[];
let llm: FakeLlm;
let engine: FakeEngine;
const opts = (): PipelineOptions => ({ llm, engine, onEvent: (e) => events.push(e), exemplars: [] });
/** Runs every stage before the build with the default handlers. */
async function upToOutline() {
  await runAll(project, { auto: true, to: "outline", ...opts() });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "forge-"));
  project = createProject({ topic: "How active noise cancellation works", audience: "engineers", minutes: 8, root });
  events = [];
  llm = fakeLlm(handlers());
  engine = fakeEngine();
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("projects", () => {
  it("creates projects/<slug>/brief.json, de-duplicates slugs and loads by slug or dir", () => {
    expect(project.slug).toBe("how-active-noise-cancellation-works");
    expect(JSON.parse(readFileSync(join(project.dir, "brief.json"), "utf8"))).toMatchObject({ minutes: 8, prefs: {} });
    expect(createProject({ topic: "How active noise cancellation works", audience: "x", minutes: 5, root }).slug).toBe(
      "how-active-noise-cancellation-works-2",
    );
    expect(loadProject(project.slug, root)).toEqual(project);
    expect(loadProject(project.dir)).toEqual(project);
  });
});

describe("stage ordering and invalidation", () => {
  it("refuses to run a stage before its predecessors", async () => {
    await expect(runStage(project, "outline", opts())).rejects.toThrow(StageError);
    await expect(runStage(project, "outline", opts())).rejects.toThrow("run style, research first");
  });

  it("runAll runs every stage in order and writes each stage's file", async () => {
    const { ran, build } = await runAll(project, { auto: true, ...opts() });
    expect(ran).toEqual(["style", "research", "outline", "build"]);
    expect(events.filter((e) => e.type === "stage:start").map((e) => (e as { stage: string }).stage)).toEqual(ran);
    expect(Object.values(projectStatus(project)).every(Boolean)).toBe(true);
    for (const f of ["style.json", "research.md", "outline.json", "slides/s01.html", "slides/s02.html", "versions/1/deck.html"]) {
      expect(existsSync(join(project.dir, f)), f).toBe(true);
    }
    for (const f of ["script.json", "storyboard.json"]) expect(existsSync(join(project.dir, f)), f).toBe(false);
    expect(build?.version).toBe(1);
    expect(JSON.parse(readFileSync(join(project.dir, "outline.json"), "utf8")).sections[1].slides[0]).toMatchObject({ id: "s02", budgetSec: 290 });
    const done = events.find((e) => e.type === "stage:done" && e.stage === "build") as Extract<ForgeEvent, { type: "stage:done" }>;
    expect(done.calls).toBe(4); // 2 slides × (builder + critic)
    expect(done.usage.input).toBe(400);
  });

  it("re-running a stage deletes every later stage's outputs but keeps earlier ones and versions", async () => {
    await runAll(project, { auto: true, ...opts() });
    await runStage(project, "research", opts());
    expect(projectStatus(project)).toEqual({ style: true, research: true, outline: false, build: false });
    expect(existsSync(join(project.dir, "slides"))).toBe(false);
    expect(existsSync(join(project.dir, "versions/1/deck.html"))).toBe(true);
    expect(events.filter((e) => e.type === "stage:start").at(-1)).toEqual({
      type: "stage:start",
      stage: "research",
      invalidated: ["outline", "build"],
    });

    // runAll resumes from the first stage that isn't done; the next build is version 2.
    const { ran, build } = await runAll(project, { auto: true, ...opts() });
    expect(ran).toEqual(["outline", "build"]);
    expect(build?.version).toBe(2);
  });

  it("stops after a stage the approver rejects", async () => {
    const { ran } = await runAll(project, { auto: false, approve: async (s) => s !== "research", ...opts() });
    expect(ran).toEqual(["style", "research"]);
  });

  it("saveStageFile validates a user edit and invalidates later stages", async () => {
    await runAll(project, { auto: true, ...opts() });
    const outline = loadOutline(project);
    outline.sections[0]!.slides[0]!.title = "Edited claim";
    expect(saveStageFile(project, "outline", outline)).toEqual({ invalidated: ["build"] });
    expect(loadScript(project).slides[0]!.title).toBe("Edited claim");
    expect(projectStatus(project).build).toBe(false);
    expect(() => saveStageFile(project, "outline", { title: 1 })).toThrow();
  });
});

describe("outline: an arc, then one card per slide", () => {
  it("plans the arc once, writes every card concurrently, and assembles one outline.json", async () => {
    await upToOutline();
    expect(llm.calls.plan_arc).toBe(1);
    expect(llm.calls.write_card).toBe(2);
    const outlineCalls = llm.requests.filter((r) => toolOf(r) === "plan_arc" || toolOf(r) === "write_card");
    expect(outlineCalls.every((r) => r.model === MODELS.opus)).toBe(true);

    // Each card sees the whole arc, its neighbours' handoff and the research; the cards share one system prompt.
    const cards = llm.requests.filter((r) => toolOf(r) === "write_card");
    const second = JSON.stringify(cards[1]!.messages[0]);
    expect(second).toMatch(/The deck's arc \(fixed\)/);
    expect(second).toMatch(/Previous slide s01 .* hands off: the noise wave/);
    expect(second).toContain("ANC adds an inverted copy of noise.");
    expect(cards[0]!.system).toEqual(cards[1]!.system);

    const outline = loadOutline(project);
    expect(outline).toMatchObject({ title: "Inside ANC", totalSec: 480, visualThroughline: "One earbud, four signal colours." });
    expect(outline.sections.map((s) => s.slides.map((x) => x.id))).toEqual([["s01"], ["s02"]]);
    expect(outline.sections[1]!.slides[0]).toMatchObject({
      title: "Claim for s02",
      point: "Inverted waves cancel.",
      role: "mechanism",
      budgetSec: 290,
      visual: { explainer: "simulation", technique: "parametric-sim", entry: "The noise wave alone.", exit: "A flat line." },
    });

    // The builder still gets a script and a storyboard, derived from the outline.
    expect(loadScript(project).slides.map((s) => [s.id, s.section, s.title])).toEqual([
      ["s01", "Hook", "Claim for s01"],
      ["s02", "How", "Claim for s02"],
    ]);
    expect(loadStoryboard(project).slides[1]).toMatchObject({ id: "s02", explainer: "simulation", exit: "A flat line." });

    const progress = events.filter((e) => e.type === "outline:arc" || e.type === "outline:card");
    expect(progress[0]).toEqual({ type: "outline:arc", title: "Inside ANC", sections: 2, slides: [{ id: "s01", point: "An earbud can erase sound." }, { id: "s02", point: "Inverted waves cancel." }] });
    expect(progress.slice(1).map((e) => (e as { id: string }).id).sort()).toEqual(["s01", "s02"]);
    expect(progress.at(-1)).toMatchObject({ type: "outline:card", done: 2, total: 2 });
  });

  it("the builder sees the slide's words and visual direction, entry and exit included", async () => {
    await runAll(project, { auto: true, ...opts() });
    const req = llm.requests.find((r) => toolOf(r) === "write_slide" && slideOf(r) === "s02")!;
    const text = JSON.stringify(req.messages[0]);
    expect(text).toContain("Claim for s02");
    expect(text).toContain("The noise wave alone.");
  });
});

describe("build fix loop", () => {
  it("feeds the critic's issues back to the builder and stops on pass", async () => {
    await upToOutline();
    let s01Reviews = 0;
    llm = fakeLlm(
      handlers({
        write_slide: (req) => ({ html: slideHtml(slideOf(req), `v${llm.calls.write_slide}`), steps: 2, summary: "Built." }),
        review_slide: (req) => (slideOf(req) === "s01" && ++s01Reviews === 1 ? review("fix") : review("pass")),
      }),
    );
    const summary = await runStage(project, "build", { ...opts(), concurrency: 1 });

    const s01 = summary!.slides[0]!;
    expect(s01).toMatchObject({ id: "s01", verdict: "pass", bestRound: 2 });
    expect(s01.rounds).toHaveLength(2);
    expect(summary!.slides[1]!.rounds).toHaveLength(1);

    const builderCalls = llm.requests.filter((r) => toolOf(r) === "write_slide" && slideOf(r) === "s01");
    expect(builderCalls).toHaveLength(2);
    expect(builderCalls.map((r) => r.model)).toEqual([MODELS.sonnet, MODELS.sonnet]);
    const revision = JSON.stringify(builderCalls[1]!.messages[0]);
    expect(revision).toMatch(/This is a revision/);
    expect(revision).toMatch(/\[high\] Title clipped \(where: step 1, top\)\. Fix: Reduce to 64px/);
    expect(builderCalls[1]!.messages[0]!.content.some((c) => c.type === "image")).toBe(true);
    expect(llm.requests.filter((r) => toolOf(r) === "review_slide").every((r) => r.model === MODELS.opus)).toBe(true);

    expect(existsSync(join(project.dir, "shots/s01/r1/step-0.png"))).toBe(true);
    expect(existsSync(join(project.dir, "shots/s01/r2/step-1.png"))).toBe(true);
    const verdicts = events.filter((e) => e.type === "slide:verdict").map((e) => `${(e as { id: string }).id}:${(e as { verdict: string }).verdict}`);
    expect(verdicts).toEqual(expect.arrayContaining(["s01:fix", "s01:pass", "s02:pass"]));
  });

  it("after 2 rounds escalates one last fix to Opus on a high-severity issue, stops there, and keeps the best attempt", async () => {
    await upToOutline();
    const scores = [4, 6, 5];
    let n = 0;
    llm = fakeLlm(
      handlers({
        write_slide: (req) => ({ html: slideHtml(slideOf(req), `round${++n}`), steps: 2, summary: "Built." }),
        review_slide: (_req, k) => review("fix", scores[k - 1]),
      }),
    );
    const summary = await runStage(project, "build", { ...opts(), concurrency: 1 });

    const s01 = summary!.slides[0]!;
    expect(s01.rounds.map((r) => [r.round, r.model, r.escalated ?? false])).toEqual([
      [1, MODELS.sonnet, false],
      [2, MODELS.sonnet, false],
      [3, MODELS.opus, true],
    ]);
    expect(s01).toMatchObject({ verdict: "fix", bestRound: 2, score: 6 });
    expect(readFileSync(join(project.dir, "slides/s01.html"), "utf8")).toContain("round2");
    expect(readFileSync(join(project.dir, "versions/1/deck.html"), "utf8")).toContain("round2");
    expect(events).toContainEqual({ type: "slide:escalate", id: "s01", round: 3, model: MODELS.opus });
  });

  it("does not escalate when the final critique has no high-severity issue", async () => {
    await upToOutline();
    llm = fakeLlm(
      handlers({ review_slide: () => ({ ...review("fix", 6), issues: [{ severity: "medium", what: "Legend tight", where: "step 2", fix: "Add gap" }] }) }),
    );
    const summary = await runStage(project, "build", { ...opts(), maxRounds: 2 });
    expect(summary!.slides.map((s) => s.rounds.length)).toEqual([2, 2]);
    expect(events.some((e) => e.type === "slide:escalate")).toBe(false);
  });

  it("sends bundle-time contract errors straight back to the builder", async () => {
    await upToOutline();
    let failed = false;
    engine = fakeEngine({
      bundleError: (f) => (f.includes("/s01/r1/") && !failed ? ((failed = true), new ContractError(["s01: selector \".x\" must start with \"#s01\""])) : undefined),
    });
    const summary = await runStage(project, "build", opts());
    expect(summary!.slides[0]!.rounds[0]!.error).toMatch(/slide contract violations/);
    expect(summary!.slides[0]).toMatchObject({ verdict: "pass", bestRound: 2 });
    const second = llm.requests.filter((r) => toolOf(r) === "write_slide" && slideOf(r) === "s01")[1]!;
    const texts = second.messages[0]!.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
    expect(texts).toContain('- [high] s01: selector ".x" must start with "#s01" (where: slide source)');
  });

  it("sends the critic at most 4 steps (first and last included) and the builder runs without thinking", async () => {
    engine = fakeEngine({ steps: 6 });
    await runAll(project, { auto: true, ...opts() });
    const review = llm.requests.find((r) => toolOf(r) === "review_slide")!;
    const labels = review.messages[0]!.content.flatMap((c) => (c.type === "text" && /^Step \d/.test(c.text) ? [c.text] : []));
    expect(labels).toEqual(["Step 1 of 6:", "Step 3 of 6:", "Step 4 of 6:", "Step 6 of 6:"]);
    expect(llm.requests.find((r) => toolOf(r) === "write_slide")!.thinking).toEqual({ type: "between_tools" });
    expect(review.thinking).toBeUndefined();
  });

  it("turns console errors into a fix even when the critic says pass", async () => {
    engine = fakeEngine({ errors: (f) => (f.includes("/r1/") ? ["TypeError: x is undefined"] : []) });
    await runAll(project, { auto: true, ...opts() });
    const build = JSON.parse(readFileSync(join(project.dir, "build.json"), "utf8"));
    expect(build.slides[0].rounds.map((r: { verdict: string }) => r.verdict)).toEqual(["fix", "pass"]);
  });

  it("uses a placeholder when every round fails to build", async () => {
    llm = fakeLlm(handlers({ write_slide: () => ({ html: "<div>nope</div>".repeat(30), steps: 1, summary: "x" }) }));
    const summary = (await runAll(project, { auto: true, ...opts() })).build!;
    expect(summary.slides[0]).toMatchObject({ verdict: "failed", score: 0 });
    expect(summary.slides[0]!.rounds).toHaveLength(2);
    expect(summary.slides[0]!.rounds.every((r) => r.error)).toBe(true);
    expect(readFileSync(join(project.dir, "slides/s01.html"), "utf8")).toContain('class="df-slide" id="s01"');
  });
});

describe("reviseSlide and versions", () => {
  it("rebuilds one slide from an instruction, re-runs the critique and saves a new version", async () => {
    await runAll(project, { auto: true, ...opts() });
    llm = fakeLlm(handlers({ write_slide: (req) => ({ html: slideHtml(slideOf(req), "bigger"), steps: 2, summary: "Revised." }) }));
    const result = await reviseSlide(project, "s02", "Make the earbud twice as big", opts());

    expect(result).toMatchObject({ version: 2, build: { verdict: "pass" } });
    const req = llm.requests.find((r) => toolOf(r) === "write_slide")!;
    expect(slideOf(req)).toBe("s02");
    expect(JSON.stringify(req.messages[0])).toMatch(/presenter asked for this change.*Make the earbud twice as big/);
    expect(JSON.stringify(req.messages[0])).toMatch(/Current version:/);
    expect(JSON.stringify(llm.requests.find((r) => toolOf(r) === "review_slide")!.messages[0])).toMatch(/Make the earbud twice as big/);
    expect(readFileSync(join(project.dir, "slides/s02.html"), "utf8")).toContain("bigger");
    expect(existsSync(join(project.dir, "shots/s02/rev1/r1/step-0.png"))).toBe(true);

    const versions = listVersions(project);
    expect(versions.map((v) => [v.version, v.kind, v.slideId])).toEqual([
      [1, "build", undefined],
      [2, "revise", "s02"],
    ]);
    expect(readFileSync(versions[1]!.file, "utf8")).toContain("bigger");
    expect(JSON.parse(readFileSync(join(project.dir, "build.json"), "utf8")).version).toBe(2);
  });

  it("refuses to revise before a build", async () => {
    await expect(reviseSlide(project, "s01", "x", opts())).rejects.toThrow(/run the build stage first/);
  });
});

describe("the outline respects the style", () => {
  it("sends an arc with a 3D slide back when 3D is off", async () => {
    llm = fakeLlm(
      handlers({ recommend_style: () => ({ ...styleOut(), use3d: false }), plan_arc: (_req, n) => (n === 1 ? arcOut(["3d-object", "simulation"]) : arcOut()) }),
    );
    await upToOutline();
    expect(llm.calls.plan_arc).toBe(2);
    const retry = llm.requests.filter((r) => toolOf(r) === "plan_arc")[1]!;
    expect(JSON.stringify(retry.messages.at(-1))).toMatch(/s01: 3D is off for this deck/);
  });

  it("sends a card back when its simulation slide has no simulation spec", async () => {
    let s02 = 0;
    llm = fakeLlm(handlers({ write_card: (req) => (cardOf(req) === "s02" && ++s02 === 1 ? cardOut("s02", { simulation: undefined }) : cardOut(cardOf(req))) }));
    await upToOutline();
    expect(llm.calls.write_card).toBe(3);
    expect(loadOutline(project).sections[1]!.slides[0]!.visual.simulation).toBeDefined();
  });
});
