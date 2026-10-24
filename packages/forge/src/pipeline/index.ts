// Public API of the agent pipeline (wired into cli.ts / index.ts and the Studio by the controller).
//
//   const project = createProject({ topic, audience, minutes, prefs });   // or loadProject(slugOrDir)
//   await runStage(project, "style", { onEvent });                         // style → research → outline → build
//   saveStageFile(project, "outline", editedOutline);                      // user edit; later stages are invalidated
//   await reviseSlide(project, "s03", "make the earbud bigger", { onEvent });
//   listVersions(project);
//
// Events: see ForgeEvent in ./events.ts. Defaults (models, concurrency, rounds): ./config.ts.
export { createProject, loadProject, openProject, projectStatus, STAGES, STAGE_OUTPUTS } from "./project.ts";
export type { NewProject, Project, Stage } from "./project.ts";
export { runStage, runAll, saveStageFile, StageError, loadBrief, loadStyle, loadResearch, loadOutline, loadScript, loadStoryboard } from "./stages.ts";
export type { PipelineOptions, PipelineContext, RunAllOptions } from "./stages.ts";
export { reviseSlide, listVersions } from "./revise.ts";
export type { ReviseResult, VersionInfo } from "./revise.ts";
export type { BuildSummary, SlideBuild, RoundRecord, VersionMeta } from "./build.ts";
export type { ForgeEvent, OnEvent, Verdict } from "./events.ts";
export { DEFAULT_MODELS, BUILD_DEFAULTS, OUTLINE_DEFAULTS } from "./config.ts";
export { migrateProject, mergeLegacy } from "./migrate.ts";
export type { Migration } from "./migrate.ts";
export { toScript, toStoryboard, outlineSlides } from "../agents/schemas.ts";
export type { AgentName } from "./config.ts";
export { createSharedEngine } from "./shared-engine.ts";
export { deckConfig } from "./build.ts";
export { runStylist } from "../agents/stylist.ts";
export { refineResearch, researchSection } from "../agents/research-refiner.ts";
export type { RefineInput, RefineResult } from "../agents/research-refiner.ts";
export { createLlm, createProxyLlm, loadLlmEnv, MODELS, LlmError } from "../llm.ts";
export type { Llm, Usage, CallRecord, Transport } from "../llm.ts";
export type { StylePrefs, Brief, Outline, OutlineSlide, Visual, LegacyOutline, Script, Storyboard } from "../agents/schemas.ts";
