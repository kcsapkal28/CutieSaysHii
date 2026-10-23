import type { Choices, Depth } from "@deckforge/schemas";
import {
  findFamily,
  findInteractionMode,
  findMotionTemplate,
  findPalette,
  findTypeFamily,
  getFamily,
  getInteractionMode,
} from "./accessors.ts";
import type { Catalog } from "./files.ts";

// Everything the wizard and the Design Agent need to know about which choices combine.

export const depthOrder = (c: Catalog): Depth[] => Object.keys(c.slideTypes.depth) as Depth[];

function depthRule(c: Catalog, depth: Depth) {
  const rule = c.slideTypes.depth[depth];
  if (!rule) throw new Error(`no depth rule for "${depth}" in slide-types.json`);
  return rule;
}

export const allowedMotionIds = (c: Catalog, familyId: string): string[] => c.compat.allowedMotion[familyId] ?? [];
export const allowedPaletteIds = (c: Catalog, familyId: string): string[] => getFamily(c, familyId).allowedPalettes;
export const allowedTypeIds = (c: Catalog, familyId: string): string[] => getFamily(c, familyId).allowedTypes;

export function motionDisabledReason(c: Catalog, familyId: string, motionId: string): string | null {
  return allowedMotionIds(c, familyId).includes(motionId) ? null : `Not available with ${getFamily(c, familyId).name}`;
}

export function threeJsToggleVisible(c: Catalog, familyId: string, motionId: string): boolean {
  return getFamily(c, familyId).threeJs !== "never" && c.compat.threeJs.requiresMotion.includes(motionId);
}

export function threeJsDefault(c: Catalog, familyId: string, motionId: string): boolean {
  return threeJsToggleVisible(c, familyId, motionId) && getFamily(c, familyId).threeJs === "default";
}

export function defaultsForFamily(
  c: Catalog,
  familyId: string,
): { paletteId: string; typeFamilyId: string; motionTemplateId: string; threeJs: boolean } {
  const f = getFamily(c, familyId);
  return {
    paletteId: f.defaultPalette,
    typeFamilyId: f.defaultType,
    motionTemplateId: f.defaultMotion,
    threeJs: threeJsDefault(c, familyId, f.defaultMotion),
  };
}

export function wordsPerSlideMax(c: Catalog, depth: Depth, familyId: string): number {
  return Math.min(depthRule(c, depth).wordsPerSlideMax, getFamily(c, familyId).tokens.maxWordsPerSlide);
}

export function slideCountRange(c: Catalog, depth: Depth): [number, number] {
  return depthRule(c, depth).slides;
}

export type ChoiceIssueCode =
  | "unknown-id"
  | "palette-not-allowed"
  | "type-not-allowed"
  | "motion-not-allowed"
  | "threejs-unavailable"
  | "assessment-depth"
  | "question-count";

export type ChoiceIssue = { code: ChoiceIssueCode; field: keyof Choices; message: string };

/** Never throws: unknown ids are reported, and checks that depend on them are skipped. */
export function validateChoices(c: Catalog, choices: Choices): ChoiceIssue[] {
  const issues: ChoiceIssue[] = [];
  const add = (code: ChoiceIssueCode, field: keyof Choices, message: string) => issues.push({ code, field, message });

  const lookups = [
    ["styleFamilyId", "style family", findFamily],
    ["paletteId", "palette", findPalette],
    ["typeFamilyId", "type family", findTypeFamily],
    ["motionTemplateId", "motion template", findMotionTemplate],
    ["interactionModeId", "interaction mode", findInteractionMode],
  ] as const;
  const known = new Set<keyof Choices>();
  for (const [field, kind, find] of lookups) {
    const id = choices[field];
    if (find(c, id)) known.add(field);
    else add("unknown-id", field, `unknown ${kind} "${id}"`);
  }

  const family = findFamily(c, choices.styleFamilyId);
  if (family) {
    if (known.has("paletteId") && !family.allowedPalettes.includes(choices.paletteId))
      add("palette-not-allowed", "paletteId", `${family.name} does not offer palette "${choices.paletteId}"`);
    if (known.has("typeFamilyId") && !family.allowedTypes.includes(choices.typeFamilyId))
      add("type-not-allowed", "typeFamilyId", `${family.name} does not offer type family "${choices.typeFamilyId}"`);
    if (known.has("motionTemplateId")) {
      const reason = motionDisabledReason(c, family.id, choices.motionTemplateId);
      if (reason) add("motion-not-allowed", "motionTemplateId", reason);
      if (choices.threeJs && !threeJsToggleVisible(c, family.id, choices.motionTemplateId))
        add("threejs-unavailable", "threeJs", `3D depth effects need a 3D motion template with ${family.name}`);
    }
  }

  if (known.has("interactionModeId")) {
    const mode = getInteractionMode(c, choices.interactionModeId);
    const minDepth = c.compat.interactionRules[mode.id]?.minDepth;
    const order = depthOrder(c);
    if (minDepth && order.indexOf(choices.depth) < order.indexOf(minDepth as Depth))
      add("assessment-depth", "depth", `${mode.name} needs depth "${minDepth}" or deeper`);

    const qc = mode.options?.questionCount;
    if (qc && (choices.questionCount === undefined || !qc.choices.includes(choices.questionCount)))
      add("question-count", "questionCount", `${mode.name} needs questionCount in ${qc.choices.join("/")}`);
    if (!qc && choices.questionCount !== undefined)
      add("question-count", "questionCount", `${mode.name} does not take a questionCount`);
  }

  return issues;
}

/** One Choices per compat-matrix golden combo, at "standard" depth (assessment needs it). */
export function goldenChoices(c: Catalog): Choices[] {
  return c.compat.golden.map((g) => {
    const mode = getInteractionMode(c, g.interaction);
    const questionCount = mode.options?.questionCount?.default;
    return {
      depth: "standard",
      styleFamilyId: g.family,
      paletteId: g.palette,
      typeFamilyId: getFamily(c, g.family).defaultType,
      motionTemplateId: g.motion,
      interactionModeId: g.interaction,
      threeJs: g.threeJs ?? threeJsDefault(c, g.family, g.motion),
      ...(questionCount === undefined ? {} : { questionCount }),
    };
  });
}
