import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/adapters/sqlite/schema.ts",
  out: "./drizzle",
});
