import { expect, test } from "@playwright/test";
import { FAMILIES, layoutOf, readDeckSpec } from "./global-setup.ts";
import { openDeck, showSlide } from "./metrics.ts";
import * as probe from "./probes.ts";

// Bleed and split pictures must not depend on how sibling stylesheets position or stack the slide's regions.
// These rules stand in for them: regions positioned and lifted, and every non-decoration child of a decorated
// slide on one z-index tie (Task 6b's content-above-decoration rule).
const HOSTILE_REGION_RULES = `
  .reveal .slides section .df-slide [data-region] { position: relative; z-index: 1; }
  [data-df-decoration] section[data-df-decorate] .df-slide > :not(.df-deco) { z-index: 1; }
`;

test.use({ viewport: { width: 1920, height: 1080 } });

const spec = readDeckSpec("solar");
const image = spec.slides.findIndex((s) => s.type === "image");

for (const family of FAMILIES.filter((f) => layoutOf(f).imageLayout !== "inset")) {
  test(`${family} ${layoutOf(family).imageLayout} image survives positioned, z-tied regions`, async ({ page }) => {
    await openDeck(page, family, "solar");
    await page.addStyleTag({ content: HOSTILE_REGION_RULES });
    await showSlide(page, image);
    expect(await page.evaluate(probe.imageCaptionLegible)).toEqual([]);
  });
}
