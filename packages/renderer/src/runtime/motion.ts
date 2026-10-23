// Pure motion logic shared by the browser runtime and the tests: no GSAP, no DOM.

// Each flag is true when the template's reducedMotion string asked for that behaviour.
export type ReducedFlags = {
  same: boolean;
  fadeOnly: boolean;
  parallax: boolean;
  three: boolean;
  flicker: boolean;
  glowStatic: boolean;
  decorationsStatic: boolean;
};

const TOKEN_FLAG: Record<string, keyof ReducedFlags> = {
  same: "same",
  fadeOnly: "fadeOnly",
  "parallax off": "parallax",
  "three off": "three",
  "no flicker": "flicker",
  "glow static": "glowStatic",
  "decorations static": "decorationsStatic",
};

export function parseReducedMotion(s: string): ReducedFlags {
  const flags: ReducedFlags = {
    same: false, fadeOnly: false, parallax: false, three: false, flicker: false, glowStatic: false, decorationsStatic: false,
  };
  for (const raw of s.split(";")) {
    const token = raw.trim();
    if (!token) continue;
    const flag = Object.hasOwn(TOKEN_FLAG, token) ? TOKEN_FLAG[token] : undefined;
    if (!flag) throw new Error(`Unknown reducedMotion token "${token}"`);
    flags[flag] = true;
  }
  return flags;
}

export type SlideMotion = { transition: string; enter: string; emphasis: string; exit: string; easing: string };

export function resolveSlideMotion(m: SlideMotion, reduced: ReducedFlags | null): SlideMotion {
  if (!reduced || !reduced.fadeOnly) return m;
  const keepTransition = m.transition === "none" || m.transition === "cut";
  return {
    ...m,
    transition: keepTransition ? m.transition : "fade",
    enter: "fade",
    // The engine passes glowStatic to the preset, so a kept glow is shown without animating.
    emphasis: m.emphasis === "glow" && reduced.glowStatic ? "glow" : "none",
    exit: "fade",
  };
}

// Opacity dips used by glitch and glow: each dip is one flash, halfPeriod seconds down then halfPeriod up.
export const FLICKER = { dips: 2, halfPeriod: 0.25 } as const;

/**
 * The most flashes any 1 s window can contain (WCAG 2.3.1 allows 3). Presets chain (glitchIn on a heading, then
 * glow on its emphasis), so this is the back-to-back rate and deliberately does not stop at one preset's dips.
 */
export function flashesPerSecond(f: { dips: number; halfPeriod: number }): number {
  return Math.ceil(1 / (2 * f.halfPeriod) - 1e-9);
}

export type CountUp = { prefix: string; value: number; decimals: number; suffix: string; grouping: boolean };

const COUNT_UP = /^(\D*?)(-?)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(\D*)$/;

export function parseCountUp(text: string): CountUp | null {
  const m = COUNT_UP.exec(text.trim());
  if (!m) return null;
  const [, prefix = "", sign = "", int = "", frac = "", suffix = ""] = m;
  const value = Number(`${sign}${int.replaceAll(",", "")}${frac ? `.${frac}` : ""}`);
  return { prefix, value, decimals: frac.length, suffix, grouping: int.includes(",") };
}

export function formatCountUp(p: CountUp, value: number): string {
  const fixed = value.toFixed(p.decimals);
  const [int = "", frac] = fixed.split(".");
  const body = p.grouping ? int.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : int;
  return `${p.prefix}${body}${frac === undefined ? "" : `.${frac}`}${p.suffix}`;
}
