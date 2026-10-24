"use client";
import { useEffect, useRef, useState } from "react";
import type { Usage } from "@/lib/types";
import type { LogLine } from "./use-stage-run";
import { IconChevron } from "./icons";
import { usePersistedFlag } from "./use-persisted";
import { cx, money, Spinner, tokens } from "./ui";

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

type Tone = NonNullable<LogLine["tone"]>;

/** Lines saved by the server carry no tone, so read it from the wording too. */
function toneOf(l: LogLine): Tone | undefined {
  if (l.tone) return l.tone;
  if (/\b(failed|error)\b/i.test(l.message)) return "bad";
  if (/one more fix round|issue|cleared outdated/i.test(l.message)) return "warn";
  if (/passed|finished|settled|bundled|done/i.test(l.message)) return "ok";
  return undefined;
}

const SLIDE = /^(s\d{2})\b[:\s]*/;

export function ActivityPanel({ log, usage, model, running, empty }: { log: LogLine[]; usage: Usage; model: string | null; running: boolean; empty: string }) {
  const [collapsed, setCollapsed] = usePersistedFlag("studio:activity-collapsed", false);
  const [copied, setCopied] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  // Follow new lines, unless the reader has scrolled up to look at something.
  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [log.length, collapsed]);

  /** Gap since the previous line, so slow steps stand out. */
  const gap = (i: number) => {
    if (i === 0) return "";
    const s = Math.max(0, Math.round((new Date(log[i]!.at).getTime() - new Date(log[i - 1]!.at).getTime()) / 1000));
    return s < 60 ? `+${s}s` : s < 3600 ? `+${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s` : "+1h+";
  };

  async function copy() {
    try {
      await navigator.clipboard.writeText(log.map((l) => `${clock(l.at)}  ${l.message}`).join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  }

  if (collapsed) {
    return (
      <aside aria-label="Agent activity" className="flex h-full w-[44px] shrink-0 flex-col items-center border-l border-line bg-panel py-3">
        <button type="button" onClick={() => setCollapsed(false)} aria-expanded={false} aria-label="Expand agent activity" title="Expand agent activity" className="grid size-8 place-items-center rounded-md text-dim hover:bg-raised hover:text-fg">
          <IconChevron size={14} className="rotate-90" />
        </button>
        {running && <span className="mt-3 size-1.5 animate-pulse-dot rounded-full bg-ember" title="Live" />}
        <span className="mt-4 text-[11.5px] font-medium text-dim [writing-mode:vertical-rl]">
          Agent activity · {log.length} line{log.length === 1 ? "" : "s"} · {money(usage.costUsd)}
        </span>
      </aside>
    );
  }

  return (
    <aside aria-label="Agent activity" className="flex h-full w-[340px] shrink-0 flex-col border-l border-line bg-panel">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line pl-4 pr-2">
        <span className="text-[12.5px] font-semibold text-fg">Agent activity</span>
        {running && (
          <span className="flex items-center gap-1.5 text-[11.5px] text-ember">
            <span className="size-1.5 animate-pulse-dot rounded-full bg-ember" /> Live
          </span>
        )}
        <span className="ml-auto font-mono text-[11px] text-dim">{log.length}</span>
        {log.length > 0 && (
          <button type="button" onClick={() => void copy()} className="rounded px-1.5 py-1 text-[11.5px] text-dim hover:bg-raised hover:text-fg">
            {copied ? "Copied" : "Copy"}
          </button>
        )}
        <button type="button" onClick={() => setCollapsed(true)} aria-expanded aria-label="Collapse agent activity" title="Collapse agent activity" className="grid size-7 place-items-center rounded-md text-dim hover:bg-raised hover:text-fg">
          <IconChevron size={14} className="-rotate-90" />
        </button>
      </div>
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-3"
        aria-live="polite"
      >
        {log.length === 0 ? (
          <p className="pt-2 text-[12.5px] leading-[1.5] text-dim">{empty}</p>
        ) : (
          <ol className="space-y-2">
            {log.map((l, i) => {
              const last = i === log.length - 1;
              const tone = toneOf(l);
              const m = SLIDE.exec(l.message);
              return (
                <li key={i} className="flex animate-rise gap-2.5 text-[12.5px] leading-[1.45]">
                  <span className="mt-[5px] shrink-0">
                    {last && running ? (
                      <Spinner size={10} className="text-ember" />
                    ) : (
                      <span className={cx("block size-1.5 rounded-full", tone === "ok" ? "bg-ok" : tone === "warn" ? "bg-ember" : tone === "bad" ? "bg-bad" : "bg-dim")} />
                    )}
                  </span>
                  <span className={cx("min-w-0 flex-1 break-words", tone === "bad" ? "text-bad" : last ? "text-fg" : "text-sub")}>
                    {m && <span className="mr-1.5 rounded bg-raised px-1 py-px font-mono text-[10.5px] text-sub">{m[1]}</span>}
                    {m ? l.message.slice(m[0].length) : l.message}
                  </span>
                  <span className="shrink-0 text-right font-mono text-[10.5px] leading-[1.45] text-dim" title={clock(l.at)}>
                    {clock(l.at)}
                    <span className="block text-dim/70">{gap(i)}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </div>
      <div className="grid shrink-0 grid-cols-3 border-t border-line text-[11.5px]">
        <div className="px-4 py-2.5">
          <div className="text-dim">Input</div>
          <div className="font-mono text-sub">{tokens(usage.inputTokens)}</div>
        </div>
        <div className="px-2 py-2.5">
          <div className="text-dim">Output</div>
          <div className="font-mono text-sub">{tokens(usage.outputTokens)}</div>
        </div>
        <div className="px-2 py-2.5">
          <div className="text-dim">Cost</div>
          <div className="font-mono text-sub">{money(usage.costUsd)}</div>
        </div>
        {model && <div className="col-span-3 -mt-1 px-4 pb-2.5 font-mono text-[10.5px] text-dim">{model}</div>}
      </div>
    </aside>
  );
}
