// The deterministic pre-check's place in the build loop: what blocks the critic, and how measured findings are
// worded for the builder (as fix issues) and the critic (as context). Findings come from the shooter (measure.ts).
import type { Issue, IssueKind } from "../agents/schemas.ts";
import type { Finding, FindingKind, ShootResult } from "../contract.ts";

/** Kinds the build loop reports: the measured ones plus the shooter's console errors and external requests. */
export type PrecheckKind = FindingKind | "console-error" | "external-request";

export type Precheck = {
  findings: Finding[];
  /** Error-severity findings: they block the critic for this round. */
  blocking: Finding[];
  warnings: Finding[];
  /** Console and page errors, failed requests and external requests (as the builder sees them). Also blocking. */
  errors: string[];
  /** Blocking problems in total (blocking findings + errors). */
  hard: number;
  /** Distinct kinds of the blocking problems, or of the warnings when nothing blocks. */
  kinds: PrecheckKind[];
};

/** Ranks a pre-check-failed attempt below any critic-reviewed one (attemptScore stays far above this). */
export const PRECHECK_FAILED_SCORE = -10_000;

export const KIND_LABEL: Record<PrecheckKind, string> = {
  "clipped-text": "text clipped",
  "off-canvas": "off canvas",
  "text-overlap": "overlapping text",
  "blank-render": "blank render",
  "dead-canvas": "canvas draws nothing",
  "tiny-text": "tiny text",
  "low-contrast": "low contrast",
  "dead-step": "step changes nothing",
  "console-error": "console error",
  "external-request": "external request",
};

export function precheck(shot: ShootResult, id: string): Precheck {
  const findings = shot.findings?.[id] ?? [];
  const blocking = findings.filter((f) => f.severity === "error");
  const warnings = findings.filter((f) => f.severity === "warn");
  const consoleErrors = [...(shot.errors[id] ?? []), ...(shot.errors.deck ?? [])];
  const external = shot.externalRequests.map((u) => `external request (the deck must be self-contained): ${u}`);
  const hardKinds: PrecheckKind[] = [
    ...blocking.map((f) => f.kind),
    ...(consoleErrors.length ? (["console-error"] as const) : []),
    ...(external.length ? (["external-request"] as const) : []),
  ];
  const hard = blocking.length + consoleErrors.length + external.length;
  const kinds = [...new Set(hard ? hardKinds : warnings.map((f) => f.kind))];
  return { findings, blocking, warnings, errors: [...consoleErrors, ...external], hard, kinds };
}

const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);

/** A concrete, generic suggestion for one finding, using its measured numbers. */
function suggestion(f: Finding): string {
  const m = f.measured;
  switch (f.kind) {
    case "clipped-text":
      return m.side === "left" || m.side === "right"
        ? `Widen ${m.container} by at least ${num(m.overflowPx) + 16}px (it is ${m.containerW}px wide), let the text wrap, or reduce its font size; never hide overflow on a box that holds copy.`
        : `Make ${m.container} taller than ${m.containerH}px or drop its fixed height, or shorten the copy / reduce the font size so all ${m.lines} line(s) fit; never hide overflow on a box that holds copy.`;
    case "off-canvas":
      return `Move it at least ${num(m.overflowPx) + 24}px inward from the ${m.side} edge (keep text inside x 96…1824, y 72…1008), or let it wrap / reduce its size.`;
    case "text-overlap":
      return `Separate the two by at least ${Math.min(num(m.w), num(m.h)) + 16}px (move one of them, or lay them out in a column/row with a gap) so their boxes no longer intersect.`;
    case "blank-render":
      return "Make the slide's content render at this step in shot mode: check that nothing is left at opacity 0, display:none or off-stage, that step(i) sets a visible state for every i, and that the script does not bail out before building the DOM.";
    case "dead-canvas":
      return "Make the canvas draw: build the scene, call render() after every state change (or in api.onFrame), point the camera at the objects, light them and keep them inside the view; for 2D, draw after the canvas is sized.";
    case "tiny-text":
      return "Set it to at least 18px on the 1920×1080 canvas (callout labels 22–28px).";
    case "low-contrast":
      return `Use a colour with at least ${m.min}:1 against ${m.background} (e.g. var(--df-text) or var(--df-muted) on that background), or put the text on a solid surface.`;
    case "dead-step":
      return `Make step ${m.step} change something visible (the storyboard's beat for that step), or reduce the number of steps.`;
  }
}

/** The failure class each measured finding counts under (the critic's issue kinds). */
export const FINDING_ISSUE_KIND: Record<FindingKind, IssueKind> = {
  "clipped-text": "clipped",
  "off-canvas": "clipped",
  "text-overlap": "overlap",
  "blank-render": "error",
  "dead-canvas": "error",
  "tiny-text": "tiny-text",
  "low-contrast": "contrast",
  "dead-step": "steps",
};

/** Findings as the builder's next-round fix issues: blocking ones high, warnings medium. */
export function precheckIssues(findings: Finding[]): Issue[] {
  const ordered = [...findings.filter((f) => f.severity === "error"), ...findings.filter((f) => f.severity === "warn")];
  return ordered.map((f) => ({
    severity: f.severity === "error" ? "high" : "medium",
    kind: FINDING_ISSUE_KIND[f.kind],
    what: `Measured (${KIND_LABEL[f.kind]}): ${f.detail}.`,
    where: `step ${f.step + 1}, ${f.selector}`,
    fix: suggestion(f),
  }));
}

/** Warning findings as one line each, for the critic's context. */
export function measuredNotes(warnings: Finding[]): string[] {
  return warnings.map((f) => `${KIND_LABEL[f.kind]} (step ${f.step + 1}, ${f.selector}): ${f.detail}`);
}
