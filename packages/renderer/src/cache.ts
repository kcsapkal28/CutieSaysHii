import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const CACHE_DIR = join(PACKAGE_ROOT, ".cache");
const require = createRequire(import.meta.url);

/** Version of an installed dependency, found by walking up from its resolved entry point. */
export function packageVersion(name: string): string {
  let dir = dirname(require.resolve(name));
  for (;;) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { name?: string; version?: string };
      if (pkg.name === name) return pkg.version ?? "0";
    } catch {
      // no package.json at this level
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`cannot locate package.json for ${name}`);
    dir = parent;
  }
}

export const sha256 = (parts: (string | Buffer)[]): string => {
  const h = createHash("sha256");
  for (const p of parts) h.update(p).update("\0");
  return h.digest("hex");
};

export function readCache(name: string): string | undefined {
  try {
    return readFileSync(join(CACHE_DIR, name), "utf8");
  } catch {
    return undefined;
  }
}

/** Atomic write, so parallel builds never observe a half-written cache file. */
export function writeCache(name: string, text: string): void {
  mkdirSync(CACHE_DIR, { recursive: true });
  const tmp = join(CACHE_DIR, `${name}.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tmp, text);
  renameSync(tmp, join(CACHE_DIR, name));
}
