import root from "../../eslint.config.js";

export default [{ ignores: [".next/**", ".next-e2e/**", "next-env.d.ts", "playwright-report/**", "test-results/**"] }, ...root];
