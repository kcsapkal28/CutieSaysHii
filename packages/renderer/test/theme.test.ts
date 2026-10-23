import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { goldenChoices, passesAA, resolveTheme, type Catalog } from "@deckforge/catalog";
import { loadCatalog } from "@deckforge/catalog/node";
import type { ThemeSpec } from "@deckforge/schemas";
import { beforeAll, describe, expect, it } from "vitest";
import { compileThemeCss, ThemeContrastError, UnsafeThemeValueError } from "../src/theme/compile.ts";

let c: Catalog;
let retro: ThemeSpec;
beforeAll(async () => {
  c = await loadCatalog();
  const choices = goldenChoices(c).find((g) => g.styleFamilyId === "retro");
  if (!choices) throw new Error("no retro golden choices");
  retro = resolveTheme(c, choices);
});

const css = (patch: Partial<ThemeSpec>) => compileThemeCss({ ...retro, ...patch });
const read = (rel: string) => readFile(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("compileThemeCss", () => {
  it("emits every --df colour var from roles", () => {
    const out = compileThemeCss(retro);
    expect(out).toContain(`--df-bg: ${retro.roles.bg}`);
    expect(out).toContain(`--df-surface: ${retro.roles.surface}`);
    expect(out).toContain(`--df-text: ${retro.roles.text}`);
    expect(out).toContain(`--df-text-muted: ${retro.roles.textMuted}`);
    expect(out).toContain(`--df-primary: ${retro.roles.primary}`);
    expect(out).toContain(`--df-accent: ${retro.roles.accent}`);
    expect(out).toContain(`--df-border: ${retro.roles.border}`);
  });

  it("emits one :root block with quoted fonts, fallbacks and scale vars", () => {
    const out = compileThemeCss(retro);
    expect(out.startsWith(":root {")).toBe(true);
    expect(out.match(/:root/g)).toHaveLength(1);
    expect(out).toContain(`--df-font-display: "${retro.type.display.font}", sans-serif`);
    expect(out).toContain(`--df-font-body: "${retro.type.body.font}", sans-serif`);
    expect(out).toContain(`--df-font-mono: "${retro.type.mono.font}", monospace`);
    expect(out).toContain(`--df-scale: ${retro.type.scale}`);
    expect(out).toContain(`--df-body-lh: ${retro.type.bodyLineHeight}`);
    expect(out).toContain(`--df-display-lh: ${retro.type.displayLineHeight}`);
    expect(out).toContain(`--df-radius: ${retro.radius}`);
    expect(out).toContain(`--df-border-width: ${retro.borderWidth}`);
    expect(out).toContain(`--df-shadow: ${retro.shadow}`);
  });

  it("display tracking is in em and defaults to 0em", () => {
    const withSpacing = css({ type: { ...retro.type, display: { ...retro.type.display, letterSpacing: -0.02 } } });
    expect(withSpacing).toContain("--df-display-tracking: -0.02em");
    const bare = { font: retro.type.display.font, weights: retro.type.display.weights };
    expect(css({ type: { ...retro.type, display: bare } })).toContain("--df-display-tracking: 0em");
  });

  it("density sets pad and gap", () => {
    expect(css({ density: "low" })).toContain("--df-pad: 8%");
    expect(css({ density: "low" })).toContain("--df-gap: 2rem");
    expect(css({ density: "medium" })).toContain("--df-pad: 6%");
    expect(css({ density: "medium" })).toContain("--df-gap: 1.5rem");
    expect(css({ density: "high" })).toContain("--df-pad: 4.5%");
    expect(css({ density: "high" })).toContain("--df-gap: 1rem");
  });

  it("titleCase upper sets uppercase + 0.04em; others do not", () => {
    const upper = css({ titleCase: "upper" });
    expect(upper).toContain("--df-title-transform: uppercase");
    expect(upper).toContain("--df-title-tracking: 0.04em");
    const title = css({ titleCase: "title" });
    expect(title).toContain("--df-title-transform: capitalize");
    expect(title).toContain("--df-title-tracking: 0em");
    expect(css({ titleCase: "sentence" })).toContain("--df-title-transform: none");
  });

  it("gradients true sets a linear-gradient bg-image; false sets none", () => {
    expect(css({ gradients: true })).toContain(
      "--df-bg-image: linear-gradient(160deg, var(--df-bg), var(--df-surface))",
    );
    expect(css({ gradients: false })).toContain("--df-bg-image: none");
  });

  it("backdrop blur and surface alpha default to 0px and 1", () => {
    const base = { ...retro };
    delete base.backdropBlur;
    delete base.surfaceAlpha;
    const out = compileThemeCss(base);
    expect(out).toContain("--df-backdrop-blur: 0px");
    expect(out).toContain("--df-surface-alpha: 1");
    const set = css({ backdropBlur: "16px", surfaceAlpha: 0.55 });
    expect(set).toContain("--df-backdrop-blur: 16px");
    expect(set).toContain("--df-surface-alpha: 0.55");
  });

  // A no-op blur(0px) still forces a compositing layer, which blurs the text inside the scaled slide.
  it("backdrop filter is none without a blur and blur(<x>) with one", () => {
    expect(css({ backdropBlur: undefined })).toContain("--df-backdrop-filter: none");
    expect(css({ backdropBlur: "0px" })).toContain("--df-backdrop-filter: none");
    expect(css({ backdropBlur: "16px" })).toContain("--df-backdrop-filter: blur(16px)");
  });

  it("primary/accent text variants pass AA on bg and surface, keeping the role when it already does", () => {
    for (const g of goldenChoices(c)) {
      const { roles } = resolveTheme(c, g);
      const out = compileThemeCss(resolveTheme(c, g));
      for (const role of ["primary", "accent"] as const) {
        const value = new RegExp(`--df-${role}-text: (#[0-9A-F]{6});`).exec(out)?.[1];
        expect(value, `${g.styleFamilyId} ${role}`).toBeDefined();
        expect(passesAA(value!, roles.bg) && passesAA(value!, roles.surface), `${g.styleFamilyId} ${role}`).toBe(true);
        if (passesAA(roles[role], roles.bg) && passesAA(roles[role], roles.surface)) {
          expect(value).toBe(roles[role].toUpperCase());
        }
      }
    }
  });

  it("a role too light for text is mixed toward the text colour, not replaced by it", () => {
    const roles = { ...retro.roles, primary: "#FFFFFF" };
    const value = /--df-primary-text: (#[0-9A-F]{6});/.exec(compileThemeCss({ ...retro, roles }))?.[1];
    expect(value).toBeDefined();
    expect(passesAA(value!, roles.bg) && passesAA(value!, roles.surface)).toBe(true);
    expect(value).not.toBe(roles.text.toUpperCase());
  });

  it("compiles every golden theme and is deterministic", () => {
    for (const g of goldenChoices(c)) {
      const t = resolveTheme(c, g);
      expect(compileThemeCss(t)).toBe(compileThemeCss(t));
    }
  });

  it("throws ThemeContrastError when textMuted fails on surface", () => {
    const bad = { ...retro, roles: { ...retro.roles, textMuted: retro.roles.surface } };
    let err: unknown;
    try {
      compileThemeCss(bad);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ThemeContrastError);
    expect((err as ThemeContrastError).pairs).toContain("textMuted/surface");
  });

  it("throws UnsafeThemeValueError for shadow with CSS breakout", () => {
    let err: unknown;
    try {
      css({ shadow: "0 0 1px red; } body { display:none" });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(UnsafeThemeValueError);
    expect((err as UnsafeThemeValueError).field).toBe("shadow");
  });

  it("rejects unsafe characters in fonts, radius, blur and non-hex roles", () => {
    for (const ch of [";", "{", "}", "<", ">", "\\"]) {
      expect(() => css({ radius: `1px${ch}` })).toThrow(UnsafeThemeValueError);
    }
    expect(() => css({ type: { ...retro.type, body: { ...retro.type.body, font: 'X"; } a {' } } })).toThrow(
      UnsafeThemeValueError,
    );
    expect(() => css({ backdropBlur: "1px;" })).toThrow(UnsafeThemeValueError);
    expect(() => css({ roles: { ...retro.roles, accent: "red; }" } })).toThrow(UnsafeThemeValueError);
  });
});

describe("style sheets", () => {
  it("every catalog texture except none has a rule in textures.css", async () => {
    const text = await read("../src/styles/textures.css");
    const textures = new Set(c.styles.families.map((f) => f.tokens.texture));
    textures.delete("none");
    expect(textures.size).toBeGreaterThan(0);
    for (const v of textures) expect(text).toContain(`[data-df-texture="${v}"] .slides::before`);
  });

  it("every catalog imageTreatment has a rule in images.css", async () => {
    const text = await read("../src/styles/images.css");
    const treatments = new Set(c.styles.families.map((f) => f.tokens.imageTreatment));
    expect(treatments.size).toBeGreaterThan(0);
    for (const v of treatments) expect(text).toContain(`[data-df-image="${v}"] .df-image`);
  });

  it("textures are subtle, non-interactive overlays", async () => {
    const text = await read("../src/styles/textures.css");
    expect(text).toContain("pointer-events: none");
    for (const m of text.matchAll(/opacity:\s*([0-9.]+)/g)) expect(Number(m[1])).toBeLessThanOrEqual(0.12);
  });
});
