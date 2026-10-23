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
const PREFIX_UNITS = new Set(["$", "€", "£", "¥"]);
const COMPACT_FROM = 1e6;
const MAX_DECIMALS = 6;
const NEG_LABEL_ROOM = 40;
const COMPACT_UNITS = [1e12, 1e9, 1e6, 1e3];
const formatters = (opts: Intl.NumberFormatOptions) =>
  Array.from({ length: MAX_DECIMALS + 1 }, (_, d) => new Intl.NumberFormat("en-US", { ...opts, maximumFractionDigits: d }));
const COMPACT = formatters({ notation: "compact" });
const GROUPED = formatters({});

export type ValueFormat = { compact?: boolean; decimals?: number };

const color = (i: number) => `var(--df-graphic-${(i % SERIES) + 1})`;
const finite = (n: number) => (Number.isFinite(n) ? n : 0);
const num = (n: number) => String(Math.round(finite(n) * 100) / 100 + 0);
const textWidth = (body: string, size: number) => body.length * size * 0.6;

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

export function formatValue(v: number, unit?: string, { compact = false, decimals = compact ? 1 : 2 }: ValueFormat = {}): string {
  const n = finite(v);
  const fmt = (compact ? COMPACT : GROUPED)[Math.min(Math.max(Math.floor(decimals), 0), MAX_DECIMALS)]!;
  const digits = fmt.format(Math.abs(n));
  const sign = n < 0 && /[1-9]/.test(digits) ? "\u2212" : "";
  const u = unit?.trim() ?? "";
  if (!u) return `${sign}${digits}`;
  if (PREFIX_UNITS.has(u)) return `${sign}${u}${digits}`;
  return ATTACHED_UNITS.has(u) ? `${sign}${digits}${u}` : `${sign}${digits} ${u}`;
}

const decimalsOf = (ns: number[]) => {
  for (let d = 0; d < MAX_DECIMALS; d++) {
    if (ns.every((n) => Math.abs(n * 10 ** d - Math.round(n * 10 ** d)) < 1e-6)) return d;
  }
  return MAX_DECIMALS;
};

const inCompactUnit = (t: number) => t / (COMPACT_UNITS.find((u) => Math.abs(t) >= u) ?? 1);

const isCompact = (numbers: number[]) => Math.max(0, ...numbers.map(Math.abs)) >= COMPACT_FROM;

// Fewest decimals ≥ the floor that print every tick exactly and keep distinct values (and non-zero values vs 0) distinct.
export function labelPrecision(values: number[], compact: boolean, ticks: number[] = []): number {
  const inUnit = (ns: number[]) => (compact ? ns.map(inCompactUnit) : ns);
  const floor = Math.max(compact ? 1 : 2, Math.min(2, decimalsOf(inUnit(values))));
  const labelled = [0, ...values].sort((a, b) => a - b);
  const distinct = (decimals: number) => new Set(labelled.map((v) => formatValue(v, undefined, { compact, decimals }))).size;
  const target = labelled.filter((v, i) => i === 0 || v - labelled[i - 1]! > 1e-9 * Math.max(1, Math.abs(v))).length;
  let d = Math.max(floor, decimalsOf(inUnit(ticks)));
  while (d < MAX_DECIMALS && distinct(d) < target) d++;
  return d;
}

const fitWidth = (body: string, room: number, size: number) => {
  const chars = Array.from(body);
  const max = Math.floor(room / textWidth("x", size));
  return chars.length <= max ? body : `${chars.slice(0, Math.max(0, max - 1)).join("").trimEnd()}…`;
};

export function donutSlices(labels: string[], values: number[], max = 6): { label: string; value: number }[] {
  const slices = labels.map((label, i) => ({ label, value: finite(values[i] ?? 0) })).filter((s) => s.value > 0);
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
      const width = 28 + textWidth(e.name, 24);
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
  const compact = isCompact([...ticks, ...flat]);
  const candidates = block.kind === "bar" && values.length === 1 && n <= MAX_VALUE_LABELS ? values[0]! : [];
  const layout = (shown: number[]) => {
    const fmt: ValueFormat = { compact, decimals: labelPrecision(shown, compact, ticks) };
    const tickText = ticks.map((t) => formatValue(t, unit, fmt));
    const left = Math.max(PLOT.left, Math.ceil(Math.max(0, ...tickText.map((t) => textWidth(t, 24))) + 32));
    const slot = n > 0 ? (PLOT.right - left) / n : PLOT.right - left;
    return { tickText, left, slot, valueText: shown.map((v) => formatValue(v, unit, fmt)) };
  };
  let { tickText, left, slot, valueText } = layout(candidates);
  const direct = valueText.length > 0 && Math.max(...valueText.map((t) => textWidth(t, 24))) <= slot - 8;
  if (!direct) ({ tickText, left, slot, valueText } = layout([]));
  const bottom = PLOT.bottom - (direct && flat.some((v) => v < 0) ? NEG_LABEL_ROOM : 0);
  const lo = ticks[0]!;
  const hi = ticks[ticks.length - 1]!;
  const plotH = bottom - PLOT.top;
  const y = (v: number) => PLOT.top + ((hi - v) / (hi - lo)) * plotH;
  const y0 = y(0);

  let grid = "";
  ticks.forEach((t, i) => {
    grid += `<line x1="${left}" x2="${PLOT.right}" y1="${num(y(t))}" y2="${num(y(t))}" style="stroke:var(--df-border)" stroke-width="1"/>`;
    grid += text(left - 16, y(t) + 8, "end", 24, tickText[i]!);
  });
  grid += `<line x1="${left}" x2="${PLOT.right}" y1="${num(y0)}" y2="${num(y0)}" style="stroke:var(--df-graphic-3)" stroke-width="2"/>`;

  const xLabels = block.labels.map((l, i) => text(left + slot * (i + 0.5), PLOT.bottom + 44, "middle", 26, l)).join("");

  let plot = "";
  let labels = "";
  if (block.kind === "bar") {
    const inner = slot * 0.7;
    const barW = values.length > 0 ? inner / values.length : 0;
    values.forEach((vs, si) => {
      vs.forEach((v, i) => {
        const top = Math.min(y(v), y0);
        const height = Math.abs(y(v) - y0);
        const x = left + slot * i + (slot - inner) / 2 + barW * si;
        const w = Math.max(barW - 4, 1);
        plot += `<rect x="${num(x)}" y="${num(top)}" width="${num(w)}" height="${num(height)}" rx="4" style="fill:${color(si)}"/>`;
        if (direct) {
          const ly = v < 0 ? top + height + 32 : top - 12;
          labels += text(x + w / 2, ly, "middle", 24, valueText[i]!, "var(--df-text)", "df-value");
        }
      });
    });
  } else {
    const x = (i: number) => left + slot * (i + 0.5);
    values.forEach((vs, si) => {
      if (vs.length === 0) return;
      const pts = vs.map((v, i) => `${num(x(i))} ${num(y(v))}`);
      const line = `M${pts.join(" L")}`;
      if (block.kind === "area") {
        const wash = `${line} L${num(x(vs.length - 1))} ${num(y0)} L${num(x(0))} ${num(y0)} Z`;
        plot += `<path class="df-decor" d="${wash}" style="fill:${color(si)};fill-opacity:0.2;stroke:none"/>`;
      }
      plot += `<path d="${line}" style="fill:none;stroke:${color(si)}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>`;
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
  const legendX = 840;
  const slices = donutSlices(block.labels, values);
  const total = slices.reduce((a, s) => a + s.value, 0);
  const numbers = [...slices.map((s) => s.value), total];
  const compact = isCompact(numbers);
  const fmt: ValueFormat = { compact, decimals: labelPrecision(numbers, compact) };

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
      const row = fitWidth(`${s.label}: ${formatValue(s.value, block.unit, fmt)}`, W - legendX, 26);
      return `${swatch(legendX - 40, y - 12, 24, color(i))}${text(legendX, y + 9, "start", 26, row, "var(--df-text)")}`;
    })
    .join("");
  const totalText = formatValue(total, block.unit, fmt);
  const centreSize = Math.max(24, Math.min(40, Math.floor((inner * 2 * 0.85) / textWidth(totalText, 1))));
  const center = text(cx, cy + centreSize * 0.35, "middle", centreSize, totalText, "var(--df-text)");
  return `<g class="df-plot">${plot}</g>${center}<g class="df-legend">${rows}</g>`;
}

export function chartSvg(block: ChartBlock, opts: { title: string }): string {
  const title = escapeHtml(opts.title);
  const values = block.series.map((s) => s.values.map(finite));
  const body = block.kind === "donut" ? donut(block, values[0] ?? []) : cartesian(block, values);
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${title}" xmlns="http://www.w3.org/2000/svg"><title>${title}</title>${body}</svg>`;
}
