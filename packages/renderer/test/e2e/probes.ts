/// <reference lib="dom" />
// In-page design probes for design.spec.ts. Each is passed to page.evaluate, which serialises its source, so a
// probe may use only its argument, the DOM and window.dfMetrics (metrics.ts). Each returns its failures.

export function fillsFrame(): string[] {
  const s = window.Reveal.getCurrentSlide();
  const f = window.dfMetrics.safeFrame(s);
  const e = window.dfMetrics.contentExtent(s);
  if (!e) return [`${s.id}: no content`];
  const span = (e.bottom - e.top) / f.height;
  const empty = (f.bottom - e.bottom) / f.height;
  return span >= 0.55 && empty <= 0.35 ? [] : [`${s.id}: spans ${span.toFixed(2)}, empty below ${empty.toFixed(2)}`];
}

export function titleRatio(): string[] {
  const s = window.Reveal.getCurrentSlide();
  const size = (sel: string) => parseFloat(getComputedStyle(s.querySelector(sel)!).fontSize);
  const ratio = size('[data-region="title"]') / size('[data-region="body"] li');
  return ratio >= 1.5 ? [] : [`${s.id}: title/item ${ratio.toFixed(2)}`];
}

/** Box overflow, not glyph ink: a region may scroll by the glyph spill of a tight line-height, no more. */
export function verticalOverflow(): string[] {
  const s = window.Reveal.getCurrentSlide();
  const m = window.dfMetrics;
  const frame = m.safeFrame(s);
  const out: string[] = [];
  for (const r of s.querySelectorAll<HTMLElement>("[data-region]")) {
    const allowance = Math.ceil(m.textSpill(r)) + 1;
    if (r.scrollHeight > r.clientHeight + allowance)
      out.push(`${s.id} ${r.dataset.region}: scrollHeight ${r.scrollHeight} > clientHeight ${r.clientHeight} + ${allowance}`);
    // Images may bleed past the frame by design; every other region box ends inside it.
    if (!m.isShown(r) || r.querySelector(".df-image")) continue;
    const below = r.getBoundingClientRect().bottom - frame.bottom;
    if (below > 1) out.push(`${s.id} ${r.dataset.region}: box ends ${below.toFixed(1)}px below the frame`);
  }
  return out;
}

export function statOneLine(expected: Record<string, number>): string[] {
  const s = window.Reveal.getCurrentSlide();
  const m = window.dfMetrics;
  const numbers = [...s.querySelectorAll(".df-stat-number")];
  const out = numbers.length === expected[s.id] ? [] : [`${s.id}: ${numbers.length} stat numbers`];
  for (const n of numbers) {
    const block = (getComputedStyle(n).display === "inline" ? n.parentElement : n) as HTMLElement;
    const cell = n.closest(".df-stat")!.getBoundingClientRect();
    const box = n.getBoundingClientRect();
    if (m.lineCount(n) !== 1) out.push(`${s.id} "${n.textContent}": ${m.lineCount(n)} lines`);
    if (block.scrollWidth > block.clientWidth + 1) out.push(`${s.id} "${n.textContent}": clipped`);
    if (box.left < cell.left - 1 || box.right > cell.right + 1) out.push(`${s.id} "${n.textContent}": outside its cell`);
  }
  return out;
}

export function compareRowsAlign(): string[] {
  const s = window.Reveal.getCurrentSlide();
  const k = window.dfMetrics.slideScale(s);
  const tops = (side: string) =>
    [...s.querySelectorAll(`[data-region="${side}"] li`)].map((li) => li.getBoundingClientRect().top / k);
  const [left, right] = [tops("left"), tops("right")];
  if (left.length === 0 || left.length !== right.length) return [`${s.id}: ${left.length} vs ${right.length} rows`];
  return left.flatMap((t, i) => (Math.abs(t - right[i]!) <= 1 ? [] : [`${s.id} row ${i}: ${t.toFixed(1)} vs ${right[i]!.toFixed(1)}`]));
}

/** HTML text ≥ 24 px; captions, footers, chart text (svg text included) and diagram labels ≥ 22 px. */
export function minTextSize(): string[] {
  const s = window.Reveal.getCurrentSlide();
  const m = window.dfMetrics;
  const small = '.df-caption, .df-footer, [data-region="caption"], [data-region="footer"], .df-chart, .df-diagram';
  const out: string[] = [];
  for (const el of s.querySelectorAll("*")) {
    const chartText = el.closest(".df-chart") !== null && (el.localName === "text" || el.localName === "tspan");
    if ((el instanceof SVGElement && !chartText) || el.closest("aside.notes, .df-deco")) continue;
    const text = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim());
    if (!text || !m.isShown(el)) continue;
    const size = m.renderedFontSize(el);
    const min = el.closest(small) ? 22 : 24;
    if (size < min - 0.01)
      out.push(`${s.id} <${el.localName}.${el.classList[0] ?? ""}> "${el.textContent?.trim().slice(0, 24)}": ${size.toFixed(1)}px < ${min}`);
  }
  return out;
}

/** Chart marks and timeline nodes reach 3:1 against what is actually behind them, which must be the slide bg. */
export function graphics3to1(): string[] {
  const s = window.Reveal.getCurrentSlide();
  const m = window.dfMetrics;
  const bg = m.resolveColour("var(--df-bg)");
  const out: string[] = [];
  const backdrop = (what: string, el: Element) => {
    const behind = m.effectiveBackground(el);
    if (m.rgbContrast(behind, bg) > 1.01) out.push(`${s.id}: ${what} sits on a panel fill ${behind}`);
    return behind;
  };
  const judge = (what: string, colour: string, alpha: number, behind: string) => {
    const [r, g, b, a] = m.parseColour(colour);
    const ratio = m.rgbContrast(`rgba(${r}, ${g}, ${b}, ${a * alpha})`, behind);
    if (ratio < 3) out.push(`${s.id} ${what} ${colour}: ${ratio.toFixed(2)}:1`);
  };
  for (const chart of s.querySelectorAll(".df-chart")) {
    if (chart.closest(".df-deco")) continue;
    const behind = backdrop("chart", chart);
    const marks = [...chart.querySelectorAll(".df-plot :is(rect, path, circle, ellipse, polygon, polyline, line)")];
    if (marks.length === 0) out.push(`${s.id}: chart has no marks`);
    for (const mark of marks) {
      const cs = getComputedStyle(mark);
      const filled = cs.fill !== "none";
      const alpha = Number(filled ? cs.fillOpacity : cs.strokeOpacity) * Number(cs.opacity);
      judge("mark", filled ? cs.fill : cs.stroke, alpha, behind);
    }
  }
  for (const step of s.querySelectorAll(".df-timeline-step")) {
    if (step.closest(".df-deco")) continue;
    const node = step.querySelector(".df-timeline-node");
    const pseudo = ["::before", "::after"].find((p) => getComputedStyle(step, p).content !== "none");
    if (node) judge("node", getComputedStyle(node).backgroundColor, 1, backdrop("timeline node", node.parentElement!));
    else if (pseudo) judge("node", getComputedStyle(step, pseudo).backgroundColor, 1, backdrop("timeline node", step));
    else out.push(`${s.id}: timeline step has no node`);
  }
  return out;
}

/** Whole document: every decorated slide's .df-deco is first, inert and below its siblings. */
export function decorationsBehind(decorated: boolean): string[] {
  const sections = [...document.querySelectorAll<HTMLElement>(".slides section[data-df-decorate]")];
  const out = decorated && sections.length === 0 ? ["no slide is decorated"] : [];
  const z = (el: Element) => Number.parseInt(getComputedStyle(el).zIndex) || 0;
  for (const s of sections) {
    const deco = s.querySelector(".df-deco");
    if (!deco || deco.parentElement!.firstElementChild !== deco) {
      out.push(`${s.id}: .df-deco is not the first child`);
      continue;
    }
    if (getComputedStyle(deco).pointerEvents !== "none") out.push(`${s.id}: .df-deco takes pointer events`);
    const siblings = [...deco.parentElement!.children].filter((c) => c !== deco && getComputedStyle(c).display !== "none");
    for (const c of siblings) if (z(c) <= z(deco)) out.push(`${s.id}: <${c.localName}.${c.classList[0] ?? ""}> is not above .df-deco`);
  }
  return out;
}

export function emphasisLegible(): string[] {
  const s = window.Reveal.getCurrentSlide();
  const m = window.dfMetrics;
  const marks = [...s.querySelectorAll("mark.df-emph")];
  if (marks.length === 0) return [`${s.id}: no mark.df-emph for its emphasis targets`];
  return marks.flatMap((mark) => {
    const ratio = m.rgbContrast(getComputedStyle(mark).color, m.effectiveBackground(mark));
    return ratio >= 4.5 ? [] : [`${s.id} "${mark.textContent}": ${ratio.toFixed(2)}:1`];
  });
}

export function chromeLegible(): string[] {
  const m = window.dfMetrics;
  const out: string[] = [];
  const pageBg = m.effectiveBackground(document.querySelector(".reveal")!);
  const opacity = (el: Element) => {
    let o = 1;
    for (let n: Element | null = el; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity);
    return o;
  };
  const judge = (what: string, el: Element | null, colour: (cs: CSSStyleDeclaration) => string, min: number, bg = pageBg) => {
    if (!el) return void out.push(`${what}: missing`);
    const [r, g, b, a] = m.parseColour(colour(getComputedStyle(el)));
    const ratio = m.rgbContrast(`rgba(${r}, ${g}, ${b}, ${a * opacity(el)})`, bg);
    if (ratio < min) out.push(`${what}: ${ratio.toFixed(2)}:1 < ${min}`);
  };
  const number = document.querySelector(".reveal .slide-number");
  if (number && m.isShown(number)) {
    for (const el of [number, ...number.querySelectorAll("*")]) {
      if ([...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim()))
        judge("slide number", el, (cs) => cs.color, 4.5, m.effectiveBackground(el));
    }
  }
  judge("progress", document.querySelector(".reveal .progress span"), (cs) => cs.backgroundColor, 3);
  judge("controls", document.querySelector(".reveal .controls .navigate-right"), (cs) => cs.color, 3);
  return out;
}

/** Index-kicker families show the kicker and no Reveal number; the others show the number. */
export function slideNumberOnce(index: boolean): string[] {
  const s = window.Reveal.getCurrentSlide();
  const m = window.dfMetrics;
  const shown = (el: Element | null) => el !== null && m.isShown(el) && Boolean(el.textContent?.trim());
  const number = shown(document.querySelector(".reveal .slide-number"));
  const kicker = shown(s.querySelector(".df-kicker"));
  if (index) return kicker && !number ? [] : [`${s.id}: index kicker ${kicker}, slide number ${number}`];
  return number ? [] : [`${s.id}: no slide number`];
}

export function diagramFills(): string[] {
  const s = window.Reveal.getCurrentSlide();
  const svg = s.querySelector<SVGSVGElement>(".df-diagram svg");
  const region = svg?.closest("[data-region]");
  if (!svg || !region) return [`${s.id}: no diagram svg`];
  const d = window.dfMetrics.drawingSize(svg);
  const r = region.getBoundingClientRect();
  const fill = Math.max(d.width / r.width, d.height / r.height);
  return fill >= 0.8 ? [] : [`${s.id}: drawing fills ${fill.toFixed(2)} of its region`];
}

/** A bleed image's caption sits on an opaque --df-bg plate (below the template root) at 4.5:1. */
export function imageCaptionLegible(): string[] {
  const s = window.Reveal.getCurrentSlide();
  const m = window.dfMetrics;
  const caption = s.querySelector('.df-caption, [data-region="caption"]');
  if (!caption || !m.isShown(caption)) return [`${s.id}: no caption`];
  let plate: Element | null = caption;
  while (plate && !plate.matches(".df-slide, section") && m.parseColour(getComputedStyle(plate).backgroundColor)[3] < 1)
    plate = plate.parentElement;
  if (!plate || plate.matches(".df-slide, section")) return [`${s.id}: caption has no opaque plate`];
  const fill = getComputedStyle(plate).backgroundColor;
  const out = m.rgbContrast(fill, m.resolveColour("var(--df-bg)")) > 1.01 ? [`${s.id}: plate ${fill} is not --df-bg`] : [];
  const ratio = m.rgbContrast(getComputedStyle(caption).color, fill);
  return ratio >= 4.5 ? out : [...out, `${s.id}: caption ${ratio.toFixed(2)}:1`];
}
