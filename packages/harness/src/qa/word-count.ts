import type { Catalog } from "@deckforge/catalog";
import type { QAReport } from "@deckforge/schemas";
import type { QaPort } from "../kernel/ports.ts";
import { coverTypeIds } from "../validate/rules.ts";
import { visibleWords } from "../validate/words.ts";

/**
 * A QA stub until Playwright QA lands (Plan 4): it counts each slide's visible words and checks
 * them against the cap. It reports no overflow, console errors or contrast failures.
 */
export function wordCountQa(c: Catalog): QaPort {
  const covers = new Set(coverTypeIds(c));
  return {
    run: async ({ deck, wordCap }, signal) => {
      signal.throwIfAborted();
      const slides: QAReport["slides"] = deck.slides.map((s) => ({
        id: s.id,
        overflow: false,
        consoleErrors: [],
        contrastFails: [],
        wordCount: visibleWords(s, covers.has(s.type) ? deck : undefined),
      }));
      return { pass: slides.every((s) => s.wordCount <= wordCap), slides, patches: [] };
    },
  };
}
