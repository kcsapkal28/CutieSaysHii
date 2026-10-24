// WCAG 2.x contrast for theme palettes.
import type { Theme } from "../contract.ts";

export const HEX = /^#[0-9a-fA-F]{6}$/;

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  if (!HEX.test(hex)) throw new Error(`not a #rrggbb colour: ${hex}`);
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** AA: body text (text, muted) 4.5:1 on bg and surface; accents, used for labels and large text, 3:1 on both. */
export const CONTRAST_RULES: { fg: keyof Theme["colors"]; min: number }[] = [
  { fg: "text", min: 4.5 },
  { fg: "muted", min: 4.5 },
  { fg: "accent", min: 3 },
  { fg: "accent2", min: 3 },
  { fg: "accent3", min: 3 },
];

export type ContrastFailure = { fg: string; bg: string; ratio: number; min: number };

export function checkContrast(colors: Theme["colors"]): ContrastFailure[] {
  const failures: ContrastFailure[] = [];
  for (const { fg, min } of CONTRAST_RULES) {
    for (const bg of ["bg", "surface"] as const) {
      const ratio = contrastRatio(colors[fg], colors[bg]);
      if (ratio < min) failures.push({ fg, bg, ratio: Math.round(ratio * 100) / 100, min });
    }
  }
  return failures;
}
