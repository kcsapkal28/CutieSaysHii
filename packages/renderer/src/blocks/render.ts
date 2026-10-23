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

const TREND_GLYPH = { up: "▲", down: "▼", flat: "▶" } as const;

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
      const trend = block.trend
        ? `<span class="df-stat-trend" data-trend="${block.trend}" aria-label="trend ${block.trend}">${TREND_GLYPH[block.trend]}</span>`
        : "";
      return `<div class="df-stat"><div class="df-stat-value"><span class="df-stat-number">${em(block.value)}</span>${trend}</div><div class="df-stat-label">${em(block.label)}</div></div>`;
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
      const rows = block.rows.map((r) => `<tr><td>${em(r.left)}</td><td>${em(r.right)}</td></tr>`).join("");
      return `<table class="df-compare"><thead><tr><th scope="col">${em(block.leftTitle)}</th><th scope="col">${em(block.rightTitle)}</th></tr></thead><tbody>${rows}</tbody></table>`;
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
