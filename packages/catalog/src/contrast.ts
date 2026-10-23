// WCAG 2.x contrast. Shared by catalog integrity checks and the renderer's theme compile.

export const AA_RATIO = 4.5;

/** Uppercase #RRGGBB; expands #RGB. Throws on anything else. */
export function normalizeHex(input: string): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim());
  if (!m?.[1]) throw new Error(`not a hex colour: "${input}"`);
  const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return `#${hex.toUpperCase()}`;
}

function luminance(hex: string): number {
  const h = normalizeHex(hex);
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

export function passesAA(fg: string, bg: string): boolean {
  return contrastRatio(fg, bg) >= AA_RATIO;
}
