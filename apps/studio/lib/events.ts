// The event stream a pipeline run emits, as the Studio consumes it (over SSE, one JSON object per `data:` line).
//
// `packages/forge/src/pipeline/events.ts` did not exist when this was written, so this union is the Studio's
// proposal. It is deliberately flat and serialisable. At merge time, map the pipeline's real union onto this one
// in the backend adapter (or replace this file with a re-export if the shapes match).
import type { StageName, Usage, Verdict } from "./types";

export type PipelineEvent =
  /** A stage run began. */
  | { type: "stage.start"; stage: StageName; at: string }
  /** A human-readable progress line from the agent ("Searching: feedforward vs feedback ANC"). */
  | { type: "progress"; stage: StageName; message: string; at: string; slideId?: string }
  /** Partial or complete output for the stage's file, so editors can fill in live. */
  | { type: "stage.output"; stage: StageName; file: string; content: string }
  /** Build: a slide entered the queue or started. */
  | { type: "slide.start"; slideId: string; title: string }
  /** Build/refine: a slide's round moved to a new phase. round is 1-based (max 3). */
  | { type: "slide.round"; slideId: string; round: number; phase: "build" | "shoot" | "critique" }
  /** The critic's verdict on one round of one slide. */
  | { type: "critic.verdict"; slideId: string; round: number; verdict: Verdict; issues: string[] }
  /** A slide finished (passed, or ran out of rounds). */
  | { type: "slide.done"; slideId: string; rounds: number; verdict: Verdict }
  /** Token/cost usage, cumulative for the current run. */
  | { type: "usage"; model: string; usage: Usage }
  /** A new deck version was written. */
  | { type: "version"; version: number; note: string }
  /** The stage finished; its output now awaits approval. */
  | { type: "stage.done"; stage: StageName; at: string }
  /** Something failed. retryable = the user can press Re-run. */
  | { type: "error"; stage?: StageName; slideId?: string; message: string; retryable: boolean };

export type PipelineEventType = PipelineEvent["type"];
