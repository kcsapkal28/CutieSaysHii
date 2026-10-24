import Link from "next/link";
import { HomeKeys } from "@/components/home-keys";
import { IconPlus } from "@/components/icons";
import { SlideFrame } from "@/components/slide-frame";
import { StylePoster } from "@/components/style-poster";
import { backend } from "@/lib/server/backend-instance";
import { STAGES, type ProjectSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

function stepLabel(p: ProjectSummary): { text: string; tone: string } {
  if (p.stages.build === "running") return { text: "Building", tone: "text-ember" };
  if (p.latestVersion) return { text: `v${p.latestVersion} · refining`, tone: "text-sub" };
  const review = STAGES.find((s) => p.stages[s] === "review");
  if (review) return { text: `${review[0]!.toUpperCase()}${review.slice(1)} needs review`, tone: "text-review" };
  const running = STAGES.find((s) => p.stages[s] === "running");
  if (running) return { text: `${running[0]!.toUpperCase()}${running.slice(1)} running`, tone: "text-ember" };
  if (p.stages.research === "error" || STAGES.some((s) => p.stages[s] === "error")) return { text: "A stage failed", tone: "text-bad" };
  if (!p.hasStyle) return { text: "Pick a style", tone: "text-sub" };
  const next = STAGES.find((s) => p.stages[s] !== "approved");
  return { text: next === "build" ? "Ready to build" : `Ready for ${next ?? "refining"}`, tone: "text-sub" };
}

function ago(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

function Progress({ p }: { p: ProjectSummary }) {
  const marks = [p.hasStyle ? "approved" : "idle", ...STAGES.map((s) => p.stages[s])];
  return (
    <div className="flex gap-1" aria-label={`${marks.filter((m) => m === "approved").length} of ${marks.length} steps approved`}>
      {marks.map((m, i) => (
        <span
          key={i}
          className={`h-1 flex-1 rounded-full ${m === "approved" ? "bg-ok/70" : m === "review" ? "bg-review/80" : m === "running" ? "bg-ember" : m === "error" ? "bg-bad" : "bg-line-strong/70"}`}
        />
      ))}
    </div>
  );
}

export default async function Home() {
  const projects = await backend().listProjects();
  return (
    <div className="min-h-dvh">
      <HomeKeys />
      <header className="sticky top-0 z-10 border-b border-line/70 bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1200px] items-center justify-between px-8">
          <Link href="/" className="flex items-center gap-2.5 rounded-md">
            <Mark />
            <span className="font-display text-[17px] tracking-[-0.01em]">DeckForge</span>
          </Link>
          <Link href="/new" className="inline-flex h-8 items-center gap-2 rounded-lg bg-fg pl-2.5 pr-2 text-[13px] font-medium text-bg transition-colors hover:bg-white">
            <IconPlus size={14} />
            New deck
            <kbd className="ml-1 rounded border border-bg/15 px-1 text-[11px] font-medium text-bg/60">N</kbd>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-[1200px] px-8 pb-24 pt-14">
        <h1 className="font-display text-[40px] font-normal leading-[1.05] tracking-[-0.02em]">Decks</h1>
        <p className="mt-3 max-w-[60ch] text-[14px] text-sub">
          Each deck ends as one self-contained HTML file: agents research and outline it with you, then build every slide and check it in a real browser.
        </p>

        {projects.length === 0 ? (
          <div className="mt-12 rounded-2xl border border-dashed border-line-strong px-8 py-20 text-center">
            <h2 className="font-display text-[24px] tracking-[-0.01em]">Start with a topic</h2>
            <p className="mx-auto mt-2 max-w-[46ch] text-[13.5px] text-sub">Tell the agents what the talk is about and who it’s for. You’ll approve every stage before anything is built.</p>
            <Link href="/new" className="mt-6 inline-flex h-10 items-center gap-2 rounded-lg bg-fg px-4 text-[14px] font-medium text-bg hover:bg-white">
              <IconPlus size={14} />
              New deck
            </Link>
          </div>
        ) : (
          <ul className="mt-10 grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => {
              const step = stepLabel(p);
              return (
                <li key={p.id}>
                  <Link href={`/p/${p.id}`} className="group block rounded-xl focus-visible:outline-offset-4">
                    <div className="overflow-hidden rounded-xl border border-line bg-panel transition-[border-color,transform] duration-200 group-hover:border-line-strong">
                      {p.latestVersion ? (
                        <SlideFrame src={`/api/projects/${p.id}/versions/${p.latestVersion}/deck.html?df-shot=s01`} title={`${p.title} cover`} />
                      ) : p.style ? (
                        <StylePoster style={p.style} title={p.title} />
                      ) : (
                        <div className="stage-grid grid aspect-video place-items-center">
                          <span className="rounded-full border border-line bg-panel px-3 py-1 text-[12px] text-dim">No style yet</span>
                        </div>
                      )}
                    </div>
                    <div className="mt-3.5 flex items-baseline justify-between gap-4">
                      <h2 className="truncate text-[15px] font-medium text-fg">{p.title}</h2>
                      <span className="shrink-0 text-[12px] text-dim">{ago(p.updatedAt)}</span>
                    </div>
                    <p className={`mt-0.5 text-[12.5px] ${step.tone}`}>
                      {step.text}
                      {p.slideCount > 0 && <span className="text-dim"> · {p.slideCount} slides</span>}
                    </p>
                    <div className="mt-3">
                      <Progress p={p} />
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}

function Mark() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
      <rect x="1.5" y="4" width="13" height="10" rx="2" fill="none" stroke="var(--color-fg)" strokeWidth="1.5" />
      <rect x="5.5" y="7" width="13" height="10" rx="2" fill="var(--color-ember)" />
    </svg>
  );
}
