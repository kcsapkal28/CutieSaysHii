// Inlines @fontsource fonts as base64 woff2 @font-face rules (latin subset only).
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

/** The @fontsource package ids the engine can inline. A theme's `fonts.*` must be one of these. */
export const FONT_IDS = [
  "fraunces",
  "ibm-plex-mono",
  "ibm-plex-sans",
  "inter",
  "inter-tight",
  "jetbrains-mono",
  "playfair-display",
  "source-serif-4",
  "space-grotesk",
  "work-sans",
] as const;
export type FontId = (typeof FONT_IDS)[number];

export const DEFAULT_WEIGHTS = [300, 400, 500, 600, 700] as const;

type FontMeta = { id: string; family: string; weights: number[]; category: string; dir: string };

const metaCache = new Map<string, FontMeta>();

export function isFontId(id: string): id is FontId {
  return (FONT_IDS as readonly string[]).includes(id);
}

/** Family name, available weights and CSS fallback category of an installed @fontsource package. */
export function fontMeta(id: string): FontMeta {
  const hit = metaCache.get(id);
  if (hit) return hit;
  if (!isFontId(id)) throw new Error(`unknown font "${id}"; available: ${FONT_IDS.join(", ")}`);
  const dir = dirname(require.resolve(`@fontsource/${id}/package.json`));
  const raw = JSON.parse(readFileSync(join(dir, "metadata.json"), "utf8")) as {
    family: string;
    weights: number[];
    category: string;
  };
  const meta = { id, family: raw.family, weights: raw.weights, category: raw.category, dir };
  metaCache.set(id, meta);
  return meta;
}

const FALLBACK: Record<string, string> = {
  monospace: "ui-monospace, SFMono-Regular, Menlo, monospace",
  serif: "Georgia, 'Times New Roman', serif",
  "sans-serif": "system-ui, -apple-system, 'Segoe UI', sans-serif",
  display: "system-ui, sans-serif",
  handwriting: "cursive",
};

/** CSS font-family stack for a font id, e.g. `"IBM Plex Sans", system-ui, …`. */
export function fontStack(id: string): string {
  const meta = fontMeta(id);
  return `"${meta.family}", ${FALLBACK[meta.category] ?? "sans-serif"}`;
}

function nearest(available: number[], want: number): number {
  return available.reduce((best, w) => (Math.abs(w - want) < Math.abs(best - want) ? w : best), available[0] ?? 400);
}

/**
 * `@font-face` rules with base64 woff2 data for each font id and each wanted weight (snapped to the nearest
 * weight the package ships). Italic faces are added only when `italic` is true.
 */
export function fontFaceCss(
  ids: string[],
  weights: readonly number[] = DEFAULT_WEIGHTS,
  opts: { italic?: boolean } = {},
): string {
  const rules: string[] = [];
  for (const id of [...new Set(ids)]) {
    const meta = fontMeta(id);
    const snapped = [...new Set(weights.map((w) => nearest(meta.weights, w)))].sort((a, b) => a - b);
    const styles = opts.italic ? ["normal", "italic"] : ["normal"];
    for (const weight of snapped) {
      for (const style of styles) {
        const file = join(meta.dir, "files", `${id}-latin-${weight}-${style}.woff2`);
        if (!existsSync(file)) continue;
        const data = readFileSync(file).toString("base64");
        rules.push(
          `@font-face{font-family:"${meta.family}";font-style:${style};font-weight:${weight};font-display:block;` +
            `src:url(data:font/woff2;base64,${data}) format("woff2");` +
            `unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,` +
            `U+2000-206F,U+20AC,U+2122,U+2190-2199,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}`,
        );
      }
    }
  }
  return rules.join("\n");
}

const KEYWORD_WEIGHT: Record<string, number> = { normal: 400, bold: 700, lighter: 300, bolder: 700 };

/**
 * The font weights a set of slide sources uses: CSS `font-weight` declarations, inline styles, and canvas
 * font strings such as `"600 22px …"`. Always includes 400. Falls back to DEFAULT_WEIGHTS when `sources` is empty.
 */
export function usedWeights(sources: string[]): number[] {
  if (sources.length === 0) return [...DEFAULT_WEIGHTS];
  const found = new Set<number>([400]);
  for (const src of sources) {
    for (const m of src.matchAll(/font-weight\s*:\s*([a-z]+|\d{3})/gi)) {
      const v = m[1]!.toLowerCase();
      const n = /^\d+$/.test(v) ? Number(v) : KEYWORD_WEIGHT[v];
      if (n) found.add(n);
    }
    for (const m of src.matchAll(/fontWeight\s*[:=]\s*["']?(\d{3})/g)) found.add(Number(m[1]));
    for (const m of src.matchAll(/["'`](?:italic\s+)?([1-9]00)\s+\d+(?:\.\d+)?px/g)) found.add(Number(m[1]));
    if (/<(?:b|strong|h[1-6])\b/i.test(src)) found.add(700);
  }
  return [...found].sort((a, b) => a - b);
}

/** True when any source uses italics (`font-style: italic`, `<em>`, `<i>`). */
export function usesItalic(sources: string[]): boolean {
  return sources.some((s) => /font-style\s*:\s*italic|<em\b|<i\b|["'`]italic\s/i.test(s));
}
