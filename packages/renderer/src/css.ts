import { execFile } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { PACKAGE_ROOT, packageVersion, readCache, sha256, writeCache } from "./cache.ts";

const run = promisify(execFile);
const read = (path: string) => readFileSync(path, "utf8");

function sourceFiles(dir: string, ext: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(ext))
    .sort()
    .map((f) => join(dir, f));
}

/** Tailwind-compiled deck stylesheet (utilities used by templates, base styles, reveal.css). */
export async function compileDeckCss(): Promise<string> {
  const templates = sourceFiles(join(PACKAGE_ROOT, "templates"), ".hbs");
  const styles = sourceFiles(join(PACKAGE_ROOT, "src/styles"), ".css");
  const key = sha256([
    ...[...templates, ...styles].flatMap((f) => [f, read(f)]),
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
