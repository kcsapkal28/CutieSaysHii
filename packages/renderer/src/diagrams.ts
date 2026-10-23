import { createRequire } from "node:module";
import type { ThemeSpec } from "@deckforge/schemas";
import { chromium } from "playwright";
import { diagramKey } from "./blocks/render.ts";
import { assertSafe, UNSAFE_IN_QUOTES, UnsafeThemeValueError } from "./theme/safe.ts";

const HEX = /^#[0-9a-f]{6}$/i;

export type DiagramResult = { svgs: Map<string, string>; warnings: string[] };
export type DiagramOptions = { timeoutMs?: number };

const DEFAULT_TIMEOUT_MS = 10_000;
// Config keys a diagram's own %%{init}%% directive must not be able to override.
const SECURE_KEYS = ["secure", "securityLevel", "startOnLoad", "maxTextSize", "themeCSS", "themeVariables", "fontFamily"];

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

export async function renderDiagrams(
  sources: string[],
  theme: ThemeSpec,
  options: DiagramOptions = {},
): Promise<DiagramResult> {
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
    await page.route("**/*", (route) => route.abort());
    await page.setContent("<!doctype html><html><body></body></html>");
    await page.addScriptTag({ path: mermaidPath });
    const outcomes: Outcome[] = await page.evaluate(
      async ({ themeVariables: tv, jobs: list, secure, timeoutMs }) => {
        const mermaid = (globalThis as unknown as { mermaid: MermaidApi }).mermaid;
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "base", themeVariables: tv, secure });

        const DROP = new Set(["img", "image", "iframe", "object", "embed", "audio", "video", "script", "link"]);
        const unescapeCss = (css: string) =>
          css.replace(/\\(?:([0-9a-f]{1,6})\s?|(.))/gi, (_m, hex?: string, ch?: string) =>
            hex ? String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff) || 0xfffd) : (ch ?? ""),
          );
        const scrubCss = (css: string) =>
          unescapeCss(css)
            .replace(/@import[^;]*;?/gi, "")
            .replace(/url\(\s*(?!["']?\s*#)[^)]*\)?/gi, "none");
        // Strict mode still lets <img>, remote url() and href through, so strip them here.
        const sanitise = (svg: string): string => {
          const doc = new DOMParser().parseFromString(svg, "text/html");
          for (const el of Array.from(doc.body.querySelectorAll("*"))) {
            const tag = el.localName.toLowerCase();
            if (DROP.has(tag)) {
              el.remove();
              continue;
            }
            for (const attr of Array.from(el.attributes)) {
              const name = attr.name.toLowerCase();
              if (name.startsWith("on") || name === "src") el.removeAttribute(attr.name);
              else if ((name === "href" || name === "xlink:href") && !attr.value.trim().startsWith("#")) {
                el.removeAttribute(attr.name);
              } else if (name === "style") el.setAttribute(attr.name, scrubCss(attr.value));
            }
            if (tag === "style") el.textContent = scrubCss(el.textContent ?? "");
          }
          return doc.body.innerHTML;
        };

        const out: Outcome[] = [];
        for (const job of list) {
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            const timeout = new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error("timed out")), timeoutMs);
            });
            const { svg } = await Promise.race([mermaid.render(job.id, job.source), timeout]);
            out.push({ key: job.key, svg: sanitise(svg) });
          } catch (e) {
            out.push({ key: job.key, error: e instanceof Error ? e.message : String(e) });
          } finally {
            clearTimeout(timer);
          }
        }
        return out;
      },
      {
        themeVariables: vars,
        jobs: [...jobs.values()],
        secure: SECURE_KEYS,
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      },
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
