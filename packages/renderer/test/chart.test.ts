import { readFileSync } from "node:fs";
import type { Block, DeckSpec } from "@deckforge/schemas";
import { describe, expect, it } from "vitest";
import { chartSvg, donutSlices, formatValue, labelPrecision, niceTicks } from "../src/blocks/chart.ts";

type ChartBlock = Extract<Block, { type: "Chart" }>;

const count = (s: string, needle: string) => s.split(needle).length - 1;
const plotOf = (svg: string) => /<g class="df-plot">([\s\S]*?)<\/g>/.exec(svg)?.[1] ?? "";
const texts = (svg: string) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]!);
const fills = (s: string) => [...s.matchAll(/fill:([^;"]+)/g)].map((m) => m[1]!);
const unescape = (s: string) => s.replace(/&lt;|&gt;|&quot;|&#39;|&amp;/g, " ");

type Box = { cls: string; body: string; size: number; x0: number; x1: number; y0: number; y1: number };
// Approximate text boxes: 0.6em per character, ascent 0.8em, descent 0.2em.
const boxes = (svg: string): Box[] =>
  [
    ...svg.matchAll(
      /<text(?: class="([^"]*)")? x="([-\d.]+)" y="([-\d.]+)" text-anchor="(\w+)" style="[^"]*font:([\d.]+)px[^"]*">([^<]*)<\/text>/g,
    ),
  ].map((m) => {
    const [x, y, size] = [Number(m[2]), Number(m[3]), Number(m[5])];
    const body = unescape(m[6]!);
    const w = body.length * size * 0.6;
    const x0 = m[4] === "end" ? x - w : m[4] === "middle" ? x - w / 2 : x;
    return { cls: m[1] ?? "", body, size, x0, x1: x0 + w, y0: y - size * 0.8, y1: y + size * 0.2 };
  });
const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

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

  it("prefixes currency symbols without a space and trims the unit", () => {
    expect(formatValue(1234.567, "$")).toBe("$1,234.57");
    expect(formatValue(-5, "$")).toBe("\u2212$5");
    expect(formatValue(3, "€")).toBe("€3");
    expect(formatValue(3, "£")).toBe("£3");
    expect(formatValue(3, "¥")).toBe("¥3");
    expect(formatValue(3, " GW ")).toBe("3 GW");
    expect(formatValue(3, " % ")).toBe("3%");
    expect(formatValue(3, "  ")).toBe("3");
  });

  it("uses compact notation when asked", () => {
    expect(formatValue(1_234_567, undefined, { compact: true })).toBe("1.2M");
    expect(formatValue(3e9, "$", { compact: true })).toBe("$3B");
    expect(formatValue(-2.5e8, "W", { compact: true })).toBe("\u2212250M W");
  });

  it("shows more fraction digits when asked", () => {
    expect(formatValue(0.0014, "V", { decimals: 4 })).toBe("0.0014 V");
  });

  it("never prints a negative zero", () => {
    expect(formatValue(-0.001)).toBe("0");
  });

  it("no tick label glues a digit to a letter", () => {
    const svg = chartSvg(solar, { title: "Global solar capacity" });
    for (const t of texts(svg)) expect(t).not.toMatch(/\d[A-Za-z]/);
  });
});

describe("labelPrecision", () => {
  it("uses at least 2 digits plain and 1 compact, more when the numbers need them", () => {
    expect(labelPrecision([0, 500, 1000], false)).toBe(2);
    expect(labelPrecision([0, 0.025, 0.125], false)).toBe(3);
    expect(labelPrecision([1e6, 2e9], true)).toBe(1);
    expect(labelPrecision([250_000, 1.25e6], true)).toBe(2);
    expect(labelPrecision([1.234e6], true)).toBe(3);
  });

  it("caps at 6", () => {
    expect(labelPrecision([1 / 3], false)).toBe(6);
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

  it("ignores zero and negative values", () => {
    expect(donutSlices(["a", "b", "c"], [3, -4, 0])).toEqual([{ label: "a", value: 3 }]);
    const labels = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const out = donutSlices(labels, [8, 7, 6, 5, 4, 3, 0, -4]);
    expect(out.map((s) => s.label)).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(out.some((s) => s.label === "Other" || s.value <= 0)).toBe(false);
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

  it("negative direct labels never overlap category labels", () => {
    for (const values of [[-5, -10], [4, -10], [-1420, 30, -7]]) {
      const labels = values.map((_, i) => "abc"[i]!);
      const svg = chartSvg({ ...bar, labels, series: [{ name: "s", values }], unit: "%" }, { title: "T" });
      const all = boxes(svg);
      const valueBoxes = all.filter((b) => b.cls === "df-value");
      const categories = all.filter((b) => b.size === 26);
      expect(valueBoxes).toHaveLength(values.length);
      expect(categories).toHaveLength(values.length);
      for (const v of valueBoxes) for (const c of categories) expect(overlaps(v, c), `${v.body} vs ${c.body}`).toBe(false);
    }
  });

  it("direct labels never sit on a bar", () => {
    const svg = chartSvg({ ...bar, labels: ["a", "b"], series: [{ name: "s", values: [-5, 8] }] }, { title: "T" });
    const rects = [...plotOf(svg).matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)].map(
      (m) => ({ x0: Number(m[1]), y0: Number(m[2]), x1: Number(m[1]) + Number(m[3]), y1: Number(m[2]) + Number(m[4]) }),
    );
    for (const v of boxes(svg).filter((b) => b.cls === "df-value")) {
      for (const r of rects) expect(overlaps(v, { ...v, ...r }), v.body).toBe(false);
    }
  });

  it("large values use compact labels that fit inside the left edge", () => {
    const svg = chartSvg(
      { ...bar, labels: ["a", "b"], series: [{ name: "s", values: [1e9, 2.5e8] }], unit: "USD" },
      { title: "T" },
    );
    const ticks = boxes(svg).filter((b) => b.cls === "" && b.size === 24);
    expect(ticks.map((b) => b.body)).toContain("1B USD");
    for (const b of boxes(svg)) expect(b.x0, b.body).toBeGreaterThanOrEqual(0);
    const values = boxes(svg).filter((b) => b.cls === "df-value").map((b) => b.body);
    expect(values).toEqual(["1B USD", "250M USD"]);
  });

  it("long tick labels widen the left margin", () => {
    const svg = chartSvg(
      { ...bar, labels: ["a"], series: [{ name: "s", values: [400_000] }], unit: "kWh/year" },
      { title: "T" },
    );
    for (const b of boxes(svg)) expect(b.x0, b.body).toBeGreaterThanOrEqual(0);
  });

  it("tiny ranges get distinct, correct tick labels", () => {
    const svg = chartSvg({ ...bar, labels: ["a", "b"], series: [{ name: "s", values: [0.001, 0.002] }], unit: "V" }, { title: "T" });
    const ticks = boxes(svg).filter((b) => b.cls === "" && b.size === 24).map((b) => b.body);
    expect(ticks).toEqual(["0 V", "0.0005 V", "0.001 V", "0.0015 V", "0.002 V"]);
  });

  it("tiny bar values are not rounded to zero", () => {
    const svg = chartSvg({ ...bar, labels: ["a", "b"], series: [{ name: "s", values: [0.001, 0.0014] }] }, { title: "T" });
    const values = boxes(svg).filter((b) => b.cls === "df-value").map((b) => b.body);
    expect(values).toEqual(["0.001", "0.0014"]);
  });

  const tickBodies = (block: ChartBlock) =>
    boxes(chartSvg(block, { title: "T" }))
      .filter((b) => b.cls === "" && b.size === 24)
      .map((b) => b.body);
  const valueBodies = (block: ChartBlock) =>
    boxes(chartSvg(block, { title: "T" }))
      .filter((b) => b.cls === "df-value")
      .map((b) => b.body);

  it("compact tick labels keep the digits their step needs", () => {
    expect(tickBodies({ ...bar, labels: ["a", "b"], series: [{ name: "s", values: [1.1e6, 4e5] }] })).toEqual([
      "0",
      "250K",
      "500K",
      "750K",
      "1M",
      "1.25M",
    ]);
    const billions = tickBodies({ ...bar, labels: ["a", "b"], series: [{ name: "s", values: [1.1e9, 4e8] }], unit: "$" });
    expect(billions).toContain("$1.25B");
    expect(billions).not.toContain("$1.3B");
  });

  it("compact value labels stay distinct", () => {
    const values = valueBodies({ ...bar, labels: ["a", "b"], series: [{ name: "s", values: [1.04e6, 1e6] }] });
    expect(values).toHaveLength(2);
    expect(new Set(values).size).toBe(2);
    expect(values).toEqual(["1.04M", "1M"]);
  });

  it("close compact direct labels stay distinct", () => {
    const values = valueBodies({ ...bar, labels: ["a", "b"], series: [{ name: "s", values: [1.234e6, 1.231e6] }] });
    expect(values).toEqual(["1.234M", "1.231M"]);
  });

  const donutRows = (values: number[]) => {
    const svg = chartSvg({ ...bar, kind: "donut", labels: ["a", "b"], series: [{ name: "s", values }] }, { title: "T" });
    const rows = texts(/<g class="df-legend">([\s\S]*?)<\/g>/.exec(svg)![1]!);
    const centre = boxes(svg).find((b) => b.size === 40)!.body;
    return { rows, centre };
  };

  it("donut compact legend and centre keep the digits their values need", () => {
    expect(donutRows([1.25e6, 2.5e6])).toEqual({ rows: ["a: 1.25M", "b: 2.5M"], centre: "3.75M" });
  });

  it("donut compact legend values stay distinct", () => {
    const { rows } = donutRows([1.04e6, 1e6]);
    expect(rows).toEqual(["a: 1.04M", "b: 1M"]);
  });

  it("2.5-steps below one keep their third decimal", () => {
    const ticks = tickBodies({ ...bar, labels: ["a", "b"], series: [{ name: "s", values: [0.11, 0.03] }], unit: "%" });
    expect(ticks).toContain("0.025%");
    expect(ticks).toContain("0.125%");
    expect(ticks).not.toContain("0.03%");
    expect(ticks).not.toContain("0.13%");
  });

  it("omits direct labels that are wider than their bar slot", () => {
    const labels = Array.from({ length: 8 }, (_, i) => `y${i}`);
    const values = labels.map((_, i) => (i % 2 ? -123_456.78 : -100_000));
    const svg = chartSvg({ ...bar, labels, series: [{ name: "s", values }], unit: "kWh/year" }, { title: "T" });
    const rects = [...plotOf(svg).matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)].map(
      (m) => ({ x0: Number(m[1]), y0: Number(m[2]), x1: Number(m[1]) + Number(m[3]), y1: Number(m[2]) + Number(m[4]) }),
    );
    expect(rects).toHaveLength(8);
    const valueBoxes = boxes(svg).filter((b) => b.cls === "df-value");
    for (const v of valueBoxes) for (const r of rects) expect(overlaps(v, { ...v, ...r }), v.body).toBe(false);
    expect(valueBoxes).toHaveLength(0);
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
    expect(rows.at(-1)).toBe("Other: 15");
  });

  it("donut drops zero and negative slices and never shows an empty Other", () => {
    const labels = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const svg = chartSvg(
      { ...bar, kind: "donut", labels, series: [{ name: "s", values: [8, 7, 6, 5, 4, 3, 0, -4] }] },
      { title: "T" },
    );
    const rows = texts(/<g class="df-legend">([\s\S]*?)<\/g>/.exec(svg)![1]!);
    expect(rows).toEqual(["a: 8", "b: 7", "c: 6", "d: 5", "e: 4", "f: 3"]);
    expect(svg).not.toContain("Other");
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
      const plot = plotOf(chartSvg({ ...bar, kind }, { title: "T" }));
      expect(count(plot, "<path") - count(plot, '<path class="df-decor"'), kind).toBe(2);
    }
  });

  it("the area wash is decoration and the only translucent mark", () => {
    const plot = plotOf(chartSvg({ ...bar, kind: "area" }, { title: "T" }));
    const washes = [...plot.matchAll(/<path class="df-decor"[^>]*>/g)].map((m) => m[0]);
    expect(washes).toHaveLength(2);
    for (const w of washes) expect(w).toContain("fill-opacity:0.2");
    const marks = plot.replace(/<path class="df-decor"[^>]*>/g, "");
    expect(marks).not.toContain("fill-opacity");
    expect(chartSvg({ ...bar, kind: "line" }, { title: "T" })).not.toContain("df-decor");
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
