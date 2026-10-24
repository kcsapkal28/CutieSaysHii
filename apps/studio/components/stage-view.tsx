"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "@/lib/client/api";
import { STAGE_FILE, STAGES, type Outline, type Script, type StageName, type Storyboard, type Usage } from "@/lib/types";
import { ActivityPanel } from "./activity-panel";
import { IconArrowRight, IconCheck, IconEdit, IconPlay, IconRefresh, IconStop } from "./icons";
import { STAGE_BLURB, STAGE_LABEL, useProject } from "./project-shell";
import { ResearchDoc } from "./research-doc";
import { OutlineEditor, ScriptEditor, StoryboardEditor } from "./stage-editors";
import { Button, EmptyState, ErrorNote, Kbd, Spinner, StatusPill } from "./ui";
import { useStageRun, type LogLine } from "./use-stage-run";

type DocStage = Exclude<StageName, "build">;

const RUN_EMPTY: Record<DocStage, string> = {
  research: "Searches, sources read and facts kept will stream here.",
  outline: "The script writer’s steps will stream here.",
  script: "Narration progress will stream here.",
  storyboard: "The creative’s decisions will stream here.",
};

const ZERO: Usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };

/** "outline, script and build" */
function listOf(stages: StageName[]): string {
  const names = stages.map((s) => STAGE_LABEL[s].toLowerCase());
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : (names[0] ?? "");
}

function parse<T>(raw: string | undefined | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function StageView({ stage }: { stage: DocStage }) {
  const { project, refresh } = useProject();
  const router = useRouter();
  const search = useSearchParams();
  const run = useStageRun(stage);
  const st = project.stageState[stage];
  const file = STAGE_FILE[stage];
  const saved = project.files[file] ?? null;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "save" | "approve">(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const autoRan = useRef(false);
  // Research is edited in place and autosaved; questions to the researcher add lines and spend to the activity panel.
  const isResearch = stage === "research";
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const saving = useRef<Promise<void>>(Promise.resolve());
  const [extraLog, setExtraLog] = useState<LogLine[]>([]);
  const [extraUsage, setExtraUsage] = useState<{ usage: Usage; model: string | null }>({ usage: ZERO, model: null });
  const [asking, setAsking] = useState(false);

  const idx = STAGES.indexOf(stage);
  const prev = idx > 0 ? STAGES[idx - 1]! : null;
  const next = STAGES[idx + 1]!;
  const blocked = prev !== null && project.stages[prev] !== "approved";
  const content = run.local && run.partial !== null ? run.partial : (draft ?? saved);
  const dirty = draft !== null && draft !== saved;
  // Saving research.md clears every later stage's output (the pipeline's rule), so with later work on disk an edit is
  // held until the user confirms; otherwise it autosaves.
  const later = STAGES.slice(idx + 1).filter((s) => project.stages[s] === "review" || project.stages[s] === "approved");
  const held = isResearch && dirty && later.length > 0;
  const otherRunning = STAGES.some((s) => s !== stage && project.stages[s] === "running");
  const canApprove = !run.running && !!saved && !held && (st.status === "review" || st.status === "approved" || dirty);

  useEffect(() => {
    if (autoRan.current) return;
    if (search.get("run") === "1" && st.status === "idle" && !blocked) {
      autoRan.current = true;
      router.replace(`/p/${project.id}/${stage}`);
      void run.start();
    }
  }, [search, st.status, blocked, run, router, project.id, stage]);

  async function saveDraft(): Promise<boolean> {
    if (draft === null || draft === saved) return true;
    setBusy("save");
    setActionError(null);
    try {
      await api.saveFile(project.id, file, draft);
      await refresh();
      setDraft(null);
      return true;
    } catch (e) {
      setActionError(`Couldn’t save: ${(e as Error).message}`);
      return false;
    } finally {
      setBusy(null);
    }
  }

  function autosave(text: string) {
    setSaveState("saving");
    saving.current = saving.current.then(async () => {
      try {
        await api.saveFile(project.id, file, text);
        await refresh();
        setDraft((d) => (d === text ? null : d));
        setSaveState("saved");
        setActionError(null);
      } catch (e) {
        setSaveState("error");
        setActionError(`Couldn’t save: ${(e as Error).message}`);
      }
    });
  }

  useEffect(() => {
    if (!isResearch || draft === null || draft === saved || later.length > 0) return;
    const t = setTimeout(() => autosave(draft), 700);
    return () => clearTimeout(t);
  }, [isResearch, draft, saved, later.length]);

  useEffect(() => {
    if (!run.local) return;
    setExtraLog([]);
    setExtraUsage({ usage: ZERO, model: null });
  }, [run.local]);

  const addLog = (message: string, tone?: LogLine["tone"]) => setExtraLog((l) => [...l, { at: new Date().toISOString(), message, ...(tone ? { tone } : {}) }]);
  const addUsage = (u: Usage, model: string) =>
    setExtraUsage((x) => ({ model, usage: { inputTokens: x.usage.inputTokens + u.inputTokens, outputTokens: x.usage.outputTokens + u.outputTokens, costUsd: x.usage.costUsd + u.costUsd } }));

  async function approve() {
    if (!(await saveDraft())) return;
    setBusy("approve");
    setActionError(null);
    try {
      await api.approve(project.id, stage);
      const p = await refresh();
      setEditing(false);
      const nextIdle = p?.stages[next] === "idle";
      router.push(next === "build" ? `/p/${project.id}/build${nextIdle ? "?run=1" : ""}` : `/p/${project.id}/${next}${nextIdle ? "?run=1" : ""}`);
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canApprove) {
        e.preventDefault();
        void approve();
      } else if (e.key === "Escape" && editing) {
        setEditing(false);
        setDraft(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const scriptTitles = Object.fromEntries((parse<Script>(project.files["script.json"])?.slides ?? []).map((s) => [s.id, s.title]));

  let body: ReactNode;
  if (blocked && !saved) {
    body = (
      <EmptyState
        title={`Approve the ${STAGE_LABEL[prev!].toLowerCase()} first`}
        body={`The ${STAGE_LABEL[stage].toLowerCase()} builds on the approved ${STAGE_LABEL[prev!].toLowerCase()}, so it can’t run yet.`}
        action={
          <Link href={`/p/${project.id}/${prev}`} className="inline-flex h-8 items-center gap-2 rounded-lg bg-raised px-3 text-[13px] font-medium text-fg ring-1 ring-line hover:bg-hover">
            Go to {STAGE_LABEL[prev!].toLowerCase()} <IconArrowRight size={14} />
          </Link>
        }
      />
    );
  } else if (!content) {
    body = run.running ? (
      <div className="space-y-3 pt-2" aria-busy>
        <div className="skeleton h-8 w-2/3 rounded-lg" />
        <div className="skeleton h-4 w-full rounded" />
        <div className="skeleton h-4 w-5/6 rounded" />
        <div className="skeleton h-4 w-3/4 rounded" />
        <div className="skeleton mt-6 h-24 w-full rounded-xl" />
      </div>
    ) : (
      <EmptyState
        title={st.status === "error" ? `${STAGE_LABEL[stage]} didn’t finish` : `${STAGE_LABEL[stage]} hasn’t run yet`}
        body={st.status === "error" ? "Nothing was saved from the failed run. Fix the cause above, then run it again." : STAGE_BLURB[stage]}
        icon={st.status === "error" ? <IconRefresh /> : <IconPlay />}
        action={
          <Button variant="primary" size="lg" onClick={() => void run.start()}>
            {st.status === "error" ? <IconRefresh size={14} /> : <IconPlay size={14} />} {st.status === "error" ? "Run again" : `Run ${STAGE_LABEL[stage].toLowerCase()}`}
          </Button>
        }
      />
    );
  } else if (isResearch) {
    const readOnly = run.running || otherRunning;
    body = (
      <article className="max-w-[72ch]">
        <p className="mb-5 text-[12px] text-dim">
          {readOnly
            ? run.running
              ? "The researcher is writing. You can edit once it finishes."
              : "Another stage is running. You can edit once it finishes."
            : "Click any text to edit it. Select a passage to ask the researcher about it."}
        </p>
        <ResearchDoc
          projectId={project.id}
          source={content}
          readOnly={readOnly}
          onChange={(next) => setDraft(next === saved ? null : next)}
          onLog={addLog}
          onUsage={addUsage}
          onAsking={setAsking}
          acceptNote={later.length ? `Saving this change clears the ${listOf(later)}; you’ll be asked first.` : null}
        />
      </article>
    );
  } else {
    const parsed = parse<Outline & Script & Storyboard>(content);
    if (!parsed) body = <ErrorNote message={`${file} isn’t valid JSON. Re-run the stage or fix the file.`} />;
    else if (stage === "outline") body = <OutlineEditor value={parsed} editing={editing} onChange={(v) => setDraft(JSON.stringify(v, null, 2))} />;
    else if (stage === "script") body = <ScriptEditor value={parsed} editing={editing} onChange={(v) => setDraft(JSON.stringify(v, null, 2))} targetMinutes={project.brief.minutes} />;
    else body = <StoryboardEditor value={parsed} editing={editing} titles={scriptTitles} onChange={(v) => setDraft(JSON.stringify(v, null, 2))} />;
  }

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-6">
          <h1 className="font-display text-[22px] tracking-[-0.01em]">{STAGE_LABEL[stage]}</h1>
          <StatusPill status={run.local ? "running" : st.status} />
          {isResearch ? (
            <SaveIndicator state={held ? "held" : dirty ? "saving" : saveState} />
          ) : (
            dirty && <span className="text-[12px] text-ember">Unsaved edits</span>
          )}
          <div className="ml-auto flex items-center gap-2">
            {run.running ? (
              <Button variant="secondary" onClick={run.stop} disabled={!run.local}>
                <IconStop size={12} /> Stop
              </Button>
            ) : (
              saved && (
                <>
                  <Button variant="ghost" onClick={() => void run.start()} disabled={blocked || busy !== null} title="Run the agent again; replaces the current output">
                    <IconRefresh size={14} /> Re-run
                  </Button>
                  {isResearch ? null : editing ? (
                    <Button
                      variant="secondary"
                      onClick={async () => {
                        if (await saveDraft()) setEditing(false);
                      }}
                      disabled={busy !== null}
                    >
                      {busy === "save" ? <Spinner /> : <IconCheck size={14} />} Done editing
                    </Button>
                  ) : (
                    <Button variant="secondary" onClick={() => setEditing(true)}>
                      <IconEdit size={14} /> Edit
                    </Button>
                  )}
                </>
              )
            )}
            <Button variant="primary" onClick={() => void approve()} disabled={!canApprove || busy !== null}>
              {busy === "approve" && <Spinner />}
              {st.status === "approved" && !dirty ? `Continue to ${STAGE_LABEL[next].toLowerCase()}` : "Approve and continue"}
              <Kbd className="border-bg/20 bg-transparent text-bg/60">⌘↵</Kbd>
            </Button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[920px] px-8 pb-24 pt-8">
            {(run.error || actionError) && (
              <div className="mb-6">
                <ErrorNote
                  message={actionError ?? run.error!}
                  action={
                    run.error && !run.running && saved ? (
                      <Button size="sm" variant="secondary" onClick={() => void run.start()}>
                        <IconRefresh size={13} /> Re-run
                      </Button>
                    ) : undefined
                  }
                />
              </div>
            )}
            {held && (
              // Sticky: the edit that triggered it is usually further down the page.
              <div
                role="status"
                className="sticky top-3 z-10 mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-ember/30 bg-[color-mix(in_oklab,var(--color-ember)_7%,var(--color-bg))] px-3.5 py-3 text-[13px] shadow-lg shadow-black/30"
              >
                <p className="min-w-[30ch] flex-1 text-fg">
                  Your edit isn’t saved yet. The {listOf(later)} {later.length > 1 ? "were" : "was"} made from this research, and saving it clears{" "}
                  {later.length > 1 ? "them" : "it"} so {later.length > 1 ? "they" : "it"} can be re-run. Saved deck versions are kept.
                </p>
                <div className="flex gap-2">
                  <Button size="sm" variant="ember" onClick={() => autosave(draft!)} disabled={saveState === "saving"}>
                    {saveState === "saving" && <Spinner size={12} />} Save and clear {listOf(later)}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
                    Discard edit
                  </Button>
                </div>
              </div>
            )}
            {editing && <p className="mb-4 rounded-lg bg-raised px-3 py-2 text-[12.5px] text-sub">Editing {file}. Your changes are saved when you press Done editing or approve. Esc discards them.</p>}
            {body}
          </div>
        </div>
      </div>
      <ActivityPanel
        log={extraLog.length ? [...run.log, ...extraLog] : run.log}
        usage={extraUsage.model ? { inputTokens: run.usage.inputTokens + extraUsage.usage.inputTokens, outputTokens: run.usage.outputTokens + extraUsage.usage.outputTokens, costUsd: run.usage.costUsd + extraUsage.usage.costUsd } : run.usage}
        model={run.model ?? extraUsage.model}
        running={run.running || asking}
        empty={RUN_EMPTY[stage]}
      />
    </div>
  );
}

function SaveIndicator({ state }: { state: "idle" | "saving" | "saved" | "error" | "held" }) {
  if (state === "idle") return null;
  if (state === "saving")
    return (
      <span className="flex items-center gap-1.5 text-[12px] text-dim">
        <Spinner size={11} /> Saving…
      </span>
    );
  if (state === "saved")
    return (
      <span className="flex items-center gap-1 text-[12px] text-dim">
        <IconCheck size={12} className="text-ok" /> Saved
      </span>
    );
  if (state === "held") return <span className="text-[12px] text-ember">Not saved yet</span>;
  return <span className="text-[12px] text-bad">Couldn’t save</span>;
}
