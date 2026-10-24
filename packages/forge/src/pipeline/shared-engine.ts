// The real Engine with one Chromium shared by every shoot in a build (launched on first use), plus a screenshot
// downscaler (also in that Chromium) so critic requests stay small.
import { chromium, type Browser } from "playwright";
import { bundleDeck } from "../bundle.ts";
import type { Engine } from "../contract.ts";
import type { ImageData } from "../llm.ts";
import { CHROMIUM_ARGS, shootDeck } from "../shoot.ts";

export type ClosableEngine = Engine & {
  /** PNG → JPEG at `width` px wide (default 1280, quality .85). */
  shrink(png: Buffer, width?: number): Promise<ImageData>;
  close(): Promise<void>;
};

export function createSharedEngine(): ClosableEngine {
  let browser: Promise<Browser> | undefined;
  const get = () => (browser ??= chromium.launch({ args: CHROMIUM_ARGS }));
  return {
    bundle: (input) => bundleDeck(input),
    async shoot(input) {
      return shootDeck({ ...input, browser: await get() });
    },
    async shrink(png, width = 1280) {
      const page = await (await get()).newPage();
      try {
        // Runs in the page (a string, since this package doesn't compile against the DOM lib).
        const b64 = (await page.evaluate(`(async () => {
          const img = new Image();
          img.src = "data:image/png;base64,${png.toString("base64")}";
          await img.decode();
          const canvas = document.createElement("canvas");
          canvas.width = Math.min(${Math.round(width)}, img.width);
          canvas.height = Math.round((img.height * canvas.width) / img.width);
          canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
          return canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
        })()`)) as string;
        return { data: Buffer.from(b64, "base64"), mediaType: "image/jpeg" };
      } finally {
        await page.close();
      }
    },
    async close() {
      if (browser) await (await browser).close();
      browser = undefined;
    },
  };
}
