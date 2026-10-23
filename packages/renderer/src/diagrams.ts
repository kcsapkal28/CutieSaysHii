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

  // DOM attribute values and style text are already entity-decoded exactly once, and they are what the
  // browser's CSS parser will see after the output is reparsed. Each value is judged as-is and then
  // either emitted unchanged or dropped; nothing is ever transformed after it has been judged.
  // Backslashes are refused outright: CSS escapes would decode once more than we can safely emulate.
  const BLOCKED = /[<\\]|\/\/|\/\*|@import|@font-face|attr\(|image-set\(|cross-fade\(|image\(|element\(|paint\(|src\(/i;
  const FRAGMENT_URL = /url\((["']?)#[\w-]+\1\)/gi;
  const QUOTED = /"[^"]*"?|'[^']*'?/g;
  const SCHEME = /[a-z][a-z0-9+.-]*:/i;
  const cssOk = (text: string) =>
    !BLOCKED.test(text) &&
    !/url\(/i.test(text.replace(FRAGMENT_URL, "")) &&
    !(text.match(QUOTED) ?? []).some((q) => SCHEME.test(q));
  // Keeps each declaration/selector segment verbatim or drops it; the result must pass as a whole too.
  const scrubCss = (css: string) => {
    const kept = css.replace(/[^;{}]+/g, (seg) => (cssOk(seg) ? seg : ""));
    return cssOk(kept) ? kept : "";
  };
  // The value to emit for an attribute, or null to drop it.
  const attrValue = (name: string, value: string): string | null => {
    if (name === "xmlns" || name.startsWith("xmlns:")) return value;
    if (name.startsWith("on") || DROP_ATTRS.has(name)) return null;
    if (name === "href" || name.endsWith(":href")) return value.trim().startsWith("#") ? value : null;
    if (name === "style") return scrubCss(value) || null;
    return /^\s*[a-z][a-z0-9+.-]*:/i.test(value) || !cssOk(value) ? null : value;
  };

  const cleanAttrs = (el: Element) => {
    for (const attr of Array.from(el.attributes)) {
      const value = attrValue(attr.name.toLowerCase(), attr.value);
      if (value === null) el.removeAttribute(attr.name);
      else if (value !== attr.value) el.setAttribute(attr.name, value);
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
  // Like every other change this only drops whole declarations, verbatim; the invariant below re-judges the rest.
  const root = doc.body.firstElementChild;
  const rootStyle = root?.localName.toLowerCase() === "svg" ? root.getAttribute("style") : null;
  if (root && rootStyle !== null) {
    const kept = rootStyle.replace(/[^;{}]+/g, (seg) => (/^\s*max-width\s*:/i.test(seg) ? "" : seg));
    if (kept !== rootStyle) {
      if (/^[\s;]*$/.test(kept)) root.removeAttribute("style");
      else root.setAttribute("style", kept);
    }
  }
  // Invariant: a second pass must change nothing. Anything it would change is dropped whole.
  for (const el of Array.from(doc.body.querySelectorAll("*"))) {
    for (const attr of Array.from(el.attributes)) {
      if (attrValue(attr.name.toLowerCase(), attr.value) !== attr.value) el.removeAttribute(attr.name);
    }
    if (el.localName.toLowerCase() === "style" && scrubCss(el.textContent ?? "") !== el.textContent) el.remove();
  }
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
