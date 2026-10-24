// The engine's exemplar library (fixtures/exemplars): a technique catalogue (TECHNIQUES.md) and hand-built slides
// (index.json). The storyboarder picks technique ids from the catalogue; the builder gets the catalogue entries for its
// slide's techniques plus 2–3 exemplar slides chosen by technique overlap, never by topic.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FORGE_DIR } from "./prompts.ts";
import type { StoryboardSlide } from "./schemas.ts";

export const EXEMPLAR_DIR = join(FORGE_DIR, "fixtures", "exemplars");
const MAX_EXEMPLAR_CHARS = 24_000;

export type Exemplar = {
  id: string;
  html: string;
  techniques: string[];
  domain: string;
  /** The exemplar deck's theme summary (palette and fonts), to steer away from copying it. */
  theme: string;
  deck: string;
  why: string;
};

export type Catalogue = { rules: string; techniques: Map<string, string> };

/** Parses TECHNIQUES.md: the shared rules section plus one entry per "## `id`" heading. */
export function loadCatalogue(dir = EXEMPLAR_DIR): Catalogue | undefined {
  const file = join(dir, "TECHNIQUES.md");
  if (!existsSync(file)) return undefined;
  const md = readFileSync(file, "utf8");
  const parts = md.split(/^(?=## )/m);
  const techniques = new Map<string, string>();
  let rules = "";
  for (const part of parts) {
    const id = /^## `([a-z0-9-]+)`/.exec(part)?.[1];
    if (id) techniques.set(id, part.trim());
    else if (/^## /.test(part)) rules += `${part.trim()}\n`;
  }
  return { rules: rules.trim(), techniques };
}

/** The full catalogue text, for the storyboarder. */
export function catalogueText(dir = EXEMPLAR_DIR): string {
  const file = join(dir, "TECHNIQUES.md");
  return existsSync(file) ? readFileSync(file, "utf8").trim() : "";
}

type IndexFile = {
  decks?: { id: string; dir: string; theme: string }[];
  slides?: { id: string; path: string; techniques?: string[]; domain?: string; theme?: string; whatMakesItGood?: string }[];
};

/** Loads every exemplar slide listed in index.json (paths relative to packages/forge). Empty when absent. */
export function loadExemplars(dir = EXEMPLAR_DIR, forgeDir = FORGE_DIR): Exemplar[] {
  const file = join(dir, "index.json");
  if (!existsSync(file)) return [];
  const index = JSON.parse(readFileSync(file, "utf8")) as IndexFile;
  const decks = new Map((index.decks ?? []).map((d) => [d.id, d.theme]));
  return (index.slides ?? []).flatMap((s) => {
    const path = join(forgeDir, s.path);
    if (!existsSync(path)) return [];
    return [
      {
        id: s.id,
        html: readFileSync(path, "utf8"),
        techniques: s.techniques ?? [],
        domain: s.domain ?? "",
        theme: decks.get(s.theme ?? "") ?? s.theme ?? "",
        deck: s.theme ?? s.id.split("/")[0]!,
        why: s.whatMakesItGood ?? "",
      },
    ];
  });
}

/** Catalogue techniques that usually implement each explainer type (used when the storyboard's ids don't match). */
export const EXPLAINER_TECHNIQUES: Record<StoryboardSlide["explainer"], string[]> = {
  "3d-object": ["procedural-3d", "exploded-3d", "annotated-labels"],
  simulation: ["parametric-sim"],
  "animated-diagram": ["particle-flow", "step-through-pipeline", "packet-channel", "process-loop", "network-graph", "layered-stack", "equation-build"],
  "data-viz": ["data-story"],
  timeline: ["timeline"],
  map: ["map-geo"],
  comparison: ["comparison"],
  quote: ["typographic-statement"],
  typographic: ["typographic-statement"],
  "image-led": ["title-hero", "zoom-scale", "annotated-labels"],
};

/** The slide's technique ids: the storyboard's (comma/space separated), else the explainer's usual ones. */
export function slideTechniques(board: Pick<StoryboardSlide, "explainer" | "technique">): { primary: string[]; fallback: string[] } {
  const primary = (board.technique ?? "")
    .toLowerCase()
    .split(/[\s,+/]+/)
    .filter(Boolean);
  return { primary, fallback: EXPLAINER_TECHNIQUES[board.explainer] ?? [] };
}

const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3));

/**
 * 2–3 exemplars by technique overlap. Ties prefer a different deck, and a theme and domain unlike the deck being built
 * (`avoid`: e.g. the style's look plus the topic), so the builder learns craft rather than copying a look.
 */
export function pickExemplars(
  all: Exemplar[],
  board: Pick<StoryboardSlide, "explainer" | "technique">,
  opts: { avoid?: string; max?: number } = {},
): Exemplar[] {
  const max = opts.max ?? 3;
  const { primary, fallback } = slideTechniques(board);
  const avoid = words(opts.avoid ?? "");
  const scored = all
    .filter((e) => e.html.length <= MAX_EXEMPLAR_CHARS)
    .map((e) => {
      const direct = e.techniques.filter((t) => primary.includes(t)).length;
      const usual = e.techniques.filter((t) => fallback.includes(t)).length;
      let similar = 0;
      for (const w of words(`${e.theme} ${e.domain}`)) if (avoid.has(w)) similar++;
      return { e, score: direct * 10 + usual * 3 - similar * 0.5 - (e.techniques.includes("key-takeaways") ? 5 : 0) };
    })
    .sort((a, b) => b.score - a.score || a.e.html.length - b.e.html.length);

  const picked: Exemplar[] = [];
  for (const { e, score } of scored) {
    if (picked.length >= max) break;
    if (score <= 0 && picked.length >= 2) break;
    // One per deck while other decks remain, so the builder sees more than one visual language.
    if (picked.some((p) => p.deck === e.deck) && scored.some((r) => r.score === score && !picked.some((p) => p.deck === r.e.deck))) continue;
    picked.push(e);
  }
  return picked;
}

export function exemplarSection(exemplars: Exemplar[], board?: Pick<StoryboardSlide, "explainer" | "technique">, catalogue = loadCatalogue()): string {
  let s = "";
  if (catalogue && board) {
    const { primary, fallback } = slideTechniques(board);
    const ids = [...new Set([...primary, ...(primary.some((t) => catalogue.techniques.has(t)) ? [] : fallback.slice(0, 2))])];
    const entries = ids.flatMap((id) => (catalogue.techniques.has(id) ? [catalogue.techniques.get(id)!] : []));
    s += `\n\n## Technique guide\n\n${catalogue.rules}\n\n${entries.join("\n\n")}\n`;
  }
  if (!exemplars.length) return s;
  s +=
    "\n\n## Exemplar slides (craft and API usage only)\n\n" +
    "Hand-built slides that meet the bar and follow the contract, chosen for their *technique*. Study how they structure the fragment, " +
    "use `api` (steps, onFrame, three, toSlide, on, setStep), animate, label and stay inside the canvas. **Do not copy their subject, wording, " +
    "palette, layout or composition**: your slide's subject, words and colours come from the brief, and its composition from the storyboard.\n";
  for (const e of exemplars) {
    s += `\n### ${e.id} · techniques: ${e.techniques.join(", ")}\n\nWhy it works: ${e.why}\n\n\`\`\`html\n${e.html.trim()}\n\`\`\`\n`;
  }
  return s;
}
