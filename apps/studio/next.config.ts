import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// The monorepo root. The engine resolves its shell and @fontsource files from `import.meta.url`, which Turbopack
// rewrites relative to this root, so it must be the workspace root rather than apps/studio.
const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

const config: NextConfig = {
  turbopack: { root },
  outputFileTracingRoot: root,
  // The engine (@deckforge/forge) is never bundled: lib/server/engine.ts imports it with turbopackIgnore so Node
  // runs its TypeScript source directly (see the NODE_OPTIONS in package.json). Client code imports only its types.
  serverExternalPackages: ["esbuild", "playwright", "playwright-core"],
  // No image optimisation: keeps sharp out of the runtime.
  images: { unoptimized: true },
  devIndicators: false,
  poweredByHeader: false,
};

export default config;
