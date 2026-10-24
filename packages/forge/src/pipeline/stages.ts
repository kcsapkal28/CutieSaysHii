// Stage runner: each stage reads the earlier stages' files and writes its own; re-running one invalidates the later ones.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Style, type Engine } from "../contract.ts";
import type { Llm } from "../llm.ts";
import type { Exemplar } from "../agents/builder.ts";
import { runResearcher, type WebSearch } from "../agents/researcher.ts";
import { Brief, Outline, Script, Storyboard } from "../agents/schemas.ts";
import { runOutline, runScript } from "../agents/scriptwriter.ts";
import { runStoryboarder } from "../agents/storyboarder.ts";
import { runStylist } from "../agents/stylist.ts";
import { runBuild, type BuildSummary } from "./build.ts";
import { meteredLlm, type OnEvent } from "./events.ts";
import { invalidateAfter, isStageDone, readJson, STAGES, writeJson, type Project, type Stage } from "./project.ts";

export type AgentName = "stylist" | "researcher" | "outline" | "script" | "storyboarder" | "builder" | "critic";

export type PipelineContext = {
  llm: Llm;
  /** Required for the build stage. */
  engine?: Engine;
  onEvent?: OnEvent;
  /** Per-agent model overrides (defaults: Sonnet for words, Opus for storyboard, builder and critic). */
  models?: Partial<Record<AgentName, string>>;
  /** Web search for the researcher (milestone 3). */
  search?: WebSearch;
  concurrency?: number;
  maxRounds?: number;
  exemplars?: Exemplar[];
};

export class StageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StageError";
  }
}

const file = (p: Project, name: string) => join(p.dir, name);
const model = (ctx: PipelineContext, agent: AgentName) => (ctx.models?.[agent] ? { model: ctx.models[agent] } : {});

export const loadBrief = (p: Project) => readJson(file(p, "brief.json"), (v) => Brief.parse(v));
export const loadStyle = (p: Project) => readJson(file(p, "style.json"), (v) => Style.parse(v));
export const loadResearch = (p: Project) => readFileSync(file(p, "research.md"), "utf8");
export const loadOutline = (p: Project) => readJson(file(p, "outline.json"), (v) => Outline.parse(v));
export const loadScript = (p: Project) => readJson(file(p, "script.json"), (v) => Script.parse(v));
export const loadStoryboard = (p: Project) => readJson(file(p, "storyboard.json"), (v) => Storyboard.parse(v));

/** Runs one stage. Earlier stages must be done; every later stage's outputs are deleted first. */
export async function runStage(project: Project, stage: Stage, ctx: PipelineContext): Promise<BuildSummary | void> {
  const onEvent = ctx.onEvent ?? (() => {});
  const missing = STAGES.slice(0, STAGES.indexOf(stage)).filter((s) => !isStageDone(project, s));
  if (missing.length) throw new StageError(`cannot run ${stage}: run ${missing.join(", ")} first`);
  if (stage === "build" && !ctx.engine) throw new StageError("the build stage needs an engine");

  const invalidated = invalidateAfter(project, stage);
  onEvent({ type: "stage:start", stage, invalidated });
  const started = Date.now();
  const { llm, total } = meteredLlm(ctx.llm, stage, onEvent);
  try {
    const result = await execute(project, stage, { ...ctx, llm, onEvent });
    const done = { type: "stage:done" as const, stage, ms: Date.now() - started, ...total() };
    appendFileSync(file(project, "log.jsonl"), `${JSON.stringify({ ...done, at: new Date().toISOString() })}\n`);
    onEvent(done);
    return result;
  } catch (e) {
    onEvent({ type: "stage:error", stage, error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

async function execute(p: Project, stage: Stage, ctx: PipelineContext & { onEvent: OnEvent }): Promise<BuildSummary | void> {
  const brief = loadBrief(p);
  switch (stage) {
    case "style": {
      const { style, rationale } = await runStylist(ctx.llm, brief, model(ctx, "stylist"));
      writeJson(file(p, "style.json"), style);
      writeJson(file(p, "style.rationale.json"), { rationale });
      return;
    }
    case "research": {
      const { research, markdown } = await runResearcher(ctx.llm, brief, { ...model(ctx, "researcher"), ...(ctx.search ? { search: ctx.search } : {}) });
      writeFileSync(file(p, "research.md"), markdown);
      writeJson(file(p, "research.json"), research);
      return;
    }
    case "outline":
      writeJson(file(p, "outline.json"), await runOutline(ctx.llm, brief, loadResearch(p), model(ctx, "outline")));
      return;
    case "script": {
      const script = await runScript(ctx.llm, { brief, style: loadStyle(p), outline: loadOutline(p), researchMd: loadResearch(p) }, model(ctx, "script"));
      writeJson(file(p, "script.json"), script);
      return;
    }
    case "storyboard": {
      const storyboard = await runStoryboarder(
        ctx.llm,
        { brief, style: loadStyle(p), script: loadScript(p), researchMd: loadResearch(p) },
        model(ctx, "storyboarder"),
      );
      writeJson(file(p, "storyboard.json"), storyboard);
      return;
    }
    case "build":
      return runBuild(
        p,
        { style: loadStyle(p), outline: loadOutline(p), script: loadScript(p), storyboard: loadStoryboard(p) },
        {
          llm: ctx.llm,
          engine: ctx.engine!,
          onEvent: ctx.onEvent,
          ...(ctx.concurrency ? { concurrency: ctx.concurrency } : {}),
          ...(ctx.maxRounds ? { maxRounds: ctx.maxRounds } : {}),
          ...(ctx.exemplars ? { exemplars: ctx.exemplars } : {}),
          models: { ...(ctx.models?.builder ? { builder: ctx.models.builder } : {}), ...(ctx.models?.critic ? { critic: ctx.models.critic } : {}) },
        },
      );
  }
}

export type RunAllOptions = {
  /** true: run straight through. false: ask `approve` after each stage and stop when it says no. */
  auto: boolean;
  approve?: (stage: Stage, project: Project) => Promise<boolean>;
  /** First stage to run. Default: the first stage that isn't done yet (resume). */
  from?: Stage;
  /** Last stage to run (inclusive). Default: build. */
  to?: Stage;
};

/** Runs the stages in order. Returns the stages that ran. */
export async function runAll(project: Project, opts: RunAllOptions, ctx: PipelineContext): Promise<{ ran: Stage[]; build?: BuildSummary }> {
  const firstPending = STAGES.find((s) => !isStageDone(project, s));
  const from = opts.from ?? firstPending;
  if (!from) return { ran: [] };
  const to = STAGES.indexOf(opts.to ?? "build");
  const ran: Stage[] = [];
  let build: BuildSummary | undefined;
  for (const stage of STAGES.slice(STAGES.indexOf(from), to + 1)) {
    const result = await runStage(project, stage, ctx);
    if (result) build = result;
    ran.push(stage);
    if (!opts.auto && opts.approve && stage !== STAGES[to] && !(await opts.approve(stage, project))) break;
  }
  return { ran, ...(build ? { build } : {}) };
}
