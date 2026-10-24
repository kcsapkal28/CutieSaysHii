// The pipeline's stage files (packages/forge/src/agents/schemas.ts) are richer than what the Studio's editors show
// (lib/types.ts). These map a pipeline file to the editor's view, and merge an edited view back into the original,
// keeping every field the editor doesn't know about.
import type { Outline as FOutline, Script as FScript, Storyboard as FStoryboard } from "@deckforge/forge/pipeline";
import type { Outline, Script, Storyboard, VisualType } from "../types";

const ROLES = ["opener", "context", "mechanism", "evidence", "comparison", "tradeoff", "recap", "closer"];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------------------------------------------------------------- outline
export function outlineView(o: FOutline): Outline {
  return {
    title: o.title,
    sections: o.sections.map((s) => ({ name: s.name, slides: s.slides.map((x) => ({ id: x.id, title: cap(x.role), point: x.keyMessage })) })),
  };
}

export function mergeOutline(o: FOutline, v: Outline): FOutline {
  const byId = new Map(o.sections.flatMap((s) => s.slides).map((x) => [x.id, x]));
  const sections = v.sections.map((s) => ({
    name: s.name,
    slides: s.slides.map((x) => {
      const prev = byId.get(x.id);
      const role = ROLES.includes(x.title.trim().toLowerCase()) ? x.title.trim().toLowerCase() : (prev?.role ?? "context");
      return { id: x.id, keyMessage: x.point, role, budgetSec: prev?.budgetSec ?? 30 };
    }),
  }));
  const totalSec = sections.reduce((n, s) => n + s.slides.reduce((m, x) => m + x.budgetSec, 0), 0);
  return { ...o, title: v.title, sections, totalSec };
}

// ---------------------------------------------------------------- script
const keyMessages = (o: FOutline | null) => new Map((o?.sections ?? []).flatMap((s) => s.slides).map((x) => [x.id, x.keyMessage]));

export function scriptView(s: FScript, o: FOutline | null): Script {
  const km = keyMessages(o);
  return {
    slides: s.slides.map((x) => ({ id: x.id, title: x.title, keyMessage: x.subtitle ?? km.get(x.id) ?? "", narration: x.notes, budgetSec: x.budgetSec })),
  };
}

export function mergeScript(s: FScript, o: FOutline | null, v: Script): FScript {
  const before = new Map(scriptView(s, o).slides.map((x) => [x.id, x]));
  const edits = new Map(v.slides.map((x) => [x.id, x]));
  return {
    ...s,
    slides: s.slides
      .filter((x) => edits.has(x.id))
      .map((x) => {
        const e = edits.get(x.id)!;
        const keyChanged = e.keyMessage !== before.get(x.id)?.keyMessage;
        return { ...x, title: e.title, notes: e.narration, budgetSec: Math.max(1, Math.round(e.budgetSec)), ...(keyChanged ? { subtitle: e.keyMessage } : {}) };
      }),
  };
}

// ---------------------------------------------------------------- storyboard
type Explainer = FStoryboard["slides"][number]["explainer"];
const TO_VISUAL: Record<Explainer, VisualType> = {
  "3d-object": "3d-object",
  simulation: "simulation",
  "animated-diagram": "diagram",
  "data-viz": "chart",
  timeline: "diagram",
  map: "diagram",
  comparison: "comparison",
  quote: "typographic",
  typographic: "typographic",
  "image-led": "diagram",
};
const TO_EXPLAINER: Record<VisualType, Explainer> = {
  "3d-object": "3d-object",
  simulation: "simulation",
  diagram: "animated-diagram",
  chart: "data-viz",
  typographic: "typographic",
  comparison: "comparison",
};

export function storyboardView(b: FStoryboard): Storyboard {
  return {
    slides: b.slides.map((x) => ({
      id: x.id,
      layout: x.concept,
      visual: TO_VISUAL[x.explainer] ?? "diagram",
      interaction: x.interaction.kind === "none" ? "None" : x.interaction.description,
      motionBeats: x.steps.map((s) => s.beat),
      ...(x.object3d ? { object3d: `${x.object3d.name}: ${x.object3d.parts.map((p) => p.label).join(", ")}` } : {}),
    })),
  };
}

export function mergeStoryboard(b: FStoryboard, v: Storyboard): FStoryboard {
  const before = new Map(storyboardView(b).slides.map((x) => [x.id, x]));
  const edits = new Map(v.slides.map((x) => [x.id, x]));
  return {
    ...b,
    slides: b.slides.map((x) => {
      const e = edits.get(x.id);
      const prev = before.get(x.id);
      if (!e || !prev) return x;
      const beats = e.motionBeats.map((s) => s.trim()).filter(Boolean);
      return {
        ...x,
        concept: e.layout,
        explainer: e.visual !== prev.visual ? TO_EXPLAINER[e.visual] : x.explainer,
        interaction: e.interaction !== prev.interaction ? { ...x.interaction, description: e.interaction } : x.interaction,
        steps: beats.length ? beats.slice(0, 8).map((beat, i) => ({ beat, motion: x.steps[i]?.motion ?? "none" })) : x.steps,
      };
    }),
  };
}
