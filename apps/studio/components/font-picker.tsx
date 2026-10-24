"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { FontOption } from "@/lib/theme-vars";
import { IconCheck, IconChevron } from "./icons";
import { cx } from "./ui";

const stack = (f: FontOption) => `"${f.family}", ${f.category === "monospace" ? "monospace" : f.category}`;

/** A listbox whose options render in their own typeface. */
export function FontPicker({ label, value, options, onChange, sample }: { label: string; value: string; options: FontOption[]; onChange: (id: string) => void; sample: string }) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const cur = options.find((o) => o.id === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    setHi(Math.max(0, options.findIndex((o) => o.id === value)));
    requestAnimationFrame(() => list.current?.focus());
    const close = (e: MouseEvent) => {
      if (!list.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open, options, value]);

  const choose = (i: number) => {
    const o = options[i];
    if (o) onChange(o.id);
    setOpen(false);
    btn.current?.focus();
  };

  return (
    <div className="relative">
      <span className="label mb-1.5" id={`${id}-l`}>
        {label}
      </span>
      <button
        ref={btn}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${id}-l ${id}-v`}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className="flex h-11 w-full items-center gap-3 rounded-lg border border-line bg-panel px-3 text-left transition-colors hover:border-line-strong"
      >
        <span className="w-9 shrink-0 text-[20px] leading-none text-fg" style={{ fontFamily: cur && stack(cur) }} aria-hidden>
          {sample}
        </span>
        <span id={`${id}-v`} className="flex-1 truncate text-[14px] text-fg" style={{ fontFamily: cur && stack(cur) }}>
          {cur?.family}
        </span>
        <IconChevron className={cx("text-dim transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <ul
          ref={list}
          role="listbox"
          tabIndex={-1}
          aria-labelledby={`${id}-l`}
          aria-activedescendant={`${id}-o${hi}`}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") (e.preventDefault(), setHi((h) => Math.min(options.length - 1, h + 1)));
            else if (e.key === "ArrowUp") (e.preventDefault(), setHi((h) => Math.max(0, h - 1)));
            else if (e.key === "Enter" || e.key === " ") (e.preventDefault(), choose(hi));
            else if (e.key === "Escape" || e.key === "Tab") {
              setOpen(false);
              btn.current?.focus();
            }
          }}
          className="absolute left-0 right-0 top-full z-30 mt-1.5 max-h-[300px] animate-rise overflow-y-auto rounded-xl border border-line-strong bg-raised p-1 shadow-[0_24px_60px_-12px_rgb(0_0_0/0.6)] focus:outline-none"
        >
          {options.map((o, i) => (
            <li
              key={o.id}
              id={`${id}-o${i}`}
              role="option"
              aria-selected={o.id === value}
              onMouseEnter={() => setHi(i)}
              onClick={() => choose(i)}
              className={cx("flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2", i === hi && "bg-hover")}
            >
              <span className="w-9 shrink-0 text-[20px] leading-none" style={{ fontFamily: stack(o) }}>
                {sample}
              </span>
              <span className="flex-1 text-[14px]" style={{ fontFamily: stack(o) }}>
                {o.family}
              </span>
              <span className="text-[11px] text-dim">{o.category === "sans-serif" ? "Sans" : o.category === "serif" ? "Serif" : "Mono"}</span>
              <IconCheck className={cx("text-ember", o.id !== value && "invisible")} size={14} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
