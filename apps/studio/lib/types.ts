// Studio-side data shapes for the files in `projects/<id>/` (see the v2 design spec).
// Client-safe: no runtime imports.
import type { Style } from "@deckforge/forge";
import type { Outline, OutlineSlide, Visual } from "@deckforge/forge/pipeline";

export type { Outline, OutlineSlide, Style, Visual };

/** The stages the user approves one by one. Brief and style are set before these run. */
export const STAGES = ["research", "outline", "build"] as const;
export type StageName = (typeof STAGES)[number];

/** idle = never run · running · review = output ready, waiting for approval · approved · error. */
export type StageStatus = "idle" | "running" | "review" | "approved" | "error";

export type StageFileName = "brief.json" | "style.json" | "research.md" | "outline.json";

export const STAGE_FILE: Record<Exclude<StageName, "build">, StageFileName> = {
  research: "research.md",
  outline: "outline.json",
};

/** The engine's explainer types (packages/forge/src/agents/schemas.ts EXPLAINERS), for the outline editor. */
export const EXPLAINERS = [
  "3d-object",
  "simulation",
  "animated-diagram",
  "data-viz",
  "timeline",
  "map",
  "comparison",
  "quote",
  "typographic",
  "image-led",
] as const satisfies readonly Visual["explainer"][];

export const INTERACTIONS = ["none", "click", "hover", "toggle", "slider", "drag"] as const satisfies readonly Visual["interaction"]["kind"][];

/** Every slide of an outline in deck order, with its section name. */
export function outlineSlides(o: Outline | null | undefined): (OutlineSlide & { section: string })[] {
  return (o?.sections ?? []).flatMap((s) => s.slides.map((sl) => ({ ...sl, section: s.name })));
}

/** `brief.json` */
export interface Brief {
  topic: string;
  audience: string;
  /** Talk length in minutes. */
  minutes: number;
  goal: string;
  /** Free-form "anything else". */
  notes?: string;
}

export type Verdict = "pass" | "revise";

export interface SlideBuildState {
  id: string;
  title: string;
  status: "queued" | "building" | "done" | "error";
  /** Build/critique rounds used so far (max 3). */
  rounds: number;
  verdict?: Verdict;
  /** What the critic flagged across rounds (most recent last). */
  issues: { round: number; text: string; fixed: boolean }[];
  phase?: "build" | "shoot" | "critique";
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/** Ask about one passage of research.md: the document as the user sees it, the passage's range in it, the question. */
export interface ResearchRefineRequest {
  markdown: string;
  start: number;
  end: number;
  question: string;
}

/** The researcher's answer and a replacement for just that passage. Nothing is saved until the user accepts it. */
export interface ResearchRefineResult {
  answer: string;
  passage: string;
  replacement: string;
  /** false when the researcher left the passage as it was. */
  changed: boolean;
  model: string;
  usage: Usage;
}

export interface StageState {
  status: StageStatus;
  updatedAt: string | null;
  usage: Usage;
  error?: string;
  /** Progress log of the last run (most recent last), for reload/resume. */
  log: { at: string; message: string }[];
}

export interface VersionInfo {
  version: number;
  createdAt: string;
  /** What produced it: "Build", "s05: Make the packets slower", "Restored v2". */
  note: string;
  slideIds: string[];
  /** Slides changed relative to the previous version. */
  changed: string[];
}

export interface ProjectSummary {
  id: string;
  title: string;
  topic: string;
  createdAt: string;
  updatedAt: string;
  stages: Record<StageName, StageStatus>;
  hasStyle: boolean;
  latestVersion: number | null;
  /** For the project card poster. */
  style: Style | null;
  slideCount: number;
}

export interface Project extends ProjectSummary {
  brief: Brief;
  stageState: Record<StageName, StageState>;
  /** Raw file contents, as they would sit on disk. */
  files: Partial<Record<StageFileName, string>>;
  build: { slides: SlideBuildState[] } | null;
}
