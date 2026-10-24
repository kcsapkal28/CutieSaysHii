// The one LLM client every agent goes through: tool-forced structured output (Zod-validated) and plain text,
// via the local claude-openai proxy (Anthropic Messages passthrough). Ported and simplified from feat/harness.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic, { APIConnectionError, APIConnectionTimeoutError, APIError, APIUserAbortError } from "@anthropic-ai/sdk";
import { z } from "zod";
import { toJsonSchema } from "./agents/json-schema.ts";

export const MODELS = { opus: "claude-opus-5-5", sonnet: "claude-sonnet-5-5" } as const;
export const DEFAULT_BASE_URL = "http://localhost:4001";
const DEFAULT_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_MAX_RETRIES = 4;
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 20_000;

export type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number };
export const ZERO_USAGE: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
export function addUsage(a: Usage, b: Usage): Usage {
  return { input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite };
}

export type ImageData = { data: Buffer; mediaType: "image/png" | "image/jpeg" };
/** A user-turn content part: text, or an image (critic screenshots). */
export type Part = { type: "text"; text: string } | ({ type: "image" } & ImageData);
/**
 * A system prompt block. `cache: true` puts a cache breakpoint at its end: mark only a prefix that later calls resend
 * byte for byte. A plain string system prompt is never cached (most calls are one-shot or start in parallel, so a
 * cache write there is a 25% surcharge nobody reads back).
 */
export type SystemBlock = { text: string; cache?: boolean };
/** "off": no thinking before the answer (fast, cheap); "model": the model's own adaptive thinking. */
/** "off" = no thinking (low effort on Opus, which can't turn it off); an effort level; "model" = the model's own default. */
export type Thinking = "off" | "low" | "medium" | "high" | "model";

type CallBase = {
  /** Who is calling (e.g. "storyboarder", "builder:s03"): shows up in usage records and errors. */
  label: string;
  model: string;
  system: string | SystemBlock[];
  user: string | Part[];
  maxTokens?: number;
  temperature?: number;
  /** Default "off" (see wireThinking); "model" only where thinking measurably pays. */
  thinking?: Thinking;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type ToolCallOpts<S extends z.ZodTypeAny> = CallBase & {
  tool: { name: string; description: string; schema: S };
  /** Corrective retries after invalid output, each with the error fed back (default 1). */
  validationRetries?: number;
};

export type CallRecord = {
  label: string;
  model: string;
  ms: number;
  usage: Usage;
  attempts: number;
  /** Why each earlier round of this call was rejected (schema/check problems fed back to the model), when any. */
  problems?: string[];
};
export type ToolResult<T> = CallRecord & { data: T };
export type TextResult = CallRecord & { text: string };

/** A cache pre-warm: the request a later callTool sends, minus its user turn, with max_tokens 0. */
export type WarmOpts = Pick<ToolCallOpts<z.ZodTypeAny>, "label" | "model" | "system" | "thinking" | "tool" | "timeoutMs" | "signal">;

export interface Llm {
  callTool<S extends z.ZodTypeAny>(opts: ToolCallOpts<S>): Promise<ToolResult<z.infer<S>>>;
  callText(opts: CallBase): Promise<TextResult>;
  /**
   * Writes the cache for `system`'s marked blocks (with the tool) without generating anything, so calls that start
   * together read that prefix instead of each writing it. Optional: wrappers and fakes may leave it out.
   */
  warm?(opts: WarmOpts): Promise<CallRecord>;
}

// ---- transport: the only part that touches the network (tests swap it) ----

export type WireContent =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: ImageData["mediaType"]; data: string } }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };
export type WireMessage = { role: "user" | "assistant"; content: WireContent[] };
export type WireSystemBlock = { type: "text"; text: string; cache_control?: { type: "ephemeral" } };
export type WireRequest = {
  model: string;
  max_tokens: number;
  system: string | WireSystemBlock[];
  messages: WireMessage[];
  temperature?: number;
  tools?: { name: string; description: string; input_schema: Record<string, unknown> }[];
  tool_choice?: { type: "auto" };
  /** These models reject {type:"disabled"}; "between_tools" means no thinking before answering (Sonnet only). */
  thinking?: { type: "between_tools" };
  /** Opus can't turn thinking off (between_tools is a 400 there): low effort is the closest. */
  output_config?: { effort: "low" | "medium" | "high" };
};
export type WireResponse = {
  content: WireContent[];
  stop_reason: string | null;
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };
};
export type Transport = (req: WireRequest, opts: { signal: AbortSignal }) => Promise<WireResponse>;

export class LlmError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LlmError";
  }
}

// ---- env ----

/** Finds the nearest `.env` walking up from `start` (worktrees resolve to the main checkout's file). */
export function findDotEnv(start: string): string | undefined {
  for (let dir = start; ; dir = dirname(dir)) {
    const file = join(dir, ".env");
    if (existsSync(file)) return file;
    if (dirname(dir) === dir) return undefined;
  }
}

function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trimStart().startsWith("#")) continue;
    out[m[1]!] = m[2]!.replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

export type LlmEnv = { baseUrl: string; apiKey: string };

/** `LLM_BASE_URL` / `LLM_API_KEY` from the process env, else the nearest `.env`. Never logs the key. */
export function loadLlmEnv(env: NodeJS.ProcessEnv = process.env, start = dirname(fileURLToPath(import.meta.url))): LlmEnv {
  const file = findDotEnv(start);
  const fromFile = file ? parseDotEnv(readFileSync(file, "utf8")) : {};
  const baseUrl = (env.LLM_BASE_URL || fromFile.LLM_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const apiKey = env.LLM_API_KEY || fromFile.LLM_API_KEY || "";
  if (!apiKey) throw new LlmError("LLM_API_KEY is not set (process env or repo-root .env)");
  return { baseUrl, apiKey };
}

// ---- real transport ----

export function sdkTransport({ baseUrl, apiKey }: LlmEnv): Transport {
  // SDK 1.x sends the key as `Authorization: Bearer`, which the proxy expects; retries are ours, so the SDK's are off.
  // The SDK's own timeout is a backstop; each call's timeoutMs (an abort signal) is what governs.
  const client = new Anthropic({ baseURL: baseUrl, apiKey, maxRetries: 0, timeout: 30 * 60_000 });
  return async (req, { signal }) => {
    // A cache pre-warm (max_tokens 0) is rejected when streamed, and returns at once anyway.
    if (req.max_tokens === 0) {
      return (await client.messages.create(req as Anthropic.MessageCreateParamsNonStreaming, { signal })) as unknown as WireResponse;
    }
    // Streaming avoids the SDK's non-streaming guard on large max_tokens (builder output).
    const stream = client.messages.stream(req as Anthropic.MessageStreamParams, { signal });
    return (await stream.finalMessage()) as unknown as WireResponse;
  };
}

// ---- client ----

/**
 * A call's thinking setting on the wire. "off" (the default) is between_tools on Sonnet; Opus rejects both
 * between_tools and disabled, so there "off" means low effort. "model" sends nothing: the model's adaptive default.
 */
export function wireThinking(model: string, thinking: Thinking = "off"): Pick<WireRequest, "thinking" | "output_config"> {
  if (thinking === "model") return {};
  if (/sonnet/i.test(model)) return thinking === "off" ? { thinking: { type: "between_tools" } } : {};
  return { output_config: { effort: thinking === "off" ? "low" : thinking } };
}

/** The system prompt on the wire: cache breakpoints only after the marked blocks; `suffix` (uncached) goes last. */
export function wireSystem(system: string | SystemBlock[], suffix = ""): string | WireSystemBlock[] {
  if (typeof system === "string") return suffix ? `${system}\n\n${suffix}` : system;
  const blocks: WireSystemBlock[] = system
    .filter((b) => b.text)
    .map((b) => ({ type: "text", text: b.text, ...(b.cache ? { cache_control: { type: "ephemeral" as const } } : {}) }));
  return suffix ? [...blocks, { type: "text", text: suffix }] : blocks;
}

const toolInstruction = (name: string) => `Respond only by calling the \`${name}\` tool, exactly once, with no other text.`;

export type LlmOptions = {
  transport: Transport;
  baseUrl?: string;
  maxRetries?: number;
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
  onCall?: (rec: CallRecord) => void;
};

export function createLlm(o: LlmOptions): Llm {
  const maxRetries = o.maxRetries ?? DEFAULT_MAX_RETRIES;
  const sleep = o.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const baseUrl = o.baseUrl ?? DEFAULT_BASE_URL;

  /** One request with transport-level retries (429/529/overloaded/5xx) and a per-attempt timeout. */
  async function send(req: WireRequest, c: CallBase): Promise<{ res: WireResponse; attempts: number }> {
    let timeouts = 0;
    for (let attempt = 1; ; attempt++) {
      const timeout = AbortSignal.timeout(c.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      const signal = c.signal ? AbortSignal.any([c.signal, timeout]) : timeout;
      try {
        return { res: await o.transport(req, { signal }), attempts: attempt };
      } catch (e) {
        if (c.signal?.aborted) throw new LlmError(`${c.label}: cancelled`, { cause: e });
        if (isConnectionRefused(e)) throw new LlmError(`proxy not running on ${baseUrl}`, { cause: e });
        const timedOut = timeout.aborted || e instanceof APIConnectionTimeoutError;
        if (timedOut) timeouts++;
        // A hung call is retried once: a second timeout means the proxy or upstream is stuck, so fail fast.
        const retryable = timedOut ? timeouts < 2 : isRetryable(e);
        if (!retryable || attempt > maxRetries) {
          const why = timedOut ? `timed out after ${c.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms` : describe(e);
          throw new LlmError(`${c.label} (${c.model}): ${why}${attempt > 1 ? ` after ${attempt} attempts` : ""}`, { cause: e });
        }
        await sleep(retryWaitMs(e, attempt));
      }
    }
  }

  function userContent(user: string | Part[]): WireContent[] {
    if (typeof user === "string") return [{ type: "text", text: user }];
    return user.map((p) =>
      p.type === "text" ? p : { type: "image", source: { type: "base64", media_type: p.mediaType, data: p.data.toString("base64") } },
    );
  }

  return {
    async callTool(c) {
      const started = Date.now();
      const tool = wireTool(c.tool);
      const messages: WireMessage[] = [{ role: "user", content: userContent(c.user) }];
      let usage = ZERO_USAGE;
      let attempts = 0;
      const problems: string[] = [];
      const rec = (): CallRecord => ({ label: c.label, model: c.model, ms: Date.now() - started, usage, attempts, ...(problems.length ? { problems } : {}) });
      // Retries (one by default) with the validation error fed back as a tool_result.
      const rounds = 1 + (c.validationRetries ?? 1);
      for (let round = 1; round <= rounds; round++) {
        const req: WireRequest = {
          model: c.model,
          max_tokens: c.maxTokens ?? 8000,
          // These models reject forced tool_choice ("tool"/"any"), so the tool is required by instruction and enforced here.
          system: wireSystem(c.system, toolInstruction(c.tool.name)),
          messages,
          tools: [tool],
          tool_choice: { type: "auto" },
          ...(c.temperature === undefined ? {} : { temperature: c.temperature }),
          ...wireThinking(c.model, c.thinking),
        };
        const { res, attempts: a } = await send(req, c);
        attempts += a;
        usage = addUsage(usage, toUsage(res));
        const call = res.content.find((b): b is Extract<WireContent, { type: "tool_use" }> => b.type === "tool_use");
        const problem = !call
          ? `no ${c.tool.name} tool call in the response (stop_reason ${res.stop_reason})`
          : res.stop_reason === "max_tokens"
            ? `output was cut off at max_tokens (${req.max_tokens}); be more concise`
            : undefined;
        const parsed = call && !problem ? parseLenient(c.tool.schema, call.input) : undefined;
        if (parsed?.success) {
          const r = rec();
          o.onCall?.(r);
          return { ...r, data: parsed.data };
        }
        const why = problem ?? formatZodError(parsed!.error);
        problems.push(why.slice(0, 400) + (parsed ? snippets(parsed.error, call!.input) : ""));
        dumpInvalid(c.label, round, call?.input);
        if (round === rounds) {
          o.onCall?.(rec());
          throw new LlmError(`${c.label}: invalid ${c.tool.name} output after ${rounds - 1 === 1 ? "a retry" : `${rounds - 1} retries`}: ${why}`);
        }
        if (call) {
          messages.push({ role: "assistant", content: [call] });
          messages.push({
            role: "user",
            content: [{ type: "tool_result", tool_use_id: call.id, is_error: true, content: `Invalid input, call ${c.tool.name} again with every problem fixed:\n${why}` }],
          });
        } else {
          messages.push({ role: "user", content: [{ type: "text", text: `Your reply was unusable: ${why}. Call the ${c.tool.name} tool.` }] });
        }
      }
      throw new LlmError("unreachable");
    },

    async callText(c) {
      const started = Date.now();
      const req: WireRequest = {
        model: c.model,
        max_tokens: c.maxTokens ?? 8000,
        system: wireSystem(c.system),
        messages: [{ role: "user", content: userContent(c.user) }],
        ...(c.temperature === undefined ? {} : { temperature: c.temperature }),
        ...wireThinking(c.model, c.thinking),
      };
      const { res, attempts } = await send(req, c);
      const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      const rec = { label: c.label, model: c.model, ms: Date.now() - started, usage: toUsage(res), attempts };
      o.onCall?.(rec);
      return { ...rec, text };
    },

    async warm(c) {
      const started = Date.now();
      // Same tools, system and thinking as the real calls (all part of the cached prefix); the user turn is a stand-in.
      const req: WireRequest = {
        model: c.model,
        max_tokens: 0,
        system: wireSystem(c.system, toolInstruction(c.tool.name)),
        messages: [{ role: "user", content: [{ type: "text", text: "(cache warm-up)" }] }],
        tools: [wireTool(c.tool)],
        tool_choice: { type: "auto" },
        ...wireThinking(c.model, c.thinking),
      };
      const { res, attempts } = await send(req, { ...c, user: "" });
      const rec = { label: c.label, model: c.model, ms: Date.now() - started, usage: toUsage(res), attempts };
      o.onCall?.(rec);
      return rec;
    },
  };
}

/** The real client: env from process/.env, SDK transport through the proxy. */
export function createProxyLlm(opts: Omit<LlmOptions, "transport" | "baseUrl"> & { env?: LlmEnv } = {}): Llm {
  const env = opts.env ?? loadLlmEnv();
  return createLlm({ ...opts, transport: sdkTransport(env), baseUrl: env.baseUrl });
}

function wireTool(t: ToolCallOpts<z.ZodTypeAny>["tool"]) {
  return { name: t.name, description: t.description, input_schema: toJsonSchema(t.schema) };
}

function toUsage(res: WireResponse): Usage {
  return {
    input: res.usage.input_tokens,
    output: res.usage.output_tokens,
    cacheRead: res.usage.cache_read_input_tokens ?? 0,
    cacheWrite: res.usage.cache_creation_input_tokens ?? 0,
  };
}

// A parameter runs to its closing tag, the next parameter, or the end of the text (models often drop the last closing tag).
const PARAM = /<parameter\s+name="([^"]+)">([\s\S]*?)(?=<\/parameter>|<parameter\s+name=|$)/g;

/**
 * An object that arrived as text: JSON, or the `<parameter name="k">v</parameter>` form some models fall back to for
 * nested objects (values are JSON when they look like it, nested parameters, numbers, booleans, else the text).
 */
export function parseStringObject(text: string): unknown {
  const t = text.trim();
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      return JSON.parse(t);
    } catch {
      /* fall through */
    }
  }
  if (!/<parameter\s+name=/.test(t)) return undefined;
  const out: Record<string, unknown> = {};
  for (const m of t.matchAll(PARAM)) out[m[1]!] = parseParamValue(m[2]!);
  return Object.keys(out).length ? out : undefined;
}

function parseParamValue(raw: string): unknown {
  const v = raw.trim();
  if (/<parameter\s+name=/.test(v)) return parseStringObject(v) ?? v;
  if (v.startsWith("{") || v.startsWith("[")) {
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }
  if (v === "true" || v === "false") return v === "true";
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

/**
 * Validates a tool call's input. Models sometimes return a nested object as text (JSON, or `<parameter>` tags); when
 * that is the only kind of problem, the strings are parsed in place and validation runs once more, with no model call.
 */
export function parseLenient<S extends z.ZodTypeAny>(schema: S, input: unknown): z.SafeParseReturnType<unknown, z.infer<S>> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return schema.safeParse(input);
  const copy = structuredClone(input) as Record<string, unknown>;
  let result = schema.safeParse(copy);
  // Even a passing parse may have dropped hoisted fields as unknown keys, so the repair loop runs at least once.
  // Each pass parses objects that arrived as text and pulls hoisted fields back in (a non-recursive tool-call parser,
  // like the proxy's, leaves a nested object's later fields at an enclosing level); it stops when nothing changes.
  for (let pass = 0; pass < 6; pass++) {
    if (pass > 0) result = schema.safeParse(copy);
    let changed = false;
    for (const issue of result.success ? [] : result.error.issues) {
      if (issue.code !== "invalid_type" || issue.path.length === 0) continue;
      const key = issue.path.at(-1)!;
      const parent = at(copy, issue.path.slice(0, -1)) as Record<string | number, unknown> | undefined;
      if (!parent || typeof parent !== "object") continue;
      if (issue.expected === "object" && issue.received === "string") {
        const parsed = parseStringObject(parent[key] as string);
        if (parsed !== undefined) {
          parent[key] = parsed;
          changed = true;
        }
      } else if (issue.received === "undefined" && issue.path.length >= 2) {
        for (let depth = issue.path.length - 2; depth >= 0; depth--) {
          const level = at(copy, issue.path.slice(0, depth)) as Record<string | number, unknown> | undefined;
          if (level && typeof level === "object" && key in level) {
            parent[key] = level[key];
            delete level[key];
            changed = true;
            break;
          }
        }
      }
    }
    // Fields a non-recursive parser hoisted to the top level that only a nested object's shape knows: move them in.
    for (const [key, value] of Object.entries(copy)) {
      if (topKeys(schema).has(key)) continue;
      const home = nestedHome(schema, key);
      if (!home) continue;
      const target = at(copy, home) as Record<string, unknown> | undefined;
      if (target && typeof target === "object" && !(key in target)) {
        target[key] = value;
        delete copy[key];
        changed = true;
      }
    }
    if (!changed) return result;
  }
  return schema.safeParse(copy);
}

/** The object schema under effects/optional/default wrappers, or undefined. */
function objectOf(schema: z.ZodTypeAny): z.ZodObject<z.ZodRawShape> | undefined {
  let s: z.ZodTypeAny = schema;
  for (let i = 0; i < 6; i++) {
    if (s instanceof z.ZodObject) return s as z.ZodObject<z.ZodRawShape>;
    const inner = (s as { _def?: { schema?: z.ZodTypeAny; innerType?: z.ZodTypeAny } })._def;
    const next = inner?.schema ?? inner?.innerType;
    if (!next) return undefined;
    s = next;
  }
  return undefined;
}

const topKeys = (schema: z.ZodTypeAny): Set<string> => new Set(Object.keys(objectOf(schema)?.shape ?? {}));

/** The path of the first nested object field (depth ≤ 3) whose shape has `key`. */
function nestedHome(schema: z.ZodTypeAny, key: string, path: string[] = [], depth = 0): string[] | undefined {
  const obj = objectOf(schema);
  if (!obj || depth > 3) return undefined;
  for (const [field, sub] of Object.entries(obj.shape)) {
    const subObj = objectOf(sub as z.ZodTypeAny);
    if (!subObj) continue;
    if (key in subObj.shape) return [...path, field];
    const deeper = nestedHome(sub as z.ZodTypeAny, key, [...path, field], depth + 1);
    if (deeper) return deeper;
  }
  return undefined;
}

function at(root: unknown, path: (string | number)[]): unknown {
  let node = root;
  for (const key of path) node = (node as Record<string | number, unknown> | undefined)?.[key];
  return node;
}

/** DF_DUMP_INVALID=<dir>: every rejected tool input is written there as JSON, for diagnosing a model's output shape. */
function dumpInvalid(label: string, round: number, input: unknown): void {
  const dir = process.env.DF_DUMP_INVALID;
  if (!dir || input === undefined) return;
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${label.replace(/[^\w.-]+/g, "_")}-r${round}.json`), JSON.stringify(input, null, 2));
  } catch {
    /* diagnostics only */
  }
}

/** For the journal: the start of each value that arrived with the wrong type, so a recurring shape problem can be seen. */
function snippets(err: z.ZodError, input: unknown): string {
  const out: string[] = [];
  for (const i of err.issues.slice(0, 3)) {
    if (i.code !== "invalid_type") continue;
    let node: unknown = input;
    for (const key of i.path) node = (node as Record<string | number, unknown> | undefined)?.[key];
    if (node !== undefined) out.push(`${i.path.join(".")}=${JSON.stringify(node).slice(0, 160)}`);
  }
  return out.length ? ` [got: ${out.join("; ")}]` : "";
}

export function formatZodError(err: z.ZodError): string {
  return err.issues
    .slice(0, 20)
    .map((i) => `- ${i.path.length ? i.path.join(".") : "(root)"}: ${i.message}`)
    .join("\n");
}

/** Connection errors are APIErrors with no status, so they are matched first; the OS code sits two levels down. */
export function isConnectionRefused(e: unknown): boolean {
  const code = (e as { cause?: { cause?: { code?: unknown } } } | undefined)?.cause?.cause?.code;
  return e instanceof APIConnectionError ? code === "ECONNREFUSED" : (e as { code?: unknown })?.code === "ECONNREFUSED";
}

function statusOf(e: unknown): number | undefined {
  if (e instanceof APIConnectionError) return undefined;
  if (e instanceof APIError) return e.status;
  const s = (e as { status?: unknown } | undefined)?.status;
  return typeof s === "number" ? s : undefined;
}

function isRetryable(e: unknown): boolean {
  if (e instanceof APIUserAbortError) return false;
  if (e instanceof APIConnectionError) return true; // reset/timeout mid-flight; refused is handled before this
  const s = statusOf(e);
  if (s === 429 || s === 529 || s === 408 || s === 409 || (s !== undefined && s >= 500)) return true;
  return /overloaded/i.test(describe(e));
}

function retryWaitMs(e: unknown, attempt: number): number {
  const headers = (e as { headers?: Headers } | undefined)?.headers;
  const after = Number(headers?.get?.("retry-after"));
  if (Number.isFinite(after) && after > 0) return Math.min(60_000, after * 1000);
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (attempt - 1)) * (0.75 + Math.random() * 0.5);
}

function describe(e: unknown): string {
  if (e instanceof APIError) {
    const body = e.error as { error?: { message?: unknown }; message?: unknown } | undefined;
    const msg = body?.error?.message ?? body?.message;
    return `${e.status ?? "connection"} ${typeof msg === "string" ? msg : e.message}`;
  }
  return e instanceof Error ? e.message : String(e);
}

/** Repo root (the dir holding pnpm-workspace.yaml), for projects/ and fixtures. */
export function repoRoot(start = dirname(fileURLToPath(import.meta.url))): string {
  for (let dir = start; ; dir = dirname(dir)) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    if (dirname(dir) === dir) throw new Error(`no pnpm-workspace.yaml above ${start}`);
  }
}
