import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);
const require = createRequire(import.meta.url);

// The workspace's own tsx, not a global one: resolved from this package like any other dependency.
function tsxCli(): string {
  const pkgPath = require.resolve("tsx/package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { bin: string };
  return join(dirname(pkgPath), pkg.bin);
}

describe("under tsx", () => {
  // tsx (esbuild keepNames) rewrites functions with __name(...) calls; in-page code must not depend on how
  // the build-time module was transpiled.
  it("renderDiagrams yields the svg and no warnings", async () => {
    const script = fileURLToPath(new URL("./tsx/render-one.ts", import.meta.url));
    const { stdout } = await run(process.execPath, [tsxCli(), script], { maxBuffer: 16 * 1024 * 1024 });
    const out = JSON.parse(stdout) as { svgs: string[]; warnings: string[] };
    expect(out.warnings).toEqual([]);
    expect(out.svgs).toHaveLength(1);
    expect(out.svgs[0]?.startsWith("<svg")).toBe(true);
  }, 90_000);
});
