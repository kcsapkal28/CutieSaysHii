import { createRequire } from "node:module";
import type { ThemeSpec } from "@deckforge/schemas";
import { chromium, type Browser, type Page } from "playwright";
import { diagramKey } from "./blocks/render.ts";
import { bundleDiagramPage } from "./bundle.ts";
import { compileDeckCss } from "./css.ts";
import type { Job, Outcome, RenderRequest } from "./diagram-page/main.ts";
import { legibleOn } from "./theme/compile.ts";
import { assertSafe, UNSAFE_IN_QUOTES, UnsafeThemeValueError } from "./theme/safe.ts";

const HEX = /^#[0-9a-f]{6}$/i;

export type DiagramResult = { svgs: Map<string, string>; warnings: string[] };
export type DiagramOptions = { timeoutMs?: number; signal?: AbortSignal };

const DEFAULT_TIMEOUT_MS = 10_000;
// The in-page timeout cannot fire while mermaid blocks the page's event loop, so Node gives up this much later.
const HANG_GRACE_MS = 2_000;
const TIMED_OUT = Symbol("timed out");
// Config keys a diagram's own %%{init}%% directive must not be able to override.
const SECURE_KEYS = ["secure", "securityLevel", "startOnLoad", "maxTextSize", "themeCSS", "themeVariables", "fontFamily"];

// Reveal toggles or queries these at runtime, so they are reserved even where deck.css never names them.
const REVEAL_CLASSES = [
  "fragment", "visible", "current-fragment", "present", "past", "future", "stack",
  "reveal", "slides", "notes", "controls", "progress", "slide-number", "backgrounds",
];

const CSS_ESCAPE = /\\(?:([0-9a-f]{1,6})[ \t\n\f\r]?|([^\n]))/gi;
// "." then an identifier: escapes, non-ASCII, or name characters, not starting with a digit (that is a number).
const IDENT_CHAR = String.raw`[\w-]|[^\x00-\x7f]|\\[0-9a-f]{1,6}[ \t\n\f\r]?|\\[^\n0-9a-f]`;
const CLASS_SELECTOR = new RegExp(String.raw`\.((?!-?\d)(?:${IDENT_CHAR})+)`, "gi");
const decodeCssEscapes = (s: string) =>
  s.replace(CSS_ESCAPE, (_, hex: string | undefined, ch: string | undefined) =>
    hex === undefined ? (ch ?? "") : String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff) || 0xfffd),
  );

/** Every class name a selector in `css` mentions (escapes decoded), ignoring declarations, comments and strings. */
export function selectorClassNames(css: string): string[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'/g, '""');
  const names = new Set<string>();
  // A prelude (selector or at-rule) is the text before each "{", back to the previous "}", ";" or "{".
  for (const chunk of text.split("{").slice(0, -1)) {
    const prelude = chunk.slice(Math.max(chunk.lastIndexOf("}"), chunk.lastIndexOf(";")) + 1);
    for (const m of prelude.matchAll(CLASS_SELECTOR)) names.add(decodeCssEscapes(m[1] ?? ""));
  }
  return [...names];
}

/**
 * Class tokens a diagram may not carry: Reveal's state/structure classes and every class the compiled
 * deck.css selects on (computed from the stylesheet itself, so it can never go stale). The sanitiser
 * additionally reserves every `r-*` and `df-*` token.
 */
export async function reservedClassNames(): Promise<string[]> {
  return [...new Set([...REVEAL_CLASSES, ...selectorClassNames(await compileDeckCss())])].sort();
}

// Mermaid inlines these into the SVG's <style>, so they get the same vetting as theme CSS.
function themeVariables(theme: ThemeSpec): Record<string, string> {
  const colour = (name: string, value: string) => {
    if (!HEX.test(value)) throw new UnsafeThemeValueError(`roles.${name}`);
    return value;
  };
  const { roles, type } = theme;
  // Node labels use the text colour, so nodes are filled with surface: text/surface is the pair compile asserts.
  return {
    primaryColor: colour("surface", roles.surface),
    primaryBorderColor: legibleOn(roles, colour("primary", roles.primary)),
    primaryTextColor: colour("text", roles.text),
    lineColor: colour("textMuted", roles.textMuted),
    background: colour("bg", roles.bg),
    fontFamily: `"${assertSafe("type.body.font", type.body.font, UNSAFE_IN_QUOTES)}", sans-serif`,
  };
}

export function mermaidConfig(theme: ThemeSpec): Record<string, unknown> {
  return { startOnLoad: false, securityLevel: "strict", theme: "base", themeVariables: themeVariables(theme), secure: SECURE_KEYS };
}


const firstLine = (message: string) => message.trim().split(/\r?\n/, 1)[0] ?? "";

/** Settles like `work`, but rejects with the signal's reason on abort and yields TIMED_OUT after `ms`. */
function guard<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T>;
function guard<T>(work: Promise<T>, signal: AbortSignal | undefined, ms: number): Promise<T | typeof TIMED_OUT>;
function guard<T>(work: Promise<T>, signal: AbortSignal | undefined, ms?: number): Promise<T | typeof TIMED_OUT> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => settle(() => reject(signal?.reason));
    const settle = (fn: () => void) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      fn();
    };
    // Always observed, so work that fails after an abort or timeout is never an unhandled rejection.
    work.then(
      (value) => settle(() => resolve(value)),
      (error: unknown) => settle(() => reject(error)),
    );
    if (signal?.aborted) return onAbort();
    signal?.addEventListener("abort", onAbort, { once: true });
    if (ms !== undefined) timer = setTimeout(() => settle(() => resolve(TIMED_OUT)), ms);
  });
}

async function openPage(browser: Browser, mermaidPath: string, pageScript: string): Promise<Page> {
  const page = await browser.newPage();
  await page.route("**/*", (route) => route.abort());
  await page.setContent("<!doctype html><html><body></body></html>");
  await page.addScriptTag({ path: mermaidPath });
  await page.addScriptTag({ content: pageScript });
  return page;
}

/**
 * Renders each distinct source to sanitised svg in a network-isolated Chromium page. A diagram that fails or
 * outlives its timeout (even by blocking the page) becomes a warning. On abort, Chromium is closed and the
 * promise rejects with the signal's reason.
 */
export async function renderDiagrams(
  sources: string[],
  theme: ThemeSpec,
  options: DiagramOptions = {},
): Promise<DiagramResult> {
  const { signal } = options;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const svgs = new Map<string, string>();
  const warnings: string[] = [];
  signal?.throwIfAborted();
  if (sources.length === 0) return { svgs, warnings };

  const config = mermaidConfig(theme);
  const jobs = new Map<string, Job>();
  for (const source of sources) {
    const key = diagramKey(source);
    if (!jobs.has(key)) jobs.set(key, { id: `d-${key}`, key, source });
  }

  const mermaidPath = createRequire(import.meta.url).resolve("mermaid/dist/mermaid.min.js");
  const [pageScript, reservedClasses] = await guard(Promise.all([bundleDiagramPage(), reservedClassNames()]), signal);
  const launching = chromium.launch();
  const browser = await guard(launching, signal).catch((error: unknown) => {
    void launching.then((b) => b.close()).catch(() => {});
    throw error;
  });
  try {
    let page = await guard(openPage(browser, mermaidPath, pageScript), signal);
    for (const job of jobs.values()) {
      const request: RenderRequest = { config, jobs: [job], timeoutMs, reservedClasses };
      // A string expression, not a function: nothing transpiled for the host is ever serialised into the page.
      const evaluation = page.evaluate(`globalThis.deckforgeDiagrams.renderJobs(${JSON.stringify(request)})`);
      const outcomes = await guard(evaluation as Promise<Outcome[]>, signal, timeoutMs + HANG_GRACE_MS);
      if (outcomes === TIMED_OUT) {
        // The page is wedged: discard it without waiting on it (browser.close reaps it regardless) and carry on.
        warnings.push(`diagram ${job.key}: timed out`);
        void page.close().catch(() => {});
        page = await guard(openPage(browser, mermaidPath, pageScript), signal);
        continue;
      }
      for (const o of outcomes) {
        if (o.svg !== undefined) svgs.set(o.key, o.svg);
        else warnings.push(`diagram ${o.key}: ${firstLine(o.error ?? "render failed")}`);
      }
    }
  } finally {
    await browser.close();
  }
  return { svgs, warnings };
}
