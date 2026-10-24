// The one seam between the Studio UI and whatever builds decks. The route handlers in app/api call only this.
// MockBackend (lib/mock/backend.ts) implements it with fake timed events; the real pipeline adapter replaces it.
import type { PipelineEvent } from "./events";
import type { Brief, Project, ProjectSummary, StageFileName, StageName, Style, VersionInfo } from "./types";

export type { PipelineEvent };

/** Thrown by backends for unknown project ids / versions; route handlers map it to 404. */
export class NotFound extends Error {
  override name = "NotFound";
}

export type DeckRef = number | "latest" | "draft";

export interface RunOptions {
  /** Aborted when the client disconnects or presses Stop. */
  signal?: AbortSignal;
}

export interface StudioBackend {
  createProject(brief: Brief): Promise<ProjectSummary>;
  listProjects(): Promise<ProjectSummary[]>;
  /** null when the id is unknown. */
  loadProject(id: string): Promise<Project | null>;

  /** Runs (or re-runs) one stage. Events stream until `stage.done` or `error`. */
  runStage(id: string, stage: StageName, opts?: RunOptions): AsyncIterable<PipelineEvent>;
  /** Marks a stage's output approved; downstream stages become runnable. */
  approveStage(id: string, stage: StageName): Promise<Project>;
  /** Writes one project file (user edits from the stage editors, brief.json, style.json). */
  saveStageFile(id: string, file: StageFileName, content: string): Promise<Project>;

  /** The Stylist agent: a complete Style for the brief, with a one-paragraph rationale. */
  recommendStyle(brief: Brief): Promise<{ style: Style; rationale: string }>;

  /** Chat edit of one slide. Streams slide.round / critic.verdict / slide.done, then `version`. */
  reviseSlide(id: string, slideId: string, instruction: string, opts?: RunOptions): AsyncIterable<PipelineEvent>;

  listVersions(id: string): Promise<VersionInfo[]>;
  /** Rolls back by writing a new version that copies `version`. */
  restoreVersion(id: string, version: number): Promise<VersionInfo>;
  /**
   * The self-contained deck.html of a version. "latest" = newest version; "draft" = the working slides as they
   * stand right now (slides/<id>.html), so the build view can show slides as they pass. null when there is none.
   */
  getDeckHtml(id: string, version: DeckRef): Promise<string | null>;
}
