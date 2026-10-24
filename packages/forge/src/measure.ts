// The deterministic pre-check that runs after each step of a slide settles in shot mode (shoot.ts), before any
// vision review. Layout checks run in the page (measure-page.ts); pixel checks (blank render, canvases that draw
// nothing, contrast against what is really behind the text, steps that change nothing) read the screenshots.
// Every threshold lives in MEASURE. They are generic (no topic or deck knowledge) and calibrated so the hand-built
// exemplar decks produce no error findings (test/shoot.e2e.test.ts) while synthetic broken slides each trip exactly
// their check (test/measure.e2e.test.ts).
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import type { Page } from "playwright";
import { CANVAS, type Finding, type FindingKind } from "./contract.ts";
import type { Box, Probe, ProbeThresholds } from "./measure-page.ts";
import { decodePng, type Pixels } from "./png.ts";

export const MEASURE = {
  /** A text line may poke this far past a clipping container (px)… */
  clipTolPx: 4,
  /** …or this fraction of its font size, whichever is larger, before it counts as cut (line boxes exceed the ink). */
  clipTolEm: 0.2,
  /** Controls may poke this far past the canvas edge (px). */
  offCanvasTolPx: 8,
  /** Text fainter than this (effective opacity) is decorative: no clip, off-canvas or overlap findings. */
  decorativeOpacity: 0.35,
  /** Two text boxes overlap when the intersection covers this fraction of the smaller one… */
  overlapMinFraction: 0.15,
  /** …and is at least this many px in both directions. */
  overlapMinPx: 6,
  /** Line boxes are shrunk by this × font size at top and bottom to approximate the ink before intersecting. */
  overlapInsetEm: 0.18,
  /** Text at least this big (px) overlapping text this many times smaller is deliberate layering, not a collision. */
  layeringMinPx: 120,
  layeringRatio: 3,
  /** A text line box taller than this × its font size is rotated, vertical or on a path: box checks skip it. */
  maxLineEm: 2.2,
  /** Text this big (px) is display type; cut by the canvas edge or its card it is a deliberate bleed, not clipping. */
  bleedMinPx: 200,
  /** Rendered text smaller than this (px on the 1920×1080 canvas) is a tiny-text warning. */
  minFontPx: 16,
  /** WCAG AA: normal text needs 4.5:1, large text (≥ 24px, or ≥ 18.66px bold) 3:1. */
  contrastNormal: 4.5,
  contrastLarge: 3,
  largePx: 24,
  largeBoldPx: 18.66,
  /** Text dimmed below this opacity is an intentional de-emphasis; its contrast is not checked. */
  contrastMinOpacity: 0.5,
  /** Background is sampled in a ring this far outside the text box (px)… */
  ringInnerPx: 3,
  ringOuterPx: 8,
  /** …and only trusted when this share of the ring is within `ringTol` (max channel difference) of its median. */
  ringUniform: 0.8,
  ringTol: 24,
  /** Contrast is checked on at most this many text boxes per step (largest first). */
  contrastMaxTexts: 120,
  /** A pixel is an edge when it differs from its right or lower neighbour by more than this (max channel). */
  edgeDelta: 32,
  /** A step whose screenshot has fewer edge pixels than this is blank (one word of 18px text has more). */
  blankEdgePx: 400,
  /** Canvases smaller than this (px, either side) are not judged. */
  canvasMinPx: 64,
  /** A pixel changed when the canvas was hidden if any channel moved by more than this. */
  canvasDelta: 8,
  /** A canvas draws nothing when hiding it changes fewer than this many pixels (a sparse starfield changes hundreds)… */
  canvasDeadPx: 100,
  /** …or it covers at least half its box in what is one flat colour (1st–99th percentile channel spread ≤ this). */
  canvasFlatSpread: 6,
  /** At most this many findings of one kind per slide. */
  maxPerKind: 6,
} as const;

const SEVERITY: Record<FindingKind, Finding["severity"]> = {
  "clipped-text": "error",
  "off-canvas": "error",
  "text-overlap": "error",
  "blank-render": "error",
  "dead-canvas": "error",
  "tiny-text": "warn",
  "low-contrast": "warn",
  "dead-step": "warn",
};

const THRESHOLDS: ProbeThresholds = { ...MEASURE, width: CANVAS.width, height: CANVAS.height };

let probeCode: Promise<string> | undefined;
/** measure-page.ts as a classic script defining `__dfMeasure` (memoised per process). */
function probeScript(): Promise<string> {
  probeCode ??= build({
    entryPoints: [join(dirname(fileURLToPath(import.meta.url)), "measure-page.ts")],
    bundle: true,
    format: "iife",
    globalName: "__dfMeasure",
    target: "es2020",
    write: false,
    logLevel: "silent",
  }).then((r) => r.outputFiles[0]!.text);
  return probeCode;
}

/** What one settled step measured: findings so far, plus per-canvas liveness for the slide-level verdict. */
export type StepMeasure = { step: number; findings: Finding[]; canvases: { selector: string; w: number; h: number; changed: number; share: number; flat: boolean }[] };

/**
 * Measures the current (settled) step of slide `id`; `png` is the screenshot just taken of it. `alive` holds the
 * selectors of canvases already seen drawing at an earlier step: they are not checked again (and gain new ones).
 */
export async function measureStep(page: Page, id: string, step: number, png: Buffer, alive = new Set<string>()): Promise<StepMeasure> {
  const code = await probeScript();
  const p = (await page.evaluate(`${code};__dfMeasure.probe(${JSON.stringify(id)}, ${JSON.stringify(THRESHOLDS)})`)) as Probe;
  const findings: Finding[] = p.findings.map((f) => ({ ...f, severity: SEVERITY[f.kind], step }));
  const img = decodePng(png);

  const edges = edgePixels(img);
  if (edges < MEASURE.blankEdgePx) {
    findings.push({
      kind: "blank-render",
      severity: "error",
      step,
      selector: `#${id}`,
      detail: `step ${step + 1} renders essentially nothing: the 1920×1080 screenshot has only ${edges} edge pixels (a flat or empty background; at least ${MEASURE.blankEdgePx} expected)`,
      measured: { edgePixels: edges, minEdgePixels: MEASURE.blankEdgePx },
    });
  }
  findings.push(...contrastFindings(img, p, step));

  const canvases: StepMeasure["canvases"] = [];
  const unproven = p.canvases.filter((c) => !alive.has(c.selector));
  if (unproven.length) {
    const idx = unproven.map((c) => c.index);
    await page.evaluate(`${code};__dfMeasure.toggleCanvases(${JSON.stringify(id)}, ${JSON.stringify(idx)}, true)`);
    // Only the region the canvases cover is shot again (a full-page shot of a 3D slide costs about a second).
    const x = Math.min(...unproven.map((c) => c.box.x));
    const y = Math.min(...unproven.map((c) => c.box.y));
    const clip = { x, y, width: Math.max(...unproven.map((c) => c.box.x + c.box.w)) - x, height: Math.max(...unproven.map((c) => c.box.y + c.box.h)) - y };
    let without: Pixels;
    try {
      without = decodePng(await page.screenshot({ type: "png", clip }));
    } finally {
      await page.evaluate(`${code};__dfMeasure.toggleCanvases(${JSON.stringify(id)}, ${JSON.stringify(idx)}, false)`);
    }
    for (const c of unproven) {
      const change = canvasChange(img, without, c.box, clip);
      canvases.push({ selector: c.selector, w: c.box.w, h: c.box.h, ...change });
      if (change.changed >= MEASURE.canvasDeadPx && !change.flat) alive.add(c.selector);
    }
  }
  return { step, findings, canvases };
}

/** Slide-level findings from every step's measurement and screenshot (deduplicated, capped per kind). */
export function slideFindings(id: string, steps: StepMeasure[], pngs: Buffer[]): Finding[] {
  const out: Finding[] = [];
  const seen = new Set<string>();
  for (const s of steps) {
    for (const f of s.findings) {
      const key = `${f.kind} ${f.selector}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(f);
    }
  }
  // A canvas is dead only when it draws nothing at every step it was visible (it may build in at a later step).
  const canvases = new Map<string, { steps: number; dead: number; flat: boolean; changed: number; share: number; w: number; h: number; first: number }>();
  for (const s of steps) {
    for (const c of s.canvases) {
      const e = canvases.get(c.selector) ?? { steps: 0, dead: 0, flat: true, changed: 0, share: 0, w: c.w, h: c.h, first: s.step };
      const dead = c.changed < MEASURE.canvasDeadPx || c.flat;
      Object.assign(e, { steps: e.steps + 1, dead: e.dead + (dead ? 1 : 0), flat: e.flat && c.flat, changed: Math.max(e.changed, c.changed), share: Math.max(e.share, c.share) });
      canvases.set(c.selector, e);
    }
  }
  for (const [selector, c] of canvases) {
    if (c.dead < c.steps) continue;
    out.push({
      kind: "dead-canvas",
      severity: "error",
      step: c.first,
      selector,
      detail: c.flat
        ? `the ${c.w}×${c.h}px canvas ${selector} paints one flat colour over ${Math.round(c.share * 100)}% of its area at every step: nothing is drawn on it (no scene, shapes or text)`
        : `the ${c.w}×${c.h}px canvas ${selector} draws nothing visible at any step: hiding it changes only ${c.changed} pixels (the 3D/2D drawing never renders)`,
      measured: { width: c.w, height: c.h, changedPixels: c.changed, flat: c.flat, steps: c.steps },
    });
  }
  for (let i = 1; i < pngs.length; i++) {
    if (pngs[i]!.equals(pngs[i - 1]!)) {
      out.push({
        kind: "dead-step",
        severity: "warn",
        step: i,
        selector: `#${id}`,
        detail: `step ${i + 1} looks exactly like step ${i} (identical screenshots): the step changes nothing visible`,
        measured: { step: i + 1, sameAs: i },
      });
    }
  }
  const count = new Map<FindingKind, number>();
  return out.filter((f) => {
    const n = (count.get(f.kind) ?? 0) + 1;
    count.set(f.kind, n);
    return n <= MEASURE.maxPerKind;
  });
}

// ---------------------------------------------------------------- pixels

const at = (img: Pixels, x: number, y: number) => (y * img.width + x) * 4;
const diff = (d: Uint8Array, i: number, e: Uint8Array, j: number) => Math.max(Math.abs(d[i]! - e[j]!), Math.abs(d[i + 1]! - e[j + 1]!), Math.abs(d[i + 2]! - e[j + 2]!));

/** Pixels that differ sharply from their right or lower neighbour: text, shapes and outlines; gradients and grain have none. */
export function edgePixels(img: Pixels): number {
  const { width, height, data } = img;
  let n = 0;
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const i = (y * width + x) * 4;
      if (diff(data, i, data, i + 4) > MEASURE.edgeDelta || diff(data, i, data, i + width * 4) > MEASURE.edgeDelta) n++;
    }
  }
  return n;
}

/**
 * How the canvas's box changes when the canvas is hidden (`b`, shot from `origin`): pixels changed, their share, and
 * whether what it painted is one flat fill.
 */
function canvasChange(a: Pixels, b: Pixels, box: Box, origin: { x: number; y: number }): { changed: number; share: number; flat: boolean } {
  let changed = 0;
  const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  const x1 = Math.min(box.x + box.w, a.width, origin.x + b.width);
  const y1 = Math.min(box.y + box.h, a.height, origin.y + b.height);
  for (let y = box.y; y < y1; y++) {
    for (let x = box.x; x < x1; x++) {
      const i = at(a, x, y);
      if (diff(a.data, i, b.data, at(b, x - origin.x, y - origin.y)) <= MEASURE.canvasDelta) continue;
      changed++;
      for (let c = 0; c < 3; c++) hist[c]![a.data[i + c]!]!++;
    }
  }
  const total = Math.max(1, (x1 - box.x) * (y1 - box.y));
  // Spread of what the canvas painted: the 1st-99th percentile range of each channel (0 for a flat fill).
  const spread = Math.max(
    ...hist.map((h) => {
      const lo = changed * 0.01;
      const hi = changed * 0.99;
      let acc = 0;
      let p1 = 0;
      let p99 = 255;
      for (let v = 0; v < 256; v++) {
        const before = acc;
        acc += h[v]!;
        if (before <= lo && acc > lo) p1 = v;
        if (before <= hi && acc > hi) p99 = v;
      }
      return p99 - p1;
    }),
  );
  return { changed, share: changed / total, flat: changed / total >= 0.5 && spread <= MEASURE.canvasFlatSpread };
}

const LIN = Array.from({ length: 256 }, (_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});
const lum = (r: number, g: number, b: number) => 0.2126 * LIN[r]! + 0.7152 * LIN[g]! + 0.0722 * LIN[b]!;
const ratio = (l1: number, l2: number) => (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
const hex = (c: number[]) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

function contrastFindings(img: Pixels, p: Probe, step: number): Finding[] {
  const out: Finding[] = [];
  const texts = [...p.texts].sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h).slice(0, MEASURE.contrastMaxTexts);
  for (const t of texts) {
    const bg = ringBackground(img, t.box);
    if (!bg) continue;
    const [r, g, b, a] = t.color;
    const fg = [r * a + bg[0]! * (1 - a), g * a + bg[1]! * (1 - a), b * a + bg[2]! * (1 - a)].map(Math.round) as [number, number, number];
    const bgL = lum(bg[0]!, bg[1]!, bg[2]!);
    const computed = ratio(lum(...fg), bgL);
    const large = t.fontPx >= MEASURE.largePx || (t.bold && t.fontPx >= MEASURE.largeBoldPx);
    const min = large ? MEASURE.contrastLarge : MEASURE.contrastNormal;
    if (computed >= min) continue;
    // Cross-check with the pixels: if some glyph pixel already reaches the minimum, the computed colour is not what
    // is painted (blend modes, shadows, a fill we can't see) and we say nothing.
    if (maxInkContrast(img, t.box, bgL) >= min) continue;
    out.push({
      kind: "low-contrast",
      severity: "warn",
      step,
      selector: t.selector,
      detail: `text "${t.text}" (${t.fontPx}px) has contrast ${computed.toFixed(1)}:1 against its background ${hex(bg)} (text ${hex(fg)}); WCAG AA needs ${min}:1`,
      measured: { ratio: Math.round(computed * 10) / 10, min, text: hex(fg), background: hex(bg), fontPx: t.fontPx },
    });
  }
  return out;
}

/**
 * Median colour of a ring just outside the box, or null when the ring is not one colour (an image, a gradient, 3D,
 * or a chip whose edge the ring crosses). Each side is sampled separately and all four must agree.
 */
function ringBackground(img: Pixels, b: Box): number[] | null {
  const { ringInnerPx: i0, ringOuterPx: o } = MEASURE;
  const sides: Box[] = [
    { x: b.x - o, y: b.y - o, w: b.w + 2 * o, h: o - i0 },
    { x: b.x - o, y: b.y + b.h + i0, w: b.w + 2 * o, h: o - i0 },
    { x: b.x - o, y: b.y - i0, w: o - i0, h: b.h + 2 * i0 },
    { x: b.x + b.w + i0, y: b.y - i0, w: o - i0, h: b.h + 2 * i0 },
  ];
  const all: number[][] = [];
  const medians: number[][] = [];
  for (const side of sides) {
    const samples: number[][] = [];
    const step = Math.max(1, Math.round(Math.max(side.w, side.h) / 200));
    for (let y = Math.max(0, side.y); y < Math.min(img.height, side.y + side.h); y += side.h > side.w ? step : 1) {
      for (let x = Math.max(0, side.x); x < Math.min(img.width, side.x + side.w); x += side.w >= side.h ? step : 1) {
        const k = at(img, x, y);
        samples.push([img.data[k]!, img.data[k + 1]!, img.data[k + 2]!]);
      }
    }
    if (samples.length < 4) continue; // this side is off the canvas
    medians.push(median(samples));
    all.push(...samples);
  }
  if (medians.length < 3) return null;
  const m = median(all);
  const close = (c: number[]) => Math.max(...c.map((v, k) => Math.abs(v - m[k]!))) <= MEASURE.ringTol;
  if (!medians.every(close)) return null;
  return all.filter(close).length / all.length >= MEASURE.ringUniform ? m : null;
}

const median = (samples: number[][]) => [0, 1, 2].map((c) => samples.map((s) => s[c]!).sort((p, q) => p - q)[samples.length >> 1]!);

function maxInkContrast(img: Pixels, b: Box, bgL: number): number {
  let best = 1;
  const step = b.w * b.h > 40_000 ? 2 : 1;
  for (let y = Math.max(0, b.y); y < Math.min(img.height, b.y + b.h); y += step) {
    for (let x = Math.max(0, b.x); x < Math.min(img.width, b.x + b.w); x += step) {
      const i = at(img, x, y);
      best = Math.max(best, ratio(lum(img.data[i]!, img.data[i + 1]!, img.data[i + 2]!), bgL));
    }
  }
  return best;
}
