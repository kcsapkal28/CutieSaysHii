import { passesAA } from "@deckforge/catalog";
import type { ThemeSpec } from "@deckforge/schemas";
import { fillBehind, graphicPalette, legibleOn } from "./colours.ts";
import { assertSafe, UNSAFE_IN_QUOTES, UnsafeThemeValueError } from "./safe.ts";

export { legibleOn, UnsafeThemeValueError };

export class ThemeContrastError extends Error {
  constructor(public readonly pairs: string[]) {
    super(`theme fails WCAG AA contrast: ${pairs.join(", ")}`);
    this.name = "ThemeContrastError";
  }
}

const HEX = /^#[0-9a-f]{6}$/i;

const PAD_GAP = { low: ["8%", "2rem"], medium: ["6%", "1.5rem"], high: ["4.5%", "1rem"] } as const;

// rem bounds applied to the modular scale so 1080p text stays legible and titles fit the canvas.
const SIZE = { small: 1.5, caption: 1.375, title: 5.5, display: 9, stat: 12 } as const;
const STEPS = [-2, -1, 0, 1, 2, 3, 4, 5, 6, 7] as const;
const SPANS = ["title", "body", "wide", "aside"] as const;

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;
const rem = (n: number) => `${n}rem`;

/** Step `n` of the modular scale on a 2rem base, in rem rounded to 4 decimals. */
export function typeStep(ratio: number, n: number): number {
  return round4(2 * ratio ** n);
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

type Decl = readonly [string, string | number];

function typeDecls({ type, layout }: ThemeSpec): Decl[] {
  const step = (n: number) => typeStep(type.scale, n);
  const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);
  const { steps } = layout;
  const lead = step(1);
  const title = Math.min(step(steps.title), SIZE.title);
  const sizes: [string, number][] = [
    ["body", step(0)],
    ["lead", lead],
    ["small", Math.max(step(-1), SIZE.small)],
    ["caption", Math.max(step(-2), SIZE.caption)],
    ["title", title],
    ["title-m", clamp(step(steps.title - 1), lead, SIZE.title)],
    ["title-l", clamp(step(steps.title - 2), lead, SIZE.title)],
    ["display", Math.min(step(steps.display), SIZE.display)],
    ["display-m", clamp(step(steps.display - 1), title, SIZE.display)],
    ["display-l", clamp(step(steps.display - 2), title, SIZE.display)],
    ["stat", Math.min(step(steps.stat), SIZE.stat)],
  ];
  return [
    ...STEPS.map((n): Decl => [`--df-step-${n < 0 ? `n${-n}` : n}`, rem(step(n))]),
    ...sizes.map(([name, value]): Decl => [`--df-size-${name}`, rem(value)]),
  ];
}

function gridDecls({ layout: { grid } }: ThemeSpec): Decl[] {
  for (const key of SPANS) {
    if (!grid[key].every(Number.isInteger)) throw new UnsafeThemeValueError(`layout.grid.${key}`);
  }
  return [
    ...SPANS.map((key): Decl => [`--df-col-${key}`, grid[key].join(" / ")]),
    ["--df-col-main", `${grid.wide[0]} / ${grid.aside[0]}`],
  ];
}

function computedColourDecls(roles: ThemeSpec["roles"]): Decl[] {
  return [
    ["--df-primary-text", legibleOn(roles, roles.primary)],
    ["--df-accent-text", legibleOn(roles, roles.accent)],
    ...graphicPalette(roles).map((c, i): Decl => [`--df-graphic-${i + 1}`, c]),
    ["--df-fill-1", fillBehind(roles, roles.primary)],
    ["--df-fill-2", fillBehind(roles, roles.accent)],
  ];
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
  }).map(([name, value]): Decl => {
    if (!HEX.test(value)) throw new UnsafeThemeValueError(`roles.${name}`);
    return [`--df-${name}`, value];
  });
  assertContrast(roles);

  const blur = assertSafe("backdropBlur", theme.backdropBlur ?? "0px");
  const radius = assertSafe("radius", theme.radius);
  const font = (field: string, name: string, fallback: string) =>
    `"${assertSafe(field, name, UNSAFE_IN_QUOTES)}", ${fallback}`;
  const [pad, gap] = PAD_GAP[theme.density];
  const upper = theme.titleCase === "upper";

  const decls: Decl[] = [
    ...colours,
    ...computedColourDecls(roles),
    ["--df-font-display", font("type.display.font", type.display.font, "sans-serif")],
    ["--df-font-body", font("type.body.font", type.body.font, "sans-serif")],
    ["--df-font-mono", font("type.mono.font", type.mono.font, "monospace")],
    ["--df-scale", type.scale],
    ["--df-body-lh", type.bodyLineHeight],
    ["--df-display-lh", type.displayLineHeight],
    ["--df-display-tracking", `${type.display.letterSpacing ?? 0}em`],
    ...typeDecls(theme),
    ...gridDecls(theme),
    ["--df-radius", radius],
    ["--df-node-radius", parseFloat(radius) === 0 ? "0" : "50%"],
    ["--df-border-width", assertSafe("borderWidth", theme.borderWidth)],
    ["--df-shadow", assertSafe("shadow", theme.shadow)],
    ["--df-bg-image", theme.gradients ? "linear-gradient(160deg, var(--df-bg), var(--df-surface))" : "none"],
    ["--df-pad", pad],
    ["--df-gap", gap],
    ["--df-title-transform", upper ? "uppercase" : "none"],
    ["--df-title-tracking", upper ? "0.04em" : "0em"],
    ["--df-backdrop-blur", blur],
    ["--df-backdrop-filter", parseFloat(blur) === 0 ? "none" : `blur(${blur})`],
    ["--df-surface-alpha", theme.surfaceAlpha ?? 1],
  ];
  return `:root {\n${decls.map(([k, v]) => `  ${k}: ${assertSafe(k, String(v))};`).join("\n")}\n}\n`;
}
