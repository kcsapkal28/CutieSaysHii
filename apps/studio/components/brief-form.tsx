"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import type { Brief } from "@/lib/types";
import { IconArrowRight } from "./icons";
import { Button, cx, ErrorNote, Kbd, Segmented, Spinner } from "./ui";

const EXAMPLES = [
  "How active noise cancellation works in wireless earbuds",
  "JPEG compression, block by block",
  "Why AXI4 has five channels",
];
const LENGTHS = [5, 10, 20, 30, 45];

export function BriefForm({ initial, projectId }: { initial?: Brief; projectId?: string }) {
  const router = useRouter();
  const [b, setB] = useState<Brief>(initial ?? { topic: "", audience: "", minutes: 20, goal: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const topicRef = useRef<HTMLTextAreaElement>(null);
  const set = <K extends keyof Brief>(k: K, v: Brief[K]) => {
    setSaved(false);
    setB((x) => ({ ...x, [k]: v }));
  };

  useEffect(() => {
    if (!projectId) topicRef.current?.focus();
  }, [projectId]);

  async function submit() {
    if (!b.topic.trim()) {
      setError("Add a topic so the agents know what the deck is about.");
      topicRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (projectId) {
        await api.saveFile(projectId, "brief.json", JSON.stringify(b, null, 2));
        setSaved(true);
        window.dispatchEvent(new Event("studio:project-changed"));
      } else {
        const p = await api.createProject(b);
        router.push(`/p/${p.id}/style`);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const custom = !LENGTHS.includes(b.minutes);

  return (
    <form
      className="mx-auto w-full max-w-[680px]"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          void submit();
        }
      }}
    >
      <label htmlFor="topic" className="label">
        What is the talk about?
      </label>
      <textarea
        id="topic"
        ref={topicRef}
        rows={2}
        value={b.topic}
        onChange={(e) => set("topic", e.target.value)}
        placeholder="How active noise cancellation works in wireless earbuds"
        className="mt-2 w-full resize-none border-0 border-b border-line bg-transparent pb-3 font-display text-[30px] leading-[1.2] tracking-[-0.015em] text-fg placeholder:text-dim/60 focus:border-ember/70 focus:outline-none"
      />
      {!projectId && !b.topic && (
        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => set("topic", ex)}
              className="rounded-full border border-line px-3 py-1 text-[12.5px] text-sub transition-colors hover:border-line-strong hover:text-fg"
            >
              {ex}
            </button>
          ))}
        </div>
      )}

      <div className="mt-10 grid grid-cols-1 gap-x-6 gap-y-7 sm:grid-cols-2">
        <div>
          <label htmlFor="audience" className="label">
            Who’s in the room?
          </label>
          <input
            id="audience"
            value={b.audience}
            onChange={(e) => set("audience", e.target.value)}
            placeholder="Firmware engineers new to audio DSP"
            className="field mt-2 h-10"
          />
        </div>
        <div>
          <span className="label" id="len-label">
            Length
          </span>
          <div className="mt-2 flex items-center gap-2">
            <Segmented
              label="Length in minutes"
              value={custom ? -1 : b.minutes}
              onChange={(v) => v > 0 && set("minutes", v)}
              options={LENGTHS.map((m) => ({ value: m, label: `${m}` }))}
              className="flex-1 [&_button]:h-8"
            />
            <div className="relative w-[84px]">
              <input
                aria-label="Custom length in minutes"
                type="number"
                min={1}
                max={120}
                value={b.minutes}
                onChange={(e) => set("minutes", Math.max(1, Math.min(120, Number(e.target.value) || 1)))}
                className={cx("field h-9 pr-9 font-mono", custom && "border-ember/60")}
              />
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[12px] text-dim">min</span>
            </div>
          </div>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="goal" className="label">
            What should they leave able to do?
          </label>
          <textarea
            id="goal"
            rows={2}
            value={b.goal}
            onChange={(e) => set("goal", e.target.value)}
            placeholder="Sketch the feedforward and feedback paths, and explain the latency budget."
            className="field mt-2 resize-none"
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="notes" className="label">
            Anything else <span className="font-normal text-dim">(optional)</span>
          </label>
          <textarea
            id="notes"
            rows={3}
            value={b.notes ?? ""}
            onChange={(e) => set("notes", e.target.value)}
            placeholder="Tone, must-have slides, things to avoid, a simulation you want people to play with…"
            className="field mt-2 resize-y"
          />
        </div>
      </div>

      {error && (
        <div className="mt-6">
          <ErrorNote message={error} />
        </div>
      )}

      <div className="mt-10 flex items-center justify-between border-t border-line pt-5">
        <p className="flex items-center gap-1.5 text-[12px] text-dim">
          <Kbd>⌘</Kbd>
          <Kbd>↵</Kbd>
          <span>{projectId ? "to save" : "to continue"}</span>
        </p>
        <div className="flex items-center gap-3">
          {saved && <span className="text-[12.5px] text-ok">Brief saved</span>}
          <Button type="submit" variant="primary" size="lg" disabled={busy}>
            {busy ? <Spinner /> : null}
            {projectId ? "Save brief" : "Continue to style"}
            {!busy && !projectId && <IconArrowRight size={14} />}
          </Button>
        </div>
      </div>
    </form>
  );
}
