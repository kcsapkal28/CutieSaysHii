import { z } from "zod";

export const HexSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "expected #RRGGBB");

const FontRefSchema = z.object({
  font: z.string(),
  weights: z.array(z.number().int()),
  letterSpacing: z.number().optional(),
});

export const ThemeSpecSchema = z.object({
  familyId: z.string(),
  paletteId: z.string(),
  typeFamilyId: z.string(),
  roles: z.object({
    bg: HexSchema,
    surface: HexSchema,
    text: HexSchema,
    textMuted: HexSchema,
    primary: HexSchema,
    accent: HexSchema,
    border: HexSchema,
  }),
  type: z.object({
    display: FontRefSchema,
    body: FontRefSchema,
    mono: FontRefSchema,
    scale: z.number(),
    bodyLineHeight: z.number(),
    displayLineHeight: z.number(),
  }),
  radius: z.string(),
  borderWidth: z.string(),
  shadow: z.string(),
  texture: z.string(),
  gradients: z.boolean(),
  imageTreatment: z.string(),
  threeJs: z.boolean(),
  mode: z.enum(["light", "dark"]),
  density: z.enum(["low", "medium", "high"]),
  titleCase: z.enum(["sentence", "title", "upper"]),
  backdropBlur: z.string().optional(),
  surfaceAlpha: z.number().min(0).max(1).optional(),
});
export type ThemeSpec = z.infer<typeof ThemeSpecSchema>;

export const MotionPlanSchema = z.object({
  templateId: z.string(),
  reducedMotion: z.string().min(1),
  timing: z.object({ enter: z.number(), stagger: z.number(), transition: z.number(), easing: z.string() }),
  slides: z.record(
    z.string(),
    z.object({
      transition: z.string(),
      enter: z.string(),
      emphasis: z.string(),
      exit: z.string(),
      easing: z.string().optional(),
      overrideReason: z.string().optional(),
    }),
  ),
});
export type MotionPlan = z.infer<typeof MotionPlanSchema>;

export const InteractionPlanSchema = z.object({
  modeId: z.string(),
  slides: z.array(
    z.object({
      slideId: z.string(),
      components: z.array(
        z.object({
          componentId: z.string(),
          blockIndex: z.number().int().min(0).optional(),
          props: z.record(z.string(), z.unknown()),
        }),
      ),
    }),
  ),
});
export type InteractionPlan = z.infer<typeof InteractionPlanSchema>;
