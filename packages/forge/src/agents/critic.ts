// Critic (vision): the steps' screenshots + console errors + storyboard intent → { verdict, issues }.
import { MODELS, type ImageData, type Llm, type Part, type Thinking } from "../llm.ts";
import { loadPrompt } from "./prompts.ts";
import { CriticReport, type Issue, type ScriptSlide, type StoryboardSlide } from "./schemas.ts";

export type CriticInput = {
  slide: ScriptSlide;
  board: StoryboardSlide;
  /** Screenshots in step order (already downscaled; see sampleSteps for how many to send). */
  shots: { step: number; image: ImageData }[];
  /** Steps the slide reported (from the shooter). */
  steps: number;
  errors: string[];
  /** Warnings measured by the deterministic pre-check (tiny text, low contrast, a step that changes nothing), one per line. */
  measured?: string[];
  /** A presenter's change request this version was built for; it outranks the storyboard. */
  instruction?: string;
};

export type CriticOpts = {
  model?: string;
  thinking?: Thinking;
  /** Pass at this score or above, with no high-severity issue and no errors (default 7). */
  passScore?: number;
  /** Issues kept, most severe first (default 5). */
  maxIssues?: number;
};

const RANK = { high: 0, medium: 1, low: 2 } as const;

/** Issues most severe first (stable within a severity, so the critic's own order breaks ties), at most `max`. */
export function rankIssues(issues: Issue[], max = 5): Issue[] {
  return [...issues].sort((a, b) => RANK[a.severity] - RANK[b.severity]).slice(0, max);
}

export async function runCritic(llm: Llm, input: CriticInput, opts: CriticOpts = {}): Promise<CriticReport> {
  const { slide, board, shots, errors } = input;
  const user: Part[] = [
    {
      type: "text",
      text: [
        `Slide ${slide.id}. Title: "${slide.title}".`,
        `Storyboard intent:\n${JSON.stringify(board, null, 2)}`,
        ...(input.instruction ? [`The presenter then asked for this change, which outranks the storyboard: ${input.instruction}`] : []),
        `On-slide copy:\n${JSON.stringify({ kicker: slide.kicker, subtitle: slide.subtitle, callouts: slide.callouts }, null, 2)}`,
        `The slide reports ${input.steps} step(s); the storyboard planned ${board.steps.length}.`,
        `Console and page errors:\n${errors.length ? errors.map((e) => `- ${e}`).join("\n") : "- (none)"}`,
        `Measured by the pre-check (facts from the rendered page, not guesses):\n${input.measured?.length ? input.measured.map((m) => `- ${m}`).join("\n") : "- (nothing flagged)"}`,
        `Screenshots follow (${shots.length} of ${input.steps} steps, rendered at 1920×1080 and downscaled).`,
      ].join("\n\n"),
    },
  ];
  for (const s of shots) {
    user.push({ type: "text", text: `Step ${s.step + 1} of ${input.steps}:` });
    user.push({ type: "image", ...s.image });
  }
  const { data } = await llm.callTool({
    label: `critic:${slide.id}`,
    model: opts.model ?? MODELS.sonnet,
    // The same for every review, and reviews of different slides arrive at different times: worth caching.
    system: [{ text: loadPrompt("critic"), cache: true }],
    user,
    maxTokens: 12000,
    thinking: opts.thinking ?? "off",
    tool: { name: "review_slide", description: "Record the review of this slide.", schema: CriticReport },
  });
  return settle(data, errors.length, opts);
}

/**
 * The verdict, decided here from the review rather than taken on trust: pass at `passScore` or above with no
 * high-severity issue and no errors, otherwise fix. Issues are ranked and capped.
 */
export function settle(r: CriticReport, errorCount: number, opts: Pick<CriticOpts, "passScore" | "maxIssues"> = {}): CriticReport {
  const issues = rankIssues(r.issues, opts.maxIssues ?? 5);
  const pass = errorCount === 0 && !issues.some((i) => i.severity === "high") && r.score >= (opts.passScore ?? 7);
  return { ...r, verdict: pass ? "pass" : "fix", issues };
}

/** Stop rule: another round is not worth it when no errors remain and every issue left is low severity. */
export function onlyNits(r: CriticReport, errorCount: number): boolean {
  return errorCount === 0 && r.issues.every((i) => i.severity === "low");
}

/** At most `max` steps for review: always the first and the last, the rest evenly spaced (keeps requests small). */
export function sampleSteps<T>(shots: T[], max = 3): T[] {
  if (shots.length <= max) return shots;
  const idx = new Set<number>();
  for (let k = 0; k < max; k++) idx.add(Math.round((k * (shots.length - 1)) / (max - 1)));
  return [...idx].sort((a, b) => a - b).map((i) => shots[i]!);
}

/** Ranks attempts so the build keeps the best one: a pass beats any fix; then score, then fewer serious issues. */
export function attemptScore(r: CriticReport, errorCount: number): number {
  const weight = { high: 3, medium: 1, low: 0.25 } as const;
  const penalty = r.issues.reduce((sum, i) => sum + weight[i.severity], 0) + errorCount * 3;
  return (r.verdict === "pass" ? 1000 : 0) + r.score * 10 - penalty;
}
