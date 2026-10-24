"use client";
// Browser-side calls to the route handlers, plus an SSE reader for POST streams (EventSource is GET-only).
import type { PipelineEvent } from "../events";
import type { Brief, Project, ProjectSummary, StageFileName, StageName, Style, VersionInfo } from "../types";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export const api = {
  listProjects: () => fetch("/api/projects", { cache: "no-store" }).then((r) => json<ProjectSummary[]>(r)),
  createProject: (brief: Brief) =>
    fetch("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(brief) }).then((r) =>
      json<ProjectSummary>(r),
    ),
  loadProject: (id: string) => fetch(`/api/projects/${id}`, { cache: "no-store" }).then((r) => json<Project>(r)),
  approve: (id: string, stage: StageName) => fetch(`/api/projects/${id}/stages/${stage}/approve`, { method: "POST" }).then((r) => json<Project>(r)),
  saveFile: (id: string, file: StageFileName, content: string) =>
    fetch(`/api/projects/${id}/files/${file}`, { method: "PUT", body: content }).then((r) => json<Project>(r)),
  recommendStyle: (brief: Brief) =>
    fetch("/api/style/recommend", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(brief) }).then((r) =>
      json<{ style: Style; rationale: string }>(r),
    ),
  listVersions: (id: string) => fetch(`/api/projects/${id}/versions`, { cache: "no-store" }).then((r) => json<VersionInfo[]>(r)),
  restore: (id: string, version: number) => fetch(`/api/projects/${id}/versions/${version}/restore`, { method: "POST" }).then((r) => json<VersionInfo>(r)),
};

export const deckUrl = (id: string, version: number | "latest", opts: { shot?: string; step?: number; download?: boolean } = {}) => {
  const q = new URLSearchParams();
  if (opts.shot) q.set("df-shot", opts.shot);
  if (opts.shot && opts.step !== undefined) q.set("step", String(opts.step));
  if (opts.download) q.set("download", "1");
  const s = q.toString();
  return `/api/projects/${id}/versions/${version}/deck.html${s ? `?${s}` : ""}`;
};

/** POSTs and calls onEvent for each SSE `data:` JSON payload until the stream ends. */
export async function streamEvents(url: string, body: unknown, onEvent: (e: PipelineEvent) => void, signal?: AbortSignal): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const err = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(err?.error ?? `Stream failed (${res.status})`);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const data = chunk
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (data) onEvent(JSON.parse(data) as PipelineEvent);
    }
  }
}
