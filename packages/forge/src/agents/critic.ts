// Critic (Opus, vision): every step's screenshot + console errors + storyboard intent → { verdict, issues }.
import { MODELS, type Llm, type Part } from "../llm.ts";
import { loadPrompt } from "./prompts.ts";
import { CriticReport, type ScriptSlide, type StoryboardSlide } from "./schemas.ts";

export type CriticInput = {
  slide: ScriptSlide;
  board: StoryboardSlide;
  /** Screenshots in step order. */
  shots: { step: number; png: Buffer }[];
  /** Steps the slide reported (from the shooter). */
  steps: number;
  errors: string[];
};

export async function runCritic(llm: Llm, input: CriticInput, opts: { model?: string } = {}): Promise<CriticReport> {
  const { slide, board, shots, errors } = input;
  const user: Part[] = [
    {
      type: "text",
      text: [
        `Slide ${slide.id}. Title: "${slide.title}".`,
        `Storyboard intent:\n${JSON.stringify(board, null, 2)}`,
        `On-slide copy:\n${JSON.stringify({ kicker: slide.kicker, subtitle: slide.subtitle, callouts: slide.callouts }, null, 2)}`,
        `The slide reports ${input.steps} step(s); the storyboard planned ${board.steps.length}.`,
        `Console and page errors:\n${errors.length ? errors.map((e) => `- ${e}`).join("\n") : "- (none)"}`,
        `Screenshots follow, one per step (${shots.length}).`,
      ].join("\n\n"),
    },
  ];
  for (const s of shots) {
    user.push({ type: "text", text: `Step ${s.step + 1} of ${input.steps}:` });
    user.push({ type: "image", png: s.png });
  }
  const { data } = await llm.callTool({
    label: `critic:${slide.id}`,
    model: opts.model ?? MODELS.opus,
    system: loadPrompt("critic"),
    user,
    maxTokens: 6000,
    tool: { name: "review_slide", description: "Record the review of this slide.", schema: CriticReport },
  });
  // Errors and high-severity issues always block a pass.
  const blocked = errors.length > 0 || data.issues.some((i) => i.severity === "high");
  return blocked && data.verdict === "pass" ? { ...data, verdict: "fix" } : data;
}

/** Ranks attempts so the build keeps the best one: a pass beats any fix; then score, then fewer serious issues. */
export function attemptScore(r: CriticReport, errorCount: number): number {
  const weight = { high: 3, medium: 1, low: 0.25 } as const;
  const penalty = r.issues.reduce((sum, i) => sum + weight[i.severity], 0) + errorCount * 3;
  return (r.verdict === "pass" ? 1000 : 0) + r.score * 10 - penalty;
}
