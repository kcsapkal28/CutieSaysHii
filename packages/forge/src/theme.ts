// Theme tokens -> `--df-*` CSS custom properties.
import { Theme } from "./contract.ts";
import { fontStack, isFontId, FONT_IDS } from "./fonts.ts";

export class ThemeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ThemeError";
  }
}

const COLOR_VARS = {
  bg: "--df-bg",
  surface: "--df-surface",
  text: "--df-text",
  muted: "--df-muted",
  line: "--df-line",
  accent: "--df-accent",
  accent2: "--df-accent-2",
  accent3: "--df-accent-3",
} as const;

// Values end up inside a <style> element: forbid anything that could close the rule, the element, or fetch.
const UNSAFE = /[<>{};]|\/\*|url\s*\(|@import|expression\s*\(|\\/i;

function safe(field: string, value: string): string {
  if (UNSAFE.test(value)) throw new ThemeError(`theme.${field} contains a forbidden character or construct: ${value}`);
  return value.trim();
}

/** The `--df-*` variable name for each colour token (for docs and tests). */
export const THEME_VARS = {
  colors: COLOR_VARS,
  fonts: { display: "--df-font-display", body: "--df-font-body", mono: "--df-font-mono" },
  backdrop: "--df-backdrop",
} as const;

/** Validates a theme and returns the `:root { --df-* }` block. */
export function themeCss(input: Theme): string {
  const theme = Theme.parse(input);
  const decls: string[] = [];
  for (const [key, name] of Object.entries(COLOR_VARS)) {
    decls.push(`${name}:${safe(`colors.${key}`, theme.colors[key as keyof typeof COLOR_VARS])}`);
  }
  for (const role of ["display", "body", "mono"] as const) {
    const id = theme.fonts[role];
    if (!isFontId(id)) throw new ThemeError(`theme.fonts.${role} "${id}" is not an available font: ${FONT_IDS.join(", ")}`);
    decls.push(`${THEME_VARS.fonts[role]}:${fontStack(id)}`);
  }
  const backdrop = theme.backdrop ? safe("backdrop", theme.backdrop) : "var(--df-bg)";
  decls.push(`--df-backdrop:${backdrop}`);
  return `:root{${decls.join(";")}}`;
}
