// Stage runner: each stage reads the earlier stages' files and writes its own; re-running (or editing) one
// invalidates the later ones.
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Style, type Engine } from "../contract.ts";
import { createProxyLlm, type Llm, type Thinking } from "../llm.ts";
import type { Exemplar } from "../agents/builder.ts";
import { runResearcher, type WebSearch } from "../agents/researcher.ts";
import { runOutline } from "../agents/outliner.ts";
import { Brief, Outline, toScript, toStoryboard } from "../agents/schemas.ts";
import { runStylist } from "../agents/stylist.ts";
import { runBuild, type BuildOptions, type BuildSummary } from "./build.ts";
import { DEFAULT_MODELS, OUTLINE_DEFAULTS, withDefaultThinking, withThinking, type AgentName } from "./config.ts";
import { meteredLlm, type OnEvent } from "./events.ts";
import { journaled, journalFile, newRunId } from "./journal.ts";
import { invalidateAfter, isStageDone, readJson, STAGES, writeJson, type Project, type Stage } from "./project.ts";
import { createSharedEngine, type ClosableEngine } from "./shared-engine.ts";

export type PipelineOptions = {
  onEvent?: OnEvent;
  /** Run id on every journal line (projects/<id>/log.jsonl); runAll shares one across its stages. Default: a new id. */
  runId?: string;
  /** Defaults to the proxy client (LLM_BASE_URL / LLM_API_KEY). */
  llm?: Llm;
  /** Defaults to the real engine with one shared Chromium, closed when the stage ends. */
  engine?: Engine;
  /** Per-agent model overrides; defaults in config.ts. */
  models?: Partial<Record<AgentName, string>>;
  /** Build: slides built at once, rounds per slide, Opus escalation on the last round (defaults in config.ts). */
  concurrency?: number;
  maxRounds?: number;
  escalate?: boolean;
  /** Build: fix rounds as edits on the previous version (default in config.ts). */
  patchFixes?: boolean;
  /** Outline: slide cards written at once (default in config.ts). */
  outlineConcurrency?: number;
  /** One thinking level forced on every call of the run (e.g. "medium"); unset = each agent's default. */
  thinking?: Thinking;
  /** Builder thinking on draft and fix rounds (default "off", see config.ts). */
  builderThinking?: "off" | "model";
  /** Web search for the researcher (milestone 3). */
  search?: WebSearch;
  /** Builder few-shot slides; defaults to fixtures/proof. */
  exemplars?: Exemplar[];
};
/** @deprecated alias kept for the first API draft. */
export type PipelineContext = PipelineOptions;

export class StageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StageError";
  }
}

const file = (p: Project, name: string) => join(p.dir, name);
const model = (o: PipelineOptions, agent: AgentName) => ({ model: o.models?.[agent] ?? DEFAULT_MODELS[agent] });

export const loadBrief = (p: Project) => readJson(file(p, "brief.json"), (v) => Brief.parse(v));
export const loadStyle = (p: Project) => readJson(file(p, "style.json"), (v) => Style.parse(v));
export const loadResearch = (p: Project) => readFileSync(file(p, "research.md"), "utf8");
export const loadOutline = (p: Project) => readJson(file(p, "outline.json"), (v) => Outline.parse(v));
/** The builder's per-slide words and visuals, derived from outline.json. */
export const loadScript = (p: Project) => toScript(loadOutline(p));
export const loadStoryboard = (p: Project) => toStoryboard(loadOutline(p));

/** Build options from pipeline options (engine and llm already resolved). */
export function buildOptions(o: PipelineOptions, llm: Llm, engine: Engine, onEvent: OnEvent): BuildOptions {
  return {
    llm,
    engine,
    onEvent,
    ...(o.concurrency ? { concurrency: o.concurrency } : {}),
    ...(o.maxRounds ? { maxRounds: o.maxRounds } : {}),
    ...(o.escalate === undefined ? {} : { escalate: o.escalate }),
    ...(o.exemplars ? { exemplars: o.exemplars } : {}),
    ...(o.patchFixes === undefined ? {} : { patchFixes: o.patchFixes }),
    ...(o.builderThinking ? { builderThinking: o.builderThinking } : {}),
    ...(typeof (engine as Partial<ClosableEngine>).shrink === "function"
      ? { shrinkImage: (png: Buffer, width?: number) => (engine as ClosableEngine).shrink(png, width) }
      : {}),
    models: { builder: model(o, "builder").model, builderEscalation: model(o, "builderEscalation").model, critic: model(o, "critic").model },
  };
}

/** Runs the engine-using `fn` with the given engine, or a fresh shared-Chromium engine that is closed afterwards. */
export async function withEngine<T>(engine: Engine | undefined, fn: (e: Engine) => Promise<T>): Promise<T> {
  if (engine) return fn(engine);
  const shared = createSharedEngine();
  try {
    return await fn(shared);
  } finally {
    await shared.close();
  }
}

/** Runs one stage. Earlier stages must be done; every later stage's outputs are deleted first. */
export async function runStage(project: Project, stage: Stage, opts: PipelineOptions = {}): Promise<BuildSummary | void> {
  const { onEvent } = journaled(journalFile(project), opts.onEvent, opts.runId);
  const missing = STAGES.slice(0, STAGES.indexOf(stage)).filter((s) => !isStageDone(project, s));
  if (missing.length) throw new StageError(`cannot run ${stage}: run ${missing.join(", ")} first`);

  const invalidated = invalidateAfter(project, stage);
  onEvent({ type: "stage:start", stage, invalidated });
  const started = Date.now();
  const base = opts.llm ?? createProxyLlm();
  const { llm, total } = meteredLlm(opts.thinking ? withThinking(base, opts.thinking) : withDefaultThinking(base), stage, onEvent);
  try {
    const result = await execute(project, stage, opts, llm, onEvent);
    onEvent({ type: "stage:done", stage, ms: Date.now() - started, ...total() });
    return result;
  } catch (e) {
    const where = e instanceof Error && e.stack ? e.stack.split("\n").slice(1, 3).map((l) => l.trim()).join(" < ") : undefined;
    onEvent({ type: "stage:error", stage, error: e instanceof Error ? e.message : String(e), ...(where ? { where } : {}) });
    throw e;
  }
}

async function execute(p: Project, stage: Stage, o: PipelineOptions, llm: Llm, onEvent: OnEvent): Promise<BuildSummary | void> {
  const brief = loadBrief(p);
  switch (stage) {
    case "style": {
      const { style, rationale } = await runStylist(llm, brief, model(o, "stylist"));
      writeJson(file(p, "style.json"), style);
      writeJson(file(p, "style.rationale.json"), { rationale });
      return;
    }
    case "research": {
      const { research, markdown } = await runResearcher(llm, brief, { ...model(o, "researcher"), ...(o.search ? { search: o.search } : {}) });
      writeFileSync(file(p, "research.md"), markdown);
      writeJson(file(p, "research.json"), research);
      return;
    }
    case "outline": {
      const outline = await runOutline(
        llm,
        { brief, style: loadStyle(p), researchMd: loadResearch(p) },
        {
          ...model(o, "outline"),
          cardModel: model(o, "outlineCard").model,
          concurrency: o.outlineConcurrency ?? OUTLINE_DEFAULTS.concurrency,
          onArc: (arc) => onEvent({ type: "outline:arc", ...arc }),
          onCard: (card) => onEvent({ type: "outline:card", ...card }),
        },
      );
      writeJson(file(p, "outline.json"), outline);
      return;
    }
    case "build": {
      const outline = loadOutline(p);
      const inputs = { style: loadStyle(p), outline, script: toScript(outline), storyboard: toStoryboard(outline) };
      return withEngine(o.engine, (engine) => runBuild(p, inputs, buildOptions(o, llm, engine, onEvent)));
    }
  }
}

/**
 * Saves a user-edited stage file (Studio edits) and invalidates every later stage.
 * `data` is the parsed JSON for style/outline, or the markdown string for research.
 */
export function saveStageFile(project: Project, stage: Exclude<Stage, "build">, data: unknown): { invalidated: Stage[] } {
  switch (stage) {
    case "style":
      writeJson(file(project, "style.json"), Style.parse(data));
      break;
    case "research":
      if (typeof data !== "string" || !data.trim()) throw new StageError("research must be a non-empty markdown string");
      writeFileSync(file(project, "research.md"), data);
      if (existsSync(file(project, "research.json"))) rmSync(file(project, "research.json"));
      break;
    case "outline":
      writeJson(file(project, "outline.json"), Outline.parse(data));
      break;
    default:
      throw new StageError(`${String(stage)} can't be saved directly; use reviseSlide for slide changes`);
  }
  return { invalidated: invalidateAfter(project, stage) };
}

export type RunAllOptions = PipelineOptions & {
  /** true: run straight through. false: ask `approve` after each stage and stop when it says no. */
  auto: boolean;
  approve?: (stage: Stage, project: Project) => Promise<boolean>;
  /** First stage to run. Default: the first stage that isn't done yet (resume). */
  from?: Stage;
  /** Last stage to run (inclusive). Default: build. */
  to?: Stage;
};

/** Runs the stages in order. Returns the stages that ran. */
export async function runAll(project: Project, opts: RunAllOptions): Promise<{ ran: Stage[]; build?: BuildSummary }> {
  const from = opts.from ?? STAGES.find((s) => !isStageDone(project, s));
  if (!from) return { ran: [] };
  const to = STAGES.indexOf(opts.to ?? "build");
  const llm = opts.llm ?? createProxyLlm();
  const runId = opts.runId ?? newRunId();
  const ran: Stage[] = [];
  let build: BuildSummary | undefined;
  for (const stage of STAGES.slice(STAGES.indexOf(from), to + 1)) {
    const result = await runStage(project, stage, { ...opts, llm, runId });
    if (result) build = result;
    ran.push(stage);
    if (!opts.auto && opts.approve && stage !== STAGES[to] && !(await opts.approve(stage, project))) break;
  }
  return { ran, ...(build ? { build } : {}) };
}
