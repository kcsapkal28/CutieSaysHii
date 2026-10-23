import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { describe, expect, it } from "vitest";
import { EnvError, loadEnv } from "../src/env.ts";
import { InputError } from "../src/kernel/errors.ts";

const KEY = { LLM_API_KEY: "test-key" };

const envError = (source: Record<string, string | undefined>): EnvError => {
  try {
    loadEnv(source);
  } catch (e) {
    if (e instanceof EnvError) return e;
    throw e;
  }
  throw new Error("loadEnv accepted the source");
};

describe("loadEnv", () => {
  it("defaults", () => {
    expect(loadEnv(KEY)).toEqual({
      llm: {
        baseUrl: "http://localhost:4001",
        apiKey: "test-key",
        models: { content: "claude-sonnet-5-5", design: "claude-sonnet-5-5", fast: "claude-haiku-5-5" },
        refusalFallback: true,
        proxyControls: true,
      },
      jobsDir: "jobs",
      dbPath: "jobs/deckforge.sqlite",
      tokenBudget: 250_000,
    });
  });

  it("reads every variable", () => {
    const env = loadEnv({
      LLM_BASE_URL: "http://127.0.0.1:4010",
      LLM_API_KEY: "k",
      LLM_MODEL_CONTENT: "claude-opus-5-5",
      LLM_MODEL_DESIGN: "claude-sonnet-5",
      LLM_MODEL_FAST: "claude-haiku-4-5-20251001",
      LLM_REFUSAL_FALLBACK: "0",
      LLM_PROXY_CONTROLS: "false",
      DECKFORGE_JOBS_DIR: "/tmp/df-jobs",
      DECKFORGE_TOKEN_BUDGET: "1000",
    });
    expect(env.llm.models).toEqual({ content: "claude-opus-5-5", design: "claude-sonnet-5", fast: "claude-haiku-4-5-20251001" });
    expect(env.llm.refusalFallback).toBe(false);
    expect(env.llm.proxyControls).toBe(false);
    expect(env.jobsDir).toBe("/tmp/df-jobs");
    expect(env.dbPath).toBe("/tmp/df-jobs/deckforge.sqlite");
    expect(env.tokenBudget).toBe(1000);
    expect(loadEnv({ ...KEY, DECKFORGE_DB_PATH: "/var/db/x.sqlite" }).dbPath).toBe("/var/db/x.sqlite");
  });

  it("treats empty values as unset", () => {
    expect(loadEnv({ ...KEY, LLM_BASE_URL: "", LLM_MODEL_FAST: "" })).toEqual(loadEnv(KEY));
  });

  it("missing LLM_API_KEY", () => {
    for (const source of [{}, { LLM_API_KEY: "" }, { LLM_API_KEY: "   " }]) {
      const e = envError(source);
      expect(e).toBeInstanceOf(InputError);
      expect(e.message).toContain("LLM_API_KEY is required");
    }
  });

  it('rejects "gpt-4o" and "sonnet"', () => {
    const e = envError({ ...KEY, LLM_MODEL_CONTENT: "gpt-4o", LLM_MODEL_FAST: "sonnet" });
    expect(e.message).toContain('LLM_MODEL_CONTENT must be a full Claude model id matching /^claude-[a-z0-9-]+$/ (got "gpt-4o")');
    expect(e.message).toContain('LLM_MODEL_FAST must be a full Claude model id matching /^claude-[a-z0-9-]+$/ (got "sonnet")');
  });

  it("rejects bad URLs, booleans and budgets, and never echoes the API key", () => {
    const e = envError({
      LLM_API_KEY: "sk-secret-value",
      LLM_BASE_URL: "localhost:4001",
      LLM_PROXY_CONTROLS: "maybe",
      DECKFORGE_TOKEN_BUDGET: "-5",
    });
    expect(e.message).toMatch(/LLM_BASE_URL must be an http\(s\) URL/);
    expect(e.message).toMatch(/LLM_PROXY_CONTROLS must be one of/);
    expect(e.message).toMatch(/DECKFORGE_TOKEN_BUDGET must be a positive integer/);
    expect(e.message).not.toContain("sk-secret-value");
  });

  it("trailing slash", () => {
    expect(loadEnv({ ...KEY, LLM_BASE_URL: "http://localhost:4001/" }).llm.baseUrl).toBe("http://localhost:4001");
    expect(loadEnv({ ...KEY, LLM_BASE_URL: "https://api.anthropic.com//" }).llm.baseUrl).toBe("https://api.anthropic.com");
    expect(loadEnv({ ...KEY, DECKFORGE_JOBS_DIR: "out/" }).dbPath).toBe("out/deckforge.sqlite");
  });

  it("proxyControls false for https://api.anthropic.com", () => {
    expect(loadEnv({ ...KEY, LLM_BASE_URL: "https://api.anthropic.com" }).llm.proxyControls).toBe(false);
    expect(loadEnv({ ...KEY, LLM_BASE_URL: "https://api.anthropic.com/" }).llm.proxyControls).toBe(false);
    expect(loadEnv({ ...KEY, LLM_BASE_URL: "http://api.anthropic.com" }).llm.proxyControls).toBe(true);
    expect(loadEnv({ ...KEY, LLM_BASE_URL: "https://api.anthropic.com", LLM_PROXY_CONTROLS: "1" }).llm.proxyControls).toBe(true);
  });
});

describe(".env.example", () => {
  const text = readFileSync(new URL("../../../.env.example", import.meta.url), "utf8");
  const example = parseEnv(text);

  it("lists the §1a vars with spec defaults", () => {
    expect(example).toMatchObject({
      LLM_BASE_URL: "http://localhost:4001",
      LLM_MODEL_CONTENT: "claude-sonnet-5-5",
      LLM_MODEL_DESIGN: "claude-sonnet-5-5",
      LLM_MODEL_FAST: "claude-haiku-5-5",
    });
    expect(example).toHaveProperty("LLM_API_KEY");
    for (const name of ["LLM_REFUSAL_FALLBACK", "LLM_PROXY_CONTROLS", "DECKFORGE_JOBS_DIR", "DECKFORGE_DB_PATH", "DECKFORGE_TOKEN_BUDGET"]) {
      expect(text).toContain(name);
    }
  });

  it("loads to the defaults, apart from the placeholder key", () => {
    const { llm, ...rest } = loadEnv(example);
    const defaults = loadEnv(KEY);
    expect({ ...llm, apiKey: "test-key" }).toEqual(defaults.llm);
    expect(rest).toEqual({ jobsDir: defaults.jobsDir, dbPath: defaults.dbPath, tokenBudget: defaults.tokenBudget });
  });

  it("holds a placeholder key, never a real one", () => {
    expect(example.LLM_API_KEY).toMatch(/^<.+>$/);
  });
});
