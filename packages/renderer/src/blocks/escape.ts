const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ENTITIES[ch]!);
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Ranges are computed on the raw text, then overlaps dropped, so marks never nest and
// targets containing HTML characters match what the author wrote, not the escaped form.
export function emphasize(text: string, targets: string[]): string {
  const ranges: { start: number; end: number }[] = [];
  for (const t of targets) {
    if (!t) continue;
    const m = new RegExp(escapeRegExp(t), "i").exec(text);
    if (m) ranges.push({ start: m.index, end: m.index + m[0].length });
  }
  ranges.sort((a, b) => a.start - b.start || b.end - a.end);

  let out = "";
  let cursor = 0;
  for (const r of ranges) {
    if (r.start < cursor) continue;
    out += escapeHtml(text.slice(cursor, r.start));
    out += `<mark class="df-emph" data-emphasis>${escapeHtml(text.slice(r.start, r.end))}</mark>`;
    cursor = r.end;
  }
  return out + escapeHtml(text.slice(cursor));
}
