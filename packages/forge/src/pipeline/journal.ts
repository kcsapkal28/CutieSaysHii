// The run journal: projects/<id>/log.jsonl, one compact JSON object per line for cost and latency analysis.
// `journaled` wraps a run's onEvent so every ForgeEvent (current and future types) is appended with a run id and an
// ISO timestamp, without per-type code. Bulky fields become counts; prompts, keys and env values are never written.
// `readJournal` + `summarizeRuns` turn it back into per-stage / per-agent / per-slide numbers (`forge journal`, `forge eval`).
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { addUsage, ZERO_USAGE, type Usage } from "../llm.ts";
import { costUsd } from "../pricing.ts";
import type { OnEvent, Verdict } from "./events.ts";
import type { Project } from "./project.ts";

export const journalFile = (p: Project) => join(p.dir, "log.jsonl");

/** A short unique run id, e.g. "mh3k2x-7f3a". */
export const newRunId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/** Keys never written, whatever event carries them. */
const SECRET_KEY = /prompt|^system$|^messages$|^env$|api.?key|secret|password|token$|authorization/i;
const MAX_STRING = 500;
const MAX_INLINE_ARRAY = 12;

/** A JSON-safe, compact copy: secret-looking keys dropped, long strings cut, long or non-scalar arrays → their length. */
export function compact(value: unknown, secrets: string[] = envSecrets()): unknown {
  if (typeof value === "string") {
    let s = value;
    for (const secret of secrets) s = s.split(secret).join("[redacted]");
    return s.length > MAX_STRING ? `${s.slice(0, MAX_STRING)}…` : s;
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    const scalar = value.every((v) => typeof v === "number" || (typeof v === "string" && v.length <= 40 && !/[\\/]/.test(v)));
    return scalar && value.length <= MAX_INLINE_ARRAY ? value : value.length;
  }
  if (typeof value === "object" && !Buffer.isBuffer(value) && !ArrayBuffer.isView(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY.test(k) || v === undefined) continue;
      out[k] = compact(v, secrets);
    }
    return out;
  }
  return undefined;
}

/** Values that must never reach the journal even inside an error message. */
function envSecrets(): string[] {
  return [process.env.LLM_API_KEY].filter((s): s is string => !!s && s.length >= 8);
}

export type Journal = { run: string; onEvent: OnEvent; note: (line: { type: string } & Record<string, unknown>) => void };

/**
 * Wraps `onEvent` so every event is first appended to `file` as `{at, run, ...event}`. A journal write that fails is
 * ignored: the journal must never break a run. `note` appends a journal-only line (e.g. revise:start).
 */
export function journaled(file: string, onEvent: OnEvent | undefined, run = newRunId()): Journal {
  const write = (line: object) => {
    try {
      appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), run, ...(compact(line) as object) })}\n`);
    } catch {
      // never break a run over the journal
    }
  };
  return {
    run,
    note: write,
    onEvent: (e) => {
      write(e);
      onEvent?.(e);
    },
  };
}

// ---- reading and summarising ----

export type JournalLine = { at: string; run?: string; type: string } & Record<string, unknown>;

/** Every parseable line of a journal (old lines without a run id are kept; corrupt lines are skipped). */
export function readJournal(file: string): JournalLine[] {
  if (!existsSync(file)) return [];
  const out: JournalLine[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const v = JSON.parse(line) as JournalLine;
      if (v && typeof v.type === "string") out.push(v);
    } catch {
      // a half-written line from a crash
    }
  }
  return out;
}

export type CostRow = { calls: number; ms: number; usage: Usage; usd: number };
export type StageRow = CostRow & { stage: string; status: "done" | "error" | "running" };
export type SlideRow = {
  id: string;
  /** Per round: the critic's verdict, or "error" when the round failed before review. */
  verdicts: (Verdict | "error")[];
  scores: (number | null)[];
  rounds: number;
  firstPass: boolean;
  escalated: boolean;
  /** Why the slide ended early (budget used, or a patch measured worse), when it did. */
  stopped?: string;
  /** Fix rounds answered with edits that held, and edit attempts that fell back to a full rewrite. */
  patches: number;
  patchFallbacks: number;
  final: Verdict | "failed" | "running";
  bestRound: number;
  score: number;
  /** First round start → slide:done (or the last line seen). */
  ms: number;
};
export type RunSummary = {
  run: string;
  startedAt: string;
  ms: number;
  stages: StageRow[];
  /** Keyed by agent and model, e.g. "builder · sonnet" (per-slide label suffixes are dropped). */
  agents: Record<string, CostRow>;
  slides: SlideRow[];
  total: CostRow;
  deckFile?: string;
  errors: string[];
};

const zeroRow = (): CostRow => ({ calls: 0, ms: 0, usage: ZERO_USAGE, usd: 0 });
const time = (l: JournalLine) => Date.parse(l.at);
const num = (v: unknown) => (typeof v === "number" ? v : 0);
const str = (v: unknown) => (typeof v === "string" ? v : "");
export const modelName = (model: string) => (/opus/i.test(model) ? "opus" : /sonnet/i.test(model) ? "sonnet" : /haiku/i.test(model) ? "haiku" : model);

function addCall(row: CostRow, model: string, ms: number, usage: Usage): void {
  row.calls++;
  row.ms += ms;
  row.usage = addUsage(row.usage, usage);
  row.usd += costUsd(model, usage);
}

/** One summary per run id, in the order the runs started. Lines without a run id are grouped as run "-". */
export function summarizeRuns(lines: JournalLine[]): RunSummary[] {
  const runs = new Map<string, JournalLine[]>();
  for (const l of lines) {
    const id = l.run ?? "-";
    if (!runs.has(id)) runs.set(id, []);
    runs.get(id)!.push(l);
  }
  return [...runs.entries()].map(([id, ls]) => summarizeRun(id, ls));
}

export function summarizeRun(run: string, lines: JournalLine[]): RunSummary {
  const stages = new Map<string, StageRow>();
  const stageRow = (stage: string) => {
    if (!stages.has(stage)) stages.set(stage, { stage, status: "running", ...zeroRow() });
    return stages.get(stage)!;
  };
  const agents: Record<string, CostRow> = {};
  const total = zeroRow();
  const slides = new Map<string, SlideRow & { start: number; end: number }>();
  const slideRow = (id: string, at: number) => {
    if (!slides.has(id)) {
      slides.set(id, { id, verdicts: [], scores: [], rounds: 0, firstPass: false, escalated: false, patches: 0, patchFallbacks: 0, final: "running", bestRound: 0, score: 0, ms: 0, start: at, end: at });
    }
    const s = slides.get(id)!;
    s.end = Math.max(s.end, at);
    return s;
  };
  const errors: string[] = [];
  let deckFile: string | undefined;

  for (const l of lines) {
    const at = time(l);
    switch (l.type) {
      case "stage:start":
        stageRow(str(l.stage));
        break;
      case "stage:done": {
        const row = stageRow(str(l.stage));
        row.status = "done";
        row.ms = num(l.ms);
        // Old journals hold only stage:done lines: take their totals (unpriced, no model) when no usage lines were seen.
        if (!row.calls && l.usage) Object.assign(row, { calls: num(l.calls), usage: l.usage as Usage });
        break;
      }
      case "stage:error":
        stageRow(str(l.stage)).status = "error";
        errors.push(`${str(l.stage)}: ${str(l.error)}`);
        break;
      case "revise:done":
      case "revise:error": {
        const row = stageRow("revise");
        row.status = l.type === "revise:done" ? "done" : "error";
        row.ms = num(l.ms);
        if (l.type === "revise:error") errors.push(`revise: ${str(l.error)}`);
        break;
      }
      case "usage": {
        const model = str(l.model);
        const usage = { ...ZERO_USAGE, ...(l.usage as Partial<Usage>) };
        const ms = num(l.ms);
        const row = stageRow(str(l.stage));
        addCall(row, model, ms, usage);
        const key = `${str(l.label).split(":")[0]} · ${modelName(model)}`;
        addCall((agents[key] ??= zeroRow()), model, ms, usage);
        addCall(total, model, ms, usage);
        break;
      }
      case "slide:round": {
        const s = slideRow(str(l.id), at);
        s.rounds = Math.max(s.rounds, num(l.round));
        break;
      }
      case "slide:verdict": {
        const s = slideRow(str(l.id), at);
        s.verdicts[num(l.round) - 1] = l.verdict as Verdict;
        s.scores[num(l.round) - 1] = num(l.score);
        break;
      }
      case "slide:error": {
        const s = slideRow(str(l.id), at);
        s.verdicts[num(l.round) - 1] = "error";
        break;
      }
      case "slide:escalate":
        slideRow(str(l.id), at).escalated = true;
        break;
      case "slide:stop":
        slideRow(str(l.id), at).stopped = str(l.reason);
        break;
      case "slide:patch": {
        const s = slideRow(str(l.id), at);
        if (l.applied) s.patches++;
        else s.patchFallbacks++;
        break;
      }
      case "slide:done": {
        const s = slideRow(str(l.id), at);
        Object.assign(s, { final: l.verdict, bestRound: num(l.bestRound), score: num(l.score), rounds: num(l.rounds) || s.rounds });
        break;
      }
      case "deck:done":
        deckFile = str(l.file);
        break;
    }
  }

  const slideRows = [...slides.values()].map(({ start, end, ...s }) => ({
    ...s,
    verdicts: Array.from({ length: Math.max(s.verdicts.length, s.rounds) }, (_, i) => s.verdicts[i] ?? "error"),
    scores: Array.from({ length: Math.max(s.verdicts.length, s.rounds) }, (_, i) => s.scores[i] ?? null),
    firstPass: s.verdicts[0] === "pass",
    ms: end - start,
  }));
  const times = lines.map(time).filter(Number.isFinite);
  return {
    run,
    startedAt: lines[0]?.at ?? "",
    ms: times.length ? Math.max(...times) - Math.min(...times) : 0,
    stages: [...stages.values()],
    agents,
    slides: slideRows.sort((a, b) => a.id.localeCompare(b.id)),
    total,
    ...(deckFile ? { deckFile } : {}),
    errors,
  };
}

// ---- formatting ----

export const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
export const usd = (n: number) => `$${n.toFixed(2)}`;
export const kTok = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const inTok = (u: Usage) => u.input + u.cacheRead + u.cacheWrite;

/** Left-aligned text table. */
export function table(head: string[], rows: string[][]): string {
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (r: string[]) => r.map((c, i) => c.padEnd(widths[i]!)).join("  ").trimEnd();
  return [line(head), line(widths.map((w) => "-".repeat(w))), ...rows.map(line)].join("\n");
}

const costCells = (r: CostRow) => [String(r.calls), kTok(inTok(r.usage)), kTok(r.usage.cacheRead), kTok(r.usage.output), usd(r.usd)];

/** The human summary `forge journal` prints for one run. */
export function formatRun(s: RunSummary): string {
  const out = [`run ${s.run} · started ${s.startedAt} · ${secs(s.ms)} · ${s.total.calls} calls · ${usd(s.total.usd)}`];
  out.push(
    "",
    table(
      ["stage", "status", "time", "calls", "in", "cached", "out", "cost"],
      s.stages.map((r) => [r.stage, r.status, secs(r.ms), ...costCells(r)]),
    ),
  );
  const agents = Object.entries(s.agents).sort((a, b) => b[1].usd - a[1].usd);
  if (agents.length) out.push("", table(["agent", "calls", "in", "cached", "out", "cost", "call time"], agents.map(([k, r]) => [k, ...costCells(r), secs(r.ms)])));
  if (s.slides.length) {
    out.push(
      "",
      table(
        ["slide", "rounds", "verdicts", "scores", "escalated", "final", "best", "score", "time", "edits"],
        s.slides.map((r) => [
          r.id,
          String(r.rounds),
          r.verdicts.join(","),
          r.scores.map((x) => (x === null ? "-" : String(x))).join(","),
          r.escalated ? "yes" : "",
          r.final,
          r.bestRound ? `r${r.bestRound}` : "-",
          String(r.score),
          secs(r.ms),
          r.patches || r.patchFallbacks ? `${r.patches} held${r.patchFallbacks ? `, ${r.patchFallbacks} rewritten` : ""}` : "",
        ]),
      ),
    );
  }
  if (s.deckFile) out.push("", `deck: ${s.deckFile}`);
  for (const e of s.errors) out.push(`error: ${e}`);
  return out.join("\n");
}
