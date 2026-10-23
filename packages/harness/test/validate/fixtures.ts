import { readFileSync } from "node:fs";
import type { Catalog } from "@deckforge/catalog";
import { DeckSpecSchema, type DeckSpec } from "@deckforge/schemas";
import type { DeckSkeleton } from "../../src/kernel/contracts.ts";
import type { DesignWireEnums } from "../../src/validate/design-wire.ts";

export const STANDARD_DECK: DeckSpec = DeckSpecSchema.parse(
  JSON.parse(readFileSync(new URL("../fixtures/standard.deck.json", import.meta.url), "utf8")),
);

export const skeletonOf = (deck: DeckSpec): DeckSkeleton => ({
  slides: deck.slides.map((s) => ({
    id: s.id,
    type: s.type,
    emphasisCount: s.emphasisTargets.length,
    blockTypes: s.body.map((b) => b.type),
  })),
});

/** The enums a real emit_design tool carries for the standard fixture, using the mode with the most components. */
export function finalDesignEnums(c: Catalog, skeleton: DeckSkeleton = skeletonOf(STANDARD_DECK)): DesignWireEnums {
  const mode = [...c.interactions.modes].sort((a, b) => b.components.length - a.components.length)[0]!;
  const overrideTypes = new Set(c.compat.designRules.motionOverrideSlideTypes);
  return {
    slideIds: skeleton.slides.map((s) => s.id),
    overrideSlideIds: skeleton.slides.filter((s) => overrideTypes.has(s.type)).map((s) => s.id),
    componentIds: mode.components,
    vocabulary: c.motion.vocabulary,
  };
}
