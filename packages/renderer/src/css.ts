import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { listSources } from "./bundle.ts";
import { PACKAGE_ROOT, packageVersion, readCache, sha256, writeCache } from "./cache.ts";

const run = promisify(execFile);
const CSS_INPUTS = ["templates", "src/styles"] as const;

/** Every file the deck stylesheet is compiled from (templates and partials, stylesheets), relative to the package. */
export function cssSources(): string[] {
  return CSS_INPUTS.flatMap((dir) => listSources(join(PACKAGE_ROOT, dir)).map((f) => `${dir}/${f}`));
}

/** Tailwind-compiled deck stylesheet (utilities used by templates, base styles, reveal.css). */
export async function compileDeckCss(): Promise<string> {
  const key = sha256([
    ...cssSources().flatMap((f) => [f, readFileSync(join(PACKAGE_ROOT, f), "utf8")]),
    packageVersion("tailwindcss"),
    packageVersion("reveal.js"),
  ]);
  const name = `deck-${key}.css`;
  const cached = readCache(name);
  if (cached !== undefined) return cached;

  const bin = join(PACKAGE_ROOT, "node_modules/.bin/tailwindcss");
  const { stdout } = await run(bin, ["-i", "src/styles/deck.css", "--minify"], {
    cwd: PACKAGE_ROOT,
    maxBuffer: 32 * 1024 * 1024,
  });
  writeCache(name, stdout);
  return stdout;
}
