// StudioBackend on the real agent pipeline (@deckforge/forge/pipeline). Projects are directories under the repo-root
// projects/ folder. What the pipeline doesn't track itself lives next to its files in studio.json: approvals, the
// last run's log/usage/error per stage, and the build view's per-slide state.
//
// Runs are detached (lib/server/runs.ts): closing the SSE stream or reloading the page leaves the build running, and
// loadProject reports its live state so the UI can poll it.
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { ForgeEvent } from "@deckforge/forge/pipeline";
import type { Style } from "@deckforge/forge";
import { NotFound, type DeckRef, type RunOptions, type StudioBackend } from "../backend";
import type { PipelineEvent } from "../events";
import { createForgeEventAdapter, studioUsage } from "../pipeline-adapter";
import {
  outlineSlides,
  STAGES,
  type Brief,
  type Outline,
  type Project,
  type ProjectSummary,
  type ResearchRefineRequest,
  type ResearchRefineResult,
  type SlideBuildState,
  type StageFileName,
  type StageName,
  type StageState,
  type Usage,
  type VersionInfo,
} from "../types";
import { engine, pipeline } from "./engine";
import { upgradeStudioState, type StageRecord } from "./legacy";
import { activeRun, startRun, subscribe } from "./runs";

interface StudioState {
  approvals: Partial<Record<StageName, string>>;
  stages: Partial<Record<StageName, StageRecord>>;
  build?: { slides: SlideBuildState[] };
}
/** Live state of the run in progress, keyed by project id. */
interface Live {
  stage: StageName;
  record: StageRecord;
  slides?: SlideBuildState[];
}

const g = globalThis as unknown as {
  __studioLive?: Map<string, Live>;
  __studioDraft?: Map<string, { key: string; html: Promise<string> }>;
  __studioMigrated?: Set<string>;
};
const live = (g.__studioLive ??= new Map());
const draftCache = (g.__studioDraft ??= new Map());
/** Project dirs already checked for the old three-file outline (see the engine's pipeline/migrate.ts). */
const migrated = (g.__studioMigrated ??= new Set());

const now = () => new Date().toISOString();
const zero = (): Usage => ({ inputTokens: 0, outputTokens: 0, costUsd: 0 });
const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;
const ID = /^[a-z0-9][a-z0-9-]{0,80}$/;

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

/** The repo root: the nearest ancestor of cwd with pnpm-workspace.yaml (STUDIO_PROJECTS_ROOT overrides it). */
function root(): string {
  if (process.env.STUDIO_PROJECTS_ROOT) return resolve(process.env.STUDIO_PROJECTS_ROOT);
  let dir = process.cwd();
  while (!existsSync(join(dir, "pnpm-workspace.yaml"))) {
    const up = dirname(dir);
    if (up === dir) return process.cwd();
    dir = up;
  }
  return dir;
}
const projectsDir = () => join(root(), "projects");

function titleFrom(topic: string): string {
  const t = topic.trim().replace(/\s+/g, " ");
  if (t.length <= 42) return t.charAt(0).toUpperCase() + t.slice(1);
  return `${t.slice(0, 40).replace(/\s\S*$/, "")}…`;
}

/** Turns pipeline errors into something the user can act on. */
function friendly(msg: string): string {
  const proxy = /proxy not running on (\S+)/.exec(msg);
  if (proxy) return `Can’t reach the LLM proxy at ${proxy[1]}. Start the proxy, then press Re-run.`;
  if (/LLM_API_KEY is not set/.test(msg)) return "LLM_API_KEY is not set. Add it to the repo-root .env and restart the studio.";
  return msg;
}

/** Applies one event to a stage record (and the build's slide list), the same way the UI does for a live stream. */
function reduce(l: Live, e: PipelineEvent): void {
  const r = l.record;
  const at = now();
  r.updatedAt = at;
  switch (e.type) {
    case "progress":
      r.log.push({ at: e.at, message: e.message });
      break;
    case "usage":
      r.usage = e.usage;
      break;
    case "error":
      r.error = e.message;
      r.log.push({ at, message: e.message });
      break;
    case "stage.done":
      r.log.push({ at, message: "Done. Waiting for your review." });
      break;
    case "critic.verdict":
      r.log.push({ at, message: `${e.slideId} round ${e.round}: ${e.verdict === "pass" ? "critic passed it" : `${e.issues.length} issue${e.issues.length === 1 ? "" : "s"} to fix`}` });
      break;
  }
  if (!l.slides) return;
  const upd = (id: string, fn: (s: SlideBuildState) => SlideBuildState) => (l.slides = l.slides!.map((s) => (s.id === id ? fn(s) : s)));
  if (e.type === "slide.start") upd(e.slideId, (s) => ({ ...s, status: "building", rounds: 1, phase: "build" }));
  if (e.type === "slide.round") upd(e.slideId, (s) => ({ ...s, status: "building", rounds: e.round, phase: e.phase }));
  if (e.type === "critic.verdict")
    upd(e.slideId, (s) => ({ ...s, issues: [...s.issues.map((i) => ({ ...i, fixed: true })), ...e.issues.map((text) => ({ round: e.round, text, fixed: false }))] }));
  if (e.type === "slide.done")
    upd(e.slideId, (s) => ({ ...s, status: "done", rounds: e.rounds, verdict: e.verdict, phase: undefined, issues: s.issues.map((i) => ({ ...i, fixed: e.verdict === "pass" || i.fixed })) }));
}

export class RealBackend implements StudioBackend {
  // ---------------------------------------------------------------- files
  private dir(id: string): string {
    if (!ID.test(id)) throw new NotFound(`No project "${id}"`);
    const d = join(projectsDir(), id);
    if (!existsSync(join(d, "brief.json"))) throw new NotFound(`No project "${id}"`);
    return d;
  }
  private fp(id: string) {
    const dir = this.dir(id);
    return { dir, slug: id };
  }
  /** The project dir, after upgrading an old project's files (once per process) to the merged Outline stage. */
  private async ready(id: string): Promise<string> {
    const dir = this.dir(id);
    if (!migrated.has(dir)) {
      (await pipeline()).migrateProject({ dir });
      migrated.add(dir);
    }
    return dir;
  }
  private state(dir: string): StudioState {
    const st = readJson<StudioState>(join(dir, "studio.json")) ?? { approvals: {}, stages: {} };
    const upgraded = upgradeStudioState(st);
    if (!upgraded) return st;
    this.saveState(dir, upgraded);
    return upgraded;
  }
  private outline(dir: string): Outline | null {
    return readJson<Outline>(join(dir, "outline.json"));
  }
  private saveState(dir: string, s: StudioState): void {
    writeFileSync(join(dir, "studio.json"), json(s));
  }
  private versionsOf(dir: string): number[] {
    const v = join(dir, "versions");
    if (!existsSync(v)) return [];
    return readdirSync(v)
      .filter((d) => /^\d+$/.test(d) && existsSync(join(v, d, "deck.html")))
      .map(Number)
      .sort((a, b) => a - b);
  }
  private titles(dir: string): Record<string, string> {
    return Object.fromEntries(outlineSlides(this.outline(dir)).map((x) => [x.id, x.title]));
  }

  private studioBrief(dir: string): Brief {
    const raw = readJson<{ topic: string; audience: string; minutes: number; goal?: string; notes?: string }>(join(dir, "brief.json"))!;
    return { topic: raw.topic, audience: raw.audience, minutes: raw.minutes, goal: raw.goal ?? "", ...(raw.notes ? { notes: raw.notes } : {}) };
  }

  private snapshot(id: string, dir: string): Project {
    const st = this.state(dir);
    const run = activeRun(id);
    const l = run?.kind === "stage" ? live.get(id) : undefined;
    const has = (f: string) => existsSync(join(dir, f));
    const done: Record<StageName, boolean> = {
      research: has("research.md"),
      outline: has("outline.json"),
      build: has("build.json"),
    };
    const status = (s: StageName): StageState["status"] => {
      if (l?.stage === s) return "running";
      if (st.stages[s]?.error) return "error";
      if (!done[s]) return "idle";
      return st.approvals[s] ? "approved" : "review";
    };
    const stageState = Object.fromEntries(
      STAGES.map((s) => {
        const r = l?.stage === s ? l.record : st.stages[s];
        return [s, { status: status(s), updatedAt: r?.updatedAt ?? null, usage: r?.usage ?? zero(), log: r?.log ?? [], ...(r?.error ? { error: r.error } : {}) }];
      }),
    ) as Record<StageName, StageState>;
    if (!done.outline && !l && has("legacy/outline.json")) {
      // An old project whose outline couldn't be upgraded (see migrate.ts): say why the stage needs a run.
      const o = stageState.outline;
      o.log = [...o.log, { at: o.updatedAt ?? now(), message: "An outline in the older format is kept in legacy/. Run the outline to plan this deck in the current format." }];
    }

    const outline = this.outline(dir);
    const brief = this.studioBrief(dir);
    const files: Project["files"] = { "brief.json": json(brief) };
    if (has("style.json")) files["style.json"] = readFileSync(join(dir, "style.json"), "utf8");
    if (has("research.md")) files["research.md"] = readFileSync(join(dir, "research.md"), "utf8");
    if (outline) files["outline.json"] = json(outline);

    let slides: SlideBuildState[] | null = l?.slides ?? st.build?.slides ?? null;
    if (slides && outline) {
      // Keep titles current and drop slides that are no longer in the outline.
      const t = this.titles(dir);
      slides = slides.filter((s) => t[s.id]).map((s) => ({ ...s, title: t[s.id]! }));
    }
    const versions = this.versionsOf(dir);
    const mtime = Math.max(...readdirSync(dir).map((f) => statSync(join(dir, f)).mtimeMs));
    return {
      id,
      title: outline?.title ?? titleFrom(brief.topic),
      topic: brief.topic,
      createdAt: readJson<{ createdAt?: string }>(join(dir, "brief.json"))?.createdAt ?? new Date(statSync(dir).birthtimeMs).toISOString(),
      updatedAt: new Date(mtime).toISOString(),
      stages: Object.fromEntries(STAGES.map((s) => [s, stageState[s].status])) as ProjectSummary["stages"],
      hasStyle: has("style.json"),
      latestVersion: versions.at(-1) ?? null,
      style: readJson<Style>(join(dir, "style.json")),
      slideCount: outlineSlides(outline).length,
      brief,
      stageState,
      files,
      build: slides ? { slides } : null,
    };
  }

  // ---------------------------------------------------------------- projects
  async createProject(brief: Brief): Promise<ProjectSummary> {
    const { createProject } = await pipeline();
    const p = createProject({ topic: brief.topic, audience: brief.audience, minutes: brief.minutes, prefs: brief.notes ? { notes: brief.notes } : {}, root: root() });
    const file = join(p.dir, "brief.json");
    writeFileSync(file, json({ ...readJson<object>(file), goal: brief.goal, ...(brief.notes ? { notes: brief.notes } : {}) }));
    return this.snapshot(p.slug, p.dir);
  }

  async listProjects(): Promise<ProjectSummary[]> {
    const d = projectsDir();
    if (!existsSync(d)) return [];
    const out: ProjectSummary[] = [];
    for (const id of readdirSync(d)) {
      if (!ID.test(id) || !existsSync(join(d, id, "brief.json"))) continue;
      try {
        const { brief: _b, stageState: _s, files: _f, build: _x, ...summary } = this.snapshot(id, await this.ready(id));
        out.push(summary);
      } catch {
        /* skip unreadable projects */
      }
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async loadProject(id: string): Promise<Project | null> {
    try {
      return this.snapshot(id, await this.ready(id));
    } catch (e) {
      if (e instanceof NotFound) return null;
      throw e;
    }
  }

  async approveStage(id: string, stage: StageName): Promise<Project> {
    const dir = await this.ready(id);
    const p = this.snapshot(id, dir);
    const s = p.stageState[stage].status;
    if (s !== "review" && s !== "approved") throw new Error(`${stage} has no output to approve yet`);
    const st = this.state(dir);
    st.approvals[stage] = now();
    this.saveState(dir, st);
    return this.snapshot(id, dir);
  }

  async saveStageFile(id: string, file: StageFileName, content: string): Promise<Project> {
    const dir = await this.ready(id);
    const project = { dir, slug: id };
    if (activeRun(id)) throw new Error("Wait for the current run to finish before editing.");
    const f = await pipeline();
    const read = <T>(name: string) => readJson<T>(join(dir, name));
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    /** Saves through the pipeline (which deletes every later stage's files) and drops those stages' studio state. */
    const save = (stage: "style" | Exclude<StageName, "build">, data: unknown) => {
      f.saveStageFile(project, stage, data);
      const st = this.state(dir);
      for (const s of STAGES.slice(stage === "style" ? 0 : STAGES.indexOf(stage) + 1)) {
        delete st.approvals[s];
        delete st.stages[s];
      }
      delete st.build;
      this.saveState(dir, st);
    };
    switch (file) {
      case "brief.json": {
        const b = JSON.parse(content) as Brief;
        if (!b.topic || b.topic.length < 3) throw new Error("The topic needs at least 3 characters.");
        if (!(b.minutes > 0 && b.minutes <= 120)) throw new Error("Talk length must be between 1 and 120 minutes.");
        const raw = read<{ prefs?: Record<string, unknown> }>("brief.json") ?? {};
        const prefs = { ...raw.prefs, notes: b.notes || undefined };
        writeFileSync(join(dir, "brief.json"), json({ ...raw, topic: b.topic, audience: b.audience, minutes: b.minutes, goal: b.goal, notes: b.notes || undefined, prefs }));
        break;
      }
      case "style.json": {
        const { Style: StyleSchema, themeCss } = await engine();
        const next = StyleSchema.parse(JSON.parse(content));
        themeCss(next.theme); // rejects unknown fonts / unsafe values
        const prev = read<unknown>("style.json");
        if (!prev || !same(StyleSchema.safeParse(prev).data, next)) save("style", next);
        break;
      }
      case "research.md":
        if (content !== (existsSync(join(dir, "research.md")) ? readFileSync(join(dir, "research.md"), "utf8") : null)) save("research", content);
        break;
      case "outline.json": {
        // The editor works on the file's own shape; the pipeline validates it on save.
        const o = this.outline(dir);
        if (!o) throw new Error("Run the outline first.");
        const next = JSON.parse(content) as Outline;
        if (!same(o, next)) save("outline", next);
        break;
      }
    }
    return this.snapshot(id, dir);
  }

  async recommendStyle(brief: Brief): Promise<{ style: Style; rationale: string }> {
    const { runStylist, createProxyLlm } = await pipeline();
    try {
      const { style, rationale } = await runStylist(createProxyLlm(), {
        topic: brief.topic,
        audience: brief.audience || "a general audience",
        minutes: brief.minutes || 10,
        prefs: brief.notes ? { notes: brief.notes } : {},
        createdAt: now(),
      });
      return { style, rationale };
    } catch (e) {
      throw new Error(friendly((e as Error).message));
    }
  }

  async refineResearch(id: string, req: ResearchRefineRequest): Promise<ResearchRefineResult> {
    const project = this.fp(id);
    const f = await pipeline();
    try {
      const r = await f.refineResearch(f.createProxyLlm(), { brief: f.loadBrief(project), ...req }, { model: f.DEFAULT_MODELS.researcher });
      return { answer: r.answer, passage: r.passage, replacement: r.replacement, changed: r.changed, model: r.model, usage: studioUsage(r.model, r.usage) };
    } catch (e) {
      throw new Error(friendly((e as Error).message), { cause: e });
    }
  }

  // ---------------------------------------------------------------- runs
  /** Wraps the pipeline's onEvent: maps events, fills in critic issue text, snapshots slides into each new version. */
  private forgeSink(dir: string, context: StageName, emit: (e: PipelineEvent) => void, note?: string) {
    const titles = this.titles(dir);
    const adapt = createForgeEventAdapter(context, { titles, ...(note ? { note } : {}) });
    const shotDir = new Map<string, string>();
    let errored = false;
    const out = (e: PipelineEvent) => {
      if (e.type === "error") {
        errored = true;
        e = { ...e, message: friendly(e.message) };
      }
      emit(e);
    };
    const onEvent = (fe: ForgeEvent) => {
      if (fe.type === "slide:shots" && fe.files[0]) shotDir.set(fe.id, dirname(fe.files[0]));
      for (let e of adapt(fe)) {
        if (e.type === "critic.verdict" && e.verdict === "revise" && fe.type === "slide:verdict") {
          const review = readJson<{ issues?: { severity: string; what: string }[] }>(join(shotDir.get(fe.id) ?? "", "review.json"));
          if (review?.issues?.length) e = { ...e, issues: review.issues.map((i) => `${i.what}${i.severity === "high" ? " (high)" : ""}`) };
        }
        out(e);
      }
      if (fe.type === "slide:done" && fe.verdict === "failed")
        out({ type: "progress", stage: context, slideId: fe.id, message: `${fe.id} didn’t build; a placeholder stands in. Revise it from the deck chat.`, at: now() });
      if (fe.type === "deck:done") {
        const vdir = dirname(fe.file);
        cpSync(join(dir, "slides"), join(vdir, "slides"), { recursive: true });
      }
    };
    return { onEvent, out, errored: () => errored };
  }

  async *runStage(id: string, stage: StageName, opts: RunOptions = {}): AsyncIterable<PipelineEvent> {
    const dir = await this.ready(id);
    const project = { dir, slug: id };
    const existing = activeRun(id);
    if (existing) {
      if (existing.kind === "stage" && existing.stage === stage) {
        yield* subscribe(existing, opts.signal);
        return;
      }
      yield { type: "error", stage, message: `${existing.kind === "revise" ? `A revise of ${existing.slideId}` : `The ${existing.stage} stage`} is still running. Wait for it to finish.`, retryable: false };
      return;
    }
    // A re-run invalidates this stage's approval and every later one.
    const st = this.state(dir);
    for (const s of STAGES.slice(STAGES.indexOf(stage))) {
      delete st.approvals[s];
      delete st.stages[s];
    }
    delete st.build;
    this.saveState(dir, st);

    const titles = this.titles(dir);
    const l: Live = {
      stage,
      record: { log: [], usage: zero(), updatedAt: now() },
      ...(stage === "build" ? { slides: Object.entries(titles).map(([sid, title]) => ({ id: sid, title, status: "queued" as const, rounds: 0, issues: [] })) } : {}),
    };
    live.set(id, l);
    const run = startRun(
      { projectId: id, kind: "stage", stage },
      async (emit) => {
        const sink = this.forgeSink(dir, stage, emit);
        try {
          const f = await pipeline();
          await f.runStage(project, stage, { onEvent: sink.onEvent });
        } catch (e) {
          if (!sink.errored()) sink.out({ type: "error", stage, message: (e as Error).message, retryable: true });
        } finally {
          const s = this.state(dir);
          s.stages[stage] = l.record;
          if (l.slides) s.build = { slides: l.slides };
          this.saveState(dir, s);
          live.delete(id);
        }
      },
      (e) => reduce(l, e),
    );
    yield* subscribe(run, opts.signal);
  }

  async *reviseSlide(id: string, slideId: string, instruction: string, opts: RunOptions = {}): AsyncIterable<PipelineEvent> {
    const dir = await this.ready(id);
    const project = { dir, slug: id };
    const existing = activeRun(id);
    if (existing) {
      if (existing.kind === "revise" && existing.slideId === slideId) {
        yield* subscribe(existing, opts.signal);
        return;
      }
      yield { type: "error", slideId, message: "Another run is in progress for this deck. Wait for it to finish.", retryable: false };
      return;
    }
    if (!existsSync(join(dir, "slides", `${slideId}.html`))) {
      yield { type: "error", slideId, message: `No built slide ${slideId}. Build the deck first.`, retryable: false };
      return;
    }
    let usage = zero();
    const run = startRun({ projectId: id, kind: "revise", stage: "build", slideId }, async (emit) => {
      const sink = this.forgeSink(dir, "build", (e) => {
        if (e.type === "usage") usage = e.usage;
        emit(e);
      }, `${slideId}: ${instruction}`);
      try {
        emit({ type: "progress", stage: "build", slideId, message: `Reading ${slideId} and your note`, at: now() });
        const f = await pipeline();
        const r = await f.reviseSlide(project, slideId, instruction, { onEvent: sink.onEvent });
        if (r.build.verdict === "failed") sink.out({ type: "error", slideId, message: `Couldn’t rebuild ${slideId}: every round failed. The deck is unchanged.`, retryable: true });
      } catch (e) {
        if (!sink.errored()) sink.out({ type: "error", slideId, message: (e as Error).message, retryable: true });
      } finally {
        // Revise spend counts toward the build stage.
        const s = this.state(dir);
        const b = s.stages.build ?? { log: [], usage: zero(), updatedAt: null };
        b.usage = { inputTokens: b.usage.inputTokens + usage.inputTokens, outputTokens: b.usage.outputTokens + usage.outputTokens, costUsd: b.usage.costUsd + usage.costUsd };
        s.stages.build = b;
        this.saveState(dir, s);
      }
    });
    yield* subscribe(run, opts.signal);
  }

  // ---------------------------------------------------------------- versions
  async listVersions(id: string): Promise<VersionInfo[]> {
    const dir = this.dir(id);
    return this.versionsOf(dir).map((v) => this.versionInfo(dir, v));
  }

  private versionInfo(dir: string, v: number): VersionInfo {
    const vdir = join(dir, "versions", String(v));
    const meta = readJson<{ kind?: string; slideId?: string; instruction?: string; restoredFrom?: number; createdAt?: string }>(join(vdir, "meta.json")) ?? {};
    const slideIds = (readJson<{ slides?: { id: string }[] }>(join(vdir, "deck.json"))?.slides ?? []).map((s) => s.id);
    const note = meta.restoredFrom ? `Restored v${meta.restoredFrom}` : meta.kind === "revise" ? `${meta.slideId}: ${meta.instruction}` : "Build";
    const changed = meta.restoredFrom ? [] : meta.kind === "revise" && meta.slideId ? [meta.slideId] : slideIds;
    return { version: v, createdAt: meta.createdAt ?? statSync(join(vdir, "deck.html")).mtime.toISOString(), note, slideIds, changed };
  }

  async restoreVersion(id: string, version: number): Promise<VersionInfo> {
    const dir = this.dir(id);
    if (activeRun(id)) throw new Error("Wait for the current run to finish before restoring.");
    const versions = this.versionsOf(dir);
    if (!versions.includes(version)) throw new NotFound(`No version ${version}`);
    const src = join(dir, "versions", String(version));
    const next = (versions.at(-1) ?? 0) + 1;
    const dst = join(dir, "versions", String(next));
    mkdirSync(dst, { recursive: true });
    copyFileSync(join(src, "deck.html"), join(dst, "deck.html"));
    if (existsSync(join(src, "deck.json"))) copyFileSync(join(src, "deck.json"), join(dst, "deck.json"));
    // Restore the working slides too, so the next chat edit builds on the restored deck.
    if (existsSync(join(src, "slides"))) {
      cpSync(join(src, "slides"), join(dst, "slides"), { recursive: true });
      cpSync(join(src, "slides"), join(dir, "slides"), { recursive: true });
    }
    writeFileSync(join(dst, "meta.json"), json({ version: next, kind: "build", restoredFrom: version, createdAt: now() }));
    return this.versionInfo(dir, next);
  }

  async getDeckHtml(id: string, version: DeckRef): Promise<string | null> {
    const dir = await this.ready(id);
    if (version !== "draft") {
      const v = version === "latest" ? this.versionsOf(dir).at(-1) : version;
      const file = v === undefined ? null : join(dir, "versions", String(v), "deck.html");
      return file && existsSync(file) ? readFileSync(file, "utf8") : null;
    }
    // Draft: whatever slides/<id>.html exist right now, bundled on demand (cached until a slide file changes).
    const slidesDir = join(dir, "slides");
    const style = readJson<Style>(join(dir, "style.json"));
    const outline = this.outline(dir);
    if (!existsSync(slidesDir) || !outline || !style) return null;
    const ids = outlineSlides(outline)
      .map((s) => s.id)
      .filter((sid) => existsSync(join(slidesDir, `${sid}.html`)));
    if (!ids.length) return null;
    const key = ids.map((sid) => `${sid}:${statSync(join(slidesDir, `${sid}.html`)).mtimeMs}`).join("|");
    const hit = draftCache.get(id);
    if (hit?.key === key) return hit.html;
    const html = (async () => {
      const [{ bundleHtml }, { deckConfig, toScript }] = await Promise.all([engine(), pipeline()]);
      const config = deckConfig(outline.title, style, toScript(outline), ids);
      const slides = Object.fromEntries(ids.map((sid) => [sid, readFileSync(join(slidesDir, `${sid}.html`), "utf8")]));
      return bundleHtml({ config, slides });
    })();
    html.catch(() => draftCache.delete(id));
    draftCache.set(id, { key, html });
    return html;
  }
}
