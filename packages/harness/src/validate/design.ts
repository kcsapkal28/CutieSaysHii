import { getInteractionMode, type Catalog } from "@deckforge/catalog";
import type { DeckSkeleton, DesignChoices } from "../kernel/contracts.ts";
import { issuePath, type Issue } from "../kernel/issues.ts";
import type { DesignWire } from "./design-wire.ts";

type Path = (string | number)[];

// A component that binds "*" decorates the whole slide (notes, score) and is not interactive.
const WHOLE_SLIDE = "*";
const MOTION_STEPS = ["transition", "enter", "emphasis", "exit"] as const;

const isJsonObject = (text: string): boolean => {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value);
  } catch {
    return false;
  }
};

/** Choices validity is checked at submit/rerun; this checks Agent B's output against the catalog and skeleton. */
export function validateDesign(c: Catalog, choices: DesignChoices, skel: DeckSkeleton, w: DesignWire): Issue[] {
  const issues: Issue[] = [];
  const add = (path: Path, code: string, message: string) => issues.push({ path: issuePath(path), code, message });
  const slides = new Map(skel.slides.map((s) => [s.id, s]));
  const rules = c.compat.designRules;
  const vocab = c.motion.vocabulary;

  const overridden = new Set<string>();
  w.motion.overrides.forEach((o, i) => {
    const at = (...rest: Path): Path => ["motion", "overrides", i, ...rest];
    const slide = slides.get(o.slideId);
    if (!slide) add(at("slideId"), "unknown-slide", `override names unknown slide "${o.slideId}"`);
    else if (!rules.motionOverrideSlideTypes.includes(slide.type))
      add(at("slideId"), "override-slide-type",
        `slide ${slide.id} is "${slide.type}"; motion overrides are allowed only on ${rules.motionOverrideSlideTypes.join(", ")} slides`);
    if (overridden.has(o.slideId))
      add(at("slideId"), "duplicate-override", `slide ${o.slideId} already has a motion override; keep one per slide`);
    overridden.add(o.slideId);
    if (o.reason.trim() === "") add(at("reason"), "override-reason", `the override on slide ${o.slideId} needs a reason`);
    for (const step of MOTION_STEPS)
      if (!vocab[step].includes(o[step]))
        add(at(step), "vocabulary", `${step} "${o[step]}" is not in the motion vocabulary; use one of: ${vocab[step].join(", ")}`);
    if (o.easing !== null && !vocab.easing.includes(o.easing))
      add(at("easing"), "vocabulary", `easing "${o.easing}" is not in the motion vocabulary; use null or one of: ${vocab.easing.join(", ")}`);
  });

  const mode = getInteractionMode(c, choices.interactionModeId);
  const components = new Map(c.interactions.components.map((x) => [x.id, x]));
  const placed = new Set<string>();
  const interactivePerSlide = new Map<string, string[]>();
  w.interaction.placements.forEach((p, i) => {
    const at = (...rest: Path): Path => ["interaction", "placements", i, ...rest];
    const slide = slides.get(p.slideId);
    if (!slide) add(at("slideId"), "unknown-slide", `placement names unknown slide "${p.slideId}"`);
    const component = mode.components.includes(p.componentId) ? components.get(p.componentId) : undefined;
    if (!component)
      add(at("componentId"), "component-not-in-mode",
        `component "${p.componentId}" is not available in ${mode.name} mode; use one of: ${mode.components.join(", ")}`);

    const key = JSON.stringify([p.slideId, p.componentId, p.blockIndex]);
    if (placed.has(key)) {
      const block = p.blockIndex === null ? "" : ` at block ${p.blockIndex}`;
      add(at(), "duplicate-placement", `${p.componentId} is placed twice on slide ${p.slideId}${block}`);
      return;
    }
    placed.add(key);

    if (!isJsonObject(p.propsJson))
      add(at("propsJson"), "props-json", `propsJson must be a JSON object such as "{}"; got ${JSON.stringify(p.propsJson)}`);
    if (!slide || !component) return;

    if (component.disallowedSlideTypes?.includes(slide.type))
      add(at("slideId"), "component-slide-type", `${component.id} is not allowed on "${slide.type}" slides (slide ${slide.id})`);

    if (component.binds.includes(WHOLE_SLIDE)) {
      if (p.blockIndex !== null)
        add(at("blockIndex"), "component-binding", `${component.id} applies to the whole slide; set blockIndex to null`);
    } else {
      const binds = component.binds.join(" or ");
      const blockType = p.blockIndex === null ? undefined : slide.blockTypes[p.blockIndex];
      if (blockType === undefined)
        add(at("blockIndex"), "component-binding",
          `${component.id} needs the index of a ${binds} block on slide ${slide.id}, which has ${slide.blockTypes.length} block(s); got ${p.blockIndex}`);
      else if (!component.binds.includes(blockType))
        add(at("blockIndex"), "component-binding",
          `${component.id} cannot bind block ${p.blockIndex} on slide ${slide.id} (a ${blockType} block); it binds ${binds}`);
      interactivePerSlide.set(slide.id, [...(interactivePerSlide.get(slide.id) ?? []), component.id]);
    }
  });

  const max = rules.maxInteractiveComponentsPerSlide;
  for (const [slideId, ids] of interactivePerSlide)
    if (ids.length > max)
      add(["interaction", "placements"], "components-per-slide",
        `slide ${slideId} has ${ids.length} interactive components (${ids.join(", ")}); at most ${max} per slide`);

  if (mode.minComponentsPerSlides > 0) {
    const needed = Math.ceil(skel.slides.length / mode.minComponentsPerSlides);
    const total = [...interactivePerSlide.values()].reduce((sum, ids) => sum + ids.length, 0);
    if (total < needed)
      add(["interaction", "placements"], "components-density",
        `${mode.name} mode needs ${needed} interactive components for ${skel.slides.length} slides (one per ${mode.minComponentsPerSlides}); got ${total}`);
  }

  return issues;
}
