import { z } from "zod";

export const DepthSchema = z.enum(["overview", "standard", "deep"]);
export type Depth = z.infer<typeof DepthSchema>;

export const BriefSpecSchema = z.object({
  topic: z.string().trim().min(3).max(120),
  brief: z.string().trim().min(20).max(1500),
  audience: z.enum(["general", "technical", "executive", "students"]),
  durationMin: z.union([z.literal(5), z.literal(10), z.literal(20), z.literal(30)]),
  language: z.literal("en"),
});
export type BriefSpec = z.infer<typeof BriefSpecSchema>;

const id = z.string().min(1);

// Catalog-dependent rules (allowed palettes, motion, threeJs, questionCount) live in @deckforge/catalog.
export const ChoicesSchema = z.object({
  depth: DepthSchema,
  styleFamilyId: id,
  paletteId: id,
  typeFamilyId: id,
  motionTemplateId: id,
  interactionModeId: id,
  threeJs: z.boolean(),
  questionCount: z.number().int().optional(),
});
export type Choices = z.infer<typeof ChoicesSchema>;
