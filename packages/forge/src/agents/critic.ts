// Critic (Opus, vision): the steps' screenshots + console errors + storyboard intent → { verdict, issues }.
import { MODELS, type ImageData, type Llm, type Part } from "../llm.ts";
import { loadPrompt } from "./prompts.ts";
import { CriticReport, type ScriptSlide, type StoryboardSlide } from "./schemas.ts";

export type CriticInput = {
  slide: ScriptSlide;
  board: StoryboardSlide;
  /** Screenshots in step order (already downscaled; see sampleSteps for how many to send). */
  shots: { step: number; image: ImageData }[];
  /** Steps the slide reported (from the shooter). */
  steps: number;
  errors: string[];
  /** A presenter's change request this version was built for; it outranks the storyboard. */
  instruction?: string;
};

export async function runCritic(llm: Llm, input: CriticInput, opts: { model?: string } = {}): Promise<CriticReport> {
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
    model: opts.model ?? MODELS.opus,
    system: loadPrompt("critic"),
    user,
    maxTokens: 12000,
    tool: { name: "review_slide", description: "Record the review of this slide.", schema: CriticReport },
  });
  // Errors and high-severity issues always block a pass.
  const blocked = errors.length > 0 || data.issues.some((i) => i.severity === "high");
  return blocked && data.verdict === "pass" ? { ...data, verdict: "fix" } : data;
}

/** At most `max` steps for review: always the first and the last, the rest evenly spaced (keeps requests small). */
export function sampleSteps<T>(shots: T[], max = 4): T[] {
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
