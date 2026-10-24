"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "@/lib/client/api";
import { STAGES, type Project, type StageName, type StageStatus } from "@/lib/types";
import { IconArrowLeft, IconChevron } from "./icons";
import { usePersistedFlag } from "./use-persisted";
import { cx, Kbd, money, StatusGlyph } from "./ui";

interface Ctx {
  project: Project;
  refresh: () => Promise<Project | null>;
  setProject: (p: Project) => void;
  /** Optimistic status for live runs, before the server state is re-read. */
  setStageStatus: (stage: StageName, status: StageStatus) => void;
}

const ProjectCtx = createContext<Ctx | null>(null);

export function useProject(): Ctx {
  const c = useContext(ProjectCtx);
  if (!c) throw new Error("useProject outside ProjectShell");
  return c;
}

export const STAGE_LABEL: Record<StageName, string> = {
  research: "Research",
  outline: "Outline",
  script: "Script",
  storyboard: "Storyboard",
  build: "Build",
};

export const STAGE_BLURB: Record<StageName, string> = {
  research: "Facts and sources the deck will stand on.",
  outline: "The narrative arc, one point per slide.",
  script: "What each slide says, and how long it gets.",
  storyboard: "How each slide shows it: visual, interaction, motion.",
  build: "Agents write every slide, screenshot it and fix it.",
};

type Step = { key: string; label: string; href: string; status: StageStatus | "done" | "locked"; detail?: string };

function steps(p: Project): Step[] {
  const base = `/p/${p.id}`;
  const list: Step[] = [
    { key: "brief", label: "Brief", href: `${base}/brief`, status: "done" },
    { key: "style", label: "Style", href: `${base}/style`, status: p.hasStyle ? "done" : "idle" },
  ];
  for (const s of STAGES) list.push({ key: s, label: STAGE_LABEL[s], href: s === "build" ? `${base}/build` : `${base}/${s}`, status: p.stages[s] });
  list.push({
    key: "deck",
    label: "Refine",
    href: `${base}/deck`,
    status: p.latestVersion ? "done" : "locked",
    detail: p.latestVersion ? `v${p.latestVersion}` : undefined,
  });
  return list;
}

export function ProjectShell({ initial, children }: { initial: Project; children: ReactNode }) {
  const [project, setProject] = useState(initial);
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = usePersistedFlag("studio:nav-collapsed", false);

  const refresh = useCallback(async () => {
    try {
      const p = await api.loadProject(initial.id);
      setProject(p);
      return p;
    } catch {
      return null;
    }
  }, [initial.id]);

  const setStageStatus = useCallback((stage: StageName, status: StageStatus) => {
    setProject((p) => ({ ...p, stages: { ...p.stages, [stage]: status }, stageState: { ...p.stageState, [stage]: { ...p.stageState[stage], status } } }));
  }, []);

  const list = steps(project);
  const activeKey = list.find((s) => pathname === s.href || pathname.startsWith(`${s.href}/`))?.key;
  const spent = STAGES.reduce((n, s) => n + project.stageState[s].usage.costUsd, 0);

  useEffect(() => {
    const on = () => void refresh();
    window.addEventListener("studio:project-changed", on);
    return () => window.removeEventListener("studio:project-changed", on);
  }, [refresh]);

  // [ and ] step through the workflow.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.closest("input, textarea, select, [contenteditable]") || e.metaKey || e.ctrlKey || e.altKey)) return;
      if (e.key !== "[" && e.key !== "]") return;
      const i = list.findIndex((s) => s.key === activeKey);
      const next = list[i + (e.key === "]" ? 1 : -1)];
      if (next && next.status !== "locked") router.push(next.href);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [list, activeKey, router]);

  const ctx = useMemo(() => ({ project, refresh, setProject, setStageStatus }), [project, refresh, setStageStatus]);

  return (
    <ProjectCtx.Provider value={ctx}>
      <div className="flex h-dvh overflow-hidden">
        <nav aria-label="Workflow" className={cx("flex shrink-0 flex-col border-r border-line bg-panel transition-[width] duration-200", collapsed ? "w-[56px]" : "w-[224px]")}>
          {collapsed ? (
            <div className="flex justify-center pb-3 pt-4">
              <Link href="/" aria-label="All decks" title="All decks" className="grid size-8 place-items-center rounded-md text-dim transition-colors hover:bg-raised hover:text-fg">
                <IconArrowLeft size={15} />
              </Link>
            </div>
          ) : (
            <div className="px-4 pb-4 pt-4">
              <Link href="/" className="inline-flex items-center gap-1.5 rounded-md text-[12.5px] text-dim transition-colors hover:text-fg">
                <IconArrowLeft size={14} />
                All decks
              </Link>
              <h1 className="mt-4 font-display text-[19px] leading-[1.2] tracking-[-0.01em] text-fg">{project.title}</h1>
              <p className="mt-1.5 line-clamp-2 text-[12px] leading-[1.45] text-dim">{project.brief.audience || project.topic}</p>
            </div>
          )}
          <ol className="relative flex-1 px-2">
            <span aria-hidden className={cx("absolute bottom-5 top-5 w-px bg-line", collapsed ? "left-[27px]" : "left-[21px]")} />
            {list.map((s) => {
              const on = s.key === activeKey;
              const locked = s.status === "locked";
              return (
                <li key={s.key} className="relative">
                  <Link
                    href={locked ? "#" : s.href}
                    aria-current={on ? "page" : undefined}
                    aria-disabled={locked || undefined}
                    aria-label={collapsed ? s.label : undefined}
                    title={collapsed ? s.label : undefined}
                    onClick={(e) => locked && e.preventDefault()}
                    className={cx(
                      "group relative flex h-9 items-center gap-3 rounded-lg text-[13px] transition-colors duration-150",
                      collapsed ? "justify-center px-0" : "px-2.5",
                      on ? "bg-raised text-fg" : locked ? "cursor-default text-dim/70" : "text-sub hover:bg-raised/60 hover:text-fg",
                    )}
                  >
                    <span className="relative z-10 rounded-full bg-panel group-hover:bg-transparent">
                      <StatusGlyph status={s.status} />
                    </span>
                    {!collapsed && (
                      <>
                        <span className="flex-1 font-medium">{s.label}</span>
                        {s.detail && <span className="font-mono text-[11px] text-dim">{s.detail}</span>}
                        {s.status === "review" && !on && <span className="text-[11px] text-review">Review</span>}
                      </>
                    )}
                  </Link>
                </li>
              );
            })}
          </ol>
          <div className="border-t border-line px-2 py-2">
            {!collapsed && (
              <div className="px-2 pb-1 pt-1 text-[12px] text-dim">
                <div className="flex items-center justify-between">
                  <span>Agent spend</span>
                  <span className="font-mono text-sub">{money(spent)}</span>
                </div>
                <div className="mt-2 flex items-center gap-1.5">
                  <Kbd>[</Kbd>
                  <Kbd>]</Kbd>
                  <span>move between steps</span>
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={() => setCollapsed(!collapsed)}
              aria-expanded={!collapsed}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={collapsed ? `Expand sidebar · ${money(spent)} spent` : "Collapse sidebar"}
              className={cx("mt-1 flex h-8 w-full items-center gap-2 rounded-lg text-[12.5px] text-dim transition-colors hover:bg-raised/60 hover:text-fg", collapsed ? "justify-center" : "px-2.5")}
            >
              <IconChevron size={14} className={cx("transition-transform", collapsed ? "-rotate-90" : "rotate-90")} />
              {!collapsed && "Collapse"}
            </button>
          </div>
        </nav>
        <main className="min-w-0 flex-1 overflow-hidden">{children}</main>
      </div>
    </ProjectCtx.Provider>
  );
}
