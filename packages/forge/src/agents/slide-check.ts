// Cheap static checks of a builder's slide fragment against the slide contract, before it goes to the browser.

function strip(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Selectors of every style rule, descending into @media/@supports/@container blocks; @keyframes bodies are skipped. */
function selectors(css: string): { selector: string; atRule?: string }[] {
  const out: { selector: string; atRule?: string }[] = [];
  const src = strip(css);
  let i = 0;
  const walk = (end: number, atRule?: string) => {
    while (i < end) {
      const open = src.indexOf("{", i);
      if (open < 0 || open >= end) return;
      const head = src.slice(i, open).trim().replace(/^[;}\s]+/, "");
      // find the matching close brace
      let depth = 1;
      let j = open + 1;
      while (j < src.length && depth > 0) {
        if (src[j] === "{") depth++;
        else if (src[j] === "}") depth--;
        j++;
      }
      if (head.startsWith("@")) {
        if (/^@(media|supports|container|layer)\b/.test(head)) {
          i = open + 1;
          walk(j - 1, head);
        } else {
          out.push({ selector: head, atRule: /^@(-webkit-)?keyframes\b/.test(head) ? "@keyframes" : head });
        }
      } else if (head) {
        for (const sel of head.split(",")) out.push({ selector: sel.trim(), ...(atRule ? { atRule } : {}) });
      }
      i = j;
    }
  };
  walk(src.length);
  return out;
}

/** Contract violations in a slide fragment (empty when it complies). */
export function checkSlideHtml(html: string, id: string): string[] {
  const problems: string[] = [];
  const sections = [...html.matchAll(/<section\b[^>]*>/gi)].map((m) => m[0]);
  const slideSections = sections.filter((s) => /class\s*=\s*["'][^"']*\bdf-slide\b/i.test(s));
  if (slideSections.length !== 1) problems.push(`expected exactly one <section class="df-slide" id="${id}">, found ${slideSections.length}`);
  else if (!new RegExp(`\\bid\\s*=\\s*["']${id}["']`).test(slideSections[0]!)) problems.push(`the df-slide section must have id="${id}"`);
  if (/<(html|head|body|link|meta|iframe)\b/i.test(html)) problems.push("no <html>, <head>, <body>, <link>, <meta> or <iframe>: the fragment holds only the section, a style and a script");

  const styles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]!);
  if (styles.length > 1) problems.push("use at most one <style> element");
  for (const css of styles) {
    for (const { selector, atRule } of selectors(css)) {
      if (atRule === "@keyframes") {
        const name = /keyframes\s+([\w-]+)/.exec(selector)?.[1] ?? "";
        if (!name.startsWith(`${id}-`)) problems.push(`@keyframes "${name}" must be prefixed "${id}-"`);
      } else if (selector.startsWith("@")) {
        if (/^@(font-face|import)/.test(selector)) problems.push(`${selector.split(/\s/)[0]} is not allowed in slide CSS`);
      } else if (!(selector === `#${id}` || selector.startsWith(`#${id} `) || selector.startsWith(`#${id}.`) || selector.startsWith(`#${id}:`) || selector.startsWith(`#${id}[`) || selector.startsWith(`#${id}>`))) {
        problems.push(`CSS selector "${selector}" must start with #${id}`);
      }
    }
    if (/\b\d+(\.\d+)?(vw|vh|vmin|vmax)\b/.test(strip(css))) problems.push("no viewport units (vw/vh): lay out in px on the 1920×1080 canvas");
  }

  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  if (scripts.length > 1) problems.push("use at most one <script> element");
  for (const [, attrs, body] of scripts) {
    if (/type\s*=\s*["']module["']/i.test(attrs!) || /\bsrc\s*=/.test(attrs!)) problems.push("the script must be inline and classic (no type=module, no src)");
    if (!new RegExp(`DF\\.slide\\(\\s*["'\`]${id}["'\`]`).test(body!)) problems.push(`the script must call DF.slide("${id}", (api) => …)`);
    if (/^\s*import\s|\bimport\s*\(/m.test(body!)) problems.push("no import statements: use api.THREE and api.gsap");
    if (/\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket/.test(body!)) problems.push("no network access (fetch/XHR/WebSocket)");
  }

  if (/(?:src|href)\s*=\s*["']https?:|url\(\s*["']?https?:|@import/i.test(html)) problems.push("no external resources (http URLs, @import): the deck must work offline");
  if (!/<aside\b[^>]*class\s*=\s*["'][^"']*\bdf-notes\b/i.test(html)) problems.push('put the speaker notes in <aside class="df-notes"> inside the section');
  return [...new Set(problems)];
}
