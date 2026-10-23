import { createRequire } from "node:module";
import type { ThemeSpec } from "@deckforge/schemas";
import { chromium } from "playwright";
import { diagramKey } from "./blocks/render.ts";
import { legibleOn } from "./theme/compile.ts";
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

// Runs inside the build page (injected via its source text), so it must not reference module scope.
export function sanitiseSvg(svg: string): string {
  const SVG_NS = "http://www.w3.org/2000/svg";
  const HTML_NS = "http://www.w3.org/1999/xhtml";
  const SVG_TAGS = new Set(
    ("svg g path rect circle ellipse line polyline polygon text tspan textpath defs marker style title desc " +
      "lineargradient radialgradient stop clippath mask pattern symbol use foreignobject filter fedropshadow " +
      "feflood fegaussianblur feoffset feblend fecomposite femerge femergenode fecolormatrix").split(" "),
  );
  const HTML_TAGS = new Set("div span p br b i em strong code sub sup style".split(" "));
  // Elements whose contents are not label text; removed along with their children.
  const REMOVE_WITH_CONTENT = new Set(
    "script noscript template iframe object embed audio video img image link meta base math animate set".split(" "),
  );
  const DROP_ATTRS = new Set(["src", "srcset", "background", "action", "formaction", "poster", "data", "ping"]);

  const decodeEntities = (s: string) => {
    const t = document.createElement("textarea");
    t.innerHTML = s;
    return t.value;
  };
  // Mermaid output never needs CSS escapes, so anything containing a backslash is dropped
  // rather than decoded: the browser would decode it once more than we can safely emulate.
  const BAD_VALUE =
    /\\|url\(\s*(?!["']?\s*#)|image-set\(|cross-fade\(|(?:^|[^\w-])image\(|src\(|attr\(|element\(|paint\(|https?:|\/\//i;
  const scrubCss = (css: string) =>
    decodeEntities(css)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/@import[^;{}]*;?/gi, "")
      .replace(/@font-face\s*\{[^}]*\}?/gi, "")
      .replace(/[^;{}]+/g, (seg) => (BAD_VALUE.test(seg) ? "" : seg))
      .replace(/[<\\]/g, "");

  const cleanAttrs = (el: Element) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name === "xmlns" || name.startsWith("xmlns:")) continue;
      if (name.startsWith("on") || DROP_ATTRS.has(name)) {
        el.removeAttribute(attr.name);
      } else if (name === "href" || name.endsWith(":href")) {
        if (!attr.value.trim().startsWith("#")) el.removeAttribute(attr.name);
      } else if (name === "style") {
        el.setAttribute(attr.name, scrubCss(attr.value));
      } else {
        const v = decodeEntities(attr.value);
        if (/^\s*([a-z][a-z0-9+.-]*:|\/\/)/i.test(v) || BAD_VALUE.test(v)) el.removeAttribute(attr.name);
      }
    }
  };

  // Allowlist walk: anything not known to be inert label/diagram markup is unwrapped or removed.
  const clean = (parent: Node, inForeign: boolean) => {
    for (const node of Array.from(parent.childNodes)) {
      if (node.nodeType === 3) continue;
      if (node.nodeType !== 1) {
        node.parentNode?.removeChild(node);
        continue;
      }
      const el = node as Element;
      const tag = el.localName.toLowerCase();
      const ok =
        (el.namespaceURI === SVG_NS && SVG_TAGS.has(tag)) ||
        (el.namespaceURI === HTML_NS && inForeign && HTML_TAGS.has(tag));
      if (ok) {
        cleanAttrs(el);
        if (tag === "style") el.textContent = scrubCss(el.textContent ?? "");
        else clean(el, inForeign || (el.namespaceURI === SVG_NS && tag === "foreignobject"));
      } else if (REMOVE_WITH_CONTENT.has(tag)) {
        el.remove();
      } else {
        clean(el, inForeign);
        el.replaceWith(...Array.from(el.childNodes));
      }
    }
  };
  const doc = new DOMParser().parseFromString(svg, "text/html");
  clean(doc.body, false);
  // The deck sizes the diagram to its region; mermaid's inline max-width would pin it at its natural size.
  doc.body.querySelector("svg")?.style.removeProperty("max-width");
  return doc.body.innerHTML;
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
    await page.addScriptTag({ content: `globalThis.sanitiseSvg = ${sanitiseSvg.toString()};` });
    const outcomes: Outcome[] = await page.evaluate(
      async ({ config: cfg, jobs: list, timeoutMs }) => {
        const { mermaid, sanitiseSvg } = globalThis as unknown as { mermaid: MermaidApi; sanitiseSvg: (svg: string) => string };
        mermaid.initialize(cfg);

        const out: Outcome[] = [];
        for (const job of list) {
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            const timeout = new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error("timed out")), timeoutMs);
            });
            const { svg } = await Promise.race([mermaid.render(job.id, job.source), timeout]);
            out.push({ key: job.key, svg: sanitiseSvg(svg) });
          } catch (e) {
            out.push({ key: job.key, error: e instanceof Error ? e.message : String(e) });
          } finally {
            clearTimeout(timer);
          }
        }
        return out;
      },
      {
        config,
        jobs: [...jobs.values()],
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
