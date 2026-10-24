import { describe, expect, it } from "vitest";
import { checkContrast } from "../src/agents/contrast.ts";
import { Style, Surface } from "../src/contract.ts";
import { applyDesignStyle, DESIGN_CATEGORIES, DESIGN_STYLES, designBrief, designStyle, isCustomised, surfaceDecls } from "../src/design-styles.ts";
import { isFontId } from "../src/fonts.ts";
import { themeCss } from "../src/theme.ts";

const OLD_STYLE = {
  look: "cinematic-dark",
  theme: {
    colors: { bg: "#0e0c18", surface: "#18152a", text: "#f2f1f8", muted: "#9b97b0", line: "#2c2843", accent: "#40d0ff", accent2: "#8d7dff", accent3: "#ff8a5c" },
    fonts: { display: "ibm-plex-sans", body: "ibm-plex-sans", mono: "ibm-plex-mono" },
    backdrop: "",
  },
  motion: "rich",
  use3d: true,
  interactivity: 1,
  density: "airy",
  features: { timer: false, notes: false, stepNav: false, print: false },
};

describe("design-style catalogue", () => {
  it("has 40-50 styles with unique ids and names, in known categories", () => {
    expect(DESIGN_STYLES.length).toBeGreaterThanOrEqual(40);
    expect(DESIGN_STYLES.length).toBeLessThanOrEqual(50);
    expect(new Set(DESIGN_STYLES.map((d) => d.id)).size).toBe(DESIGN_STYLES.length);
    expect(new Set(DESIGN_STYLES.map((d) => d.name)).size).toBe(DESIGN_STYLES.length);
    for (const d of DESIGN_STYLES) {
      expect(d.id).toMatch(/^[a-z0-9-]+$/);
      expect(DESIGN_CATEGORIES).toContain(d.category);
      expect(d.blurb.length).toBeLessThan(60);
      expect(d.prompt.length).toBeGreaterThan(200);
    }
  });

  it.each(DESIGN_STYLES.map((d) => [d.id, d] as const))("%s resolves to a valid, renderable, AA-contrast Style", (_id, d) => {
    const style = Style.parse(applyDesignStyle(Style.parse(OLD_STYLE), d));
    expect(Surface.parse(d.surface)).toEqual(d.surface);
    for (const f of Object.values(d.fonts)) expect(isFontId(f)).toBe(true);
    expect(checkContrast(d.colors)).toEqual([]);
    expect(() => themeCss(style.theme)).not.toThrow();
    expect(style.designStyle).toBe(d.id);
    expect(isCustomised(style)).toBe(false);
  });

  it("keeps 3D, interactivity and presenter features when applied", () => {
    const base = Style.parse({ ...OLD_STYLE, features: { ...OLD_STYLE.features, notes: true } });
    const s = applyDesignStyle(base, designStyle("swiss")!);
    expect(s.use3d).toBe(true);
    expect(s.interactivity).toBe(1);
    expect(s.features.notes).toBe(true);
    expect(s.theme.fonts.display).toBe("inter-tight");
  });

  it("notices customisation", () => {
    const s = applyDesignStyle(Style.parse(OLD_STYLE), designStyle("neo-brutalism")!);
    expect(isCustomised({ ...s, surface: { ...s.surface, radius: "round" } })).toBe(true);
    expect(isCustomised({ ...s, theme: { ...s.theme, colors: { ...s.theme.colors, accent: "#123456" } } })).toBe(true);
    expect(isCustomised({ ...s, use3d: false })).toBe(false);
  });
});

describe("Style schema", () => {
  it("still parses an old style.json and fills the new fields with defaults", () => {
    const s = Style.parse(OLD_STYLE);
    expect(s.designStyle).toBe("");
    expect(s.surface).toEqual({ radius: "soft", border: "hairline", depth: "flat", texture: "none" });
  });

  it("rejects unknown surface values", () => {
    expect(() => Style.parse({ ...OLD_STYLE, surface: { radius: "squircle" } })).toThrow();
  });
});

describe("surface variables", () => {
  it("emits every --df-* surface variable, with safe values", () => {
    const decls = surfaceDecls({ depth: "glass", texture: "grain" });
    for (const v of ["--df-radius", "--df-radius-sm", "--df-border-w", "--df-border-color", "--df-shadow", "--df-shadow-sm", "--df-blur", "--df-panel-bg", "--df-texture"]) {
      expect(decls.some((d) => d.startsWith(`${v}:`))).toBe(true);
    }
    for (const d of decls) expect(d).not.toMatch(/[;{}<>]|https?:/);
  });

  it("describes the chosen style and surface for the agents", () => {
    const text = designBrief({ designStyle: "blueprint", surface: { radius: "sharp", border: "hairline", depth: "flat", texture: "grid" } });
    expect(text).toMatch(/Design style: Blueprint/);
    expect(text).toMatch(/corners sharp/);
    expect(text).toMatch(/--df-radius/);
    expect(designBrief({ designStyle: "", surface: undefined as never })).toMatch(/none chosen/);
  });
});
