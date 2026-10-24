// Prints a compact review of projects' style, script titles and storyboard concepts:
//   tsx test/live/inspect.ts <slugOrDir>… [--full]
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadProject, loadScript, loadStoryboard, loadStyle } from "../../src/pipeline/index.ts";

const full = process.argv.includes("--full");
for (const arg of process.argv.slice(2).filter((a) => !a.startsWith("--"))) {
  const p = loadProject(arg);
  console.log(`\n######## ${p.slug}`);
  if (existsSync(join(p.dir, "style.json"))) {
    const s = loadStyle(p);
    const c = s.theme.colors;
    console.log(`STYLE ${s.look}\n  bg ${c.bg} text ${c.text} accents ${c.accent} ${c.accent2} ${c.accent3} | fonts ${Object.values(s.theme.fonts).join("/")} | motion ${s.motion} 3d ${s.use3d} int ${s.interactivity} ${s.density}`);
  }
  if (!existsSync(join(p.dir, "storyboard.json"))) {
    if (existsSync(join(p.dir, "script.json"))) for (const s of loadScript(p).slides) console.log(`  ${s.id} ${s.title}`);
    continue;
  }
  const script = loadScript(p);
  const sb = loadStoryboard(p);
  console.log(`THROUGHLINE ${sb.visualThroughline.slice(0, full ? 2000 : 300)}`);
  for (const b of sb.slides) {
    const s = script.slides.find((x) => x.id === b.id)!;
    console.log(`\n  ${b.id} [${b.explainer} / ${b.technique}] interaction=${b.interaction.kind} steps=${b.steps.length}\n  TITLE ${s.title}`);
    console.log(`  CONCEPT ${b.concept.slice(0, full ? 4000 : 420)}`);
    if (full) console.log(`  INTERACTION ${b.interaction.description}`);
  }
}
