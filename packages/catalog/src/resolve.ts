import type { Choices, MotionPlan, ThemeSpec } from "@deckforge/schemas";
import { getFamily, getMotionTemplate, getPalette, getTypeFamily } from "./accessors.ts";
import { validateChoices } from "./compat.ts";
import type { Catalog } from "./files.ts";

/** Turns validated wizard choices into the concrete ThemeSpec the renderer consumes. */
export function resolveTheme(c: Catalog, choices: Choices): ThemeSpec {
  const issues = validateChoices(c, choices);
  if (issues.length > 0) throw new Error(`invalid choices: ${issues.map((i) => i.message).join("; ")}`);

  const family = getFamily(c, choices.styleFamilyId);
  const palette = getPalette(c, choices.paletteId);
  const type = getTypeFamily(c, choices.typeFamilyId);
  const t = family.tokens;
  const fontRef = ({ font, weights, letterSpacing }: typeof type.display) => ({
    font,
    weights,
    ...(letterSpacing === undefined ? {} : { letterSpacing }),
  });

  return {
    familyId: family.id,
    paletteId: palette.id,
    typeFamilyId: type.id,
    roles: { ...palette.roles },
    mode: palette.mode,
    type: {
      display: fontRef(type.display),
      body: fontRef(type.body),
      mono: fontRef(type.mono),
      scale: type.scale,
      bodyLineHeight: type.bodyLineHeight,
      displayLineHeight: type.displayLineHeight,
    },
    radius: t.radius,
    borderWidth: t.borderWidth,
    shadow: t.shadow,
    texture: t.texture,
    gradients: t.gradients,
    imageTreatment: t.imageTreatment,
    density: t.density,
    titleCase: t.titleCase,
    ...(t.backdropBlur === undefined ? {} : { backdropBlur: t.backdropBlur }),
    ...(t.surfaceAlpha === undefined ? {} : { surfaceAlpha: t.surfaceAlpha }),
    threeJs: choices.threeJs,
  };
}

/** Per slide: template defaults, then the template easing, then any slide-type override. */
export function resolveMotionPlan(
  c: Catalog,
  templateId: string,
  slides: { id: string; type: string }[],
): MotionPlan {
  const template = getMotionTemplate(c, templateId);
  return {
    templateId: template.id,
    reducedMotion: template.reducedMotion,
    timing: { ...template.timing },
    slides: Object.fromEntries(
      slides.map((s) => [
        s.id,
        { ...template.defaults, easing: template.timing.easing, ...template.bySlideType[s.type] },
      ]),
    ),
  };
}
