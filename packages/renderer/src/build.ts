import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Catalog } from "@deckforge/catalog";
import {
  DeckSpecSchema,
  InteractionPlanSchema,
  MotionPlanSchema,
  ThemeSpecSchema,
  type DeckSpec,
  type InteractionPlan,
  type MotionPlan,
  type RenderManifest,
  type ThemeSpec,
} from "@deckforge/schemas";
import { bundleRuntime } from "./bundle.ts";
import { compileDeckCss } from "./css.ts";
import { renderDiagrams } from "./diagrams.ts";
import { loadTemplates } from "./html/templates.ts";
import { renderDeckHtml } from "./html/deck.ts";
import { compileThemeCss } from "./theme/compile.ts";
import { fontFaces } from "./theme/fonts.ts";

export type BuildInput = {
  jobId: string;
  deck: DeckSpec;
  theme: ThemeSpec;
  motion: MotionPlan;
  interaction: InteractionPlan;
  catalog: Catalog;
  outDir: string;
  /** Checked before each step; once aborted, build rejects with its reason and writes nothing further. */
  signal?: AbortSignal;
};

const THREE_JS_WARNING = "threeJs requested but not supported by this renderer yet";

function diagramSources(deck: DeckSpec): string[] {
  const sources = new Set<string>();
  for (const slide of deck.slides) {
    for (const block of slide.body) if (block.type === "Diagram") sources.add(block.mermaid);
  }
  return [...sources];
}

/** Writes a self-contained deck folder (index.html + assets/) and returns its manifest. */
export async function build(input: BuildInput): Promise<RenderManifest> {
  const { catalog, outDir, signal } = input;
  signal?.throwIfAborted();
  const deck = DeckSpecSchema.parse(input.deck);
  const theme = ThemeSpecSchema.parse(input.theme);
  const motion = MotionPlanSchema.parse(input.motion);
  const interaction = InteractionPlanSchema.parse(input.interaction);

  const fonts = fontFaces(theme);
  const themeCss = fonts.css + (fonts.css ? "\n" : "") + compileThemeCss(theme);
  const diagrams = await renderDiagrams(diagramSources(deck), theme, { signal });
  signal?.throwIfAborted();
  const [deckCss, deckJs] = await Promise.all([compileDeckCss(), bundleRuntime()]);
  signal?.throwIfAborted();

  const { html, warnings: htmlWarnings } = renderDeckHtml({
    deck,
    theme,
    motion,
    interaction,
    catalog,
    templates: loadTemplates(),
    diagrams: diagrams.svgs,
    assets: { css: ["assets/deck.css", "assets/theme.css"], js: ["assets/deck.js"] },
  });

  // index.html goes last, so a build cancelled part-way never leaves an entry point behind.
  const text: [string, string][] = [
    ["assets/deck.css", deckCss],
    ["assets/theme.css", themeCss],
    ["assets/deck.js", deckJs],
  ];
  for (const [rel, content] of text) {
    signal?.throwIfAborted();
    const path = join(outDir, rel);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }
  for (const f of fonts.files) {
    signal?.throwIfAborted();
    const path = join(outDir, "assets", f.to);
    await mkdir(dirname(path), { recursive: true });
    await copyFile(f.from, path);
  }
  signal?.throwIfAborted();
  await writeFile(join(outDir, "index.html"), html);

  const paths = ["index.html", "assets/deck.css", "assets/theme.css", "assets/deck.js", ...fonts.files.map((f) => `assets/${f.to}`)];
  const assets = await Promise.all(paths.map(async (path) => ({ path, bytes: (await stat(join(outDir, path))).size })));

  return {
    jobId: input.jobId,
    entry: "index.html",
    slideIds: deck.slides.map((s) => s.id),
    assets,
    totalBytes: assets.reduce((n, a) => n + a.bytes, 0),
    threeJs: theme.threeJs,
    warnings: [...diagrams.warnings, ...htmlWarnings, ...(theme.threeJs ? [THREE_JS_WARNING] : [])],
  };
}
