// Pipeline defaults in one place. Every value can be overridden per call through PipelineContext.
import { MODELS, type Llm, type Thinking } from "../llm.ts";

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
  /** One extra fix attempt when the final critique still says "fix" with a high-severity issue (off by default). */
  builderEscalation: MODELS.opus,
  /** Sonnet with thinking off: the pre-check now measures layout, so the critic judges craft from ≤ 3 small images. */
  critic: MODELS.sonnet,
};

/**
 * Thinking per agent. "off" is no thinking on Sonnet (between_tools) and low effort on Opus, which can't turn it off.
 * Builder "off" measured 50 s / 9k output tokens for a slide that took 3–7 min and 30–60k tokens with the model's
 * adaptive thinking (often hitting max_tokens). Only the outline's arc (one call that shapes the whole deck) thinks.
 */
export const DEFAULT_THINKING: Record<AgentName | "outlineArc", Thinking> = {
  stylist: "off",
  researcher: "off",
  outline: "off",
  outlineCard: "off",
  outlineArc: "model",
  builder: "off",
  builderEscalation: "off",
  critic: "off",
};

/** The DEFAULT_THINKING entry for a call label ("outline:arc", "builder:s03", "researcher:refine", …); unknown → "off". */
export function thinkingFor(label: string): Thinking {
  if (label === "outline:arc") return DEFAULT_THINKING.outlineArc;
  const agent = label.split(":")[0]!;
  return agent in DEFAULT_THINKING ? DEFAULT_THINKING[agent as AgentName] : "off";
}

/** Fills each call's `thinking` from DEFAULT_THINKING (by label) when the agent didn't set it. */
export function withDefaultThinking(llm: Llm): Llm {
  return {
    callTool: (opts) => llm.callTool({ ...opts, thinking: opts.thinking ?? thinkingFor(opts.label) }),
    callText: (opts) => llm.callText({ ...opts, thinking: opts.thinking ?? thinkingFor(opts.label) }),
    ...(llm.warm ? { warm: (opts) => llm.warm!({ ...opts, thinking: opts.thinking ?? thinkingFor(opts.label) }) } : {}),
  } satisfies Llm;
}

export const BUILD_DEFAULTS = {
  /** Slides built at once. */
  concurrency: 6,
  /** Builder → shoot → critic rounds per slide (before any escalation). */
  maxRounds: 2,
  /**
   * One extra fix attempt on `builderEscalation` when the final critique has a high-severity issue and scores below
   * `escalateBelowScore` (or the pre-check still fails). Off: the Opus round was the build's biggest cost item.
   */
  escalate: false,
  escalateBelowScore: 7,
  /**
   * Extra builder attempts per slide for rounds whose deterministic pre-check finds hard failures (the critic is
   * skipped for those). They don't use up one of the `maxRounds`; once spent, a failing pre-check uses a round.
   */
  precheckRetries: 2,
  /**
   * Fix rounds return search/replace edits on the previous version (~1–2k output tokens instead of ~9k for the whole
   * slide). An edit that doesn't apply, a result that breaks the contract or a pre-check that gets worse falls back
   * to a full rewrite in the same round. First drafts are always full HTML.
   */
  patchFixes: true,
  /** One max_tokens-0 call writes the builder's shared prompt prefix to the cache before the slides fan out. */
  warmCache: true,
  /** Exemplar slides in the builder's prompt, each trimmed to at most `exemplarChars`. */
  exemplars: 2,
  exemplarChars: 5000,
  /** Critic: screenshots per review (first and last step included), their long edge in px. */
  criticImages: 3,
  imageWidth: 1024,
  /** A review passes at this score or above with no high-severity issue and no errors. */
  passScore: 7,
  /** Issues the critic returns, most severe first. */
  maxIssues: 5,
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
