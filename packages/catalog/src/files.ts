import type {
  CompatMatrixFile,
  DesignStylesFile,
  InteractionsFile,
  MotionTemplatesFile,
  PalettesFile,
  SlideTypesFile,
  TypeFamiliesFile,
} from "@deckforge/schemas";

export const CATALOG_FILES = {
  styles: "design-styles.json",
  palettes: "palettes.json",
  types: "type-families.json",
  motion: "motion-templates.json",
  interactions: "interactions.json",
  slideTypes: "slide-types.json",
  compat: "compat-matrix.json",
} as const;

export type CatalogKey = keyof typeof CATALOG_FILES;

export type Catalog = {
  styles: DesignStylesFile;
  palettes: PalettesFile;
  types: TypeFamiliesFile;
  motion: MotionTemplatesFile;
  interactions: InteractionsFile;
  slideTypes: SlideTypesFile;
  compat: CompatMatrixFile;
};
