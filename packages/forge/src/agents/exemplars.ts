// Few-shot exemplar slides for the builder, chosen by explainer technique (never by topic).
// Source: fixtures/exemplars/index.json (the engine's technique library); fallback: the proof deck's slides.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FORGE_DIR } from "./prompts.ts";
import type { StoryboardSlide } from "./schemas.ts";

export const EXEMPLAR_LIBRARY = join(FORGE_DIR, "fixtures", "exemplars");
export const FALLBACK_DIRS = [join(FORGE_DIR, "fixtures", "proof", "anc", "slides"), join(FORGE_DIR, "fixtures", "proof", "slides")];
const MAX_EXEMPLAR_CHARS = 20_000;

export type Exemplar = { name: string; html: string; technique?: string; domain?: string; why?: string };

type IndexEntry = Record<string, unknown> & { path?: string; technique?: string; domain?: string };

const str = (v: unknown) => (typeof v === "string" ? v : undefined);

/** Loads the technique library when present, else the proof deck's slides. */
export function loadExemplars(library = EXEMPLAR_LIBRARY, fallbackDirs = FALLBACK_DIRS): Exemplar[] {
  const index = join(library, "index.json");
  if (existsSync(index)) {
    const raw = JSON.parse(readFileSync(index, "utf8")) as IndexEntry[] | { exemplars?: IndexEntry[] };
    const entries = Array.isArray(raw) ? raw : (raw.exemplars ?? []);
    const out: Exemplar[] = [];
    for (const e of entries) {
      const path = str(e.path);
      if (!path || !existsSync(join(library, path))) continue;
      out.push({
        name: path,
        html: readFileSync(join(library, path), "utf8"),
        ...(str(e.technique) ? { technique: str(e.technique)! } : {}),
        ...(str(e.domain) ? { domain: str(e.domain)! } : {}),
        ...(() => {
          const why = str(e.whatMakesItGood) ?? str(e.what_makes_it_good) ?? str(e.good) ?? str(e.why) ?? str(e["what makes it good"]);
          return why ? { why } : {};
        })(),
      });
    }
    if (out.length) return out;
  }
  for (const dir of fallbackDirs) {
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir)
      .filter((f) => /^s\d{2}\.html$/.test(f))
      .sort();
    if (files.length) return files.map((f) => ({ name: f, html: readFileSync(join(dir, f), "utf8") }));
  }
  return [];
}

const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));

/** How well an exemplar's technique matches the slide's technique and explainer type. */
function matchScore(e: Exemplar, board: Pick<StoryboardSlide, "explainer" | "technique">): number {
  if (!e.technique) return 0;
  const t = e.technique.toLowerCase();
  if (board.technique && t === board.technique.toLowerCase()) return 10;
  const want = words(`${board.technique ?? ""} ${board.explainer}`);
  let overlap = 0;
  for (const w of words(t)) if (want.has(w)) overlap++;
  return overlap;
}

/**
 * 2–3 exemplars for a slide. With technique metadata: the closest techniques first, then other techniques
 * from different domains (for API craft breadth). Without it (proof-deck fallback): one 3D, one 2D.
 */
export function pickExemplars(all: Exemplar[], board: Pick<StoryboardSlide, "explainer" | "technique">, max = 3): Exemplar[] {
  const fits = all.filter((e) => e.html.length <= MAX_EXEMPLAR_CHARS);
  if (fits.some((e) => e.technique)) {
    const ranked = fits.map((e) => ({ e, s: matchScore(e, board) })).sort((a, b) => b.s - a.s || a.e.html.length - b.e.html.length);
    const picked = ranked.filter((r) => r.s > 0).slice(0, max).map((r) => r.e);
    for (const r of ranked) {
      if (picked.length >= 2) break;
      if (!picked.includes(r.e) && !picked.some((p) => p.domain && p.domain === r.e.domain)) picked.push(r.e);
    }
    return picked.slice(0, max);
  }
  // Proof-deck fallback: prefer the richest mechanisms (animation loop, controls, steps), never a static text slide.
  const is3d = (e: Exemplar) => /\.three\(/.test(e.html);
  const richness = (e: Exemplar) =>
    [/onFrame\(/, /<input|<button|df-btn|df-range/, /\bstep\s*\(/, /toSlide\(/].filter((re) => re.test(e.html)).length;
  const want3d = board.explainer === "3d-object";
  const byRich = (a: Exemplar, b: Exemplar) => richness(b) - richness(a) || a.html.length - b.html.length;
  const same = fits.filter((e) => is3d(e) === want3d && richness(e) >= 2).sort(byRich);
  const other = fits.filter((e) => is3d(e) !== want3d && richness(e) >= 2).sort(byRich);
  return [...same.slice(0, 1), ...other.slice(0, 1)];
}

export function exemplarSection(exemplars: Exemplar[]): string {
  if (!exemplars.length) return "";
  let s =
    "\n\n## Exemplar slides (craft and API usage only)\n\n" +
    "Hand-built slides that meet the bar and follow the contract, chosen for their *technique*. Study how they structure the fragment, " +
    "use `api` (steps, onFrame, three, toSlide, on), animate, label and stay inside the canvas. **Do not copy their subject, wording, " +
    "palette, layout or composition**: your slide's subject, words and colours come from the brief, and its composition from the storyboard.\n";
  for (const e of exemplars) {
    const meta = [e.technique && `technique: ${e.technique}`, e.why && `why it works: ${e.why}`].filter(Boolean).join(" · ");
    s += `\n### ${e.name}${meta ? `\n\n${meta}` : ""}\n\n\`\`\`html\n${e.html.trim()}\n\`\`\`\n`;
  }
  return s;
}
