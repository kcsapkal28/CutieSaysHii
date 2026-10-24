// End to end: bundle fixture decks, shoot every slide and step in Chromium, expect zero errors and zero requests.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bundleDeck, CHROMIUM_ARGS, readProject, shootDeck } from "../src/index.ts";

const FIXTURES = [
  ["light check", new URL("./fixtures/light", import.meta.url).pathname],
] as const;

let browser: Browser;
const out = mkdtempSync(join(tmpdir(), "forge-e2e-"));

beforeAll(async () => {
  browser = await chromium.launch({ args: CHROMIUM_ARGS });
});
afterAll(async () => {
  await browser?.close();
});

describe.each(FIXTURES)("%s deck", (name, dir) => {
  const deckFile = join(out, name.replace(/\W+/g, "-"), "deck.html");

  it("shoots every slide and step with zero errors and zero external requests", { timeout: 90_000 }, async () => {
    const project = readProject(dir);
    await bundleDeck({ ...project, outFile: deckFile });
    const r = await shootDeck({ deckFile, browser });
    expect(r.externalRequests).toEqual([]);
    expect(Object.values(r.errors).flat()).toEqual([]);
    for (const s of project.config.slides) {
      const steps = r.steps[s.id] ?? 0;
      expect(steps, s.id).toBeGreaterThan(0);
      expect(r.shots.filter((x) => x.slideId === s.id)).toHaveLength(steps);
    }
    for (const shot of r.shots) expect(shot.png.subarray(1, 4).toString()).toBe("PNG");
  });

  it("navigates with the keyboard and shows the enabled chrome", { timeout: 30_000 }, async () => {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.goto(pathToFileURL(deckFile).href);
    await page.evaluate(() => window.__dfReady);
    const { features } = readProject(dir).config.style;
    if (features.stepNav) await expect(page.locator(".df-seg").count()).resolves.toBeGreaterThan(0);
    if (features.timer) await expect(page.locator("#df-timer").count()).resolves.toBe(1);
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => page.evaluate(() => location.hash)).toMatch(/^#s0[12](\.1)?$/);
    if (features.notes) {
      await page.keyboard.press("n");
      await expect(page.locator("#df-notes-panel .df-notes-body").count()).resolves.toBe(1);
    }
    expect(errors).toEqual([]);
    await page.close();
  });
});
