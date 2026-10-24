"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { streamEvents } from "@/lib/client/api";
import type { PipelineEvent } from "@/lib/events";
import type { StageName, Usage } from "@/lib/types";
import { useProject } from "./project-shell";

export interface LogLine {
  at: string;
  message: string;
  tone?: "ok" | "warn" | "bad";
}

/**
 * Runs one stage over SSE and keeps the live state: log, usage, partial output, error.
 * Navigation does not cancel a run; if the stage is running without a local stream (opened in another tab or
 * after navigating back), it polls the project until the run ends.
 */
export function useStageRun(stage: StageName, onEvent?: (e: PipelineEvent) => void) {
  const { project, refresh, setStageStatus } = useProject();
  const st = project.stageState[stage];
  const [log, setLog] = useState<LogLine[]>(st.log);
  const [usage, setUsage] = useState<Usage>(st.usage);
  const [model, setModel] = useState<string | null>(null);
  const [partial, setPartial] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(st.status === "error" ? (st.error ?? "The last run failed.") : null);
  const [local, setLocal] = useState(false);
  const ctrl = useRef<AbortController | null>(null);
  const cb = useRef(onEvent);
  cb.current = onEvent;

  const running = local || st.status === "running";

  const start = useCallback(async () => {
    if (ctrl.current) return;
    const c = new AbortController();
    ctrl.current = c;
    setLocal(true);
    setError(null);
    setLog([]);
    setPartial(null);
    setUsage({ inputTokens: 0, outputTokens: 0, costUsd: 0 });
    setStageStatus(stage, "running");
    try {
      await streamEvents(
        `/api/projects/${project.id}/stages/${stage}/run`,
        undefined,
        (e) => {
          if (e.type === "progress") setLog((l) => [...l, { at: e.at, message: e.message }]);
          else if (e.type === "usage") {
            setUsage(e.usage);
            setModel(e.model);
          }
          else if (e.type === "stage.output") setPartial(e.content);
          else if (e.type === "critic.verdict")
            setLog((l) => [...l, { at: new Date().toISOString(), message: `${e.slideId} round ${e.round}: ${e.verdict === "pass" ? "critic passed it" : `${e.issues.length} issue${e.issues.length === 1 ? "" : "s"} to fix`}`, tone: e.verdict === "pass" ? "ok" : "warn" }]);
          else if (e.type === "error") {
            setError(e.message);
            setLog((l) => [...l, { at: new Date().toISOString(), message: e.message, tone: "bad" }]);
          }
          else if (e.type === "stage.done") setLog((l) => [...l, { at: e.at, message: "Done. Waiting for your review.", tone: "ok" }]);
          cb.current?.(e);
        },
        c.signal,
      );
    } catch (e) {
      if (!c.signal.aborted) setError((e as Error).message);
    } finally {
      ctrl.current = null;
      setLocal(false);
      await refresh();
    }
  }, [project.id, stage, refresh, setStageStatus]);

  const stop = useCallback(() => {
    ctrl.current?.abort();
  }, []);

  // Remote run: poll until it finishes.
  useEffect(() => {
    if (local || st.status !== "running") return;
    const t = setInterval(() => void refresh(), 1500);
    return () => clearInterval(t);
  }, [local, st.status, refresh]);

  // Pick up server-side log/usage when not streaming locally.
  useEffect(() => {
    if (local) return;
    setLog(st.log);
    setUsage(st.usage);
    setError(st.status === "error" ? (st.error ?? "The last run failed.") : null);
  }, [local, st.log, st.usage, st.status, st.error]);

  return { running, local, log, usage, model, partial, error, start, stop };
}
