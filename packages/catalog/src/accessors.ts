import type {
  InteractionComponent,
  InteractionMode,
  MotionTemplate,
  Palette,
  SlideType,
  StyleFamily,
  TypeFamily,
} from "@deckforge/schemas";
import type { Catalog } from "./files.ts";

export class UnknownIdError extends Error {
  constructor(
    readonly kind: string,
    readonly id: string,
  ) {
    super(`unknown ${kind} id "${id}"`);
    this.name = "UnknownIdError";
  }
}

const find = <T extends { id: string }>(list: T[], id: string): T | undefined => list.find((x) => x.id === id);

function get<T extends { id: string }>(list: T[], kind: string, id: string): T {
  const found = find(list, id);
  if (!found) throw new UnknownIdError(kind, id);
  return found;
}

export const findFamily = (c: Catalog, id: string) => find(c.styles.families, id);
export const findPalette = (c: Catalog, id: string) => find(c.palettes.palettes, id);
export const findTypeFamily = (c: Catalog, id: string) => find(c.types.families, id);
export const findMotionTemplate = (c: Catalog, id: string) => find(c.motion.templates, id);
export const findInteractionMode = (c: Catalog, id: string) => find(c.interactions.modes, id);

export const getFamily = (c: Catalog, id: string): StyleFamily => get(c.styles.families, "style family", id);
export const getPalette = (c: Catalog, id: string): Palette => get(c.palettes.palettes, "palette", id);
export const getTypeFamily = (c: Catalog, id: string): TypeFamily => get(c.types.families, "type family", id);
export const getMotionTemplate = (c: Catalog, id: string): MotionTemplate =>
  get(c.motion.templates, "motion template", id);
export const getInteractionMode = (c: Catalog, id: string): InteractionMode =>
  get(c.interactions.modes, "interaction mode", id);
export const getComponent = (c: Catalog, id: string): InteractionComponent =>
  get(c.interactions.components, "interaction component", id);
export const getSlideType = (c: Catalog, id: string): SlideType => get(c.slideTypes.types, "slide type", id);
