import type { DeckSpec } from "@deckforge/schemas";
import type { DeckSkeleton } from "../kernel/contracts.ts";

/** The deck's structure for Agent B: ids, types, emphasis targets and block types; no slide text. */
export function toSkeleton(deck: DeckSpec): DeckSkeleton {
  return {
    slides: deck.slides.map((s) => ({
      id: s.id,
      type: s.type,
      emphasisTargets: [...s.emphasisTargets],
      blockTypes: s.body.map((b) => b.type),
    })),
  };
}
