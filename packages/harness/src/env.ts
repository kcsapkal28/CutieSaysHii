import { join } from "node:path";
import { z } from "zod";
import { InputError } from "./kernel/errors.ts";

/** The local claude-openai proxy's Anthropic passthrough (spec §1a). */
export const DEFAULT_LLM_BASE_URL = "http://localhost:4001";
export const ANTHROPIC_ORIGIN = "https://api.anthropic.com";
export const MODEL_ID = /^claude-[a-z0-9-]+$/;
export const DEFAULT_MODELS = { content: "claude-sonnet-5-5", design: "claude-sonnet-5-5", fast: "claude-haiku-5-5" } as const;
/** Spike S6: the server-side fallback beta is accepted through the proxy. */
export const REFUSAL_FALLBACK_DEFAULT = true;
export const DEFAULT_JOBS_DIR = "jobs";
export const DEFAULT_TOKEN_BUDGET = 250_000;

export type LlmEnv = {
  baseUrl: string;
  apiKey: string;
  models: { content: string; design: string; fast: string };
  refusalFallback: boolean;
  /** Send `x-proxy-max-retries: 0` and require the proxy's `x-proxy-controls: 1` marker. */
  proxyControls: boolean;
};

export type Env = { llm: LlmEnv; jobsDir: string; dbPath: string; tokenBudget: number };

export class EnvError extends InputError {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`invalid environment (see .env.example):\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.problems = problems;
  }
}

type Parsed<T> = { ok: T } | { error: string };

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

/** An optional variable: blank counts as unset; a set value must parse, and the issue names the variable. */
function optional<T>(name: string, parse: (raw: string) => Parsed<T>) {
  return z.preprocess(blank, z.string().optional()).transform((raw, ctx): T | undefined => {
    if (raw === undefined) return undefined;
    const r = parse(raw);
    if ("ok" in r) return r.ok;
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${name} ${r.error}` });
    return z.NEVER;
  });
}

function httpUrl(raw: string): Parsed<string> {
  const trimmed = raw.trim().replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { error: `must be an http(s) URL (got "${raw}")` };
  }
  return url.protocol === "http:" || url.protocol === "https:" ? { ok: trimmed } : { error: `must be an http(s) URL (got "${raw}")` };
}

function modelId(raw: string): Parsed<string> {
  return MODEL_ID.test(raw) ? { ok: raw } : { error: `must be a full Claude model id matching ${MODEL_ID} (got "${raw}")` };
}

const TRUE = new Set(["1", "true", "yes", "on"]);
const FALSE = new Set(["0", "false", "no", "off"]);

function flag(raw: string): Parsed<boolean> {
  const v = raw.trim().toLowerCase();
  if (TRUE.has(v)) return { ok: true };
  if (FALSE.has(v)) return { ok: false };
  return { error: `must be one of 1/0, true/false, yes/no, on/off (got "${raw}")` };
}

function positiveInt(raw: string): Parsed<number> {
  const n = Number(raw.trim());
  return /^\d+$/.test(raw.trim()) && Number.isSafeInteger(n) && n > 0 ? { ok: n } : { error: `must be a positive integer (got "${raw}")` };
}

const path = (raw: string): Parsed<string> => ({ ok: raw.trim() });

const EnvSourceSchema = z.object({
  LLM_BASE_URL: optional("LLM_BASE_URL", httpUrl),
  LLM_API_KEY: z.preprocess(
    blank,
    z.string({
      required_error:
        "LLM_API_KEY is required: the claude-openai proxy's shared key, or an Anthropic API key when LLM_BASE_URL is https://api.anthropic.com",
    }),
  ),
  LLM_MODEL_CONTENT: optional("LLM_MODEL_CONTENT", modelId),
  LLM_MODEL_DESIGN: optional("LLM_MODEL_DESIGN", modelId),
  LLM_MODEL_FAST: optional("LLM_MODEL_FAST", modelId),
  LLM_REFUSAL_FALLBACK: optional("LLM_REFUSAL_FALLBACK", flag),
  LLM_PROXY_CONTROLS: optional("LLM_PROXY_CONTROLS", flag),
  DECKFORGE_JOBS_DIR: optional("DECKFORGE_JOBS_DIR", path),
  DECKFORGE_DB_PATH: optional("DECKFORGE_DB_PATH", path),
  DECKFORGE_TOKEN_BUDGET: optional("DECKFORGE_TOKEN_BUDGET", positiveInt),
});

/** Reads and validates the harness configuration once, at startup. Values are never echoed for LLM_API_KEY. */
export function loadEnv(source: Readonly<Record<string, string | undefined>> = process.env): Env {
  const parsed = EnvSourceSchema.safeParse(source);
  if (!parsed.success) throw new EnvError(parsed.error.issues.map((i) => i.message));
  const v = parsed.data;

  const baseUrl = v.LLM_BASE_URL ?? DEFAULT_LLM_BASE_URL;
  const jobsDir = v.DECKFORGE_JOBS_DIR ?? DEFAULT_JOBS_DIR;
  return {
    llm: {
      baseUrl,
      apiKey: v.LLM_API_KEY,
      models: {
        content: v.LLM_MODEL_CONTENT ?? DEFAULT_MODELS.content,
        design: v.LLM_MODEL_DESIGN ?? DEFAULT_MODELS.design,
        fast: v.LLM_MODEL_FAST ?? DEFAULT_MODELS.fast,
      },
      refusalFallback: v.LLM_REFUSAL_FALLBACK ?? REFUSAL_FALLBACK_DEFAULT,
      proxyControls: v.LLM_PROXY_CONTROLS ?? new URL(baseUrl).origin !== ANTHROPIC_ORIGIN,
    },
    jobsDir,
    dbPath: v.DECKFORGE_DB_PATH ?? join(jobsDir, "deckforge.sqlite"),
    tokenBudget: v.DECKFORGE_TOKEN_BUDGET ?? DEFAULT_TOKEN_BUDGET,
  };
}
