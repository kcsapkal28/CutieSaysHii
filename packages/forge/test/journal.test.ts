import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MODELS, type WireRequest } from "../src/llm.ts";
import { costUsd } from "../src/pricing.ts";
import { compact, journaled, readJournal, summarizeRun, summarizeRuns, formatRun, type JournalLine } from "../src/pipeline/journal.ts";
import { createProject, reviseSlide, runAll, type ForgeEvent, type Project } from "../src/pipeline/index.ts";
import { aggregate, compareResults, loadTopics, metricsOf, runEval, topicResult, type EvalTopic } from "../src/eval.ts";
import { fakeEngine, fakeLlm, outlineOut, researchOut, review, slideHtml, storyboardOut, styleOut, type Handler } from "./fakes.ts";

const slideOf = (req: WireRequest) => /Slide id: (s\d\d)|Slide (s\d\d)\./.exec(JSON.stringify(req.messages[0]))!.slice(1).find(Boolean)!;
/** The slide ids the request's outline/script carries, so a capped outline gets a matching script and storyboard. */
const idsOf = (req: WireRequest) => [...new Set(JSON.stringify(req.messages[0]).match(/(?<=\\"id\\": \\")s\d\d/g) ?? [])];

function handlers(over: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    recommend_style: () => styleOut(),
    record_research: () => researchOut,
    plan_outline: () => outlineOut,
    write_script: (req) => ({ slides: idsOf(req).map((id) => ({ id, title: `Claim for ${id}`, callouts: [], notes: "Say this.", budgetSec: 60 })) }),
    write_storyboard: (req) => storyboardOut(idsOf(req)),
    write_slide: (req) => ({ html: slideHtml(slideOf(req)), steps: 2, summary: "Built." }),
    review_slide: () => review("pass"),
    ...over,
  };
}

let root: string;
let project: Project;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "forge-journal-"));
  project = createProject({ topic: "How tides work", audience: "students", minutes: 5, root });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const journal = () => readJournal(join(project.dir, "log.jsonl"));

describe("run journal", () => {
  it("appends every event of a run, with one run id and an ISO time on every line", async () => {
    let s01 = 0;
    const llm = fakeLlm(handlers({ review_slide: (req) => (slideOf(req) === "s01" && ++s01 === 1 ? review("fix") : review("pass")) }));
    const events: ForgeEvent[] = [];
    await runAll(project, { auto: true, llm, engine: fakeEngine(), exemplars: [], concurrency: 1, onEvent: (e) => events.push(e) });

    const lines = journal();
    expect(lines).toHaveLength(events.length);
    expect(new Set(lines.map((l) => l.run)).size).toBe(1);
    expect(lines.every((l) => !Number.isNaN(Date.parse(l.at)) && l.at.endsWith("Z"))).toBe(true);
    expect(new Set(lines.map((l) => l.type))).toEqual(
      new Set(["stage:start", "stage:done", "usage", "slide:round", "slide:shots", "slide:verdict", "slide:done", "deck:done"]),
    );
    const usage = lines.find((l) => l.type === "usage" && String(l.label).startsWith("builder"))!;
    expect(usage).toMatchObject({ stage: "build", label: "builder:s01", model: MODELS.sonnet, usage: { input: 100, output: 10, cacheRead: 0, cacheWrite: 0 } });
    expect(typeof usage.ms).toBe("number");
    // Bulky path arrays become counts; the deck path stays.
    expect(lines.find((l) => l.type === "slide:shots")).toMatchObject({ files: 2 });
    expect(lines.find((l) => l.type === "deck:done")!.file).toMatch(/versions\/1\/deck\.html$/);
    expect(lines.filter((l) => l.type === "slide:verdict").map((l) => `${l.id}:r${l.round}:${l.verdict}`)).toEqual(["s01:r1:fix", "s01:r2:pass", "s02:r1:pass"]);
    // No prompt text reaches the journal.
    expect(readFileSync(join(project.dir, "log.jsonl"), "utf8")).not.toMatch(/Topic: How tides work|"system"/);
  });

  it("journals a slide revision as its own run", async () => {
    const llm = fakeLlm(handlers());
    await runAll(project, { auto: true, llm, engine: fakeEngine(), exemplars: [] });
    await reviseSlide(project, "s02", "Make the moon bigger", { llm, engine: fakeEngine(), exemplars: [] });
    const runs = summarizeRuns(journal());
    expect(runs).toHaveLength(2);
    const lines = journal().filter((l) => l.run === runs[1]!.run);
    expect(lines[0]).toMatchObject({ type: "revise:start", slideId: "s02", instructionChars: 20 });
    expect(lines.at(-1)).toMatchObject({ type: "revise:done", slideId: "s02", verdict: "pass", version: 2 });
    expect(lines.some((l) => l.type === "usage" && l.stage === "revise")).toBe(true);
    expect(JSON.stringify(lines)).not.toContain("Make the moon bigger");
    expect(runs[1]!.stages).toEqual([expect.objectContaining({ stage: "revise", status: "done", calls: 2 })]);
  });

  it("writes event types it has never seen, compacted, and never breaks the run when the write fails", () => {
    const file = join(project.dir, "log.jsonl");
    const seen: unknown[] = [];
    const j = journaled(file, (e) => seen.push(e), "run-1");
    const future = { type: "slide:precheck", id: "s01", round: 1, failures: ["overflow"], shots: ["/a/b.png", "/a/c.png"], detail: { apiKey: "k", px: 3 } };
    (j.onEvent as (e: unknown) => void)(future);
    expect(seen).toEqual([future]);
    expect(journal()[0]).toMatchObject({ run: "run-1", type: "slide:precheck", failures: ["overflow"], shots: 2, detail: { px: 3 } });
    expect(journal()[0]!.detail).not.toHaveProperty("apiKey");

    const broken = journaled(join(root, "missing-dir", "log.jsonl"), (e) => seen.push(e));
    expect(() => broken.onEvent({ type: "deck:done", version: 1, file: "x" })).not.toThrow();
    expect(seen).toHaveLength(2);
  });

  it("drops secret-looking keys, redacts the API key inside strings and cuts long strings", () => {
    vi.stubEnv("LLM_API_KEY", "sk-test-1234567890");
    try {
      const out = compact({ error: "401 for key sk-test-1234567890", prompt: "p", system: "s", env: { A: 1 }, long: "x".repeat(900), png: Buffer.from("x") }) as Record<string, unknown>;
      expect(out).toEqual({ error: "401 for key [redacted]", long: `${"x".repeat(500)}…` });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

// ---- summary maths ----

const at = (s: number) => new Date(Date.UTC(2026, 9, 24, 12, 0, s)).toISOString();
const M = 1_000_000;
const usageLine = (s: number, stage: string, label: string, model: string, u: Partial<Record<"input" | "output" | "cacheRead" | "cacheWrite", number>>, ms = 1000): JournalLine => ({
  at: at(s),
  run: "r",
  type: "usage",
  stage,
  label,
  model,
  ms,
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, ...u },
});

describe("journal summary", () => {
  const lines: JournalLine[] = [
    { at: at(0), run: "r", type: "stage:start", stage: "storyboard", invalidated: [] },
    usageLine(1, "storyboard", "storyboarder", MODELS.opus, { input: M, output: M / 10 }),
    { at: at(2), run: "r", type: "stage:done", stage: "storyboard", ms: 2000, calls: 1 },
    { at: at(2), run: "r", type: "stage:start", stage: "build", invalidated: [] },
    { at: at(3), run: "r", type: "slide:round", id: "s01", round: 1, phase: "build" },
    usageLine(4, "build", "builder:s01", MODELS.sonnet, { input: M, cacheRead: M }),
    usageLine(5, "build", "critic:s01", MODELS.opus, { output: M / 100 }),
    { at: at(5), run: "r", type: "slide:verdict", id: "s01", round: 1, verdict: "fix", score: 5, issues: 2, errors: 0 },
    { at: at(6), run: "r", type: "slide:round", id: "s01", round: 2, phase: "build" },
    { at: at(7), run: "r", type: "slide:error", id: "s01", round: 2, error: "boom" },
    { at: at(7), run: "r", type: "slide:escalate", id: "s01", round: 3, model: MODELS.opus },
    { at: at(8), run: "r", type: "slide:round", id: "s01", round: 3, phase: "build" },
    usageLine(9, "build", "builder:s01", MODELS.opus, { output: M / 100 }),
    { at: at(9), run: "r", type: "slide:verdict", id: "s01", round: 3, verdict: "pass", score: 8, issues: 0, errors: 0 },
    { at: at(13), run: "r", type: "slide:done", id: "s01", bestRound: 3, rounds: 3, verdict: "pass", score: 8 },
    { at: at(4), run: "r", type: "slide:round", id: "s02", round: 1, phase: "build" },
    { at: at(6), run: "r", type: "slide:verdict", id: "s02", round: 1, verdict: "pass", score: 9, issues: 0, errors: 0 },
    { at: at(6), run: "r", type: "slide:done", id: "s02", bestRound: 1, rounds: 1, verdict: "pass", score: 9 },
    { at: at(14), run: "r", type: "deck:done", version: 1, file: "/p/versions/1/deck.html" },
    { at: at(14), run: "r", type: "stage:done", stage: "build", ms: 12000, calls: 3 },
  ];

  it("totals time, calls, tokens and cost per stage and per agent", () => {
    const s = summarizeRun("r", lines);
    expect(s.ms).toBe(14000);
    expect(s.stages.map((r) => [r.stage, r.status, r.ms, r.calls])).toEqual([
      ["storyboard", "done", 2000, 1],
      ["build", "done", 12000, 3],
    ]);
    // Opus: $15/M in + $75/M out → 15 + 7.5. Sonnet: 3 + 0.3 (cache read at 10%). Opus critic and builder: 0.75 each.
    expect(s.stages[0]!.usd).toBeCloseTo(22.5);
    expect(s.stages[1]!.usd).toBeCloseTo(3.3 + 0.75 + 0.75);
    expect(s.total.usd).toBeCloseTo(22.5 + 4.8);
    expect(s.total.usage).toEqual({ input: 2 * M, output: M / 10 + 2 * (M / 100), cacheRead: M, cacheWrite: 0 });
    expect(Object.keys(s.agents).sort()).toEqual(["builder · opus", "builder · sonnet", "critic · opus", "storyboarder · opus"]);
    expect(s.agents["builder · sonnet"]).toMatchObject({ calls: 1, ms: 1000 });
    expect(costUsd(MODELS.sonnet, { input: 0, output: 0, cacheRead: 0, cacheWrite: M })).toBeCloseTo(3.75);
    expect(s.deckFile).toBe("/p/versions/1/deck.html");
  });

  it("gives each slide its rounds, verdicts, scores, escalation and time", () => {
    const [s01, s02] = summarizeRun("r", lines).slides;
    expect(s01).toEqual({
      id: "s01",
      verdicts: ["fix", "error", "pass"],
      scores: [5, null, 8],
      rounds: 3,
      firstPass: false,
      escalated: true,
      final: "pass",
      bestRound: 3,
      score: 8,
      ms: 10000,
    });
    expect(s02).toMatchObject({ verdicts: ["pass"], firstPass: true, escalated: false, rounds: 1, ms: 2000 });
    const text = formatRun(summarizeRun("r", lines));
    expect(text).toMatch(/^run r · started .* · 14\.0s · 4 calls · \$27\.30/);
    expect(text).toMatch(/s01\s+3\s+fix,error,pass\s+5,-,8\s+yes\s+pass\s+r3\s+8\s+10\.0s/);
  });

  it("groups lines by run and keeps old stage-only lines", () => {
    const old: JournalLine = { at: at(0), type: "stage:done", stage: "style", ms: 500, calls: 2, usage: { input: 10, output: 1, cacheRead: 0, cacheWrite: 0 } };
    const runs = summarizeRuns([old, ...lines]);
    expect(runs.map((r) => r.run)).toEqual(["-", "r"]);
    expect(runs[0]!.stages[0]).toMatchObject({ stage: "style", calls: 2, ms: 500, usage: { input: 10 } });
  });
});

// ---- eval ----

describe("forge eval", () => {
  const topics: EvalTopic[] = [
    { id: "tides", topic: "How tides work", audience: "students", minutes: 4, slides: 1 },
    { id: "rivers", topic: "How rivers carve canyons", audience: "hikers", minutes: 4, slides: 2 },
  ];

  it("ships four diverse topics with a slide cap", () => {
    const shipped = loadTopics();
    expect(shipped).toHaveLength(4);
    expect(new Set(shipped.map((t) => t.id)).size).toBe(4);
    expect(shipped.every((t) => t.slides <= 4 && t.audience && t.minutes)).toBe(true);
  });

  it("runs every topic through the pipeline in a scratch root and writes results.json and results.md", async () => {
    let reviews = 0;
    const llm = fakeLlm(handlers({ review_slide: () => (++reviews === 1 ? review("fix", 4) : review("pass", 8)) }));
    const out = join(root, "eval");
    const logs: string[] = [];
    const r = await runEval({ topics, label: "base", outDir: out, llm, engine: fakeEngine(), pipeline: { exemplars: [], concurrency: 1 }, log: (l) => logs.push(l) });

    expect(r.topics.map((t) => [t.id, t.metrics.slides])).toEqual([
      ["tides", 1],
      ["rivers", 2],
    ]);
    expect(r.topics[0]!.projectDir.startsWith(join(out, "base", "work", "projects"))).toBe(true);
    expect(existsSync(r.topics[0]!.deckFile!)).toBe(true);
    expect(r.topics[0]!.run.stages.map((s) => s.stage)).toEqual(["style", "research", "outline", "script", "storyboard", "build"]);
    expect(r.topics[0]!.metrics).toMatchObject({ firstPassRate: 0, roundsPerSlide: 2, scoreMean: 8, scoreMin: 8, fix: 0, failed: 0 });
    expect(r.overall.metrics).toMatchObject({ topics: 2, slides: 3, escalations: 0, errors: 0 });
    expect(r.overall.metrics.firstPassRate).toBeCloseTo(2 / 3);
    expect(r.overall.metrics.roundsPerSlide).toBeCloseTo(4 / 3);
    expect(r.overall.stages.build!.calls).toBe(8); // (2 + 1 + 1 rounds) × (builder + critic)
    expect(r.overall.agents["builder · sonnet"]!.calls).toBe(4);

    expect(JSON.parse(readFileSync(join(out, "base", "results.json"), "utf8")).overall.metrics.slides).toBe(3);
    const md = readFileSync(join(out, "base", "results.md"), "utf8");
    expect(md).toMatch(/^# Eval base/);
    expect(md).toMatch(/ALL\s+3\s+\$/);
    expect(md).toContain("## rivers: How rivers carve canyons");
    expect(logs.some((l) => l.startsWith("■ tides"))).toBe(true);
    await expect(runEval({ topics, label: "base", outDir: out, llm, engine: fakeEngine() })).rejects.toThrow(/pick another --label/);
  });

  it("records a topic that fails and carries on; --only and --slides narrow the run", async () => {
    const llm = fakeLlm(handlers({ write_storyboard: () => ({ nope: true }) }));
    const r = await runEval({ topics, label: "broken", outDir: join(root, "eval"), llm, engine: fakeEngine(), only: "rivers", slides: 1, pipeline: { exemplars: [] } });
    expect(r.topics).toHaveLength(1);
    expect(r.topics[0]).toMatchObject({ id: "rivers", error: expect.any(String) });
    expect(r.topics[0]!.run.stages.find((s) => s.stage === "storyboard")!.status).toBe("error");
    expect(JSON.parse(readFileSync(join(r.topics[0]!.projectDir, "outline.json"), "utf8")).sections.flatMap((s: { slides: unknown[] }) => s.slides)).toHaveLength(1);
    expect(r.overall.metrics.errors).toBe(1);
  });
});

describe("eval aggregation and compare", () => {
  const slide = (id: string, o: { first: boolean; rounds: number; score: number; final: "pass" | "fix" | "failed"; escalated?: boolean }) => ({
    id,
    verdicts: [],
    scores: [],
    rounds: o.rounds,
    firstPass: o.first,
    escalated: o.escalated ?? false,
    final: o.final,
    bestRound: 1,
    score: o.score,
    ms: 0,
  });
  const run = (usd: number, slides: ReturnType<typeof slide>[]) => ({
    ...summarizeRun("x", []),
    total: { calls: 4, ms: 0, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, usd },
    stages: [{ stage: "build", status: "done" as const, calls: 4, ms: 1000, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, usd }],
    slides,
  });

  it("computes first-pass rate, rounds, escalations and score over every slide", () => {
    const a = topicResult({ id: "a", topic: "A" }, "/a", run(7, [slide("s01", { first: true, rounds: 1, score: 8, final: "pass" }), slide("s02", { first: false, rounds: 3, score: 5, final: "fix", escalated: true })]), 60_000);
    const b = topicResult({ id: "b", topic: "B" }, "/b", run(3, [slide("s01", { first: false, rounds: 2, score: 0, final: "failed" })]), 30_000, "boom");
    expect(a.metrics).toMatchObject({ slides: 2, usd: 7, usdPerSlide: 3.5, firstPassRate: 0.5, roundsPerSlide: 2, escalations: 1, scoreMean: 6.5, scoreMin: 5, fix: 1, failed: 0, errors: 0 });
    const all = aggregate("x", [a, b]);
    expect(all.overall.metrics).toMatchObject({ topics: 2, slides: 3, usd: 10, ms: 90_000, roundsPerSlide: 2, escalations: 1, scoreMin: 0, fix: 1, failed: 1, errors: 1 });
    expect(all.overall.metrics.firstPassRate).toBeCloseTo(1 / 3);
    expect(all.overall.stages.build).toMatchObject({ calls: 8, ms: 2000, usd: 10 });
    expect(metricsOf([], { calls: 0, usd: 0 }, 0, { topics: 0, errors: 0 })).toMatchObject({ usdPerSlide: 0, firstPassRate: 0, scoreMean: 0, scoreMin: 0 });
  });

  it("prints a before/after table", () => {
    const before = aggregate("before", [topicResult({ id: "a", topic: "A" }, "/a", run(14, [slide("s01", { first: false, rounds: 3, score: 6, final: "fix" })]), 600_000)]);
    const after = aggregate("after", [topicResult({ id: "a", topic: "A" }, "/a", run(7, [slide("s01", { first: true, rounds: 1, score: 7, final: "pass" })]), 300_000)]);
    const text = compareResults(before, after);
    expect(text).toMatch(/cost\s+\$14\.00\s+\$7\.00\s+-50%/);
    expect(text).toMatch(/first-pass rate\s+0%\s+100%\s+new/);
    expect(text).toMatch(/rounds per slide\s+3\.00\s+1\.00\s+-67%/);
    expect(text).toMatch(/mean score\s+6\.0\s+7\.0\s+\+17%/);
    expect(text).toMatch(/wall-clock\s+600\.0s\s+300\.0s\s+-50%/);
    expect(text).toMatch(/^a\s+\$14\.00\s+\$7\.00\s+-50%/m);
  });
});

