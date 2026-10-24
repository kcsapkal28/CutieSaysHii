// The shared contract between the engine (shell, bundler, shooter) and the agents.
// See docs/superpowers/specs/2026-10-24-deckforge-v2-design.md.
import { z } from "zod";

export const CANVAS = { width: 1920, height: 1080 } as const;
export const SLIDE_ID = /^s\d{2}$/;

export const MotionLevel = z.enum(["none", "subtle", "rich"]);
export type MotionLevel = z.infer<typeof MotionLevel>;

/** Resolved theme tokens; the shell exposes each as a `--df-*` CSS variable. */
export const Theme = z.object({
  colors: z.object({
    bg: z.string(),
    surface: z.string(),
    text: z.string(),
    muted: z.string(),
    line: z.string(),
    accent: z.string(),
    accent2: z.string(),
    accent3: z.string(),
  }),
  fonts: z.object({
    /** @fontsource package ids, e.g. "ibm-plex-sans". */
    display: z.string(),
    body: z.string(),
    mono: z.string(),
  }),
  /** Background treatment the shell paints behind every slide, e.g. a radial glow. Plain CSS `background` value or "". */
  backdrop: z.string().default(""),
});
export type Theme = z.infer<typeof Theme>;

export const Features = z.object({
  timer: z.boolean().default(false),
  notes: z.boolean().default(false),
  stepNav: z.boolean().default(false),
  print: z.boolean().default(false),
});
export type Features = z.infer<typeof Features>;

/** Corner, border, depth and texture treatment of cards, chips and controls (see surface.ts for the CSS). */
export const Surface = z.object({
  radius: z.enum(["sharp", "soft", "round"]).default("soft"),
  border: z.enum(["none", "hairline", "bold"]).default("hairline"),
  depth: z.enum(["flat", "soft", "hard", "glass"]).default("flat"),
  texture: z.enum(["none", "grain", "grid", "halftone"]).default("none"),
});
export type Surface = z.infer<typeof Surface>;

/** `style.json`: what the Style Studio (or the Stylist agent) produces. */
export const Style = z.object({
  look: z.string(),
  /** Id of the catalogue design style it started from (design-styles.ts), or "" for none. */
  designStyle: z.string().default(""),
  theme: Theme,
  motion: MotionLevel,
  use3d: z.boolean(),
  /** 0 = static, 1 = light interactions, 2 = rich simulations. */
  interactivity: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  density: z.enum(["airy", "balanced", "dense"]),
  surface: Surface.default({}),
  features: Features,
});
export type Style = z.infer<typeof Style>;

/** `deck.json`: what the bundler needs besides the slide files. */
export const DeckConfig = z.object({
  title: z.string(),
  style: Style,
  slides: z.array(
    z.object({
      id: z.string().regex(SLIDE_ID),
      title: z.string(),
      /** Optional section label for stepNav tabs. */
      section: z.string().optional(),
      /** Seconds, for the pacing timer. */
      budgetSec: z.number().int().positive().optional(),
    }),
  ),
});
export type DeckConfig = z.infer<typeof DeckConfig>;

/** One step's screenshot from shot mode. */
export type Shot = { slideId: string; step: number; png: Buffer };

/** Result of shooting a deck in a real browser. */
export type ShootResult = {
  shots: Shot[];
  /** Per-slide step counts reported by the slides' `steps`. */
  steps: Record<string, number>;
  /** Console errors, page errors and failed requests, keyed by slide id ("deck" for shell-level). */
  errors: Record<string, string[]>;
  /** Any request that left file:/data:/about: — must be empty for a self-contained deck. */
  externalRequests: string[];
};

/** Engine ports the agent pipeline depends on (implemented in bundle.ts / shoot.ts). */
export interface Engine {
  /** Writes one self-contained HTML file containing the shell, theme, fonts, libs and the given slides. */
  bundle(input: { config: DeckConfig; slides: Record<string, string>; outFile: string }): Promise<void>;
  /** Opens the deck in Chromium in shot mode and screenshots every step of the listed slides (all when omitted). */
  shoot(input: { deckFile: string; slideIds?: string[] }): Promise<ShootResult>;
}
