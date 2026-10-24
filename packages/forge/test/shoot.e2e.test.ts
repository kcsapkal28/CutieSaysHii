// End to end: bundle the proof deck, every exemplar deck and the light fixture; shoot every slide and step in
// Chromium and expect zero errors, zero external requests and zero blocking pre-check findings. Decks are shot
// concurrently to keep this fast.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bundleDeck, CHROMIUM_ARGS, readProject, shootDeck } from "../src/index.ts";

const dir = (p: string) => new URL(p, import.meta.url).pathname;
const FIXTURES = [
  ["proof-anc", dir("../fixtures/proof/anc")],
  ["exemplar-tech", dir("../fixtures/exemplars/tech")],
  ["exemplar-history", dir("../fixtures/exemplars/history")],
  ["exemplar-data", dir("../fixtures/exemplars/data")],
  ["exemplar-science", dir("../fixtures/exemplars/science")],
  ["light-check", dir("./fixtures/light")],
] as const;

let browser: Browser;
const out = mkdtempSync(join(tmpdir(), "forge-e2e-"));
const deckFile = (name: string) => join(out, name, "deck.html");

beforeAll(async () => {
  browser = await chromium.launch({ args: CHROMIUM_ARGS });
  for (const [name, d] of FIXTURES) await bundleDeck({ ...readProject(d), outFile: deckFile(name) });
});
afterAll(async () => {
  await browser?.close();
});

describe.concurrent("shoot every slide and step", () => {
  it.each(FIXTURES)("%s: zero errors, zero external requests", { timeout: 150_000 }, async (name, d) => {
    const project = readProject(d);
    const r = await shootDeck({ deckFile: deckFile(name), browser });
    expect(r.externalRequests).toEqual([]);
    expect(Object.values(r.errors).flat()).toEqual([]);
    // Calibration of the deterministic pre-check (measure.ts): known-good slides must not trip a single blocking check.
    const blocking = Object.values(r.findings ?? {}).flat().filter((f) => f.severity === "error");
    expect(blocking.map((f) => `${f.kind} ${f.selector}: ${f.detail}`)).toEqual([]);
    expect(Object.keys(r.findings ?? {}).sort()).toEqual(project.config.slides.map((s) => s.id).sort());
    for (const s of project.config.slides) {
      const steps = r.steps[s.id] ?? 0;
      expect(steps, s.id).toBeGreaterThan(0);
      expect(r.shots.filter((x) => x.slideId === s.id)).toHaveLength(steps);
    }
    for (const shot of r.shots) expect(shot.png.subarray(1, 4).toString()).toBe("PNG");
  });
});

describe("presenter mode", () => {
  it.each(FIXTURES.filter(([n]) => n === "light-check" || n === "exemplar-tech"))(
    "%s: keyboard navigation and enabled chrome",
    { timeout: 30_000 },
    async (name, d) => {
      const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
      await page.goto(pathToFileURL(deckFile(name)).href);
      await page.evaluate(() => window.__dfReady);
      const { features } = readProject(d).config.style;
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
    },
  );
});

describe("interactivity", () => {
  async function open(name: string, slide: string) {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.goto(`${pathToFileURL(deckFile(name)).href}?df-shot=${slide}&step=0`);
    await page.evaluate(() => window.__dfReady);
    return page;
  }

  it("anc s04: slider and frequency toggle drive the live residual stat", { timeout: 30_000 }, async () => {
    const page = await open("proof-anc", "s04");
    const db = page.locator("#s04 .db");
    const before = await db.textContent();
    await page.locator("#s04 .delay").fill("300");
    const afterDelay = await db.textContent();
    expect(afterDelay).not.toBe(before);
    await page.locator('#s04 [data-f="100"]').click();
    expect(await db.textContent()).not.toBe(afterDelay);
    await expect(page.locator("#s04 .delay-out").textContent()).resolves.toBe("300 µs");
    await page.close();
  });

  it("science s01: R0 and vaccination sliders change the SIR outcome", { timeout: 30_000 }, async () => {
    const page = await open("exemplar-science", "s01");
    const peak = page.locator("#s01 .peak");
    const p0 = await peak.textContent();
    await page.locator("#s01 .r0").fill("4.5");
    const p1 = await peak.textContent();
    expect(p1).not.toBe(p0);
    await page.locator("#s01 .vax").fill("85");
    await expect(page.locator("#s01 .verdict").textContent()).resolves.toMatch(/fizzles/);
    await page.close();
  });

  it("tech s02: step tabs move the deck step (api.setStep)", { timeout: 30_000 }, async () => {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.goto(`${pathToFileURL(deckFile("exemplar-tech")).href}#s02`);
    await page.evaluate(() => window.__dfReady);
    await page.locator("#s02 .tab").nth(3).click();
    await expect.poll(() => page.evaluate(() => location.hash)).toBe("#s02.3");
    await expect(page.locator("#s02 .caption").textContent()).resolves.toMatch(/bubble/);
    await page.close();
  });
});
