import type { Block } from "@deckforge/schemas";
import { escapeHtml } from "./escape.ts";
import { sha256Bytes } from "./hash.ts";

type ImageBlock = Extract<Block, { type: "Image" }>;

const W = 1600;
const H = 900;
// Rule-of-thirds intersections of the 1600×900 canvas, rounded to whole units.
const THIRDS_X = [533, 1067] as const;
const THIRDS_Y = [300, 600] as const;
const BAND_FILLS = ["var(--df-graphic-2)", "var(--df-fill-2)"] as const;

const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const round = (n: number, places = 0) => Number(n.toFixed(places));

/** The accessible name: the alt, else the prompt it was generated from; never empty or whitespace. */
export function imageAlt(block: ImageBlock): string {
  return squash(block.alt) || squash(block.prompt) || "Illustration";
}

/** A landscape layer whose top edge is a shallow curve, filled down to the bottom edge. */
function band(top: number, tilt: number, sag: number, fill: string, opacity: number): string {
  const d = `M0 ${top - tilt} Q${W / 2} ${top + sag} ${W} ${top + tilt} V${H} H0 Z`;
  return `<path class="df-img-band" d="${d}" style="fill:${fill};fill-opacity:${opacity.toFixed(2)}"/>`;
}

// No image generator is wired in, so a prompt maps to a stable abstract poster: a tinted sky, one focal circle on a
// thirds intersection and 2–3 horizon bands. Every choice comes from the prompt's hash, every colour from a theme
// variable, and ids carry the hash so two images on one page never share a gradient.
export function placeholderImageSvg(block: ImageBlock): string {
  const b = sha256Bytes(block.prompt);
  const at = (i: number) => b[i]! / 255;
  const id = `df-img-${Array.from(b.subarray(0, 4), (x) => x.toString(16).padStart(2, "0")).join("")}`;

  // Sky: a mostly vertical gradient tilted up to ±30°.
  const angle = ((60 + at(4) * 60) * Math.PI) / 180;
  const [dx, dy] = [Math.cos(angle) / 2, Math.sin(angle) / 2];
  const sky =
    `<linearGradient id="${id}-sky" x1="${round(0.5 - dx, 4)}" y1="${round(0.5 - dy, 4)}" x2="${round(0.5 + dx, 4)}" y2="${round(0.5 + dy, 4)}">` +
    `<stop offset="0" style="stop-color:var(--df-surface)"/><stop offset="1" style="stop-color:var(--df-fill-1)"/></linearGradient>`;

  const cx = THIRDS_X[b[5]! % 2]!;
  const cy = THIRDS_Y[b[6]! % 2]!;
  const r = 160 + Math.round(at(7) * 100);
  const focal = `<circle cx="${cx}" cy="${cy}" r="${r}" style="fill:var(--df-graphic-1)"/>`;

  // The horizon sits between 520 and 640, so a low focal circle sinks behind it and a high one floats above.
  const count = 2 + (b[8]! % 2);
  const horizon = 520 + Math.round(at(9) * 120);
  const spacing = 60 + Math.round(at(10) * 40);
  const first = b[11]! % 2;
  let bands = "";
  for (let i = 0; i < count; i++) {
    const tilt = Math.round((at(12 + i) - 0.5) * 60);
    const sag = Math.round((at(15 + i) - 0.5) * 80);
    const opacity = 0.35 + at(18 + i) * 0.45;
    bands += band(horizon + i * spacing, tilt, sag, BAND_FILLS[(first + i) % 2]!, opacity);
  }

  const alt = escapeHtml(imageAlt(block));
  return (
    `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${alt}" xmlns="http://www.w3.org/2000/svg">` +
    `<title>${alt}</title><defs>${sky}</defs>` +
    `<rect width="${W}" height="${H}" style="fill:url(#${id}-sky)"/>${focal}${bands}</svg>`
  );
}
