import type { Block } from "@deckforge/schemas";
import { escapeHtml } from "./escape.ts";

type ChartBlock = Extract<Block, { type: "Chart" }>;

const W = 960;
const H = 540;
const PLOT = { left: 90, right: 930, top: 56, bottom: 456 };
const PALETTE = ["var(--df-primary)", "var(--df-accent)", "var(--df-text-muted)"];
const TICKS = 4;

const color = (i: number) => PALETTE[i % PALETTE.length]!;
const finite = (n: number) => (Number.isFinite(n) ? n : 0);
const num = (n: number) => String(Math.round(finite(n) * 100) / 100);
const text = (x: number, y: number, anchor: string, size: number, body: string, fill = "var(--df-text-muted)") =>
  `<text x="${num(x)}" y="${num(y)}" text-anchor="${anchor}" style="fill:${fill};font:${size}px var(--df-font-body)">${escapeHtml(body)}</text>`;

function legend(entries: { name: string; fill: string }[]): string {
  let x = PLOT.left;
  return entries
    .map((e) => {
      const out = `<circle cx="${x + 6}" cy="26" r="6" style="fill:${e.fill}"/>${text(x + 18, 31, "start", 16, e.name)}`;
      x += 40 + e.name.length * 9;
      return out;
    })
    .join("");
}

function cartesian(block: ChartBlock, values: number[][]): string {
  const unit = block.unit ?? "";
  const n = block.labels.length;
  const flat = values.flat();
  const lo =Math.min(0, ...flat);
  let hi = Math.max(0, ...flat);
  if (hi === lo) hi = lo + 1;
  const plotW = PLOT.right - PLOT.left;
  const plotH = PLOT.bottom - PLOT.top;
  const y = (v: number) => PLOT.top + ((hi - v) / (hi - lo)) * plotH;
  const y0 = y(0);

  let grid = "";
  for (let i = 0; i <= TICKS; i++) {
    const v = lo + ((hi - lo) * i) / TICKS;
    grid += `<line x1="${PLOT.left}" x2="${PLOT.right}" y1="${num(y(v))}" y2="${num(y(v))}" style="stroke:var(--df-border)" stroke-width="1"/>`;
    grid += text(PLOT.left - 10, y(v) + 5, "end", 16, num(v) + unit);
  }
  grid += `<line x1="${PLOT.left}" x2="${PLOT.right}" y1="${num(y0)}" y2="${num(y0)}" style="stroke:var(--df-text-muted)" stroke-width="2"/>`;

  const slot = n > 0 ? plotW / n : plotW;
  const xLabels = block.labels.map((l, i) => text(PLOT.left + slot * (i + 0.5), PLOT.bottom + 32, "middle", 18, l)).join("");

  let plot = "";
  if (block.kind === "bar") {
    const inner = slot * 0.7;
    const barW = values.length > 0 ? inner / values.length : 0;
    values.forEach((vs, si) => {
      vs.forEach((v, i) => {
        const top = Math.min(y(v), y0);
        const x = PLOT.left + slot * i + (slot - inner) / 2 + barW * si;
        plot += `<rect x="${num(x)}" y="${num(top)}" width="${num(Math.max(barW - 4, 1))}" height="${num(Math.abs(y(v) - y0))}" rx="3" style="fill:${color(si)}"/>`;
      });
    });
  } else {
    const x = (i: number) => PLOT.left + slot * (i + 0.5);
    values.forEach((vs, si) => {
      if (vs.length === 0) return;
      const pts = vs.map((v, i) => `${num(x(i))} ${num(y(v))}`);
      let d = `M${pts.join(" L")}`;
      if (block.kind === "area") d += ` L${num(x(vs.length - 1))} ${num(y0)} L${num(x(0))} ${num(y0)} Z`;
      const fill = block.kind === "area" ? `fill:${color(si)};fill-opacity:0.25` : "fill:none";
      plot += `<path d="${d}" style="${fill};stroke:${color(si)}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>`;
      vs.forEach((v, i) => {
        plot += `<circle cx="${num(x(i))}" cy="${num(y(v))}" r="5" style="fill:${color(si)}"/>`;
      });
    });
  }

  const names = block.series.length > 1 ? legend(block.series.map((s, i) => ({ name: s.name, fill: color(i) }))) : "";
  return `${grid}${xLabels}<g class="df-plot">${plot}</g>${names}`;
}

function polar(r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [r * Math.cos(a), r * Math.sin(a)];
}

function donut(block: ChartBlock, values: number[]): string {
  const cx = 330;
  const cy = 280;
  const outer = 200;
  const inner = 118;
  const slices = values.map((v) => Math.max(0, v));
  const total = slices.reduce((a, b) => a + b, 0);

  const ring = (a0: number, a1: number, fill: string, opacity: number) => {
    const sweep = Math.min(a1 - a0, 359.99);
    const [ox0, oy0] = polar(outer, a0);
    const [ox1, oy1] = polar(outer, a0 + sweep);
    const [ix1, iy1] = polar(inner, a0 + sweep);
    const [ix0, iy0] = polar(inner, a0);
    const large = sweep > 180 ? 1 : 0;
    const d = `M${num(cx + ox0)} ${num(cy + oy0)} A${outer} ${outer} 0 ${large} 1 ${num(cx + ox1)} ${num(cy + oy1)} L${num(cx + ix1)} ${num(cy + iy1)} A${inner} ${inner} 0 ${large} 0 ${num(cx + ix0)} ${num(cy + iy0)} Z`;
    return `<path d="${d}" style="fill:${fill};fill-opacity:${opacity};stroke:var(--df-bg)" stroke-width="3"/>`;
  };

  let plot = "";
  if (total <= 0) {
    plot = ring(-90, 270, "var(--df-border)", 1);
  } else {
    let angle = -90;
    slices.forEach((v, i) => {
      if (v <= 0) return;
      const sweep = (v / total) * 360;
      plot += ring(angle, angle + sweep, color(i), Math.max(1 - 0.4 * Math.floor(i / PALETTE.length), 0.3));
      angle += sweep;
    });
  }

  const unit = block.unit ?? "";
  const rows = block.labels
    .map((l, i) => {
      const y = 150 + i * 36;
      return `<circle cx="640" cy="${y - 6}" r="8" style="fill:${color(i)}"/>${text(662, y, "start", 20, `${l}: ${num(values[i] ?? 0)}${unit}`, "var(--df-text)")}`;
    })
    .slice(0, 8)
    .join("");
  const center = text(cx, cy + 10, "middle", 32, `${num(total)}${unit}`, "var(--df-text)");
  return `<g class="df-plot">${plot}</g>${center}${rows}`;
}

export function chartSvg(block: ChartBlock, opts: { title: string }): string {
  const title = escapeHtml(opts.title);
  const values = block.series.map((s) => s.values.map(finite));
  const body =
    block.kind === "donut"
      ? donut(block, values[0] ?? [])
      : cartesian(block, values);
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${title}" xmlns="http://www.w3.org/2000/svg"><title>${title}</title>${body}</svg>`;
}
