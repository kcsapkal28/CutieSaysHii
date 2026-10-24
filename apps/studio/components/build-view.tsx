"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, deckUrl } from "@/lib/client/api";
import type { PipelineEvent } from "@/lib/events";
import type { Script, SlideBuildState, Storyboard } from "@/lib/types";
import { IconArrowRight, IconCheck, IconPlay, IconRefresh, IconStop } from "./icons";
import { useProject } from "./project-shell";
import { SlideFrame } from "./slide-frame";
import { Button, cx, EmptyState, ErrorNote, Kbd, money, Spinner, StatusPill, tokens } from "./ui";
import { useStageRun } from "./use-stage-run";

const PHASE: Record<string, string> = { build: "Writing slide code", shoot: "Screenshotting every step", critique: "Critic is reviewing" };

function parse<T>(raw?: string): T | null {
  try {
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function initialSlides(script: Script | null, saved: SlideBuildState[] | undefined): SlideBuildState[] {
  if (saved?.length) return saved;
  return (script?.slides ?? []).map((s) => ({ id: s.id, title: s.title, status: "queued", rounds: 0, issues: [] }));
}

function Verdict({ s }: { s: SlideBuildState }) {
  if (s.status === "building")
    return (
      <span className="flex items-center gap-1.5 text-[11.5px] text-ember">
        <Spinner size={11} /> Round {s.rounds || 1}
      </span>
    );
  if (s.status === "done")
    return (
      <span className="flex items-center gap-1 text-[11.5px] text-ok">
        <IconCheck size={12} strokeWidth={2} /> Passed · {s.rounds} {s.rounds === 1 ? "round" : "rounds"}
      </span>
    );
  if (s.status === "error") return <span className="text-[11.5px] text-bad">Failed</span>;
  return <span className="text-[11.5px] text-dim">Queued</span>;
}

export function BuildView() {
  const { project, refresh } = useProject();
  const router = useRouter();
  const search = useSearchParams();
  const script = parse<Script>(project.files["script.json"]);
  const board = parse<Storyboard>(project.files["storyboard.json"]);
  const [slides, setSlides] = useState<SlideBuildState[]>(() => initialSlides(script, project.build?.slides));
  const [selected, setSelected] = useState<string | null>(slides[0]?.id ?? null);
  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const strip = useRef<HTMLDivElement>(null);
  const autoRan = useRef(false);

  const onEvent = (e: PipelineEvent) => {
    if (e.type === "stage.start") setSlides((l) => l.map((s) => ({ ...s, status: "queued", rounds: 0, issues: [], verdict: undefined })));
    if (e.type === "slide.start") {
      setSlides((l) => l.map((s) => (s.id === e.slideId ? { ...s, status: "building", rounds: 1, phase: "build" } : s)));
      if (!pinned) setSelected(e.slideId);
    }
    if (e.type === "slide.round") setSlides((l) => l.map((s) => (s.id === e.slideId ? { ...s, rounds: e.round, phase: e.phase } : s)));
    if (e.type === "critic.verdict")
      setSlides((l) =>
        l.map((s) =>
          s.id === e.slideId
            ? { ...s, issues: [...s.issues.map((i) => ({ ...i, fixed: true })), ...e.issues.map((text) => ({ round: e.round, text, fixed: false }))] }
            : s,
        ),
      );
    if (e.type === "slide.done")
      setSlides((l) => l.map((s) => (s.id === e.slideId ? { ...s, status: "done", rounds: e.rounds, verdict: e.verdict, phase: undefined, issues: s.issues.map((i) => ({ ...i, fixed: true })) } : s)));
  };
  const run = useStageRun("build", onEvent);
  const st = project.stageState.build;

  // Server state wins when we're not streaming (e.g. after reload).
  useEffect(() => {
    if (!run.local && project.build?.slides) setSlides(project.build.slides);
  }, [run.local, project.build]);

  const blocked = project.stages.storyboard !== "approved";
  useEffect(() => {
    if (autoRan.current) return;
    if (search.get("run") === "1" && st.status === "idle" && !blocked) {
      autoRan.current = true;
      router.replace(`/p/${project.id}/build`);
      void run.start();
    }
  }, [search, st.status, blocked, run, router, project.id]);

  const done = slides.filter((s) => s.status === "done").length;
  const sel = slides.find((s) => s.id === selected) ?? slides[0];
  const selBoard = board?.slides.find((s) => s.id === sel?.id);
  const selScript = script?.slides.find((s) => s.id === sel?.id);
  const finished = !run.running && st.status !== "idle" && done === slides.length && slides.length > 0;
  const deckRef = run.running || !project.latestVersion ? "draft" : project.latestVersion;

  async function approve() {
    setBusy(true);
    setErr(null);
    try {
      await api.approve(project.id, "build");
      await refresh();
      router.push(`/p/${project.id}/deck`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const pick = (id: string) => {
    setSelected(id);
    setPinned(true);
  };

  if (blocked && st.status === "idle")
    return (
      <div className="grid h-full place-items-center">
        <EmptyState
          title="Approve the storyboard first"
          body="The builder writes each slide from the approved storyboard."
          action={
            <Link href={`/p/${project.id}/storyboard`} className="inline-flex h-8 items-center gap-2 rounded-lg bg-raised px-3 text-[13px] font-medium ring-1 ring-line hover:bg-hover">
              Go to storyboard <IconArrowRight size={14} />
            </Link>
          }
        />
      </div>
    );

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-6">
        <h1 className="font-display text-[22px] tracking-[-0.01em]">Build</h1>
        <StatusPill status={run.local ? "running" : st.status} />
        {slides.length > 0 && (
          <div className="ml-2 flex items-center gap-2.5">
            <div className="h-1 w-28 overflow-hidden rounded-full bg-line">
              <div className="h-full rounded-full bg-ok transition-[width] duration-500" style={{ width: `${(done / slides.length) * 100}%` }} />
            </div>
            <span className="font-mono text-[12px] text-sub">
              {done}/{slides.length}
            </span>
          </div>
        )}
        <span className="ml-2 font-mono text-[12px] text-dim">
          {tokens(run.usage.inputTokens + run.usage.outputTokens)} tok · {money(run.usage.costUsd)}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {run.running ? (
            <Button onClick={run.stop} disabled={!run.local}>
              <IconStop size={12} /> Stop
            </Button>
          ) : st.status === "idle" ? (
            <Button variant="ember" onClick={() => void run.start()}>
              <IconPlay size={13} /> Start build
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => void run.start()} title="Rebuild every slide from the storyboard">
              <IconRefresh size={14} /> Rebuild
            </Button>
          )}
          <Button variant="primary" onClick={() => void approve()} disabled={!finished || busy}>
            {busy && <Spinner />}
            {st.status === "approved" ? "Open deck" : "Approve and open deck"}
            <IconArrowRight size={14} />
          </Button>
        </div>
      </header>

      {(run.error || err) && (
        <div className="px-6 pt-4">
          <ErrorNote message={err ?? run.error!} />
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* stage */}
        <div className="stage-grid flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 items-center justify-center p-8">
            <div className="w-full max-w-[1040px]">
              {sel && sel.status === "done" ? (
                <div className="overflow-hidden rounded-xl shadow-[0_0_0_1px_rgb(255_255_255/0.06),0_40px_100px_-30px_rgb(0_0_0/0.8)]">
                  <SlideFrame key={`${deckRef}-${sel.id}`} src={deckUrl(project.id, deckRef, { shot: sel.id, step: 99 })} title={`${sel.id} ${sel.title}`} lazy={false} />
                </div>
              ) : sel ? (
                <div className="relative grid aspect-video place-items-center overflow-hidden rounded-xl border border-line bg-panel">
                  {sel.status === "building" && <div className="skeleton absolute inset-0 opacity-50" aria-hidden />}
                  <div className="relative max-w-[60%] text-center">
                    <span className="font-mono text-[12px] text-dim">{sel.id}</span>
                    <h2 className="mt-2 font-display text-[30px] leading-[1.15] tracking-[-0.015em]">{sel.title}</h2>
                    {sel.status === "building" ? (
                      <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-ember/10 px-3 py-1 text-[12.5px] text-ember">
                        <Spinner size={12} /> Round {sel.rounds} · {PHASE[sel.phase ?? "build"]}
                      </p>
                    ) : (
                      <p className="mt-4 text-[13px] text-dim">{st.status === "idle" ? "Waiting for the build to start" : "Queued"}</p>
                    )}
                  </div>
                </div>
              ) : (
                <EmptyState title="No slides to build" body="The script has no slides. Go back and approve a script first." />
              )}
            </div>
          </div>

          {/* filmstrip */}
          <div
            ref={strip}
            role="listbox"
            aria-label="Slides"
            aria-orientation="horizontal"
            tabIndex={0}
            onKeyDown={(e) => {
              const i = slides.findIndex((s) => s.id === sel?.id);
              const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
              if (!d) return;
              e.preventDefault();
              const n = slides[Math.max(0, Math.min(slides.length - 1, i + d))];
              if (n) {
                pick(n.id);
                strip.current?.querySelector(`[data-id="${n.id}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
              }
            }}
            className="flex shrink-0 gap-3 overflow-x-auto border-t border-line bg-panel/80 px-6 py-4 backdrop-blur focus-visible:outline-offset-[-2px]"
          >
            {slides.map((s, i) => {
              const on = s.id === sel?.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  role="option"
                  aria-selected={on}
                  data-id={s.id}
                  tabIndex={-1}
                  onClick={() => pick(s.id)}
                  className="w-[168px] shrink-0 text-left"
                >
                  <div
                    className={cx(
                      "relative overflow-hidden rounded-lg ring-1 transition-[box-shadow,opacity] duration-200",
                      on ? "ring-2 ring-ember" : s.status === "building" ? "ring-ember/40" : "ring-line hover:ring-line-strong",
                      s.status === "queued" && "opacity-60",
                    )}
                  >
                    {s.status === "done" ? (
                      <SlideFrame src={deckUrl(project.id, deckRef, { shot: s.id, step: 99 })} title={`${s.id} thumbnail`} />
                    ) : (
                      <div className="relative grid aspect-video place-items-center bg-raised">
                        {s.status === "building" && <div className="skeleton absolute inset-0" />}
                        <span className="relative font-mono text-[18px] text-dim">{String(i + 1).padStart(2, "0")}</span>
                      </div>
                    )}
                  </div>
                  <div className="mt-2 truncate text-[12px] font-medium text-fg">{s.title}</div>
                  <div className="mt-0.5">
                    <Verdict s={s} />
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* critic panel */}
        <aside aria-label="Slide details" className="flex w-[300px] shrink-0 flex-col overflow-y-auto border-l border-line bg-panel">
          {sel && (
            <div className="px-5 py-5">
              <div className="flex items-center gap-2">
                <span className="rounded bg-raised px-1.5 py-0.5 font-mono text-[11px] text-sub">{sel.id}</span>
                <Verdict s={sel} />
              </div>
              <h2 className="mt-3 text-[15px] font-semibold leading-[1.35]">{sel.title}</h2>
              {selScript && <p className="mt-1.5 text-[12.5px] leading-[1.5] text-sub">{selScript.keyMessage}</p>}

              <h3 className="mt-6 text-[12px] font-semibold text-fg">Critic</h3>
              {sel.issues.length === 0 ? (
                <p className="mt-2 text-[12.5px] text-dim">
                  {sel.status === "done" ? "Passed on the first round with no issues." : sel.status === "building" ? "Waiting for the first screenshots…" : "Nothing yet."}
                </p>
              ) : (
                <ol className="mt-2 space-y-2">
                  {sel.issues.map((it, i) => (
                    <li key={i} className="flex gap-2.5 rounded-lg border border-line bg-bg/40 px-3 py-2.5 text-[12.5px] leading-[1.45]">
                      <span className={cx("mt-0.5 grid size-4 shrink-0 place-items-center rounded-full", it.fixed ? "bg-ok/15 text-ok" : "bg-ember/15 text-ember")}>
                        {it.fixed ? <IconCheck size={10} strokeWidth={2.2} /> : <span className="size-1.5 rounded-full bg-ember" />}
                      </span>
                      <span className={cx("flex-1", it.fixed ? "text-sub" : "text-fg")}>{it.text}</span>
                      <span className="shrink-0 font-mono text-[10.5px] text-dim">R{it.round}</span>
                    </li>
                  ))}
                </ol>
              )}

              {selBoard && (
                <>
                  <h3 className="mt-6 text-[12px] font-semibold text-fg">Storyboard</h3>
                  <dl className="mt-2 space-y-2 text-[12.5px]">
                    <div>
                      <dt className="text-dim">Visual</dt>
                      <dd className="text-sub">{selBoard.layout}</dd>
                    </div>
                    <div>
                      <dt className="text-dim">Interaction</dt>
                      <dd className="text-sub">{selBoard.interaction}</dd>
                    </div>
                    {selBoard.object3d && (
                      <div>
                        <dt className="text-dim">3D object</dt>
                        <dd className="text-sub">{selBoard.object3d}</dd>
                      </div>
                    )}
                  </dl>
                </>
              )}
            </div>
          )}
          <div className="mt-auto border-t border-line px-5 py-3 text-[11.5px] text-dim">
            <span className="flex items-center gap-1.5">
              <Kbd>←</Kbd>
              <Kbd>→</Kbd> in the filmstrip to move between slides
            </span>
          </div>
        </aside>
      </div>
    </div>
  );
}
