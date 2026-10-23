import type { Block } from "@deckforge/schemas";
import { chartSvg } from "./chart.ts";
import { highlightCode } from "./code.ts";
import { emphasize, escapeHtml } from "./escape.ts";
import { sha256Hex } from "./hash.ts";
import { placeholderImageSvg } from "./image.ts";

export type BlockContext = { emphasis: string[]; fragments: boolean; diagrams: Map<string, string> };

export function diagramKey(source: string): string {
  return sha256Hex(source).slice(0, 16);
}

// A bar, not ▶, for flat: the triangle read as a play button.
const TREND_PATH = { up: "M5 1 9.5 9H.5Z", down: "M.5 1h9L5 9Z", flat: "M1 4h8v2H1Z" } as const;

function trendIcon(trend: keyof typeof TREND_PATH): string {
  const t = escapeHtml(trend);
  return `<span class="df-stat-trend" role="img" aria-label="Trend: ${t}" data-trend="${t}"><svg viewBox="0 0 10 10" aria-hidden="true" focusable="false"><path fill="currentColor" d="${TREND_PATH[trend]}"/></svg></span>`;
}

/** One compare side's contents: a heading (hidden when blank, so no empty heading is announced) and its cells. */
export function compareSide(titleHtml: string, cellsHtml: string[]): string {
  const hidden = titleHtml.trim() ? "" : " hidden";
  return `<h3 class="df-side-title"${hidden}>${titleHtml}</h3><ul class="df-side-list">${cellsHtml.map((c) => `<li>${c}</li>`).join("")}</ul>`;
}

export function renderBlock(block: Block, ctx: BlockContext): string {
  const em = (s: string) => emphasize(s, ctx.emphasis);

  switch (block.type) {
    case "Bullets": {
      const cls = ctx.fragments ? ' class="fragment"' : "";
      const items = block.items.map((item) => `<li${cls}>${em(item)}</li>`).join("");
      return `<ul class="df-bullets">${items}</ul>`;
    }
    case "Paragraph":
      return `<p class="df-paragraph">${em(block.text)}</p>`;
    case "Stat": {
      const trend = block.trend ? trendIcon(block.trend) : "";
      // --df-chars lets the stylesheet size the value to its cell; it is a count, never deck text.
      return `<div class="df-stat" style="--df-chars:${[...block.value].length}"><div class="df-stat-value"><span class="df-stat-number">${em(block.value)}</span>${trend}</div><div class="df-stat-label">${em(block.label)}</div></div>`;
    }
    case "Quote":
      return `<figure class="df-quote"><blockquote><p>${em(block.text)}</p></blockquote><figcaption>${em(block.attribution)}</figcaption></figure>`;
    case "Diagram": {
      const svg = ctx.diagrams.get(diagramKey(block.mermaid));
      const inner = svg ?? `<pre class="df-diagram-fallback">${escapeHtml(block.mermaid)}</pre>`;
      return `<figure class="df-diagram">${inner}</figure>`;
    }
    case "Chart": {
      const names = block.series.map((s) => s.name).join(", ");
      const title = `${block.kind} chart${names ? `: ${names}` : ""}`;
      return `<figure class="df-chart">${chartSvg(block, { title })}</figure>`;
    }
    case "Compare": {
      const a = compareSide(em(block.leftTitle), block.rows.map((r) => em(r.left)));
      const b = compareSide(em(block.rightTitle), block.rows.map((r) => em(r.right)));
      return `<div class="df-compare-grid" style="--df-rows:${block.rows.length}"><div class="df-side df-side--a">${a}</div><div class="df-side df-side--b">${b}</div></div>`;
    }
    case "Timeline": {
      const steps = block.steps
        .map((s) => {
          const date = s.date ? `<span class="df-timeline-date">${em(s.date)}</span>` : "";
          return `<li class="df-timeline-step">${date}<span class="df-timeline-label">${em(s.label)}</span><span class="df-timeline-detail">${em(s.detail)}</span></li>`;
        })
        .join("");
      return `<ol class="df-timeline">${steps}</ol>`;
    }
    case "Code": {
      const lang = block.lang.toLowerCase().replace(/[^a-z0-9_+-]/g, "");
      return `<pre class="df-code"><code class="hljs language-${lang || "plaintext"}">${highlightCode(block.lang, block.code, block.highlightLines)}</code></pre>`;
    }
    case "Image":
      return `<figure class="df-image">${placeholderImageSvg(block)}</figure>`;
    case "Quiz": {
      const options = block.options
        .map((o, i) => `<li class="df-quiz-option" data-option="${i}"${i === block.answerIndex ? " data-correct" : ""}>${em(o)}</li>`)
        .join("");
      return `<div class="df-quiz" data-answer-index="${block.answerIndex}"><p class="df-quiz-question">${em(block.question)}</p><ol class="df-quiz-options" type="A">${options}</ol><p class="df-quiz-explanation">${em(block.explanation)}</p></div>`;
    }
  }
}
