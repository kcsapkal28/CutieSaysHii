import { defineConfig } from "vitest/config";

// Unit tests for the Studio's pure helpers (lib/**/*.test.ts). e2e/ holds Playwright specs, run by `pnpm test:e2e`.
export default defineConfig({
  test: { include: ["lib/**/*.test.ts"] },
});
