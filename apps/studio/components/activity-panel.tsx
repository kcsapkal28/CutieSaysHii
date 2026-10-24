"use client";
import { useEffect, useRef } from "react";
import type { Usage } from "@/lib/types";
import type { LogLine } from "./use-stage-run";
import { cx, money, Spinner, tokens } from "./ui";

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

export function ActivityPanel({ log, usage, model, running, empty }: { log: LogLine[]; usage: Usage; model: string | null; running: boolean; empty: string }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [log.length]);
  return (
    <aside aria-label="Agent activity" className="flex h-full w-[300px] shrink-0 flex-col border-l border-line bg-panel">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-line px-4">
        <span className="text-[12.5px] font-semibold text-fg">Agent activity</span>
        {running && (
          <span className="flex items-center gap-1.5 text-[11.5px] text-ember">
            <span className="size-1.5 animate-pulse-dot rounded-full bg-ember" /> Live
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3" aria-live="polite">
        {log.length === 0 ? (
          <p className="pt-2 text-[12.5px] leading-[1.5] text-dim">{empty}</p>
        ) : (
          <ol className="relative space-y-2.5">
            {log.map((l, i) => {
              const last = i === log.length - 1;
              return (
                <li key={i} className="flex animate-rise gap-2.5 text-[12.5px] leading-[1.45]">
                  <span className="mt-[5px] shrink-0">
                    {last && running ? (
                      <Spinner size={10} className="text-ember" />
                    ) : (
                      <span className={cx("block size-1.5 rounded-full", l.tone === "ok" ? "bg-ok" : l.tone === "warn" ? "bg-ember" : l.tone === "bad" ? "bg-bad" : "bg-dim")} />
                    )}
                  </span>
                  <span className={cx("flex-1", l.tone === "bad" ? "text-bad" : last ? "text-fg" : "text-sub")}>{l.message}</span>
                  <span className="shrink-0 font-mono text-[10.5px] text-dim">{clock(l.at)}</span>
                </li>
              );
            })}
          </ol>
        )}
        <div ref={end} />
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
