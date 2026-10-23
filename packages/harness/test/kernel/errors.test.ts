import { describe, expect, it } from "vitest";
import {
  BudgetError,
  CancelledError,
  CorruptArtifactError,
  ERROR_KINDS,
  errorFromInfo,
  errorInfo,
  OWNERSHIP_LOST,
  HarnessError,
  InputError,
  InternalError,
  LlmAuthError,
  LlmBadRequestError,
  LlmConfigError,
  LlmQuotaError,
  LlmRefusalError,
  LlmTransientError,
  LlmUnreachableError,
  RenderFailedError,
  TimeoutError,
  toHarnessError,
  ValidationError,
  type ErrorKind,
} from "../../src/kernel/errors.ts";

const issues = [{ path: "slides", code: "slide-count", message: "has 9 slides; standard needs 10–14" }];

const one: Record<ErrorKind, HarnessError> = {
  input: new InputError("bad brief"),
  validation: new ValidationError(issues, 3),
  timeout: new TimeoutError("content", 90_000),
  budget: new BudgetError(250_123, 250_000),
  cancelled: new CancelledError(),
  llm_unreachable: new LlmUnreachableError("http://localhost:1234"),
  llm_config: new LlmConfigError("no controls"),
  llm_auth: new LlmAuthError("LLM_API_KEY rejected"),
  llm_quota: new LlmQuotaError("credit balance is too low"),
  llm_transient: new LlmTransientError("529 overloaded", { status: 529 }),
  llm_refusal: new LlmRefusalError("cyber"),
  llm_bad_request: new LlmBadRequestError("400 bad"),
  render: new RenderFailedError("chromium crashed"),
  internal: new InternalError("bug"),
};

describe("error taxonomy", () => {
  it("covers every kind with a subclass of HarnessError and Error", () => {
    expect(Object.keys(one).sort()).toEqual([...ERROR_KINDS].sort());
    for (const [kind, e] of Object.entries(one)) {
      expect(e).toBeInstanceOf(HarnessError);
      expect(e).toBeInstanceOf(Error);
      expect(e.kind).toBe(kind);
      expect(e.name).toBe(e.constructor.name);
    }
  });

  it("only LlmTransientError is retryable", () => {
    const retryable = Object.values(one).filter((e) => e.retryable);
    expect(retryable).toEqual([one.llm_transient]);
  });

  it("exact §1a message", () => {
    expect(new LlmUnreachableError("http://localhost:4321").message).toBe(
      "LLM proxy not reachable at http://localhost:4321 — start it with: cd ~/Documents/Cursor-Projects/claude-openai && bash start.sh",
    );
  });

  it("BudgetError grouping", () => {
    const e = new BudgetError(250_123, 250_000);
    expect(e.message).toBe("token budget exceeded: 250,123 > 250,000");
    expect(e.used).toBe(250_123);
    expect(e.cap).toBe(250_000);
    expect(new BudgetError(1_250_000, 1_000).message).toBe("token budget exceeded: 1,250,000 > 1,000");
    expect(new BudgetError(250_000, 250_000).message).toBe("token budget exhausted: 250,000 of 250,000");
  });

  it('CancelledError("ownership lost").message', () => {
    const e = new CancelledError("ownership lost");
    expect(e.message).toBe("ownership lost");
    expect(e.reason).toBe("ownership lost");
    expect(new CancelledError().message).toBe("cancelled");
  });

  it("TimeoutError message names stage and ms", () => {
    const e = new TimeoutError("content", 90_000);
    expect(e.message).toBe("stage content exceeded 90000 ms");
    expect(e.stage).toBe("content");
    expect(e.ms).toBe(90_000);
  });

  it("CorruptArtifactError is an input error naming the file", () => {
    const e = new CorruptArtifactError("j_1/accepted/deck.json");
    const kind: "input" = e.kind;
    expect(kind).toBe("input");
    expect(e).toBeInstanceOf(InputError);
    expect(e.relPath).toBe("j_1/accepted/deck.json");
    expect(e.message).toBe("artifact j_1/accepted/deck.json is missing or invalid");
  });

  it("ValidationError carries issues and attempts", () => {
    const e = new ValidationError(issues, 3);
    expect(e.issues).toEqual(issues);
    expect(e.attempts).toBe(3);
    expect(e.message).toBe(
      "output failed validation after 3 attempts:\n- slides: has 9 slides; standard needs 10–14 (slide-count)",
    );
  });

  it("LlmRefusalError keeps the category", () => {
    expect(new LlmRefusalError("cyber").category).toBe("cyber");
    expect(new LlmRefusalError("cyber").message).toBe("the model refused the request (cyber)");
    expect(new LlmRefusalError().message).toBe("the model refused the request");
  });

  it("toHarnessError wraps unknown", () => {
    const known = new InputError("x");
    expect(toHarnessError(known)).toBe(known);

    const cause = new TypeError("boom");
    const wrapped = toHarnessError(cause);
    expect(wrapped).toBeInstanceOf(InternalError);
    expect(wrapped.message).toBe("boom");
    expect(wrapped.cause).toBe(cause);

    expect(toHarnessError("weird").message).toBe("weird");
    expect(toHarnessError(undefined).kind).toBe("internal");
  });

  it("ownership lost has one spelling", () => {
    expect(OWNERSHIP_LOST).toBe("ownership lost");
    const e = CancelledError.ownershipLost();
    expect(e).toBeInstanceOf(CancelledError);
    expect(e.message).toBe(OWNERSHIP_LOST);
    expect(e.reason).toBe(OWNERSHIP_LOST);
  });

  it("toHarnessError maps an AbortError (the default abort() reason) to CancelledError", () => {
    const ac = new AbortController();
    ac.abort();
    const fromSignal = toHarnessError(ac.signal.reason);
    expect(fromSignal).toBeInstanceOf(CancelledError);
    expect(fromSignal.message).toBe("cancelled");
    expect(fromSignal.cause).toBe(ac.signal.reason);
    expect(toHarnessError(new DOMException("x", "AbortError")).kind).toBe("cancelled");
    expect(toHarnessError(new DOMException("x", "TimeoutError")).kind).toBe("internal");
  });

  it("errorFromInfo rebuilds every kind with its class, kind and message", () => {
    for (const original of Object.values(one)) {
      const info = errorInfo(original);
      const rebuilt = errorFromInfo(info);
      expect(rebuilt.constructor).toBe(original.constructor);
      expect(rebuilt.kind).toBe(original.kind);
      expect(rebuilt.message).toBe(original.message);
      expect(rebuilt.retryable).toBe(original.retryable);
      expect(errorInfo(rebuilt)).toEqual(info);
    }
  });

  it("errorFromInfo recovers structured fields from canonical messages", () => {
    const timeout = errorFromInfo(errorInfo(new TimeoutError("qa", 60_000)));
    expect(timeout).toMatchObject({ stage: "qa", ms: 60_000 });
    expect(errorFromInfo(errorInfo(new BudgetError(250_123, 250_000)))).toMatchObject({ used: 250_123, cap: 250_000 });
    expect(errorFromInfo(errorInfo(new LlmUnreachableError("http://localhost:1234")))).toMatchObject({ baseUrl: "http://localhost:1234" });
    expect(errorFromInfo(errorInfo(new LlmRefusalError("cyber")))).toMatchObject({ category: "cyber" });
    expect(errorFromInfo(errorInfo(new ValidationError(issues, 3)))).toMatchObject({ issues, attempts: 3 });
    expect(errorFromInfo(errorInfo(new CancelledError("ownership lost")))).toMatchObject({ reason: "ownership lost" });
    const corrupt = errorFromInfo(errorInfo(new CorruptArtifactError("j_1/accepted/deck.json")));
    expect(corrupt).toBeInstanceOf(CorruptArtifactError);
    expect(corrupt).toMatchObject({ relPath: "j_1/accepted/deck.json" });
  });

  it("errorFromInfo keeps a non-canonical message verbatim", () => {
    const e = errorFromInfo({ kind: "timeout", message: "took too long" });
    expect(e).toBeInstanceOf(TimeoutError);
    expect(e.message).toBe("took too long");
    expect(errorFromInfo({ kind: "llm_transient", message: "529" })).toMatchObject({ kind: "llm_transient", message: "529", retryable: true });
    expect(errorFromInfo({ kind: "input", message: "bad brief" }).constructor).toBe(InputError);
  });

  it("errorInfo is a plain serialisable record", () => {
    expect(errorInfo(new TimeoutError("qa", 60_000))).toEqual({ kind: "timeout", message: "stage qa exceeded 60000 ms" });
    expect(errorInfo(new ValidationError(issues, 2))).toEqual({
      kind: "validation",
      message: new ValidationError(issues, 2).message,
      issues,
    });
    expect(errorInfo(new Error("raw"))).toEqual({ kind: "internal", message: "raw" });
  });
});
