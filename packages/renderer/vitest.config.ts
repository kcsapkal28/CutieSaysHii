import { configDefaults, defineConfig } from "vitest/config";

// test/e2e holds Playwright specs, run by `pnpm test:e2e`.
export default defineConfig({
  test: { exclude: [...configDefaults.exclude, "test/e2e/**"] },
});
