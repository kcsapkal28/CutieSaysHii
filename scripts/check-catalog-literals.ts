// §8: no catalog value may appear as a literal outside catalog/. Run via `pnpm check:literals`.
// Motion-template and interaction-mode ids are not checked: "none", "calm", "linear", "pop"
// collide with ordinary code and CSS.
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeHex, type Catalog } from "@deckforge/catalog";
import { loadCatalog } from "@deckforge/catalog/node";

export type LiteralHit = { path: string; line: number; value: string };

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCAN_DIRS = ["apps", "packages"];
const EXTENSIONS = /\.(ts|tsx|js|mjs|css|hbs)$/;
const SKIP_DIRS = new Set(["node_modules", "dist", ".next", ".turbo", "test", "fixtures"]);
const SKIP_FILES = new Set(["packages/schemas/src/catalog-files.ts"]);

const STRING_LITERAL = /(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
const HEX = /#(?:[0-9a-f]{6}|[0-9a-f]{3})\b/gi;

export function isScannedPath(path: string): boolean {
  const parts = path.split("/");
  if (!SCAN_DIRS.includes(parts[0] ?? "")) return false;
  if (parts.some((p) => SKIP_DIRS.has(p))) return false;
  if (SKIP_FILES.has(path) || /\.test\./.test(path)) return false;
  return EXTENSIONS.test(path);
}

function forbidden(c: Catalog) {
  const ids = new Set<string>([
    ...c.styles.families.map((f) => f.id),
    ...c.palettes.palettes.map((p) => p.id),
    ...c.types.families.map((t) => t.id),
    ...c.types.families.flatMap((t) => [t.display.font, t.body.font, t.mono.font]),
  ]);
  const hexes = new Set(
    c.palettes.palettes.flatMap((p) => [
      ...Object.values(p.swatches),
      ...Object.values(p.roles),
      ...p.contrast.flat(),
    ]).map(normalizeHex),
  );
  return { ids, hexes };
}

export function findCatalogLiterals(c: Catalog, files: { path: string; text: string }[]): LiteralHit[] {
  const { ids, hexes } = forbidden(c);
  const hits: LiteralHit[] = [];
  for (const { path, text } of files) {
    text.split("\n").forEach((lineText, i) => {
      for (const m of lineText.matchAll(STRING_LITERAL)) {
        if (m[2] !== undefined && ids.has(m[2])) hits.push({ path, line: i + 1, value: m[2] });
      }
      for (const m of lineText.matchAll(HEX)) {
        if (hexes.has(normalizeHex(m[0]))) hits.push({ path, line: i + 1, value: m[0] });
      }
    });
  }
  return hits;
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true }).catch(() => []);
  return entries
    .filter((e) => e.isFile())
    .map((e) => relative(ROOT, join(e.parentPath, e.name)).split("\\").join("/"))
    .filter(isScannedPath);
}

async function main() {
  const catalog = await loadCatalog();
  const paths = (await Promise.all(SCAN_DIRS.map((d) => listFiles(join(ROOT, d))))).flat();
  const files = await Promise.all(paths.map(async (path) => ({ path, text: await readFile(join(ROOT, path), "utf8") })));
  const hits = findCatalogLiterals(catalog, files);
  for (const h of hits) console.error(`${h.path}:${h.line} ${h.value}`);
  console.log(`check:literals scanned ${files.length} files, ${hits.length} catalog literal(s) found`);
  if (hits.length > 0) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
