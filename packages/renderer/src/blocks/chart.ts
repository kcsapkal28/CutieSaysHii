import type { Block } from "@deckforge/schemas";
import { escapeHtml } from "./escape.ts";

type ChartBlock = Extract<Block, { type: "Chart" }>;

const W = 1600;
const H = 640;
const PLOT = { left: 150, right: 1570, top: 80, bottom: 560 };
const SERIES = 6;
const MAX_VALUE_LABELS = 8;
const STEPS = [1, 2, 2.5, 5];
const ATTACHED_UNITS = new Set(["%", "°", "′", "″"]);
const GROUPED = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

const color = (i: number) => `var(--df-graphic-${(i % SERIES) + 1})`;
const finite = (n: number) => (Number.isFinite(n) ? n : 0);
const num = (n: number) => String(Math.round(finite(n) * 100) / 100 + 0);

function text(x: number, y: number, anchor: string, size: number, body: string, fill = "var(--df-text-muted)", cls = "") {
  const attr = cls ? ` class="${cls}"` : "";
  return `<text${attr} x="${num(x)}" y="${num(y)}" text-anchor="${anchor}" style="fill:${fill};font:${size}px var(--df-font-body)">${escapeHtml(body)}</text>`;
}

const swatch = (x: number, y: number, size: number, fill: string) =>
  `<rect x="${num(x)}" y="${num(y)}" width="${size}" height="${size}" rx="4" style="fill:${fill}"/>`;

export function niceTicks(lo: number, hi: number, maxIntervals = 5): number[] {
  lo = finite(lo);
  hi = finite(hi);
  if (lo > hi) [lo, hi] = [hi, lo];
  if (hi === lo) hi = lo + (Math.abs(lo) || 1);
  if (!Number.isFinite(hi - lo)) return [lo, hi];
  const limit = Math.max(1, Math.floor(maxIntervals));
  const eps = 1e-9;
  for (let k = Math.floor(Math.log10((hi - lo) / limit)) - 1; ; k++) {
    for (const m of STEPS) {
      const step = k < 0 ? m / 10 ** -k : m * 10 ** k;
      const first = Math.floor(lo / step + eps);
      const last = Math.ceil(hi / step - eps);
      if (last - first > limit) continue;
      const decimals = Math.max(0, -k) + (m === 2.5 ? 1 : 0);
      const ticks: number[] = [];
      for (let i = first; i <= last; i++) ticks.push(Number((i * step).toFixed(decimals)) + 0);
      return ticks;
    }
  }
}

export function formatValue(v: number, unit?: string): string {
  const rounded = Math.round(finite(v) * 100) / 100;
  const digits = GROUPED.format(Math.abs(rounded));
  const value = rounded < 0 ? `−${digits}` : digits;
  if (!unit) return value;
  return ATTACHED_UNITS.has(unit) ? `${value}${unit}` : `${value} ${unit}`;
}

export function donutSlices(labels: string[], values: number[], max = 6): { label: string; value: number }[] {
  const slices = labels.map((label, i) => ({ label, value: values[i] ?? 0 }));
  if (slices.length <= max) return slices;
  const sorted = [...slices].sort((a, b) => b.value - a.value);
  const rest = sorted.slice(max - 1).reduce((sum, s) => sum + s.value, 0);
  return [...sorted.slice(0, max - 1), { label: "Other", value: rest }];
}

function legend(entries: { name: string; fill: string }[]): string {
  let x = PLOT.right;
  const items = entries
    .slice()
    .reverse()
    .map((e) => {
      const width = 28 + e.name.length * 13;
      x -= width;
      const out = `${swatch(x, 24, 18, e.fill)}${text(x + 28, 41, "start", 24, e.name)}`;
      x -= 32;
      return out;
    })
    .reverse();
  return `<g class="df-legend">${items.join("")}</g>`;
}

function cartesian(block: ChartBlock, values: number[][]): string {
  const unit = block.unit;
  const n = block.labels.length;
  const flat = values.flat();
  const ticks = niceTicks(Math.min(0, ...flat), Math.max(0, ...flat));
  const lo = ticks[0]!;
  const hi = ticks[ticks.length - 1]!;
  const plotW = PLOT.right - PLOT.left;
  const plotH = PLOT.bottom - PLOT.top;
  const y = (v: number) => PLOT.top + ((hi - v) / (hi - lo)) * plotH;
  const y0 = y(0);

  let grid = "";
  for (const t of ticks) {
    grid += `<line x1="${PLOT.left}" x2="${PLOT.right}" y1="${num(y(t))}" y2="${num(y(t))}" style="stroke:var(--df-border)" stroke-width="1"/>`;
    grid += text(PLOT.left - 16, y(t) + 8, "end", 24, formatValue(t, unit));
  }
  grid += `<line x1="${PLOT.left}" x2="${PLOT.right}" y1="${num(y0)}" y2="${num(y0)}" style="stroke:var(--df-graphic-3)" stroke-width="2"/>`;

  const slot = n > 0 ? plotW / n : plotW;
  const xLabels = block.labels.map((l, i) => text(PLOT.left + slot * (i + 0.5), PLOT.bottom + 44, "middle", 26, l)).join("");

  let plot = "";
  let labels = "";
  if (block.kind === "bar") {
    const inner = slot * 0.7;
    const barW = values.length > 0 ? inner / values.length : 0;
    const direct = values.length === 1 && n <= MAX_VALUE_LABELS;
    values.forEach((vs, si) => {
      vs.forEach((v, i) => {
        const top = Math.min(y(v), y0);
        const height = Math.abs(y(v) - y0);
        const x = PLOT.left + slot * i + (slot - inner) / 2 + barW * si;
        const w = Math.max(barW - 4, 1);
        plot += `<rect x="${num(x)}" y="${num(top)}" width="${num(w)}" height="${num(height)}" rx="4" style="fill:${color(si)}"/>`;
        if (direct) {
          const ly = v < 0 ? top + height + 32 : top - 12;
          labels += text(x + w / 2, ly, "middle", 24, formatValue(v, unit), "var(--df-text)", "df-value");
        }
      });
    });
  } else {
    const x = (i: number) => PLOT.left + slot * (i + 0.5);
    values.forEach((vs, si) => {
      if (vs.length === 0) return;
      const pts = vs.map((v, i) => `${num(x(i))} ${num(y(v))}`);
      let d = `M${pts.join(" L")}`;
      if (block.kind === "area") d += ` L${num(x(vs.length - 1))} ${num(y0)} L${num(x(0))} ${num(y0)} Z`;
      const fill = block.kind === "area" ? `fill:${color(si)};fill-opacity:0.2` : "fill:none";
      plot += `<path d="${d}" style="${fill};stroke:${color(si)}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>`;
      vs.forEach((v, i) => {
        plot += `<circle cx="${num(x(i))}" cy="${num(y(v))}" r="6" style="fill:${color(si)}"/>`;
      });
    });
  }

  const names = block.series.length > 1 ? legend(block.series.map((s, i) => ({ name: s.name, fill: color(i) }))) : "";
  return `${grid}${xLabels}<g class="df-plot">${plot}</g>${labels}${names}`;
}

function polar(r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [r * Math.cos(a), r * Math.sin(a)];
}

function donut(block: ChartBlock, values: number[]): string {
  const cx = 420;
  const cy = 320;
  const outer = 260;
  const inner = 156;
  const slices = donutSlices(block.labels, values.map((v) => Math.max(0, v)));
  const total = slices.reduce((a, s) => a + s.value, 0);

  const ring = (a0: number, a1: number, fill: string) => {
    const sweep = Math.min(a1 - a0, 359.99);
    const [ox0, oy0] = polar(outer, a0);
    const [ox1, oy1] = polar(outer, a0 + sweep);
    const [ix1, iy1] = polar(inner, a0 + sweep);
    const [ix0, iy0] = polar(inner, a0);
    const large = sweep > 180 ? 1 : 0;
    const d = `M${num(cx + ox0)} ${num(cy + oy0)} A${outer} ${outer} 0 ${large} 1 ${num(cx + ox1)} ${num(cy + oy1)} L${num(cx + ix1)} ${num(cy + iy1)} A${inner} ${inner} 0 ${large} 0 ${num(cx + ix0)} ${num(cy + iy0)} Z`;
    return `<path d="${d}" style="fill:${fill};stroke:var(--df-bg)" stroke-width="3"/>`;
  };

  let plot = "";
  if (total <= 0) {
    plot = ring(-90, 270, "var(--df-border)");
  } else {
    let angle = -90;
    slices.forEach((s, i) => {
      if (s.value <= 0) return;
      const sweep = (s.value / total) * 360;
      plot += ring(angle, angle + sweep, color(i));
      angle += sweep;
    });
  }

  const rowH = 56;
  const firstY = cy - ((slices.length - 1) * rowH) / 2;
  const rows = slices
    .map((s, i) => {
      const y = firstY + i * rowH;
      return `${swatch(800, y - 12, 24, color(i))}${text(840, y + 9, "start", 26, `${s.label}: ${formatValue(s.value, block.unit)}`, "var(--df-text)")}`;
    })
    .join("");
  const center = text(cx, cy + 14, "middle", 40, formatValue(total, block.unit), "var(--df-text)");
  return `<g class="df-plot">${plot}</g>${center}<g class="df-legend">${rows}</g>`;
}

export function chartSvg(block: ChartBlock, opts: { title: string }): string {
  const title = escapeHtml(opts.title);
  const values = block.series.map((s) => s.values.map(finite));
  const body = block.kind === "donut" ? donut(block, values[0] ?? []) : cartesian(block, values);
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${title}" xmlns="http://www.w3.org/2000/svg"><title>${title}</title>${body}</svg>`;
}
