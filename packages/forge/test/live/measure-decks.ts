// Runs the deterministic pre-check on already-bundled decks and prints its findings next to the critic's review.json
// (when there is one), to calibrate measure.ts against real builds. No LLM calls.
//   npx tsx test/live/measure-decks.ts <deck.html | dir with shots/*/r*/preview.html> … (NOMEASURE=1 to time without)
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { chromium } from "playwright";
import { CHROMIUM_ARGS, shootDeck } from "../../src/index.ts";

const browser = await chromium.launch({ args: CHROMIUM_ARGS });
const files = process.argv.slice(2).flatMap((a) => (a.endsWith(".html") ? [a] : readdirSync(a, { recursive: true, encoding: "utf8" }).filter((f) => /(^|\/)(preview|deck)\.html$/.test(f) && !f.includes("versions")).sort().map((f) => join(a, f))));
for (const file of files) {
  const t = Date.now();
  const r = await shootDeck({ deckFile: file, browser, measure: !process.env.NOMEASURE });
  console.log(`\n=== ${file} (${Date.now() - t} ms) errors=${Object.values(r.errors).flat().length} ext=${r.externalRequests.length}`);
  for (const [id, fs] of Object.entries(r.findings ?? {})) {
    for (const f of fs) console.log(`  ${id} [${f.severity}] ${f.kind} step ${f.step}: ${f.detail}`);
  }
  const review = join(dirname(file), "review.json");
  if (existsSync(review)) {
    const rv = JSON.parse(readFileSync(review, "utf8")) as { verdict: string; score: number; issues: { severity: string; what: string }[] };
    console.log(`  critic: ${rv.verdict} ${rv.score}`);
    for (const i of rv.issues) console.log(`    - [${i.severity}] ${i.what.slice(0, 160)}`);
  }
}
await browser.close();
