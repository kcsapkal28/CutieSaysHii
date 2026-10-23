import { passesAA } from "@deckforge/catalog";
import type { ThemeSpec } from "@deckforge/schemas";

export class ThemeContrastError extends Error {
  constructor(public readonly pairs: string[]) {
    super(`theme fails WCAG AA contrast: ${pairs.join(", ")}`);
    this.name = "ThemeContrastError";
  }
}

export class UnsafeThemeValueError extends Error {
  constructor(public readonly field: string) {
    super(`theme value "${field}" contains characters not allowed in CSS output`);
    this.name = "UnsafeThemeValueError";
  }
}

// ThemeSpec comes from an LLM: nothing that could close a declaration or block may reach the CSS.
const UNSAFE = /[;{}<>\\]/;
const UNSAFE_IN_QUOTES = /["\r\n]/;
const HEX = /^#[0-9a-f]{6}$/i;

const PAD_GAP = { low: ["8%", "2rem"], medium: ["6%", "1.5rem"], high: ["4.5%", "1rem"] } as const;
const TITLE_TRANSFORM = { sentence: "none", title: "capitalize", upper: "uppercase" } as const;

function assertSafe(field: string, value: string, extra?: RegExp): string {
  if (UNSAFE.test(value) || extra?.test(value)) throw new UnsafeThemeValueError(field);
  return value;
}

function assertContrast(roles: ThemeSpec["roles"]): void {
  const failing: string[] = [];
  for (const fg of ["text", "textMuted"] as const) {
    for (const bg of ["bg", "surface"] as const) {
      if (!passesAA(roles[fg], roles[bg])) failing.push(`${fg}/${bg}`);
    }
  }
  if (failing.length > 0) throw new ThemeContrastError(failing);
}

/** One `:root { … }` block of --df-* custom properties. Throws on unsafe values or AA failures. */
export function compileThemeCss(theme: ThemeSpec): string {
  const { roles, type } = theme;
  const colours = Object.entries({
    bg: roles.bg,
    surface: roles.surface,
    "text": roles.text,
    "text-muted": roles.textMuted,
    primary: roles.primary,
    accent: roles.accent,
    border: roles.border,
  }).map(([name, value]) => {
    if (!HEX.test(value)) throw new UnsafeThemeValueError(`roles.${name}`);
    return [`--df-${name}`, value] as const;
  });
  assertContrast(roles);

  const font = (field: string, name: string, fallback: string) =>
    `"${assertSafe(field, name, UNSAFE_IN_QUOTES)}", ${fallback}`;
  const [pad, gap] = PAD_GAP[theme.density];
  const upper = theme.titleCase === "upper";

  const decls: (readonly [string, string | number])[] = [
    ...colours,
    ["--df-font-display", font("type.display.font", type.display.font, "sans-serif")],
    ["--df-font-body", font("type.body.font", type.body.font, "sans-serif")],
    ["--df-font-mono", font("type.mono.font", type.mono.font, "monospace")],
    ["--df-scale", type.scale],
    ["--df-body-lh", type.bodyLineHeight],
    ["--df-display-lh", type.displayLineHeight],
    ["--df-display-tracking", `${type.display.letterSpacing ?? 0}em`],
    ["--df-radius", assertSafe("radius", theme.radius)],
    ["--df-border-width", assertSafe("borderWidth", theme.borderWidth)],
    ["--df-shadow", assertSafe("shadow", theme.shadow)],
    ["--df-bg-image", theme.gradients ? "linear-gradient(160deg, var(--df-bg), var(--df-surface))" : "none"],
    ["--df-pad", pad],
    ["--df-gap", gap],
    ["--df-title-transform", TITLE_TRANSFORM[theme.titleCase]],
    ["--df-title-tracking", upper ? "0.04em" : "0em"],
    ["--df-backdrop-blur", assertSafe("backdropBlur", theme.backdropBlur ?? "0px")],
    ["--df-surface-alpha", theme.surfaceAlpha ?? 1],
  ];
  return `:root {\n${decls.map(([k, v]) => `  ${k}: ${v};`).join("\n")}\n}\n`;
}
