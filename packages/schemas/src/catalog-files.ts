import { z } from "zod";
import { HexSchema } from "./design.ts";

// Shapes of catalog/*.json. Objects are strict so a typo'd key fails loudly.
// Cross-file references (ids) are checked by @deckforge/catalog, not here.

const header = { version: z.string(), notes: z.string() };
const ids = z.array(z.string());

export const StyleFamilySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    tagline: z.string(),
    members: z.array(z.string()),
    tokens: z
      .object({
        radius: z.string(),
        borderWidth: z.string(),
        shadow: z.string(),
        texture: z.string(),
        gradients: z.boolean(),
        imageTreatment: z.string(),
        density: z.enum(["low", "medium", "high"]),
        titleCase: z.enum(["sentence", "title", "upper"]),
        maxWordsPerSlide: z.number().int().positive(),
        backdropBlur: z.string().optional(),
        surfaceAlpha: z.number().optional(),
      })
      .strict(),
    defaultPalette: z.string(),
    allowedPalettes: ids,
    defaultType: z.string(),
    allowedTypes: ids,
    defaultMotion: z.string(),
    threeJs: z.enum(["never", "optional", "default"]),
    layoutHints: z.array(z.string()),
  })
  .strict();
export type StyleFamily = z.infer<typeof StyleFamilySchema>;

export const DesignStylesFileSchema = z
  .object({ $schema: z.string().optional(), ...header, families: z.array(StyleFamilySchema) })
  .strict();
export type DesignStylesFile = z.infer<typeof DesignStylesFileSchema>;

export const PaletteRoleSchema = z.enum(["bg", "surface", "text", "textMuted", "primary", "accent", "border"]);
export type PaletteRole = z.infer<typeof PaletteRoleSchema>;

export const PaletteSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    group: z.string(),
    mode: z.enum(["light", "dark"]),
    swatches: z.record(z.string(), HexSchema),
    roles: z.object(Object.fromEntries(PaletteRoleSchema.options.map((r) => [r, HexSchema])) as Record<PaletteRole, typeof HexSchema>).strict(),
    contrast: z.array(z.tuple([HexSchema, HexSchema])),
  })
  .strict();
export type Palette = z.infer<typeof PaletteSchema>;

export const PalettesFileSchema = z
  .object({ ...header, roles: z.array(PaletteRoleSchema), palettes: z.array(PaletteSchema) })
  .strict();
export type PalettesFile = z.infer<typeof PalettesFileSchema>;

const FontSpecSchema = z
  .object({ font: z.string(), weights: z.array(z.number().int()), letterSpacing: z.number().optional() })
  .strict();

export const TypeFamilySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    display: FontSpecSchema,
    body: FontSpecSchema,
    mono: FontSpecSchema,
    scale: z.number().positive(),
    bodyLineHeight: z.number().positive(),
    displayLineHeight: z.number().positive(),
    pairsWith: ids,
  })
  .strict();
export type TypeFamily = z.infer<typeof TypeFamilySchema>;

export const TypeFamiliesFileSchema = z.object({ ...header, families: z.array(TypeFamilySchema) }).strict();
export type TypeFamiliesFile = z.infer<typeof TypeFamiliesFileSchema>;

const MotionStepSchema = z
  .object({ transition: z.string(), enter: z.string(), emphasis: z.string(), exit: z.string() })
  .strict();

export const MotionTemplateSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    intensity: z.enum(["off", "subtle", "medium", "bold"]),
    description: z.string(),
    library: z.array(z.string()),
    timing: z
      .object({ enter: z.number(), stagger: z.number(), transition: z.number(), easing: z.string() })
      .strict(),
    defaults: MotionStepSchema,
    bySlideType: z.record(z.string(), MotionStepSchema.extend({ easing: z.string() }).partial().strict()),
    reducedMotion: z.string(),
    parallax: z.object({ layers: z.number().int(), maxOffsetPx: z.number(), mouseFollow: z.boolean() }).strict().optional(),
    threeBackground: z
      .object({ scene: z.string(), onSlideTypes: ids, intensity: z.number() })
      .strict()
      .optional(),
    decorations: z.object({ animateBackgroundShapes: z.boolean(), loopDuration: z.number() }).strict().optional(),
  })
  .strict();
export type MotionTemplate = z.infer<typeof MotionTemplateSchema>;

export const MotionTemplatesFileSchema = z
  .object({
    ...header,
    vocabulary: z
      .object({ enter: ids, emphasis: ids, exit: ids, transition: ids, easing: ids })
      .strict(),
    templates: z.array(MotionTemplateSchema),
    inspiration: z.object({ note: z.string(), map: z.record(z.string(), z.string()) }).strict(),
  })
  .strict();
export type MotionTemplatesFile = z.infer<typeof MotionTemplatesFileSchema>;

export const InteractionModeSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    audienceExperience: z.string(),
    components: ids,
    minComponentsPerSlides: z.number().int().min(0),
    options: z
      .object({
        questionCount: z
          .object({ choices: z.array(z.number().int().positive()), default: z.number().int().positive() })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type InteractionMode = z.infer<typeof InteractionModeSchema>;

export const InteractionComponentSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    binds: ids,
    disallowedSlideTypes: ids.optional(),
    props: z.record(z.string(), z.unknown()),
    description: z.string(),
    cost: z.string(),
  })
  .strict();
export type InteractionComponent = z.infer<typeof InteractionComponentSchema>;

export const InteractionsFileSchema = z
  .object({
    ...header,
    modes: z.array(InteractionModeSchema),
    components: z.array(InteractionComponentSchema),
    placementRules: z.array(z.string()),
  })
  .strict();
export type InteractionsFile = z.infer<typeof InteractionsFileSchema>;

const range = z.tuple([z.number().int(), z.number().int()]);

export const SlideTypeSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    regions: z.array(z.string()),
    accepts: ids,
    limits: z.record(z.string(), z.union([z.number().int(), range])).optional(),
    required: z.enum(["first", "last", "penultimate-or-last"]).optional(),
    requiredWhen: z.string().optional(),
    onlyIn: ids.optional(),
    renderer: z.string().optional(),
    note: z.string().optional(),
  })
  .strict();
export type SlideType = z.infer<typeof SlideTypeSchema>;

export const DepthRuleSchema = z
  .object({ slides: range, wordsPerSlideMax: z.number().int().positive(), notesWordsPerSlide: range })
  .strict();
export type DepthRule = z.infer<typeof DepthRuleSchema>;

export const SlideTypesFileSchema = z
  .object({
    ...header,
    depth: z.record(z.string(), DepthRuleSchema),
    types: z.array(SlideTypeSchema),
    blocks: z.record(z.string(), z.record(z.string(), z.string())),
  })
  .strict();
export type SlideTypesFile = z.infer<typeof SlideTypesFileSchema>;

export const GoldenComboSchema = z
  .object({
    family: z.string(),
    motion: z.string(),
    interaction: z.string(),
    palette: z.string(),
    threeJs: z.boolean().optional(),
  })
  .strict();
export type GoldenCombo = z.infer<typeof GoldenComboSchema>;

export const CompatMatrixFileSchema = z
  .object({
    ...header,
    allowedMotion: z.record(z.string(), ids),
    threeJs: z.object({ requiresMotion: ids, note: z.string() }).strict(),
    paletteModeRules: z.record(z.string(), z.string()),
    interactionRules: z.record(
      z.string(),
      z
        .object({
          minDepth: z.string().optional(),
          reason: z.string().optional(),
        })
        .strict(),
    ),
    densityCaps: z.object({ note: z.string() }).strict(),
    designRules: z.object({ motionOverrideSlideTypes: ids, maxInteractiveComponentsPerSlide: z.number() }).strict(),
    golden: z.array(GoldenComboSchema),
  })
  .strict();
export type CompatMatrixFile = z.infer<typeof CompatMatrixFileSchema>;
