// Bundles a deck into one self-contained HTML file: shell, theme, fonts, GSAP, Three.js (when used), slides.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, transform } from "esbuild";
import { ContractError, checkSlide, externalRefs, type SlideParts } from "./check.ts";
import { DeckConfig } from "./contract.ts";
import { fontFaceCss, usedWeights, usesItalic } from "./fonts.ts";
import type { ShellConfig } from "./shell/types.ts";
import { themeCss } from "./theme.ts";

const SHELL_DIR = join(dirname(fileURLToPath(import.meta.url)), "shell");

const iifeCache = new Map<string, Promise<string>>();

/** One esbuild IIFE (minified classic script) per entry, memoised per process. */
function iife(entry: string): Promise<string> {
  let hit = iifeCache.get(entry);
  if (!hit) {
    hit = build({
      entryPoints: [join(SHELL_DIR, entry)],
      bundle: true,
      format: "iife",
      minify: true,
      target: "es2020",
      write: false,
      legalComments: "none",
      logLevel: "silent",
    }).then((r) => {
      const text = r.outputFiles[0]?.text;
      if (text === undefined) throw new Error(`esbuild produced no output for ${entry}`);
      return text;
    });
    iifeCache.set(entry, hit);
  }
  return hit;
}

let shellCssCache: Promise<string> | undefined;
function shellCss(): Promise<string> {
  shellCssCache ??= transform(readFileSync(join(SHELL_DIR, "shell.css"), "utf8"), { loader: "css", minify: true }).then((r) => r.code);
  return shellCssCache;
}

/** Inline-safe script text: `</script` and `<!--` cannot appear raw inside a <script> element. */
const scriptSafe = (js: string) => js.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");
const escHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** True when any slide script needs Three.js. */
export function usesThree(scripts: string[]): boolean {
  return scripts.some((s) => /\bTHREE\b|\bthree\s*\(/.test(s));
}

/** Validates every slide against the contract. Throws ContractError listing all issues across the deck. */
export function checkDeck(config: DeckConfig, slides: Record<string, string>): Record<string, SlideParts> {
  const issues: string[] = [];
  const parts: Record<string, SlideParts> = {};
  const ids = config.slides.map((s) => s.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  for (const d of new Set(dupes)) issues.push(`deck: slide id "${d}" appears more than once in deck.json`);
  for (const id of ids) {
    const src = slides[id];
    if (src === undefined) {
      issues.push(`${id}: listed in deck.json but no slide source was given`);
      continue;
    }
    const r = checkSlide(id, src);
    issues.push(...r.issues);
    parts[id] = r.parts;
  }
  for (const id of Object.keys(slides)) if (!ids.includes(id)) issues.push(`${id}: slide source given but not listed in deck.json`);
  if (issues.length) throw new ContractError(issues);
  return parts;
}

/** Builds the deck HTML string (does not write it). */
export async function bundleHtml(input: { config: DeckConfig; slides: Record<string, string> }): Promise<string> {
  const config = DeckConfig.parse(input.config);
  const parts = checkDeck(config, input.slides);
  const ordered = config.slides.map((s) => ({ id: s.id, ...parts[s.id]! }));
  const scripts = ordered.flatMap((p) => p.scripts);
  const withThree = usesThree(scripts);
  const theme = config.style.theme;

  const [shell, gsap, three, css] = await Promise.all([
    iife("main.ts"),
    iife("libs/gsap.ts"),
    withThree ? iife("libs/three.ts") : Promise.resolve(""),
    shellCss(),
  ]);

  const sources = ordered.map((p) => [p.section, ...p.styles, ...p.scripts].join("\n"));
  const fonts = fontFaceCss([theme.fonts.display, theme.fonts.body, theme.fonts.mono], usedWeights([css, ...sources]), {
    italic: usesItalic(sources),
  });

  const shellConfig: ShellConfig = {
    title: config.title,
    theme,
    motion: config.style.motion,
    features: config.style.features,
    slides: config.slides,
  };
  const json = JSON.stringify(shellConfig).replace(/</g, "\\u003c");

  const slideScripts = ordered
    .filter((p) => p.scripts.length)
    .map(
      (p) =>
        `<script data-df-slide="${p.id}">\ntry{(function(){\n${p.scripts.join("\n;\n")}\n})()}catch(e){console.error("[df:${p.id}] "+(e&&e.stack||e));window.__dfErrors.push("[${p.id}] "+e)}\n</script>`,
    )
    .join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="DeckForge">
<title>${escHtml(config.title)}</title>
<style id="df-fonts">${fonts}</style>
<style id="df-theme">${themeCss(theme)}</style>
<style id="df-shell">${css}</style>
${ordered.map((p) => (p.styles.length ? `<style data-df-slide="${p.id}">\n${p.styles.join("\n")}\n</style>` : "")).filter(Boolean).join("\n")}
</head>
<body>
<div id="df-stage"><div id="df-backdrop"></div><main id="df-slides">
${ordered.map((p) => p.section).join("\n")}
</main></div>
<script type="application/json" id="df-config">${json}</script>
<script id="df-lib-gsap">${scriptSafe(gsap)}</script>
${withThree ? `<script id="df-lib-three">${scriptSafe(three)}</script>` : ""}
<script id="df-shell-js">${scriptSafe(shell)}</script>
${slideScripts}
<script>DF.boot()</script>
</body>
</html>
`;
  const leaks = externalRefs(html);
  if (leaks.length) throw new ContractError(leaks.map((l) => `deck: bundled output references an external resource: ${l.slice(0, 100)}`));
  return html;
}

/** Engine.bundle: writes one self-contained deck.html. */
export async function bundleDeck(input: { config: DeckConfig; slides: Record<string, string>; outFile: string }): Promise<void> {
  const html = await bundleHtml(input);
  mkdirSync(dirname(input.outFile), { recursive: true });
  writeFileSync(input.outFile, html);
}
