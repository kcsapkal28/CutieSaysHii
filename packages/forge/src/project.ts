// Project-folder helpers: deck.json + slides/<id>.html in, versions/<n>/deck.html and shot PNGs out.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DeckConfig, type ShootResult } from "./contract.ts";

/** Reads `<dir>/deck.json` and every `<dir>/slides/<id>.html` it lists (plus any extra slide files, so checks can flag them). */
export function readProject(dir: string): { config: DeckConfig; slides: Record<string, string> } {
  const config = DeckConfig.parse(JSON.parse(readFileSync(join(dir, "deck.json"), "utf8")));
  const slidesDir = join(dir, "slides");
  const slides: Record<string, string> = {};
  if (existsSync(slidesDir)) {
    for (const f of readdirSync(slidesDir).sort()) {
      const m = /^(s\d{2})\.html$/.exec(f);
      if (m) slides[m[1]!] = readFileSync(join(slidesDir, f), "utf8");
    }
  }
  return { config, slides };
}

/** `<dir>/versions/<n>` where n is one more than the highest existing version (1 when none). */
export function nextVersionDir(dir: string): string {
  const versions = join(dir, "versions");
  const nums = existsSync(versions)
    ? readdirSync(versions)
        .filter((d) => /^\d+$/.test(d))
        .map(Number)
    : [];
  return join(versions, String(Math.max(0, ...nums) + 1));
}

/** Writes `<id>-<step>.png` for every shot plus `report.json` (steps, errors, external requests). */
export function writeShots(result: ShootResult, outDir: string): string[] {
  mkdirSync(outDir, { recursive: true });
  const files = result.shots.map((s) => {
    const file = join(outDir, `${s.slideId}-${s.step}.png`);
    writeFileSync(file, s.png);
    return file;
  });
  const report = { steps: result.steps, errors: result.errors, externalRequests: result.externalRequests };
  writeFileSync(join(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  return files;
}
