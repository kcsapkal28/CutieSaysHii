"use client";
// research.md, edited in place. Each heading, paragraph and list item shows formatted; clicking one turns just that
// block into its raw markdown text, so edits round-trip exactly. Selecting text offers "Ask / re-check": the
// researcher answers and suggests a replacement for that passage only, applied on Accept.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { api } from "@/lib/client/api";
import { locate, newBlockText, parseBlocks, replaceBlockText, snapRange, splice } from "@/lib/research-md";
import type { ResearchRefineResult, Usage } from "@/lib/types";
import { IconChat, IconCheck, IconSend } from "./icons";
import { blockClass, blockTag, groupBlocks, Inline, ListShell, Markdown } from "./markdown";
import { Button, cx, Spinner } from "./ui";

export type DocLog = (message: string, tone?: "ok" | "warn" | "bad") => void;

type Editing = { index: number; base: string; caret: number };
type Ask = {
  start: number;
  end: number;
  passage: string;
  /** Popover position, relative to the document. */
  x: number;
  y: number;
  phase: "button" | "compose" | "asking" | "answer";
  question: string;
  result?: ResearchRefineResult;
  error?: string;
};

const POPOVER_W = 360;
// The passage being asked about, painted with the CSS Custom Highlight API (no DOM changes). Kept out of globals.css:
// the bundler's CSS parser doesn't know ::highlight() yet and warns on every compile.
const HIGHLIGHT_CSS = "::highlight(df-ask){background-color:color-mix(in oklab,var(--color-ember) 26%,transparent);color:var(--color-fg)}";
const clip = (s: string, n = 70) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

// ---- DOM point <-> source offset, through the data-s spans the mapped renderer writes ----

const spans = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>("[data-s]")];

function toSource(root: HTMLElement, node: Node, offset: number): number | null {
  const all = spans(root);
  for (const el of all) {
    const r = document.createRange();
    r.selectNodeContents(el);
    let c: number;
    try {
      c = r.comparePoint(node, offset);
    } catch {
      return null;
    }
    const s = Number(el.dataset.s);
    if (c < 0) return s;
    if (c === 0) {
      r.setEnd(node, offset);
      return s + r.toString().length;
    }
  }
  const last = all.at(-1);
  return last ? Number(last.dataset.s) + (last.textContent ?? "").length : null;
}

function pointIn(el: HTMLElement, k: number): { node: Node; offset: number } {
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let last: Text | null = null;
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const t = n as Text;
    if (k <= t.length) return { node: t, offset: k };
    k -= t.length;
    last = t;
  }
  return last ? { node: last, offset: last.length } : { node: el, offset: 0 };
}

function toDom(root: HTMLElement, pos: number): { node: Node; offset: number } | null {
  const all = spans(root);
  for (const el of all) {
    const s = Number(el.dataset.s);
    const len = (el.textContent ?? "").length;
    if (pos < s) return pointIn(el, 0);
    if (pos <= s + len) return pointIn(el, pos - s);
  }
  const last = all.at(-1);
  return last ? pointIn(last, (last.textContent ?? "").length) : null;
}

export function ResearchDoc({
  projectId,
  source,
  readOnly,
  onChange,
  onLog,
  onUsage,
  onAsking,
  acceptNote,
}: {
  projectId: string;
  source: string;
  readOnly: boolean;
  onChange: (next: string) => void;
  onLog: DocLog;
  onUsage: (usage: Usage, model: string) => void;
  onAsking: (asking: boolean) => void;
  /** Shown on a suggestion when accepting it has consequences (later stages that will need re-running). */
  acceptNote?: string | null;
}) {
  const root = useRef<HTMLDivElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);

  // While a block is being edited, the rest renders from the text as it was when editing began (only that block changes).
  const view = editing ? editing.base : source;
  const blocks = useMemo(() => parseBlocks(view), [view]);
  const groups = useMemo(() => groupBlocks(view, blocks), [view, blocks]);
  const editBlock = editing ? blocks[editing.index] : undefined;

  useEffect(() => {
    if (readOnly) {
      setEditing(null);
      setAsk((a) => (a?.phase === "asking" ? a : null));
    }
  }, [readOnly]);

  // Entering a block: fill the textarea with its raw text and put the caret where the click landed.
  useLayoutEffect(() => {
    const ta = editor.current;
    if (!editing || !ta) return;
    const b = parseBlocks(editing.base)[editing.index];
    if (!b) return;
    ta.value = editing.base.slice(b.contentStart, b.end);
    fit(ta);
    ta.focus();
    const k = Math.max(0, Math.min(ta.value.length, editing.caret - b.contentStart));
    ta.setSelectionRange(k, k);
  }, [editing]);

  // The passage under discussion stays highlighted while the question is composed and answered.
  const loc = ask && ask.phase !== "button" ? locate(source, ask.passage, ask.start) : null;
  useLayoutEffect(() => {
    const el = root.current;
    if (typeof CSS === "undefined" || !CSS.highlights || typeof Highlight === "undefined" || !el) return;
    if (!loc || editing) {
      CSS.highlights.delete("df-ask");
      return;
    }
    const a = toDom(el, loc.start);
    const b = toDom(el, loc.end);
    if (!a || !b) return;
    const r = document.createRange();
    r.setStart(a.node, a.offset);
    r.setEnd(b.node, b.offset);
    CSS.highlights.set("df-ask", new Highlight(r));
    return () => void CSS.highlights.delete("df-ask");
  });

  // Hide the Ask button once the selection goes away.
  useEffect(() => {
    if (ask?.phase !== "button") return;
    const onSel = () => {
      const ta = editor.current;
      const inEditor = ta && document.activeElement === ta && ta.selectionStart !== ta.selectionEnd;
      if (!inEditor && (document.getSelection()?.isCollapsed ?? true)) setAsk(null);
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, [ask?.phase]);

  const canAsk = !readOnly && (!ask || ask.phase === "button" || ask.phase === "compose");

  function fit(ta: HTMLTextAreaElement) {
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  }

  function begin(index: number, caret: number) {
    if (readOnly) return;
    setEditing({ index, base: source, caret });
  }

  function editText(): string {
    return editor.current?.value ?? "";
  }

  function onEditInput() {
    if (!editing || !editBlock) return;
    fit(editor.current!);
    onChange(editing.base.slice(0, editBlock.contentStart) + editText() + editing.base.slice(editBlock.end));
  }

  function onEditBlur() {
    if (!editing || !editBlock) return;
    if (!editText().trim()) onChange(replaceBlockText(editing.base, editBlock, ""));
    setEditing(null);
  }

  /** The current selection as a snapped source range plus a popover position, or null. */
  function readSelection(e?: { clientX: number; clientY: number }): Omit<Ask, "phase" | "question"> | null {
    const el = root.current;
    if (!el) return null;
    const box = el.getBoundingClientRect();
    let start: number | null;
    let end: number | null;
    let x: number;
    let y: number;
    const ta = editor.current;
    if (ta && editBlock && document.activeElement === ta && ta.selectionStart !== ta.selectionEnd) {
      start = editBlock.contentStart + ta.selectionStart;
      end = editBlock.contentStart + ta.selectionEnd;
      const r = ta.getBoundingClientRect();
      x = (e?.clientX ?? r.left) - box.left;
      y = (e ? e.clientY + 16 : r.bottom + 8) - box.top;
    } else {
      const sel = document.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
      const inDoc = (n: Node | null) => !!n && el.contains(n) && !(n instanceof Element ? n : n.parentElement)?.closest("[data-no-map]");
      if (!inDoc(sel.anchorNode) || !inDoc(sel.focusNode)) return null;
      const range = sel.getRangeAt(0);
      start = toSource(el, range.startContainer, range.startOffset);
      end = toSource(el, range.endContainer, range.endOffset);
      const rects = range.getClientRects();
      const last = rects[rects.length - 1] ?? range.getBoundingClientRect();
      x = last.left - box.left;
      y = last.bottom + 8 - box.top;
    }
    if (start === null || end === null) return null;
    const r = snapRange(source, start, end);
    if (!r) return null;
    return { ...r, passage: source.slice(r.start, r.end), x: Math.max(0, Math.min(x - 24, box.width - POPOVER_W)), y };
  }

  function onMouseUp(e: ReactMouseEvent) {
    const target = e.target as HTMLElement;
    if (target.closest("[data-no-map]")) return;
    const s = readSelection(e);
    if (s) {
      if (canAsk) setAsk({ ...s, phase: "button", question: "" });
      return;
    }
    if (ask?.phase === "button") setAsk(null);
    const blockEl = target.closest<HTMLElement>("[data-b]");
    if (!blockEl || readOnly) return;
    const i = Number(blockEl.dataset.b);
    if (editing?.index === i) return;
    const sel = document.getSelection();
    const caret = sel?.anchorNode && sel.isCollapsed && root.current ? toSource(root.current, sel.anchorNode, sel.anchorOffset) : null;
    begin(i, caret ?? blocks[i]!.end);
  }

  /** Shift+arrow selections get the Ask button too. */
  function onKeyUp(e: ReactKeyboardEvent) {
    if (!e.shiftKey || !canAsk || (e.target as HTMLElement).closest("[data-no-map]")) return;
    const s = readSelection();
    if (s) setAsk({ ...s, phase: "button", question: "" });
  }

  async function send() {
    if (!ask) return;
    const question = ask.question.trim();
    if (!question) return;
    const at = locate(source, ask.passage, ask.start);
    if (!at) {
      setAsk({ ...ask, error: "That passage has changed since you selected it. Select it again." });
      return;
    }
    setAsk({ ...ask, ...at, phase: "asking", error: undefined });
    onAsking(true);
    onLog(`Asked about “${clip(ask.passage)}”: ${question}`);
    try {
      const r = await api.refineResearch(projectId, { markdown: source, start: at.start, end: at.end, question });
      onUsage(r.usage, r.model);
      onLog(`Researcher: ${r.answer}`, "ok");
      onLog(r.changed ? "Suggested a replacement for that passage. Accept or dismiss it." : "No change suggested for that passage.");
      setAsk((a) => a && { ...a, phase: "answer", result: r });
    } catch (e) {
      const message = (e as Error).message;
      onLog(`Couldn’t re-check the passage: ${message}`, "bad");
      setAsk((a) => a && { ...a, phase: "compose", error: message });
    } finally {
      onAsking(false);
    }
  }

  function accept() {
    const r = ask?.result;
    if (!ask || !r) return;
    const at = locate(source, r.passage, ask.start);
    if (!at) {
      setAsk({ ...ask, error: "That passage has changed since you asked, so the suggestion can’t be applied. Dismiss it and ask again." });
      return;
    }
    onChange(splice(source, at.start, at.end, r.replacement));
    onLog("Accepted the suggestion: replaced that passage in research.md.", "ok");
    setAsk(null);
  }

  function dismiss() {
    if (ask?.result?.changed) onLog("Dismissed the suggestion; research.md is unchanged.");
    setAsk(null);
  }

  const renderBlock = (i: number) => {
    const b = blocks[i]!;
    const T = blockTag(b);
    const isEditing = editing?.index === i;
    return (
      <T
        key={i}
        data-b={i}
        tabIndex={readOnly || isEditing ? undefined : 0}
        onKeyDown={(e) => {
          if (!isEditing && e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            begin(i, b.end);
          }
        }}
        className={cx(
          blockClass(b),
          !readOnly && "-mx-2 rounded-md px-2 transition-colors duration-150",
          !readOnly && !isEditing && "cursor-text hover:bg-raised/60",
          isEditing && "bg-raised ring-1 ring-line-strong",
        )}
      >
        {isEditing ? (
          <textarea
            ref={editor}
            aria-label="Edit this block (markdown)"
            rows={1}
            spellCheck
            onInput={onEditInput}
            onBlur={onEditBlur}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.currentTarget.blur();
              } else if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
                e.preventDefault();
                const text = e.shiftKey ? "\n" : newBlockText(b);
                if (!document.execCommand("insertText", false, text)) {
                  e.currentTarget.setRangeText(text, e.currentTarget.selectionStart, e.currentTarget.selectionEnd, "end");
                  onEditInput();
                }
              }
            }}
            className="-my-px block w-full resize-none overflow-hidden bg-transparent p-0 align-top outline-none [font-size:inherit] [font-weight:inherit] [letter-spacing:inherit] [line-height:inherit]"
          />
        ) : (
          <Inline source={view} from={b.contentStart} to={b.end} mapped />
        )}
      </T>
    );
  };

  // The suggestion card sits right after the block (or list) where the passage ends.
  const endBlock = loc ? blocks.findLastIndex((b) => b.start < loc.end) : -1;
  const cardAfter = endBlock < 0 ? -1 : groups.findIndex((g) => (g.kind === "block" ? g.index === endBlock : g.items.includes(endBlock)));

  return (
    <div ref={root} className="relative" onMouseUp={onMouseUp} onKeyUp={onKeyUp}>
      <style>{HIGHLIGHT_CSS}</style>
      {groups.map((g, gi) => (
        <div key={g.kind === "block" ? `b${g.index}` : `l${g.items[0]}`} className="contents">
          {g.kind === "block" ? (
            renderBlock(g.index)
          ) : (
            <ListShell ordered={g.ordered} first={g.first}>
              {g.items.map(renderBlock)}
            </ListShell>
          )}
          {gi === cardAfter && ask?.phase === "answer" && ask.result && (
            <Suggestion ask={ask} result={ask.result} note={acceptNote ?? null} onAccept={accept} onDismiss={dismiss} />
          )}
        </div>
      ))}

      {ask && ask.phase !== "answer" && (
        <div data-no-map className="absolute z-20" style={{ left: ask.x, top: ask.y, width: ask.phase === "button" ? undefined : POPOVER_W }}>
          {ask.phase === "button" ? (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setAsk({ ...ask, phase: "compose" })}
              className="inline-flex h-8 animate-rise items-center gap-1.5 rounded-lg border border-line-strong bg-raised px-2.5 text-[12.5px] font-medium text-fg shadow-lg shadow-black/40 hover:bg-hover"
            >
              <IconChat size={14} className="text-ember" /> Ask / re-check
            </button>
          ) : (
            <div className="animate-rise rounded-xl border border-line-strong bg-panel p-3 shadow-xl shadow-black/50">
              <p className="mb-2 line-clamp-2 text-[12px] text-dim">
                About “<span className="text-sub">{clip(ask.passage, 120)}</span>”
              </p>
              <textarea
                autoFocus
                aria-label="Question or instruction about the selected text"
                value={ask.question}
                disabled={ask.phase === "asking"}
                onChange={(e) => setAsk({ ...ask, question: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    setAsk(null);
                  }
                }}
                rows={2}
                placeholder="Is this still current? Add a source. Simplify this…"
                className="field resize-none px-2.5 py-1.5 text-[13px]"
              />
              {ask.error && <p className="mt-2 text-[12px] leading-[1.45] text-bad">{ask.error}</p>}
              <div className="mt-2 flex items-center gap-2">
                <span className="text-[11px] text-dim">{ask.phase === "asking" ? "The researcher is checking this passage…" : "Only this passage can change."}</span>
                <div className="ml-auto flex gap-1.5">
                  <Button size="sm" variant="ghost" onClick={() => setAsk(null)} disabled={ask.phase === "asking"}>
                    Cancel
                  </Button>
                  <Button size="sm" variant="primary" onClick={() => void send()} disabled={ask.phase === "asking" || !ask.question.trim()}>
                    {ask.phase === "asking" ? <Spinner size={12} /> : <IconSend size={13} />} Ask
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Suggestion({ ask, result, note, onAccept, onDismiss }: { ask: Ask; result: ResearchRefineResult; note: string | null; onAccept: () => void; onDismiss: () => void }) {
  // The card sits after the whole list when the passage is a list item, which can be well below the fold.
  const card = useRef<HTMLElement>(null);
  useEffect(() => {
    card.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, []);
  return (
    <section ref={card} data-no-map aria-label="Suggested change" className="my-4 animate-rise rounded-xl border border-line-strong bg-panel p-4">
      <p className="text-[12px] text-dim">
        <IconChat size={13} className="mr-1.5 inline align-[-2px] text-ember" />
        You asked: <span className="text-sub">{ask.question}</span>
      </p>
      <p className="mt-2 text-[13.5px] leading-[1.6] text-fg">{result.answer}</p>
      {result.changed ? (
        <div className="mt-3 grid gap-2 text-[13px]">
          <div className="rounded-lg border-l-2 border-bad/50 bg-bad/[0.06] px-3 py-1 text-dim line-through decoration-bad/40 [&_*]:!text-[13px] [&_*]:!my-1">
            <Markdown source={result.passage} />
          </div>
          <div className="rounded-lg border-l-2 border-ok/60 bg-ok/[0.06] px-3 py-1 [&_*]:!text-[13px] [&_*]:!my-1">
            <Markdown source={result.replacement} />
          </div>
        </div>
      ) : (
        <p className="mt-2 text-[12.5px] text-dim">No change suggested; the passage stays as it is.</p>
      )}
      {result.changed && note && <p className="mt-3 text-[12px] text-ember">{note}</p>}
      {ask.error && <p className="mt-3 text-[12px] text-bad">{ask.error}</p>}
      <div className="mt-3 flex gap-2">
        {result.changed ? (
          <>
            <Button size="sm" variant="primary" onClick={onAccept}>
              <IconCheck size={13} /> Accept
            </Button>
            <Button size="sm" variant="ghost" onClick={onDismiss}>
              Dismiss
            </Button>
          </>
        ) : (
          <Button size="sm" variant="secondary" onClick={onDismiss}>
            Close
          </Button>
        )}
      </div>
    </section>
  );
}
