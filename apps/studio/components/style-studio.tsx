"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "@/lib/client/api";
import { contrast, grade, isHex } from "@/lib/color";
import { cloneStyle, COLOR_KEYS, COLOR_LABEL, DEFAULT_STYLE, LOOKS, matchPalette, PALETTES, type Colors } from "@/lib/looks";
import { themeVarsCss, type FontOption } from "@/lib/theme-vars";
import type { Style } from "@/lib/types";
import { FontPicker } from "./font-picker";
import { IconChevron, IconSpark, IconX } from "./icons";
import { useProject } from "./project-shell";
import { StylePoster } from "./style-poster";
import { Button, cx, ErrorNote, Kbd, Segmented, Spinner, Switch } from "./ui";

const FEATURES: { key: keyof Style["features"]; label: string; body: string }[] = [
  { key: "timer", label: "Pacing timer", body: "Per-slide time budget with an ahead/behind readout." },
  { key: "notes", label: "Speaker notes", body: "Press N for notes; opens a presenter window." },
  { key: "stepNav", label: "Step navigation", body: "Section tabs and segmented progress in a dock." },
  { key: "print", label: "Print / PDF", body: "One page per slide when printed." },
];

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-b border-line px-5 py-5">
      <div className="mb-3.5 flex items-center justify-between">
        <h2 className="text-[13px] font-semibold text-fg">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function ContrastBadge({ fg, bg, label }: { fg: string; bg: string; label: string }) {
  const r = contrast(fg, bg);
  if (r === null) return null;
  const g = grade(r);
  const tone = g === "AAA" || g === "AA" ? "text-ok bg-ok/10" : g === "AA large" ? "text-ember bg-ember/10" : "text-bad bg-bad/10";
  return (
    <span className={cx("inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-[11.5px] font-medium", tone)} title={`${label}: ${r.toFixed(2)}:1`}>
      <span className="text-sub">{label}</span>
      <span className="font-mono">{r.toFixed(1)}</span>
      <span>{g}</span>
    </span>
  );
}

function ColorRow({ k, value, onChange }: { k: (typeof COLOR_KEYS)[number]; value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    setText(value);
  }
  const bad = !isHex(text);
  return (
    <div className="flex items-center gap-2.5">
      <label className="relative size-7 shrink-0 cursor-pointer overflow-hidden rounded-md border border-white/10" style={{ background: value }}>
        <span className="sr-only">{COLOR_LABEL[k]} colour</span>
        <input type="color" value={isHex(value) ? value : "#000000"} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
      </label>
      <span className="w-[72px] text-[12.5px] text-sub">{COLOR_LABEL[k]}</span>
      <input
        aria-label={`${COLOR_LABEL[k]} hex`}
        value={text}
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value);
          if (isHex(e.target.value)) onChange(e.target.value.startsWith("#") ? e.target.value : `#${e.target.value}`);
        }}
        className={cx("field h-7 flex-1 px-2 font-mono text-[12px] uppercase", bad && "border-bad/60")}
      />
    </div>
  );
}

export function StyleStudio({ fonts, initial }: { fonts: FontOption[]; initial: Style | null }) {
  const { project, refresh } = useProject();
  const router = useRouter();
  const [style, setStyle] = useState<Style>(() => cloneStyle(initial ?? DEFAULT_STYLE));
  const [savedJson, setSavedJson] = useState(() => (initial ? JSON.stringify(initial) : ""));
  const [slide, setSlide] = useState<0 | 1>(0);
  const [ready, setReady] = useState(false);
  const [recommending, setRecommending] = useState(false);
  const [rationale, setRationale] = useState<string | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);

  const dirty = JSON.stringify(style) !== savedJson;
  const paletteId = matchPalette(style.theme.colors);
  const sansSerif = useMemo(() => fonts.filter((f) => f.category !== "monospace"), [fonts]);
  const mono = useMemo(() => fonts.filter((f) => f.category === "monospace"), [fonts]);
  const featureKey = FEATURES.filter((f) => style.features[f.key])
    .map((f) => f.key)
    .join(",");
  const hasDock = style.features.timer || style.features.notes || style.features.stepNav;
  const [loadedKey, setLoadedKey] = useState(featureKey);
  if (loadedKey !== featureKey) {
    setLoadedKey(featureKey);
    setReady(false);
  }

  const push = useCallback(() => {
    const w = frame.current?.contentWindow;
    if (!w) return;
    w.postMessage({ type: "df-preview", css: themeVarsCss(style.theme, fonts), style }, "*");
    w.postMessage({ type: "df-goto", index: slide }, "*");
  }, [style, fonts, slide]);

  useEffect(() => {
    push();
  }, [push]);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      if (e.data?.type === "df-preview-ready") push();
      if (e.data?.type === "df-preview-applied") setReady(true);
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [push]);

  const update = (fn: (s: Style) => void) =>
    setStyle((s) => {
      const n = cloneStyle(s);
      fn(n);
      return n;
    });

  const applyLook = (id: string) => {
    const l = LOOKS.find((x) => x.id === id);
    if (!l) return;
    setStyle((s) => ({ ...cloneStyle(l.style), features: { ...s.features } }));
  };

  async function recommend() {
    setRecommending(true);
    setError(null);
    try {
      const r = await api.recommendStyle(project.brief);
      setStyle(cloneStyle(r.style));
      setRationale(r.rationale);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRecommending(false);
    }
  }

  async function save(go: boolean) {
    setSaving(true);
    setError(null);
    try {
      await api.saveFile(project.id, "style.json", JSON.stringify(style, null, 2));
      setSavedJson(JSON.stringify(style));
      await refresh();
      if (go) router.push(project.stages.research === "idle" ? `/p/${project.id}/research?run=1` : `/p/${project.id}/research`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void save(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const c = style.theme.colors;

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-line px-6">
        <h1 className="font-display text-[22px] tracking-[-0.01em]">Style</h1>
        <span className="text-[12.5px] text-dim">{!savedJson ? "Not saved yet" : dirty ? "Unsaved changes" : "Saved"}</span>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="secondary" onClick={() => void save(false)} disabled={saving || !dirty}>
            Save
          </Button>
          <Button variant="primary" onClick={() => void save(true)} disabled={saving}>
            {saving && <Spinner />}
            Save and start research
            <Kbd className="border-bg/20 bg-transparent text-bg/60">⌘↵</Kbd>
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* controls */}
        <div className="w-[368px] shrink-0 overflow-y-auto border-r border-line bg-panel">
          <div className="px-5 pb-1 pt-5">
            <button
              type="button"
              onClick={() => void recommend()}
              disabled={recommending}
              className="group relative flex w-full items-center gap-3 overflow-hidden rounded-xl border border-ember/35 bg-gradient-to-br from-ember/[0.14] to-ember/[0.03] px-3.5 py-3 text-left transition-colors hover:border-ember/60 disabled:cursor-wait"
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-ember/15 text-ember">{recommending ? <Spinner /> : <IconSpark />}</span>
              <span className="flex-1">
                <span className="block text-[13.5px] font-semibold text-fg">{recommending ? "Asking the stylist…" : "Recommend for my topic"}</span>
                <span className="block text-[12px] text-sub">Fills every control from your brief</span>
              </span>
            </button>
            {rationale && (
              <div className="relative mt-3 animate-rise rounded-xl border border-line bg-raised px-3.5 py-3 pr-9 text-[12.5px] leading-[1.55] text-sub">
                <span className="mb-1 block text-[12px] font-semibold text-fg">Why this style</span>
                {rationale}
                <button type="button" aria-label="Dismiss" onClick={() => setRationale(null)} className="absolute right-2 top-2 rounded p-1 text-dim hover:text-fg">
                  <IconX size={14} />
                </button>
              </div>
            )}
            {error && (
              <div className="mt-3">
                <ErrorNote message={error} />
              </div>
            )}
          </div>

          <Section title="Look">
            <div role="radiogroup" aria-label="Look" className="grid grid-cols-2 gap-2.5">
              {LOOKS.map((l) => {
                const on = style.look === l.id;
                return (
                  <button
                    key={l.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => applyLook(l.id)}
                    className={cx(
                      "group rounded-xl border p-1.5 text-left transition-colors",
                      on ? "border-ember/70 bg-ember/[0.06]" : "border-line hover:border-line-strong",
                    )}
                  >
                    <div className="overflow-hidden rounded-lg">
                      <StylePoster style={l.style} title="Inside ANC" />
                    </div>
                    <div className="px-1 pb-0.5 pt-2">
                      <div className="text-[12.5px] font-medium text-fg">{l.name}</div>
                      <div className="mt-0.5 line-clamp-2 text-[11.5px] leading-[1.4] text-dim">{l.blurb}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </Section>

          <Section
            title="Palette"
            aside={
              <div className="flex gap-1.5">
                <ContrastBadge fg={c.text} bg={c.bg} label="Text" />
                <ContrastBadge fg={c.muted} bg={c.bg} label="Muted" />
              </div>
            }
          >
            <div role="radiogroup" aria-label="Palette" className="space-y-1">
              {PALETTES.map((p) => {
                const on = paletteId === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() =>
                      update((s) => {
                        s.theme.colors = { ...p.colors };
                        s.theme.backdrop = p.backdrop;
                      })
                    }
                    className={cx("flex w-full items-center gap-3 rounded-lg px-2 py-1.5 transition-colors", on ? "bg-raised ring-1 ring-ember/60" : "hover:bg-raised/70")}
                  >
                    <span className="w-[92px] text-left text-[12.5px] text-sub">{p.name}</span>
                    <span className="flex flex-1 overflow-hidden rounded-md ring-1 ring-white/5">
                      {COLOR_KEYS.map((k) => (
                        <span key={k} className="h-5 flex-1" style={{ background: p.colors[k] }} />
                      ))}
                    </span>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              aria-expanded={customOpen}
              onClick={() => setCustomOpen((v) => !v)}
              className="mt-3 flex w-full items-center gap-2 rounded-md py-1 text-[12.5px] font-medium text-sub hover:text-fg"
            >
              <IconChevron className={cx("transition-transform", !customOpen && "-rotate-90")} size={14} />
              Edit colours{!paletteId && <span className="text-ember">· custom</span>}
            </button>
            {customOpen && (
              <div className="mt-2 grid animate-rise gap-1.5">
                {COLOR_KEYS.map((k) => (
                  <ColorRow
                    key={k}
                    k={k}
                    value={c[k]}
                    onChange={(v) =>
                      update((s) => {
                        (s.theme.colors as Colors)[k] = v;
                      })
                    }
                  />
                ))}
              </div>
            )}
          </Section>

          <Section title="Type">
            <div className="grid gap-3">
              <FontPicker label="Display" sample="Ag" value={style.theme.fonts.display} options={sansSerif} onChange={(id) => update((s) => void (s.theme.fonts.display = id))} />
              <FontPicker label="Body" sample="Ag" value={style.theme.fonts.body} options={sansSerif} onChange={(id) => update((s) => void (s.theme.fonts.body = id))} />
              <FontPicker label="Mono" sample="0x" value={style.theme.fonts.mono} options={mono} onChange={(id) => update((s) => void (s.theme.fonts.mono = id))} />
            </div>
          </Section>

          <Section title="Motion and interaction">
            <div className="grid gap-4">
              <div>
                <span className="label mb-1.5">Motion</span>
                <Segmented
                  label="Motion"
                  value={style.motion}
                  onChange={(v) => update((s) => void (s.motion = v))}
                  options={[
                    { value: "none", label: "None" },
                    { value: "subtle", label: "Subtle" },
                    { value: "rich", label: "Rich" },
                  ]}
                />
              </div>
              <div>
                <span className="label mb-1.5">Interactivity</span>
                <Segmented
                  label="Interactivity"
                  value={style.interactivity}
                  onChange={(v) => update((s) => void (s.interactivity = v))}
                  options={[
                    { value: 0, label: "Static", hint: "No controls on slides" },
                    { value: 1, label: "Light", hint: "Toggles and hover states" },
                    { value: 2, label: "Simulations", hint: "Sliders, live simulations" },
                  ]}
                />
              </div>
              <div>
                <span className="label mb-1.5">Density</span>
                <Segmented
                  label="Density"
                  value={style.density}
                  onChange={(v) => update((s) => void (s.density = v))}
                  options={[
                    { value: "airy", label: "Airy" },
                    { value: "balanced", label: "Balanced" },
                    { value: "dense", label: "Dense" },
                  ]}
                />
              </div>
              <label htmlFor="use3d" className="flex cursor-pointer items-center justify-between rounded-lg border border-line px-3 py-2.5">
                <span>
                  <span className="block text-[13px] font-medium text-fg">3D objects</span>
                  <span className="block text-[12px] text-dim">Procedural Three.js models, no downloads</span>
                </span>
                <Switch id="use3d" label="3D objects" checked={style.use3d} onChange={(v) => update((s) => void (s.use3d = v))} />
              </label>
            </div>
          </Section>

          <Section title="Presenter features">
            <div className="grid gap-1">
              {FEATURES.map((f) => (
                <label key={f.key} className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-raised/70">
                  <input
                    type="checkbox"
                    checked={style.features[f.key]}
                    onChange={(e) => update((s) => void (s.features[f.key] = e.target.checked))}
                    className="mt-0.5 size-4 shrink-0 accent-[var(--color-ember)]"
                  />
                  <span>
                    <span className="block text-[13px] font-medium text-fg">{f.label}</span>
                    <span className="block text-[12px] text-dim">{f.body}</span>
                  </span>
                </label>
              ))}
            </div>
          </Section>
          <div className="h-10" />
        </div>

        {/* preview */}
        <div className="stage-grid relative flex min-w-0 flex-1 flex-col">
          <div className="flex h-12 shrink-0 items-center justify-between px-6">
            <Segmented
              label="Preview slide"
              value={slide}
              onChange={(v) => setSlide(v)}
              options={[
                { value: 0, label: "Title slide" },
                { value: 1, label: "Content slide" },
              ]}
              className="w-[240px]"
            />
            <span className="text-[12px] text-dim">Rendered by the deck engine · updates as you edit</span>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center px-8 pb-8">
            <div className="relative w-full max-w-[1100px]" style={{ aspectRatio: hasDock ? "1920 / 1152" : "16 / 9" }}>
              <div className="absolute inset-0 overflow-hidden rounded-xl shadow-[0_0_0_1px_rgb(255_255_255/0.06),0_40px_100px_-30px_rgb(0_0_0/0.8)]">
                <iframe
                  key={featureKey}
                  ref={frame}
                  title="Style preview"
                  src={`/preview/sample?features=${featureKey}`}
                  onLoad={() => push()}
                  className={cx("size-full border-0 transition-opacity duration-300", ready ? "opacity-100" : "opacity-0")}
                />
                {!ready && (
                  <div className="absolute inset-0 grid place-items-center bg-[#0b0c10]">
                    <span className="flex items-center gap-2 text-[12.5px] text-sub">
                      <Spinner /> Bundling preview…
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="pointer-events-none absolute bottom-3 left-0 right-0 flex justify-center">
            <span className="flex items-center gap-2 rounded-full border border-line bg-panel/90 px-3 py-1 text-[11.5px] text-dim backdrop-blur">
              {LOOKS.find((l) => l.id === style.look)?.name ?? "Custom"} · {fonts.find((f) => f.id === style.theme.fonts.display)?.family} ·{" "}
              {style.motion} motion{style.use3d ? " · 3D" : ""}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
