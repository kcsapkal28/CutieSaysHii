import type { QAReport, RenderManifest } from "@deckforge/schemas";
import { STANDARD_DECK } from "../validate/fixtures.ts";

export const MANIFEST: RenderManifest = {
  jobId: "j_test",
  entry: "index.html",
  slideIds: STANDARD_DECK.slides.map((s) => s.id),
  assets: [{ path: "index.html", bytes: 1200 }],
  totalBytes: 1200,
  threeJs: false,
  warnings: [],
};

export type SlideReport = QAReport["slides"][number];

export const slideReport = (id: string, o: Partial<SlideReport> = {}): SlideReport => ({
  id,
  overflow: false,
  consoleErrors: [],
  contrastFails: [],
  wordCount: 10,
  ...o,
});

/** A report over the standard deck where every slide passes except those in `failing`. */
export function reportWith(failing: Record<string, Partial<SlideReport>>, wordCount = 10): QAReport {
  const slides = STANDARD_DECK.slides.map((s) => slideReport(s.id, { wordCount, ...failing[s.id] }));
  return { pass: Object.keys(failing).length === 0, slides, patches: [] };
}
