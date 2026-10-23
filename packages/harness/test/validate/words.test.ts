import type { Slide } from "@deckforge/schemas";
import { describe, expect, it } from "vitest";
import { countWords, visibleWords } from "../../src/validate/words.ts";

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
      ],
      { title: "A title" },
    );
    // title 2 + bullets 3 + stat 3 + compare 3 + 3 = 14
    expect(visibleWords(s)).toBe(14);
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

  it("a slide without a title counts only its body", () => {
    expect(visibleWords(slide([{ type: "Paragraph", text: "just three words" }]))).toBe(3);
  });
});
