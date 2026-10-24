// Cheap static checks of the slide contract. Every message is written for the builder agent to act on.
import { transformSync } from "esbuild";

export class ContractError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`slide contract violations:\n- ${issues.join("\n- ")}`);
    this.issues = issues;
    this.name = "ContractError";
  }
}

export type SlideParts = { section: string; styles: string[]; scripts: string[] };

const attr = (tag: string, name: string): string | undefined => {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3] ?? "") : undefined;
};

/** Index just past the `</section>` closing the section that opens at `start` (handles nesting), or -1. */
function sectionEnd(html: string, start: number): number {
  const re = /<section\b[^>]*>|<\/section\s*>/gi;
  re.lastIndex = start;
  let depth = 0;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[0][1] === "/" ? -1 : 1;
    if (depth === 0) return m.index + m[0].length;
  }
  return -1;
}

/** Splits a top-level selector list on commas that are not inside parentheses or brackets. */
function splitSelectors(prelude: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of prelude) {
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Index of the `}` matching the `{` at `open` (skips strings). */
function blockEnd(css: string, open: number): number {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    const ch = css[i];
    if (ch === '"' || ch === "'") {
      const close = css.indexOf(ch, i + 1);
      i = close < 0 ? css.length : close;
    } else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return i;
  }
  return css.length;
}

const GROUPING_AT = /^@(media|supports|container|layer|scope|document)\b/i;

function checkCss(css: string, id: string, issues: string[]): void {
  const scoped = new RegExp(`^#${id}(?![\\w-])`);
  let i = 0;
  while (i < css.length) {
    const brace = css.indexOf("{", i);
    const semi = css.indexOf(";", i);
    if (semi >= 0 && (brace < 0 || semi < brace)) {
      const stmt = css.slice(i, semi).trim();
      if (/^@import\b/i.test(stmt)) issues.push(`${id}: <style> must not use @import (${stmt.slice(0, 80)}); everything must be inline`);
      else if (/^@charset|^@namespace/i.test(stmt)) {
        /* harmless */
      } else if (stmt) issues.push(`${id}: <style> has a stray statement outside any rule: "${stmt.slice(0, 80)}"`);
      i = semi + 1;
      continue;
    }
    if (brace < 0) {
      const rest = css.slice(i).trim();
      if (rest) issues.push(`${id}: <style> has unparsable trailing text: "${rest.slice(0, 80)}"`);
      break;
    }
    const prelude = css.slice(i, brace).trim();
    const end = blockEnd(css, brace);
    const body = css.slice(brace + 1, end);
    if (prelude.startsWith("@")) {
      if (/^@(-webkit-)?keyframes\b/i.test(prelude)) {
        const name = prelude.replace(/^@(-webkit-)?keyframes\s+/i, "").trim().replace(/^["']|["']$/g, "");
        if (!name.startsWith(`${id}-`)) {
          issues.push(`${id}: @keyframes "${name}" must be named with the slide prefix, e.g. "${id}-${name}" (keyframe names are global)`);
        }
      } else if (/^@font-face/i.test(prelude)) {
        issues.push(`${id}: <style> must not declare @font-face; use var(--df-font-display|body|mono), the theme fonts are inlined by the bundler`);
      } else if (/^@import/i.test(prelude)) {
        issues.push(`${id}: <style> must not use @import`);
      } else if (GROUPING_AT.test(prelude)) {
        checkCss(body, id, issues);
      }
    } else {
      for (const sel of splitSelectors(prelude)) {
        if (!scoped.test(sel)) {
          issues.push(`${id}: <style> selector "${sel}" must start with "#${id}" (every rule is scoped to the slide, e.g. "#${id} ${sel.replace(/^(:root|html|body)\b\s*/, "") || ".x"}")`);
        }
      }
    }
    i = end + 1;
  }
}

const EXTERNAL_ATTR = /\b(src|href|xlink:href|srcset|poster|action|data|background)\s*=\s*["']?\s*(?:https?:)?\/\/[^\s"'>]*/gi;
const EXTERNAL_CSS = /url\(\s*["']?\s*(?:https?:)?\/\/[^)"']*/gi;

/** External-resource references in an HTML/CSS string (src/href to http(s), remote url(), @import). */
export function externalRefs(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(EXTERNAL_ATTR)) out.push(m[0]);
  for (const m of html.matchAll(EXTERNAL_CSS)) out.push(m[0]);
  for (const m of html.matchAll(/@import\s+(?:url\()?\s*["']?[^;"')]+/gi)) out.push(m[0]);
  return out;
}

/** Checks one `slides/<id>.html` against the slide contract. Returns its parts and the issues found. */
export function checkSlide(id: string, source: string): { parts: SlideParts; issues: string[] } {
  const issues: string[] = [];
  const parts: SlideParts = { section: "", styles: [], scripts: [] };
  const html = source.replace(/<!--[\s\S]*?-->/g, "");

  if (/<(!doctype|html|head|body|meta|link|base|iframe|object|embed)\b/i.test(html)) {
    const tag = /<(!doctype|html|head|body|meta|link|base|iframe|object|embed)\b/i.exec(html)![1];
    issues.push(`${id}: slide files hold only <section>, <style> and <script>; remove <${tag}>`);
  }

  // Pull out top-level <style> and <script> blocks.
  let rest = html;
  const take = (tag: "style" | "script") => {
    const re = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)<\\/${tag}\\s*>`, "gi");
    const found: { attrs: string; body: string; index: number }[] = [];
    for (const m of rest.matchAll(re)) found.push({ attrs: m[1] ?? "", body: m[2] ?? "", index: m.index });
    return found;
  };

  const opens = [...html.matchAll(/<section\b[^>]*>/gi)];
  const slideOpens = opens.filter((m) => (attr(m[0], "class") ?? "").split(/\s+/).includes("df-slide"));
  if (slideOpens.length !== 1) {
    issues.push(`${id}: expected exactly one <section class="df-slide" id="${id}">, found ${slideOpens.length}`);
  }
  const open = slideOpens[0];
  if (open) {
    const sid = attr(open[0], "id");
    if (sid !== id) issues.push(`${id}: the <section class="df-slide"> must have id="${id}" (found ${sid === undefined ? "no id" : `id="${sid}"`})`);
    const end = sectionEnd(html, open.index);
    if (end < 0) issues.push(`${id}: <section class="df-slide"> is never closed`);
    else {
      parts.section = html.slice(open.index, end);
      rest = html.slice(0, open.index) + html.slice(end);
      if (/<(script|style)\b/i.test(parts.section)) {
        issues.push(`${id}: put <style> and <script> after the </section>, not inside it`);
      }
    }
  }

  for (const s of take("style")) parts.styles.push(s.body);
  for (const s of take("script")) {
    if (attr(s.attrs, "src") !== undefined) issues.push(`${id}: <script src=…> is not allowed; inline the code`);
    const type = attr(s.attrs, "type");
    if (type && !/^(text|application)\/javascript$/i.test(type)) issues.push(`${id}: <script type="${type}"> is not allowed; use a plain classic <script>`);
    parts.scripts.push(s.body);
  }
  const leftover = rest
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .trim();
  if (leftover && open) issues.push(`${id}: unexpected content outside the section/style/script: "${leftover.slice(0, 80)}"`);

  for (const css of parts.styles) checkCss(css.replace(/\/\*[\s\S]*?\*\//g, ""), id, issues);

  const script = parts.scripts.join("\n;\n");
  if (parts.scripts.length) {
    const calls = [...script.matchAll(/\bDF\.slide\(\s*(["'`])([^"'`]*)\1/g)].map((m) => m[2]);
    if (!calls.includes(id)) issues.push(`${id}: the <script> must call DF.slide("${id}", (api) => ({ … }))`);
    for (const other of calls.filter((c) => c !== id)) issues.push(`${id}: DF.slide("${other}") registers another slide id; use "${id}"`);
    try {
      transformSync(script, { loader: "js", logLevel: "silent" });
    } catch (e) {
      const errs = (e as { errors?: { text: string; location?: { line: number; column: number; lineText: string } }[] }).errors ?? [];
      for (const err of errs.slice(0, 3)) {
        const loc = err.location ? ` at script line ${err.location.line}:${err.location.column} ("${err.location.lineText.trim().slice(0, 80)}")` : "";
        issues.push(`${id}: JavaScript syntax error: ${err.text}${loc}`);
      }
      if (!errs.length) issues.push(`${id}: JavaScript syntax error: ${(e as Error).message}`);
    }
  }

  for (const ref of externalRefs(html)) {
    issues.push(`${id}: external reference "${ref.slice(0, 100)}"; the deck must be self-contained (inline data or draw it)`);
  }
  return { parts, issues };
}
