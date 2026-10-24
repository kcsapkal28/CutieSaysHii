// Static checks of a builder's fragment before it goes to the browser: the engine's contract check (the same one the
// bundler enforces) plus a few agent-side rules the bundler doesn't need.
import { checkSlide } from "../check.ts";

export function checkSlideHtml(html: string, id: string): string[] {
  const { parts, issues } = checkSlide(id, html);
  const css = parts.styles.join("\n").replace(/\/\*[\s\S]*?\*\//g, "");
  const js = parts.scripts.join("\n");
  if (/\b\d+(\.\d+)?(vw|vh|vmin|vmax)\b/.test(css)) issues.push(`${id}: no viewport units (vw/vh); lay out in px on the 1920×1080 canvas`);
  if (/^\s*import\s[\w{*]|\bimport\s*\(/m.test(js)) issues.push(`${id}: no import statements; use api.THREE and api.gsap`);
  if (/\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket/.test(js)) issues.push(`${id}: no network access (fetch/XHR/WebSocket)`);
  if (parts.section && !/<aside\b[^>]*class\s*=\s*["'][^"']*\bdf-notes\b/i.test(parts.section)) {
    issues.push(`${id}: put the speaker notes in <aside class="df-notes"> inside the section`);
  }
  return [...new Set(issues)];
}
