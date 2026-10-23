import type { MotionTemplatesFile } from "@deckforge/schemas";
import { z } from "zod";

type Vocabulary = MotionTemplatesFile["vocabulary"];

export type DesignWireEnums = {
  slideIds?: readonly string[];
  /** Slides whose type allows a motion override. */
  overrideSlideIds?: readonly string[];
  componentIds?: readonly string[];
  vocabulary?: Partial<Vocabulary>;
};

/** An enum when there are values to choose from; a plain string otherwise (validateDesign still checks it). */
export function enumOrString(values: readonly string[] | undefined): z.ZodEnum<[string, ...string[]]> | z.ZodString {
  return values && values.length > 0 ? z.enum(values as [string, ...string[]]) : z.string();
}

export function designWireSchema(e: DesignWireEnums = {}) {
  const v = e.vocabulary ?? {};
  return z.object({
    motion: z.object({
      overrides: z.array(
        z.object({
          slideId: enumOrString(e.overrideSlideIds),
          transition: enumOrString(v.transition),
          enter: enumOrString(v.enter),
          emphasis: enumOrString(v.emphasis),
          exit: enumOrString(v.exit),
          easing: enumOrString(v.easing).nullable(),
          reason: z.string(),
        }),
      ),
    }),
    interaction: z.object({
      placements: z.array(
        z.object({
          slideId: enumOrString(e.slideIds),
          componentId: enumOrString(e.componentIds),
          blockIndex: z.number().int().nullable(),
          propsJson: z.string(),
        }),
      ),
    }),
  });
}

export type DesignWire = z.infer<ReturnType<typeof designWireSchema>>;
