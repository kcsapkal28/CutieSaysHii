// In-memory StudioBackend with timed fake agent events. Every project, whatever its topic, produces the ANC deck.
// Decks are bundled by the real engine (bundleHtml) from hand-written contract slides in ./slides.ts.
// STUDIO_MOCK_SPEED scales all delays (e.g. 0.1 in the e2e test).
import type { DeckConfig, Style } from "@deckforge/forge";
import { NotFound, type DeckRef, type RunOptions, type StudioBackend } from "../backend";
import { engine } from "../server/engine";
import type { PipelineEvent } from "../events";
import { cloneStyle, LOOKS } from "../looks";
import {
  STAGE_FILE,
  STAGES,
  type Brief,
  type Outline,
  type Project,
  type ProjectSummary,
  type Script,
  type SlideBuildState,
  type StageFileName,
  type StageName,
  type StageState,
  type Usage,
  type VersionInfo,
} from "../types";
import {
  ANC_BRIEF,
  ANC_CRITIC,
  ANC_OUTLINE,
  ANC_RESEARCH,
  ANC_SCRIPT,
  ANC_STORYBOARD,
  OUTLINE_LOG,
  RESEARCH_LOG,
  SCRIPT_LOG,
  STORYBOARD_LOG,
} from "./anc";
import { MOCK_SLIDE_IDS, slideSource, type SlideOpts } from "./slides";

interface MockVersion {
  info: VersionInfo;
  opts: Record<string, Partial<SlideOpts>>;
  style: Style;
}

interface MockProject {
  id: string;
  title: string;
  brief: Brief;
  createdAt: string;
  updatedAt: string;
  stageState: Record<StageName, StageState>;
  files: Partial<Record<StageFileName, string>>;
  build: { slides: SlideBuildState[] } | null;
  versions: MockVersion[];
}

const SPEED = Number(process.env.STUDIO_MOCK_SPEED ?? "1") || 1;
const now = () => new Date().toISOString();
const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;
const zeroUsage = (): Usage => ({ inputTokens: 0, outputTokens: 0, costUsd: 0 });

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("aborted"));
    const t = setTimeout(resolve, ms * SPEED);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new Error("aborted"));
      },
      { once: true },
    );
  });
}

function stageState(status: StageState["status"], at: string | null = null, usage: Usage = zeroUsage()): StageState {
  return { status, updatedAt: at, usage, log: [] };
}

function freshStages(): Record<StageName, StageState> {
  return Object.fromEntries(STAGES.map((s) => [s, stageState("idle")])) as Record<StageName, StageState>;
}

function titleFrom(topic: string): string {
  const t = topic.trim().replace(/\s+/g, " ");
  if (t.length <= 42) return t.charAt(0).toUpperCase() + t.slice(1);
  return `${t.slice(0, 40).replace(/\s\S*$/, "")}…`;
}

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 3600_000).toISOString();
}

const SLIDE_MODEL = "claude-opus-5-5";
const TEXT_MODEL = "claude-sonnet-5";

// ---------------------------------------------------------------- seed data
function seed(): Map<string, MockProject> {
  const map = new Map<string, MockProject>();
  const cinematic = cloneStyle(LOOKS[0]!.style);
  cinematic.features = { timer: true, notes: true, stepNav: true, print: false };

  const done = (h: number, u: Usage, lines: string[] = []): StageState => ({
    ...stageState("approved", hoursAgo(h), u),
    log: [...lines.map((message, i) => ({ at: hoursAgo(h + (lines.length - i) / 120), message })), { at: hoursAgo(h), message: "Done. Approved." }],
  });
  const anc: MockProject = {
    id: "inside-anc",
    title: "Inside ANC",
    brief: ANC_BRIEF,
    createdAt: hoursAgo(30),
    updatedAt: hoursAgo(0.4),
    stageState: {
      research: done(29, { inputTokens: 48_200, outputTokens: 6_100, costUsd: 0.24 }, RESEARCH_LOG),
      outline: done(28.5, { inputTokens: 12_400, outputTokens: 2_300, costUsd: 0.07 }, OUTLINE_LOG),
      script: done(28, { inputTokens: 15_800, outputTokens: 5_400, costUsd: 0.13 }, SCRIPT_LOG),
      storyboard: done(27, { inputTokens: 31_000, outputTokens: 9_800, costUsd: 1.2 }, STORYBOARD_LOG),
      build: done(26, { inputTokens: 612_000, outputTokens: 188_000, costUsd: 23.4 }, ANC_SCRIPT.slides.map((s) => `${s.id} passed after ${(ANC_CRITIC[s.id]?.length ?? 0) + 1} round(s)`)),
    },
    files: {
      "brief.json": json(ANC_BRIEF),
      "style.json": json(cinematic),
      "research.md": ANC_RESEARCH,
      "outline.json": json(ANC_OUTLINE),
      "script.json": json(ANC_SCRIPT),
      "storyboard.json": json(ANC_STORYBOARD),
    },
    build: {
      slides: ANC_SCRIPT.slides.map((s) => {
        const fails = ANC_CRITIC[s.id] ?? [];
        return {
          id: s.id,
          title: s.title,
          status: "done",
          rounds: fails.length + 1,
          verdict: "pass",
          issues: fails.flatMap((round, i) => round.map((text) => ({ round: i + 1, text, fixed: true }))),
        };
      }),
    },
    versions: [
      { info: { version: 1, createdAt: hoursAgo(26), note: "Build", slideIds: MOCK_SLIDE_IDS, changed: MOCK_SLIDE_IDS }, opts: {}, style: cinematic },
      {
        info: { version: 2, createdAt: hoursAgo(3), note: "s01: Make the title bigger", slideIds: MOCK_SLIDE_IDS, changed: ["s01"] },
        opts: { s01: { titleScale: 1.15 } },
        style: cinematic,
      },
      {
        info: { version: 3, createdAt: hoursAgo(0.4), note: "s07: Say what the slider does in plain words", slideIds: MOCK_SLIDE_IDS, changed: ["s07"] },
        opts: { s01: { titleScale: 1.15 }, s07: { altCopy: true } },
        style: cinematic,
      },
    ],
  };
  map.set(anc.id, anc);

  const technical = cloneStyle(LOOKS[1]!.style);
  const jpegBrief: Brief = {
    topic: "JPEG compression, block by block",
    audience: "Computer science undergraduates",
    minutes: 15,
    goal: "Understand why JPEG throws away high frequencies and where the blocky artefacts come from.",
    notes: "Light theme. Let people drag a quality slider on a real 8×8 block.",
  };
  map.set("jpeg-blocks", {
    id: "jpeg-blocks",
    title: "JPEG, block by block",
    brief: jpegBrief,
    createdAt: hoursAgo(5),
    updatedAt: hoursAgo(1.2),
    stageState: {
      ...freshStages(),
      research: {
        ...stageState("review", hoursAgo(1.2), { inputTokens: 39_000, outputTokens: 5_200, costUsd: 0.2 }),
        log: [
          "Reading the brief: 15 min, CS undergraduates",
          "Searching: JPEG baseline pipeline DCT quantisation",
          "Reading ITU-T T.81",
          "Reading Wallace, The JPEG Still Picture Compression Standard",
          "Searching: JPEG blocking ringing artefacts cause",
          "Writing research.md with 3 sources",
          "Done. Waiting for your review.",
        ].map((message, i) => ({ at: hoursAgo(1.2 + (7 - i) / 200), message })),
      },
    },
    files: {
      "brief.json": json(jpegBrief),
      "style.json": json(technical),
      "research.md": `# JPEG compression\n\n## Summary\nJPEG splits an image into 8×8 blocks, transforms each with the discrete cosine transform (DCT), and quantises the coefficients so that high-frequency detail is stored coarsely or dropped [1].\n\n## Pipeline\n- Colour conversion to YCbCr and chroma subsampling (4:2:0) [1].\n- 8×8 DCT per block: 64 coefficients, from the DC average to the finest checkerboard [2].\n- Quantisation by a quality-scaled table; this is the only lossy step [1].\n- Zig-zag ordering, run-length and Huffman coding [2].\n\n## Artefacts\n- Blocking appears when neighbouring blocks quantise their DC terms differently [3].\n- Ringing near edges comes from discarded high-frequency coefficients [3].\n\n## Sources\n1. ITU-T T.81 (1992), *Digital compression and coding of continuous-tone still images*.\n2. Wallace, *The JPEG Still Picture Compression Standard*, CACM, 1991.\n3. Pennebaker & Mitchell, *JPEG Still Image Data Compression Standard*, 1993.\n`,
    },
    build: null,
    versions: [],
  });

  const axiBrief: Brief = {
    topic: "AXI4 handshakes in one afternoon",
    audience: "FPGA engineers moving from Wishbone",
    minutes: 30,
    goal: "Be confident reading any AXI4 waveform.",
  };
  map.set("axi-afternoon", {
    id: "axi-afternoon",
    title: "AXI4 handshakes in one afternoon",
    brief: axiBrief,
    createdAt: hoursAgo(0.2),
    updatedAt: hoursAgo(0.2),
    stageState: freshStages(),
    files: { "brief.json": json(axiBrief) },
    build: null,
    versions: [],
  });
  return map;
}

// Survives Next dev hot reloads.
const g = globalThis as unknown as { __studioMock?: Map<string, MockProject>; __studioDeckCache?: Map<string, Promise<string>> };
const store = (g.__studioMock ??= seed());
const deckCache = (g.__studioDeckCache ??= new Map());

function parseStyle(p: MockProject): Style | null {
  const raw = p.files["style.json"];
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Style; // validated on save
  } catch {
    return null;
  }
}

function summary(p: MockProject): ProjectSummary {
  const latest = p.versions.at(-1);
  const slideCount = safeJson<Script>(p.files["script.json"])?.slides.length ?? 0;
  return {
    id: p.id,
    title: p.title,
    topic: p.brief.topic,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    stages: Object.fromEntries(STAGES.map((s) => [s, p.stageState[s].status])) as ProjectSummary["stages"],
    hasStyle: !!p.files["style.json"],
    latestVersion: latest?.info.version ?? null,
    style: parseStyle(p),
    slideCount,
  };
}

function full(p: MockProject): Project {
  return structuredClone({ ...summary(p), brief: p.brief, stageState: p.stageState, files: p.files, build: p.build });
}

function need(id: string): MockProject {
  const p = store.get(id);
  if (!p) throw new NotFound(`No project "${id}"`);
  return p;
}


const STAGE_OUTPUT: Record<Exclude<StageName, "build">, () => string> = {
  research: () => ANC_RESEARCH,
  outline: () => json(ANC_OUTLINE),
  script: () => json(ANC_SCRIPT),
  storyboard: () => json(ANC_STORYBOARD),
};
const STAGE_LOG: Record<Exclude<StageName, "build">, string[]> = {
  research: RESEARCH_LOG,
  outline: OUTLINE_LOG,
  script: SCRIPT_LOG,
  storyboard: STORYBOARD_LOG,
};

function reviseOpts(prev: Partial<SlideOpts>, instruction: string): Partial<SlideOpts> {
  const o = { ...prev };
  if (/slow/i.test(instruction)) o.speed = (o.speed ?? 1) * 0.5;
  else if (/fast|quick/i.test(instruction)) o.speed = (o.speed ?? 1) * 2;
  else if (/big|larger|bolder/i.test(instruction)) o.titleScale = (o.titleScale ?? 1) * 1.15;
  else if (/small|tighter/i.test(instruction)) o.titleScale = (o.titleScale ?? 1) * 0.87;
  else o.altCopy = !o.altCopy;
  return o;
}

export class MockBackend implements StudioBackend {
  async createProject(brief: Brief): Promise<ProjectSummary> {
    const base =
      brief.topic
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 32) || "deck";
    let id = base;
    for (let n = 2; store.has(id); n++) id = `${base}-${n}`;
    const at = now();
    const p: MockProject = {
      id,
      title: titleFrom(brief.topic),
      brief,
      createdAt: at,
      updatedAt: at,
      stageState: freshStages(),
      files: { "brief.json": json(brief) },
      build: null,
      versions: [],
    };
    store.set(id, p);
    return summary(p);
  }

  async listProjects(): Promise<ProjectSummary[]> {
    return [...store.values()].map(summary).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async loadProject(id: string): Promise<Project | null> {
    const p = store.get(id);
    return p ? full(p) : null;
  }

  async approveStage(id: string, stage: StageName): Promise<Project> {
    const p = need(id);
    const st = p.stageState[stage];
    if (st.status !== "review" && st.status !== "approved") throw new Error(`${stage} has no output to approve yet`);
    st.status = "approved";
    st.updatedAt = p.updatedAt = now();
    return full(p);
  }

  async saveStageFile(id: string, file: StageFileName, content: string): Promise<Project> {
    const p = need(id);
    if (file.endsWith(".json")) JSON.parse(content); // throws on invalid JSON
    if (file === "style.json") {
      const { Style: StyleSchema, themeCss } = await engine();
      themeCss(StyleSchema.parse(JSON.parse(content)).theme); // rejects unknown fonts / unsafe values
    }
    if (file === "brief.json") {
      p.brief = JSON.parse(content) as Brief;
      p.title = titleFrom(p.brief.topic);
    }
    p.files[file] = content;
    const stage = (Object.entries(STAGE_FILE) as [StageName, StageFileName][]).find(([, f]) => f === file)?.[0];
    if (stage && p.stageState[stage].status === "idle") p.stageState[stage].status = "review";
    p.updatedAt = now();
    return full(p);
  }

  async recommendStyle(brief: Brief): Promise<{ style: Style; rationale: string }> {
    await sleep(1400);
    const t = `${brief.topic} ${brief.audience} ${brief.notes ?? ""}`.toLowerCase();
    let look = LOOKS[0]!;
    let why =
      "A hardware teardown story suits a dark, cinematic stage: the white earbud reads as the hero against a deep violet backdrop, and cyan-to-violet accents carry the signal paths. Plex keeps the engineering voice. Rich motion and 3D for the exploded view; light interactivity for the one simulation.";
    if (/jpeg|dct|compress|fifo|axi|spi|fpga|protocol|student|undergrad/.test(t)) {
      look = LOOKS[1]!;
      why =
        "A protocol or algorithm walkthrough reads best on a light, technical canvas: crisp diagrams, teal for data and blue for control. Rich interactivity lets people drive the simulations themselves; motion stays subtle so it never competes with them.";
    } else if (/history|story|policy|essay|culture/.test(t)) {
      look = LOOKS[2]!;
      why = "A narrative topic wants an editorial voice: serif headlines, generous margins and calm motion.";
    }
    const style = cloneStyle(look.style);
    style.features = { timer: brief.minutes >= 15, notes: true, stepNav: brief.minutes >= 15, print: false };
    return { style, rationale: why };
  }

  async *runStage(id: string, stage: StageName, opts: RunOptions = {}): AsyncIterable<PipelineEvent> {
    const p = need(id);
    const st = p.stageState[stage];
    if (st.status === "running") {
      yield { type: "error", stage, message: `${stage} is already running`, retryable: false };
      return;
    }
    const before = st.status;
    let finished = false;
    st.status = "running";
    st.error = undefined;
    st.log = [];
    st.usage = zeroUsage();
    st.updatedAt = p.updatedAt = now();
    const sig = opts.signal;
    const log = (message: string, slideId?: string): PipelineEvent => {
      const at = now();
      st.log.push({ at, message });
      return { type: "progress", stage, message, at, ...(slideId ? { slideId } : {}) };
    };
    const use = (model: string, inTok: number, outTok: number, perM: [number, number]): PipelineEvent => {
      st.usage = {
        inputTokens: st.usage.inputTokens + inTok,
        outputTokens: st.usage.outputTokens + outTok,
        costUsd: st.usage.costUsd + (inTok * perM[0] + outTok * perM[1]) / 1e6,
      };
      return { type: "usage", model, usage: { ...st.usage } };
    };
    try {
      yield { type: "stage.start", stage, at: st.updatedAt };
      if (p.brief.topic.includes("#fail")) {
        await sleep(900, sig);
        throw new Error("The research agent could not reach the web search tool (HTTP 502). Check LLM_BASE_URL and re-run.");
      }
      if (stage !== "build") {
        const lines = STAGE_LOG[stage];
        const output = STAGE_OUTPUT[stage]();
        const isOpus = stage === "storyboard";
        for (let i = 0; i < lines.length; i++) {
          await sleep(stage === "research" ? 750 : 650, sig);
          yield log(lines[i]!);
          yield use(isOpus ? SLIDE_MODEL : TEXT_MODEL, 4200 + i * 900, 600 + i * 140, isOpus ? [15, 75] : [3, 15]);
          if (stage === "research" && i >= 3) {
            const cut = Math.floor((output.length * (i - 2)) / (lines.length - 3));
            yield { type: "stage.output", stage, file: STAGE_FILE[stage], content: output.slice(0, cut) };
          }
        }
        p.files[STAGE_FILE[stage]] = output;
        yield { type: "stage.output", stage, file: STAGE_FILE[stage], content: output };
      } else {
        yield* this.build(p, st, log, use, sig);
      }
      st.status = "review";
      st.updatedAt = p.updatedAt = now();
      finished = true;
      yield { type: "stage.done", stage, at: st.updatedAt };
    } catch (e) {
      if (sig?.aborted) return;
      finished = true;
      st.status = "error";
      st.error = (e as Error).message;
      yield { type: "error", stage, message: st.error, retryable: true };
    } finally {
      if (!finished) {
        st.status = before;
        st.log.push({ at: now(), message: "Stopped" });
        if (p.build) for (const s of p.build.slides) if (s.status === "building") s.status = "queued";
      }
    }
  }

  private async *build(
    p: MockProject,
    st: StageState,
    log: (m: string, slideId?: string) => PipelineEvent,
    use: (model: string, i: number, o: number, perM: [number, number]) => PipelineEvent,
    sig?: AbortSignal,
  ): AsyncGenerator<PipelineEvent> {
    const script = ANC_SCRIPT.slides.filter((s) => MOCK_SLIDE_IDS.includes(s.id));
    p.build = { slides: script.map((s) => ({ id: s.id, title: s.title, status: "queued", rounds: 0, issues: [] })) };
    yield log(`Building ${script.length} slides with ${SLIDE_MODEL}`);
    for (const s of p.build.slides) {
      s.status = "building";
      yield { type: "slide.start", slideId: s.id, title: s.title };
      const fails = ANC_CRITIC[s.id] ?? [];
      const rounds = Math.min(3, fails.length + 1);
      for (let r = 1; r <= rounds; r++) {
        s.rounds = r;
        for (const phase of ["build", "shoot", "critique"] as const) {
          s.phase = phase;
          yield { type: "slide.round", slideId: s.id, round: r, phase };
          await sleep(phase === "build" ? 900 : phase === "shoot" ? 400 : 650, sig);
        }
        const issues = fails[r - 1] ?? [];
        for (const prev of s.issues) prev.fixed = true;
        s.issues.push(...issues.map((text) => ({ round: r, text, fixed: false })));
        const verdict = issues.length ? "revise" : "pass";
        yield { type: "critic.verdict", slideId: s.id, round: r, verdict, issues };
        yield use(SLIDE_MODEL, 22_000 + r * 4000, 6_500, [15, 75]);
      }
      s.status = "done";
      s.verdict = "pass";
      s.phase = undefined;
      for (const prev of s.issues) prev.fixed = true;
      yield { type: "slide.done", slideId: s.id, rounds, verdict: "pass" };
      yield log(`${s.id} passed after ${rounds} round${rounds > 1 ? "s" : ""}`, s.id);
    }
    const v = this.addVersion(p, "Build", {}, MOCK_SLIDE_IDS);
    yield { type: "version", version: v.version, note: v.note };
    void st;
  }

  async *reviseSlide(id: string, slideId: string, instruction: string, opts: RunOptions = {}): AsyncIterable<PipelineEvent> {
    const p = need(id);
    const sig = opts.signal;
    const latest = p.versions.at(-1);
    if (!latest) {
      yield { type: "error", slideId, message: "Build the deck before refining slides.", retryable: false };
      return;
    }
    if (!MOCK_SLIDE_IDS.includes(slideId)) {
      yield { type: "error", slideId, message: `No slide ${slideId} in this deck.`, retryable: false };
      return;
    }
    const at = () => now();
    try {
      yield { type: "progress", stage: "build", slideId, message: `Reading ${slideId} and your note`, at: at() };
      await sleep(700, sig);
      const rounds = /slow|fast|quick/i.test(instruction) ? 2 : 1;
      for (let r = 1; r <= rounds; r++) {
        for (const phase of ["build", "shoot", "critique"] as const) {
          yield { type: "slide.round", slideId, round: r, phase };
          await sleep(phase === "build" ? 1000 : 500, sig);
        }
        const issues = r < rounds ? ["Packets now overlap the DSP label at the slower speed; offset them 12px."] : [];
        yield { type: "critic.verdict", slideId, round: r, verdict: issues.length ? "revise" : "pass", issues };
      }
      yield { type: "usage", model: SLIDE_MODEL, usage: { inputTokens: 31_000 * rounds, outputTokens: 7_000 * rounds, costUsd: 0.99 * rounds } };
      yield { type: "slide.done", slideId, rounds, verdict: "pass" };
      const nextOpts = { ...latest.opts, [slideId]: reviseOpts(latest.opts[slideId] ?? {}, instruction) };
      const v = this.addVersion(p, `${slideId}: ${instruction}`, nextOpts, [slideId]);
      yield { type: "version", version: v.version, note: v.note };
    } catch (e) {
      if (sig?.aborted) return;
      yield { type: "error", slideId, message: (e as Error).message, retryable: true };
    }
  }

  private addVersion(p: MockProject, note: string, opts: Record<string, Partial<SlideOpts>>, changed: string[]): VersionInfo {
    const style = parseStyle(p) ?? cloneStyle(LOOKS[0]!.style);
    const info: VersionInfo = { version: (p.versions.at(-1)?.info.version ?? 0) + 1, createdAt: now(), note, slideIds: MOCK_SLIDE_IDS, changed };
    p.versions.push({ info, opts, style });
    p.updatedAt = info.createdAt;
    return info;
  }

  async listVersions(id: string): Promise<VersionInfo[]> {
    return need(id).versions.map((v) => ({ ...v.info }));
  }

  async restoreVersion(id: string, version: number): Promise<VersionInfo> {
    const p = need(id);
    const src = p.versions.find((v) => v.info.version === version);
    if (!src) throw new NotFound(`No version ${version}`);
    const info: VersionInfo = {
      version: (p.versions.at(-1)?.info.version ?? 0) + 1,
      createdAt: now(),
      note: `Restored v${version}`,
      slideIds: src.info.slideIds,
      changed: [],
    };
    p.versions.push({ info, opts: structuredClone(src.opts), style: src.style });
    p.updatedAt = info.createdAt;
    return info;
  }

  async getDeckHtml(id: string, version: DeckRef): Promise<string | null> {
    const p = need(id);
    let v: MockVersion | undefined;
    if (version === "draft") {
      // Mock: every slide source exists up front; the build view only shows the ones that have passed.
      if (!p.build && !p.versions.length) return null;
      const style = parseStyle(p) ?? cloneStyle(LOOKS[0]!.style);
      v = p.versions.at(-1) ?? { info: { version: 0, createdAt: now(), note: "draft", slideIds: MOCK_SLIDE_IDS, changed: [] }, opts: {}, style };
    } else v = version === "latest" ? p.versions.at(-1) : p.versions.find((x) => x.info.version === version);
    if (!v) return null;
    const key = `${id}:${v.info.version}:${JSON.stringify([v.style, v.opts])}`;
    let hit = deckCache.get(key);
    if (!hit) {
      const outline = safeJson<Outline>(p.files["outline.json"]) ?? ANC_OUTLINE;
      const sectionOf = (sid: string) => outline.sections.find((s) => s.slides.some((x) => x.id === sid))?.name;
      const config: DeckConfig = {
        title: p.title,
        style: v.style,
        slides: ANC_SCRIPT.slides.map((s) => ({ id: s.id, title: s.title, section: sectionOf(s.id), budgetSec: s.budgetSec })),
      };
      const slides = Object.fromEntries(MOCK_SLIDE_IDS.map((sid) => [sid, slideSource(sid, v.opts[sid])]));
      hit = engine().then((e) => e.bundleHtml({ config, slides }));
      hit.catch(() => deckCache.delete(key));
      deckCache.set(key, hit);
    }
    return hit;
  }
}

function safeJson<T>(raw: string | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
