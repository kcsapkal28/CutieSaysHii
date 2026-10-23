import { readRawCatalog } from "../src/load.ts";
import type { CatalogKey } from "../src/files.ts";

// Raw JSON as untyped records so tests can mutate freely.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Raw = Record<CatalogKey, any>;

export async function rawCatalog(): Promise<Raw> {
  return structuredClone(await readRawCatalog()) as Raw;
}
