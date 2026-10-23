// Builds one family deck and screenshots chosen slides at 1920×1080, for visual iteration.
// Usage: tsx scripts/preview.ts --family <id> [--deck solar|stress|alt] [--slides type,type]
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { loadCatalog } from "@deckforge/catalog/node";
import { chromium } from "playwright";
import { buildFamilyDeck, DECK_KINDS, FAMILIES, readDeckSpec, type DeckKind } from "../test/e2e/global-setup.ts";
import { waitForIdle } from "../test/e2e/metrics.ts";

const OUT = fileURLToPath(new URL("../test-results/preview/", import.meta.url));

function fail(message: string): never {
  console.error(`preview: ${message}\nusage: tsx scripts/preview.ts --family <id> [--deck ${DECK_KINDS.join("|")}] [--slides type,type]`);
  process.exit(1);
}

const { values } = parseArgs({
  options: { family: { type: "string" }, deck: { type: "string", default: "solar" }, slides: { type: "string" } },
});
const family = values.family ?? fail("--family is required");
if (!FAMILIES.includes(family)) fail(`unknown family "${family}"; one of ${FAMILIES.join(", ")}`);
const deck = values.deck as DeckKind;
if (!DECK_KINDS.includes(deck)) fail(`unknown deck "${values.deck}"`);

const spec = readDeckSpec(deck);
const available = [...new Set(spec.slides.map((s) => s.type))];
const wanted = values.slides ? values.slides.split(",").map((t) => t.trim()).filter(Boolean) : available;
const missing = wanted.filter((t) => !available.includes(t));
if (missing.length > 0) fail(`the ${deck} deck has no ${missing.join(", ")} slide; it has ${available.join(", ")}`);

const dir = join(OUT, `${family}-${deck}`);
await buildFamilyDeck(await loadCatalog(), family, deck, dir);
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await page.goto(`${pathToFileURL(join(dir, "index.html")).href}?df-motion=off#/0`);
  await waitForIdle(page);
  for (const type of wanted) {
    const indexes = spec.slides.flatMap((s, i) => (s.type === type ? [i] : []));
    for (const [n, h] of indexes.entries()) {
      await page.evaluate(async (i) => {
        window.Reveal.slide(i);
        while (window.Reveal.nextFragment());
        await document.fonts.ready;
      }, h);
      const path = join(OUT, `${family}-${deck}-${type}${n === 0 ? "" : `-${n + 1}`}.png`);
      await page.screenshot({ path });
      console.log(path);
    }
  }
} finally {
  await browser.close();
}
