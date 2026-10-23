import { expect, test, type Page } from "@playwright/test";
import { DECKS, layoutOf, readDeckSpec } from "./global-setup.ts";
import { openDeck, showSlide } from "./metrics.ts";
import { PENDING } from "./pending.ts";

// Geometric design rules, measured in the browser at the deck's native 1920×1080.
test.use({ viewport: { width: 1920, height: 1080 } });

const FILL_TYPES = ["agenda", "bullets", "summary", "stat", "chart", "diagram", "compare", "timeline", "code"];
const NO_KICKER = ["title", "section", "qa"];

/** Runs `probe` in the page on each slide in turn (final state, fonts loaded) and gathers its failures. */
async function onSlides<A>(page: Page, indexes: number[], probe: (arg: A) => string[], arg: A): Promise<string[]> {
  const failures: string[] = [];
  for (const h of indexes) {
    await showSlide(page, h);
    failures.push(...(await page.evaluate(probe as (a: unknown) => string[], arg as unknown)));
  }
  return failures;
}

test.fixme("no design check is pending", () => {
  expect([...PENDING]).toEqual([]);
});

for (const { family, deck } of DECKS) {
  const spec = readDeckSpec(deck);
  const layout = layoutOf(family);
  const slidesOf = (types: string[], include = true) =>
    spec.slides.flatMap((s, i) => (types.includes(s.type) === include ? [i] : []));
  const all = spec.slides.map((_, i) => i);

  test.describe(`${family} ${deck}`, () => {
    const check = (id: string, title: string, body: (page: Page) => Promise<void>) =>
      test(`${id}: ${title}`, async ({ page }) => {
        test.fixme(PENDING.has(id));
        await openDeck(page, family, deck);
        await body(page);
      });

    const needs = (indexes: number[], what: string) => test.skip(indexes.length === 0, `deck has no ${what}`);

    check("fills-frame", "content fills the frame instead of sitting at the top", async (page) => {
      const failures = await onSlides(page, slidesOf(FILL_TYPES), () => {
        const s = window.Reveal.getCurrentSlide();
        const f = window.dfMetrics.safeFrame(s);
        const e = window.dfMetrics.contentExtent(s);
        if (!e) return [`${s.id}: no content`];
        const span = (e.bottom - e.top) / f.height;
        const empty = (f.bottom - e.bottom) / f.height;
        return span >= 0.55 && empty <= 0.35 ? [] : [`${s.id}: spans ${span.toFixed(2)}, empty below ${empty.toFixed(2)}`];
      }, null);
      expect(failures).toEqual([]);
    });

    check("title-ratio", "the bullets title is at least 1.5× the item size", async (page) => {
      const bullets = slidesOf(["bullets"]);
      needs(bullets, "bullets slide");
      const failures = await onSlides(page, bullets, () => {
        const s = window.Reveal.getCurrentSlide();
        const size = (sel: string) => parseFloat(getComputedStyle(s.querySelector(sel)!).fontSize);
        const ratio = size('[data-region="title"]') / size('[data-region="body"] li');
        return ratio >= 1.5 ? [] : [`${s.id}: title/item ${ratio.toFixed(2)}`];
      }, null);
      expect(failures).toEqual([]);
    });

    check("vertical-overflow", "no region overflows vertically", async (page) => {
      const failures = await onSlides(page, all, () => {
        const s = window.Reveal.getCurrentSlide();
        return [...s.querySelectorAll<HTMLElement>("[data-region]")]
          .filter((r) => r.scrollHeight > r.clientHeight + 1)
          .map((r) => `${s.id} ${r.dataset.region}: scrollHeight ${r.scrollHeight} > clientHeight ${r.clientHeight}`);
      }, null);
      expect(failures).toEqual([]);
    });

    check("stat-one-line", "stat values stay on one line, unclipped", async (page) => {
      const stats = slidesOf(["stat"]);
      needs(stats, "stat slide");
      const counts = Object.fromEntries(stats.map((h) => [spec.slides[h]!.id, spec.slides[h]!.body.filter((b) => b.type === "Stat").length]));
      const failures = await onSlides(page, stats, (expected) => {
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
      }, counts);
      expect(failures).toEqual([]);
    });

    check("compare-rows-align", "compare rows align across sides", async (page) => {
      const compares = slidesOf(["compare"]);
      needs(compares, "compare slide");
      const failures = await onSlides(page, compares, () => {
        const s = window.Reveal.getCurrentSlide();
        const k = window.dfMetrics.slideScale(s);
        const tops = (side: string) =>
          [...s.querySelectorAll(`[data-region="${side}"] li`)].map((li) => li.getBoundingClientRect().top / k);
        const [left, right] = [tops("left"), tops("right")];
        if (left.length === 0 || left.length !== right.length) return [`${s.id}: ${left.length} vs ${right.length} rows`];
        return left.flatMap((t, i) => (Math.abs(t - right[i]!) <= 1 ? [] : [`${s.id} row ${i}: ${t.toFixed(1)} vs ${right[i]!.toFixed(1)}`]));
      }, null);
      expect(failures).toEqual([]);
    });

    check("min-text-size", "text is at least 24 px (22 px for captions and graphic labels)", async (page) => {
      const failures = await onSlides(page, all, () => {
        const s = window.Reveal.getCurrentSlide();
        const m = window.dfMetrics;
        const small = '.df-caption, .df-footer, [data-region="caption"], [data-region="footer"], .df-chart, .df-diagram';
        const out: string[] = [];
        for (const el of s.querySelectorAll("*")) {
          if (el instanceof SVGElement || el.closest("aside.notes, .df-deco")) continue;
          const text = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim());
          if (!text || !m.isShown(el)) continue;
          const size = m.renderedFontSize(el);
          const min = el.closest(small) ? 22 : 24;
          if (size < min - 0.01) out.push(`${s.id} <${el.localName}.${el.classList[0] ?? ""}> "${el.textContent?.trim().slice(0, 24)}": ${size.toFixed(1)}px < ${min}`);
        }
        return out;
      }, null);
      expect(failures).toEqual([]);
    });

    check("graphics-3to1", "chart marks and timeline nodes reach 3:1 on the background", async (page) => {
      const failures = await onSlides(page, slidesOf(["chart", "timeline"]), () => {
        const s = window.Reveal.getCurrentSlide();
        const m = window.dfMetrics;
        const bg = m.resolveColour("var(--df-bg)");
        const out: string[] = [];
        const judge = (what: string, colour: string, alpha = 1) => {
          const [r, g, b, a] = m.parseColour(colour);
          const ratio = m.rgbContrast(`rgba(${r}, ${g}, ${b}, ${a * alpha})`, bg);
          if (ratio < 3) out.push(`${s.id} ${what} ${colour}: ${ratio.toFixed(2)}:1`);
        };
        for (const chart of s.querySelectorAll(".df-chart")) {
          const marks = [...chart.querySelectorAll(".df-plot :is(rect, path, circle, ellipse, polygon, polyline, line)")];
          if (marks.length === 0) out.push(`${s.id}: chart has no marks`);
          for (const mark of marks) {
            const cs = getComputedStyle(mark);
            const filled = cs.fill !== "none";
            judge("mark", filled ? cs.fill : cs.stroke, Number(filled ? cs.fillOpacity : cs.strokeOpacity) * Number(cs.opacity));
          }
        }
        for (const step of s.querySelectorAll(".df-timeline-step")) {
          const node =
            step.querySelector(".df-timeline-node") ??
            (["::before", "::after"].find((p) => getComputedStyle(step, p).content !== "none") ?? null);
          if (node === null) out.push(`${s.id}: timeline step has no node`);
          else judge("node", (typeof node === "string" ? getComputedStyle(step, node) : getComputedStyle(node)).backgroundColor);
        }
        return out;
      }, null);
      expect(failures).toEqual([]);
    });

    check("decorations-behind", "decorations sit behind content and ignore the pointer", async (page) => {
      const failures = await page.evaluate((decorated) => {
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
      }, layout.decoration !== "none");
      expect(failures).toEqual([]);
    });

    check("emphasis-legible", "emphasised text keeps 4.5:1 on its background", async (page) => {
      const emphasised = spec.slides.flatMap((s, i) => (s.emphasisTargets.length > 0 ? [i] : []));
      needs(emphasised, "emphasis targets");
      const failures = await onSlides(page, emphasised, () => {
        const s = window.Reveal.getCurrentSlide();
        const m = window.dfMetrics;
        return [...s.querySelectorAll("mark.df-emph")].flatMap((mark) => {
          const ratio = m.rgbContrast(getComputedStyle(mark).color, m.effectiveBackground(mark));
          return ratio >= 4.5 ? [] : [`${s.id} "${mark.textContent}": ${ratio.toFixed(2)}:1`];
        });
      }, null);
      expect(failures).toEqual([]);
    });

    check("chrome-legible", "slide number, progress and controls are legible", async (page) => {
      await showSlide(page, 1);
      const failures = await page.evaluate(() => {
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
      });
      expect(failures).toEqual([]);
    });

    check("slide-number-once", "the slide number shows once: as the index kicker or as Reveal's number", async (page) => {
      const failures = await onSlides(page, slidesOf(NO_KICKER, false), (index) => {
        const s = window.Reveal.getCurrentSlide();
        const m = window.dfMetrics;
        const shown = (el: Element | null) => el !== null && m.isShown(el) && Boolean(el.textContent?.trim());
        const number = shown(document.querySelector(".reveal .slide-number"));
        const kicker = shown(s.querySelector(".df-kicker"));
        if (index) return kicker && !number ? [] : [`${s.id}: index kicker ${kicker}, slide number ${number}`];
        return number ? [] : [`${s.id}: no slide number`];
      }, layout.kicker === "index");
      expect(failures).toEqual([]);
    });

    check("stat-aria", "stat labels are announced once and each trend has an accessible name", async (page) => {
      const stats = slidesOf(["stat"]);
      needs(stats, "stat slide");
      const failures: string[] = [];
      for (const h of stats) {
        await showSlide(page, h);
        const tree = await page.locator("section.present").ariaSnapshot();
        const slide = spec.slides[h]!;
        for (const b of slide.body) {
          if (b.type !== "Stat") continue;
          const n = tree.split(b.label).length - 1;
          if (n !== 1) failures.push(`${slide.id} "${b.label}": announced ${n} times`);
        }
        if (!tree.includes('img "Trend: up"')) failures.push(`${slide.id}: no img "Trend: up"`);
      }
      expect(failures).toEqual([]);
    });

    check("diagram-fills", "diagrams fill their region", async (page) => {
      const diagrams = slidesOf(["diagram"]);
      needs(diagrams, "diagram slide");
      const failures = await onSlides(page, diagrams, () => {
        const s = window.Reveal.getCurrentSlide();
        const svg = s.querySelector<SVGSVGElement>(".df-diagram svg");
        const region = svg?.closest("[data-region]");
        if (!svg || !region) return [`${s.id}: no diagram svg`];
        const d = window.dfMetrics.drawingSize(svg);
        const r = region.getBoundingClientRect();
        const fill = Math.max(d.width / r.width, d.height / r.height);
        return fill >= 0.8 ? [] : [`${s.id}: drawing fills ${fill.toFixed(2)} of its region`];
      }, null);
      expect(failures).toEqual([]);
    });

    check("image-caption-legible", "a bleed image's caption sits on an opaque background plate", async (page) => {
      test.skip(layout.imageLayout !== "bleed", "only bleed images put the caption over the picture");
      const images = slidesOf(["image"]);
      needs(images, "image slide");
      const failures = await onSlides(page, images, () => {
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
      }, null);
      expect(failures).toEqual([]);
    });
  });
}
