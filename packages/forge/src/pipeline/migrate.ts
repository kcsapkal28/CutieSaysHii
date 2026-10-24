// Projects made before the Outline, Script and Storyboard stages became one Outline stage hold three files:
// outline.json (sections of key messages), script.json (the words per slide) and storyboard.json (the visual per slide).
// migrateProject turns them into the unified outline.json. The old files are moved to legacy/, never deleted.
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LegacyOutline, Outline, Script, Storyboard, Visual, type OutlineSlide } from "../agents/schemas.ts";

/** none: nothing to do · merged: outline.json was rebuilt from the old files · rerun: only the old outline was usable, so the Outline stage must run again. */
export type Migration = "none" | "merged" | "rerun";

const LEGACY_FILES = ["outline.json", "script.json", "storyboard.json"];

function readJsonFile(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

/** The unified outline from the old three files, or null when they don't cover every slide. Slide order is the script's. */
export function mergeLegacy(outline: LegacyOutline, script: Script, board: Storyboard): Outline | null {
  const planned = new Map(outline.sections.flatMap((s) => s.slides).map((x) => [x.id, x]));
  const visuals = new Map(board.slides.map((b) => [b.id, b]));
  const sections: Outline["sections"] = [];
  for (const s of script.slides) {
    const b = visuals.get(s.id);
    if (!b) return null;
    const plan = planned.get(s.id);
    const slide: OutlineSlide = {
      id: s.id,
      title: s.title,
      ...(s.kicker ? { kicker: s.kicker } : {}),
      ...(s.subtitle ? { subtitle: s.subtitle } : {}),
      point: plan?.keyMessage ?? s.subtitle ?? s.title,
      role: plan?.role ?? "context",
      callouts: s.callouts,
      notes: s.notes,
      budgetSec: s.budgetSec,
      visual: Visual.parse(b),
    };
    const last = sections.at(-1);
    if (last && last.name === s.section) last.slides.push(slide);
    else sections.push({ name: s.section, slides: [slide] });
  }
  if (!sections.length) return null;
  return {
    title: outline.title,
    subtitle: outline.subtitle,
    throughline: outline.throughline,
    totalSec: outline.totalSec,
    visualThroughline: board.visualThroughline,
    motifs: board.motifs,
    sections,
  };
}

/** Moves a file into <dir>/legacy/ under a name that is not taken yet. */
function backUp(dir: string, name: string): void {
  const from = join(dir, name);
  if (!existsSync(from)) return;
  const legacy = join(dir, "legacy");
  mkdirSync(legacy, { recursive: true });
  let to = join(legacy, name);
  for (let n = 2; existsSync(to); n++) to = join(legacy, name.replace(/\.json$/, `-${n}.json`));
  copyFileSync(from, to);
  rmSync(from);
}

/** Upgrades an old project in place (idempotent). Safe to call on every load. */
export function migrateProject(p: { dir: string }): Migration {
  const outlineFile = join(p.dir, "outline.json");
  if (!existsSync(outlineFile)) return "none";
  const raw = readJsonFile(outlineFile);
  if (Outline.safeParse(raw).success) return "none";
  const legacy = LegacyOutline.safeParse(raw);
  if (!legacy.success) return "none";

  const script = Script.safeParse(readJsonFile(join(p.dir, "script.json")));
  const board = Storyboard.safeParse(readJsonFile(join(p.dir, "storyboard.json")));
  const merged = script.success && board.success ? mergeLegacy(legacy.data, script.data, board.data) : null;
  for (const f of LEGACY_FILES) backUp(p.dir, f);
  if (!merged) return "rerun";
  writeFileSync(outlineFile, `${JSON.stringify(merged, null, 2)}\n`);
  return "merged";
}
