import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CATALOG_FILES, type Catalog, type CatalogKey } from "./files.ts";
import { CatalogError, parseCatalog } from "./parse.ts";

// Resolved on call, not at import, so bundlers never see the URL as an asset reference.
export function defaultCatalogDir(): string {
  return process.env.DECKFORGE_CATALOG_DIR ?? fileURLToPath(new URL("../../../catalog/", import.meta.url));
}

export async function readRawCatalog(dir = defaultCatalogDir()): Promise<Record<CatalogKey, unknown>> {
  const entries = await Promise.all(
    (Object.entries(CATALOG_FILES) as [CatalogKey, string][]).map(async ([key, file]) => {
      const text = await readFile(join(dir, file), "utf8");
      try {
        return [key, JSON.parse(text)] as const;
      } catch (e) {
        throw new CatalogError(file, [{ file, path: "", message: (e as Error).message }]);
      }
    }),
  );
  return Object.fromEntries(entries) as Record<CatalogKey, unknown>;
}

export async function loadCatalog(dir = defaultCatalogDir()): Promise<Catalog> {
  return parseCatalog(await readRawCatalog(dir));
}
