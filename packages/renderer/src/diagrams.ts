import { createRequire } from "node:module";
import type { ThemeSpec } from "@deckforge/schemas";
import { chromium } from "playwright";
import { diagramKey } from "./blocks/render.ts";
import { assertSafe, UNSAFE_IN_QUOTES, UnsafeThemeValueError } from "./theme/safe.ts";

const HEX = /^#[0-9a-f]{6}$/i;

export type DiagramResult = { svgs: Map<string, string>; warnings: string[] };

type Job = { id: string; key: string; source: string };
type Outcome = { key: string; svg?: string; error?: string };
type MermaidApi = {
  initialize(config: Record<string, unknown>): void;
  render(id: string, source: string): Promise<{ svg: string }>;
};

// Mermaid inlines these into the SVG's <style>, so they get the same vetting as theme CSS.
function themeVariables(theme: ThemeSpec): Record<string, string> {
  const colour = (name: string, value: string) => {
    if (!HEX.test(value)) throw new UnsafeThemeValueError(`roles.${name}`);
    return value;
  };
  const { roles, type } = theme;
  return {
    primaryColor: colour("primary", roles.primary),
    primaryTextColor: colour("text", roles.text),
    lineColor: colour("textMuted", roles.textMuted),
    background: colour("bg", roles.bg),
    fontFamily: `"${assertSafe("type.body.font", type.body.font, UNSAFE_IN_QUOTES)}", sans-serif`,
  };
}

const firstLine = (message: string) => message.trim().split(/\r?\n/, 1)[0] ?? "";

export async function renderDiagrams(sources: string[], theme: ThemeSpec): Promise<DiagramResult> {
  const svgs = new Map<string, string>();
  const warnings: string[] = [];
  if (sources.length === 0) return { svgs, warnings };

  const vars = themeVariables(theme);
  const jobs = new Map<string, Job>();
  for (const source of sources) {
    const key = diagramKey(source);
    if (!jobs.has(key)) jobs.set(key, { id: `d-${key}`, key, source });
  }

  const mermaidPath = createRequire(import.meta.url).resolve("mermaid/dist/mermaid.min.js");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent("<!doctype html><html><body></body></html>");
    await page.addScriptTag({ path: mermaidPath });
    const outcomes: Outcome[] = await page.evaluate(
      async ({ themeVariables: tv, jobs: list }) => {
        const mermaid = (globalThis as unknown as { mermaid: MermaidApi }).mermaid;
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "base", themeVariables: tv });
        const out: Outcome[] = [];
        for (const job of list) {
          try {
            const { svg } = await mermaid.render(job.id, job.source);
            out.push({ key: job.key, svg });
          } catch (e) {
            out.push({ key: job.key, error: e instanceof Error ? e.message : String(e) });
          }
        }
        return out;
      },
      { themeVariables: vars, jobs: [...jobs.values()] },
    );
    for (const o of outcomes) {
      if (o.svg !== undefined) svgs.set(o.key, o.svg);
      else warnings.push(`diagram ${o.key}: ${firstLine(o.error ?? "render failed")}`);
    }
  } finally {
    await browser.close();
  }
  return { svgs, warnings };
}
