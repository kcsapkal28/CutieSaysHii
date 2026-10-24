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

export function fakeEngine(
  opts: { steps?: number; errors?: (deckFile: string) => string[]; bundleError?: (outFile: string) => Error | undefined } = {},
): FakeEngine {
  const bundles: FakeEngine["bundles"] = [];
  const shoots: string[] = [];
  return {
    bundles,
    shoots,
    async bundle({ config, slides, outFile }) {
      bundles.push({ outFile, ids: config.slides.map((s) => s.id) });
      const err = opts.bundleError?.(outFile);
      if (err) throw err;
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
  designStyle: "dark-cinematic",
  surface: { radius: "soft", border: "hairline", depth: "soft", texture: "grain" },
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

/** The outline's first pass (plan_arc): two sections of one slide each. */
export const arcOut = (explainers: [string, string] = ["animated-diagram", "simulation"]) => ({
  title: "Inside ANC",
  subtitle: "The engineering behind silence",
  throughline: "Noise is cancelled by its own inverse.",
  visualThroughline: "One earbud, four signal colours.",
  motifs: ["cyan anti-noise particles"],
  sections: [
    {
      name: "Hook",
      slides: [
        { point: "An earbud can erase sound.", role: "opener", budgetSec: 60, explainer: explainers[0], technique: "particle-flow", composition: "hero right, title left", interaction: "none", handoff: "the noise wave" },
      ],
    },
    {
      name: "How",
      slides: [
        { point: "Inverted waves cancel.", role: "mechanism", budgetSec: 90, explainer: explainers[1], technique: "parametric-sim", composition: "full-width wave, slider below", interaction: "slider", handoff: "cut" },
      ],
    },
  ],
});

/** The outline's second pass (write_card): one slide's words and visual. */
export const cardOut = (id = "s01", visual: Record<string, unknown> = {}) => ({
  title: `Claim for ${id}`,
  callouts: ["Outer mic"],
  notes: "Say this.",
  visual: {
    concept: "Two waves sum to flat.",
    why: "Shows cancellation directly.",
    layout: "Wave centre, title top-left.",
    interaction: { kind: "slider", description: "Drag phase." },
    steps: [
      { beat: "Noise wave", motion: "draw" },
      { beat: "Anti-noise added", motion: "fade" },
    ],
    simulation: { model: "sum of two sines", controls: ["phase"], readouts: ["residual dB"] },
    reducedMotion: "Both waves and the flat sum.",
    entry: "The noise wave alone.",
    exit: "A flat line.",
    ...visual,
  },
});

// ---- the old three-file shapes (before outline, script and storyboard were one stage), for migration tests ----

export const legacyOutline = {
  title: "Inside ANC",
  subtitle: "The engineering behind silence",
  throughline: "Noise is cancelled by its own inverse.",
  totalSec: 480,
  sections: [
    { name: "Hook", slides: [{ id: "s01", keyMessage: "An earbud can erase sound.", role: "opener", budgetSec: 190 }] },
    { name: "How", slides: [{ id: "s02", keyMessage: "Inverted waves cancel.", role: "mechanism", budgetSec: 290 }] },
  ],
};

export const legacyScript = {
  title: "Inside ANC",
  slides: [
    { id: "s01", title: "Claim for s01", callouts: ["Outer mic"], notes: "Say this.", budgetSec: 190, section: "Hook" },
    { id: "s02", title: "Claim for s02", subtitle: "Edited caption", callouts: [], notes: "Then this.", budgetSec: 290, section: "How" },
  ],
};

export const legacyStoryboard = (ids = ["s01", "s02"], explainer = "animated-diagram") => ({
  visualThroughline: "One earbud, four signal colours.",
  motifs: ["cyan anti-noise particles"],
  slides: ids.map((id) => ({
    id,
    concept: "Two waves sum to flat.",
    explainer,
    technique: "parametric-sim",
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
