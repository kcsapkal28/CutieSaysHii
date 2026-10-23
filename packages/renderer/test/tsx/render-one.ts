// Run under tsx (not vitest) by test/tsx.test.ts: tsx keeps function names, which once broke in-page code.
import { goldenChoices, resolveTheme } from "@deckforge/catalog";
import { loadCatalog } from "@deckforge/catalog/node";
import { renderDiagrams } from "../../src/diagrams.ts";

const catalog = await loadCatalog();
const choices = goldenChoices(catalog)[0];
if (!choices) throw new Error("no golden choices");
const { svgs, warnings } = await renderDiagrams(["graph TD; A-->B"], resolveTheme(catalog, choices));
process.stdout.write(JSON.stringify({ svgs: [...svgs.values()], warnings }));
