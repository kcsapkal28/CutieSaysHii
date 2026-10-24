import { resolveMotionPlan, type Catalog } from "@deckforge/catalog";
import type { DeckSpec, InteractionPlan, Slide } from "@deckforge/schemas";
import type { DesignChoices, DesignPlan } from "../kernel/contracts.ts";
import { WHOLE_SLIDE } from "../validate/design.ts";

type Component = InteractionPlan["slides"][number]["components"][number];

/**
 * Carries the design plan across a patch. A slide that kept its id and type keeps its motion entry
 * (override included); a new or retyped slide gets the template's base motion. Placements survive
 * only on such kept slides, and only while their block still binds.
 */
export function reconcileDesign(
  c: Catalog,
  choices: DesignChoices,
  plan: DesignPlan,
  decks: { before: DeckSpec; after: DeckSpec },
): DesignPlan {
  const { before, after } = decks;
  const base = resolveMotionPlan(c, choices.motionTemplateId, after.slides);
  const typeBefore = new Map(before.slides.map((s) => [s.id, s.type]));
  const kept = (s: Slide) => typeBefore.get(s.id) === s.type;

  const motion = Object.fromEntries(
    after.slides.map((s) => [s.id, (kept(s) ? plan.motion.slides[s.id] : undefined) ?? base.slides[s.id]!]),
  );

  const components = new Map(c.interactions.components.map((x) => [x.id, x]));
  const binds = (x: Component, slide: Slide) => {
    const def = components.get(x.componentId);
    if (!def) return false;
    if (x.blockIndex === undefined) return def.binds.includes(WHOLE_SLIDE);
    const block = slide.body[x.blockIndex];
    return block !== undefined && def.binds.includes(block.type);
  };
  const placed = new Map(plan.interaction.slides.map((p) => [p.slideId, p.components]));
  const slides = after.slides.flatMap((s) => {
    const survivors = kept(s) ? (placed.get(s.id) ?? []).filter((x) => binds(x, s)) : [];
    return survivors.length > 0 ? [{ slideId: s.id, components: survivors }] : [];
  });

  return { motion: { ...plan.motion, slides: motion }, interaction: { ...plan.interaction, slides } };
}
