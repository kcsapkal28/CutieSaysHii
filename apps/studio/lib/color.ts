// WCAG contrast helpers for the palette editor. Client-safe.

export function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1]!;
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function isHex(v: string): boolean {
  return parseHex(v) !== null;
}

function luminance([r, g, b]: [number, number, number]): number {
  const ch = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

export function contrast(a: string, b: string): number | null {
  const x = parseHex(a);
  const y = parseHex(b);
  if (!x || !y) return null;
  const [l1, l2] = [luminance(x), luminance(y)].sort((p, q) => q - p) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
}

export type ContrastGrade = "AAA" | "AA" | "AA large" | "Fail";

/** Grades normal-size text. Slides render body text at 26px+, so "AA large" is usable for secondary text. */
export function grade(ratio: number): ContrastGrade {
  if (ratio >= 7) return "AAA";
  if (ratio >= 4.5) return "AA";
  if (ratio >= 3) return "AA large";
  return "Fail";
}

export function isDark(hex: string): boolean {
  const c = parseHex(hex);
  return c ? luminance(c) < 0.2 : true;
}
