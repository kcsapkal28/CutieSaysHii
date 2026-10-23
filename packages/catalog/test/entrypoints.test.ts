import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import pkg from "../package.json" with { type: "json" };

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const IMPORT = /^\s*(?:import|export)\b[^'"]*?from\s+["']([^"']+)["']/gm;

/** Every import specifier reachable from `entry` through relative imports. */
function reachableImports(entry: string): Set<string> {
  const specs = new Set<string>();
  const visited = new Set<string>();
  const visit = (file: string) => {
    if (visited.has(file)) return;
    visited.add(file);
    for (const m of readFileSync(file, "utf8").matchAll(IMPORT)) {
      const spec = m[1]!;
      specs.add(spec);
      if (spec.startsWith(".")) visit(resolve(dirname(file), spec));
    }
  };
  visit(resolve(SRC, entry));
  return specs;
}

describe("package entry points", () => {
  it('"." is browser-safe: no node: imports reachable from src/index.ts', () => {
    const nodeImports = [...reachableImports("index.ts")].filter((s) => s.startsWith("node:"));
    expect(nodeImports).toEqual([]);
  });

  it('"./node" exposes the fs loader', async () => {
    expect(pkg.exports).toMatchObject({ ".": "./src/index.ts", "./node": "./src/node.ts" });
    const node = await import("../src/node.ts");
    expect(typeof node.loadCatalog).toBe("function");
    expect(typeof node.readRawCatalog).toBe("function");
  });

  it('"." does not export the fs loader', async () => {
    const main: Record<string, unknown> = await import("../src/index.ts");
    expect(main.loadCatalog).toBeUndefined();
    expect(typeof main.parseCatalog).toBe("function");
  });
});
