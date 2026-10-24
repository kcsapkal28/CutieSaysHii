// Public API of the agent pipeline (wired into cli.ts / index.ts by the controller).
export { createProject, openProject, projectStatus, invalidateAfter, nextVersion, slugify, STAGES, STAGE_OUTPUTS } from "./project.ts";
export type { NewProject, Project, Stage } from "./project.ts";
export { runStage, runAll, StageError, loadBrief, loadStyle, loadResearch, loadOutline, loadScript, loadStoryboard } from "./stages.ts";
export type { AgentName, PipelineContext, RunAllOptions } from "./stages.ts";
export { runBuild, deckConfig, placeholderSlide } from "./build.ts";
export type { BuildOptions, BuildSummary, SlideBuild } from "./build.ts";
export { meteredLlm } from "./events.ts";
export type { ForgeEvent, OnEvent } from "./events.ts";
export { createLlm, createProxyLlm, loadLlmEnv, MODELS, LlmError } from "../llm.ts";
export type { Llm, Usage, CallRecord, Transport } from "../llm.ts";
export * as agents from "../agents/index.ts";
export type { StylePrefs, Brief } from "../agents/schemas.ts";
