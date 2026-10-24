import type { Catalog } from "@deckforge/catalog";
import type { DeckSpec } from "@deckforge/schemas";
import { beforeAll, describe, expect, it } from "vitest";
import { wordCountQa } from "../../src/qa/word-count.ts";
import { coverTypeIds } from "../../src/validate/rules.ts";
import { visibleWords } from "../../src/validate/words.ts";
import { testCatalog } from "../helpers/context.ts";
import { STANDARD_DECK } from "../validate/fixtures.ts";
import { MANIFEST } from "./fixtures.ts";

let c: Catalog;
beforeAll(async () => {
  c = await testCatalog();
});

const run = (deck: DeckSpec, wordCap: number, signal = new AbortController().signal) =>
  wordCountQa(c).run({ distDir: "jobs/j_test/dist", manifest: MANIFEST, deck, wordCap }, signal);

describe("wordCountQa", () => {
  it("counts; pass under cap", async () => {
    const report = await run(STANDARD_DECK, 40);
    const covers = coverTypeIds(c);
    expect(report.pass).toBe(true);
    expect(report.patches).toEqual([]);
    expect(report.slides).toEqual(
      STANDARD_DECK.slides.map((s) => ({
        id: s.id,
        overflow: false,
        consoleErrors: [],
        contrastFails: [],
        wordCount: visibleWords(s, covers.includes(s.type) ? STANDARD_DECK : undefined),
      })),
    );
    // The cover counts the deck title and subtitle, as the renderer prints them.
    expect(report.slides[0]!.wordCount).toBe(visibleWords(STANDARD_DECK.slides[0]!, STANDARD_DECK));
    expect(report.slides[0]!.wordCount).toBeGreaterThan(visibleWords(STANDARD_DECK.slides[0]!));
  });

  it("fails over cap", async () => {
    const most = Math.max(...(await run(STANDARD_DECK, 40)).slides.map((s) => s.wordCount));
    expect((await run(STANDARD_DECK, most)).pass).toBe(true);
    expect((await run(STANDARD_DECK, most - 1)).pass).toBe(false);
  });

  it("honours an aborted signal", async () => {
    const ac = new AbortController();
    ac.abort(new Error("stop"));
    await expect(run(STANDARD_DECK, 40, ac.signal)).rejects.toThrow("stop");
  });
});
