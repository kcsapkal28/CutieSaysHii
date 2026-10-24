// The build loop. Per slide: builder → single-slide preview bundle → shoot (+ deterministic pre-check) → critic → fix,
// for `maxRounds` critic rounds, plus one escalated fix attempt when the final round still has a high-severity problem;
// the best attempt is kept. A round whose pre-check finds hard failures (clipped/overlapping/off-canvas text, a blank
// render, a dead canvas, console errors, external requests) skips the critic and goes straight back to the builder with
// the measured facts; up to `precheckRetries` such rounds per slide don't use up a critic round.
// The build stage runs it for every slide (concurrently), then bundles the full deck to versions/<n>/deck.html.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ContractError } from "../check.ts";
import type { DeckConfig, Engine, Style } from "../contract.ts";
import type { ImageData, Llm } from "../llm.ts";
import { attemptScore, runCritic, sampleSteps } from "../agents/critic.ts";
import { runBuilder, type BuildFix, type Exemplar } from "../agents/builder.ts";
import type { CriticReport, Issue, Outline, Script, Storyboard, StoryboardSlide } from "../agents/schemas.ts";
import { BUILD_DEFAULTS, DEFAULT_MODELS } from "./config.ts";
import type { OnEvent, Verdict } from "./events.ts";
import { measuredNotes, precheck, PRECHECK_FAILED_SCORE, precheckIssues, type PrecheckKind } from "./precheck.ts";
import { nextVersion, writeJson, type Project } from "./project.ts";

export type BuildOptions = {
  llm: Llm;
  engine: Engine;
  onEvent: OnEvent;
  concurrency?: number;
  maxRounds?: number;
  escalate?: boolean;
  /** Extra builder attempts per slide for rounds the pre-check fails (they don't count against `maxRounds`). */
  precheckRetries?: number;
  models?: { builder?: string; builderEscalation?: string; critic?: string };
  /** Builder thinking for draft and fix rounds ("off" = fast); the escalated round always uses the model's own. */
  builderThinking?: "off" | "model";
  exemplars?: Exemplar[];
  /** Downscales a screenshot for the critic (the shared engine does it in Chromium); default sends the PNG as is. */
  shrinkImage?: (png: Buffer) => Promise<ImageData>;
};

const asPng = async (png: Buffer): Promise<ImageData> => ({ data: png, mediaType: "image/png" });

export type RoundRecord = {
  round: number;
  model: string;
  escalated?: boolean;
  /** Set when the deterministic pre-check found hard failures, so the critic was skipped this round. */
  precheck?: { errors: number; warnings: number; kinds: PrecheckKind[] };
  verdict?: Verdict;
  score?: number;
  issues?: number;
  errors?: string[];
  error?: string;
};

export type SlideBuild = {
  id: string;
  verdict: Verdict | "failed";
  bestRound: number;
  rounds: RoundRecord[];
  score: number;
  issues: CriticReport["issues"];
};

export type BuildSummary = { version: number; deckFile: string; slides: SlideBuild[] };

export type BuildInputs = { style: Style; outline: Outline; script: Script; storyboard: Storyboard };

export function deckConfig(title: string, style: Style, script: Script, ids?: string[]): DeckConfig {
  const slides = script.slides.filter((s) => !ids || ids.includes(s.id));
  return { title, style, slides: slides.map((s) => ({ id: s.id, title: s.title, section: s.section, budgetSec: s.budgetSec })) };
}

/** A contract-valid stand-in for a slide every round failed to produce. */
export function placeholderSlide(id: string, title: string): string {
  const esc = title.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  return (
    `<section class="df-slide" id="${id}"><h1>${esc}</h1><aside class="df-notes"><p>This slide failed to build.</p></aside></section>\n` +
    `<style>#${id} h1{position:absolute;left:96px;top:96px;margin:0;font:600 72px/1.1 var(--df-font-display);color:var(--df-text)}</style>`
  );
}

async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) await fn(items[next++]!);
  });
  await Promise.all(workers);
}

const contractIssues = (issues: string[]): Issue[] =>
  issues.map((what) => ({ severity: "high", what, where: "slide source", fix: "Make the fragment follow the slide contract." }));

export type SlideJob = {
  slide: Script["slides"][number];
  board: StoryboardSlide;
  index: number;
  /** Where this run's round folders go (r1, r2, …). */
  shotsDir: string;
  /** Start from an existing slide (revise): the first round is already a fix. */
  initialFix?: BuildFix;
  instruction?: string;
};

/** Runs the round loop for one slide and returns the best attempt (or a placeholder when every round failed). */
export async function buildSlide(inputs: BuildInputs, job: SlideJob, o: BuildOptions): Promise<{ html: string; build: SlideBuild }> {
  const { style, outline, script, storyboard } = inputs;
  const { slide, board } = job;
  const models = {
    builder: o.models?.builder ?? DEFAULT_MODELS.builder,
    escalation: o.models?.builderEscalation ?? DEFAULT_MODELS.builderEscalation,
    critic: o.models?.critic ?? DEFAULT_MODELS.critic,
  };
  const plan: { model: string; escalated?: boolean }[] = Array.from({ length: o.maxRounds ?? BUILD_DEFAULTS.maxRounds }, () => ({ model: models.builder }));
  const escalate = o.escalate ?? BUILD_DEFAULTS.escalate;

  const build: SlideBuild = { id: slide.id, verdict: "failed", bestRound: 0, rounds: [], score: 0, issues: [] };
  let best: { html: string; score: number } | undefined;
  let fix = job.initialFix;
  const shrink = o.shrinkImage ?? asPng;
  let retries = o.precheckRetries ?? BUILD_DEFAULTS.precheckRetries;
  let slot = 0; // index into `plan`: the critic round this attempt belongs to

  for (let round = 1; slot < plan.length; round++) {
    const { model, escalated } = plan[slot]!;
    const tag = escalated ? { escalated: true } : {};
    const record: RoundRecord = { round, model, ...tag };
    build.rounds.push(record);
    const roundDir = join(job.shotsDir, `r${round}`);
    mkdirSync(roundDir, { recursive: true });
    let report: CriticReport | undefined;
    let failedPrecheck = false;
    try {
      o.onEvent({ type: "slide:round", id: slide.id, round, phase: "build", model, ...tag });
      const built = await runBuilder(
        o.llm,
        { deckTitle: outline.title, style, slide, board, deck: storyboard, index: job.index, total: script.slides.length, ...(fix ? { fix } : {}) },
        { model, thinking: escalated ? "model" : (o.builderThinking ?? BUILD_DEFAULTS.builderThinking), ...(o.exemplars ? { exemplars: o.exemplars } : {}) },
      );
      writeFileSync(join(roundDir, "slide.html"), built.html);

      o.onEvent({ type: "slide:round", id: slide.id, round, phase: "bundle" });
      const deckFile = join(roundDir, "preview.html");
      try {
        await o.engine.bundle({ config: deckConfig(outline.title, style, script, [slide.id]), slides: { [slide.id]: built.html }, outFile: deckFile });
      } catch (e) {
        if (!(e instanceof ContractError)) throw e;
        // Contract violations go straight back to the builder as the next round's fix input.
        fix = { previousHtml: built.html, issues: contractIssues(e.issues), errors: [], ...(job.instruction ? { instruction: job.instruction } : {}) };
        throw e;
      }

      o.onEvent({ type: "slide:round", id: slide.id, round, phase: "shoot" });
      const shot = await o.engine.shoot({ deckFile, slideIds: [slide.id] });
      const shots = shot.shots.filter((s) => s.slideId === slide.id).sort((a, b) => a.step - b.step);
      const files = shots.map((s) => {
        const file = join(roundDir, `step-${s.step}.png`);
        writeFileSync(file, s.png);
        return file;
      });
      o.onEvent({ type: "slide:shots", id: slide.id, round, files });

      const pre = precheck(shot, slide.id);
      const { errors } = pre;
      writeJson(join(roundDir, "precheck.json"), { findings: pre.findings, errors });
      o.onEvent({ type: "slide:precheck", id: slide.id, round, errors: pre.hard, warnings: pre.warnings.length, kinds: pre.kinds });

      if (pre.hard > 0) {
        // Measured failures: no critic this round. The builder gets the facts (and the step that shows the first one).
        failedPrecheck = true;
        const issues = precheckIssues(pre.findings);
        Object.assign(record, { precheck: { errors: pre.hard, warnings: pre.warnings.length, kinds: pre.kinds }, errors });
        const score = PRECHECK_FAILED_SCORE - pre.hard;
        if (!best || score > best.score) {
          best = { html: built.html, score };
          Object.assign(build, { verdict: "fix", bestRound: round, score: 0, issues });
        }
        const at = pre.blocking[0]?.step;
        const view = shots.find((s) => s.step === at) ?? shots.at(-1);
        const screenshot = view ? await shrink(view.png) : undefined;
        fix = { previousHtml: built.html, issues, errors, ...(screenshot ? { screenshot } : {}), ...(job.instruction ? { instruction: job.instruction } : {}) };
      } else {
        o.onEvent({ type: "slide:round", id: slide.id, round, phase: "critic" });
        // Full-size PNGs of every step overflow the proxy's request limit: review ≤ 4 steps, downscaled.
        const reviewed = await Promise.all(sampleSteps(shots).map(async (s) => ({ step: s.step, image: await shrink(s.png) })));
        report = await runCritic(
          o.llm,
          {
            slide,
            board,
            shots: reviewed,
            steps: shot.steps[slide.id] ?? shots.length,
            errors,
            measured: measuredNotes(pre.warnings),
            ...(job.instruction ? { instruction: job.instruction } : {}),
          },
          { model: models.critic },
        );
        writeJson(join(roundDir, "review.json"), { ...report, errors });
        Object.assign(record, { verdict: report.verdict, score: report.score, issues: report.issues.length, errors });
        o.onEvent({ type: "slide:verdict", id: slide.id, round, verdict: report.verdict, score: report.score, issues: report.issues.length, errors: errors.length });

        const score = attemptScore(report, errors.length);
        if (!best || score > best.score) {
          best = { html: built.html, score };
          Object.assign(build, { verdict: report.verdict, bestRound: round, score: report.score, issues: report.issues });
        }
        if (report.verdict === "pass") break;
        const last = reviewed.at(-1);
        fix = { previousHtml: built.html, issues: report.issues, errors, ...(last ? { screenshot: last.image } : {}), ...(job.instruction ? { instruction: job.instruction } : {}) };
      }
    } catch (e) {
      record.error = e instanceof Error ? e.message : String(e);
      o.onEvent({ type: "slide:error", id: slide.id, round, error: record.error });
    }
    // A pre-check failure retries without using up the critic round, while retries last.
    if (failedPrecheck && retries > 0) {
      retries--;
      continue;
    }
    slot++;
    const final = slot === plan.length;
    const serious = failedPrecheck || (report?.verdict === "fix" && report.issues.some((i) => i.severity === "high"));
    if (final && escalate && !escalated && models.escalation !== model && serious) {
      plan.push({ model: models.escalation, escalated: true });
      o.onEvent({ type: "slide:escalate", id: slide.id, round: round + 1, model: models.escalation });
    }
  }

  return { html: best?.html ?? placeholderSlide(slide.id, slide.title), build };
}

/** The build stage: every slide through the round loop (concurrently), then the full deck → versions/<n>/deck.html. */
export async function runBuild(project: Project, inputs: BuildInputs, o: BuildOptions): Promise<BuildSummary> {
  const { script, storyboard } = inputs;
  const slidesDir = join(project.dir, "slides");
  mkdirSync(slidesDir, { recursive: true });
  const boards = new Map(storyboard.slides.map((b) => [b.id, b]));
  const results = new Map<string, { html: string; build: SlideBuild }>();

  await pool(script.slides, o.concurrency ?? BUILD_DEFAULTS.concurrency, async (slide) => {
    const board = boards.get(slide.id);
    if (!board) throw new Error(`storyboard has no entry for ${slide.id}`);
    const result = await buildSlide(inputs, { slide, board, index: script.slides.indexOf(slide), shotsDir: join(project.dir, "shots", slide.id) }, o);
    writeFileSync(join(slidesDir, `${slide.id}.html`), result.html);
    results.set(slide.id, result);
    const b = result.build;
    o.onEvent({ type: "slide:done", id: slide.id, bestRound: b.bestRound, rounds: b.rounds.length, verdict: b.verdict, score: b.score });
  });

  const slides = Object.fromEntries(script.slides.map((s) => [s.id, results.get(s.id)!.html]));
  const { version, deckFile } = await bundleVersion(project, inputs, slides, o, { kind: "build" });
  const summary: BuildSummary = { version, deckFile, slides: script.slides.map((s) => results.get(s.id)!.build) };
  writeJson(join(project.dir, "build.json"), summary);
  return summary;
}

export type VersionMeta = { version: number; kind: "build" | "revise"; slideId?: string; instruction?: string; createdAt: string };

/** Bundles the given slides as the next versions/<n>/deck.html (with deck.json and meta.json). */
export async function bundleVersion(
  project: Project,
  inputs: Pick<BuildInputs, "style" | "outline" | "script">,
  slides: Record<string, string>,
  o: Pick<BuildOptions, "engine" | "onEvent">,
  meta: Omit<VersionMeta, "version" | "createdAt">,
): Promise<{ version: number; deckFile: string }> {
  const version = nextVersion(project);
  const versionDir = join(project.dir, "versions", String(version));
  mkdirSync(versionDir, { recursive: true });
  const config = deckConfig(inputs.outline.title, inputs.style, inputs.script);
  const deckFile = join(versionDir, "deck.html");
  await o.engine.bundle({ config, slides, outFile: deckFile });
  writeJson(join(versionDir, "deck.json"), config);
  writeJson(join(versionDir, "meta.json"), { version, ...meta, createdAt: new Date().toISOString() } satisfies VersionMeta);
  o.onEvent({ type: "deck:done", version, file: deckFile });
  return { version, deckFile };
}
