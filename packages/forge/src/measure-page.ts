/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
// The in-page half of the pre-check (measure.ts bundles this into an IIFE and evaluates it after each step settles).
// It reads the live layout of one slide: text that is cut by a clipping container or the canvas edge, controls
// beyond the canvas, text boxes that overlap, tiny text; and it lists the text (with colours) and canvases the Node
// half checks against the screenshot pixels. Coordinates are slide px (shot mode renders the stage at scale 1).

export type ProbeThresholds = {
  width: number;
  height: number;
  clipTolPx: number;
  clipTolEm: number;
  offCanvasTolPx: number;
  decorativeOpacity: number;
  overlapMinFraction: number;
  overlapMinPx: number;
  overlapInsetEm: number;
  layeringMinPx: number;
  layeringRatio: number;
  maxLineEm: number;
  bleedMinPx: number;
  minFontPx: number;
  contrastMinOpacity: number;
  canvasMinPx: number;
};

export type Box = { x: number; y: number; w: number; h: number };

export type ProbeFinding = {
  kind: "clipped-text" | "off-canvas" | "text-overlap" | "tiny-text";
  selector: string;
  detail: string;
  measured: Record<string, number | string | boolean>;
};

/** Text the Node half checks for contrast against the screenshot. `color` is the painted RGBA (0–255, a 0–1). */
export type ProbeText = { selector: string; text: string; box: Box; color: [number, number, number, number]; fontPx: number; bold: boolean };
export type ProbeCanvas = { index: number; selector: string; box: Box };
export type Probe = { findings: ProbeFinding[]; texts: ProbeText[]; canvases: ProbeCanvas[] };

type Clip = { el: Element; box: Box; x: boolean; y: boolean };
type Line = { box: Box; visible: Box | null; cut: { clip: Clip | null; side: string; px: number } | null; hiddenBy: Clip | null };
type Item = { el: Element; text: string; lines: Line[]; fontPx: number; opacity: number; decorative: boolean; bold: boolean; skewed: boolean };

const SKIP = "aside.df-notes, script, style, noscript, title, desc, defs, clipPath, mask, symbol, pattern, marker, option";
const CONTROLS = 'button, input, select, textarea, [role="button"], [role="slider"], [role="tab"]';

const r1 = (n: number) => Math.round(n * 10) / 10;
const box = (r: DOMRect | Box): Box => ("w" in r ? r : { x: r.left, y: r.top, w: r.width, h: r.height });
const area = (b: Box) => Math.max(0, b.w) * Math.max(0, b.h);
function intersect(a: Box, b: Box): Box | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.w, b.x + b.w) - x;
  const h = Math.min(a.y + a.h, b.y + b.h) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : null;
}
const union = (a: Box, b: Box): Box => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};
const snippet = (s: string) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > 48 ? `${t.slice(0, 45)}…` : t;
};

export function probe(id: string, T: ProbeThresholds): Probe {
  const section = document.getElementById(id);
  const out: Probe = { findings: [], texts: [], canvases: [] };
  if (!section) return out;
  const canvasBox: Box = { x: 0, y: 0, w: T.width, h: T.height };
  const styles = new Map<Element, CSSStyleDeclaration>();
  const style = (el: Element) => {
    let s = styles.get(el);
    if (!s) styles.set(el, (s = getComputedStyle(el)));
    return s;
  };

  function selectorOf(el: Element): string {
    const parts: string[] = [];
    let e: Element | null = el;
    for (; e && e !== section && parts.length < 4; e = e.parentElement) {
      if (e.id) {
        parts.unshift(`#${CSS.escape(e.id)}`);
        e = null;
        break;
      }
      let s = e.tagName.toLowerCase();
      const cls = [...e.classList].find((c) => !/^(is-|df-(active|on|cur|lit)$)/.test(c));
      if (cls) s += `.${CSS.escape(cls)}`;
      const parent: Element | null = e.parentElement;
      if (parent) {
        const same = [...parent.children].filter((c) => c.tagName === e!.tagName);
        if (same.length > 1) s += `:nth-of-type(${same.indexOf(e) + 1})`;
      }
      parts.unshift(s);
    }
    return `#${id}${e === section ? " > " : " "}${parts.join(" > ")}`;
  }

  // ---- colours: any CSS colour → RGBA through a 1×1 canvas (handles color-mix, oklab, named colours)
  const swatch = document.createElement("canvas");
  swatch.width = swatch.height = 1;
  const sctx = swatch.getContext("2d", { willReadFrequently: true });
  const colours = new Map<string, [number, number, number, number] | null>();
  function rgba(css: string): [number, number, number, number] | null {
    if (colours.has(css)) return colours.get(css)!;
    let v: [number, number, number, number] | null = null;
    if (sctx && css && css !== "none" && !/url\(|gradient/.test(css)) {
      sctx.clearRect(0, 0, 1, 1);
      sctx.fillStyle = "#000";
      sctx.fillStyle = css;
      sctx.fillRect(0, 0, 1, 1);
      const d = sctx.getImageData(0, 0, 1, 1).data;
      v = [d[0]!, d[1]!, d[2]!, d[3]! / 255];
    }
    colours.set(css, v);
    return v;
  }

  // ---- clipping containers of an element, innermost first (the canvas edge is the implicit last one)
  const clipCache = new Map<Element, Clip[]>();
  function clipsOf(el: Element): Clip[] {
    if (el === section || !el.parentElement) return [];
    const hit = clipCache.get(el);
    if (hit) return hit;
    const own: Clip[] = [];
    const s = style(el);
    const x = s.overflowX !== "visible";
    const y = s.overflowY !== "visible";
    if ((x || y) && !(el instanceof SVGElement && !(el instanceof SVGSVGElement))) {
      const r = el.getBoundingClientRect();
      let b = box(r);
      if (el instanceof HTMLElement && el.offsetWidth > 0 && el.offsetHeight > 0) {
        const sx = r.width / el.offsetWidth;
        const sy = r.height / el.offsetHeight;
        b = { x: r.left + el.clientLeft * sx, y: r.top + el.clientTop * sy, w: el.clientWidth * sx, h: el.clientHeight * sy };
      }
      if (b.w > 0 && b.h > 0) own.push({ el, box: b, x, y });
    }
    const list = [...own, ...clipsOf(el.parentElement)];
    clipCache.set(el, list);
    return list;
  }

  // ---- effective opacity (own paint alpha × every ancestor's opacity up to the slide list)
  function opacityOf(el: Element): number {
    let o = 1;
    for (let e: Element | null = el; e && e.id !== "df-slides"; e = e.parentElement) o *= parseFloat(style(e).opacity) || 0;
    return o;
  }
  const decorativeEl = (el: Element) => {
    const hidden = el.closest('[aria-hidden="true"], [role="presentation"]');
    return !!hidden && hidden !== section && section.contains(hidden);
  };

  /** The colour glyphs are painted in (null = not a flat colour, e.g. gradient text). */
  function paintOf(el: Element, s: CSSStyleDeclaration): [number, number, number, number] | null {
    if (el instanceof SVGElement) {
      if (s.fill && s.fill !== "none") {
        const c = rgba(s.fill);
        return c ? [c[0], c[1], c[2], c[3] * (parseFloat(s.fillOpacity) || 0)] : null;
      }
      const c = s.stroke && s.stroke !== "none" ? rgba(s.stroke) : null;
      return c ? [c[0], c[1], c[2], c[3] * (parseFloat(s.strokeOpacity) || 0)] : null;
    }
    if (/text/.test(s.backgroundClip) || /text/.test(s.getPropertyValue("-webkit-background-clip"))) return null;
    const fill = rgba(s.getPropertyValue("-webkit-text-fill-color") || s.color);
    if (fill && fill[3] === 0 && parseFloat(s.getPropertyValue("-webkit-text-stroke-width")) > 0) {
      return rgba(s.getPropertyValue("-webkit-text-stroke-color"));
    }
    return fill;
  }

  function fontPxOf(el: Element, s: CSSStyleDeclaration): number {
    const size = parseFloat(s.fontSize) || 0;
    if (el instanceof SVGGraphicsElement) {
      const m = el.getScreenCTM();
      return m ? size * Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) : size;
    }
    // The area scale of every transform on the way up (rotation leaves it at 1): det of a product = product of dets.
    let det = 1;
    for (let e: Element | null = el; e; e = e.parentElement) {
      const cs = style(e);
      if (cs.transform && cs.transform !== "none") {
        const m = new DOMMatrix(cs.transform);
        det *= Math.abs(m.a * m.d - m.b * m.c);
      }
      if (cs.scale && cs.scale !== "none") {
        const [x = 1, y = x] = cs.scale.split(/\s+/).map(Number);
        det *= Math.abs(x * y);
      }
    }
    return Number.isFinite(det) && det > 0 ? size * Math.sqrt(det) : size;
  }

  // ---- walk the slide's text
  const items = new Map<Element, Item>();
  const walker = document.createTreeWalker(section, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.textContent ?? "";
    if (!text.trim()) continue;
    const el = n.parentElement;
    if (!el || el.closest(SKIP)) continue;
    let item = items.get(el);
    if (!item) {
      if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
      const s = style(el);
      const paint = paintOf(el, s);
      const opacity = opacityOf(el) * (paint ? paint[3] || 0 : 1);
      if (opacity < 0.05) continue;
      item = { el, text: "", lines: [], fontPx: fontPxOf(el, s), opacity, decorative: decorativeEl(el), bold: (parseInt(s.fontWeight, 10) || 400) >= 600, skewed: false };
      items.set(el, item);
      if (el instanceof SVGElement) {
        const b = box(el.getBoundingClientRect());
        if (b.w > 0 && b.h > 0) item.lines.push({ box: b, visible: null, cut: null, hiddenBy: null });
      }
    }
    item.text += text;
    if (!(el instanceof SVGElement)) {
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) if (r.width >= 1 && r.height >= 1) item.lines.push({ box: box(r), visible: null, cut: null, hiddenBy: null });
    }
  }

  // ---- clipping: follow every line out through its clipping containers to the canvas edge
  for (const item of items.values()) {
    const clips = [...clipsOf(item.el), { el: section, box: canvasBox, x: true, y: true } as Clip];
    // Line boxes are a little larger than the ink (line gap, trailing letter-spacing, side bearings).
    const tolX = Math.max(T.clipTolPx, T.clipTolEm * item.fontPx);
    const tolY = tolX;
    for (const line of item.lines) {
      let v: Box | null = line.box;
      for (const c of clips) {
        if (!v) break;
        const b: Box = { x: c.x ? c.box.x : -1e9, y: c.y ? c.box.y : -1e9, w: c.x ? c.box.w : 2e9, h: c.y ? c.box.h : 2e9 };
        const next = intersect(v, b);
        if (!next) {
          line.hiddenBy = c;
          v = null;
          break;
        }
        if (!line.cut) {
          const over: [string, number, number][] = [
            ["left", b.x - v.x, tolX],
            ["right", v.x + v.w - (b.x + b.w), tolX],
            ["top", b.y - v.y, tolY],
            ["bottom", v.y + v.h - (b.y + b.h), tolY],
          ];
          const worst = over.reduce((m, o) => (o[1] - o[2] > m[1] - m[2] ? o : m));
          if (worst[1] > worst[2]) line.cut = { clip: c, side: worst[0], px: worst[1] };
        }
        v = next;
      }
      const lineH = Math.max(1, line.box.h);
      line.visible = v && v.w >= 2 && v.h >= 0.3 * lineH ? v : null;
    }
  }

  // Rotated, vertical or on-a-path text: its axis-aligned boxes are far taller than a line of its font, and would
  // overlap neighbours that it doesn't touch (e.g. 45° axis labels). Box-based checks leave it alone.
  for (const item of items.values()) item.skewed = item.fontPx > 0 && item.lines.some((l) => l.box.h > T.maxLineEm * item.fontPx);
  const visibleItems = [...items.values()].filter((i) => i.lines.some((l) => l.visible) && !i.skewed);
  for (const item of visibleItems) {
    // Faint, aria-hidden or display-size type (a giant numeral bleeding off the edge or cropped by its card) is a
    // deliberate graphic, not copy that got cut.
    if (item.decorative || item.opacity < T.decorativeOpacity || item.fontPx >= T.bleedMinPx) continue;
    const cutLine = item.lines.find((l) => l.cut && l.visible);
    // Whole lines hidden below/after visible ones = text that doesn't fit. When the first line is hidden too, the
    // text was moved on purpose (a rolling counter, a ticker, a scrolled log), so only cut lines count.
    const hidden = item.lines[0]?.visible ? item.lines.find((l) => l.hiddenBy) : undefined;
    const clip = cutLine?.cut?.clip ?? hidden?.hiddenBy;
    if (!clip) continue;
    const onCanvas = clip.el === section;
    const shown = item.lines.filter((l) => l.visible).length;
    const lost = item.lines.length - shown;
    const sel = selectorOf(item.el);
    const what = `text "${snippet(item.text)}"`;
    if (onCanvas) {
      const px = cutLine?.cut ? Math.round(cutLine.cut.px) : 0;
      const side = cutLine?.cut?.side ?? "bottom";
      out.findings.push({
        kind: "off-canvas",
        selector: sel,
        detail: cutLine?.cut
          ? `${what} runs ${px}px past the ${side} edge of the 1920×1080 canvas and is cut off`
          : `${lost} of ${item.lines.length} lines of ${what} fall outside the 1920×1080 canvas`,
        measured: { overflowPx: px, side, lines: item.lines.length, hiddenLines: lost },
      });
    } else {
      const csel = selectorOf(clip.el);
      const ov = style(clip.el);
      const px = cutLine?.cut ? Math.round(cutLine.cut.px) : 0;
      out.findings.push({
        kind: "clipped-text",
        selector: sel,
        detail: cutLine?.cut
          ? `${what} is cut off by its container ${csel} (overflow: ${ov.overflowX === ov.overflowY ? ov.overflowX : `${ov.overflowX} ${ov.overflowY}`}): it extends ${px}px past the container's ${cutLine.cut.side} edge (container is ${Math.round(clip.box.w)}×${Math.round(clip.box.h)}px)`
          : `${lost} of ${item.lines.length} lines of ${what} are hidden by its container ${csel} (overflow hidden, ${Math.round(clip.box.w)}×${Math.round(clip.box.h)}px): the text does not fit`,
        measured: { overflowPx: px, side: cutLine?.cut?.side ?? "bottom", container: csel, containerW: Math.round(clip.box.w), containerH: Math.round(clip.box.h), lines: item.lines.length, hiddenLines: lost },
      });
    }
  }

  // ---- controls beyond the canvas
  for (const el of section.querySelectorAll(CONTROLS)) {
    if (decorativeEl(el) || !el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) || opacityOf(el) < T.decorativeOpacity) continue;
    const b = box(el.getBoundingClientRect());
    if (b.w < 1 || b.h < 1 || !intersect(b, canvasBox)) continue;
    const over = { left: -b.x, top: -b.y, right: b.x + b.w - T.width, bottom: b.y + b.h - T.height };
    const side = (Object.keys(over) as (keyof typeof over)[]).reduce((m, k) => (over[k] > over[m] ? k : m), "left");
    if (over[side] > T.offCanvasTolPx) {
      out.findings.push({
        kind: "off-canvas",
        selector: selectorOf(el),
        detail: `the control ${selectorOf(el)} runs ${Math.round(over[side])}px past the ${side} edge of the 1920×1080 canvas`,
        measured: { overflowPx: Math.round(over[side]), side },
      });
    }
  }

  // ---- overlapping text (ink boxes approximated by insetting each line box vertically)
  const solid = visibleItems.filter((i) => !i.decorative && i.opacity >= T.decorativeOpacity);
  const inked = solid.map((i) => {
    const inset = T.overlapInsetEm * i.fontPx;
    const boxes = i.lines.flatMap((l) => (l.visible && l.visible.h - 2 * inset > 1 ? [{ ...l.visible, y: l.visible.y + inset, h: l.visible.h - 2 * inset }] : []));
    const all = boxes.reduce<Box | null>((u, b) => (u ? union(u, b) : b), null);
    return { item: i, boxes, all };
  });
  for (let a = 0; a < inked.length; a++) {
    for (let b = a + 1; b < inked.length; b++) {
      const A = inked[a]!;
      const B = inked[b]!;
      if (!A.all || !B.all || !intersect(A.all, B.all)) continue;
      if (A.item.el.contains(B.item.el) || B.item.el.contains(A.item.el)) continue;
      // Display-size type behind much smaller text is layering (a big numeral or word under a label), not a collision.
      const big = Math.max(A.item.fontPx, B.item.fontPx);
      if (big >= T.layeringMinPx && big >= T.layeringRatio * Math.min(A.item.fontPx, B.item.fontPx)) continue;
      let best: { frac: number; box: Box } | null = null;
      for (const ba of A.boxes) {
        for (const bb of B.boxes) {
          const x = intersect(ba, bb);
          if (!x || x.w < T.overlapMinPx || x.h < T.overlapMinPx) continue;
          const frac = area(x) / Math.min(area(ba), area(bb));
          if (!best || frac > best.frac) best = { frac, box: x };
        }
      }
      if (!best || best.frac < T.overlapMinFraction) continue;
      const sa = selectorOf(A.item.el);
      const sb = selectorOf(B.item.el);
      out.findings.push({
        kind: "text-overlap",
        selector: `${sa} | ${sb}`,
        detail: `text "${snippet(A.item.text)}" (${sa}) and text "${snippet(B.item.text)}" (${sb}) overlap: ${Math.round(best.box.w)}×${Math.round(best.box.h)}px at x=${Math.round(best.box.x)}, y=${Math.round(best.box.y)} (${Math.round(best.frac * 100)}% of the smaller one)`,
        measured: { x: Math.round(best.box.x), y: Math.round(best.box.y), w: Math.round(best.box.w), h: Math.round(best.box.h), fraction: r1(best.frac) },
      });
    }
  }

  // ---- tiny text (rotated text included)
  for (const item of items.values()) {
    if (item.decorative || item.opacity < T.decorativeOpacity || !item.lines.some((l) => l.visible)) continue;
    if (item.fontPx > 0 && item.fontPx < T.minFontPx) {
      out.findings.push({
        kind: "tiny-text",
        selector: selectorOf(item.el),
        detail: `text "${snippet(item.text)}" renders at ${r1(item.fontPx)}px, below the ${T.minFontPx}px minimum for a 1920×1080 slide`,
        measured: { fontPx: r1(item.fontPx), minPx: T.minFontPx },
      });
    }
  }

  // ---- the text list for the contrast check (Node compares it with the screenshot)
  for (const { item, all } of inked) {
    if (!all || item.opacity < T.contrastMinOpacity) continue;
    const paint = paintOf(item.el, style(item.el));
    if (!paint) continue;
    const u = item.lines.flatMap((l) => (l.visible ? [l.visible] : [])).reduce(union);
    out.texts.push({
      selector: selectorOf(item.el),
      text: snippet(item.text),
      box: { x: Math.round(u.x), y: Math.round(u.y), w: Math.round(u.w), h: Math.round(u.h) },
      color: [paint[0], paint[1], paint[2], Math.round(item.opacity * 100) / 100],
      fontPx: r1(item.fontPx),
      bold: item.bold,
    });
  }

  // ---- canvases big enough to judge, visible and on the canvas
  section.querySelectorAll("canvas").forEach((el, index) => {
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) || opacityOf(el) < T.decorativeOpacity) return;
    const b = intersect(box(el.getBoundingClientRect()), canvasBox);
    if (!b || b.w < T.canvasMinPx || b.h < T.canvasMinPx) return;
    out.canvases.push({ index, selector: selectorOf(el), box: { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) } });
  });
  return out;
}

/** Hides (or restores) the given canvases of a slide, for the "does it draw anything" comparison. */
export function toggleCanvases(id: string, indexes: number[], hide: boolean): void {
  const list = document.getElementById(id)?.querySelectorAll("canvas");
  if (!list) return;
  const w = window as unknown as { __dfMeasureVis?: Map<number, string> };
  if (hide) w.__dfMeasureVis = new Map();
  for (const i of indexes) {
    const el = list[i];
    if (!el) continue;
    if (hide) {
      w.__dfMeasureVis!.set(i, el.style.visibility);
      el.style.visibility = "hidden";
    } else el.style.visibility = w.__dfMeasureVis?.get(i) ?? "";
  }
}
