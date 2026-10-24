"use client";
// The structured editor for outline.json: sections of slide cards, each with the narrative (title, point, narration,
// time) and the visual direction (explainer, techniques, concept, interaction, beats, 3D, entry and exit) together.
// Renders read-only when !editing.
import type { ReactNode } from "react";
import { EXPLAINERS, INTERACTIONS, type Outline, type OutlineSlide, type Visual } from "@/lib/types";
import { IconPlus, IconTrash, IconUp } from "./icons";
import { cx } from "./ui";

const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

function Field({ editing, value, onChange, className, multiline, placeholder, label }: { editing: boolean; value: string; onChange: (v: string) => void; className?: string; multiline?: boolean; placeholder?: string; label: string }) {
  if (!editing) return <span className={className}>{value || <span className="text-dim">{placeholder}</span>}</span>;
  if (multiline)
    return <textarea aria-label={label} value={value} rows={3} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={cx("field resize-y leading-[1.55]", className)} />;
  return <input aria-label={label} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={cx("field h-8", className)} />;
}

function SlideId({ id }: { id: string }) {
  return <span className="inline-flex h-5 items-center rounded bg-raised px-1.5 font-mono text-[11px] text-sub">{id}</span>;
}

function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("rounded-xl border border-line bg-panel", className)}>{children}</div>;
}

/** A labelled row in a card's definition list. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="pt-1 text-[12px] text-dim">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

function nextId(ids: string[]): string {
  const n = Math.max(0, ...ids.map((x) => Number(x.slice(1)) || 0)) + 1;
  return `s${String(n).padStart(2, "0")}`;
}

function newSlide(id: string): OutlineSlide {
  return {
    id,
    title: "New slide",
    point: "",
    role: "context",
    callouts: [],
    notes: "",
    budgetSec: 60,
    visual: {
      explainer: "animated-diagram",
      technique: "",
      concept: "",
      why: "",
      layout: "",
      interaction: { kind: "none", description: "" },
      steps: [{ beat: "", motion: "none" }],
      reducedMotion: "",
    },
  };
}

const EXPLAINER_LABEL: Record<Visual["explainer"], string> = {
  "3d-object": "3D object",
  simulation: "Simulation",
  "animated-diagram": "Animated diagram",
  "data-viz": "Chart",
  timeline: "Timeline",
  map: "Map",
  comparison: "Comparison",
  quote: "Quote",
  typographic: "Typographic",
  "image-led": "Illustration",
};

function TalkLength({ total, targetMinutes }: { total: number; targetMinutes: number }) {
  const target = targetMinutes * 60;
  const off = total - target;
  return (
    <div className="flex items-center gap-4 rounded-xl border border-line bg-panel px-4 py-3">
      <span className="text-[12.5px] text-sub">Talk length</span>
      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-line">
        <div className={cx("absolute inset-y-0 left-0 rounded-full", Math.abs(off) <= 60 ? "bg-ok" : "bg-ember")} style={{ width: `${Math.min(100, (total / target) * 100)}%` }} />
      </div>
      <span className="font-mono text-[12.5px] text-fg">{fmt(total)}</span>
      <span className="font-mono text-[12.5px] text-dim">/ {fmt(target)}</span>
    </div>
  );
}

function SlideCard({ slide: s, n, editing, set, move, remove }: { slide: OutlineSlide; n: number; editing: boolean; set: (fn: (x: OutlineSlide) => void) => void; move?: { up: boolean; down: boolean; go: (d: -1 | 1) => void }; remove: () => void }) {
  const v = s.visual;
  const interactive = v.interaction.kind !== "none";
  return (
    <Card className="px-5 py-4">
      <div className="flex items-center gap-3">
        <span className="w-5 text-right font-mono text-[12px] text-dim">{n}</span>
        <SlideId id={s.id} />
        <Field editing={editing} label={`${s.id} title`} value={s.title} onChange={(t) => set((x) => void (x.title = t))} className="min-w-0 flex-1 text-[14.5px] font-medium text-fg" />
        {editing ? (
          <label className="flex items-center gap-1.5 text-[12px] text-dim">
            <input aria-label={`${s.id} seconds`} type="number" min={10} step={10} value={s.budgetSec} onChange={(e) => set((x) => void (x.budgetSec = Math.max(10, Math.round(Number(e.target.value)) || 10)))} className="field h-7 w-[72px] px-2 py-0 font-mono text-[12px]" />
            sec
          </label>
        ) : (
          <span className="font-mono text-[12px] text-dim">{fmt(s.budgetSec)}</span>
        )}
        {editing && move && (
          <div className="flex items-center">
            <button type="button" aria-label={`Move ${s.id} up`} disabled={!move.up} onClick={() => move.go(-1)} className="rounded p-0.5 text-dim hover:text-fg disabled:opacity-30">
              <IconUp size={14} />
            </button>
            <button type="button" aria-label={`Move ${s.id} down`} disabled={!move.down} onClick={() => move.go(1)} className="rounded p-0.5 text-dim hover:text-fg disabled:opacity-30">
              <IconUp size={14} className="rotate-180" />
            </button>
            <button type="button" aria-label={`Remove ${s.id}`} onClick={remove} className="rounded p-0.5 text-dim hover:text-bad">
              <IconTrash size={14} />
            </button>
          </div>
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2">
        {/* What it says */}
        <dl className="grid grid-cols-[76px_1fr] content-start gap-x-3 gap-y-2.5 text-[13px]">
          <Row label="Point">
            <Field editing={editing} multiline label={`${s.id} point`} value={s.point} placeholder="The one point this slide makes" onChange={(t) => set((x) => void (x.point = t))} className="text-fg" />
          </Row>
          <Row label="Narration">
            <Field editing={editing} multiline label={`${s.id} narration`} value={s.notes} placeholder="What the presenter says" onChange={(t) => set((x) => void (x.notes = t))} className="leading-[1.6] text-sub" />
          </Row>
        </dl>

        {/* How it shows it */}
        <dl className="grid grid-cols-[76px_1fr] content-start gap-x-3 gap-y-2.5 border-line text-[13px] md:border-l md:pl-6">
          <Row label="Visual">
            <div className="flex flex-wrap items-center gap-2">
              {editing ? (
                <select aria-label={`${s.id} explainer`} value={v.explainer} onChange={(e) => set((x) => void (x.visual.explainer = e.target.value as Visual["explainer"]))} className="field h-7 w-auto px-2 py-0 text-[12px]">
                  {EXPLAINERS.map((k) => (
                    <option key={k} value={k}>
                      {EXPLAINER_LABEL[k]}
                    </option>
                  ))}
                </select>
              ) : (
                <span className={cx("rounded-full px-2 py-0.5 text-[11.5px] font-medium", v.explainer === "3d-object" ? "bg-ember/12 text-ember" : v.explainer === "simulation" ? "bg-review/12 text-review" : "bg-raised text-sub")}>
                  {EXPLAINER_LABEL[v.explainer] ?? v.explainer}
                </span>
              )}
              <Field editing={editing} label={`${s.id} techniques`} value={v.technique} placeholder="technique ids" onChange={(t) => set((x) => void (x.visual.technique = t))} className="min-w-0 flex-1 font-mono text-[11.5px] text-dim" />
            </div>
          </Row>
          <Row label="Concept">
            <Field editing={editing} multiline label={`${s.id} concept`} value={v.concept} placeholder="What the viewer sees" onChange={(t) => set((x) => void (x.visual.concept = t))} className="text-sub" />
          </Row>
          <Row label="Interaction">
            {editing ? (
              <div className="space-y-1.5">
                <select aria-label={`${s.id} interaction kind`} value={v.interaction.kind} onChange={(e) => set((x) => void (x.visual.interaction.kind = e.target.value as Visual["interaction"]["kind"]))} className="field h-7 w-auto px-2 py-0 text-[12px]">
                  {INTERACTIONS.map((k) => (
                    <option key={k} value={k}>
                      {k === "none" ? "None (steps only)" : k}
                    </option>
                  ))}
                </select>
                {interactive && <Field editing label={`${s.id} interaction`} value={v.interaction.description} placeholder="What the viewer does and what changes" onChange={(t) => set((x) => void (x.visual.interaction.description = t))} className="text-sub" />}
              </div>
            ) : (
              <span className="text-sub">{interactive ? `${v.interaction.kind}: ${v.interaction.description}` : "None (steps only)"}</span>
            )}
          </Row>
          <Row label="Beats">
            {editing ? (
              <Field
                editing
                multiline
                label={`${s.id} motion beats`}
                value={v.steps.map((b) => b.beat).join("\n")}
                onChange={(t) =>
                  set((x) => {
                    const beats = t.split("\n").slice(0, 8);
                    x.visual.steps = (beats.length ? beats : [""]).map((beat, i) => ({ beat, motion: x.visual.steps[i]?.motion ?? "none" }));
                  })
                }
                className="text-sub"
              />
            ) : (
              <ol className="flex flex-wrap items-center gap-1.5">
                {v.steps.map((b, j) => (
                  <li key={j} className="flex items-center gap-1.5 text-sub">
                    {j > 0 && <span className="text-dim">→</span>}
                    <span className="rounded-md border border-line px-1.5 py-0.5 text-[12px]">{b.beat}</span>
                  </li>
                ))}
              </ol>
            )}
          </Row>
          {v.object3d && (
            <Row label="3D object">
              <div className="space-y-1.5">
                <Field editing={editing} label={`${s.id} 3D object`} value={v.object3d.name} onChange={(t) => set((x) => void (x.visual.object3d!.name = t))} className="text-sub" />
                {editing ? (
                  <div className="flex flex-wrap gap-1.5">
                    {v.object3d.parts.map((p, j) => (
                      <input key={j} aria-label={`${s.id} part ${j + 1}`} value={p.label} onChange={(e) => set((x) => void (x.visual.object3d!.parts[j]!.label = e.target.value))} className="field h-7 w-[124px] px-2 py-0 text-[12px]" />
                    ))}
                  </div>
                ) : (
                  <p className="text-[12px] text-dim">{v.object3d.parts.map((p) => p.label).join(" · ")}</p>
                )}
              </div>
            </Row>
          )}
          {(v.entry !== undefined || v.exit !== undefined || editing) && (
            <Row label="Hand-off">
              <div className="flex flex-col gap-1.5 text-[12.5px]">
                <span className="flex items-baseline gap-2">
                  <span className="w-8 shrink-0 text-[11px] text-dim">in</span>
                  <Field editing={editing} label={`${s.id} entry`} value={v.entry ?? ""} placeholder="State at the first step" onChange={(t) => set((x) => void (x.visual.entry = t || undefined))} className="min-w-0 flex-1 text-sub" />
                </span>
                <span className="flex items-baseline gap-2">
                  <span className="w-8 shrink-0 text-[11px] text-dim">out</span>
                  <Field editing={editing} label={`${s.id} exit`} value={v.exit ?? ""} placeholder="State at the last step" onChange={(t) => set((x) => void (x.visual.exit = t || undefined))} className="min-w-0 flex-1 text-sub" />
                </span>
              </div>
            </Row>
          )}
        </dl>
      </div>
    </Card>
  );
}

export function OutlineEditor({ value, editing, onChange, targetMinutes }: { value: Outline; editing: boolean; onChange: (v: Outline) => void; targetMinutes: number }) {
  const set = (fn: (o: Outline) => void) => {
    const o = structuredClone(value);
    fn(o);
    onChange(o);
  };
  const allIds = value.sections.flatMap((s) => s.slides.map((x) => x.id));
  const total = value.sections.reduce((n, s) => n + s.slides.reduce((m, x) => m + x.budgetSec, 0), 0);
  const last = value.sections.length - 1;
  /** Moves a slide one place, across a section boundary at either end. */
  const move = (si: number, i: number, d: -1 | 1) =>
    set((o) => {
      const sec = o.sections[si]!.slides;
      const j = i + d;
      if (j >= 0 && j < sec.length) [sec[i], sec[j]] = [sec[j]!, sec[i]!];
      else {
        const [slide] = sec.splice(i, 1);
        const other = o.sections[si + d]!.slides;
        if (d < 0) other.push(slide!);
        else other.unshift(slide!);
      }
    });
  let n = 0;
  return (
    <div className="space-y-8">
      <TalkLength total={total} targetMinutes={targetMinutes} />
      <div>
        <span className="label mb-1.5">Deck title</span>
        <Field editing={editing} label="Deck title" value={value.title} onChange={(v) => set((o) => void (o.title = v))} className="font-display text-[26px] tracking-[-0.01em] text-fg" />
        {(value.throughline || editing) && (
          <Field editing={editing} multiline label="Throughline" value={value.throughline} placeholder="The one story the deck tells" onChange={(v) => set((o) => void (o.throughline = v))} className="mt-2 block text-[13.5px] leading-[1.6] text-sub" />
        )}
      </div>
      {value.sections.map((sec, si) => (
        <section key={si}>
          <div className="mb-3 flex items-center gap-3">
            <span className="shrink-0 whitespace-nowrap font-mono text-[11px] text-dim">Section {si + 1}</span>
            <Field editing={editing} label={`Section ${si + 1} name`} value={sec.name} onChange={(v) => set((o) => void (o.sections[si]!.name = v))} className="text-[15px] font-semibold text-fg" />
            <span className="font-mono text-[11px] text-dim">{fmt(sec.slides.reduce((m, x) => m + x.budgetSec, 0))}</span>
            {editing && (
              <button type="button" aria-label={`Remove section ${si + 1}`} onClick={() => set((o) => void o.sections.splice(si, 1))} className="ml-auto rounded p-1 text-dim hover:text-bad">
                <IconTrash size={14} />
              </button>
            )}
          </div>
          <ol className="space-y-3">
            {sec.slides.map((sl, i) => (
              <li key={sl.id}>
                <SlideCard
                  slide={sl}
                  n={++n}
                  editing={editing}
                  set={(fn) => set((o) => fn(o.sections[si]!.slides[i]!))}
                  move={{ up: si > 0 || i > 0, down: si < last || i < sec.slides.length - 1, go: (d) => move(si, i, d) }}
                  remove={() => set((o) => void o.sections[si]!.slides.splice(i, 1))}
                />
              </li>
            ))}
          </ol>
          {editing && (
            <button type="button" onClick={() => set((o) => void o.sections[si]!.slides.push(newSlide(nextId(allIds))))} className="mt-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12.5px] text-sub hover:text-fg">
              <IconPlus size={13} /> Add slide
            </button>
          )}
        </section>
      ))}
      {editing && (
        <button type="button" onClick={() => set((o) => void o.sections.push({ name: "New section", slides: [] }))} className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-line-strong px-3 py-2 text-[12.5px] text-sub hover:text-fg">
          <IconPlus size={13} /> Add section
        </button>
      )}
    </div>
  );
}
