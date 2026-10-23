import type { Block } from "@deckforge/schemas";
import { escapeHtml } from "./escape.ts";
import { sha256Bytes } from "./hash.ts";

const PALETTE = ["var(--df-primary)", "var(--df-accent)", "var(--df-text-muted)"];
const SHAPES = 6;

// No image generator is wired in, so a prompt maps to a stable abstract composition.
export function placeholderImageSvg(block: Extract<Block, { type: "Image" }>): string {
  const b = sha256Bytes(block.prompt);
  const at = (i: number) => b[i]!;
  let shapes = "";
  for (let i = 0; i < SHAPES; i++) {
    const o = i * 5;
    const x = Math.round((at(o + 1) / 255) * 960);
    const y = Math.round((at(o + 2) / 255) * 540);
    const s = 70 + Math.round((at(o + 3) / 255) * 170);
    const fill = PALETTE[at(o + 4) % PALETTE.length]!;
    const style = `fill:${fill};fill-opacity:${(0.25 + (at(o + 4) % 4) * 0.12).toFixed(2)}`;
    const kind = at(o) % 3;
    if (kind === 0) shapes += `<circle cx="${x}" cy="${y}" r="${s / 2}" style="${style}"/>`;
    else if (kind === 1) shapes += `<rect x="${x - s / 2}" y="${y - s / 2}" width="${s}" height="${s}" rx="${s / 8}" style="${style}"/>`;
    else shapes += `<polygon points="${x},${y - s / 2} ${x + s / 2},${y + s / 2} ${x - s / 2},${y + s / 2}" style="${style}"/>`;
  }
  const alt = escapeHtml(block.alt);
  return `<svg viewBox="0 0 960 540" role="img" aria-label="${alt}" xmlns="http://www.w3.org/2000/svg"><title>${alt}</title><rect width="960" height="540" style="fill:var(--df-surface)"/>${shapes}<rect x="1" y="1" width="958" height="538" style="fill:none;stroke:var(--df-border)" stroke-width="2"/></svg>`;
}
