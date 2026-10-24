// Copies a project's stage files, latest deck and screenshots (minus the bulky preview decks) to an output folder:
//   tsx test/live/export.ts <slugOrDir> <outDir>
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { listVersions, loadProject } from "../../src/pipeline/index.ts";

const [arg, out] = process.argv.slice(2);
const p = loadProject(arg!);
mkdirSync(out!, { recursive: true });
for (const f of ["brief.json", "style.json", "style.rationale.json", "research.md", "outline.json", "script.json", "storyboard.json", "build.json", "log.jsonl"]) {
  if (existsSync(join(p.dir, f))) cpSync(join(p.dir, f), join(out!, f));
}
if (existsSync(join(p.dir, "slides"))) cpSync(join(p.dir, "slides"), join(out!, "slides"), { recursive: true });
const latest = listVersions(p).at(-1);
if (latest) cpSync(latest.file, join(out!, "deck.html"));
if (existsSync(join(p.dir, "shots"))) {
  cpSync(join(p.dir, "shots"), join(out!, "shots"), { recursive: true, filter: (src) => !src.endsWith("preview.html") });
}
console.log(`exported ${p.slug} → ${out}${latest ? ` (deck v${latest.version})` : ""}`);
