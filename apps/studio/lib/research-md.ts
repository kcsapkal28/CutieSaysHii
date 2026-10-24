// Source-mapped parsing of research.md for the in-place editor. Every block and inline token keeps its exact offsets
// in the markdown, so an edit or an accepted suggestion replaces just that slice and the rest stays byte-for-byte.
// The syntax is deliberately small: #–### headings, - / * / 1. list items, paragraphs, **bold**, *em*, `code`,
// [n] citations and [text](url) links. Anything else is shown as paragraph text and still round-trips exactly.

export type Block = {
  kind: "heading" | "item" | "para";
  /** Heading level 1–3. */
  level?: number;
  /** List item marker as written, e.g. "- ", "  * ", "3. ". */
  marker?: string;
  ordered?: boolean;
  /** Start of the first line (indentation and marker included). */
  start: number;
  /** Start of the editable text, after the marker. */
  contentStart: number;
  /** End of the last line, before its newline. */
  end: number;
};

export type Token = {
  kind: "text" | "strong" | "em" | "code" | "cite" | "link";
  /** The whole token in the source, markers included. */
  start: number;
  end: number;
  /** Where the visible text starts in the source; the visible text is source.slice(textStart, textStart + text.length). */
  textStart: number;
  text: string;
  href?: string;
};

const HEADING = /^(#{1,3})(\s+)/;
const ITEM = /^(\s*(?:[-*]|\d+\.)\s+)/;

export function parseBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  let para: Block | null = null;
  let at = 0;
  for (const line of source.split("\n")) {
    const lineEnd = at + line.trimEnd().length;
    const h = HEADING.exec(line);
    const li = h ? null : ITEM.exec(line);
    if (!line.trim()) {
      para = null;
    } else if (h) {
      para = null;
      blocks.push({ kind: "heading", level: h[1]!.length, start: at, contentStart: at + h[0].length, end: Math.max(lineEnd, at + h[0].length) });
    } else if (li) {
      para = null;
      const marker = li[1]!;
      blocks.push({ kind: "item", marker, ordered: /\d/.test(marker), start: at, contentStart: at + marker.length, end: Math.max(lineEnd, at + marker.length) });
    } else if (para && blocks.at(-1) === para) {
      para.end = lineEnd;
    } else {
      para = { kind: "para", start: at, contentStart: at + (line.length - line.trimStart().length), end: lineEnd };
      blocks.push(para);
    }
    at += line.length + 1;
  }
  return blocks;
}

const INLINE = /\[([^\]\n]+)\]\(([^)\s]+)\)|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|`([^`\n]+)`|\[(\d+(?:\s*[,–-]\s*\d+)*)\]/g;

/** Inline tokens of source.slice(from, to), in order, covering the whole range. */
export function parseInline(source: string, from: number, to: number): Token[] {
  const text = source.slice(from, to);
  const out: Token[] = [];
  let last = 0;
  const plain = (a: number, b: number) => {
    if (b > a) out.push({ kind: "text", start: from + a, end: from + b, textStart: from + a, text: text.slice(a, b) });
  };
  for (const m of text.matchAll(INLINE)) {
    const i = m.index;
    plain(last, i);
    const start = from + i;
    const end = start + m[0].length;
    if (m[1] !== undefined) out.push({ kind: "link", start, end, textStart: start + 1, text: m[1], href: m[2] });
    else if (m[3] !== undefined) out.push({ kind: "strong", start, end, textStart: start + 2, text: m[3] });
    else if (m[4] !== undefined) out.push({ kind: "em", start, end, textStart: start + 1, text: m[4] });
    else if (m[5] !== undefined) out.push({ kind: "code", start, end, textStart: start + 1, text: m[5] });
    else out.push({ kind: "cite", start, end, textStart: start + 1, text: m[6]! });
    last = i + m[0].length;
  }
  plain(last, text.length);
  return out;
}

/**
 * Turns a selection into a passage that is safe to replace: trims surrounding whitespace and widens either end that
 * falls inside a formatted token (bold, link, citation…) to the whole token, so the markers stay balanced.
 * Returns null when nothing but whitespace is selected.
 */
export function snapRange(source: string, start: number, end: number): { start: number; end: number } | null {
  let s = Math.max(0, Math.min(start, end));
  let e = Math.min(source.length, Math.max(start, end));
  for (const b of parseBlocks(source)) {
    if (b.end < s || b.contentStart > e) continue;
    for (const t of parseInline(source, b.contentStart, b.end)) {
      if (t.kind === "text") continue;
      if (t.start < s && s < t.end) s = t.start;
      if (t.start < e && e < t.end) e = t.end;
    }
  }
  while (s < e && /\s/.test(source[s]!)) s++;
  while (e > s && /\s/.test(source[e - 1]!)) e--;
  return e > s ? { start: s, end: e } : null;
}

export function splice(source: string, start: number, end: number, replacement: string): string {
  return source.slice(0, start) + replacement + source.slice(end);
}

/**
 * Where `passage` sits in `source` now: at [start, end) if it is still there, else its only other occurrence
 * (the user edited elsewhere in the meantime). null when it was changed or is ambiguous.
 */
export function locate(source: string, passage: string, start: number): { start: number; end: number } | null {
  if (source.slice(start, start + passage.length) === passage) return { start, end: start + passage.length };
  const i = source.indexOf(passage);
  if (i < 0 || source.indexOf(passage, i + 1) >= 0) return null;
  return { start: i, end: i + passage.length };
}

/** Replaces a block's editable text. An emptied block is removed with its line, so no stray "- " or "## " is left. */
export function replaceBlockText(source: string, block: Block, text: string): string {
  if (text.trim()) return splice(source, block.contentStart, block.end, text);
  const end = source[block.end] === "\n" ? block.end + 1 : block.end;
  return splice(source, block.start, end, "");
}

/** What Enter inserts while editing a block: a new item with the next marker, or a new paragraph. */
export function newBlockText(block: Block): string {
  if (block.kind !== "item") return "\n\n";
  const m = /^(\s*)(\d+)(\.\s+)$/.exec(block.marker!);
  return `\n${m ? `${m[1]}${Number(m[2]) + 1}${m[3]}` : block.marker}`;
}
