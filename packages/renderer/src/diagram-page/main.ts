/// <reference lib="dom" />
// Entry of the in-page diagram code. bundleDiagramPage() compiles this with esbuild into one classic-script
// IIFE, so what runs in the page never depends on how the build-time module was transpiled (tsx, vitest, …).
import { sanitiseSvg } from "./sanitise.ts";

export type Job = { id: string; key: string; source: string };
export type Outcome = { key: string; svg?: string; error?: string };
/** A woff2 face, base64-encoded, so Mermaid measures labels in the font the deck draws them in. */
export type FontData = { family: string; weight: number; base64: string };
export type RenderRequest = {
  config: Record<string, unknown>;
  jobs: Job[];
  timeoutMs: number;
  reservedClasses: string[];
  fonts?: FontData[];
};

// From bytes, never a URL: loading them makes no request.
async function loadFonts(fonts: FontData[]): Promise<void> {
  for (const { family, weight, base64 } of fonts) {
    const bytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
    const face = new FontFace(family, bytes, { weight: String(weight), style: "normal" });
    document.fonts.add(await face.load());
  }
}

type MermaidApi = {
  initialize(config: Record<string, unknown>): void;
  render(id: string, source: string): Promise<{ svg: string }>;
};

const RANDOM_SEED = 0x9e3779b9;

// mulberry32: a fixed sequence in place of Math.random, so mermaid's random shapes (roughjs) render identically.
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Index of the diagram-type line: past any front matter, blank lines, %% comments and %%{init}%% directives.
function typeLine(lines: string[]): number {
  let i = 0;
  while (i < lines.length && !lines[i]!.trim()) i++;
  if (lines[i]?.trim() === "---") {
    const end = lines.findIndex((l, k) => k > i && l.trim() === "---");
    if (end < 0) return -1;
    i = end + 1;
  }
  for (; i < lines.length; i++) {
    const t = lines[i]!.trim();
    // A %%{…}%% directive may span lines: skip to the line that closes it.
    if (t.startsWith("%%{")) {
      while (i < lines.length && !lines[i]!.includes("}%%")) i++;
      continue;
    }
    if (t && !t.startsWith("%%")) return i;
  }
  return -1;
}

// Mermaid's own gantt lexer rule for the directive; a task merely named todayMarker… does not match it.
const TODAY_MARKER = /^\s*todayMarker\s[^\n;]+/i;

// Gantt draws a "today" line from the wall clock; switch it off unless the author configured the marker.
function withoutTodayMarker(source: string): string {
  const lines = source.split("\n");
  const at = typeLine(lines);
  if (at < 0 || !/^gantt\b/.test(lines[at]!.trim())) return source;
  const body = lines.slice(at).filter((l) => !l.trim().startsWith("%%"));
  if (body.some((l) => l.split(";").some((statement) => TODAY_MARKER.test(statement)))) return source;
  lines.splice(at + 1, 0, "todayMarker off");
  return lines.join("\n");
}

// When the theme hides pie wedge labels (no text colour reaches AA on every wedge), the legend shows the values.
function withLegendValues(source: string): string {
  const lines = source.split("\n");
  const at = typeLine(lines);
  const pie = at < 0 ? null : /^\s*pie(?=\s|$)/.exec(lines[at]!);
  if (!pie || /^\s+showData\b/.test(lines[at]!.slice(pie[0].length))) return source;
  lines[at] = `${pie[0]} showData${lines[at]!.slice(pie[0].length)}`;
  return lines.join("\n");
}

async function renderJobs({ config, jobs, timeoutMs, reservedClasses, fonts = [] }: RenderRequest): Promise<Outcome[]> {
  const { mermaid } = globalThis as unknown as { mermaid: MermaidApi };
  await loadFonts(fonts);
  mermaid.initialize(config);
  const vars = config.themeVariables as Record<string, unknown> | undefined;
  const hiddenWedgeText = vars?.pieSectionTextSize === "0px";
  const prepare = (source: string) => {
    const out = withoutTodayMarker(source);
    return hiddenWedgeText ? withLegendValues(out) : out;
  };

  const out: Outcome[] = [];
  for (const job of jobs) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Reseeded per job: a diagram's svg depends only on its own source, never on the diagrams before it.
    Math.random = seededRandom(RANDOM_SEED);
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timed out")), timeoutMs);
      });
      const { svg } = await Promise.race([mermaid.render(job.id, prepare(job.source)), timeout]);
      out.push({ key: job.key, svg: sanitiseSvg(svg, { idPrefix: job.id, reservedClasses }) });
    } catch (e) {
      out.push({ key: job.key, error: e instanceof Error ? e.message : String(e) });
    } finally {
      clearTimeout(timer);
    }
  }
  return out;
}

export type DiagramPageApi = { renderJobs: typeof renderJobs; sanitiseSvg: typeof sanitiseSvg };

(globalThis as unknown as { deckforgeDiagrams: DiagramPageApi }).deckforgeDiagrams = { renderJobs, sanitiseSvg };
