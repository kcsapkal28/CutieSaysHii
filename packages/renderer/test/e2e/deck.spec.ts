import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import type { DeckSpec } from "@deckforge/schemas";
import { deckDir, FAMILIES, FIXTURE_DECK, type Family } from "./global-setup.ts";

const deck = JSON.parse(readFileSync(FIXTURE_DECK, "utf8")) as DeckSpec;
const VISUAL_TYPES = ["title", "bullets", "stat", "chart", "diagram", "code", "compare", "summary"] as const;
const IDENTITY = new Set(["none", "matrix(1, 0, 0, 1, 0, 0)"]);

const deckUrl = (family: Family, { motion = true, slide = 0 } = {}) =>
  `${pathToFileURL(join(deckDir(family), "index.html")).href}${motion ? "" : "?df-motion=off"}#/${slide}`;

async function waitForIdle(page: Page) {
  await page.waitForFunction(() => window.Reveal?.isReady() && document.documentElement.dataset.dfMotionIdle === "true");
}

for (const family of FAMILIES) {
  test.describe(`${family} × calm`, () => {
    test("opens from file:// with zero console errors and zero failed requests", async ({ page }) => {
      const consoleErrors: string[] = [];
      const pageErrors: string[] = [];
      const failedRequests: string[] = [];
      page.on("console", (m) => {
        if (m.type() === "error") consoleErrors.push(m.text());
      });
      page.on("pageerror", (e) => pageErrors.push(e.message));
      page.on("requestfailed", (r) => failedRequests.push(`${r.url()} ${r.failure()?.errorText ?? ""}`));

      await page.goto(deckUrl(family));
      await waitForIdle(page);
      // Visit every slide so per-slide resources and motion code run too.
      const total = await page.evaluate(() => window.Reveal.getTotalSlides());
      for (let i = 1; i < total; i++) await page.evaluate((h) => window.Reveal.slide(h), i);
      await waitForIdle(page);

      expect(consoleErrors).toEqual([]);
      expect(pageErrors).toEqual([]);
      expect(failedRequests).toEqual([]);
    });

    test("has 15 slides", async ({ page }) => {
      await page.goto(deckUrl(family));
      await page.waitForFunction(() => window.Reveal?.isReady());
      expect(await page.evaluate(() => window.Reveal.getTotalSlides())).toBe(15);
    });

    test("no region overflows horizontally", async ({ page }) => {
      await page.goto(deckUrl(family, { motion: false }));
      await waitForIdle(page);
      await page.evaluate(() => document.fonts.ready);
      const overflows: string[] = [];
      for (let i = 0; i < deck.slides.length; i++) {
        overflows.push(
          ...(await page.evaluate((h) => {
            window.Reveal.slide(h);
            const section = window.Reveal.getCurrentSlide();
            return [...section.querySelectorAll<HTMLElement>("[data-region]")]
              .filter((r) => r.scrollWidth > r.clientWidth + 1)
              .map((r) => `${section.id} ${r.dataset.region}: scrollWidth ${r.scrollWidth} > clientWidth ${r.clientWidth}`);
          }, i)),
        );
      }
      expect(overflows).toEqual([]);
    });

    test("motion runs", async ({ page }) => {
      await page.goto(deckUrl(family, { slide: 1 }));
      const first = page.locator("section.present [data-motion-el]").first();
      const opacity = () => first.evaluate((el) => Number(getComputedStyle(el).opacity));
      await expect.poll(opacity, { timeout: 100, intervals: [10] }).toBeLessThan(1);
      await waitForIdle(page);
      expect(await first.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
    });

    test("reduced motion uses fades only", async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(deckUrl(family, { slide: 1 }));
      // Sample every frame until the enter timeline finishes; only frames where it is running count.
      const frames = await page.evaluate(
        () =>
          new Promise<string[][]>((resolve) => {
            const out: string[][] = [];
            const tick = () => {
              const idle = document.documentElement.dataset.dfMotionIdle;
              const section = window.Reveal?.isReady() ? window.Reveal.getCurrentSlide() : null;
              const styles = [...(section?.querySelectorAll("[data-motion-el]") ?? [])].map((el) => getComputedStyle(el));
              if (idle === "false" && styles.some((s) => Number(s.opacity) < 1)) out.push(styles.map((s) => s.transform));
              if (idle === "true") resolve(out);
              else requestAnimationFrame(tick);
            };
            tick();
          }),
      );
      expect(frames.length).toBeGreaterThan(0);
      const moved = frames.flat().filter((t) => !IDENTITY.has(t));
      expect(moved).toEqual([]);
    });

    test("speaker notes are wired", async ({ page }) => {
      await page.goto(deckUrl(family, { slide: 1 }));
      await page.waitForFunction(() => window.Reveal?.isReady());
      const notes = await page.evaluate(() => window.Reveal.getSlideNotes());
      expect(notes?.trim()).toBeTruthy();
    });

    for (const type of VISUAL_TYPES) {
      test(`visual: ${type}`, async ({ page }) => {
        const index = deck.slides.findIndex((s) => s.type === type);
        expect(index).toBeGreaterThanOrEqual(0);
        await page.goto(deckUrl(family, { motion: false, slide: index }));
        await waitForIdle(page);
        // The final state of a slide includes all of its fragments.
        await page.evaluate(async () => {
          while (window.Reveal.nextFragment());
          await document.fonts.ready;
        });
        await expect(page).toHaveScreenshot(`${family}-${type}.png`);
      });
    }
  });
}
