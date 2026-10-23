import { createRequire } from "node:module";
import type { ThemeSpec } from "@deckforge/schemas";
import { chromium } from "playwright";
import { diagramKey } from "./blocks/render.ts";
import { bundleDiagramPage } from "./bundle.ts";
import type { Job, Outcome, RenderRequest } from "./diagram-page/main.ts";
import { legibleOn } from "./theme/compile.ts";
import { assertSafe, UNSAFE_IN_QUOTES, UnsafeThemeValueError } from "./theme/safe.ts";

const HEX = /^#[0-9a-f]{6}$/i;

export type DiagramResult = { svgs: Map<string, string>; warnings: string[] };
export type DiagramOptions = { timeoutMs?: number };

const DEFAULT_TIMEOUT_MS = 10_000;
// Config keys a diagram's own %%{init}%% directive must not be able to override.
const SECURE_KEYS = ["secure", "securityLevel", "startOnLoad", "maxTextSize", "themeCSS", "themeVariables", "fontFamily"];

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
    const request: RenderRequest = { config, jobs: [...jobs.values()], timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS };
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
