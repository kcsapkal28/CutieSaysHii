// Prints a compact review of projects' style and outline (titles, explainers and concepts per slide):
//   tsx test/live/inspect.ts <slugOrDir>… [--full]
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadOutline, loadProject, loadStyle, outlineSlides } from "../../src/pipeline/index.ts";

const full = process.argv.includes("--full");
for (const arg of process.argv.slice(2).filter((a) => !a.startsWith("--"))) {
  const p = loadProject(arg);
  console.log(`\n######## ${p.slug}`);
  if (existsSync(join(p.dir, "style.json"))) {
    const s = loadStyle(p);
    const c = s.theme.colors;
    console.log(`STYLE ${s.look}\n  bg ${c.bg} text ${c.text} accents ${c.accent} ${c.accent2} ${c.accent3} | fonts ${Object.values(s.theme.fonts).join("/")} | motion ${s.motion} 3d ${s.use3d} int ${s.interactivity} ${s.density}`);
  }
  if (!existsSync(join(p.dir, "outline.json"))) continue;
  const outline = loadOutline(p);
  console.log(`THROUGHLINE ${outline.visualThroughline.slice(0, full ? 2000 : 300)}`);
  for (const s of outlineSlides(outline)) {
    const v = s.visual;
    console.log(`\n  ${s.id} [${v.explainer} / ${v.technique}] interaction=${v.interaction.kind} steps=${v.steps.length}\n  TITLE ${s.title}`);
    console.log(`  CONCEPT ${v.concept.slice(0, full ? 4000 : 420)}`);
    if (full) console.log(`  INTERACTION ${v.interaction.description}\n  ENTRY ${v.entry ?? "-"}\n  EXIT ${v.exit ?? "-"}`);
  }
}
