// Pipeline defaults in one place. Every value can be overridden per call through PipelineContext.
import { MODELS } from "../llm.ts";

export type AgentName = "stylist" | "researcher" | "outline" | "script" | "storyboarder" | "builder" | "builderEscalation" | "critic";

export const DEFAULT_MODELS: Record<AgentName, string> = {
  stylist: MODELS.sonnet,
  researcher: MODELS.sonnet,
  outline: MODELS.sonnet,
  script: MODELS.sonnet,
  storyboarder: MODELS.opus,
  /** Drafts and fix rounds. */
  builder: MODELS.sonnet,
  /** One extra fix attempt when the final critique still says "fix" with a high-severity issue. */
  builderEscalation: MODELS.opus,
  critic: MODELS.opus,
};

export const BUILD_DEFAULTS = {
  /** Slides built at once. */
  concurrency: 6,
  /** Builder → shoot → critic rounds per slide (before any escalation). */
  maxRounds: 2,
  /** Escalate the last fix attempt to `builderEscalation` when the final critique has a high-severity issue. */
  escalate: true,
} as const;
