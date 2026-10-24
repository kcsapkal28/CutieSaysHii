// A deliberately small markdown renderer for research.md: headings, lists, paragraphs, **bold**, *em*, `code`, [n] cites.
import { Fragment, type ReactNode } from "react";

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[\d+\])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    const k = `${key}-${i++}`;
    if (t.startsWith("**")) out.push(<strong key={k} className="font-semibold text-fg">{t.slice(2, -2)}</strong>);
    else if (t.startsWith("`")) out.push(<code key={k} className="rounded bg-raised px-1 py-0.5 font-mono text-[0.88em] text-fg">{t.slice(1, -1)}</code>);
    else if (t.startsWith("[")) out.push(<sup key={k} className="ml-0.5 rounded bg-review/12 px-1 font-mono text-[10.5px] text-review">{t.slice(1, -1)}</sup>);
    else out.push(<em key={k}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source }: { source: string }) {
  const blocks: ReactNode[] = [];
  const lines = source.split("\n");
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];
  const flush = (k: string) => {
    if (para.length) {
      blocks.push(
        <p key={`p${k}`} className="my-3 text-[14.5px] leading-[1.7] text-sub">
          {inline(para.join(" "), `p${k}`)}
        </p>,
      );
      para = [];
    }
    if (list) {
      const L = list.ordered ? "ol" : "ul";
      blocks.push(
        <L key={`l${k}`} className={`my-3 space-y-1.5 pl-5 text-[14.5px] leading-[1.65] text-sub ${list.ordered ? "list-decimal marker:font-mono marker:text-[12px] marker:text-dim" : "list-disc marker:text-dim"}`}>
          {list.items.map((it, j) => (
            <li key={j}>{inline(it, `l${k}-${j}`)}</li>
          ))}
        </L>,
      );
      list = null;
    }
  };
  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    const k = String(i);
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
      flush(k);
      const level = m[1]!.length;
      const cls =
        level === 1
          ? "mb-5 font-display text-[30px] font-normal leading-[1.15] tracking-[-0.015em] text-fg"
          : level === 2
            ? "mb-1 mt-8 text-[15px] font-semibold text-fg"
            : "mt-5 text-[14px] font-semibold text-fg";
      const H = (`h${level + 1}` as "h2" | "h3" | "h4");
      blocks.push(
        <H key={`h${k}`} className={cls}>
          {inline(m[2]!, `h${k}`)}
        </H>,
      );
    } else if ((m = line.match(/^\s*[-*]\s+(.*)$/))) {
      if (para.length || (list && list.ordered)) flush(k);
      list ??= { ordered: false, items: [] };
      list.items.push(m[1]!);
    } else if ((m = line.match(/^\s*\d+\.\s+(.*)$/))) {
      if (para.length || (list && !list.ordered)) flush(k);
      list ??= { ordered: true, items: [] };
      list.items.push(m[1]!);
    } else if (!line.trim()) {
      flush(k);
    } else {
      if (list) flush(k);
      para.push(line.trim());
    }
  });
  flush("end");
  return <Fragment>{blocks}</Fragment>;
}
