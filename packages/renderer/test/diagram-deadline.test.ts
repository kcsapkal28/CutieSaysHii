import { goldenChoices, resolveTheme } from "@deckforge/catalog";
import { loadCatalog } from "@deckforge/catalog/node";
import type { ThemeSpec } from "@deckforge/schemas";
import { chromium, type Browser } from "playwright";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { diagramKey } from "../src/blocks/render.ts";
import { renderDiagrams } from "../src/diagrams.ts";

// Simulates mermaid's parser stuck in a synchronous loop: a render request naming HANG blocks the page forever.
const HANG_HOOK = `;(() => {
  const api = globalThis.deckforgeDiagrams;
  const renderJobs = api.renderJobs;
  api.renderJobs = (request) => {
    if (request.jobs.some((job) => job.source.includes("HANG"))) for (;;) {}
    return renderJobs(request);
  };
})();`;

vi.mock("../src/bundle.ts", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../src/bundle.ts")>();
  return { ...mod, bundleDiagramPage: async () => (await mod.bundleDiagramPage()) + HANG_HOOK };
});

let theme: ThemeSpec;
beforeAll(async () => {
  const c = await loadCatalog();
  const choices = goldenChoices(c)[0];
  if (!choices) throw new Error("no golden choices");
  theme = resolveTheme(c, choices);
});

const launched: Browser[] = [];
function trackLaunches() {
  const launch = chromium.launch.bind(chromium);
  vi.spyOn(chromium, "launch").mockImplementation(async (...args) => {
    const browser = await launch(...args);
    launched.push(browser);
    return browser;
  });
}
afterEach(() => {
  vi.restoreAllMocks();
  launched.length = 0;
});

const HUNG = "graph TD; HANG-->B";
const GOOD = "graph TD; X-->Y";

describe("renderDiagrams Node-side deadline", () => {
  it("a page hung in a synchronous loop becomes a timed-out warning and later diagrams still render", async () => {
    trackLaunches();
    const t0 = performance.now();
    // Generous enough that GOOD never times out in-page on a loaded machine; HUNG is cut off by Node.
    const { svgs, warnings } = await renderDiagrams([HUNG, GOOD], theme, { timeoutMs: 3_000 });
    expect(performance.now() - t0).toBeLessThan(15_000);
    expect(warnings).toEqual([`diagram ${diagramKey(HUNG)}: timed out`]);
    expect([...svgs.keys()]).toEqual([diagramKey(GOOD)]);
    expect(launched.length).toBeGreaterThan(0);
    for (const b of launched) expect(b.isConnected()).toBe(false);
  }, 60_000);

  it("abort while the page is hung rejects promptly with the reason and closes chromium", async () => {
    trackLaunches();
    const ac = new AbortController();
    const reason = new Error("cancelled by test");
    const run = renderDiagrams([HUNG], theme, { signal: ac.signal });
    await vi.waitFor(() => expect(launched).toHaveLength(1), { timeout: 15_000 });
    await new Promise((r) => setTimeout(r, 1_000));
    const t0 = performance.now();
    ac.abort(reason);
    await expect(run).rejects.toBe(reason);
    expect(performance.now() - t0).toBeLessThan(2_000);
    expect(launched[0]?.isConnected()).toBe(false);
  }, 60_000);
});
