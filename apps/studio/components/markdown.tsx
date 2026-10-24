// A deliberately small markdown renderer for research.md (syntax in lib/research-md.ts). With `mapped`, every visible
// text run carries data-s = its offset in the source, so the in-place editor can turn a click or a selection into
// exact source offsets.
import type { ReactNode } from "react";
import { cx } from "./ui";
import { parseBlocks, parseInline, type Block } from "@/lib/research-md";

export const BLOCK_CLASS = {
  h1: "mb-5 font-display text-[30px] font-normal leading-[1.15] tracking-[-0.015em] text-fg",
  h2: "mb-1 mt-8 text-[15px] font-semibold text-fg",
  h3: "mt-5 text-[14px] font-semibold text-fg",
  para: "my-3 text-[14.5px] leading-[1.7] text-sub",
  list: "my-3 space-y-1.5 pl-5 text-[14.5px] leading-[1.65] text-sub",
  ul: "list-disc marker:text-dim",
  ol: "list-decimal marker:font-mono marker:text-[12px] marker:text-dim",
};

export function Inline({ source, from, to, mapped }: { source: string; from: number; to: number; mapped?: boolean }) {
  return parseInline(source, from, to).map((t) => {
    const at = mapped ? { "data-s": t.textStart } : {};
    const k = t.start;
    if (t.kind === "strong") return <strong key={k} {...at} className="font-semibold text-fg">{t.text}</strong>;
    if (t.kind === "em") return <em key={k} {...at}>{t.text}</em>;
    if (t.kind === "code") return <code key={k} {...at} className="rounded bg-raised px-1 py-0.5 font-mono text-[0.88em] text-fg">{t.text}</code>;
    if (t.kind === "cite") return <sup key={k} {...at} className="ml-0.5 rounded bg-review/12 px-1 font-mono text-[10.5px] text-review">{t.text}</sup>;
    if (t.kind === "link") return <span key={k} {...at} title={t.href} className="text-fg underline decoration-line-strong underline-offset-[3px]">{t.text}</span>;
    return <span key={k} {...at}>{t.text}</span>;
  });
}

export type Group = { kind: "block"; index: number } | { kind: "list"; ordered: boolean; first: number; items: number[] };

/** Consecutive list items of one kind (no blank line between them) render as one list. */
export function groupBlocks(source: string, blocks: Block[]): Group[] {
  const out: Group[] = [];
  blocks.forEach((b, i) => {
    const prev = out.at(-1);
    const last = prev?.kind === "list" ? blocks[prev.items.at(-1)!]! : null;
    if (b.kind === "item" && prev?.kind === "list" && last && prev.ordered === b.ordered && source.slice(last.end, b.start).trim() === "" && !source.slice(last.end, b.start).includes("\n\n"))
      prev.items.push(i);
    else if (b.kind === "item") out.push({ kind: "list", ordered: !!b.ordered, first: Number.parseInt(b.marker!, 10) || 1, items: [i] });
    else out.push({ kind: "block", index: i });
  });
  return out;
}

export function blockTag(b: Block): "h2" | "h3" | "h4" | "p" | "li" {
  if (b.kind === "heading") return `h${b.level! + 1}` as "h2" | "h3" | "h4";
  return b.kind === "item" ? "li" : "p";
}

export function blockClass(b: Block): string {
  if (b.kind === "heading") return b.level === 1 ? BLOCK_CLASS.h1 : b.level === 2 ? BLOCK_CLASS.h2 : BLOCK_CLASS.h3;
  return b.kind === "para" ? BLOCK_CLASS.para : "";
}

export function ListShell({ ordered, first, children }: { ordered: boolean; first: number; children: ReactNode }) {
  const L = ordered ? "ol" : "ul";
  return (
    <L className={cx(BLOCK_CLASS.list, ordered ? BLOCK_CLASS.ol : BLOCK_CLASS.ul)} start={ordered && first !== 1 ? first : undefined}>
      {children}
    </L>
  );
}

/** Read-only rendering (suggestion previews). */
export function Markdown({ source }: { source: string }) {
  const blocks = parseBlocks(source);
  const one = (i: number) => {
    const b = blocks[i]!;
    const T = blockTag(b);
    return (
      <T key={i} className={blockClass(b)}>
        <Inline source={source} from={b.contentStart} to={b.end} />
      </T>
    );
  };
  return groupBlocks(source, blocks).map((g) =>
    g.kind === "block" ? (
      one(g.index)
    ) : (
      <ListShell key={`l${g.items[0]}`} ordered={g.ordered} first={g.first}>
        {g.items.map(one)}
      </ListShell>
    ),
  );
}
