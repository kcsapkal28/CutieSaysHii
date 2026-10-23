import { passesAA } from "@deckforge/catalog";
import type { ThemeSpec } from "@deckforge/schemas";
import { assertSafe, UNSAFE_IN_QUOTES, UnsafeThemeValueError } from "./safe.ts";

export { UnsafeThemeValueError };

export class ThemeContrastError extends Error {
  constructor(public readonly pairs: string[]) {
    super(`theme fails WCAG AA contrast: ${pairs.join(", ")}`);
    this.name = "ThemeContrastError";
  }
}

const HEX = /^#[0-9a-f]{6}$/i;

const PAD_GAP = { low: ["8%", "2rem"], medium: ["6%", "1.5rem"], high: ["4.5%", "1rem"] } as const;
const TITLE_TRANSFORM = { sentence: "none", title: "capitalize", upper: "uppercase" } as const;

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

function mix(from: string, to: string, t: number): string {
  const b = channels(to);
  const out = channels(from).map((x, i) => Math.round(x + ((b[i] ?? x) - x) * t));
  return `#${out.map((x) => x.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

/**
 * A brand role used as a text colour: the role itself when it passes AA on bg and surface, otherwise the
 * first step toward roles.text that does (roles.text always passes, see assertContrast).
 */
export function legibleOn(roles: ThemeSpec["roles"], colour: string): string {
  for (let step = 0; step <= 20; step++) {
    const c = mix(colour, roles.text, step / 20);
    if (passesAA(c, roles.bg) && passesAA(c, roles.surface)) return c;
  }
  return roles.text;
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

  const blur = assertSafe("backdropBlur", theme.backdropBlur ?? "0px");
  const font = (field: string, name: string, fallback: string) =>
    `"${assertSafe(field, name, UNSAFE_IN_QUOTES)}", ${fallback}`;
  const [pad, gap] = PAD_GAP[theme.density];
  const upper = theme.titleCase === "upper";

  const decls: (readonly [string, string | number])[] = [
    ...colours,
    ["--df-primary-text", legibleOn(roles, roles.primary)],
    ["--df-accent-text", legibleOn(roles, roles.accent)],
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
    ["--df-backdrop-blur", blur],
    ["--df-backdrop-filter", parseFloat(blur) === 0 ? "none" : `blur(${blur})`],
    ["--df-surface-alpha", theme.surfaceAlpha ?? 1],
  ];
  return `:root {\n${decls.map(([k, v]) => `  ${k}: ${v};`).join("\n")}\n}\n`;
}
