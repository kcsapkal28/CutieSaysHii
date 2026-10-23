import { contrastRatio, passesAA } from "@deckforge/catalog";
import type { ThemeSpec } from "@deckforge/schemas";

type Roles = ThemeSpec["roles"];

const GRAPHIC_RATIO = 3;

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

export function mix(from: string, to: string, t: number): string {
  const b = channels(to);
  const out = channels(from).map((x, i) => Math.round(x + ((b[i] ?? x) - x) * t));
  return `#${out.map((x) => x.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

/** The first of 21 steps from `from` toward `to` that satisfies `ok`, else `to` itself. */
function firstStep(from: string, to: string, ok: (c: string) => boolean): string {
  for (let step = 0; step <= 20; step++) {
    const c = mix(from, to, step / 20);
    if (ok(c)) return c;
  }
  return to;
}

/**
 * A brand role used as a text colour: the role itself when it passes AA on bg and surface, otherwise the
 * first step toward roles.text that does (roles.text always passes, see assertContrast).
 */
export function legibleOn(roles: Roles, colour: string): string {
  return firstStep(colour, roles.text, (c) => passesAA(c, roles.bg) && passesAA(c, roles.surface));
}

/** A colour for marks, lines and nodes: ≥ 3:1 on bg and surface (WCAG 1.4.11), moving toward roles.text. */
export function graphicOn(roles: Roles, colour: string): string {
  return firstStep(
    colour,
    roles.text,
    (c) => contrastRatio(c, roles.bg) >= GRAPHIC_RATIO && contrastRatio(c, roles.surface) >= GRAPHIC_RATIO,
  );
}

/** A tinted panel fill: the first step from `colour` toward roles.bg on which text and textMuted pass AA. */
export function fillBehind(roles: Roles, colour: string): string {
  return firstStep(colour, roles.bg, (c) => passesAA(roles.text, c) && passesAA(roles.textMuted, c));
}

/** Six series colours: primary, accent, textMuted and their pairwise midpoints, each lifted to 3:1. */
export function graphicPalette(roles: Roles): string[] {
  const g1 = graphicOn(roles, roles.primary);
  const g2 = graphicOn(roles, roles.accent);
  const g3 = graphicOn(roles, roles.textMuted);
  return [g1, g2, g3, graphicOn(roles, mix(g1, g2, 0.5)), graphicOn(roles, mix(g2, g3, 0.5)), graphicOn(roles, mix(g1, g3, 0.5))];
}
