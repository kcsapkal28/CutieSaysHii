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
  readonly kind = "input" as const;
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

export const OWNERSHIP_LOST = "ownership lost";

export class CancelledError extends HarnessError {
  readonly kind = "cancelled";
  readonly reason: string;

  constructor(reason = "cancelled", options?: ErrorOptions) {
    super(reason, options);
    this.reason = reason;
  }

  /** A fenced write affected 0 rows, or the heartbeat found another owner. */
  static ownershipLost(): CancelledError {
    return new CancelledError(OWNERSHIP_LOST);
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

const isAbortError = (e: unknown) =>
  typeof e === "object" && e !== null && (e as { name?: unknown }).name === "AbortError";

export function toHarnessError(e: unknown): HarnessError {
  if (e instanceof HarnessError) return e;
  // The default reason of AbortController#abort() and of aborted fetches.
  if (isAbortError(e)) return new CancelledError("cancelled", { cause: e });
  if (e instanceof Error) return new InternalError(e.message, { cause: e });
  return new InternalError(typeof e === "string" ? e : `non-error thrown: ${String(e)}`, { cause: e });
}

export function errorInfo(e: unknown): ErrorInfo {
  const h = toHarnessError(e);
  return h instanceof ValidationError
    ? { kind: h.kind, message: h.message, issues: h.issues }
    : { kind: h.kind, message: h.message };
}

const match = (re: RegExp, message: string) => re.exec(message)?.slice(1);
const ungroup = (n: string) => Number(n.replaceAll(",", ""));

/**
 * Rebuilds a HarnessError from its stored or scripted ErrorInfo. The message is kept verbatim;
 * structured fields are recovered when the message has its canonical form.
 */
export function errorFromInfo(info: ErrorInfo): HarnessError {
  const { message } = info;
  const e = rebuild(info);
  e.message = message;
  return e;
}

function rebuild({ kind, message, issues }: ErrorInfo): HarnessError {
  switch (kind) {
    case "input": {
      const [relPath] = match(/^artifact (.+) is missing or invalid$/, message) ?? [];
      return relPath ? new CorruptArtifactError(relPath) : new InputError(message);
    }
    case "validation": {
      const [n] = match(/^output failed validation after (\d+) attempts?:/, message) ?? [];
      return new ValidationError(issues ?? [], n ? Number(n) : 0);
    }
    case "timeout": {
      // A runtime STAGE_NAMES import would cycle with contracts.ts; the canonical message only ever names a stage.
      const [stage, ms] = match(/^stage (\S+) exceeded (\d+) ms$/, message) ?? ["content", "0"];
      return new TimeoutError(stage as StageName, Number(ms));
    }
    case "budget": {
      const [used, cap] =
        match(/^token budget exceeded: ([\d,]+) > ([\d,]+)$/, message) ??
        match(/^token budget exhausted: ([\d,]+) of ([\d,]+)$/, message) ??
        [];
      return new BudgetError(used ? ungroup(used) : 0, cap ? ungroup(cap) : 0);
    }
    case "cancelled":
      return new CancelledError(message);
    case "llm_unreachable": {
      const [baseUrl] = match(/^LLM proxy not reachable at (\S+) — /, message) ?? [];
      return new LlmUnreachableError(baseUrl ?? "");
    }
    case "llm_config":
      return new LlmConfigError(message);
    case "llm_auth":
      return new LlmAuthError(message);
    case "llm_quota":
      return new LlmQuotaError(message);
    case "llm_transient":
      return new LlmTransientError(message);
    case "llm_refusal": {
      const [category] = match(/^the model refused the request \((.+)\)$/, message) ?? [];
      return new LlmRefusalError(category ?? null);
    }
    case "llm_bad_request":
      return new LlmBadRequestError(message);
    case "render":
      return new RenderFailedError(message);
    case "internal":
      return new InternalError(message);
  }
}
