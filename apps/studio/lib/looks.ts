// Look presets and palette rows for the Style Studio. Client-safe.
import type { Style, Theme } from "@deckforge/forge";

export type Colors = Theme["colors"];
export const COLOR_KEYS = ["bg", "surface", "text", "muted", "line", "accent", "accent2", "accent3"] as const;
export const COLOR_LABEL: Record<(typeof COLOR_KEYS)[number], string> = {
  bg: "Background",
  surface: "Surface",
  text: "Text",
  muted: "Muted",
  line: "Line",
  accent: "Accent",
  accent2: "Accent 2",
  accent3: "Accent 3",
};

export interface Palette {
  id: string;
  name: string;
  colors: Colors;
  backdrop: string;
}

export const PALETTES: Palette[] = [
  {
    id: "nebula",
    name: "Nebula",
    colors: { bg: "#0e0c18", surface: "#18152a", text: "#f2f1f8", muted: "#9b97b0", line: "#2c2843", accent: "#40d0ff", accent2: "#8d7dff", accent3: "#ff8a5c" },
    backdrop: "radial-gradient(120% 90% at 78% 0%, #2a2150 0%, #15122a 45%, #0e0c18 100%)",
  },
  {
    id: "deep-ocean",
    name: "Deep ocean",
    colors: { bg: "#07131a", surface: "#0e1f29", text: "#e9f4f7", muted: "#8aa5b0", line: "#1d3540", accent: "#3ee0c5", accent2: "#3a9bff", accent3: "#ffc857" },
    backdrop: "radial-gradient(110% 80% at 20% 0%, #0f3140 0%, #0a1c25 50%, #07131a 100%)",
  },
  {
    id: "ember-night",
    name: "Ember night",
    colors: { bg: "#120e0c", surface: "#1d1714", text: "#f6efe9", muted: "#a8988c", line: "#352a24", accent: "#ff9d42", accent2: "#ff5e57", accent3: "#7cc6ff" },
    backdrop: "radial-gradient(100% 80% at 85% 10%, #3a1f12 0%, #1a120e 50%, #120e0c 100%)",
  },
  {
    id: "graphite-teal",
    name: "Graphite teal",
    colors: { bg: "#f7f7f4", surface: "#ffffff", text: "#1c232a", muted: "#5c6670", line: "#d8dbd4", accent: "#2e8b80", accent2: "#4a6fb5", accent3: "#d4574e" },
    backdrop: "",
  },
  {
    id: "lab-white",
    name: "Lab white",
    colors: { bg: "#fbfbfd", surface: "#ffffff", text: "#15151f", muted: "#646577", line: "#e1e1ea", accent: "#6247ff", accent2: "#00a3c4", accent3: "#f0447a" },
    backdrop: "",
  },
  {
    id: "cobalt-paper",
    name: "Cobalt paper",
    colors: { bg: "#eef0f3", surface: "#f9fafb", text: "#15181e", muted: "#5a616d", line: "#cfd4db", accent: "#1f4fd1", accent2: "#b6421a", accent3: "#0f766e" },
    backdrop: "",
  },
  {
    id: "signal",
    name: "Signal",
    colors: { bg: "#111214", surface: "#1b1c20", text: "#ffffff", muted: "#a3a6ad", line: "#2e3036", accent: "#ff4d2e", accent2: "#ffd23f", accent3: "#3ddc97" },
    backdrop: "",
  },
];

const palette = (id: string): Palette => PALETTES.find((p) => p.id === id)!;

export interface Look {
  id: string;
  name: string;
  blurb: string;
  style: Style;
}

function look(id: string, name: string, blurb: string, paletteId: string, rest: Omit<Style, "look" | "theme"> & { fonts: Theme["fonts"] }): Look {
  const p = palette(paletteId);
  const { fonts, ...style } = rest;
  return { id, name, blurb, style: { look: id, theme: { colors: { ...p.colors }, fonts, backdrop: p.backdrop }, ...style } };
}

const NO_FEATURES = { timer: false, notes: false, stepNav: false, print: false };

export const LOOKS: Look[] = [
  look("cinematic-dark", "Cinematic dark", "Deep backdrop, glowing accents, 3D hero objects.", "nebula", {
    fonts: { display: "ibm-plex-sans", body: "ibm-plex-sans", mono: "ibm-plex-mono" },
    motion: "rich",
    use3d: true,
    interactivity: 1,
    density: "airy",
    features: NO_FEATURES,
  }),
  look("clean-technical", "Clean technical", "Light canvas, crisp diagrams, hands-on simulations.", "graphite-teal", {
    fonts: { display: "inter-tight", body: "inter", mono: "jetbrains-mono" },
    motion: "subtle",
    use3d: false,
    interactivity: 2,
    density: "balanced",
    features: NO_FEATURES,
  }),
  look("editorial", "Editorial", "Serif headlines, generous margins, a calm read.", "cobalt-paper", {
    fonts: { display: "fraunces", body: "source-serif-4", mono: "ibm-plex-mono" },
    motion: "subtle",
    use3d: false,
    interactivity: 0,
    density: "airy",
    features: NO_FEATURES,
  }),
  look("bold", "Bold", "Big type, hot accents, energetic motion.", "signal", {
    fonts: { display: "space-grotesk", body: "work-sans", mono: "jetbrains-mono" },
    motion: "rich",
    use3d: false,
    interactivity: 1,
    density: "dense",
    features: NO_FEATURES,
  }),
];

export const DEFAULT_STYLE: Style = LOOKS[0]!.style;

export function cloneStyle(s: Style): Style {
  return JSON.parse(JSON.stringify(s)) as Style;
}

/** Which palette row matches the current colours, if any. */
export function matchPalette(colors: Colors): string | null {
  const hit = PALETTES.find((p) => COLOR_KEYS.every((k) => p.colors[k].toLowerCase() === colors[k].toLowerCase()));
  return hit?.id ?? null;
}
