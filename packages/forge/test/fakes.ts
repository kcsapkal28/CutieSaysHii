// Test doubles: a scripted LLM transport (routes by tool name) and an in-memory Engine.
import { writeFileSync } from "node:fs";
import type { Engine, ShootResult } from "../src/contract.ts";
import { createLlm, type Llm, type WireRequest, type WireResponse } from "../src/llm.ts";

export type Handler = (req: WireRequest, call: number) => unknown;

export type FakeLlm = Llm & { requests: WireRequest[]; calls: Record<string, number> };

/** Every request is answered by the handler for its tool (or "text" for callText), with the returned input. */
export function fakeLlm(handlers: Record<string, Handler>): FakeLlm {
  const requests: WireRequest[] = [];
  const calls: Record<string, number> = {};
  let ids = 0;
  const llm = createLlm({
    sleep: async () => {},
    transport: async (req): Promise<WireResponse> => {
      requests.push(structuredClone(req));
      const name = req.tools?.[0]?.name ?? "text";
      const handler = handlers[name];
      if (!handler) throw new Error(`fake llm: no handler for ${name}`);
      const n = (calls[name] = (calls[name] ?? 0) + 1);
      const out = handler(req, n);
      const usage = { input_tokens: 100, output_tokens: 10 };
      if (name === "text") return { content: [{ type: "text", text: String(out) }], stop_reason: "end_turn", usage };
      return { content: [{ type: "tool_use", id: `tu_${++ids}`, name, input: out }], stop_reason: "tool_use", usage };
    },
  });
  return Object.assign(llm, { requests, calls });
}

export const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

export type FakeEngine = Engine & { bundles: { outFile: string; ids: string[] }[]; shoots: string[] };

export function fakeEngine(opts: { steps?: number; errors?: (deckFile: string) => string[] } = {}): FakeEngine {
  const bundles: FakeEngine["bundles"] = [];
  const shoots: string[] = [];
  return {
    bundles,
    shoots,
    async bundle({ config, slides, outFile }) {
      bundles.push({ outFile, ids: config.slides.map((s) => s.id) });
      writeFileSync(outFile, `<!doctype html><title>${config.title}</title>\n${Object.values(slides).join("\n")}`);
    },
    async shoot({ deckFile, slideIds }): Promise<ShootResult> {
      shoots.push(deckFile);
      const ids = slideIds ?? [];
      const steps = opts.steps ?? 2;
      return {
        shots: ids.flatMap((slideId) => Array.from({ length: steps }, (_, step) => ({ slideId, step, png: PNG }))),
        steps: Object.fromEntries(ids.map((id) => [id, steps])),
        errors: Object.fromEntries(ids.map((id) => [id, opts.errors?.(deckFile) ?? []])),
        externalRequests: [],
      };
    },
  };
}

// ---- canned agent outputs ----

export const styleOut = (colors: Partial<Record<string, string>> = {}) => ({
  look: "Dark cinematic teardown",
  rationale: "Hardware reads well dark.",
  dark: true,
  colors: {
    bg: "#0e0c16",
    surface: "#1a1726",
    text: "#f2f0f7",
    muted: "#b4aec6",
    line: "#3a3550",
    accent: "#38c8f0",
    accent2: "#5ee0b0",
    accent3: "#f5b04a",
    ...colors,
  },
  backdrop: "radial-gradient(1400px 900px at 78% 8%, #2a2145 0%, #0e0c16 62%)",
  fonts: { display: "ibm-plex-sans", body: "ibm-plex-sans", mono: "ibm-plex-mono" },
  motion: "rich",
  use3d: true,
  interactivity: 2,
  density: "balanced",
  features: { timer: true, notes: true, stepNav: false, print: false },
});

export const researchOut = {
  summary: "ANC adds an inverted copy of noise.",
  keyFacts: Array.from({ length: 5 }, (_, i) => ({ fact: `Fact ${i}`, detail: "Detail." })),
  numbers: Array.from({ length: 3 }, (_, i) => ({ value: `${i} ms`, what: "latency", context: "typical" })),
  mechanisms: [
    { name: "Feedforward", howItWorks: "Outer mic predicts.", steps: ["sense", "invert", "play"] },
    { name: "Feedback", howItWorks: "Inner mic corrects.", steps: ["sense", "correct"] },
  ],
  visualHooks: ["two waves", "exploded earbud", "spectrum"],
  misconceptions: ["It blocks all sound."],
  glossary: [{ term: "LMS", definition: "Least mean squares." }],
  sources: [{ title: "Adaptive filtering theory", kind: "model-knowledge" }],
};

export const outlineOut = {
  title: "Inside ANC",
  subtitle: "The engineering behind silence",
  throughline: "Noise is cancelled by its own inverse.",
  sections: [
    { name: "Hook", slides: [{ keyMessage: "An earbud can erase sound.", role: "opener", budgetSec: 60 }] },
    { name: "How", slides: [{ keyMessage: "Inverted waves cancel.", role: "mechanism", budgetSec: 90 }] },
  ],
};

export const scriptOut = (ids: string[]) => ({
  slides: ids.map((id) => ({ id, title: `Claim for ${id}`, callouts: ["Outer mic"], notes: "Say this.", budgetSec: 60 })),
});

export const storyboardOut = (ids: string[], explainer = "animated-diagram") => ({
  visualThroughline: "One earbud, four signal colours.",
  motifs: ["cyan anti-noise particles"],
  slides: ids.map((id) => ({
    id,
    concept: "Two waves sum to flat.",
    explainer,
    why: "Shows cancellation directly.",
    layout: "Wave centre, title top-left.",
    interaction: { kind: "slider", description: "Drag phase." },
    steps: [
      { beat: "Noise wave", motion: "draw" },
      { beat: "Anti-noise added", motion: "fade" },
    ],
    reducedMotion: "Both waves and the flat sum.",
  })),
});

export const slideHtml = (id: string, variant = "") =>
  `<section class="df-slide" id="${id}"><h1>Title ${variant}</h1><aside class="df-notes"><p>Notes</p></aside></section>\n` +
  `<style>#${id} h1{font:600 72px var(--df-font-display);color:var(--df-text)}</style>\n` +
  `<script>DF.slide("${id}", (api) => ({ steps: 2, step(i) { api.el.dataset.step = String(i); } }));</script>`;

export const review = (verdict: "pass" | "fix", score = verdict === "pass" ? 8 : 5) => ({
  verdict,
  score,
  summary: verdict === "pass" ? "Good." : "Needs work.",
  issues: verdict === "pass" ? [] : [{ severity: "high", what: "Title clipped", where: "step 1, top", fix: "Reduce to 64px" }],
});
