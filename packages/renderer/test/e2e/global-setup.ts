import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultsForFamily, resolveMotionPlan, resolveTheme } from "@deckforge/catalog";
import { loadCatalog } from "@deckforge/catalog/node";
import type { DeckSpec, InteractionPlan } from "@deckforge/schemas";
import { build } from "../../src/build.ts";

export const FAMILIES = ["minimal", "retro", "atmospheric"] as const;
export type Family = (typeof FAMILIES)[number];

const PACKAGE_ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const FIXTURE_DECK = join(PACKAGE_ROOT, "fixtures/solar.deck.json");
const FIXTURE_INTERACTION = join(PACKAGE_ROOT, "fixtures/solar.interaction.json");
const DECKS_DIR = join(PACKAGE_ROOT, "test-results/decks");

// The space and the accent are deliberate: the deck must open from such a file:// path.
export const deckDir = (family: Family) => join(DECKS_DIR, `${family} déck`);

const readJson = async <T>(path: string) => JSON.parse(await readFile(path, "utf8")) as T;

export default async function globalSetup(): Promise<void> {
  const catalog = await loadCatalog();
  const deck = await readJson<DeckSpec>(FIXTURE_DECK);
  const interaction = await readJson<InteractionPlan>(FIXTURE_INTERACTION);
  const motion = resolveMotionPlan(catalog, "calm", deck.slides);
  await rm(DECKS_DIR, { recursive: true, force: true });

  for (const family of FAMILIES) {
    const d = defaultsForFamily(catalog, family);
    const theme = resolveTheme(catalog, {
      depth: "standard",
      styleFamilyId: family,
      paletteId: d.paletteId,
      typeFamilyId: d.typeFamilyId,
      motionTemplateId: "calm",
      interactionModeId: "linear",
      threeJs: false,
    });
    await build({ jobId: `e2e-${family}`, deck, theme, motion, interaction, catalog, outDir: deckDir(family) });
  }
}
