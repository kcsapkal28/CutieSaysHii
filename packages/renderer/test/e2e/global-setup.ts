import { readFileSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultsForFamily, getFamily, getPalette, resolveMotionPlan, resolveTheme, type Catalog } from "@deckforge/catalog";
import { loadCatalog } from "@deckforge/catalog/node";
import type { DeckSpec, InteractionPlan, LayoutSpec } from "@deckforge/schemas";
import { build } from "../../src/build.ts";

const PACKAGE_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const STYLES_FILE = join(PACKAGE_ROOT, "../../catalog/design-styles.json");
const DECKS_DIR = join(PACKAGE_ROOT, "test-results/decks");

type StylesFile = { families: { id: string; layout: LayoutSpec }[] };
const styles = JSON.parse(readFileSync(STYLES_FILE, "utf8")) as StylesFile;

// Spec files enumerate their tests synchronously, so the family list is read from the catalog file directly.
export const FAMILIES: readonly string[] = styles.families.map((f) => f.id);
export const layoutOf = (family: string): LayoutSpec => styles.families.find((f) => f.id === family)!.layout;

export const DECK_KINDS = ["solar", "stress", "alt"] as const;
export type DeckKind = (typeof DECK_KINDS)[number];
export type DeckEntry = { family: string; deck: DeckKind };
export const DECKS: readonly DeckEntry[] = FAMILIES.flatMap((family) => DECK_KINDS.map((deck) => ({ family, deck })));

export const FIXTURES = {
  solar: { deck: join(PACKAGE_ROOT, "fixtures/solar.deck.json"), interaction: join(PACKAGE_ROOT, "fixtures/solar.interaction.json") },
  stress: { deck: join(PACKAGE_ROOT, "fixtures/stress.deck.json"), interaction: join(PACKAGE_ROOT, "fixtures/stress.interaction.json") },
} as const;
// The alt deck is the solar deck on another palette.
export const fixtureOf = (deck: DeckKind) => FIXTURES[deck === "stress" ? "stress" : "solar"];
export const readDeckSpec = (deck: DeckKind): DeckSpec => JSON.parse(readFileSync(fixtureOf(deck).deck, "utf8")) as DeckSpec;

// The space and the accent are deliberate: the deck must open from such a file:// path.
export const deckDir = (family: string, deck: DeckKind) => join(DECKS_DIR, `${family} ${deck} déck`);

/** The first allowed palette whose mode differs from the default's, else the last allowed palette. */
export function altPalette(catalog: Catalog, family: string): string {
  const f = getFamily(catalog, family);
  const mode = getPalette(catalog, f.defaultPalette).mode;
  return f.allowedPalettes.find((id) => getPalette(catalog, id).mode !== mode) ?? f.allowedPalettes.at(-1)!;
}

const readJson = async <T>(path: string) => JSON.parse(await readFile(path, "utf8")) as T;

/** Builds one family deck with the family's default palette, type and motion (alt swaps the palette). */
export async function buildFamilyDeck(catalog: Catalog, family: string, deck: DeckKind, outDir: string): Promise<void> {
  const fixture = fixtureOf(deck);
  const spec = await readJson<DeckSpec>(fixture.deck);
  const interaction = await readJson<InteractionPlan>(fixture.interaction);
  const d = defaultsForFamily(catalog, family);
  const theme = resolveTheme(catalog, {
    depth: "standard",
    styleFamilyId: family,
    paletteId: deck === "alt" ? altPalette(catalog, family) : d.paletteId,
    typeFamilyId: d.typeFamilyId,
    motionTemplateId: d.motionTemplateId,
    interactionModeId: interaction.modeId,
    threeJs: false,
  });
  const motion = resolveMotionPlan(catalog, d.motionTemplateId, spec.slides);
  await build({ jobId: `e2e-${family}-${deck}`, deck: spec, theme, motion, interaction, catalog, outDir });
}

export default async function globalSetup(): Promise<void> {
  const catalog = await loadCatalog();
  await rm(DECKS_DIR, { recursive: true, force: true });
  // Each build launches a browser for its diagrams, so a few run at once.
  const queue = [...DECKS];
  const worker = async () => {
    for (let d = queue.shift(); d; d = queue.shift()) await buildFamilyDeck(catalog, d.family, d.deck, deckDir(d.family, d.deck));
  };
  await Promise.all(Array.from({ length: 4 }, worker));
}
