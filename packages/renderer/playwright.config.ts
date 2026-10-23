import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "test/e2e",
  globalSetup: "./test/e2e/global-setup.ts",
  // The decks live in test-results/decks; Playwright empties its outputDir, so keep that a sibling.
  outputDir: "test-results/output",
  snapshotPathTemplate: "test/e2e/__screenshots__/{arg}{ext}",
  reporter: [["list"]],
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01 } },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 },
    },
  ],
});
