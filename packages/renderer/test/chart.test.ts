import { readFileSync } from "node:fs";
import type { Block, DeckSpec } from "@deckforge/schemas";
import { describe, expect, it } from "vitest";
import { chartSvg, donutSlices, formatValue, niceTicks } from "../src/blocks/chart.ts";

type ChartBlock = Extract<Block, { type: "Chart" }>;

const count = (s: string, needle: string) => s.split(needle).length - 1;
const plotOf = (svg: string) => /<g class="df-plot">([\s\S]*?)<\/g>/.exec(svg)?.[1] ?? "";
const texts = (svg: string) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]!);
const fills = (s: string) => [...s.matchAll(/fill:([^;"]+)/g)].map((m) => m[1]!);

const deck = JSON.parse(readFileSync(new URL("../fixtures/solar.deck.json", import.meta.url), "utf8")) as DeckSpec;
const solar = deck.slides.flatMap((s) => s.body).find((b): b is ChartBlock => b.type === "Chart")!;

const bar: ChartBlock = {
  type: "Chart",
  kind: "bar",
  labels: ["a", "b", "c"],
  series: [
    { name: "s1", values: [1, 2, 3] },
    { name: "s2", values: [3, 2, 1] },
  ],
};

describe("niceTicks", () => {
  it("niceTicks rounds", () => {
    expect(niceTicks(0, 1420)).toEqual([0, 500, 1000, 1500]);
  });

  it("spans negatives on round steps", () => {
    expect(niceTicks(-30, 80)).toEqual([-50, 0, 50, 100]);
  });

  it("rounds fractional steps to the step's decimals", () => {
    expect(niceTicks(0, 0.6)).toEqual([0, 0.2, 0.4, 0.6]);
  });

  it("returns at least two finite values for an empty range", () => {
    const ticks = niceTicks(5, 5);
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    for (const t of ticks) expect(Number.isFinite(t)).toBe(true);
  });
});

describe("formatValue", () => {
  it("formatValue spaces units", () => {
    expect(formatValue(1500, "GW")).toBe("1,500 GW");
    expect(formatValue(22, "%")).toBe("22%");
    expect(formatValue(0.6, "V")).toBe("0.6 V");
    expect(formatValue(-3.5, "°C")).toBe("−3.5 °C");
    expect(formatValue(1000)).toBe("1,000");
  });

  it("attaches degree, prime and double prime directly", () => {
    expect(formatValue(90, "°")).toBe("90°");
    expect(formatValue(5, "′")).toBe("5′");
    expect(formatValue(7, "″")).toBe("7″");
  });

  it("never prints a negative zero", () => {
    expect(formatValue(-0.001)).toBe("0");
  });

  it("no tick label glues a digit to a letter", () => {
    const svg = chartSvg(solar, { title: "Global solar capacity" });
    for (const t of texts(svg)) expect(t).not.toMatch(/\d[A-Za-z]/);
  });
});

describe("donutSlices", () => {
  it("returns the input as-is at or below the limit", () => {
    expect(donutSlices(["a", "b"], [1, 2])).toEqual([
      { label: "a", value: 1 },
      { label: "b", value: 2 },
    ]);
  });

  it("keeps the largest max-1 and folds the rest into Other", () => {
    const labels = ["a", "b", "c", "d", "e", "f", "g"];
    const out = donutSlices(labels, [1, 7, 2, 6, 3, 5, 4]);
    expect(out.map((s) => s.label)).toEqual(["b", "d", "f", "g", "e", "Other"]);
    expect(out.at(-1)!.value).toBe(3);
  });
});

describe("chartSvg", () => {
  it("bar with 3 labels x 2 series has 6 rects in the plot group", () => {
    expect(count(plotOf(chartSvg(bar, { title: "T" })), "<rect")).toBe(6);
  });

  it("single-series bar shows direct value labels", () => {
    const svg = chartSvg(solar, { title: "T" });
    const values = [...svg.matchAll(/<text class="df-value"[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
    expect(values).toHaveLength(4);
    expect(values.at(-1)).toBe("1,420 GW");
  });

  it("omits direct value labels for multiple series or more than 8 points", () => {
    expect(chartSvg(bar, { title: "T" })).not.toContain("df-value");
    const many = Array.from({ length: 9 }, (_, i) => String(i));
    const svg = chartSvg({ ...bar, labels: many, series: [{ name: "s", values: many.map(Number) }] }, { title: "T" });
    expect(svg).not.toContain("df-value");
  });

  it("bar marks use graphic colours only", () => {
    for (const block of [bar, solar]) {
      const marks = fills(plotOf(chartSvg(block, { title: "T" })));
      expect(marks.length).toBeGreaterThan(0);
      for (const f of marks) expect(f).toMatch(/^var\(--df-graphic-[1-6]\)$/);
    }
  });

  it("shows a legend only for more than one series", () => {
    expect(chartSvg(bar, { title: "T" })).toContain(">s2</text>");
    expect(chartSvg(solar, { title: "T" })).not.toContain(">Installed capacity</text>");
  });

  it("draws the zero line in a graphic colour", () => {
    expect(chartSvg(bar, { title: "T" })).toContain("stroke:var(--df-graphic-3)");
  });

  it("negative values stay finite", () => {
    for (const kind of ["bar", "line", "area", "donut"] as const) {
      const svg = chartSvg({ ...bar, kind, series: [{ name: "s", values: [-5, 3, -1] }] }, { title: "T" });
      expect(svg, kind).not.toMatch(/NaN|Infinity/);
    }
  });

  it("bar baseline sits at the zero line so negatives go below it", () => {
    const svg = chartSvg({ ...bar, labels: ["a", "b"], series: [{ name: "s", values: [4, -4] }] }, { title: "T" });
    const rects = [...plotOf(svg).matchAll(/<rect x="[\d.]+" y="([\d.]+)" width="[\d.]+" height="([\d.]+)"/g)];
    expect(rects).toHaveLength(2);
    const [pos, neg] = rects.map((m) => ({ y: Number(m[1]), h: Number(m[2]) }));
    expect(neg!.y).toBeCloseTo(pos!.y + pos!.h, 1);
  });

  it("all-zero donut has no NaN", () => {
    const svg = chartSvg({ ...bar, kind: "donut", series: [{ name: "s", values: [0, 0, 0] }] }, { title: "T" });
    expect(svg).not.toMatch(/NaN|Infinity/);
  });

  it("handles empty data and single points without NaN", () => {
    for (const kind of ["bar", "line", "area", "donut"] as const) {
      expect(chartSvg({ ...bar, kind, labels: [], series: [] }, { title: "T" }), kind).not.toMatch(/NaN|Infinity/);
      expect(
        chartSvg({ ...bar, kind, labels: ["a"], series: [{ name: "s", values: [7] }] }, { title: "T" }),
        kind,
      ).not.toMatch(/NaN|Infinity/);
    }
  });

  it("donut with a single non-zero slice renders a full ring", () => {
    const svg = chartSvg({ ...bar, kind: "donut", series: [{ name: "s", values: [5, 0, 0] }] }, { title: "T" });
    expect(svg).not.toMatch(/NaN|Infinity/);
    expect(count(svg, "<path")).toBeGreaterThanOrEqual(1);
  });

  it("donut legend swatches match slices", () => {
    const svg = chartSvg(
      { ...bar, kind: "donut", labels: ["a", "b", "c", "d"], series: [{ name: "s", values: [4, 3, 2, 1] }] },
      { title: "T" },
    );
    const slices = new Set(fills(plotOf(svg)));
    const legendGroup = /<g class="df-legend">([\s\S]*?)<\/g>/.exec(svg)![1]!;
    const legend = new Set([...legendGroup.matchAll(/<rect[^>]*fill:([^;"]+)/g)].map((m) => m[1]!));
    expect(slices.size).toBe(4);
    expect(legend).toEqual(slices);
    for (const m of svg.matchAll(/fill-opacity:\s*([\d.]+)/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(1);
  });

  it("donut with 10 labels aggregates into Other", () => {
    const labels = Array.from({ length: 10 }, (_, i) => `L${i}`);
    const values = labels.map((_, i) => 10 - i);
    const svg = chartSvg({ ...bar, kind: "donut", labels, series: [{ name: "s", values }] }, { title: "T" });
    expect(count(plotOf(svg), "<path")).toBe(6);
    const legend = /<g class="df-legend">([\s\S]*?)<\/g>/.exec(svg)![1]!;
    const rows = texts(legend);
    expect(rows).toHaveLength(6);
    expect(rows.at(-1)!.startsWith("Other")).toBe(true);
    expect(rows.at(-1)).toContain(formatValue(5 + 4 + 3 + 2 + 1));
  });

  it("text sizes meet the 22 px floor", () => {
    for (const block of [bar, solar, { ...bar, kind: "donut" as const }, { ...bar, kind: "line" as const }]) {
      const sizes = [...chartSvg(block, { title: "T" }).matchAll(/font:\s*([\d.]+)px/g)].map((m) => Number(m[1]));
      expect(sizes.length).toBeGreaterThan(0);
      for (const s of sizes) expect(s).toBeGreaterThanOrEqual(22);
    }
  });

  it("line and area draw one path per series in the plot group", () => {
    for (const kind of ["line", "area"] as const) {
      expect(count(plotOf(chartSvg({ ...bar, kind }, { title: "T" })), "<path"), kind).toBe(2);
    }
  });

  it("escapes labels, series names, unit and title", () => {
    const svg = chartSvg(
      { ...bar, labels: ["<script>x</script>", "b", "c"], series: [{ name: "<i>", values: [1, 2, 3] }], unit: "<u>" },
      { title: 'a "t" <b>' },
    );
    expect(svg).not.toContain("<script>");
    expect(svg).not.toContain("<i>");
    expect(svg).not.toContain("<u>");
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).toContain('aria-label="a &quot;t&quot; &lt;b&gt;"');
  });

  it("has role img and title", () => {
    const svg = chartSvg(bar, { title: "Revenue" });
    expect(svg).toContain('viewBox="0 0 1600 640"');
    expect(svg).toContain('role="img"');
    expect(svg).toContain('aria-label="Revenue"');
    expect(svg).toContain("<title>Revenue</title>");
  });

  it("uses only theme variables for colour", () => {
    for (const kind of ["bar", "line", "area", "donut"] as const) {
      const svg = chartSvg({ ...bar, kind }, { title: "T" });
      expect(svg, kind).not.toMatch(/#[0-9a-f]{3,6}\b/i);
      for (const f of fills(svg)) expect(f, kind).toMatch(/^(var\(--df-[a-z0-9-]+\)|none)$/);
    }
    const svg = chartSvg(bar, { title: "T" });
    expect(svg).toContain("var(--df-graphic-1)");
    expect(svg).toContain("var(--df-graphic-2)");
  });
});
