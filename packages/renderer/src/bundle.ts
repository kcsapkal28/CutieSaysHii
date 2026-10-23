import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";
import { PACKAGE_ROOT, packageVersion, readCache, sha256, writeCache } from "./cache.ts";

// Bundles <dir>/main.ts into one minified classic-script IIFE, cached by the sources and dependency versions.
async function bundleIife(dirRel: string, cachePrefix: string, deps: string[]): Promise<string> {
  const dir = join(PACKAGE_ROOT, dirRel);
  const sources = readdirSync(dir)
    .sort()
    .map((f) => [f, readFileSync(join(dir, f), "utf8")] as const);
  const key = sha256([...sources.flat(), packageVersion("esbuild"), ...deps.map(packageVersion)]);
  const name = `${cachePrefix}-${key}.js`;
  const cached = readCache(name);
  if (cached !== undefined) return cached;

  const result = await build({
    entryPoints: [join(dir, "main.ts")],
    bundle: true,
    format: "iife",
    minify: true,
    target: "es2020",
    write: false,
    legalComments: "none",
    logLevel: "silent",
  });
  const text = result.outputFiles[0]?.text;
  if (text === undefined) throw new Error(`esbuild produced no output for ${dirRel}`);
  writeCache(name, text);
  return text;
}

/** The browser runtime (Reveal, notes plugin, GSAP motion) as one classic-script IIFE. */
export function bundleRuntime(): Promise<string> {
  return bundleIife("src/runtime", "runtime", ["reveal.js", "gsap"]);
}

/**
 * The code that runs inside the diagram build page (mermaid glue and the SVG sanitiser) as one IIFE that
 * defines `globalThis.deckforgeDiagrams`. Never inject build-time functions via Function.prototype.toString:
 * the host's transpiler (e.g. tsx's keepNames `__name(...)`) leaks into the page and breaks it.
 */
export function bundleDiagramPage(): Promise<string> {
  return bundleIife("src/diagram-page", "diagram-page", []);
}
