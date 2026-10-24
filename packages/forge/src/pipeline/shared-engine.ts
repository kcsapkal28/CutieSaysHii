// The real Engine with one Chromium shared by every shoot in a build (launched on first use).
import { chromium, type Browser } from "playwright";
import { bundleDeck } from "../bundle.ts";
import type { Engine } from "../contract.ts";
import { CHROMIUM_ARGS, shootDeck } from "../shoot.ts";

export type ClosableEngine = Engine & { close(): Promise<void> };

export function createSharedEngine(): ClosableEngine {
  let browser: Promise<Browser> | undefined;
  return {
    bundle: (input) => bundleDeck(input),
    async shoot(input) {
      browser ??= chromium.launch({ args: CHROMIUM_ARGS });
      return shootDeck({ ...input, browser: await browser });
    },
    async close() {
      if (browser) await (await browser).close();
      browser = undefined;
    },
  };
}
