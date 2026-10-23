import { expect, test, type Page } from "@playwright/test";
import { DECKS, layoutOf, readDeckSpec } from "./global-setup.ts";
import { openDeck, showSlide } from "./metrics.ts";
import { PENDING } from "./pending.ts";
import * as probe from "./probes.ts";

// Geometric design rules, measured in the browser at the deck's native 1920×1080.
test.use({ viewport: { width: 1920, height: 1080 } });

const FILL_TYPES = ["agenda", "bullets", "summary", "stat", "chart", "diagram", "compare", "timeline", "code"];
const NO_KICKER = ["title", "section", "qa"];

type Run = (page: Page) => Promise<string[]>;

/** Runs `fn` in the page on each slide in turn (final state, fonts loaded) and gathers its failures. */
async function onSlides<A>(page: Page, indexes: number[], fn: (arg: A) => string[], arg: A): Promise<string[]> {
  const failures: string[] = [];
  for (const h of indexes) {
    await showSlide(page, h);
    failures.push(...(await page.evaluate(fn as (a: unknown) => string[], arg as unknown)));
  }
  return failures;
}

// Task 11 removes this fixme; the gate then fails while any check is still pending.
test.fixme("no design check is pending", () => {
  expect([...PENDING.keys()]).toEqual([]);
});

for (const { family, deck } of DECKS) {
  const spec = readDeckSpec(deck);
  const layout = layoutOf(family);
  const slidesOf = (types: string[], include = true) =>
    spec.slides.flatMap((s, i) => (types.includes(s.type) === include ? [i] : []));
  const all = spec.slides.map((_, i) => i);
  const absent = (indexes: number[], what: string) => (indexes.length === 0 ? `deck has no ${what}` : undefined);

  test.describe(`${family} ${deck}`, () => {
    // A pending check still runs, so the report shows whether it fails or already passes, then it is marked fixme.
    const check = (id: string, title: string, run: Run, skip?: string) =>
      test(`${id}: ${title}`, async ({ page }) => {
        test.skip(skip !== undefined, skip);
        await openDeck(page, family, deck);
        const owner = PENDING.get(id);
        if (owner === undefined) {
          expect(await run(page)).toEqual([]);
          return;
        }
        let failures: string[];
        try {
          failures = await run(page);
        } catch (e) {
          failures = [`threw ${String(e).split("\n")[0]}`];
        }
        const state = failures.length > 0 ? `failing: ${failures[0]}` : "now passes on this deck";
        test.info().annotations.push({ type: "pending", description: `pending (Task ${owner}) — ${state}` });
        test.fixme(true, `pending, owned by Task ${owner}`);
      });

    check("fills-frame", "content fills the frame instead of sitting at the top", (page) =>
      onSlides(page, slidesOf(FILL_TYPES), probe.fillsFrame, null),
    );

    const bullets = slidesOf(["bullets"]);
    check("title-ratio", "the bullets title is at least 1.5× the item size", (page) =>
      onSlides(page, bullets, probe.titleRatio, null), absent(bullets, "bullets slide"),
    );

    check("vertical-overflow", "no region overflows vertically", (page) => onSlides(page, all, probe.verticalOverflow, null));

    const stats = slidesOf(["stat"]);
    const statCounts = Object.fromEntries(
      stats.map((h) => [spec.slides[h]!.id, spec.slides[h]!.body.filter((b) => b.type === "Stat").length]),
    );
    check("stat-one-line", "stat values stay on one line, unclipped", (page) =>
      onSlides(page, stats, probe.statOneLine, statCounts), absent(stats, "stat slide"),
    );

    const compares = slidesOf(["compare"]);
    check("compare-rows-align", "compare rows align across sides", (page) =>
      onSlides(page, compares, probe.compareRowsAlign, null), absent(compares, "compare slide"),
    );

    check("min-text-size", "text is at least 24 px (22 px for captions and graphic labels)", (page) =>
      onSlides(page, all, probe.minTextSize, null),
    );

    check("graphics-3to1", "chart marks and timeline nodes reach 3:1 on the background", (page) =>
      onSlides(page, slidesOf(["chart", "timeline"]), probe.graphics3to1, null),
    );

    check("decorations-behind", "decorations sit behind content and ignore the pointer", (page) =>
      page.evaluate(probe.decorationsBehind, layout.decoration !== "none"),
    );

    const emphasised = spec.slides.flatMap((s, i) => (s.emphasisTargets.length > 0 ? [i] : []));
    check("emphasis-legible", "emphasised text keeps 4.5:1 on its background", (page) =>
      onSlides(page, emphasised, probe.emphasisLegible, null), absent(emphasised, "emphasis targets"),
    );

    check("chrome-legible", "slide number, progress and controls are legible", (page) =>
      onSlides(page, [1], probe.chromeLegible, null),
    );

    check("slide-number-once", "the slide number shows once: as the index kicker or as Reveal's number", (page) =>
      onSlides(page, slidesOf(NO_KICKER, false), probe.slideNumberOnce, layout.kicker === "index"),
    );

    check("stat-aria", "stat labels are announced once and each trend has an accessible name", async (page) => {
      const failures: string[] = [];
      for (const h of stats) {
        await showSlide(page, h);
        const tree = await page.locator("section.present").ariaSnapshot();
        const slide = spec.slides[h]!;
        for (const b of slide.body) {
          if (b.type !== "Stat") continue;
          const n = tree.split(b.label).length - 1;
          if (n !== 1) failures.push(`${slide.id} "${b.label}": announced ${n} times`);
        }
        if (!tree.includes('img "Trend: up"')) failures.push(`${slide.id}: no img "Trend: up"`);
      }
      return failures;
    }, absent(stats, "stat slide"));

    const diagrams = slidesOf(["diagram"]);
    check("diagram-fills", "diagrams fill their region", (page) =>
      onSlides(page, diagrams, probe.diagramFills, null), absent(diagrams, "diagram slide"),
    );

    const images = slidesOf(["image"]);
    check("image-caption-legible", "image caption and kicker are AA, on an opaque plate where they overlap the picture", (page) =>
      onSlides(page, images, probe.imageCaptionLegible, null), absent(images, "image slide"),
    );
  });
}
