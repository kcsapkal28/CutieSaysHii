// Shared setup for the renderDeckHtml tests: the catalog, the solar fixture and RenderInput builders.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { defaultsForFamily, resolveMotionPlan, resolveTheme } from "@deckforge/catalog";
import { loadCatalog } from "@deckforge/catalog/node";
import type { Block, DeckSpec, InteractionPlan, Slide } from "@deckforge/schemas";
import { JSDOM } from "jsdom";
import { renderDeckHtml, type RenderInput } from "../src/html/deck.ts";
import { loadTemplates } from "../src/html/templates.ts";

/** Parses a JSON file relative to this directory. */
export const read = async <T>(rel: string) =>
  JSON.parse(await readFile(fileURLToPath(new URL(rel, import.meta.url)), "utf8")) as T;

export const catalog = await loadCatalog();
export const fixture = await read<DeckSpec>("../fixtures/solar.deck.json");
export const interaction = await read<InteractionPlan>("../fixtures/solar.interaction.json");
export const templates = loadTemplates();
export const TEMPLATES_DIR = fileURLToPath(new URL("../templates/", import.meta.url));

/** A RenderInput for `deck` in `family`'s default palette and type, with the calm motion plan. */
export function inputFor(deck: DeckSpec, patch: Partial<RenderInput> = {}, family = "minimal"): RenderInput {
  const d = defaultsForFamily(catalog, family);
  const theme = resolveTheme(catalog, {
    depth: "standard",
    styleFamilyId: family,
    paletteId: d.paletteId,
    typeFamilyId: d.typeFamilyId,
    motionTemplateId: family === "minimal" ? "calm" : d.motionTemplateId,
    interactionModeId: "linear",
    threeJs: false,
  });
  return {
    deck,
    theme,
    motion: resolveMotionPlan(catalog, "calm", deck.slides),
    interaction: { modeId: "linear", slides: [] },
    catalog,
    templates,
    diagrams: new Map(),
    assets: { css: ["deck.css", "theme.css"], js: ["deck.js"] },
    ...patch,
  };
}

export const dom = (html: string) => new JSDOM(html).window.document;

export const slideOf = (type: string, body: Block[] = [], extra: Partial<Slide> = {}): Slide => ({
  id: "x1",
  type,
  title: "A title",
  body,
  notes: "notes",
  emphasisTargets: [],
  ...extra,
});

export const deckOf = (...slides: Slide[]): DeckSpec => ({ title: "Deck", subtitle: "Sub", slides });

/** The solar fixture rendered in `family`, as a document. */
export const solarDoc = (family: string, patch: Partial<RenderInput> = {}) =>
  dom(renderDeckHtml(inputFor(fixture, { interaction, ...patch }, family)).html);
