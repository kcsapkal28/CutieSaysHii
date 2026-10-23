import {
  CompatMatrixFileSchema,
  DesignStylesFileSchema,
  InteractionsFileSchema,
  MotionTemplatesFileSchema,
  PalettesFileSchema,
  SlideTypesFileSchema,
  TypeFamiliesFileSchema,
} from "@deckforge/schemas";
import type { ZodType } from "zod";
import { CATALOG_FILES, type Catalog, type CatalogKey } from "./files.ts";
import { checkIntegrity } from "./integrity.ts";

export type CatalogIssue = { file: string; path: string; message: string };

export class CatalogError extends Error {
  constructor(
    readonly file: string,
    readonly issues: CatalogIssue[],
  ) {
    super(`Invalid catalog:\n${issues.map((i) => `  ${i.file}: ${i.path} ${i.message}`).join("\n")}`);
    this.name = "CatalogError";
  }
}

const SCHEMAS: { [K in CatalogKey]: ZodType<Catalog[K]> } = {
  styles: DesignStylesFileSchema,
  palettes: PalettesFileSchema,
  types: TypeFamiliesFileSchema,
  motion: MotionTemplatesFileSchema,
  interactions: InteractionsFileSchema,
  slideTypes: SlideTypesFileSchema,
  compat: CompatMatrixFileSchema,
};

/** Schema validation only. Most callers want parseCatalog, which also checks cross-references. */
export function parseCatalogFiles(raw: Record<CatalogKey, unknown>): Catalog {
  const out: Partial<Catalog> = {};
  for (const key of Object.keys(CATALOG_FILES) as CatalogKey[]) {
    const file = CATALOG_FILES[key];
    const result = SCHEMAS[key].safeParse(raw[key]);
    if (!result.success) {
      throw new CatalogError(
        file,
        result.error.issues.map((i) => ({ file, path: i.path.join("."), message: i.message })),
      );
    }
    (out as Record<CatalogKey, unknown>)[key] = result.data;
  }
  return out as Catalog;
}

/** Pure and browser-safe: validates every file, then every cross-reference. */
export function parseCatalog(raw: Record<CatalogKey, unknown>): Catalog {
  const catalog = parseCatalogFiles(raw);
  const issues = checkIntegrity(catalog);
  if (issues.length > 0) throw new CatalogError(issues[0]!.file, issues);
  return catalog;
}
