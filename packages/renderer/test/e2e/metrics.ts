/// <reference lib="dom" />
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Page } from "@playwright/test";
import { deckDir, type DeckKind } from "./global-setup.ts";

export type Edges = { top: number; bottom: number; left: number; right: number };
export type Frame = Edges & { width: number; height: number };
type Rgba = [number, number, number, number];

// ── Browser side ────────────────────────────────────────────────────────────────────────────────
// installMetrics serialises these into the page, so each may call only the other helpers in BROWSER.

/** Parses a computed colour. rgb()/rgba() directly; anything else (color(srgb …), oklab …) via a canvas. */
export function parseColour(css: string): Rgba {
  const m = /^rgba?\(([^)]+)\)$/.exec(css.trim());
  if (m) {
    const [r = 0, g = 0, b = 0, a = 1] = m[1]!.split(/[\s,/]+/).filter(Boolean).map(Number);
    return [r, g, b, a];
  }
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = css;
  ctx.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0, a = 0] = ctx.getImageData(0, 0, 1, 1).data;
  return [r, g, b, a / 255];
}

/** Composites `top` over `under` (which is treated as opaque). */
export function composite(top: Rgba, under: Rgba): Rgba {
  const a = top[3];
  return [0, 1, 2].map((i) => top[i]! * a + under[i]! * (1 - a)).concat(1) as Rgba;
}

/** WCAG contrast ratio of colour `a` (composited over `b` when translucent) against `b`. */
export function rgbContrast(a: string, b: string): number {
  const bg = parseColour(b);
  const fg = composite(parseColour(a), bg);
  const lum = (c: Rgba) => {
    const [r, g, bl] = [0, 1, 2].map((i) => {
      const s = c[i]! / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(fg), lum(bg)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Resolves a CSS colour expression such as `var(--df-bg)` to its computed rgb() in the deck's cascade. */
export function resolveColour(value: string): string {
  const probe = document.createElement("span");
  probe.style.color = value;
  (document.querySelector(".reveal") ?? document.body).append(probe);
  const out = getComputedStyle(probe).color;
  probe.remove();
  return out;
}

/** The colour actually behind `el`: its own and its ancestors' backgrounds composited over --df-bg. */
export function effectiveBackground(el: Element): string {
  const layers: Rgba[] = [];
  for (let n: Element | null = el; n; n = n.parentElement) {
    const c = parseColour(getComputedStyle(n).backgroundColor);
    if (c[3] > 0) layers.push(c);
    if (c[3] >= 1) break;
  }
  let out = parseColour(resolveColour("var(--df-bg)"));
  for (const layer of layers.reverse()) out = composite(layer, out);
  return `rgb(${out.slice(0, 3).map(Math.round).join(", ")})`;
}

/** Reveal scales the 1920×1080 canvas; this is screen px per slide px. */
export function slideScale(el: Element): number {
  const section = el.closest("section") as HTMLElement | null;
  return section && section.offsetWidth > 0 ? section.getBoundingClientRect().width / section.offsetWidth : 1;
}

/** The slide's content frame in screen px: the template root (or the section) minus its computed padding. */
export function safeFrame(section: Element): Frame {
  const el = section.querySelector(":scope > .df-slide") ?? section;
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const k = slideScale(section);
  const top = r.top + parseFloat(cs.paddingTop) * k;
  const bottom = r.bottom - parseFloat(cs.paddingBottom) * k;
  const left = r.left + parseFloat(cs.paddingLeft) * k;
  const right = r.right - parseFloat(cs.paddingRight) * k;
  return { top, bottom, left, right, width: right - left, height: bottom - top };
}

/** Whether `el` renders: laid out, not visibility:hidden, with a non-empty box. */
export function isShown(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return el.checkVisibility({ visibilityProperty: true }) && r.width > 0 && r.height > 0;
}

/** Union of the boxes of visible text and of svg/img/canvas inside [data-region], excluding .df-deco. */
export function contentExtent(section: Element): Edges | null {
  const rects: DOMRect[] = [];
  for (const region of section.querySelectorAll("[data-region]")) {
    if (region.closest(".df-deco")) continue;
    const walker = document.createTreeWalker(region, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const parent = n.parentElement;
      if (!n.textContent?.trim() || !parent || parent.closest("svg, .df-deco") || !isShown(parent)) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      rects.push(...range.getClientRects());
    }
    for (const el of region.querySelectorAll("img, canvas, svg")) {
      if (el.parentElement?.closest("svg") || el.closest(".df-deco") || !isShown(el)) continue;
      rects.push(el.getBoundingClientRect());
    }
  }
  const boxes = rects.filter((r) => r.width > 0 && r.height > 0);
  if (boxes.length === 0) return null;
  return {
    top: Math.min(...boxes.map((r) => r.top)),
    bottom: Math.max(...boxes.map((r) => r.bottom)),
    left: Math.min(...boxes.map((r) => r.left)),
    right: Math.max(...boxes.map((r) => r.right)),
  };
}

/** Rendered lines of text in `el`: text-fragment rects grouped by top, within half a font size. */
export function lineCount(el: Element): number {
  const tolerance = (parseFloat(getComputedStyle(el).fontSize) * slideScale(el)) / 2;
  const tops: number[] = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent?.trim()) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    for (const r of range.getClientRects()) if (r.width > 0) tops.push(r.top);
  }
  const lines: number[] = [];
  for (const t of tops) if (!lines.some((l) => Math.abs(l - t) <= tolerance)) lines.push(t);
  return lines.length;
}

/** Slide px by which glyphs may extend past their line boxes in `el`: half of (glyph box − line-height). */
export function textSpill(el: Element): number {
  const k = slideScale(el);
  let spill = 0;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const lineHeight = n.parentElement ? parseFloat(getComputedStyle(n.parentElement).lineHeight) : NaN;
    if (!n.textContent?.trim() || Number.isNaN(lineHeight)) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    for (const r of range.getClientRects()) spill = Math.max(spill, (r.height / k - lineHeight) / 2);
  }
  return spill;
}

/** Slide px of rendered text: computed font-size, times the svg's viewBox scaling for HTML inside an svg. */
export function renderedFontSize(el: Element): number {
  const size = parseFloat(getComputedStyle(el).fontSize);
  const svg = el.closest("svg");
  const vb = svg?.viewBox.baseVal;
  if (!svg || !vb || vb.width === 0) return size;
  return (size * svg.getBoundingClientRect().width) / slideScale(svg) / vb.width;
}

/** The box an svg's drawing occupies after its viewBox is fitted (meet) into the element, in screen px. */
export function drawingSize(svg: SVGSVGElement): { width: number; height: number } {
  const r = svg.getBoundingClientRect();
  const vb = svg.viewBox.baseVal;
  if (!vb || vb.width === 0 || vb.height === 0) return { width: r.width, height: r.height };
  const k = Math.min(r.width / vb.width, r.height / vb.height);
  return { width: vb.width * k, height: vb.height * k };
}

const BROWSER = {
  parseColour, composite, rgbContrast, resolveColour, effectiveBackground, slideScale, safeFrame, isShown,
  contentExtent, lineCount, textSpill, renderedFontSize, drawingSize,
};

declare global {
  interface Window {
    dfMetrics: typeof BROWSER;
  }
}

// ── Node side ───────────────────────────────────────────────────────────────────────────────────

/** Makes the helpers above available as window.dfMetrics on every page load. */
export async function installMetrics(page: Page): Promise<void> {
  const fns = Object.values(BROWSER);
  await page.addInitScript(`${fns.map(String).join("\n")}\nwindow.dfMetrics = { ${Object.keys(BROWSER).join(", ")} };`);
}

export const deckUrl = (family: string, deck: DeckKind, { motion = true, slide = 0 } = {}) =>
  `${pathToFileURL(join(deckDir(family, deck), "index.html")).href}${motion ? "" : "?df-motion=off"}#/${slide}`;

export async function waitForIdle(page: Page): Promise<void> {
  await page.waitForFunction(() => window.Reveal?.isReady() && document.documentElement.dataset.dfMotionIdle === "true");
}

/** Opens a deck with motion off and the metrics installed, fonts loaded. */
export async function openDeck(page: Page, family: string, deck: DeckKind): Promise<void> {
  await installMetrics(page);
  await page.goto(deckUrl(family, deck, { motion: false }));
  await waitForIdle(page);
  await page.evaluate(() => document.fonts.ready);
}

/** Brings the current slide to its final state: every fragment shown, every CSS transition finished, fonts loaded. */
export async function settleSlide(page: Page): Promise<void> {
  await page.evaluate(async () => {
    while (window.Reveal.nextFragment());
    // Fragments fade in through CSS transitions; finish them so nothing is measured mid-fade.
    // getAnimations() flushes style first, so transitions just started are included. Infinite ones cannot finish.
    for (const a of document.getAnimations()) if (a.effect?.getTiming().iterations !== Infinity) a.finish();
    await document.fonts.ready;
  });
}

/** Shows slide `h` in its final state. */
export async function showSlide(page: Page, h: number): Promise<void> {
  await page.evaluate((i) => window.Reveal.slide(i), h);
  await settleSlide(page);
}
