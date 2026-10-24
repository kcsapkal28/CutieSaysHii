"use client";
// The Style Studio's design-style catalogue: search, grouped rows with a CSS swatch, and the active style.
import { useMemo, useRef, useState, type CSSProperties } from "react";
import { DESIGN_CATEGORIES, DESIGN_STYLES, textureLayer, type DesignStyle } from "@deckforge/forge/design-styles";
import type { Surface, Theme } from "@deckforge/forge";
import { IconX } from "./icons";
import { familyOf } from "./style-poster";
import { cx } from "./ui";

const RADIUS = { sharp: 0, soft: 4, round: 9 };

/** A 56×36 CSS rendering of a style: backdrop and texture, an accent blob, and a card with the style's corners, border and depth. */
export function DesignSwatch({ colors: c, backdrop, fonts, surface: s, className }: { colors: Theme["colors"]; backdrop: string; fonts: Theme["fonts"]; surface: Surface; className?: string }) {
  const tex = textureLayer(s.texture, 0.25);
  const card: CSSProperties = {
    background: s.depth === "glass" ? `color-mix(in oklab, ${c.surface} 55%, transparent)` : c.surface,
    borderRadius: RADIUS[s.radius],
    border: s.border === "none" ? "0" : s.border === "bold" ? `1.5px solid ${c.text}` : `1px solid ${c.line}`,
    boxShadow:
      s.depth === "soft" ? "0 3px 7px -2px rgb(0 0 0 / .45)" : s.depth === "hard" ? `2px 2px 0 0 ${c.text}` : s.depth === "glass" ? `inset 0 1px 0 color-mix(in oklab, ${c.text} 25%, transparent)` : "none",
    backdropFilter: s.depth === "glass" ? "blur(3px)" : undefined,
    fontFamily: familyOf(fonts.display),
    color: c.text,
  };
  return (
    <span
      aria-hidden
      className={cx("relative block h-9 w-14 shrink-0 overflow-hidden rounded-md ring-1 ring-white/10", className)}
      style={{ background: backdrop || c.bg, ["--df-line" as string]: c.line, ["--df-text" as string]: c.text }}
    >
      <span className="absolute inset-0" style={{ backgroundImage: tex.image, backgroundSize: tex.size, opacity: tex.opacity }} />
      <span className="absolute left-[22px] top-[15px] size-[16px] rounded-full" style={{ background: c.accent }} />
      <span className="absolute left-[6px] top-[7px] grid h-[22px] w-[28px] place-items-center text-[11px] font-semibold leading-none" style={card}>
        Aa
      </span>
      <span className="absolute right-[5px] top-[8px] grid gap-[3px]">
        <i className="block size-[5px] rounded-full" style={{ background: c.accent2 }} />
        <i className="block size-[5px] rounded-full" style={{ background: c.accent3 }} />
      </span>
    </span>
  );
}

const swatchOf = (d: DesignStyle) => <DesignSwatch colors={d.colors} backdrop={d.backdrop} fonts={d.fonts} surface={d.surface} />;

export function DesignStylePicker({
  value,
  customised,
  onPick,
  onClear,
}: {
  value: string;
  customised: boolean;
  onPick: (id: string) => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const active = DESIGN_STYLES.find((d) => d.id === value);
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hits = DESIGN_STYLES.filter((d) => !q || `${d.name} ${d.category} ${d.blurb}`.toLowerCase().includes(q));
    return DESIGN_CATEGORIES.map((cat) => ({ cat, items: hits.filter((d) => d.category === cat) })).filter((g) => g.items.length);
  }, [query]);

  return (
    <div className="grid gap-2.5">
      {active ? (
        <div className="flex items-center gap-3 rounded-lg bg-raised px-2 py-1.5 ring-1 ring-ember/60">
          {swatchOf(active)}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] font-medium text-fg">{active.name}</span>
            <span className="block text-[11.5px] text-dim">
              {customised ? <span className="text-ember">Customised</span> : "Defaults applied"} · {active.category}
            </span>
          </span>
          {customised && (
            <button type="button" onClick={() => onPick(active.id)} className="rounded-md px-1.5 py-1 text-[11.5px] font-medium text-sub hover:bg-hover hover:text-fg" title="Re-apply this style's palette, type, motion and surface">
              Reset
            </button>
          )}
          <button type="button" aria-label="Clear design style" onClick={onClear} className="rounded p-1 text-dim hover:text-fg">
            <IconX size={14} />
          </button>
        </div>
      ) : (
        <p className="text-[12px] leading-[1.45] text-dim">Pick one to set palette, type, motion and surface. Everything stays editable below.</p>
      )}
      <input
        type="search"
        aria-label="Search design styles"
        placeholder={`Search ${DESIGN_STYLES.length} styles`}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          list.current?.scrollTo({ top: 0 });
        }}
        className="field h-8 px-2.5 text-[12.5px]"
      />
      <div ref={list} role="radiogroup" aria-label="Design style" className="max-h-[352px] overflow-y-auto rounded-lg border border-line">
        {groups.map((g) => (
          <div key={g.cat}>
            <div className="sticky top-0 z-10 border-b border-line bg-panel/95 px-2.5 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-dim backdrop-blur">
              {g.cat}
            </div>
            <div className="p-1">
              {g.items.map((d) => {
                const on = d.id === value;
                return (
                  <button
                    key={d.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    title={d.blurb}
                    onClick={() => onPick(d.id)}
                    className={cx("flex w-full items-center gap-3 rounded-md px-1.5 py-1 text-left transition-colors", on ? "bg-raised ring-1 ring-ember/60" : "hover:bg-raised/70")}
                  >
                    {swatchOf(d)}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-medium text-fg">{d.name}</span>
                      <span className="block truncate text-[11.5px] text-dim">{d.blurb}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {groups.length === 0 && <p className="px-3 py-4 text-center text-[12px] text-dim">No style matches “{query}”.</p>}
      </div>
    </div>
  );
}
