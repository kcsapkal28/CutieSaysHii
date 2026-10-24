import { createRequire } from "node:module";
import type { ThemeSpec } from "@deckforge/schemas";
import { chromium } from "playwright";
import { diagramKey } from "./blocks/render.ts";
import { bundleDiagramPage } from "./bundle.ts";
import { compileDeckCss } from "./css.ts";
import type { Job, Outcome, RenderRequest } from "./diagram-page/main.ts";
import { diagramFonts, mermaidThemeVariables } from "./diagram-theme.ts";

export type DiagramResult = { svgs: Map<string, string>; warnings: string[] };
export type DiagramOptions = { timeoutMs?: number };

const DEFAULT_TIMEOUT_MS = 10_000;
// Config keys a diagram's own %%{init}%% directive must not be able to override.
const SECURE_KEYS = [
  "secure", "securityLevel", "startOnLoad", "maxTextSize", "themeCSS", "themeVariables", "fontFamily", "fontSize", "theme",
];

// Reveal toggles or queries these at runtime, so they are reserved even where deck.css never names them.
// It binds clicks on .navigate-* and .enter-fullscreen anywhere in the deck.
const REVEAL_CLASSES = [
  "fragment", "visible", "current-fragment", "present", "past", "future", "stack",
  "reveal", "slides", "notes", "controls", "progress", "slide-number", "backgrounds",
  "navigate-prev", "navigate-next", "enter-fullscreen",
];

const CSS_ESCAPE = /\\(?:([0-9a-f]{1,6})[ \t\n\f\r]?|([^\n]))/gi;
// "." then an identifier: escapes, non-ASCII, or name characters, not starting with a digit (that is a number).
const IDENT_CHAR = String.raw`[\w-]|[^\x00-\x7f]|\\[0-9a-f]{1,6}[ \t\n\f\r]?|\\[^\n0-9a-f]`;
const CLASS_SELECTOR = new RegExp(String.raw`\.((?!-?\d)(?:${IDENT_CHAR})+)`, "gi");
const decodeCssEscapes = (s: string) =>
  s.replace(CSS_ESCAPE, (_, hex: string | undefined, ch: string | undefined) =>
    hex === undefined ? (ch ?? "") : String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff) || 0xfffd),
  );

// [class], [class~=…], [ns|class^=…], [*|class], … : matches tokens that no list of class names can enumerate.
const CLASS_ATTRIBUTE_SELECTOR = /\[\s*(?:(?:[\w-]*|\*)\|)?class\s*(?:[~|^$*]?=|\])/i;

export class UnenumerableClassSelectorError extends Error {
  constructor(public readonly prelude: string) {
    super(`a selector matches class attributes, so its reserved class names cannot be enumerated: ${prelude.trim()}`);
    this.name = "UnenumerableClassSelectorError";
  }
}

/**
 * Every class name a selector in `css` mentions (escapes decoded), ignoring declarations, comments and strings.
 * Fails closed: throws UnenumerableClassSelectorError when a selector tests the class attribute itself.
 */
export function selectorClassNames(css: string): string[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'/g, '""');
  const names = new Set<string>();
  // A prelude (selector or at-rule) is the text before each "{", back to the previous "}", ";" or "{".
  for (const chunk of text.split("{").slice(0, -1)) {
    const prelude = chunk.slice(Math.max(chunk.lastIndexOf("}"), chunk.lastIndexOf(";")) + 1);
    if (CLASS_ATTRIBUTE_SELECTOR.test(prelude)) throw new UnenumerableClassSelectorError(prelude);
    for (const m of prelude.matchAll(CLASS_SELECTOR)) names.add(decodeCssEscapes(m[1] ?? ""));
  }
  return [...names];
}

/**
 * Class tokens a diagram may not carry: Reveal's state/structure classes and every class the compiled
 * deck.css selects on (computed from the stylesheet itself, so it can never go stale). The sanitiser
 * additionally reserves every `r-*` and `df-*` token. A deck.css selector on the class attribute itself
 * throws UnenumerableClassSelectorError, which fails the build.
 */
export async function reservedClassNames(): Promise<string[]> {
  return [...new Set([...REVEAL_CLASSES, ...selectorClassNames(await compileDeckCss())])].sort();
}

export function mermaidConfig(theme: ThemeSpec): Record<string, unknown> {
  // Mermaid inlines the theme variables into the SVG's <style>; mermaidThemeVariables vets every one.
  const themeVariables = mermaidThemeVariables(theme);
  // Sequence diagrams measure and draw their text from the top-level font, not the theme's CSS.
  const font = { fontFamily: themeVariables.fontFamily, fontSize: parseFloat(String(themeVariables.fontSize)) };
  return { startOnLoad: false, securityLevel: "strict", theme: "base", themeVariables, ...font, secure: SECURE_KEYS, handDrawnSeed: 1 };
}


const firstLine = (message: string) => message.trim().split(/\r?\n/, 1)[0] ?? "";

export async function renderDiagrams(
  sources: string[],
  theme: ThemeSpec,
  options: DiagramOptions = {},
): Promise<DiagramResult> {
  const svgs = new Map<string, string>();
  const warnings: string[] = [];
  if (sources.length === 0) return { svgs, warnings };

  const config = mermaidConfig(theme);
  const jobs = new Map<string, Job>();
  for (const source of sources) {
    const key = diagramKey(source);
    if (!jobs.has(key)) jobs.set(key, { id: `d-${key}`, key, source });
  }

  const mermaidPath = createRequire(import.meta.url).resolve("mermaid/dist/mermaid.min.js");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route("**/*", (route) => route.abort());
    await page.setContent("<!doctype html><html><body></body></html>");
    await page.addScriptTag({ path: mermaidPath });
    await page.addScriptTag({ content: await bundleDiagramPage() });
    const request: RenderRequest = {
      config,
      jobs: [...jobs.values()],
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      reservedClasses: await reservedClassNames(),
      fonts: await diagramFonts(theme),
    };
    // A string expression, not a function: nothing transpiled for the host is ever serialised into the page.
    const outcomes = (await page.evaluate(
      `globalThis.deckforgeDiagrams.renderJobs(${JSON.stringify(request)})`,
    )) as Outcome[];
    for (const o of outcomes) {
      if (o.svg !== undefined) svgs.set(o.key, o.svg);
      else warnings.push(`diagram ${o.key}: ${firstLine(o.error ?? "render failed")}`);
    }
  } finally {
    await browser.close();
  }
  return { svgs, warnings };
}
