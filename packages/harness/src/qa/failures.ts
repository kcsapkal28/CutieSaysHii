import { AA_RATIO } from "@deckforge/catalog";
import type { QAReport } from "@deckforge/schemas";

export type SlideQa = QAReport["slides"][number];
export type QaFailure = { slideId: string; reasons: string[] };

/** Why a slide failed QA, in a fixed order; empty when it passed. */
export function qaFailureReasons(slide: SlideQa, wordCap: number): string[] {
  return [
    ...(slide.overflow ? ["overflow"] : []),
    ...slide.consoleErrors.map((m) => `console: ${m}`),
    ...slide.contrastFails.map((f) => `contrast ${f.ratio.toFixed(2)} < ${AA_RATIO} at ${f.selector}`),
    ...(slide.wordCount > wordCap ? [`${slide.wordCount} words > ${wordCap}`] : []),
  ];
}

/** Failing slides with their reasons, in report (deck) order. */
export function qaFailures(report: QAReport, wordCap: number): QaFailure[] {
  return report.slides.flatMap((s) => {
    const reasons = qaFailureReasons(s, wordCap);
    return reasons.length > 0 ? [{ slideId: s.id, reasons }] : [];
  });
}

export function failingSlideIds(report: QAReport, wordCap: number): string[] {
  return qaFailures(report, wordCap).map((f) => f.slideId);
}
