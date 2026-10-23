import { z } from "zod";
import type { StageName } from "./contracts.ts";
import { formatIssues, IssueSchema, type Issue } from "./issues.ts";

export const ERROR_KINDS = [
  "input",
  "validation",
  "timeout",
  "budget",
  "cancelled",
  "llm_unreachable",
  "llm_config",
  "llm_auth",
  "llm_quota",
  "llm_transient",
  "llm_refusal",
  "llm_bad_request",
  "render",
  "internal",
] as const;
export const ErrorKindSchema = z.enum(ERROR_KINDS);
export type ErrorKind = z.infer<typeof ErrorKindSchema>;

export const ErrorInfoSchema = z.object({
  kind: ErrorKindSchema,
  message: z.string(),
  issues: z.array(IssueSchema).optional(),
});
export type ErrorInfo = z.infer<typeof ErrorInfoSchema>;

export type LlmErrorOptions = ErrorOptions & { status?: number };

export abstract class HarnessError extends Error {
  abstract readonly kind: ErrorKind;
  /** Only transient LLM failures may be retried, and only inside the LLM adapter. */
  readonly retryable: boolean = false;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class InputError extends HarnessError {
  readonly kind: ErrorKind = "input";
}

export class CorruptArtifactError extends InputError {
  readonly relPath: string;

  constructor(relPath: string, options?: ErrorOptions) {
    super(`artifact ${relPath} is missing or invalid`, options);
    this.relPath = relPath;
  }
}

export class ValidationError extends HarnessError {
  readonly kind = "validation";
  readonly issues: Issue[];
  readonly attempts: number;

  constructor(issues: Issue[], attempts: number) {
    super(`output failed validation after ${attempts} attempt${attempts === 1 ? "" : "s"}:\n${formatIssues(issues)}`);
    this.issues = issues;
    this.attempts = attempts;
  }
}

export class TimeoutError extends HarnessError {
  readonly kind = "timeout";
  readonly stage: StageName;
  readonly ms: number;

  constructor(stage: StageName, ms: number) {
    super(`stage ${stage} exceeded ${ms} ms`);
    this.stage = stage;
    this.ms = ms;
  }
}

const grouped = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

export class BudgetError extends HarnessError {
  readonly kind = "budget";
  readonly used: number;
  readonly cap: number;

  constructor(used: number, cap: number) {
    super(
      used > cap
        ? `token budget exceeded: ${grouped(used)} > ${grouped(cap)}`
        : `token budget exhausted: ${grouped(used)} of ${grouped(cap)}`,
    );
    this.used = used;
    this.cap = cap;
  }
}

export class CancelledError extends HarnessError {
  readonly kind = "cancelled";
  readonly reason: string;

  constructor(reason = "cancelled") {
    super(reason);
    this.reason = reason;
  }
}

abstract class LlmError extends HarnessError {
  readonly status: number | undefined;

  constructor(message: string, options?: LlmErrorOptions) {
    super(message, options);
    this.status = options?.status;
  }
}

export class LlmUnreachableError extends LlmError {
  readonly kind = "llm_unreachable";
  readonly baseUrl: string;

  constructor(baseUrl: string, options?: LlmErrorOptions) {
    super(
      `LLM proxy not reachable at ${baseUrl} — start it with: cd ~/Documents/Cursor-Projects/claude-openai && bash start.sh`,
      options,
    );
    this.baseUrl = baseUrl;
  }
}

export class LlmConfigError extends LlmError {
  readonly kind = "llm_config";
}

export class LlmAuthError extends LlmError {
  readonly kind = "llm_auth";
}

export class LlmQuotaError extends LlmError {
  readonly kind = "llm_quota";
}

export class LlmTransientError extends LlmError {
  readonly kind = "llm_transient";
  override readonly retryable = true;
}

export class LlmRefusalError extends LlmError {
  readonly kind = "llm_refusal";
  readonly category: string | null;

  constructor(category: string | null = null, options?: LlmErrorOptions) {
    super(`the model refused the request${category ? ` (${category})` : ""}`, options);
    this.category = category;
  }
}

export class LlmBadRequestError extends LlmError {
  readonly kind = "llm_bad_request";
}

export class RenderFailedError extends HarnessError {
  readonly kind = "render";
}

export class InternalError extends HarnessError {
  readonly kind = "internal";
}

export function toHarnessError(e: unknown): HarnessError {
  if (e instanceof HarnessError) return e;
  if (e instanceof Error) return new InternalError(e.message, { cause: e });
  return new InternalError(typeof e === "string" ? e : `non-error thrown: ${String(e)}`, { cause: e });
}

export function errorInfo(e: unknown): ErrorInfo {
  const h = toHarnessError(e);
  return h instanceof ValidationError
    ? { kind: h.kind, message: h.message, issues: h.issues }
    : { kind: h.kind, message: h.message };
}
