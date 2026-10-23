import { ZERO_USAGE, type AttemptRecord } from "../kernel/contracts.ts";
import { LlmRefusalError, ValidationError } from "../kernel/errors.ts";
import type { Issue } from "../kernel/issues.ts";
import type { LlmCompletion, LlmMessage, LlmRetryInfo } from "../kernel/llm-port.ts";
import type { StageContext } from "../kernel/stage.ts";
import {
  feedbackMessage,
  firstUserMessage,
  invalidFeedback,
  noToolCallFeedback,
  toLlmRequest,
  truncatedFeedback,
  type AgentRequest,
} from "./messages.ts";

/** Zod plus the catalog validators, applied to the normalised tool input. */
export type ParseResult<T> = { ok: true; value: T } | { ok: false; issues: Issue[] };

export type InvokeContext = Pick<StageContext, "llm" | "signal" | "retry" | "report" | "clock">;

type Verdict<T> =
  | { outcome: "ok"; value: T }
  | { outcome: "refusal" }
  | { outcome: "truncated" | "no-tool-call" | "invalid"; issues: Issue[]; detail: string; feedback: string };

/**
 * Calls the agent's tool until a reply parses, feeding each failure back on the same conversation
 * (append-only) for at most `ctx.retry.validation` corrective attempts.
 */
export async function invokeTool<T>(ctx: InvokeContext, req: AgentRequest, parse: (input: unknown) => ParseResult<T>): Promise<T> {
  const max = 1 + ctx.retry.validation;
  const messages: LlmMessage[] = [firstUserMessage(req)];
  const onRetry = (info: LlmRetryInfo) => {
    const { reason, attempt, maxAttempts, waitMs, detail, status } = info;
    ctx.report.retry({ reason, attempt, maxAttempts, waitMs, detail, ...(status === undefined ? {} : { status }) });
    if (reason === "rate-limit") ctx.report.extendDeadline(waitMs, "rate-limit");
  };
  let lastIssues: Issue[] = [];

  for (let n = 1; n <= max; n++) {
    ctx.report.beginAttempt();
    ctx.report.progress(`calling ${req.model} (attempt ${n}/${max})`);
    const started = ctx.clock.now();
    const durationMs = () => Math.max(0, Math.round(ctx.clock.now() - started));

    let c: LlmCompletion;
    try {
      c = await ctx.llm.complete(toLlmRequest(req, [...messages]), { signal: ctx.signal, onRetry });
    } catch (e) {
      ctx.report.attempt({ n, outcome: "error", usage: { ...ZERO_USAGE }, usageKnown: false, durationMs: durationMs() });
      throw e;
    }

    const verdict = judge(req, c, parse);
    ctx.report.attempt(attemptRecord(n, verdict, c, durationMs()));
    ctx.report.usage(c.usage);

    if (verdict.outcome === "refusal") throw new LlmRefusalError(c.refusalCategory);
    if (verdict.outcome === "ok") return verdict.value;
    lastIssues = verdict.issues;
    if (n === max) break;
    ctx.report.retry({ reason: "validation", attempt: n, maxAttempts: max, waitMs: 0, detail: verdict.detail });
    messages.push(c.turn, feedbackMessage(c, verdict.feedback));
  }
  throw new ValidationError(lastIssues, max);
}

// Order: refusal, truncation, no tool call, then validation. A truncated call is never parsed.
function judge<T>(req: AgentRequest, c: LlmCompletion, parse: (input: unknown) => ParseResult<T>): Verdict<T> {
  const tool = req.tool.name;
  if (c.stopReason === "refusal") return { outcome: "refusal" };
  if (c.stopReason === "max_tokens") {
    const message = `the reply was cut off at max_tokens (${req.maxTokens}) before the ${tool} call was complete`;
    return { outcome: "truncated", issues: [{ path: "", code: "truncated", message }], detail: message, feedback: truncatedFeedback(tool, req.maxTokens) };
  }
  if (!c.toolCall) {
    const message = `the reply did not call ${tool}`;
    return { outcome: "no-tool-call", issues: [{ path: "", code: "no-tool-call", message }], detail: message, feedback: noToolCallFeedback(tool) };
  }
  const result = parse(req.normalize(c.toolCall.input));
  if (result.ok) return { outcome: "ok", value: result.value };
  const { issues } = result;
  const detail = `${issues.length} issue${issues.length === 1 ? "" : "s"}: ${issues[0]?.message ?? "invalid output"}`;
  return { outcome: "invalid", issues, detail, feedback: invalidFeedback(tool, issues) };
}

function attemptRecord(n: number, v: Verdict<unknown>, c: LlmCompletion, durationMs: number): AttemptRecord {
  const base = { n, usage: { ...c.usage }, usageKnown: true, durationMs };
  if (v.outcome === "ok") return { ...base, outcome: "ok" };
  if (v.outcome === "refusal") return { ...base, outcome: "error" };
  return { ...base, outcome: v.outcome, issues: v.issues };
}
