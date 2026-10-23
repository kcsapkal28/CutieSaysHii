import { readdirSync, readFileSync } from "node:fs";
import type { Block } from "@deckforge/schemas";
import { describe, expect, it } from "vitest";
import { diagramKey } from "../src/blocks/render.ts";
import { cssSources } from "../src/css.ts";
import { lengthClass } from "../src/html/context.ts";
import { renderDeckHtml } from "../src/html/deck.ts";
import { catalog, deckOf, dom, fixture, inputFor, interaction, slideOf, solarDoc, TEMPLATES_DIR } from "./deck-setup.ts";

describe("template markup", () => {
  it("every template roots on df-slide--<type>", () => {
    for (const t of catalog.slideTypes.types) {
      const { html } = renderDeckHtml(inputFor(deckOf(slideOf(t.id))));
      const root = dom(html).querySelector("section")!.firstElementChild!;
      expect(root.className, t.id).toBe(`df-slide df-slide--${t.id}`);
    }
  });

  // Folds in the deferred duplicated and 300-character utility strings: geometry lives in the stylesheets.
  it("templates carry no hard-coded sizes", () => {
    const files = [
      ...readdirSync(TEMPLATES_DIR).filter((f) => f.endsWith(".hbs")),
      ...readdirSync(`${TEMPLATES_DIR}partials`).map((f) => `partials/${f}`),
    ];
    expect(files).toHaveLength(19);
    for (const f of files) {
      const source = readFileSync(`${TEMPLATES_DIR}${f}`, "utf8");
      expect(source, f).not.toContain("text-[length:");
      for (const m of source.matchAll(/class="([^"]*)"/g)) expect(m[1]!.length, f).toBeLessThanOrEqual(200);
    }
  });

  it("empty optional regions are hidden and not animated", () => {
    // A cover whose slide title equals the deck title has no meta line.
    const cover = dom(renderDeckHtml(inputFor(deckOf(slideOf("title", [], { title: "Deck" })))).html);
    const meta = cover.querySelector(".df-meta");
    expect(meta?.getAttribute("data-region")).toBe("meta");
    expect(meta?.hasAttribute("hidden")).toBe(true);
    expect(meta?.hasAttribute("data-motion-el")).toBe(false);
    for (const t of catalog.slideTypes.types) {
      const doc = dom(renderDeckHtml(inputFor(deckOf(slideOf(t.id, [], { title: undefined })))).html);
      for (const r of t.regions) {
        const el = doc.querySelector(`[data-region="${r}"]`)!;
        if (el.innerHTML !== "") continue;
        expect(el.hasAttribute("hidden"), `${t.id}:${r}`).toBe(true);
        expect(el.hasAttribute("data-motion-el"), `${t.id}:${r}`).toBe(false);
      }
      expect(doc.querySelectorAll("[data-motion-el]:empty"), t.id).toHaveLength(0);
    }
  });
});

// Layout tokens reach the markup as data-df-* attributes, kickers, ordinals, length classes and counts.
describe("layout tokens", () => {
  it("root carries one data-df attribute per layout token", () => {
    const input = inputFor(fixture, { interaction });
    const root = dom(renderDeckHtml(input).html).querySelector(".reveal")!;
    expect(root.getAttribute("data-df-stat")).toBe("bento");
    expect(root.getAttribute("data-df-panel")).toBe("flat");
    expect(root.getAttribute("data-df-emphasis")).toBe("underline");
    const l = input.theme.layout;
    const expected: Record<string, string> = {
      "data-df-align": l.align,
      "data-df-cover": l.coverAnchor,
      "data-df-kicker": l.kicker,
      "data-df-stat": l.stat,
      "data-df-panel": l.panel,
      "data-df-divider": l.divider,
      "data-df-decoration": l.decoration,
      "data-df-image-layout": l.imageLayout,
      "data-df-emphasis": l.emphasis,
      "data-df-tracking": l.tracking,
    };
    for (const [attr, value] of Object.entries(expected)) expect(root.getAttribute(attr), attr).toBe(value);
  });

  it("sections carry data-df-variant and data-df-decorate per decorationOn", () => {
    const decorated = (family: string) =>
      [...solarDoc(family).querySelectorAll("section[data-df-decorate]")].map((s) => s.id);
    expect(decorated("retro")).toEqual(["s01", "s03", "s14", "s15"]);
    expect(decorated("minimal")).toEqual([]);
    expect(decorated("neon")).toHaveLength(15);
    const doc = solarDoc("retro");
    expect(doc.querySelector("#s04")?.hasAttribute("data-df-decorate")).toBe(false);
    expect(doc.querySelector("#s05")?.getAttribute("data-df-variant")).toBe("1");
    for (const [i, s] of [...doc.querySelectorAll("section")].entries()) {
      expect(s.getAttribute("data-df-variant"), s.id).toBe(String(i % 3));
      const deco = s.querySelector(".df-deco");
      expect(deco !== null, s.id).toBe(s.hasAttribute("data-df-decorate"));
      if (deco) {
        expect(deco.parentElement?.firstElementChild).toBe(deco);
        expect(deco.getAttribute("aria-hidden")).toBe("true");
      }
    }
  });

  it("section kicker names the current section", () => {
    const doc = solarDoc("minimal");
    const kicker = doc.querySelector("#s04 .df-kicker");
    expect(kicker?.textContent).toBe("From sunlight to current");
    expect(kicker?.hasAttribute("hidden")).toBe(false);
    expect(kicker?.hasAttribute("aria-hidden")).toBe(false);
    expect(doc.querySelector("#s02 .df-kicker")?.textContent).toBe("");
    expect(doc.querySelector("#s02 .df-kicker")?.hasAttribute("hidden")).toBe(true);
    // Title, section and qa slides carry no kicker.
    for (const id of ["s01", "s03", "s15"]) expect(doc.querySelector(`#${id} .df-kicker`)?.hasAttribute("hidden"), id).toBe(true);
  });

  it("index kicker is padded and aria-hidden", () => {
    const doc = solarDoc("swiss");
    const kicker = doc.querySelector("#s04 .df-kicker");
    expect(kicker?.textContent).toBe("04");
    expect(kicker?.getAttribute("aria-hidden")).toBe("true");
    expect(kicker?.hasAttribute("hidden")).toBe(false);
    expect(doc.querySelector("#s01 .df-kicker")?.textContent).toBe("");
    expect(doc.querySelector("#s01 .df-kicker")?.hasAttribute("hidden")).toBe(true);
    expect(solarDoc("glass-soft").querySelector("#s04 .df-kicker")?.hasAttribute("hidden")).toBe(true);
  });

  it("section slides carry their ordinal", () => {
    const number = solarDoc("minimal").querySelector("#s03 .df-section-number");
    expect(number?.textContent).toBe("01");
    expect(number?.getAttribute("aria-hidden")).toBe("true");
    const deck = deckOf(slideOf("section"), slideOf("bullets", [], { id: "x2" }), slideOf("section", [], { id: "x3" }));
    const doc = dom(renderDeckHtml(inputFor(deck)).html);
    expect([...doc.querySelectorAll(".df-section-number")].map((n) => n.textContent)).toEqual(["01", "02"]);
  });

  it("title-case families case the text, not the CSS", () => {
    const input = inputFor(fixture, { interaction }, "retro");
    expect(input.theme.titleCase).toBe("title");
    const { html } = renderDeckHtml(input);
    expect(dom(html).querySelector("#s08 .df-title")?.textContent).toBe("Path of a Photon");
    expect(html).not.toContain("capitalize");
    // Sentence-case families keep the author's text.
    expect(solarDoc("minimal").querySelector("#s08 .df-title")?.textContent).toBe("Path of a photon");
  });

  it("title casing runs before emphasis and escaping", () => {
    const compare: Block = {
      type: "Compare",
      leftTitle: "the pros of solar",
      rightTitle: "costs & <risks>",
      rows: [{ left: "a", right: "b" }],
    };
    const slide = slideOf("compare", [compare], { title: "risks & rewards of <solar> power", emphasisTargets: ["SOLAR", "<risks>"] });
    const section = slideOf("section", [], { id: "x0", title: "the kicker of things" });
    const input = inputFor(deckOf(section, slide), {}, "retro");
    input.theme = { ...input.theme, layout: { ...input.theme.layout, kicker: "section" } };
    const { html } = renderDeckHtml(input);
    const doc = dom(html);
    expect(doc.querySelector("#x1 .df-title")?.textContent).toBe("Risks & Rewards of <solar> Power");
    expect(html).toContain("Risks &amp; Rewards of &lt;solar&gt; Power");
    expect(doc.querySelector("#x1 .df-kicker")?.textContent).toBe("The Kicker of Things");
    const [left, right] = [...doc.querySelectorAll("#x1 .df-side-title")];
    expect(left?.textContent).toBe("The Pros of Solar");
    expect(left?.querySelector("mark[data-emphasis]")?.textContent).toBe("Solar");
    expect(right?.textContent).toBe("Costs & <risks>");
    expect(right?.querySelector("mark[data-emphasis]")?.textContent).toBe("<risks>");
    expect(html).not.toContain("<risks>");
    expect(html).not.toContain("<solar>");
  });

  it("lengthClass buckets by characters", () => {
    expect(lengthClass("Questions?")).toBe("s");
    expect(lengthClass("x".repeat(18))).toBe("s");
    expect(lengthClass("x".repeat(30))).toBe("m");
    expect(lengthClass("x".repeat(36))).toBe("m");
    expect(lengthClass("x".repeat(40))).toBe("l");
    const doc = solarDoc("minimal");
    expect(doc.querySelector("#s01 h1.df-title[data-region=title]")?.getAttribute("data-df-len")).toBe(lengthClass(fixture.title));
    expect(doc.querySelector("#s15 h2.df-title[data-region=title]")?.getAttribute("data-df-len")).toBe("s");
  });

  it("df-body carries the item count, and compare sides share one grid", () => {
    const doc = solarDoc("minimal");
    const bullets = fixture.slides[3]!.body[0] as Extract<Block, { type: "Bullets" }>;
    expect(doc.querySelector("#s04 .df-body")?.getAttribute("data-df-count")).toBe(String(bullets.items.length));
    expect(doc.querySelector("#s06 .df-body")?.getAttribute("data-df-count")).toBe("3");
    expect(doc.querySelector("#s05 .df-body")?.getAttribute("data-df-count")).toBe("0");
    const rows = (fixture.slides[9]!.body[0] as Extract<Block, { type: "Compare" }>).rows.length;
    const grid = doc.querySelector("#s10 .df-compare-grid");
    expect(grid?.getAttribute("style")).toBe(`--df-rows:${rows}`);
    expect(grid?.querySelector(":scope > .df-side--a[data-region=left][data-motion-el] > h3.df-side-title")).not.toBeNull();
    expect(grid?.querySelectorAll(":scope > .df-side--b[data-region=right] > ul.df-side-list > li")).toHaveLength(rows);
  });

  it("chart footer carries extra paragraphs, never the unit", () => {
    const footer = solarDoc("minimal").querySelector("#s09 [data-region=footer]");
    expect(footer?.textContent).toBe("");
    expect(footer?.hasAttribute("hidden")).toBe(true);
    const chart = fixture.slides[8]!.body[0]!;
    const slide = slideOf("chart", [chart, { type: "Paragraph", text: "Source: <IEA> 2024" }]);
    const { html, warnings } = renderDeckHtml(inputFor(deckOf(slide)));
    const caption = dom(html).querySelector("[data-region=footer]");
    expect(caption?.textContent).toBe("Source: <IEA> 2024");
    expect(caption?.hasAttribute("hidden")).toBe(false);
    expect(dom(html).querySelector("[data-region=body] .df-paragraph")).toBeNull();
    expect(warnings).toEqual([]);
  });

  it("a diagram used twice gets distinct ids", () => {
    const mermaid = "graph TD; A-->B";
    const key = diagramKey(mermaid);
    const svg = `<svg id="d-${key}"><style>#d-${key} .node{fill:red}</style><g id="d-${key}-flowchart-A"></g></svg>`;
    const diagram: Block = { type: "Diagram", mermaid };
    const deck = deckOf(slideOf("diagram", [diagram]), slideOf("diagram", [diagram], { id: "x2" }));
    const { html } = renderDeckHtml(inputFor(deck, { diagrams: new Map([[key, svg]]) }));
    expect(html.split(`id="d-${key}"`)).toHaveLength(2);
    expect(html.split(`id="d-${key}-1"`)).toHaveLength(2);
    expect(html).toContain(`#d-${key}-1 .node`);
    const ids = [...html.matchAll(/ id="([^"]*)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("cssSources covers template partials and every stylesheet", () => {
    const sources = cssSources();
    expect(sources).toContain("templates/partials/title.hbs");
    expect(sources).toContain("templates/bullets.hbs");
    for (const sheet of ["deck", "layout", "panels", "decorations", "chrome", "diagrams", "images", "textures"]) {
      expect(sources).toContain(`src/styles/${sheet}.css`);
    }
  });
});
