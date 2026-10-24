// The build stage's cost levers: patch-style fix rounds, escalation conditions, cache placement, thinking on the wire,
// exemplar trimming and the critic's stop rule. Fakes only (no proxy).
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyEdits, builderSchema } from "../src/agents/builder.ts";
import { onlyNits, rankIssues, sampleSteps, settle } from "../src/agents/critic.ts";
import { loadExemplars, MAX_EXEMPLAR_CHARS, pickExemplars, trimExemplar } from "../src/agents/exemplars.ts";
import type { Issue } from "../src/agents/schemas.ts";
import type { Finding } from "../src/contract.ts";
import { createLlm, MODELS, wireThinking, type WireRequest, type WireResponse } from "../src/llm.ts";
import { createProject, runAll, runStage, type ForgeEvent, type PipelineOptions, type Project } from "../src/pipeline/index.ts";
import { arcOut, cardOut, fakeEngine, fakeLlm, researchOut, review, slideHtml, styleOut, type FakeEngine, type FakeLlm, type Handler } from "./fakes.ts";

const slideOf = (req: WireRequest) => /Slide id: (s\d\d)|Slide (s\d\d)\./.exec(JSON.stringify(req.messages[0]))!.slice(1).find(Boolean)!;
const cardOf = (req: WireRequest) => /Write the card for (s\d\d)/.exec(JSON.stringify(req.messages[0]))![1]!;
const toolOf = (req: WireRequest) => req.tools?.[0]?.name;
const texts = (req: WireRequest) => req.messages[0]!.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
const asksForEdits = (req: WireRequest) => texts(req).includes("Answer with `edits`");
const systemOf = (req: WireRequest) => req.system as { type: "text"; text: string; cache_control?: unknown }[];

function handlers(over: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    recommend_style: () => styleOut(),
    record_research: () => researchOut,
    plan_arc: () => arcOut(),
    write_card: (req) => cardOut(cardOf(req)),
    write_slide: (req) => ({ html: slideHtml(slideOf(req), "v1"), steps: 2, summary: "Built." }),
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
const builderCalls = (id = "s01") => llm.requests.filter((r) => toolOf(r) === "write_slide" && slideOf(r) === id);
const firstFixThenPass = () => {
  let n = 0;
  return (req: WireRequest) => (slideOf(req) === "s01" && ++n === 1 ? review("fix") : review("pass"));
};

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "forge-eff-"));
  project = createProject({ topic: "How active noise cancellation works", audience: "engineers", minutes: 8, root });
  events = [];
  llm = fakeLlm(handlers());
  engine = fakeEngine();
  await runAll(project, { auto: true, to: "outline", ...opts() });
  events = [];
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("applyEdits and the write_slide schema", () => {
  const html = slideHtml("s01", "v1");

  it("applies search/replace edits in order", () => {
    const r = applyEdits(html, [
      { find: "Title v1", replace: "Title v2" },
      { find: "72px", replace: "64px" },
    ]);
    expect(r.errors).toEqual([]);
    expect(r.html).toContain("Title v2");
    expect(r.html).toContain("font:600 64px");
  });

  it("fails safely on a find that is missing or not unique, changing nothing", () => {
    expect(applyEdits(html, [{ find: "nope", replace: "x" }]).errors[0]).toMatch(/does not occur/);
    expect(applyEdits(html, [{ find: "s01", replace: "x" }]).errors[0]).toMatch(/more than once/);
  });

  it("accepts edits only on a revision, and only when the result still passes the contract", () => {
    const base = { steps: 2, summary: "s" };
    const patch = builderSchema("s01", html);
    expect(patch.parse({ ...base, edits: [{ find: "Title v1", replace: "Title v2" }] })).toMatchObject({ html: expect.stringContaining("Title v2"), edits: 1 });
    expect(patch.safeParse({ ...base, edits: [{ find: "nope", replace: "x" }] }).success).toBe(false);
    // An edit that breaks the contract (a selector outside #s01) is refused.
    expect(patch.safeParse({ ...base, edits: [{ find: "#s01 h1{", replace: ".x h1{" }] }).success).toBe(false);
    expect(patch.safeParse({ ...base, html, edits: [{ find: "Title v1", replace: "x" }] }).success).toBe(false);
    // A draft (no previous version) must be full HTML.
    expect(builderSchema("s01").safeParse({ ...base, edits: [{ find: "Title v1", replace: "x" }] }).success).toBe(false);
    expect(builderSchema("s01").parse({ ...base, html })).toMatchObject({ html, edits: 0 });
  });
});

describe("patch-style fix rounds", () => {
  it("answers a critic's issues with edits on the previous version", async () => {
    llm = fakeLlm(
      handlers({
        write_slide: (req) => (asksForEdits(req) ? { edits: [{ find: "Title v1", replace: "Title patched" }], steps: 2, summary: "Patched." } : handlers().write_slide!(req, 0)),
        review_slide: firstFixThenPass(),
      }),
    );
    const summary = await runStage(project, "build", { ...opts(), concurrency: 1 });
    const s01 = summary!.slides[0]!;
    expect(s01).toMatchObject({ verdict: "pass", bestRound: 2 });
    expect(s01.rounds.map((r) => [r.mode, r.edits])).toEqual([
      ["draft", undefined],
      ["patch", 1],
    ]);
    expect(builderCalls()).toHaveLength(2);
    const fix = texts(builderCalls()[1]!);
    expect(fix).toContain("The reviewer scored this version 5/10. Change as little as possible");
    expect(readFileSync(join(project.dir, "slides/s01.html"), "utf8")).toContain("Title patched");
    expect(events).toContainEqual({ type: "slide:patch", id: "s01", round: 2, applied: true, edits: 1 });
    expect(events).toContainEqual(expect.objectContaining({ type: "slide:round", id: "s01", round: 2, phase: "build", mode: "patch" }));
  });

  it("falls back to a full rewrite in the same round when the edits don't apply", async () => {
    llm = fakeLlm(
      handlers({
        write_slide: (req) =>
          asksForEdits(req) ? { edits: [{ find: "not in the slide", replace: "x" }], steps: 2, summary: "Bad patch." } : { html: slideHtml(slideOf(req), `call${builderCalls(slideOf(req)).length}`), steps: 2, summary: "Built." },
        review_slide: firstFixThenPass(),
      }),
    );
    const summary = await runStage(project, "build", { ...opts(), concurrency: 1 });
    const s01 = summary!.slides[0]!;
    // Round 2: the patch call (and its corrective retry) failed, then one rewrite call.
    expect(s01.rounds).toHaveLength(2);
    expect(s01.rounds[1]).toMatchObject({ mode: "rewrite", verdict: "pass", patchError: expect.stringMatching(/does not occur/) });
    expect(builderCalls().map(asksForEdits)).toEqual([false, true, true, false]);
    expect(texts(builderCalls()[3]!)).toContain("Return the complete revised fragment in `html`");
    expect(events).toContainEqual(expect.objectContaining({ type: "slide:patch", id: "s01", round: 2, applied: false }));
    expect(readFileSync(join(project.dir, "slides/s01.html"), "utf8")).toContain("call4");
  });

  it("drops edits whose result measures worse than the version they revise", async () => {
    const clipped: Finding = {
      kind: "clipped-text",
      severity: "error",
      step: 0,
      selector: "#s01 h1",
      detail: "text cut off",
      measured: { overflowPx: 10, side: "bottom", container: "#s01", containerW: 100, containerH: 10, lines: 1, hiddenLines: 0 },
    };
    // The patched slide (Title patched) clips; the rewrite doesn't.
    engine = fakeEngine({ findings: (f) => (readFileSync(f, "utf8").includes("Title patched") ? [clipped] : []) });
    llm = fakeLlm(
      handlers({
        write_slide: (req) =>
          asksForEdits(req)
            ? { edits: [{ find: "Title v1", replace: "Title patched" }], steps: 2, summary: "Patched." }
            : { html: slideHtml(slideOf(req), texts(req).includes("This is a revision") ? "rewritten" : "v1"), steps: 2, summary: "Built." },
        review_slide: firstFixThenPass(),
      }),
    );
    const summary = await runStage(project, "build", { ...opts(), concurrency: 1 });
    expect(summary!.slides[0]!.rounds[1]).toMatchObject({ mode: "rewrite", verdict: "pass", patchError: expect.stringMatching(/pre-check got worse \(0 → 1/) });
    expect(readFileSync(join(project.dir, "slides/s01.html"), "utf8")).toContain("rewritten");
  });

  it("can be switched off: every fix round is a full rewrite", async () => {
    llm = fakeLlm(handlers({ review_slide: firstFixThenPass() }));
    const summary = await runStage(project, "build", { ...opts(), concurrency: 1, patchFixes: false });
    expect(summary!.slides[0]!.rounds.map((r) => r.mode)).toEqual(["draft", "rewrite"]);
    expect(builderCalls().map(asksForEdits)).toEqual([false, false]);
  });
});

describe("escalation and the stop rule", () => {
  const issue = (severity: Issue["severity"]): Issue => ({ severity, what: `${severity} thing`, where: "step 1, #s01 h1", fix: "Do it" });

  it("is off by default", async () => {
    llm = fakeLlm(handlers({ review_slide: () => review("fix", 4) }));
    const summary = await runStage(project, "build", opts());
    expect(summary!.slides.map((s) => s.rounds.length)).toEqual([2, 2]);
    expect(events.some((e) => e.type === "slide:escalate")).toBe(false);
  });

  it("when on, escalates only below escalateBelowScore", async () => {
    llm = fakeLlm(handlers({ review_slide: (req) => ({ ...review("fix", slideOf(req) === "s01" ? 7.5 : 5), issues: [issue("high")] }) }));
    await runStage(project, "build", { ...opts(), escalate: true });
    expect(events.filter((e) => e.type === "slide:escalate").map((e) => (e as { id: string }).id)).toEqual(["s02"]);
  });

  it("stops when only low-severity issues are left, but not on medium ones", async () => {
    llm = fakeLlm(handlers({ review_slide: (req) => ({ ...review("fix", 6), issues: [issue(slideOf(req) === "s01" ? "low" : "medium")] }) }));
    const summary = await runStage(project, "build", opts());
    expect(summary!.slides.map((s) => [s.id, s.rounds.length])).toEqual([
      ["s01", 1],
      ["s02", 2],
    ]);
  });

  it("decides the verdict from the score and severities, and keeps at most 5 issues, most severe first", () => {
    const r = { verdict: "fix" as const, score: 7, summary: "", issues: [issue("low"), issue("medium")] };
    expect(settle(r, 0).verdict).toBe("pass");
    expect(settle(r, 1).verdict).toBe("fix");
    expect(settle({ ...r, verdict: "pass", score: 6.5 }, 0).verdict).toBe("fix");
    expect(settle({ ...r, issues: [issue("high")] }, 0).verdict).toBe("fix");
    const many = [issue("low"), issue("medium"), issue("high"), issue("low"), issue("medium"), issue("high"), issue("low")];
    expect(rankIssues(many).map((i) => i.severity)).toEqual(["high", "high", "medium", "medium", "low"]);
    expect(settle({ ...r, issues: many }, 0).issues).toHaveLength(5);
    expect(onlyNits({ ...r, issues: [issue("low")] }, 0)).toBe(true);
    expect(onlyNits({ ...r, issues: [issue("low")] }, 1)).toBe(false);
    expect(sampleSteps([0, 1, 2, 3, 4, 5])).toEqual([0, 3, 5]);
  });
});

describe("prompt caching", () => {
  it("never caches the whole request; only system blocks marked for it", async () => {
    const seen: WireRequest[] = [];
    const reply: WireResponse = { content: [{ type: "tool_use", id: "t", name: "answer", input: { ok: true } }], stop_reason: "tool_use", usage: { input_tokens: 1, output_tokens: 1 } };
    const l = createLlm({ transport: async (req) => (seen.push(req), reply) });
    const { z } = await import("zod");
    const tool = { name: "answer", description: "d", schema: z.object({ ok: z.boolean() }) };
    await l.callTool({ label: "a", model: MODELS.sonnet, system: "plain", user: "u", tool });
    await l.callTool({ label: "b", model: MODELS.sonnet, system: [{ text: "stable", cache: true }, { text: "varies" }], user: "u", tool });
    expect(seen.every((r) => !("cache_control" in r))).toBe(true);
    expect(typeof seen[0]!.system).toBe("string");
    expect(seen[1]!.system).toEqual([
      { type: "text", text: "stable", cache_control: { type: "ephemeral" } },
      { type: "text", text: "varies" },
      { type: "text", text: "Respond only by calling the `answer` tool, exactly once, with no other text." },
    ]);
  });

  it("gives every builder call the same static and deck blocks, warmed once before the slides fan out", async () => {
    llm = fakeLlm(handlers({ review_slide: firstFixThenPass() }));
    await runStage(project, "build", { ...opts(), exemplars: loadExemplars() });
    const calls = llm.requests.filter((r) => toolOf(r) === "write_slide");
    expect(calls.length).toBe(3); // s01 draft + fix, s02 draft
    const blocks = calls.map(systemOf);
    for (const b of blocks) expect(b.slice(0, 3).map((x) => x.cache_control)).toEqual([{ type: "ephemeral" }, { type: "ephemeral" }, { type: "ephemeral" }]);
    // Static rules (block 0) and deck brief (block 1) are byte-identical across slides and rounds.
    expect(new Set(blocks.map((b) => b[0]!.text)).size).toBe(1);
    expect(new Set(blocks.map((b) => b[1]!.text)).size).toBe(1);
    expect(blocks[0]![1]!.text).toContain("Theme tokens");
    // The slide block (techniques + exemplars) is the same for both rounds of s01.
    const s01 = calls.filter((r) => slideOf(r) === "s01").map((r) => systemOf(r)[2]!.text);
    expect(s01[0]).toBe(s01[1]);
    // Tools are part of the prefix: identical for drafts and fixes.
    expect(new Set(calls.map((r) => JSON.stringify(r.tools))).size).toBe(1);
    // The warm-up: same model, tools and thinking, and the first two system blocks.
    expect(llm.warms).toHaveLength(1);
    const warm = llm.warms[0]!;
    expect(warm.max_tokens).toBe(0);
    expect([warm.model, JSON.stringify(warm.tools), warm.thinking]).toEqual([calls[0]!.model, JSON.stringify(calls[0]!.tools), calls[0]!.thinking]);
    expect(systemOf(warm).slice(0, 2)).toEqual(blocks[0]!.slice(0, 2));
    // The builder's user message: the hard checks first, compact spec without ids, timing or rationale.
    const user = texts(calls[0]!);
    expect(user.startsWith("Hard checks on the rendered page")).toBe(true);
    expect(user).not.toContain('"why"');
    expect(user).not.toContain('"budgetSec"');
  });

  it("skips the warm-up for a single slide at a time", async () => {
    await runStage(project, "build", { ...opts(), concurrency: 1 });
    expect(llm.warms).toHaveLength(0);
  });
});

describe("thinking on the wire", () => {
  it("is off by default: between_tools on Sonnet, low effort on Opus; 'model' sends nothing", () => {
    expect(wireThinking(MODELS.sonnet)).toEqual({ thinking: { type: "between_tools" } });
    expect(wireThinking(MODELS.opus)).toEqual({ output_config: { effort: "low" } });
    expect(wireThinking(MODELS.opus, "model")).toEqual({});
  });
});

describe("exemplar diet", () => {
  it("picks at most 2 exemplars and trims every library exemplar to the cap, keeping the setup and the lifecycle", () => {
    const all = loadExemplars();
    expect(pickExemplars(all, { explainer: "simulation", technique: "parametric-sim" }).length).toBeLessThanOrEqual(2);
    for (const e of all) {
      const t = trimExemplar(e.html);
      expect(t.length, e.id).toBeLessThanOrEqual(MAX_EXEMPLAR_CHARS);
      expect(t, e.id).toMatch(/<section class="df-slide"/);
      expect(t, e.id).toContain("DF.slide(");
      expect(t.trimEnd().endsWith("</script>"), e.id).toBe(true);
      expect(t, e.id).toMatch(/<aside class="df-notes"><p>…<\/p><\/aside>/);
    }
    const long = all.find((e) => e.html.length > 2 * MAX_EXEMPLAR_CHARS)!;
    expect(trimExemplar(long.html)).toMatch(/\/\* … \d+ lines elided … \*\//);
  });

  it("leaves a short exemplar whole (minus notes and comments)", () => {
    const html = `<section class="df-slide" id="s01"><!-- hi --><aside class="df-notes"><p>Say a lot.</p></aside></section>\n<style>/* c */#s01{}</style>`;
    expect(trimExemplar(html)).toBe(`<section class="df-slide" id="s01"><aside class="df-notes"><p>…</p></aside></section>\n<style>#s01{}</style>`);
  });
});
