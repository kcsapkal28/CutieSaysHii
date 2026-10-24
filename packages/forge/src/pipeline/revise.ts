// Per-slide chat: rebuild one slide from an instruction, re-run the critique loop, and save a new deck version.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createProxyLlm } from "../llm.ts";
import { buildSlide, bundleVersion, type BuildSummary, type SlideBuild, type VersionMeta } from "./build.ts";
import { withDefaultThinking, withThinking } from "./config.ts";
import { meteredLlm, type OnEvent } from "./events.ts";
import { journaled, journalFile } from "./journal.ts";
import { readJson, writeJson, type Project } from "./project.ts";
import { buildOptions, loadOutline, loadScript, loadStoryboard, loadStyle, StageError, withEngine, type PipelineOptions } from "./stages.ts";

export type ReviseResult = { build: SlideBuild; version?: number; deckFile?: string };

/**
 * Applies a presenter's instruction to one built slide: the builder revises the current slide with the instruction
 * as its brief, then the usual shoot → critic → fix rounds run. When a round produced a slide, slides/<id>.html is
 * replaced and the full deck is saved as a new version; otherwise nothing changes.
 */
export async function reviseSlide(project: Project, slideId: string, instruction: string, opts: PipelineOptions = {}): Promise<ReviseResult> {
  const slideFile = join(project.dir, "slides", `${slideId}.html`);
  if (!existsSync(slideFile)) throw new StageError(`no built slide ${slideId}: run the build stage first`);
  const journal = journaled(journalFile(project), opts.onEvent, opts.runId);
  const started = Date.now();
  journal.note({ type: "revise:start", slideId, instructionChars: instruction.length });
  try {
    const result = await revise(project, slideId, instruction, opts, journal.onEvent);
    journal.note({ type: "revise:done", slideId, ms: Date.now() - started, verdict: result.build.verdict, version: result.version ?? null });
    return result;
  } catch (e) {
    journal.note({ type: "revise:error", slideId, ms: Date.now() - started, error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

async function revise(project: Project, slideId: string, instruction: string, opts: PipelineOptions, onEvent: OnEvent): Promise<ReviseResult> {
  const slideFile = join(project.dir, "slides", `${slideId}.html`);
  const inputs = { style: loadStyle(project), outline: loadOutline(project), script: loadScript(project), storyboard: loadStoryboard(project) };
  const index = inputs.script.slides.findIndex((s) => s.id === slideId);
  const board = inputs.storyboard.slides.find((b) => b.id === slideId);
  if (index < 0 || !board) throw new StageError(`${slideId} is not in the script and storyboard`);

  const revDir = join(project.dir, "shots", slideId);
  const k = existsSync(revDir) ? readdirSync(revDir).filter((d) => /^rev\d+$/.test(d)).length + 1 : 1;
  const base = opts.llm ?? createProxyLlm();
  const { llm } = meteredLlm(opts.thinking ? withThinking(base, opts.thinking) : withDefaultThinking(base), "revise", onEvent);

  return withEngine(opts.engine, async (engine) => {
    const o = buildOptions(opts, llm, engine, onEvent);
    const { html, build } = await buildSlide(
      inputs,
      {
        slide: inputs.script.slides[index]!,
        board,
        index,
        shotsDir: join(revDir, `rev${k}`),
        initialFix: { previousHtml: readFileSync(slideFile, "utf8"), issues: [], errors: [], instruction },
        instruction,
      },
      o,
    );
    onEvent({ type: "slide:done", id: slideId, bestRound: build.bestRound, rounds: build.rounds.length, verdict: build.verdict, score: build.score });
    if (build.verdict === "failed") return { build };

    writeFileSync(slideFile, html);
    const slides = Object.fromEntries(
      inputs.script.slides.map((s) => [s.id, readFileSync(join(project.dir, "slides", `${s.id}.html`), "utf8")]),
    );
    const { version, deckFile } = await bundleVersion(project, inputs, slides, o, { kind: "revise", slideId, instruction });

    const summaryFile = join(project.dir, "build.json");
    if (existsSync(summaryFile)) {
      const summary = readJson(summaryFile, (v) => v as BuildSummary);
      writeJson(summaryFile, { ...summary, version, deckFile, slides: summary.slides.map((s) => (s.id === slideId ? build : s)) });
    }
    return { build, version, deckFile };
  });
}

export type VersionInfo = VersionMeta & { file: string };

/** Every saved deck version, oldest first. */
export function listVersions(project: Project): VersionInfo[] {
  const dir = join(project.dir, "versions");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((d) => /^\d+$/.test(d) && existsSync(join(dir, d, "deck.html")))
    .map((d) => {
      const file = join(dir, d, "deck.html");
      const metaFile = join(dir, d, "meta.json");
      const meta: VersionMeta = existsSync(metaFile)
        ? readJson(metaFile, (v) => v as VersionMeta)
        : { version: Number(d), kind: "build", createdAt: statSync(file).mtime.toISOString() };
      return { ...meta, file };
    })
    .sort((a, b) => a.version - b.version);
}
