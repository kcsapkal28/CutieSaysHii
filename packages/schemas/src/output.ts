import { z } from "zod";
import { HexSchema } from "./design.ts";

export const PatchSchema = z.object({
  slideId: z.string(),
  op: z.enum(["shortenText", "splitSlide", "swapLayout", "dropBlock"]),
  payload: z.record(z.string(), z.unknown()),
});
export type Patch = z.infer<typeof PatchSchema>;

export const QAReportSchema = z.object({
  pass: z.boolean(),
  slides: z.array(
    z.object({
      id: z.string(),
      overflow: z.boolean(),
      consoleErrors: z.array(z.string()),
      contrastFails: z.array(z.object({ selector: z.string(), fg: HexSchema, bg: HexSchema, ratio: z.number() })),
      wordCount: z.number().int().min(0),
    }),
  ),
  patches: z.array(PatchSchema),
});
export type QAReport = z.infer<typeof QAReportSchema>;

export const RenderManifestSchema = z.object({
  jobId: z.string(),
  entry: z.string(),
  slideIds: z.array(z.string()),
  assets: z.array(z.object({ path: z.string(), bytes: z.number().int() })),
  totalBytes: z.number().int(),
  threeJs: z.boolean(),
  warnings: z.array(z.string()),
});
export type RenderManifest = z.infer<typeof RenderManifestSchema>;
