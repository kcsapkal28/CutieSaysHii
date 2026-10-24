// Pipeline defaults in one place. Every value can be overridden per call through PipelineContext.
import { MODELS } from "../llm.ts";

export type AgentName = "stylist" | "researcher" | "outline" | "outlineCard" | "builder" | "builderEscalation" | "critic";

export const DEFAULT_MODELS: Record<AgentName, string> = {
  stylist: MODELS.sonnet,
  researcher: MODELS.sonnet,
  /** The outline's arc (story, variety, technique choice): the strongest creative model. */
  outline: MODELS.opus,
  /** The outline's per-slide cards: each expands one fixed arc entry into words and visual direction (checked and retried). */
  outlineCard: MODELS.sonnet,
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
  /**
   * Extra builder attempts per slide for rounds whose deterministic pre-check finds hard failures (the critic is
   * skipped for those). They don't use up one of the `maxRounds`; once spent, a failing pre-check uses a round.
   */
  precheckRetries: 2,
  /**
   * Builder thinking on draft/fix rounds. "off" measured 50 s / 9k output tokens for a slide that took 3–7 min and
   * 30–60k tokens with the model's adaptive thinking (often hitting max_tokens). The escalated Opus round thinks.
   */
  builderThinking: "off" as "off" | "model",
};

export const OUTLINE_DEFAULTS = {
  /** Slide cards written at once in the outline's second pass. */
  concurrency: 6,
  /**
   * What each card call sees. "slim": its own technique entries and the research items the arc pointed it at (about
   * 7k tokens). "full": the whole technique catalogue and research notes (about 15k tokens, the earlier behaviour).
   */
  cardContext: "slim" as "slim" | "full",
  /** Output cap per card; a compact card is about 1.5k tokens. */
  cardMaxTokens: 6000,
  /** Card thinking: "off" answers directly, since the arc already made the creative choices. */
  cardThinking: "off" as "off" | "model",
  /** Corrective retries for a card that fails its checks (style limits, missing specs, overlong fields). */
  cardRetries: 2,
};
