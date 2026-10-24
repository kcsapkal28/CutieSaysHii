// `forge eval`: builds a fixed set of topics end to end (style → … → build, every stage auto-approved) in a scratch
// projects root and writes <out>/<label>/results.json and results.md: cost, wall-clock, first-pass rate, rounds and
// critic scores, per topic and overall. Every number comes from the run journal (pipeline/journal.ts), so the eval
// measures exactly what a normal run records. `compareResults` prints a before/after table of two labels.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { Engine } from "./contract.ts";
import { addUsage, createProxyLlm, ZERO_USAGE, type Llm } from "./llm.ts";
import { StylePrefs } from "./agents/schemas.ts";
import { DEFAULT_MODELS } from "./pipeline/config.ts";
import type { OnEvent } from "./pipeline/events.ts";
import {
  formatRun,
  journalFile,
  newRunId,
  readJournal,
  secs,
  summarizeRun,
  table,
  usd,
  type CostRow,
  type RunSummary,
  type SlideRow,
} from "./pipeline/journal.ts";
import { createProject, writeJson, type Project } from "./pipeline/project.ts";
import { loadOutline, runAll, saveStageFile, type PipelineOptions } from "./pipeline/stages.ts";

export const DEFAULT_TOPICS_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "eval", "topics.json");

export const EvalTopic = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  topic: z.string().min(3),
  audience: z.string().min(1),
  minutes: z.number().positive().max(120),
  /** Slide cap: the outline is cut to its first `slides` slides before the script, which bounds the cost. */
  slides: z.number().int().positive(),
  prefs: StylePrefs.optional(),
});
export type EvalTopic = z.infer<typeof EvalTopic>;

export function loadTopics(file = DEFAULT_TOPICS_FILE): EvalTopic[] {
  return z.array(EvalTopic).min(1).parse(JSON.parse(readFileSync(file, "utf8")));
}

/** Rough real-LLM cost of an eval, from the measured ~$3.5 per built slide plus ~$3 of word stages per deck. */
export const estimateUsd = (topics: EvalTopic[], slides?: number) => topics.reduce((sum, t) => sum + (slides ?? t.slides) * 3.5 + 3, 0);

export type Metrics = {
  topics: number;
  slides: number;
  ms: number;
  calls: number;
  usd: number;
  usdPerSlide: number;
  /** Share of slides whose round-1 verdict was pass. */
  firstPassRate: number;
  roundsPerSlide: number;
  escalations: number;
  /** Final (best-round) critic score per slide. */
  scoreMean: number;
  scoreMin: number;
  /** Slides that ended at "fix", and slides with no usable round. */
  fix: number;
  failed: number;
  errors: number;
};

export type TopicResult = {
  id: string;
  topic: string;
  projectDir: string;
  deckFile?: string;
  error?: string;
  /** Wall-clock for the whole topic. */
  ms: number;
  run: RunSummary;
  metrics: Metrics;
};

export type EvalResults = {
  label: string;
  createdAt: string;
  models: Record<string, string>;
  topics: TopicResult[];
  overall: { metrics: Metrics; stages: Record<string, CostRow>; agents: Record<string, CostRow> };
};

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function metricsOf(slides: SlideRow[], cost: Pick<CostRow, "calls" | "usd">, ms: number, extra: { topics: number; errors: number }): Metrics {
  const scores = slides.map((s) => s.score);
  return {
    topics: extra.topics,
    slides: slides.length,
    ms,
    calls: cost.calls,
    usd: cost.usd,
    usdPerSlide: slides.length ? cost.usd / slides.length : 0,
    firstPassRate: slides.length ? slides.filter((s) => s.firstPass).length / slides.length : 0,
    roundsPerSlide: mean(slides.map((s) => s.rounds)),
    escalations: slides.filter((s) => s.escalated).length,
    scoreMean: mean(scores),
    scoreMin: scores.length ? Math.min(...scores) : 0,
    fix: slides.filter((s) => s.final === "fix").length,
    failed: slides.filter((s) => s.final !== "pass" && s.final !== "fix").length,
    errors: extra.errors,
  };
}

export function topicResult(topic: Pick<EvalTopic, "id" | "topic">, projectDir: string, run: RunSummary, ms: number, error?: string): TopicResult {
  const errors = run.errors.length || (error ? 1 : 0);
  return {
    id: topic.id,
    topic: topic.topic,
    projectDir,
    ...(run.deckFile ? { deckFile: run.deckFile } : {}),
    ...(error ? { error } : {}),
    ms,
    run,
    metrics: metricsOf(run.slides, run.total, ms, { topics: 1, errors }),
  };
}

function sumRows(into: Record<string, CostRow>, key: string, row: CostRow): void {
  const r = (into[key] ??= { calls: 0, ms: 0, usage: ZERO_USAGE, usd: 0 });
  Object.assign(r, { calls: r.calls + row.calls, ms: r.ms + row.ms, usage: addUsage(r.usage, row.usage), usd: r.usd + row.usd });
}

/** Totals over every topic (stage and agent rows are summed; `ms` is the summed wall-clock). */
export function aggregate(label: string, topics: TopicResult[], models: Record<string, string> = DEFAULT_MODELS, createdAt = new Date().toISOString()): EvalResults {
  const stages: Record<string, CostRow> = {};
  const agents: Record<string, CostRow> = {};
  for (const t of topics) {
    for (const s of t.run.stages) sumRows(stages, s.stage, s);
    for (const [k, r] of Object.entries(t.run.agents)) sumRows(agents, k, r);
  }
  const total = topics.reduce((acc, t) => ({ calls: acc.calls + t.run.total.calls, usd: acc.usd + t.run.total.usd }), { calls: 0, usd: 0 });
  const metrics = metricsOf(
    topics.flatMap((t) => t.run.slides),
    total,
    topics.reduce((a, t) => a + t.ms, 0),
    { topics: topics.length, errors: topics.reduce((a, t) => a + t.metrics.errors, 0) },
  );
  return { label, createdAt, models, topics, overall: { metrics, stages, agents } };
}

/** Cuts the outline to its first `n` slides (dropping emptied sections) and saves it. */
export function capOutline(project: Project, n: number): void {
  const outline = loadOutline(project);
  if (outline.sections.reduce((a, s) => a + s.slides.length, 0) <= n) return;
  let left = n;
  const sections = outline.sections
    .map((s) => {
      const slides = s.slides.slice(0, Math.max(0, left));
      left -= slides.length;
      return { ...s, slides };
    })
    .filter((s) => s.slides.length);
  const totalSec = sections.reduce((a, s) => a + s.slides.reduce((b, sl) => b + sl.budgetSec, 0), 0);
  saveStageFile(project, "outline", { ...outline, sections, totalSec });
}

export type EvalOptions = {
  topics: EvalTopic[];
  label: string;
  /** Results go to <outDir>/<label>/; the scratch projects to <outDir>/<label>/work/projects/. */
  outDir: string;
  only?: string;
  /** Overrides every topic's slide cap. */
  slides?: number;
  llm?: Llm;
  engine?: Engine;
  /** Other pipeline options (models, rounds, concurrency…), applied to every topic. */
  pipeline?: Omit<PipelineOptions, "llm" | "engine" | "onEvent" | "runId">;
  onEvent?: OnEvent;
  log?: (line: string) => void;
};

export async function runEval(o: EvalOptions): Promise<EvalResults> {
  const topics = o.only ? o.topics.filter((t) => t.id === o.only) : o.topics;
  if (!topics.length) throw new Error(o.only ? `no eval topic "${o.only}"` : "no eval topics");
  const dir = join(o.outDir, o.label);
  if (existsSync(join(dir, "results.json"))) throw new Error(`${join(dir, "results.json")} exists: pick another --label`);
  const root = join(dir, "work");
  const llm = o.llm ?? createProxyLlm();
  const log = o.log ?? (() => {});

  const results: TopicResult[] = [];
  for (const topic of topics) {
    const project = createProject({ topic: topic.topic, audience: topic.audience, minutes: topic.minutes, prefs: topic.prefs ?? {}, root });
    const runId = newRunId();
    const common = { ...o.pipeline, llm, ...(o.engine ? { engine: o.engine } : {}), runId, auto: true, ...(o.onEvent ? { onEvent: o.onEvent } : {}) };
    log(`▶ ${topic.id}: ${topic.topic} (${project.dir})`);
    const started = Date.now();
    let error: string | undefined;
    try {
      await runAll(project, { ...common, to: "outline" });
      capOutline(project, o.slides ?? topic.slides);
      await runAll(project, { ...common, from: "script" });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      log(`✗ ${topic.id}: ${error}`);
    }
    const run = summarizeRun(runId, readJournal(journalFile(project)).filter((l) => l.run === runId));
    const result = topicResult(topic, project.dir, run, Date.now() - started, error);
    log(`■ ${topic.id}: ${result.metrics.slides} slides · ${usd(result.metrics.usd)} · ${secs(result.ms)} · mean score ${result.metrics.scoreMean.toFixed(1)}`);
    results.push(result);
  }

  const out = aggregate(o.label, results, { ...DEFAULT_MODELS, ...o.pipeline?.models });
  mkdirSync(dir, { recursive: true });
  writeJson(join(dir, "results.json"), out);
  writeFileSync(join(dir, "results.md"), formatResults(out));
  return out;
}

// ---- formatting ----

const pct = (n: number) => `${Math.round(n * 100)}%`;

const metricCells = (m: Metrics) => [
  String(m.slides),
  usd(m.usd),
  usd(m.usdPerSlide),
  secs(m.ms),
  pct(m.firstPassRate),
  m.roundsPerSlide.toFixed(2),
  String(m.escalations),
  m.scoreMean.toFixed(1),
  String(m.scoreMin),
  String(m.fix),
  String(m.failed),
];
const METRIC_HEAD = ["slides", "cost", "$/slide", "time", "1st pass", "rounds", "escal.", "score", "min", "fix", "failed"];

const costTable = (head: string, rows: Record<string, CostRow>) =>
  table(
    [head, "time", "calls", "in", "cached", "out", "cost"],
    Object.entries(rows)
      .sort((a, b) => b[1].usd - a[1].usd)
      .map(([k, r]) => [k, secs(r.ms), String(r.calls), String(r.usage.input + r.usage.cacheRead + r.usage.cacheWrite), String(r.usage.cacheRead), String(r.usage.output), usd(r.usd)]),
  );

export function formatResults(r: EvalResults): string {
  const fence = (s: string) => `\`\`\`\n${s}\n\`\`\``;
  const out = [
    `# Eval ${r.label}`,
    "",
    `${r.createdAt} · models: ${Object.entries(r.models)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ")}`,
    "",
    "## Overall",
    "",
    fence(
      table(["topic", ...METRIC_HEAD], [...r.topics.map((t) => [t.id, ...metricCells(t.metrics)]), ["ALL", ...metricCells(r.overall.metrics)]]),
    ),
    "",
    "Stage time is the sum of each topic's stage wall-clock; agent time is the sum of call durations.",
    "",
    fence(costTable("stage", r.overall.stages)),
    "",
    fence(costTable("agent", r.overall.agents)),
  ];
  for (const t of r.topics) {
    out.push("", `## ${t.id}: ${t.topic}`, "", `project: ${t.projectDir}`, `deck: ${t.deckFile ?? "(none)"}`);
    if (t.error) out.push(`error: ${t.error}`);
    out.push("", fence(formatRun(t.run)));
  }
  return `${out.join("\n")}\n`;
}

export function readResults(outDir: string, label: string): EvalResults {
  const file = join(outDir, label, "results.json");
  if (!existsSync(file)) throw new Error(`no eval results at ${file}`);
  return JSON.parse(readFileSync(file, "utf8")) as EvalResults;
}

const delta = (a: number, b: number) => (a === 0 ? (b === 0 ? "0%" : "new") : `${b >= a ? "+" : ""}${Math.round(((b - a) / a) * 100)}%`);

/** A before/after table of two eval runs: overall metrics, then cost and score per shared topic. */
export function compareResults(a: EvalResults, b: EvalResults): string {
  const ma = a.overall.metrics;
  const mb = b.overall.metrics;
  const row = (name: string, x: number, y: number, f: (n: number) => string) => [name, f(x), f(y), delta(x, y)];
  const overall = table(
    ["metric", a.label, b.label, "change"],
    [
      row("cost", ma.usd, mb.usd, usd),
      row("cost per slide", ma.usdPerSlide, mb.usdPerSlide, usd),
      row("wall-clock", ma.ms, mb.ms, secs),
      row("first-pass rate", ma.firstPassRate, mb.firstPassRate, pct),
      row("rounds per slide", ma.roundsPerSlide, mb.roundsPerSlide, (n) => n.toFixed(2)),
      row("escalations", ma.escalations, mb.escalations, String),
      row("mean score", ma.scoreMean, mb.scoreMean, (n) => n.toFixed(1)),
      row("min score", ma.scoreMin, mb.scoreMin, String),
      row("slides at fix", ma.fix, mb.fix, String),
      row("slides failed", ma.failed, mb.failed, String),
      row("slides", ma.slides, mb.slides, String),
    ],
  );
  const byId = new Map(b.topics.map((t) => [t.id, t]));
  const shared = a.topics.filter((t) => byId.has(t.id));
  if (!shared.length) return overall;
  const topics = table(
    ["topic", `cost ${a.label}`, `cost ${b.label}`, "change", `score ${a.label}`, `score ${b.label}`, `1st pass ${a.label}`, `1st pass ${b.label}`],
    shared.map((t) => {
      const u = byId.get(t.id)!;
      return [t.id, usd(t.metrics.usd), usd(u.metrics.usd), delta(t.metrics.usd, u.metrics.usd), t.metrics.scoreMean.toFixed(1), u.metrics.scoreMean.toFixed(1), pct(t.metrics.firstPassRate), pct(u.metrics.firstPassRate)];
    }),
  );
  return `${overall}\n\n${topics}`;
}
