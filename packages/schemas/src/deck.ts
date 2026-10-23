import { z } from "zod";

// Block shapes mirror catalog/slide-types.json → blocks. `type` is the discriminator
// because Chart already owns a `kind` field.
const Bullets = z.object({ type: z.literal("Bullets"), items: z.array(z.string()) });
const Paragraph = z.object({ type: z.literal("Paragraph"), text: z.string() });
const Stat = z.object({
  type: z.literal("Stat"),
  value: z.string(),
  label: z.string(),
  trend: z.enum(["up", "down", "flat"]).optional(),
});
const Quote = z.object({ type: z.literal("Quote"), text: z.string(), attribution: z.string() });
const Diagram = z.object({
  type: z.literal("Diagram"),
  mermaid: z.string(),
  hotspots: z.array(z.object({ nodeId: z.string(), label: z.string(), detail: z.string() })).optional(),
});
const Chart = z.object({
  type: z.literal("Chart"),
  kind: z.enum(["bar", "line", "area", "donut"]),
  labels: z.array(z.string()),
  series: z.array(z.object({ name: z.string(), values: z.array(z.number()) })),
  unit: z.string().optional(),
});
const Compare = z.object({
  type: z.literal("Compare"),
  leftTitle: z.string(),
  rightTitle: z.string(),
  rows: z.array(z.object({ left: z.string(), right: z.string() })),
});
const Timeline = z.object({
  type: z.literal("Timeline"),
  steps: z.array(z.object({ label: z.string(), detail: z.string(), date: z.string().optional() })),
});
const Code = z.object({
  type: z.literal("Code"),
  lang: z.string(),
  code: z.string(),
  highlightLines: z.array(z.number().int()).optional(),
});
const Image = z.object({ type: z.literal("Image"), prompt: z.string(), alt: z.string() });
const Quiz = z.object({
  type: z.literal("Quiz"),
  question: z.string(),
  options: z.array(z.string()),
  answerIndex: z.number().int(),
  explanation: z.string(),
});

// Zod v3 discriminated unions only accept plain objects, so cross-field rules sit on the union.
export const BlockUnionSchema = z.discriminatedUnion("type", [
  Bullets, Paragraph, Stat, Quote, Diagram, Chart, Compare, Timeline, Code, Image, Quiz,
]);

export const BlockSchema = BlockUnionSchema.superRefine((block, ctx) => {
  if (block.type === "Quiz" && (block.answerIndex < 0 || block.answerIndex >= block.options.length)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["answerIndex"], message: "answerIndex must index into options" });
  }
  if (block.type === "Chart") {
    block.series.forEach((s, i) => {
      if (s.values.length !== block.labels.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["series", i, "values"],
          message: `series "${s.name}" has ${s.values.length} values for ${block.labels.length} labels`,
        });
      }
    });
  }
});
export type Block = z.infer<typeof BlockSchema>;

export const SlideSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  title: z.string().optional(),
  body: z.array(BlockSchema),
  notes: z.string(),
  emphasisTargets: z.array(z.string()),
});
export type Slide = z.infer<typeof SlideSchema>;

export const DeckSpecSchema = z
  .object({ title: z.string(), subtitle: z.string(), slides: z.array(SlideSchema).min(1) })
  .superRefine((deck, ctx) => {
    const seen = new Set<string>();
    deck.slides.forEach((s, i) => {
      if (seen.has(s.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["slides", i, "id"], message: `duplicate slide id "${s.id}"` });
      }
      seen.add(s.id);
    });
  });
export type DeckSpec = z.infer<typeof DeckSpecSchema>;
