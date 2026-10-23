import { loadCatalog, type Catalog } from "@deckforge/catalog";
import { beforeAll, describe, expect, it } from "vitest";
import { findCatalogLiterals, isScannedPath } from "./check-catalog-literals.ts";

let c: Catalog;
beforeAll(async () => {
  c = await loadCatalog();
});

const scan = (text: string) => findCatalogLiterals(c, [{ path: "packages/x/src/a.ts", text }]);

describe("findCatalogLiterals", () => {
  it("flags 'warm-minimalist' in a quoted literal", () => {
    expect(scan(`const a = 1;\nconst p = 'warm-minimalist';`)).toEqual([
      { path: "packages/x/src/a.ts", line: 2, value: "warm-minimalist" },
    ]);
  });

  it("flags #d0253b case-insensitively", () => {
    expect(scan(`.x { color: #d0253b; }`).map((h) => h.value)).toEqual(["#d0253b"]);
  });

  it("flags a font name in a template literal", () => {
    expect(scan("const f = `Space Grotesk`;").map((h) => h.value)).toEqual(["Space Grotesk"]);
  });

  it("ignores 'calm'", () => {
    expect(scan(`const m = "calm";`)).toEqual([]);
  });

  it("ignores the unquoted identifier warmMinimalist", () => {
    expect(scan(`const warmMinimalist = load();`)).toEqual([]);
  });
});

describe("isScannedPath", () => {
  it("scans source under apps/ and packages/", () => {
    expect(isScannedPath("packages/renderer/src/theme.ts")).toBe(true);
    expect(isScannedPath("apps/web/app/page.tsx")).toBe(true);
    expect(isScannedPath("packages/renderer/templates/title.hbs")).toBe(true);
  });

  it("skips tests, fixtures, build output and the catalog schema file", () => {
    expect(isScannedPath("packages/catalog/test/compat.test.ts")).toBe(false);
    expect(isScannedPath("packages/qa/src/x.test.ts")).toBe(false);
    expect(isScannedPath("packages/harness/fixtures/golden/1.json")).toBe(false);
    expect(isScannedPath("apps/web/.next/server/page.js")).toBe(false);
    expect(isScannedPath("packages/x/node_modules/y/index.js")).toBe(false);
    expect(isScannedPath("packages/schemas/src/catalog-files.ts")).toBe(false);
    expect(isScannedPath("packages/x/README.md")).toBe(false);
  });
});
