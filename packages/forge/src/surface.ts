// Surface settings (corners, borders, depth, texture) -> `--df-*` CSS variables the shell kit honours.
// Client-safe: no runtime imports, so the Style Studio can use it for the live preview.
import type { Surface } from "./contract.ts";

export const SURFACE_DEFAULT: Surface = { radius: "soft", border: "hairline", depth: "flat", texture: "none" };

/** The choices for each setting, in UI order. */
export const SURFACE_CHOICES = {
  radius: ["sharp", "soft", "round"],
  border: ["none", "hairline", "bold"],
  depth: ["flat", "soft", "hard", "glass"],
  texture: ["none", "grain", "grid", "halftone"],
} as const satisfies { [K in keyof Surface]: readonly Surface[K][] };

/** Old style.json files have no surface; fill what is missing. */
export function resolveSurface(s?: Partial<Surface> | null): Surface {
  return { ...SURFACE_DEFAULT, ...(s ?? {}) };
}

// [cards and panels, chips and buttons]
const RADIUS: Record<Surface["radius"], [string, string]> = { sharp: ["0px", "0px"], soft: ["18px", "10px"], round: ["36px", "999px"] };

const BORDER: Record<Surface["border"], { w: string; color: string }> = {
  none: { w: "0px", color: "transparent" },
  hairline: { w: "1px", color: "var(--df-line)" },
  bold: { w: "3px", color: "var(--df-text)" },
};

const NO_SHADOW = "0 0 0 0 transparent";
const DEPTH: Record<Surface["depth"], { shadow: string; shadowSm: string; blur: string; panel: string }> = {
  flat: { shadow: NO_SHADOW, shadowSm: NO_SHADOW, blur: "0px", panel: "var(--df-surface)" },
  soft: {
    shadow: "0 2px 6px rgb(0 0 0 / .10), 0 28px 60px -24px rgb(0 0 0 / .45)",
    shadowSm: "0 10px 24px -10px rgb(0 0 0 / .40)",
    blur: "0px",
    panel: "var(--df-surface)",
  },
  hard: { shadow: "10px 10px 0 0 var(--df-text)", shadowSm: "5px 5px 0 0 var(--df-text)", blur: "0px", panel: "var(--df-surface)" },
  glass: {
    shadow: "inset 0 1px 0 color-mix(in oklab, var(--df-text) 16%, transparent), 0 30px 70px -28px rgb(0 0 0 / .5)",
    shadowSm: "inset 0 1px 0 color-mix(in oklab, var(--df-text) 14%, transparent)",
    blur: "20px",
    panel: "color-mix(in oklab, var(--df-surface) 55%, transparent)",
  },
};

const GRAIN_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/>" +
  "<feColorMatrix values='0 0 0 0 .5 0 0 0 0 .5 0 0 0 0 .5 0 0 0 1.4 -.35'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>";

/** Texture layer painted over the backdrop. `scale` shrinks the pattern for small swatches. */
export function textureLayer(texture: Surface["texture"], scale = 1): { image: string; size: string; opacity: string } {
  const px = (n: number) => `${Math.max(1, Math.round(n * scale * 10) / 10)}px`;
  switch (texture) {
    case "grain":
      return { image: `url("data:image/svg+xml,${encodeURIComponent(GRAIN_SVG)}")`, size: `${px(220)} ${px(220)}`, opacity: ".22" };
    // Lines and dots stay at least ~2px on the 1920 canvas so they survive the shell's downscaling.
    case "grid": {
      const w = px(2);
      return { image: `linear-gradient(var(--df-line) ${w}, transparent ${w}), linear-gradient(90deg, var(--df-line) ${w}, transparent ${w})`, size: `${px(80)} ${px(80)}`, opacity: ".75" };
    }
    case "halftone":
      return {
        image: `radial-gradient(color-mix(in oklab, var(--df-text) 16%, transparent) ${px(3)}, transparent ${px(4)})`,
        size: `${px(24)} ${px(24)}`,
        opacity: "1",
      };
    default:
      return { image: "none", size: "auto", opacity: "0" };
  }
}

/** `--df-*` declarations (without the `:root{}` wrapper) for a surface. Values come only from the tables above. */
export function surfaceDecls(input?: Partial<Surface> | null): string[] {
  const s = resolveSurface(input);
  const [r, rSm] = RADIUS[s.radius];
  const b = BORDER[s.border];
  const d = DEPTH[s.depth];
  const t = textureLayer(s.texture);
  return [
    `--df-radius:${r}`,
    `--df-radius-sm:${rSm}`,
    `--df-border-w:${b.w}`,
    `--df-border-color:${b.color}`,
    `--df-shadow:${d.shadow}`,
    `--df-shadow-sm:${d.shadowSm}`,
    `--df-blur:${d.blur}`,
    `--df-panel-bg:${d.panel}`,
    `--df-texture:${t.image}`,
    `--df-texture-size:${t.size}`,
    `--df-texture-opacity:${t.opacity}`,
  ];
}

/** The surface variables, for the builder's prompt. */
export const SURFACE_VARS = [
  "--df-radius (cards, panels)",
  "--df-radius-sm (chips, buttons)",
  "--df-border-w + --df-border-color",
  "--df-shadow (cards) / --df-shadow-sm (chips, buttons)",
  "--df-panel-bg + backdrop-filter: blur(var(--df-blur))",
] as const;
