import { ThemeSpecSchema } from "@deckforge/schemas";
import type { Choices } from "@deckforge/schemas";
import { beforeAll, describe, expect, it } from "vitest";
import { getPalette } from "../src/accessors.ts";
import { defaultsForFamily, goldenChoices } from "../src/compat.ts";
import type { Catalog } from "../src/files.ts";
import { loadCatalog } from "../src/load.ts";
import { resolveMotionPlan, resolveTheme } from "../src/resolve.ts";

let c: Catalog;
beforeAll(async () => {
  c = await loadCatalog();
});

function choicesFor(familyId: string, overrides: Partial<Choices> = {}): Choices {
  const d = defaultsForFamily(c, familyId);
  return {
    depth: "standard",
    styleFamilyId: familyId,
    paletteId: d.paletteId,
    typeFamilyId: d.typeFamilyId,
    motionTemplateId: d.motionTemplateId,
    interactionModeId: "linear",
    threeJs: d.threeJs,
    ...overrides,
  };
}

describe("resolveTheme", () => {
  it("for every golden choice parses as ThemeSpec", () => {
    const golden = goldenChoices(c);
    expect(golden.length).toBeGreaterThan(0);
    for (const g of golden) ThemeSpecSchema.parse(resolveTheme(c, g));
  });

  it("copies palette roles and family tokens", () => {
    const choices = choicesFor("minimal");
    const theme = resolveTheme(c, choices);
    const palette = getPalette(c, choices.paletteId);
    expect(theme.roles).toEqual(palette.roles);
    expect(theme.mode).toBe(palette.mode);
    expect(theme.radius).toBe("0.5rem");
    expect(theme.density).toBe("low");
    expect(theme.titleCase).toBe("sentence");
    expect(theme.threeJs).toBe(choices.threeJs);
  });

  it("copies glass-soft backdropBlur and surfaceAlpha", () => {
    const theme = resolveTheme(c, choicesFor("glass-soft"));
    expect(theme.backdropBlur).toBe("16px");
    expect(theme.surfaceAlpha).toBe(0.55);
  });

  it("omits backdropBlur and surfaceAlpha when the family has none", () => {
    const theme = resolveTheme(c, choicesFor("minimal"));
    expect("backdropBlur" in theme).toBe(false);
    expect("surfaceAlpha" in theme).toBe(false);
  });

  it("maps type families to font refs with optional letterSpacing", () => {
    const choices = choicesFor("minimal");
    const theme = resolveTheme(c, choices);
    const family = c.types.families.find((f) => f.id === choices.typeFamilyId)!;
    expect(theme.type.display).toEqual(family.display);
    expect(theme.type.mono.font).toBe(family.mono.font);
    expect(theme.type.scale).toBe(family.scale);
  });

  it("throws on invalid choices", () => {
    expect(() => resolveTheme(c, choicesFor("minimal", { paletteId: "brutal-pop" }))).toThrow(/does not offer palette/);
  });
});

describe("resolveMotionPlan", () => {
  const slides = [
    { id: "a", type: "stat" },
    { id: "b", type: "bullets" },
  ];

  it("applies bySlideType over defaults", () => {
    const plan = resolveMotionPlan(c, "calm", slides);
    expect(plan.templateId).toBe("calm");
    expect(plan.slides.a).toEqual({
      transition: "fade",
      enter: "fadeUp",
      emphasis: "countUp",
      exit: "fade",
      easing: "power2.out",
    });
    expect(plan.slides.b?.enter).toBe("fadeUp");
    expect(plan.reducedMotion).toBe("fadeOnly");
    expect(plan.timing.stagger).toBe(0.08);
  });

  it("lets bySlideType override easing", () => {
    expect(resolveMotionPlan(c, "pop", slides).slides.a?.easing).toBe("back.out(2)");
  });

  it("throws for an unknown template", () => {
    expect(() => resolveMotionPlan(c, "nope", slides)).toThrow(/unknown motion template/);
  });
});
