"use client";
// Structured editors for outline.json, script.json and storyboard.json. Each renders read-only when !editing.
import type { ReactNode } from "react";
import { VISUAL_TYPES, type Outline, type Script, type Storyboard } from "@/lib/types";
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

function nextId(ids: string[]): string {
  const n = Math.max(0, ...ids.map((x) => Number(x.slice(1)) || 0)) + 1;
  return `s${String(n).padStart(2, "0")}`;
}

// ---------------------------------------------------------------- outline
export function OutlineEditor({ value, editing, onChange }: { value: Outline; editing: boolean; onChange: (v: Outline) => void }) {
  const set = (fn: (o: Outline) => void) => {
    const o = structuredClone(value);
    fn(o);
    onChange(o);
  };
  const allIds = value.sections.flatMap((s) => s.slides.map((x) => x.id));
  let n = 0;
  return (
    <div className="space-y-8">
      <div>
        <span className="label mb-1.5">Deck title</span>
        <Field editing={editing} label="Deck title" value={value.title} onChange={(v) => set((o) => void (o.title = v))} className="font-display text-[26px] tracking-[-0.01em] text-fg" />
      </div>
      {value.sections.map((sec, si) => (
        <section key={si}>
          <div className="mb-3 flex items-center gap-3">
            <span className="font-mono text-[11px] text-dim">Section {si + 1}</span>
            <Field editing={editing} label={`Section ${si + 1} name`} value={sec.name} onChange={(v) => set((o) => void (o.sections[si]!.name = v))} className="text-[15px] font-semibold text-fg" />
            {editing && (
              <button type="button" aria-label="Remove section" onClick={() => set((o) => void o.sections.splice(si, 1))} className="ml-auto rounded p-1 text-dim hover:text-bad">
                <IconTrash size={14} />
              </button>
            )}
          </div>
          <ol className="space-y-2">
            {sec.slides.map((sl, i) => {
              n++;
              return (
                <li key={sl.id}>
                  <Card className="flex items-start gap-4 px-4 py-3">
                    <span className="mt-0.5 w-5 text-right font-mono text-[12px] text-dim">{n}</span>
                    <div className="min-w-0 flex-1 space-y-1">
                      <Field editing={editing} label={`${sl.id} title`} value={sl.title} onChange={(v) => set((o) => void (o.sections[si]!.slides[i]!.title = v))} className="block text-[14px] font-medium text-fg" />
                      <Field editing={editing} label={`${sl.id} point`} value={sl.point} onChange={(v) => set((o) => void (o.sections[si]!.slides[i]!.point = v))} className="block text-[13px] text-sub" placeholder="The one point this slide makes" />
                    </div>
                    <SlideId id={sl.id} />
                    {editing && (
                      <div className="flex flex-col">
                        <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => set((o) => { const a = o.sections[si]!.slides; [a[i - 1], a[i]] = [a[i]!, a[i - 1]!]; })} className="rounded p-0.5 text-dim hover:text-fg disabled:opacity-30">
                          <IconUp size={14} />
                        </button>
                        <button type="button" aria-label="Remove slide" onClick={() => set((o) => void o.sections[si]!.slides.splice(i, 1))} className="rounded p-0.5 text-dim hover:text-bad">
                          <IconTrash size={14} />
                        </button>
                      </div>
                    )}
                  </Card>
                </li>
              );
            })}
          </ol>
          {editing && (
            <button type="button" onClick={() => set((o) => void o.sections[si]!.slides.push({ id: nextId(allIds), title: "New slide", point: "" }))} className="mt-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12.5px] text-sub hover:text-fg">
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

// ---------------------------------------------------------------- script
export function ScriptEditor({ value, editing, onChange, targetMinutes }: { value: Script; editing: boolean; onChange: (v: Script) => void; targetMinutes: number }) {
  const set = (i: number, fn: (s: Script["slides"][number]) => void) => {
    const o = structuredClone(value);
    fn(o.slides[i]!);
    onChange(o);
  };
  const total = value.slides.reduce((n, s) => n + s.budgetSec, 0);
  const target = targetMinutes * 60;
  const off = total - target;
  return (
    <div>
      <div className="mb-5 flex items-center gap-4 rounded-xl border border-line bg-panel px-4 py-3">
        <span className="text-[12.5px] text-sub">Talk length</span>
        <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-line">
          <div className={cx("absolute inset-y-0 left-0 rounded-full", Math.abs(off) <= 60 ? "bg-ok" : "bg-ember")} style={{ width: `${Math.min(100, (total / target) * 100)}%` }} />
        </div>
        <span className="font-mono text-[12.5px] text-fg">{fmt(total)}</span>
        <span className="font-mono text-[12.5px] text-dim">/ {fmt(target)}</span>
      </div>
      <div className="space-y-3">
        {value.slides.map((s, i) => (
          <Card key={s.id} className="px-5 py-4">
            <div className="flex items-center gap-3">
              <SlideId id={s.id} />
              <Field editing={editing} label={`${s.id} title`} value={s.title} onChange={(v) => set(i, (x) => void (x.title = v))} className="flex-1 text-[14.5px] font-medium text-fg" />
              {editing ? (
                <label className="flex items-center gap-1.5 text-[12px] text-dim">
                  <input aria-label={`${s.id} seconds`} type="number" min={10} step={10} value={s.budgetSec} onChange={(e) => set(i, (x) => void (x.budgetSec = Math.max(10, Number(e.target.value) || 10)))} className="field h-7 w-[72px] px-2 py-0 font-mono text-[12px]" />
                  sec
                </label>
              ) : (
                <span className="font-mono text-[12px] text-dim">{fmt(s.budgetSec)}</span>
              )}
            </div>
            <div className="mt-3 grid grid-cols-[96px_1fr] gap-x-4 gap-y-2.5 text-[13.5px]">
              <span className="pt-1 text-[12px] text-dim">Key message</span>
              <Field editing={editing} label={`${s.id} key message`} value={s.keyMessage} onChange={(v) => set(i, (x) => void (x.keyMessage = v))} className="text-fg" />
              <span className="pt-1 text-[12px] text-dim">Narration</span>
              <Field editing={editing} multiline label={`${s.id} narration`} value={s.narration} onChange={(v) => set(i, (x) => void (x.narration = v))} className="leading-[1.6] text-sub" />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- storyboard
const VISUAL_LABEL: Record<string, string> = {
  "3d-object": "3D object",
  simulation: "Simulation",
  diagram: "Diagram",
  chart: "Chart",
  typographic: "Typographic",
  comparison: "Comparison",
};

export function StoryboardEditor({ value, editing, onChange, titles }: { value: Storyboard; editing: boolean; onChange: (v: Storyboard) => void; titles: Record<string, string> }) {
  const set = (i: number, fn: (s: Storyboard["slides"][number]) => void) => {
    const o = structuredClone(value);
    fn(o.slides[i]!);
    onChange(o);
  };
  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
      {value.slides.map((s, i) => (
        <Card key={s.id} className="flex flex-col px-5 py-4">
          <div className="flex items-center gap-2.5">
            <SlideId id={s.id} />
            <span className="flex-1 truncate text-[14px] font-medium text-fg">{titles[s.id] ?? s.id}</span>
            {editing ? (
              <select aria-label={`${s.id} visual type`} value={s.visual} onChange={(e) => set(i, (x) => void (x.visual = e.target.value as typeof x.visual))} className="field h-7 w-auto px-2 py-0 text-[12px]">
                {VISUAL_TYPES.map((v) => (
                  <option key={v} value={v}>
                    {VISUAL_LABEL[v]}
                  </option>
                ))}
              </select>
            ) : (
              <span className={cx("rounded-full px-2 py-0.5 text-[11.5px] font-medium", s.visual === "3d-object" ? "bg-ember/12 text-ember" : s.visual === "simulation" ? "bg-review/12 text-review" : "bg-raised text-sub")}>
                {VISUAL_LABEL[s.visual]}
              </span>
            )}
          </div>
          <dl className="mt-3 grid grid-cols-[84px_1fr] gap-x-3 gap-y-2 text-[13px]">
            <dt className="pt-1 text-[12px] text-dim">Layout</dt>
            <dd>
              <Field editing={editing} label={`${s.id} layout`} value={s.layout} onChange={(v) => set(i, (x) => void (x.layout = v))} className="text-sub" />
            </dd>
            <dt className="pt-1 text-[12px] text-dim">Interaction</dt>
            <dd>
              <Field editing={editing} label={`${s.id} interaction`} value={s.interaction} onChange={(v) => set(i, (x) => void (x.interaction = v))} className="text-sub" />
            </dd>
            <dt className="pt-1 text-[12px] text-dim">Beats</dt>
            <dd>
              {editing ? (
                <Field editing multiline label={`${s.id} motion beats`} value={s.motionBeats.join("\n")} onChange={(v) => set(i, (x) => void (x.motionBeats = v.split("\n")))} className="text-sub" />
              ) : (
                <ol className="flex flex-wrap items-center gap-1.5">
                  {s.motionBeats.map((b, j) => (
                    <li key={j} className="flex items-center gap-1.5 text-sub">
                      {j > 0 && <span className="text-dim">→</span>}
                      <span className="rounded-md border border-line px-1.5 py-0.5 text-[12px]">{b}</span>
                    </li>
                  ))}
                </ol>
              )}
            </dd>
            {(s.object3d !== undefined || editing) && (
              <>
                <dt className="pt-1 text-[12px] text-dim">3D object</dt>
                <dd>
                  <Field editing={editing} label={`${s.id} 3D object`} value={s.object3d ?? ""} placeholder="None" onChange={(v) => set(i, (x) => void (x.object3d = v || undefined))} className="text-sub" />
                </dd>
              </>
            )}
          </dl>
        </Card>
      ))}
    </div>
  );
}
