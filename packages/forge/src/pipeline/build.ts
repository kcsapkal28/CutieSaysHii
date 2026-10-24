// The build stage: per slide (concurrency 3) builder → single-slide preview bundle → shoot → critic → fix, ≤ 3 rounds,
// keeping the best attempt; then the full deck is bundled to versions/<n>/deck.html.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DeckConfig, Engine, Style } from "../contract.ts";
import type { Llm } from "../llm.ts";
import { attemptScore, runCritic } from "../agents/critic.ts";
import { runBuilder, type BuildFix, type Exemplar } from "../agents/builder.ts";
import type { CriticReport, Outline, Script, Storyboard } from "../agents/schemas.ts";
import type { OnEvent } from "./events.ts";
import { nextVersion, writeJson, type Project } from "./project.ts";

export type BuildOptions = {
  llm: Llm;
  engine: Engine;
  onEvent: OnEvent;
  concurrency?: number;
  maxRounds?: number;
  models?: { builder?: string; critic?: string };
  exemplars?: Exemplar[];
};

export type SlideBuild = {
  id: string;
  verdict: "pass" | "fix" | "failed";
  bestRound: number;
  rounds: { round: number; verdict?: "pass" | "fix"; score?: number; issues?: number; errors?: string[]; error?: string }[];
  score: number;
  issues: CriticReport["issues"];
};

export type BuildSummary = { version: number; deckFile: string; slides: SlideBuild[] };

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
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]!);
  });
  await Promise.all(workers);
}

export async function runBuild(
  project: Project,
  input: { style: Style; outline: Outline; script: Script; storyboard: Storyboard },
  o: BuildOptions,
): Promise<BuildSummary> {
  const { style, outline, script, storyboard } = input;
  const maxRounds = o.maxRounds ?? 3;
  const slidesDir = join(project.dir, "slides");
  mkdirSync(slidesDir, { recursive: true });
  const boards = new Map(storyboard.slides.map((b) => [b.id, b]));
  const results = new Map<string, { html: string; build: SlideBuild }>();

  await pool(script.slides, o.concurrency ?? 3, async (slide) => {
    const index = script.slides.indexOf(slide);
    const board = boards.get(slide.id);
    if (!board) throw new Error(`storyboard has no entry for ${slide.id}`);
    const build: SlideBuild = { id: slide.id, verdict: "failed", bestRound: 0, rounds: [], score: -Infinity, issues: [] };
    let best: { html: string; score: number } | undefined;
    let fix: BuildFix | undefined;

    for (let round = 1; round <= maxRounds; round++) {
      const roundDir = join(project.dir, "shots", slide.id, `r${round}`);
      mkdirSync(roundDir, { recursive: true });
      try {
        o.onEvent({ type: "slide:round", id: slide.id, round, phase: "build" });
        const built = await runBuilder(
          o.llm,
          { deckTitle: outline.title, style, slide, board, deck: storyboard, index, total: script.slides.length, ...(fix ? { fix } : {}) },
          { ...(o.models?.builder ? { model: o.models.builder } : {}), ...(o.exemplars ? { exemplars: o.exemplars } : {}) },
        );
        writeFileSync(join(roundDir, "slide.html"), built.html);

        o.onEvent({ type: "slide:round", id: slide.id, round, phase: "bundle" });
        const deckFile = join(roundDir, "preview.html");
        await o.engine.bundle({ config: deckConfig(outline.title, style, script, [slide.id]), slides: { [slide.id]: built.html }, outFile: deckFile });

        o.onEvent({ type: "slide:round", id: slide.id, round, phase: "shoot" });
        const shot = await o.engine.shoot({ deckFile, slideIds: [slide.id] });
        const shots = shot.shots.filter((s) => s.slideId === slide.id).sort((a, b) => a.step - b.step);
        for (const s of shots) writeFileSync(join(roundDir, `step-${s.step}.png`), s.png);
        const errors = [
          ...(shot.errors[slide.id] ?? []),
          ...(shot.errors.deck ?? []),
          ...shot.externalRequests.map((u) => `external request (the deck must be self-contained): ${u}`),
        ];

        o.onEvent({ type: "slide:round", id: slide.id, round, phase: "critic" });
        const report = await runCritic(
          o.llm,
          { slide, board, shots, steps: shot.steps[slide.id] ?? shots.length, errors },
          o.models?.critic ? { model: o.models.critic } : {},
        );
        writeJson(join(roundDir, "review.json"), { ...report, errors });
        const score = attemptScore(report, errors.length);
        build.rounds.push({ round, verdict: report.verdict, score: report.score, issues: report.issues.length, errors });
        o.onEvent({ type: "slide:verdict", id: slide.id, round, verdict: report.verdict, score: report.score, issues: report.issues.length, errors: errors.length });

        if (!best || score > best.score) {
          best = { html: built.html, score };
          Object.assign(build, { verdict: report.verdict, bestRound: round, score: report.score, issues: report.issues });
        }
        if (report.verdict === "pass") break;
        const last = shots.at(-1);
        fix = { previousHtml: built.html, issues: report.issues, errors, ...(last ? { screenshot: last.png } : {}) };
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        build.rounds.push({ round, error });
        o.onEvent({ type: "slide:error", id: slide.id, round, error });
      }
    }

    const html = best?.html ?? placeholderSlide(slide.id, slide.title);
    if (!best) build.score = 0;
    writeFileSync(join(slidesDir, `${slide.id}.html`), html);
    results.set(slide.id, { html, build });
    o.onEvent({ type: "slide:done", id: slide.id, bestRound: build.bestRound, rounds: build.rounds.length, verdict: build.verdict, score: build.score });
  });

  const version = nextVersion(project);
  const versionDir = join(project.dir, "versions", String(version));
  mkdirSync(versionDir, { recursive: true });
  const config = deckConfig(outline.title, style, script);
  const deckFile = join(versionDir, "deck.html");
  const slides = Object.fromEntries(script.slides.map((s) => [s.id, results.get(s.id)!.html]));
  await o.engine.bundle({ config, slides, outFile: deckFile });
  writeJson(join(versionDir, "deck.json"), config);
  o.onEvent({ type: "deck:done", version, file: deckFile });

  const summary: BuildSummary = { version, deckFile, slides: script.slides.map((s) => results.get(s.id)!.build) };
  writeJson(join(project.dir, "build.json"), summary);
  return summary;
}
