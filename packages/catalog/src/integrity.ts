import { contrastRatio, passesAA } from "./contrast.ts";
import { CATALOG_FILES, type Catalog } from "./files.ts";

export type IntegrityIssue = { file: string; path: string; message: string };

const F = CATALOG_FILES;
const MODE_RULE = /^(dark|light) only$/;

/** Every cross-reference between catalog files, plus palette contrast. Empty array = consistent. */
export function checkIntegrity(c: Catalog): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  const add = (file: string, path: string, message: string) => issues.push({ file, path, message });

  // Rule 0: ids are unique. Lookups take the first match, so a duplicate would be silently ignored.
  const idLists: [string, string, { id: string }[]][] = [
    [F.styles, "families", c.styles.families],
    [F.palettes, "palettes", c.palettes.palettes],
    [F.types, "families", c.types.families],
    [F.motion, "templates", c.motion.templates],
    [F.interactions, "modes", c.interactions.modes],
    [F.interactions, "components", c.interactions.components],
    [F.slideTypes, "types", c.slideTypes.types],
  ];
  for (const [file, list, items] of idLists) {
    const seen = new Set<string>();
    items.forEach((x, i) => {
      if (seen.has(x.id)) add(file, `${list}.${i}.id`, `duplicate id "${x.id}" in ${list}`);
      seen.add(x.id);
    });
  }

  const palettes = new Map(c.palettes.palettes.map((p) => [p.id, p]));
  const types = new Map(c.types.families.map((t) => [t.id, t]));
  const familyIds = new Set(c.styles.families.map((f) => f.id));
  const motionIds = new Set(c.motion.templates.map((t) => t.id));
  const modeIds = new Set(c.interactions.modes.map((m) => m.id));
  const componentIds = new Set(c.interactions.components.map((x) => x.id));
  const slideTypeIds = new Set(c.slideTypes.types.map((t) => t.id));
  const blockNames = new Set(Object.keys(c.slideTypes.blocks));
  const depths = new Set(Object.keys(c.slideTypes.depth));
  const allowedMotion = c.compat.allowedMotion;

  c.styles.families.forEach((f, i) => {
    const at = `families.${i}`;
    // Rule 1: defaults are allowed, allowed ids exist.
    if (!f.allowedPalettes.includes(f.defaultPalette))
      add(F.styles, `${at}.defaultPalette`, `${f.id}: default palette "${f.defaultPalette}" is not in allowedPalettes`);
    if (!f.allowedTypes.includes(f.defaultType))
      add(F.styles, `${at}.defaultType`, `${f.id}: default type "${f.defaultType}" is not in allowedTypes`);
    f.allowedPalettes.forEach((p, j) => {
      const palette = palettes.get(p);
      if (!palette) return add(F.styles, `${at}.allowedPalettes.${j}`, `${f.id}: unknown palette "${p}"`);
      // Rule 2: palette mode obeys the family's mode rule.
      const rule = c.compat.paletteModeRules[f.id];
      const want = rule && MODE_RULE.exec(rule)?.[1];
      if (want && palette.mode !== want)
        add(F.styles, `${at}.allowedPalettes.${j}`, `${f.id} is ${rule} but allows ${palette.mode} palette "${p}"`);
    });
    f.allowedTypes.forEach((t, j) => {
      const type = types.get(t);
      if (!type) return add(F.styles, `${at}.allowedTypes.${j}`, `${f.id}: unknown type family "${t}"`);
      // Rule 3: allowed type families pair with the family.
      if (!type.pairsWith.includes(f.id))
        add(F.styles, `${at}.allowedTypes.${j}`, `${f.id} allows type family "${t}", whose pairsWith omits it`);
    });
    // Rule 4: default motion is allowed.
    if (!allowedMotion[f.id]?.includes(f.defaultMotion))
      add(F.styles, `${at}.defaultMotion`, `${f.id}: default motion "${f.defaultMotion}" is not in compat allowedMotion`);
  });

  c.types.families.forEach((t, i) =>
    t.pairsWith.forEach((id, j) => {
      if (!familyIds.has(id)) add(F.types, `families.${i}.pairsWith.${j}`, `${t.id}: unknown style family "${id}"`);
    }),
  );

  // Rule 4: allowedMotion has one entry per family, with known motion ids.
  for (const id of familyIds)
    if (!(id in allowedMotion)) add(F.compat, "allowedMotion", `missing allowedMotion entry for family "${id}"`);
  for (const [id, motions] of Object.entries(allowedMotion)) {
    if (!familyIds.has(id)) add(F.compat, `allowedMotion.${id}`, `unknown style family "${id}"`);
    motions.forEach((m, j) => {
      if (!motionIds.has(m)) add(F.compat, `allowedMotion.${id}.${j}`, `unknown motion template "${m}"`);
    });
  }
  for (const [id, rule] of Object.entries(c.compat.paletteModeRules)) {
    if (id === "note") continue;
    if (!familyIds.has(id)) add(F.compat, `paletteModeRules.${id}`, `unknown style family "${id}"`);
    if (!MODE_RULE.test(rule)) add(F.compat, `paletteModeRules.${id}`, `unrecognised rule "${rule}"`);
  }

  // Rule 5: motion values come from the vocabulary; bySlideType keys are slide types.
  const vocab = c.motion.vocabulary;
  const inVocab = (path: string, key: keyof typeof vocab, value: string) => {
    if (!vocab[key].includes(value)) add(F.motion, path, `${key} "${value}" is not in vocabulary.${key}`);
  };
  c.motion.templates.forEach((t, i) => {
    const at = `templates.${i}`;
    inVocab(`${at}.timing.easing`, "easing", t.timing.easing);
    for (const [k, v] of Object.entries(t.defaults)) inVocab(`${at}.defaults.${k}`, k as keyof typeof vocab, v);
    for (const [slideType, step] of Object.entries(t.bySlideType)) {
      if (!slideTypeIds.has(slideType)) add(F.motion, `${at}.bySlideType.${slideType}`, `unknown slide type "${slideType}"`);
      for (const [k, v] of Object.entries(step))
        inVocab(`${at}.bySlideType.${slideType}.${k}`, k as keyof typeof vocab, v as string);
    }
    t.threeBackground?.onSlideTypes.forEach((s, j) => {
      if (!slideTypeIds.has(s)) add(F.motion, `${at}.threeBackground.onSlideTypes.${j}`, `unknown slide type "${s}"`);
    });
  });

  // Rule 6: mode components exist; component binds are blocks or "*".
  c.interactions.modes.forEach((m, i) =>
    m.components.forEach((id, j) => {
      if (!componentIds.has(id)) add(F.interactions, `modes.${i}.components.${j}`, `${m.id}: unknown component "${id}"`);
    }),
  );
  c.interactions.components.forEach((x, i) => {
    x.binds.forEach((b, j) => {
      if (b !== "*" && !blockNames.has(b))
        add(F.interactions, `components.${i}.binds.${j}`, `${x.id}: binds "${b}", which is not a block`);
    });
    x.disallowedSlideTypes?.forEach((s, j) => {
      if (!slideTypeIds.has(s)) add(F.interactions, `components.${i}.disallowedSlideTypes.${j}`, `${x.id}: unknown slide type "${s}"`);
    });
  });

  // Rule 7: slide types reference real blocks and modes.
  c.slideTypes.types.forEach((t, i) => {
    t.accepts.forEach((b, j) => {
      if (!blockNames.has(b)) add(F.slideTypes, `types.${i}.accepts.${j}`, `${t.id}: unknown block "${b}"`);
    });
    t.onlyIn?.forEach((m, j) => {
      if (!modeIds.has(m)) add(F.slideTypes, `types.${i}.onlyIn.${j}`, `${t.id}: unknown interaction mode "${m}"`);
    });
  });

  // Rules 7 + 9: interaction rules reference real modes, slide types and depths.
  for (const [modeId, rule] of Object.entries(c.compat.interactionRules)) {
    const at = `interactionRules.${modeId}`;
    if (!modeIds.has(modeId)) add(F.compat, at, `unknown interaction mode "${modeId}"`);
    if (rule.minDepth !== undefined && !depths.has(rule.minDepth))
      add(F.compat, `${at}.minDepth`, `minDepth "${rule.minDepth}" is not a depth in ${F.slideTypes}`);
  }

  // Rule 12: design rules reference real slide types; the per-slide cap is a positive integer.
  const design = c.compat.designRules;
  design.motionOverrideSlideTypes.forEach((s, j) => {
    if (!slideTypeIds.has(s)) add(F.compat, `designRules.motionOverrideSlideTypes.${j}`, `unknown slide type "${s}"`);
  });
  if (!Number.isInteger(design.maxInteractiveComponentsPerSlide) || design.maxInteractiveComponentsPerSlide < 1)
    add(F.compat, "designRules.maxInteractiveComponentsPerSlide",
      `maxInteractiveComponentsPerSlide must be an integer ≥ 1 (got ${design.maxInteractiveComponentsPerSlide})`);

  // Rule 8: golden combos resolve and obey the compat rules.
  const requiresMotion = c.compat.threeJs.requiresMotion;
  c.compat.golden.forEach((g, i) => {
    const at = `golden.${i}`;
    const family = c.styles.families.find((f) => f.id === g.family);
    if (!family) return add(F.compat, `${at}.family`, `unknown style family "${g.family}"`);
    if (!allowedMotion[g.family]?.includes(g.motion))
      add(F.compat, `${at}.motion`, `motion "${g.motion}" is not allowed for ${g.family}`);
    if (!family.allowedPalettes.includes(g.palette))
      add(F.compat, `${at}.palette`, `palette "${g.palette}" is not allowed for ${g.family}`);
    if (!modeIds.has(g.interaction)) add(F.compat, `${at}.interaction`, `unknown interaction mode "${g.interaction}"`);
    if (g.threeJs && (family.threeJs === "never" || !requiresMotion.includes(g.motion)))
      add(F.compat, `${at}.threeJs`, `threeJs is unavailable for ${g.family} + ${g.motion}`);
  });

  // Rule 10: text roles and listed pairs pass WCAG AA.
  c.palettes.palettes.forEach((p, i) => {
    for (const fg of ["text", "textMuted"] as const)
      for (const bg of ["bg", "surface"] as const)
        if (!passesAA(p.roles[fg], p.roles[bg]))
          add(F.palettes, `palettes.${i}.roles.${fg}`,
            `${p.id}: ${fg} ${p.roles[fg]} on ${bg} ${p.roles[bg]} is ${contrastRatio(p.roles[fg], p.roles[bg]).toFixed(2)}:1, below AA`);
    p.contrast.forEach(([fg, bg], j) => {
      if (!passesAA(fg, bg))
        add(F.palettes, `palettes.${i}.contrast.${j}`, `${p.id}: listed pair ${fg} on ${bg} is ${contrastRatio(fg, bg).toFixed(2)}:1, below AA`);
    });
  });

  return issues;
}
