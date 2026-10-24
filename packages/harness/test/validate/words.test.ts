import type { Block, Slide } from "@deckforge/schemas";
import { describe, expect, it } from "vitest";
import { countWords, emphasisTexts, visibleTexts, visibleWords } from "../../src/validate/words.ts";

const slide = (body: Slide["body"], extra: Partial<Slide> = {}): Slide => ({
  id: "s1",
  type: "bullets",
  body,
  notes: "these notes are long and never visible on the slide itself",
  emphasisTargets: [],
  ...extra,
});

describe("countWords", () => {
  it('countWords("  C++ is   fun ") === 3', () => {
    expect(countWords("  C++ is   fun ")).toBe(3);
  });

  it("empty and whitespace-only strings have no words", () => {
    expect(countWords("")).toBe(0);
    expect(countWords(" \n\t ")).toBe(0);
  });
});

describe("visibleWords", () => {
  it("visibleWords includes title/bullets/stat/compare, excludes notes/code/mermaid/image prompt", () => {
    const s = slide(
      [
        { type: "Bullets", items: ["one two", "three"] },
        { type: "Stat", value: "22%", label: "panel efficiency" },
        { type: "Compare", leftTitle: "Left side", rightTitle: "Right", rows: [{ left: "a b", right: "c" }] },
        { type: "Code", lang: "python", code: "print('many words in this code block')" },
        { type: "Diagram", mermaid: "graph LR\n  A[Lots of words] --> B[More words here]" },
        { type: "Image", prompt: "a very long generation prompt with many words", alt: "alt text words" },
        { type: "Paragraph", text: "caption" },
      ],
      { title: "A title" },
    );
    // title 2 + bullets 3 + stat 3 + compare 3 + 3 + caption 1 = 15 (alt is hidden behind the caption)
    expect(visibleWords(s)).toBe(15);
  });

  it("counts paragraph, quote + attribution, timeline, chart and quiz text", () => {
    const s = slide([
      { type: "Paragraph", text: "one two three" },
      { type: "Quote", text: "four five", attribution: "Six Seven" },
      { type: "Timeline", steps: [{ label: "eight", detail: "nine ten", date: "1954" }, { label: "x", detail: "y" }] },
      { type: "Chart", kind: "bar", labels: ["2010", "2015"], series: [{ name: "Installed capacity", values: [1, 2] }] },
      { type: "Quiz", question: "Why is it?", options: ["Because", "No idea"], answerIndex: 0, explanation: "hidden text" },
    ]);
    // paragraph 3 + quote 4 + timeline 4+2 + chart 2+2 + quiz 3+3 = 23
    expect(visibleWords(s)).toBe(23);
  });

  it("counts a chart's unit: the axis ticks and the footer print it", () => {
    const chart: Extract<Block, { type: "Chart" }> = { type: "Chart", kind: "bar", labels: ["2010"], series: [{ name: "capacity", values: [1] }] };
    expect(visibleWords(slide([chart]))).toBe(2);
    expect(visibleWords(slide([{ ...chart, unit: "GW" }]))).toBe(3);
    expect(visibleWords(slide([{ ...chart, unit: "million tonnes" }]))).toBe(4);
  });

  it("image alt is the caption when there is no Paragraph", () => {
    const image = { type: "Image", prompt: "long prompt words here", alt: "alt text words" } as const;
    expect(visibleWords(slide([image]))).toBe(3);
    expect(visibleWords(slide([image, { type: "Paragraph", text: "the caption" }]))).toBe(2);
  });

  it("the cover shows deck title, deck subtitle and slide title as meta", () => {
    const cover = slide([{ type: "Paragraph", text: "never rendered" }], { title: "Meta line" });
    expect(visibleTexts(cover, { title: "Deck title", subtitle: "Deck subtitle" })).toEqual(["Deck title", "Deck subtitle", "Meta line"]);
    expect(visibleTexts({ ...cover, title: "Deck title" }, { title: "Deck title", subtitle: "Sub" })).toEqual(["Deck title", "Sub"]);
  });

  it("a slide without a title counts only its body", () => {
    expect(visibleWords(slide([{ type: "Paragraph", text: "just three words" }]))).toBe(3);
  });
});

describe("emphasisTexts", () => {
  it("mirrors the renderer's emphasised fields", () => {
    const s = slide(
      [
        { type: "Bullets", items: ["b"] },
        { type: "Stat", value: "v", label: "l" },
        { type: "Compare", leftTitle: "lt", rightTitle: "rt", rows: [{ left: "cl", right: "cr" }] },
        { type: "Timeline", steps: [{ label: "tl", detail: "td", date: "tdate" }] },
        { type: "Chart", kind: "bar", labels: ["x"], series: [{ name: "series", values: [1] }] },
        { type: "Quiz", question: "q", options: ["o"], answerIndex: 0, explanation: "e" },
        { type: "Quote", text: "qt", attribution: "qa" },
        { type: "Paragraph", text: "p" },
        { type: "Image", prompt: "prompt", alt: "alt" },
      ],
      { title: "Title" },
    );
    expect(emphasisTexts(s)).toEqual(["b", "v", "l", "lt", "rt", "cl", "cr", "tdate", "tl", "td", "q", "o", "e", "qt", "qa", "p"]);
  });
});
