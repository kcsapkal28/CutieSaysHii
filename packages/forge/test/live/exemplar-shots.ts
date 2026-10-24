// Bundles one exemplar deck, checks every slide against the contract, shoots every step in Chromium with the
// pre-check on, prints the findings and writes the PNGs (for eyeballing new exemplars). No LLM calls.
//   npx tsx test/live/exemplar-shots.ts <deckDir> <outDir> [slideId …]
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { chromium } from "playwright";
import { bundleDeck, checkSlide, CHROMIUM_ARGS, readProject, shootDeck } from "../../src/index.ts";

const [dir, outRoot, ...ids] = process.argv.slice(2);
if (!dir || !outRoot) throw new Error("usage: exemplar-shots.ts <deckDir> <outDir> [slideId …]");
const out = join(outRoot, basename(dir));
mkdirSync(out, { recursive: true });
const project = readProject(dir);
// A deck being written may not have every slide yet: bundle the ones that exist.
project.config.slides = project.config.slides.filter((s) => project.slides[s.id] !== undefined);
for (const [id, src] of Object.entries(project.slides)) {
  const { issues } = checkSlide(id, src);
  if (issues.length) console.log(`CONTRACT ${id}:`, issues);
}
const deck = join(out, "deck.html");
await bundleDeck({ ...project, outFile: deck });
const browser = await chromium.launch({ args: CHROMIUM_ARGS });
const t = Date.now();
const r = await shootDeck({ deckFile: deck, browser, slideIds: ids.length ? ids : undefined });
console.log(`${basename(dir)}: ${Date.now() - t} ms, errors=${JSON.stringify(r.errors)}, external=${r.externalRequests.length}, steps=${JSON.stringify(r.steps)}`);
for (const [id, fs] of Object.entries(r.findings ?? {})) for (const f of fs) console.log(`  ${id} [${f.severity}] ${f.kind} step ${f.step}: ${f.detail}`);
for (const s of r.shots) writeFileSync(join(out, `${s.slideId}-${s.step}.png`), s.png);
await browser.close();
