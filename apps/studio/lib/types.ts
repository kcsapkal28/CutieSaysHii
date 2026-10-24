// Studio-side data shapes for the files in `projects/<id>/` (see the v2 design spec).
// Client-safe: no runtime imports.
import type { Style } from "@deckforge/forge";

export type { Style };

/** The stages the user approves one by one. Brief and style are set before these run. */
export const STAGES = ["research", "outline", "script", "storyboard", "build"] as const;
export type StageName = (typeof STAGES)[number];

/** idle = never run · running · review = output ready, waiting for approval · approved · error. */
export type StageStatus = "idle" | "running" | "review" | "approved" | "error";

export type StageFileName = "brief.json" | "style.json" | "research.md" | "outline.json" | "script.json" | "storyboard.json";

export const STAGE_FILE: Record<Exclude<StageName, "build">, StageFileName> = {
  research: "research.md",
  outline: "outline.json",
  script: "script.json",
  storyboard: "storyboard.json",
};

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

/** `outline.json` */
export interface Outline {
  title: string;
  sections: { name: string; slides: { id: string; title: string; point: string }[] }[];
}

/** `script.json` */
export interface Script {
  slides: { id: string; title: string; keyMessage: string; narration: string; budgetSec: number }[];
}

export const VISUAL_TYPES = ["3d-object", "simulation", "diagram", "chart", "typographic", "comparison"] as const;
export type VisualType = (typeof VISUAL_TYPES)[number];

/** `storyboard.json` */
export interface Storyboard {
  slides: {
    id: string;
    layout: string;
    visual: VisualType;
    interaction: string;
    motionBeats: string[];
    /** Procedural Three.js object spec, when the slide uses 3D. */
    object3d?: string;
  }[];
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
