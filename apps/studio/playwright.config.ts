import { defineConfig } from "@playwright/test";

const PORT = 3217;

export default defineConfig({
  testDir: "e2e",
  timeout: 240_000,
  // Dev mode compiles each route on first visit.
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1440, height: 900 },
    launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
    trace: "retain-on-failure",
  },
  webServer: {
    // Mock delays at 5% so the full walk takes seconds, not minutes.
    command: `STUDIO_DIST_DIR=.next-e2e STUDIO_MOCK_SPEED=0.05 NODE_OPTIONS=--experimental-transform-types pnpm exec next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/api/projects`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
