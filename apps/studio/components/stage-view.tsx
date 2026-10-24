"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "@/lib/client/api";
import { STAGE_FILE, STAGES, type Outline, type Script, type StageName, type Storyboard } from "@/lib/types";
import { ActivityPanel } from "./activity-panel";
import { IconArrowRight, IconCheck, IconEdit, IconPlay, IconRefresh, IconStop } from "./icons";
import { Markdown } from "./markdown";
import { STAGE_BLURB, STAGE_LABEL, useProject } from "./project-shell";
import { OutlineEditor, ScriptEditor, StoryboardEditor } from "./stage-editors";
import { Button, EmptyState, ErrorNote, Kbd, Spinner, StatusPill } from "./ui";
import { useStageRun } from "./use-stage-run";

type DocStage = Exclude<StageName, "build">;

const RUN_EMPTY: Record<DocStage, string> = {
  research: "Searches, sources read and facts kept will stream here.",
  outline: "The script writer’s steps will stream here.",
  script: "Narration progress will stream here.",
  storyboard: "The creative’s decisions will stream here.",
};

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

  const idx = STAGES.indexOf(stage);
  const prev = idx > 0 ? STAGES[idx - 1]! : null;
  const next = STAGES[idx + 1]!;
  const blocked = prev !== null && project.stages[prev] !== "approved";
  const content = run.local && run.partial !== null ? run.partial : (draft ?? saved);
  const dirty = draft !== null && draft !== saved;
  const canApprove = !run.running && !!saved && (st.status === "review" || st.status === "approved" || dirty);

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
        title={`${STAGE_LABEL[stage]} hasn’t run yet`}
        body={STAGE_BLURB[stage]}
        icon={<IconPlay />}
        action={
          <Button variant="primary" size="lg" onClick={() => void run.start()}>
            <IconPlay size={14} /> Run {STAGE_LABEL[stage].toLowerCase()}
          </Button>
        }
      />
    );
  } else if (stage === "research") {
    body = editing ? (
      <textarea
        aria-label="research.md"
        value={content}
        onChange={(e) => setDraft(e.target.value)}
        spellCheck={false}
        className="field min-h-[70vh] w-full resize-y p-4 font-mono text-[13px] leading-[1.65]"
      />
    ) : (
      <article className="max-w-[72ch]">
        <Markdown source={content} />
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
          {dirty && <span className="text-[12px] text-ember">Unsaved edits</span>}
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
                  {editing ? (
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
                    run.error && !run.running ? (
                      <Button size="sm" variant="secondary" onClick={() => void run.start()}>
                        <IconRefresh size={13} /> Re-run
                      </Button>
                    ) : undefined
                  }
                />
              </div>
            )}
            {editing && <p className="mb-4 rounded-lg bg-raised px-3 py-2 text-[12.5px] text-sub">Editing {file}. Your changes are saved when you press Done editing or approve. Esc discards them.</p>}
            {body}
          </div>
        </div>
      </div>
      <ActivityPanel log={run.log} usage={run.usage} model={run.model} running={run.running} empty={RUN_EMPTY[stage]} />
    </div>
  );
}
