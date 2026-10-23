/// <reference lib="dom" />
// Entry of the in-page diagram code. bundleDiagramPage() compiles this with esbuild into one classic-script
// IIFE, so what runs in the page never depends on how the build-time module was transpiled (tsx, vitest, …).
import { sanitiseSvg } from "./sanitise.ts";

export type Job = { id: string; key: string; source: string };
export type Outcome = { key: string; svg?: string; error?: string };
export type RenderRequest = {
  config: Record<string, unknown>;
  jobs: Job[];
  timeoutMs: number;
  reservedClasses: string[];
};

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

async function renderJobs({ config, jobs, timeoutMs, reservedClasses }: RenderRequest): Promise<Outcome[]> {
  const { mermaid } = globalThis as unknown as { mermaid: MermaidApi };
  mermaid.initialize(config);

  const out: Outcome[] = [];
  for (const job of jobs) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Reseeded per job: a diagram's svg depends only on its own source, never on the diagrams before it.
    Math.random = seededRandom(RANDOM_SEED);
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timed out")), timeoutMs);
      });
      const { svg } = await Promise.race([mermaid.render(job.id, job.source), timeout]);
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
