import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createProject,
  projectStatus,
  runAll,
  runStage,
  StageError,
  type ForgeEvent,
  type PipelineContext,
  type Project,
} from "../src/pipeline/index.ts";
import type { WireRequest } from "../src/llm.ts";
import {
  fakeEngine,
  fakeLlm,
  outlineOut,
  researchOut,
  review,
  scriptOut,
  slideHtml,
  storyboardOut,
  styleOut,
  type FakeEngine,
  type FakeLlm,
  type Handler,
} from "./fakes.ts";

const IDS = ["s01", "s02"];
const slideOf = (req: WireRequest) => /Slide id: (s\d\d)|Slide (s\d\d)\./.exec(JSON.stringify(req.messages[0]))!.slice(1).find(Boolean)!;

function handlers(over: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    recommend_style: () => styleOut(),
    record_research: () => researchOut,
    plan_outline: () => outlineOut,
    write_script: () => scriptOut(IDS),
    write_storyboard: () => storyboardOut(IDS),
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
const ctx = (): PipelineContext => ({ llm, engine, onEvent: (e) => events.push(e), exemplars: [] });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "forge-"));
  project = createProject({ topic: "How active noise cancellation works", audience: "engineers", minutes: 8, root });
  events = [];
  llm = fakeLlm(handlers());
  engine = fakeEngine();
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("projects", () => {
  it("creates projects/<slug>/brief.json and de-duplicates slugs", () => {
    expect(project.slug).toBe("how-active-noise-cancellation-works");
    expect(JSON.parse(readFileSync(join(project.dir, "brief.json"), "utf8"))).toMatchObject({ minutes: 8, prefs: {} });
    expect(createProject({ topic: "How active noise cancellation works", audience: "x", minutes: 5, root }).slug).toBe(
      "how-active-noise-cancellation-works-2",
    );
  });
});

describe("stage ordering and invalidation", () => {
  it("refuses to run a stage before its predecessors", async () => {
    await expect(runStage(project, "outline", ctx())).rejects.toThrow(StageError);
    await expect(runStage(project, "outline", ctx())).rejects.toThrow("run style, research first");
  });

  it("runAll runs every stage in order and writes each stage's file", async () => {
    const { ran, build } = await runAll(project, { auto: true }, ctx());
    expect(ran).toEqual(["style", "research", "outline", "script", "storyboard", "build"]);
    expect(events.filter((e) => e.type === "stage:start").map((e) => (e as { stage: string }).stage)).toEqual(ran);
    expect(Object.values(projectStatus(project)).every(Boolean)).toBe(true);
    for (const f of ["style.json", "research.md", "outline.json", "script.json", "storyboard.json", "slides/s01.html", "slides/s02.html", "versions/1/deck.html"]) {
      expect(existsSync(join(project.dir, f)), f).toBe(true);
    }
    expect(build?.version).toBe(1);
    expect(JSON.parse(readFileSync(join(project.dir, "outline.json"), "utf8")).sections[1].slides[0]).toMatchObject({ id: "s02", budgetSec: 290 });
    const done = events.find((e) => e.type === "stage:done" && e.stage === "build") as Extract<ForgeEvent, { type: "stage:done" }>;
    expect(done.calls).toBe(4); // 2 slides × (builder + critic)
    expect(done.usage.input).toBe(400);
  });

  it("re-running a stage deletes every later stage's outputs but keeps earlier ones and versions", async () => {
    await runAll(project, { auto: true }, ctx());
    await runStage(project, "research", ctx());
    expect(projectStatus(project)).toEqual({ style: true, research: true, outline: false, script: false, storyboard: false, build: false });
    expect(existsSync(join(project.dir, "slides"))).toBe(false);
    expect(existsSync(join(project.dir, "versions/1/deck.html"))).toBe(true);
    const start = events.filter((e) => e.type === "stage:start").at(-1);
    expect(start).toEqual({ type: "stage:start", stage: "research", invalidated: ["outline", "script", "storyboard", "build"] });

    // runAll resumes from the first stage that isn't done; the next build is version 2.
    const { ran, build } = await runAll(project, { auto: true }, ctx());
    expect(ran).toEqual(["outline", "script", "storyboard", "build"]);
    expect(build?.version).toBe(2);
  });

  it("stops after a stage the approver rejects", async () => {
    const { ran } = await runAll(project, { auto: false, approve: async (s) => s !== "research" }, ctx());
    expect(ran).toEqual(["style", "research"]);
  });
});

describe("build fix loop", () => {
  it("feeds the critic's issues back to the builder and stops on pass", async () => {
    llm = fakeLlm(
      handlers({
        write_slide: (req) => ({ html: slideHtml(slideOf(req), `v${llm.calls.write_slide}`), steps: 2, summary: "Built." }),
        review_slide: (req) => (slideOf(req) === "s01" && llm.requests.filter((r) => r.tools?.[0]?.name === "review_slide" && slideOf(r) === "s01").length === 1 ? review("fix") : review("pass")),
      }),
    );
    await runAll(project, { auto: true, to: "storyboard" }, ctx());
    const summary = await runStage(project, "build", { ...ctx(), concurrency: 1 });

    const s01 = summary!.slides[0]!;
    expect(s01).toMatchObject({ id: "s01", verdict: "pass", bestRound: 2 });
    expect(s01.rounds).toHaveLength(2);
    expect(summary!.slides[1]!.rounds).toHaveLength(1);

    const builderCalls = llm.requests.filter((r) => r.tools?.[0]?.name === "write_slide" && slideOf(r) === "s01");
    expect(builderCalls).toHaveLength(2);
    const revision = JSON.stringify(builderCalls[1]!.messages[0]);
    expect(revision).toMatch(/This is a revision/);
    expect(revision).toMatch(/\[high\] Title clipped \(where: step 1, top\)\. Fix: Reduce to 64px/);
    expect(builderCalls[1]!.messages[0]!.content.some((c) => c.type === "image")).toBe(true);

    expect(existsSync(join(project.dir, "shots/s01/r1/step-0.png"))).toBe(true);
    expect(existsSync(join(project.dir, "shots/s01/r2/step-1.png"))).toBe(true);
    expect(events.filter((e) => e.type === "slide:verdict").map((e) => `${(e as { id: string }).id}:${(e as { verdict: string }).verdict}`)).toEqual(
      expect.arrayContaining(["s01:fix", "s01:pass", "s02:pass"]),
    );
  });

  it("stops after 3 rounds and keeps the best-scoring attempt", async () => {
    const scores = [4, 6, 5];
    llm = fakeLlm(
      handlers({
        write_slide: (req) => ({ html: slideHtml(slideOf(req), `round${llm.calls.write_slide}`), steps: 2, summary: "Built." }),
        review_slide: (_req, n) => review("fix", scores[n - 1]),
      }),
    );
    await runAll(project, { auto: true, to: "storyboard" }, ctx());
    events = [];
    const summary = await runStage(project, "build", { ...ctx(), concurrency: 1, llm: llmForOneSlide(llm) });

    const s01 = summary!.slides[0]!;
    expect(s01.rounds).toHaveLength(3);
    expect(s01).toMatchObject({ verdict: "fix", bestRound: 2, score: 6 });
    expect(readFileSync(join(project.dir, "slides/s01.html"), "utf8")).toContain("round2");
    expect(llm.calls.review_slide).toBeGreaterThanOrEqual(3);
    expect(readFileSync(join(project.dir, "versions/1/deck.html"), "utf8")).toContain("round2");
  });

  it("turns console errors into a fix even when the critic says pass", async () => {
    engine = fakeEngine({ errors: (f) => (f.includes("/r1/") ? ["TypeError: x is undefined"] : []) });
    await runAll(project, { auto: true }, ctx());
    const build = JSON.parse(readFileSync(join(project.dir, "build.json"), "utf8"));
    expect(build.slides[0].rounds.map((r: { verdict: string }) => r.verdict)).toEqual(["fix", "pass"]);
  });

  it("uses a placeholder when every round fails to build", async () => {
    llm = fakeLlm(handlers({ write_slide: () => ({ html: "<div>nope</div>".repeat(30), steps: 1, summary: "x" }) }));
    const summary = (await runAll(project, { auto: true }, ctx())).build!;
    expect(summary.slides[0]).toMatchObject({ verdict: "failed", score: 0 });
    expect(summary.slides[0]!.rounds.every((r) => r.error)).toBe(true);
    expect(readFileSync(join(project.dir, "slides/s01.html"), "utf8")).toContain('class="df-slide" id="s01"');
  });
});

describe("storyboard respects the style", () => {
  it("sends a 3D slide back when 3D is off", async () => {
    // The retry switches to simulations (which need a simulation spec).
    const sb = storyboardOut(IDS, "simulation");
    for (const s of sb.slides) Object.assign(s, { simulation: { model: "phase sum", controls: ["phase"], readouts: ["residual dB"] } });
    llm = fakeLlm(
      handlers({ recommend_style: () => ({ ...styleOut(), use3d: false }), write_storyboard: (_req, n) => (n === 1 ? storyboardOut(IDS, "3d-object") : sb) }),
    );
    await runAll(project, { auto: true, to: "storyboard" }, ctx());
    expect(llm.calls.write_storyboard).toBe(2);
    expect(JSON.stringify(llm.requests.at(-1)!.messages.at(-1))).toMatch(/s01: 3D is off for this deck/);
  });
});

/** Only s01 goes through the scripted critic sequence; s02 always passes, so call counts stay predictable. */
function llmForOneSlide(inner: FakeLlm): FakeLlm {
  const passer = fakeLlm(handlers());
  return Object.assign(
    {
      callTool: ((opts) => (opts.label.endsWith("s02") ? passer.callTool(opts) : inner.callTool(opts))) as FakeLlm["callTool"],
      callText: inner.callText,
    },
    { requests: inner.requests, calls: inner.calls },
  );
}
