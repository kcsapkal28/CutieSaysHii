// Client-side mirror of the engine's themeCss(): lets the Style Studio restyle the preview iframe instantly
// without a round trip. The font list (ids, families, categories) comes from the server, which reads it from
// the engine's FONT_IDS / fontMeta.
import type { Surface, Theme } from "@deckforge/forge";
import { surfaceDecls } from "@deckforge/forge/design-styles";

export interface FontOption {
  id: string;
  family: string;
  category: string;
}

const FALLBACK: Record<string, string> = {
  monospace: "ui-monospace, SFMono-Regular, Menlo, monospace",
  serif: "Georgia, 'Times New Roman', serif",
  "sans-serif": "system-ui, -apple-system, 'Segoe UI', sans-serif",
};

export function fontStackOf(fonts: FontOption[], id: string): string {
  const f = fonts.find((x) => x.id === id);
  if (!f) return FALLBACK["sans-serif"]!;
  return `"${f.family}", ${FALLBACK[f.category] ?? "sans-serif"}`;
}

const VAR: Record<keyof Theme["colors"], string> = {
  bg: "--df-bg",
  surface: "--df-surface",
  text: "--df-text",
  muted: "--df-muted",
  line: "--df-line",
  accent: "--df-accent",
  accent2: "--df-accent-2",
  accent3: "--df-accent-3",
};

const UNSAFE = /[<>{};]|\/\*|url\s*\(|@import|expression\s*\(|\\/i;

/** The `:root{--df-*}` block for a theme and surface, same output shape as the engine's themeCss. */
export function themeVarsCss(theme: Theme, fonts: FontOption[], surface?: Partial<Surface>): string {
  const decls: string[] = [];
  for (const [k, name] of Object.entries(VAR)) {
    const v = theme.colors[k as keyof Theme["colors"]];
    if (!UNSAFE.test(v)) decls.push(`${name}:${v}`);
  }
  decls.push(`--df-font-display:${fontStackOf(fonts, theme.fonts.display)}`);
  decls.push(`--df-font-body:${fontStackOf(fonts, theme.fonts.body)}`);
  decls.push(`--df-font-mono:${fontStackOf(fonts, theme.fonts.mono)}`);
  const backdrop = theme.backdrop && !UNSAFE.test(theme.backdrop) ? theme.backdrop : "var(--df-bg)";
  decls.push(`--df-backdrop:${backdrop}`);
  decls.push(...surfaceDecls(surface));
  return `:root{${decls.join(";")}}`;
}
