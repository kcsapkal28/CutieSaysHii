"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, deckUrl, streamEvents } from "@/lib/client/api";
import { outlineSlides, type Outline, type Style, type VersionInfo } from "@/lib/types";
import { IconArrowRight, IconChat, IconCheck, IconCompare, IconDownload, IconExternal, IconHistory, IconSend, IconUndo, IconX } from "./icons";
import { useProject } from "./project-shell";
import { SlideFrame } from "./slide-frame";
import { Button, ButtonLink, cx, EmptyState, ErrorNote, Kbd, Spinner, timeAgo } from "./ui";

type Step = { text: string; state: "active" | "done" | "warn" };
interface Msg {
  id: number;
  role: "user" | "agent";
  slideId: string;
  text: string;
  steps?: Step[];
  status?: "running" | "done" | "error";
  version?: number;
}

const SUGGEST = ["Make the packets slower", "Make the title bigger", "Say it in plainer words"];
const PHASE: Record<string, string> = { build: "Rewriting the slide", shoot: "Screenshotting each step", critique: "Critic is checking it" };

export function DeckViewer() {
  const { project, refresh } = useProject();
  const slides = (() => {
    try {
      return outlineSlides(JSON.parse(project.files["outline.json"] ?? "") as Outline);
    } catch {
      return [];
    }
  })();
  const style = (() => {
    try {
      return JSON.parse(project.files["style.json"] ?? "") as Style;
    } catch {
      return null;
    }
  })();
  const slideIds = slides.map((s) => s.id);
  const titleOf = (id: string) => slides.find((s) => s.id === id)?.title ?? id;

  const [versions, setVersions] = useState<VersionInfo[]>([]);
  const [vLoading, setVLoading] = useState(true);
  const [view, setView] = useState<number | null>(project.latestVersion);
  const [slide, setSlide] = useState(slideIds[0] ?? "s01");
  const [frameKey, setFrameKey] = useState(0);
  const [tab, setTab] = useState<"chat" | "versions">("chat");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [compare, setCompare] = useState<[number, number] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const thread = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  const latest = versions.at(-1)?.version ?? project.latestVersion;
  const hasDock = !!style && (style.features.timer || style.features.notes || style.features.stepNav);

  const loadVersions = useCallback(async () => {
    try {
      setVersions(await api.listVersions(project.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setVLoading(false);
    }
  }, [project.id]);
  useEffect(() => {
    void loadVersions();
  }, [loadVersions]);

  // Follow the slide the presenter is on (the shell writes #sNN.step into the iframe's URL).
  useEffect(() => {
    const t = setInterval(() => {
      try {
        const h = frame.current?.contentWindow?.location.hash ?? "";
        const m = /^#(s\d{2})/.exec(h);
        if (m && m[1] !== slide) setSlide(m[1]!);
      } catch {
        /* cross-origin during load */
      }
    }, 300);
    return () => clearInterval(t);
  }, [slide]);

  useEffect(() => {
    thread.current?.scrollTo({ top: thread.current.scrollHeight, behavior: "smooth" });
  }, [msgs]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === "Escape" && compare) setCompare(null);
      if (t?.closest("input, textarea, select")) return;
      if (e.key === "/") {
        e.preventDefault();
        setTab("chat");
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [compare]);

  const goto = (id: string) => {
    setSlide(id);
    const i = slideIds.indexOf(id);
    try {
      (frame.current?.contentWindow as unknown as { DF?: { go(i: number): void } })?.DF?.go(i);
    } catch {
      /* ignore */
    }
  };

  async function send(text: string) {
    const instruction = text.trim();
    if (!instruction || sending) return;
    const target = slide;
    setInput("");
    setSending(true);
    setError(null);
    const uid = ++seq.current;
    const aid = ++seq.current;
    setMsgs((m) => [...m, { id: uid, role: "user", slideId: target, text: instruction }, { id: aid, role: "agent", slideId: target, text: "", steps: [], status: "running" }]);
    const patch = (fn: (m: Msg) => Msg) => setMsgs((list) => list.map((m) => (m.id === aid ? fn(m) : m)));
    const pushStep = (text: string, state: Step["state"] = "active") =>
      patch((m) => ({ ...m, steps: [...(m.steps ?? []).map((s) => (s.state === "active" ? { ...s, state: "done" as const } : s)), { text, state }] }));
    try {
      await streamEvents(`/api/projects/${project.id}/slides/${target}/revise`, { instruction }, (e) => {
        if (e.type === "progress") pushStep(e.message);
        else if (e.type === "slide.round") pushStep(`Round ${e.round} · ${PHASE[e.phase]}`);
        else if (e.type === "critic.verdict" && e.verdict === "revise") pushStep(`Critic: ${e.issues[0] ?? "needs another pass"}`, "warn");
        else if (e.type === "version") {
          patch((m) => ({
            ...m,
            status: "done",
            version: e.version,
            steps: (m.steps ?? []).map((s) => (s.state === "active" ? { ...s, state: "done" } : s)),
            text: `Updated ${target}. Saved as v${e.version}.`,
          }));
          setView(e.version);
          setFrameKey((k) => k + 1);
        } else if (e.type === "error") patch((m) => ({ ...m, status: "error", text: e.message }));
      });
      await Promise.all([loadVersions(), refresh()]);
    } catch (e) {
      patch((m) => ({ ...m, status: "error", text: (e as Error).message }));
    } finally {
      setSending(false);
    }
  }

  async function restore(v: number) {
    setError(null);
    try {
      const info = await api.restore(project.id, v);
      await Promise.all([loadVersions(), refresh()]);
      setView(info.version);
      setCompare(null);
      setFrameKey((k) => k + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!project.latestVersion)
    return (
      <div className="grid h-full place-items-center">
        <EmptyState
          title="Nothing to refine yet"
          body="Build the deck first. Every build and every chat edit is saved as a version you can compare and roll back."
          action={
            <Link href={`/p/${project.id}/build`} className="inline-flex h-8 items-center gap-2 rounded-lg bg-raised px-3 text-[13px] font-medium ring-1 ring-line hover:bg-hover">
              Go to build <IconArrowRight size={14} />
            </Link>
          }
        />
      </div>
    );

  const shown = view ?? latest ?? 1;
  const viewingOld = latest !== null && shown !== latest;
  const changedIn = (v: number) => versions.find((x) => x.version === v)?.changed ?? [];

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-6">
          <h1 className="font-display text-[22px] tracking-[-0.01em]">{compare ? "Compare versions" : "Deck"}</h1>
          <span className="rounded-md bg-raised px-2 py-0.5 font-mono text-[12px] text-sub">v{shown}</span>
          {viewingOld && <span className="text-[12px] text-ember">Older version</span>}
          <div className="ml-auto flex items-center gap-2">
            {compare ? (
              <Button variant="secondary" onClick={() => setCompare(null)}>
                <IconX size={13} /> Close compare <Kbd>Esc</Kbd>
              </Button>
            ) : (
              <Button variant="ghost" disabled={versions.length < 2} onClick={() => setCompare([versions.at(-2)!.version, versions.at(-1)!.version])}>
                <IconCompare size={14} /> Compare
              </Button>
            )}
            <a href={deckUrl(project.id, shown)} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-2 rounded-lg px-3 text-[13px] font-medium text-sub hover:bg-hover hover:text-fg">
              <IconExternal size={14} /> Present
            </a>
            <ButtonLink href={deckUrl(project.id, shown, { download: true })} download={`${project.id}-v${shown}.html`} variant="primary">
              <IconDownload size={14} /> Download deck.html
            </ButtonLink>
          </div>
        </header>

        {error && (
          <div className="px-6 pt-4">
            <ErrorNote message={error} />
          </div>
        )}

        {compare ? (
          <div className="stage-grid flex min-h-0 flex-1 flex-col">
            <div className="grid min-h-0 flex-1 grid-cols-2 content-center gap-5 overflow-y-auto p-6">
              {compare.map((v, side) => (
                <div key={side} className="min-w-0">
                  <div className="mb-2.5 flex h-7 items-center gap-2">
                    <select
                      aria-label={side === 0 ? "Left version" : "Right version"}
                      value={v}
                      onChange={(e) => setCompare((c) => (c ? (side === 0 ? [Number(e.target.value), c[1]] : [c[0], Number(e.target.value)]) : c))}
                      className="field h-7 w-[72px] px-2 py-0 font-mono text-[12px]"
                    >
                      {versions.map((x) => (
                        <option key={x.version} value={x.version}>
                          v{x.version}
                        </option>
                      ))}
                    </select>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-sub">{versions.find((x) => x.version === v)?.note}</span>
                    {v !== latest && (
                      <Button size="sm" variant="secondary" onClick={() => void restore(v)}>
                        <IconUndo size={13} /> Restore v{v}
                      </Button>
                    )}
                  </div>
                  <div className={cx("overflow-hidden rounded-xl ring-1", changedIn(Math.max(...compare)).includes(slide) ? "ring-ember/50" : "ring-line")}>
                    <SlideFrame src={`${deckUrl(project.id, v)}#${slide}`} height={hasDock ? 1152 : 1080} title={`v${v} ${slide}`} lazy={false} />
                  </div>
                </div>
              ))}
              <p className="col-span-2 text-center text-[12px] text-dim">Both versions play live. Slides marked with a dot changed between them.</p>
            </div>
            <div role="tablist" aria-label="Slide" className="flex shrink-0 gap-1.5 overflow-x-auto border-t border-line bg-panel px-6 py-3">
              {slideIds.map((id) => {
                const changed = compare.some((v) => changedIn(v).includes(id)) && compare[0] !== compare[1];
                return (
                  <button
                    key={id}
                    role="tab"
                    aria-selected={id === slide}
                    onClick={() => setSlide(id)}
                    className={cx("relative h-8 shrink-0 rounded-lg px-3 font-mono text-[12px] transition-colors", id === slide ? "bg-fg text-bg" : "bg-raised text-sub hover:text-fg")}
                  >
                    {id}
                    {changed && <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-ember ring-2 ring-panel" title="Changed between these versions" />}
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="stage-grid flex min-h-0 flex-1 flex-col">
            {viewingOld && (
              <div className="mx-6 mt-4 flex items-center gap-3 rounded-lg border border-ember/30 bg-ember/[0.07] px-3.5 py-2 text-[13px]">
                <IconHistory className="text-ember" />
                <span className="flex-1">You’re viewing v{shown}. Chat edits always apply to the latest version (v{latest}).</span>
                <Button size="sm" variant="secondary" onClick={() => void restore(shown)}>
                  <IconUndo size={13} /> Restore v{shown}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => (setView(latest), setFrameKey((k) => k + 1))}>
                  Back to latest
                </Button>
              </div>
            )}
            <div className="flex min-h-0 flex-1 items-center justify-center p-6">
              <div className="relative w-full max-w-[1180px]" style={{ aspectRatio: hasDock ? "1920 / 1152" : "16 / 9", maxHeight: "100%" }}>
                <iframe
                  key={`${shown}-${frameKey}`}
                  ref={frame}
                  title={`${project.title} v${shown}`}
                  src={`${deckUrl(project.id, shown)}#${slide}`}
                  className="absolute inset-0 size-full rounded-xl border-0 bg-black shadow-[0_0_0_1px_rgb(255_255_255/0.06),0_40px_100px_-30px_rgb(0_0_0/0.8)]"
                />
              </div>
            </div>
            <div className="flex shrink-0 items-center justify-center gap-3 pb-4 text-[11.5px] text-dim">
              <span>Click the deck, then</span>
              <Kbd>←</Kbd>
              <Kbd>→</Kbd>
              <span>to step through</span>
              {style?.features.notes && (
                <>
                  <Kbd>N</Kbd> <span>notes</span>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* side panel */}
      <aside className="flex w-[340px] shrink-0 flex-col border-l border-line bg-panel">
        <div role="tablist" aria-label="Panel" className="flex h-11 shrink-0 items-end gap-4 border-b border-line px-4">
          {(
            [
              ["chat", "Chat", IconChat],
              ["versions", `Versions${versions.length ? ` · ${versions.length}` : ""}`, IconHistory],
            ] as const
          ).map(([k, label, Icon]) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={cx("-mb-px flex h-10 items-center gap-1.5 border-b-2 text-[12.5px] font-medium transition-colors", tab === k ? "border-ember text-fg" : "border-transparent text-sub hover:text-fg")}
            >
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>

        {tab === "chat" ? (
          <>
            <div className="border-b border-line px-4 py-3">
              <label htmlFor="slide-pick" className="label">
                Editing slide
              </label>
              <select id="slide-pick" value={slide} onChange={(e) => goto(e.target.value)} className="field mt-1.5 h-8 px-2 py-0 text-[13px]">
                {slideIds.map((id) => (
                  <option key={id} value={id}>
                    {id} · {titleOf(id)}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-[11.5px] text-dim">Follows the deck as you present.</p>
            </div>
            <div ref={thread} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4" aria-live="polite">
              {msgs.length === 0 ? (
                <div className="pt-2">
                  <p className="text-[13px] leading-[1.55] text-sub">
                    Describe a change to <span className="font-mono text-fg">{slide}</span>. The builder rewrites just that slide, the critic checks it, and you get a new version.
                  </p>
                  <div className="mt-4 flex flex-col items-start gap-2">
                    {SUGGEST.map((s) => (
                      <button key={s} type="button" onClick={() => void send(s)} className="rounded-full border border-line px-3 py-1.5 text-left text-[12.5px] text-sub transition-colors hover:border-line-strong hover:text-fg">
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                msgs.map((m) =>
                  m.role === "user" ? (
                    <div key={m.id} className="flex animate-rise flex-col items-end">
                      <span className="mb-1 font-mono text-[10.5px] text-dim">{m.slideId}</span>
                      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-hover px-3.5 py-2 text-[13px] text-fg">{m.text}</div>
                    </div>
                  ) : (
                    <div key={m.id} className="animate-rise">
                      <ol className="space-y-1.5">
                        {(m.steps ?? []).map((s, i) => (
                          <li key={i} className="flex items-start gap-2 text-[12.5px]">
                            <span className="mt-[3px] shrink-0">
                              {s.state === "active" && m.status === "running" ? (
                                <Spinner size={11} className="text-ember" />
                              ) : s.state === "warn" ? (
                                <span className="mt-[3px] block size-1.5 rounded-full bg-ember" />
                              ) : (
                                <IconCheck size={11} strokeWidth={2.2} className="text-ok" />
                              )}
                            </span>
                            <span className={s.state === "active" && m.status === "running" ? "text-fg" : "text-sub"}>{s.text}</span>
                          </li>
                        ))}
                      </ol>
                      {m.status === "done" && (
                        <div className="mt-2.5 flex items-center gap-2 rounded-lg border border-ok/25 bg-ok/[0.06] px-3 py-2 text-[12.5px]">
                          <IconCheck size={13} className="text-ok" strokeWidth={2} />
                          <span className="flex-1 text-fg">{m.text}</span>
                          {m.version && m.version > 1 && (
                            <button type="button" className="text-[12px] text-sub underline-offset-2 hover:text-fg hover:underline" onClick={() => setCompare([m.version! - 1, m.version!])}>
                              Compare
                            </button>
                          )}
                        </div>
                      )}
                      {m.status === "error" && <div className="mt-2.5 rounded-lg border border-bad/30 bg-bad/[0.07] px-3 py-2 text-[12.5px] text-fg">{m.text}</div>}
                    </div>
                  ),
                )
              )}
            </div>
            <form
              className="border-t border-line p-3"
              onSubmit={(e) => {
                e.preventDefault();
                void send(input);
              }}
            >
              <div className="rounded-xl border border-line bg-bg/60 focus-within:border-ember/60">
                <textarea
                  ref={inputRef}
                  aria-label={`Describe a change to ${slide}`}
                  rows={2}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send(input);
                    }
                  }}
                  placeholder={`Change ${slide}…`}
                  className="block w-full resize-none bg-transparent px-3 pt-2.5 text-[13px] placeholder:text-dim focus:outline-none"
                />
                <div className="flex items-center justify-between px-2 pb-2">
                  <span className="flex items-center gap-1 pl-1 text-[11px] text-dim">
                    <Kbd>/</Kbd> to focus
                  </span>
                  <Button type="submit" size="sm" variant={input.trim() ? "ember" : "secondary"} disabled={!input.trim() || sending} aria-label="Send">
                    {sending ? <Spinner size={12} /> : <IconSend size={13} />}
                  </Button>
                </div>
              </div>
            </form>
          </>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            {vLoading ? (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="skeleton h-16 rounded-lg" />
                ))}
              </div>
            ) : (
              <ol className="space-y-1.5">
                {[...versions].reverse().map((v) => {
                  const on = v.version === shown;
                  return (
                    <li key={v.version}>
                      <div className={cx("rounded-lg border px-3 py-2.5 transition-colors", on ? "border-ember/50 bg-ember/[0.05]" : "border-line hover:border-line-strong")}>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[12px] text-fg">v{v.version}</span>
                          {v.version === latest && <span className="rounded bg-ok/12 px-1.5 text-[10.5px] font-medium text-ok">Latest</span>}
                          <span className="ml-auto text-[11px] text-dim">{timeAgo(v.createdAt)}</span>
                        </div>
                        <p className="mt-1 text-[12.5px] leading-[1.45] text-sub">{v.note}</p>
                        <div className="mt-2 flex items-center gap-1">
                          {v.changed.length > 0 && v.changed.length < 6 && (
                            <span className="mr-auto flex gap-1">
                              {v.changed.map((c) => (
                                <span key={c} className="rounded bg-raised px-1.5 font-mono text-[10.5px] text-dim">
                                  {c}
                                </span>
                              ))}
                            </span>
                          )}
                          <span className="ml-auto flex gap-1">
                            {!on && (
                              <Button size="sm" variant="ghost" onClick={() => (setView(v.version), setCompare(null), setFrameKey((k) => k + 1))}>
                                View
                              </Button>
                            )}
                            {v.version !== latest && (
                              <Button size="sm" variant="ghost" onClick={() => setCompare([v.version, latest!])}>
                                Compare
                              </Button>
                            )}
                            {v.version !== latest && (
                              <Button size="sm" variant="ghost" onClick={() => void restore(v.version)}>
                                Restore
                              </Button>
                            )}
                          </span>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
