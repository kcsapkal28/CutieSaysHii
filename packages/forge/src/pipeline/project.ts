// A project is a directory: projects/<slug>/ holding one file (or folder) per stage.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { repoRoot } from "../llm.ts";
import { Brief, type StylePrefs } from "../agents/schemas.ts";

export const STAGES = ["style", "research", "outline", "script", "storyboard", "build"] as const;
export type Stage = (typeof STAGES)[number];

/** What each stage writes. Re-running a stage deletes these for every later stage; versions/ is never deleted. */
export const STAGE_OUTPUTS: Record<Stage, string[]> = {
  style: ["style.json"],
  research: ["research.md", "research.json"],
  outline: ["outline.json"],
  script: ["script.json"],
  storyboard: ["storyboard.json"],
  build: ["build.json", "slides", "shots"],
};

export type Project = { dir: string; slug: string };

export function slugify(topic: string): string {
  return (
    topic
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .replace(/-+$/, "") || "deck"
  );
}

export type NewProject = { topic: string; audience: string; minutes: number; prefs?: StylePrefs; root?: string };

/** Creates projects/<slug>/ (slug-2, slug-3… when taken) with brief.json. `root` defaults to the repo root. */
export function createProject(input: NewProject): Project {
  const projectsDir = join(input.root ?? repoRoot(), "projects");
  const base = slugify(input.topic);
  let slug = base;
  for (let n = 2; existsSync(join(projectsDir, slug)); n++) slug = `${base}-${n}`;
  const dir = join(projectsDir, slug);
  mkdirSync(dir, { recursive: true });
  const brief = Brief.parse({ topic: input.topic, audience: input.audience, minutes: input.minutes, prefs: input.prefs ?? {}, createdAt: new Date().toISOString() });
  writeJson(join(dir, "brief.json"), brief);
  return { dir, slug };
}

export function openProject(dir: string): Project {
  const abs = resolve(dir);
  if (!existsSync(join(abs, "brief.json"))) throw new Error(`not a DeckForge project (no brief.json): ${abs}`);
  return { dir: abs, slug: abs.split(/[\\/]/).pop()! };
}

export function isStageDone(p: Project, stage: Stage): boolean {
  return existsSync(join(p.dir, STAGE_OUTPUTS[stage][0]!));
}

export function projectStatus(p: Project): Record<Stage, boolean> {
  return Object.fromEntries(STAGES.map((s) => [s, isStageDone(p, s)])) as Record<Stage, boolean>;
}

/** Deletes the outputs of every stage after `stage`. */
export function invalidateAfter(p: Project, stage: Stage): Stage[] {
  const later = STAGES.slice(STAGES.indexOf(stage) + 1);
  const cleared: Stage[] = [];
  for (const s of later) {
    let any = false;
    for (const out of STAGE_OUTPUTS[s]) {
      const path = join(p.dir, out);
      if (existsSync(path)) {
        rmSync(path, { recursive: true, force: true });
        any = true;
      }
    }
    if (any) cleared.push(s);
  }
  return cleared;
}

/** The next free versions/<n> number (1-based). */
export function nextVersion(p: Project): number {
  const dir = join(p.dir, "versions");
  if (!existsSync(dir)) return 1;
  const used = readdirSync(dir).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  return used.length ? Math.max(...used) + 1 : 1;
}

export function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function readJson<T>(path: string, parse: (v: unknown) => T): T {
  return parse(JSON.parse(readFileSync(path, "utf8")));
}
