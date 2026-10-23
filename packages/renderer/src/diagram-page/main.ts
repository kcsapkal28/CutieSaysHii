/// <reference lib="dom" />
// Entry of the in-page diagram code. bundleDiagramPage() compiles this with esbuild into one classic-script
// IIFE, so what runs in the page never depends on how the build-time module was transpiled (tsx, vitest, …).
import { sanitiseSvg } from "./sanitise.ts";

export type Job = { id: string; key: string; source: string };
export type Outcome = { key: string; svg?: string; error?: string };
export type RenderRequest = { config: Record<string, unknown>; jobs: Job[]; timeoutMs: number };

type MermaidApi = {
  initialize(config: Record<string, unknown>): void;
  render(id: string, source: string): Promise<{ svg: string }>;
};

async function renderJobs({ config, jobs, timeoutMs }: RenderRequest): Promise<Outcome[]> {
  const { mermaid } = globalThis as unknown as { mermaid: MermaidApi };
  mermaid.initialize(config);

  const out: Outcome[] = [];
  for (const job of jobs) {
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
}

export type DiagramPageApi = { renderJobs: typeof renderJobs; sanitiseSvg: typeof sanitiseSvg };

(globalThis as unknown as { deckforgeDiagrams: DiagramPageApi }).deckforgeDiagrams = { renderJobs, sanitiseSvg };
