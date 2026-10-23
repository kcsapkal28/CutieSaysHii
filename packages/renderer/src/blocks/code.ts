import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import plaintext from "highlight.js/lib/languages/plaintext";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

const LANGUAGES = { bash, css, go, java, javascript, json, plaintext, python, rust, sql, typescript, xml, yaml };
for (const [name, def] of Object.entries(LANGUAGES)) hljs.registerLanguage(name, def);

const TAG = /<(\/?)span\b[^>]*>/g;

// hljs spans can cross newlines; close them at each line end and reopen on the next
// so every df-line is balanced HTML on its own.
function splitLines(html: string): string[] {
  const open: string[] = [];
  return html.split("\n").map((line) => {
    const prefix = open.join("");
    for (const m of line.matchAll(TAG)) {
      if (m[1]) open.pop();
      else open.push(m[0]);
    }
    return prefix + line + "</span>".repeat(open.length);
  });
}

export function highlightCode(lang: string, code: string, highlightLines: number[] = []): string {
  const language = hljs.getLanguage(lang) ? lang : "plaintext";
  const html = hljs.highlight(code.replace(/\n$/, ""), { language, ignoreIllegals: true }).value;
  const marked = new Set(highlightLines);
  return splitLines(html)
    .map((line, i) => {
      const n = i + 1;
      return `<span class="df-line" data-line="${n}"${marked.has(n) ? " data-df-highlight" : ""}>${line}</span>`;
    })
    .join("\n");
}
