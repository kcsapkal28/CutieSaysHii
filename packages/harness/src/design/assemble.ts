import { resolveMotionPlan, type Catalog } from "@deckforge/catalog";
import type { InteractionPlan } from "@deckforge/schemas";
import type { DeckSkeleton, DesignChoices, DesignPlan } from "../kernel/contracts.ts";
import type { DesignWire } from "../validate/design-wire.ts";

type Component = InteractionPlan["slides"][number]["components"][number];

/** Turns a validated emit_design reply into the DesignPlan: template motion plus overrides, placements by slide. */
export function assembleDesign(c: Catalog, choices: DesignChoices, skel: DeckSkeleton, wire: DesignWire): DesignPlan {
  const motion = resolveMotionPlan(c, choices.motionTemplateId, skel.slides);
  for (const { slideId, transition, enter, emphasis, exit, easing, reason } of wire.motion.overrides) {
    const base = motion.slides[slideId];
    motion.slides[slideId] = { transition, enter, emphasis, exit, easing: easing ?? base?.easing, overrideReason: reason };
  }

  const bySlide = new Map<string, Component[]>();
  for (const p of wire.interaction.placements) {
    const component: Component = {
      componentId: p.componentId,
      ...(p.blockIndex === null ? {} : { blockIndex: p.blockIndex }),
      props: JSON.parse(p.propsJson) as Record<string, unknown>,
    };
    bySlide.set(p.slideId, [...(bySlide.get(p.slideId) ?? []), component]);
  }
  const slides = skel.slides.flatMap((s) => {
    const components = bySlide.get(s.id);
    return components ? [{ slideId: s.id, components }] : [];
  });

  return { motion, interaction: { modeId: choices.interactionModeId, slides } };
}
