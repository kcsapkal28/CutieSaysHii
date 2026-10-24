import type { Catalog } from "@deckforge/catalog";
import { beforeAll, describe, expect, it } from "vitest";
import type { QaRequest } from "../../src/kernel/ports.ts";
import { failFirstQa } from "../../src/qa/fail-first.ts";
import { wordCountQa } from "../../src/qa/word-count.ts";
import { testCatalog } from "../helpers/context.ts";
import { STANDARD_DECK } from "../validate/fixtures.ts";
import { MANIFEST } from "./fixtures.ts";

let c: Catalog;
beforeAll(async () => {
  c = await testCatalog();
});

const REQ: QaRequest = { distDir: "jobs/j_test/dist", manifest: MANIFEST, deck: STANDARD_DECK, wordCap: 40 };
const signal = new AbortController().signal;

describe("failFirstQa", () => {
  it("fails the picked slide on the first call, then delegates", async () => {
    const inner = wordCountQa(c);
    const picked: QaRequest[] = [];
    const qa = failFirstQa(inner, (req) => {
      picked.push(req);
      return "s04";
    });

    const first = await qa.run(REQ, signal);
    const clean = await inner.run(REQ, signal);
    expect(first.pass).toBe(false);
    expect(first.slides).toEqual(clean.slides.map((s) => (s.id === "s04" ? { ...s, overflow: true } : s)));
    expect(picked).toEqual([REQ]);

    expect(await qa.run(REQ, signal)).toEqual(clean);
    expect(await qa.run(REQ, signal)).toEqual(clean);
    expect(picked).toHaveLength(1);
  });

  it("a picked id missing from the report is an error", async () => {
    await expect(failFirstQa(wordCountQa(c), () => "s99").run(REQ, signal)).rejects.toThrow(/s99/);
  });
});
