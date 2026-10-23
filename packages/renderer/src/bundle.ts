import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";
import { PACKAGE_ROOT, packageVersion, readCache, sha256, writeCache } from "./cache.ts";

/** The browser runtime (Reveal, notes plugin, GSAP motion) as one classic-script IIFE. */
export async function bundleRuntime(): Promise<string> {
  const dir = join(PACKAGE_ROOT, "src/runtime");
  const sources = readdirSync(dir)
    .sort()
    .map((f) => [f, readFileSync(join(dir, f), "utf8")] as const);
  const key = sha256([
    ...sources.flat(),
    packageVersion("esbuild"),
    packageVersion("reveal.js"),
    packageVersion("gsap"),
  ]);
  const name = `runtime-${key}.js`;
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
  if (text === undefined) throw new Error("esbuild produced no output for the runtime bundle");
  writeCache(name, text);
  return text;
}
