import { describe, expect, it } from "vitest";
import { locate, newBlockText, parseBlocks, parseInline, replaceBlockText, snapRange, splice } from "./research-md";

const DOC = [
  "# Research: Coral reefs",
  "",
  "## Summary",
  "",
  "Reefs are built by **coral polyps** over",
  "thousands of years [1].",
  "",
  "## Numbers",
  "",
  "- **~25%**: share of marine species that use reefs [2]",
  "  * nested note with `code`",
  "1. Larvae settle",
  "2. Polyps divide",
  "",
  "## Sources",
  "",
  "- [Reef survey](https://example.org/reefs) (web): the survey",
  "- Marine biology textbook (model-knowledge)",
  "",
].join("\n");

const text = (b: { contentStart: number; end: number }) => DOC.slice(b.contentStart, b.end);

describe("parseBlocks", () => {
  it("maps headings, multi-line paragraphs and list items to exact source ranges", () => {
    const blocks = parseBlocks(DOC);
    expect(blocks.map((b) => [b.kind, text(b)])).toEqual([
      ["heading", "Research: Coral reefs"],
      ["heading", "Summary"],
      ["para", "Reefs are built by **coral polyps** over\nthousands of years [1]."],
      ["heading", "Numbers"],
      ["item", "**~25%**: share of marine species that use reefs [2]"],
      ["item", "nested note with `code`"],
      ["item", "Larvae settle"],
      ["item", "Polyps divide"],
      ["heading", "Sources"],
      ["item", "[Reef survey](https://example.org/reefs) (web): the survey"],
      ["item", "Marine biology textbook (model-knowledge)"],
    ]);
    expect(blocks[0]!.level).toBe(1);
    expect(blocks[5]!.marker).toBe("  * ");
    expect(blocks[6]).toMatchObject({ ordered: true, marker: "1. " });
    for (const b of blocks) expect(DOC.slice(b.start, b.contentStart)).toMatch(/^(#{1,3} |\s*(?:[-*]|\d+\.) |)$/);
  });

  it("keeps an emptied item a valid range", () => {
    const [b] = parseBlocks("- \n");
    expect(b).toMatchObject({ kind: "item", contentStart: 2, end: 2 });
  });
});

describe("parseInline", () => {
  it("covers the range and points each token's visible text at its source", () => {
    const b = parseBlocks(DOC)[9]!;
    const tokens = parseInline(DOC, b.contentStart, b.end);
    expect(tokens.map((t) => t.kind)).toEqual(["link", "text"]);
    expect(tokens[0]).toMatchObject({ text: "Reef survey", href: "https://example.org/reefs" });
    for (const t of tokens) expect(DOC.slice(t.textStart, t.textStart + t.text.length)).toBe(t.text);
    expect(tokens.map((t) => DOC.slice(t.start, t.end)).join("")).toBe(text(b));
  });

  it("recognises bold, em, code and citations", () => {
    const s = "A **b** *c* `d` [3] [1, 2] e";
    expect(parseInline(s, 0, s.length).map((t) => `${t.kind}:${t.text}`)).toEqual([
      "text:A ",
      "strong:b",
      "text: ",
      "em:c",
      "text: ",
      "code:d",
      "text: ",
      "cite:3",
      "text: ",
      "cite:1, 2",
      "text: e",
    ]);
  });
});

describe("snapRange", () => {
  it("widens ends inside a formatted token to the whole token and trims whitespace", () => {
    const from = DOC.indexOf("ral polyps");
    const to = DOC.indexOf("over") + 4;
    const r = snapRange(DOC, from - 1, to + 1)!;
    expect(DOC.slice(r.start, r.end)).toBe("**coral polyps** over");
  });

  it("never splits a link, so its URL survives a replacement", () => {
    const from = DOC.indexOf("survey](");
    const r = snapRange(DOC, from, from + 3)!;
    expect(DOC.slice(r.start, r.end)).toBe("[Reef survey](https://example.org/reefs)");
  });

  it("returns null for a whitespace-only selection and accepts reversed ends", () => {
    const blank = DOC.indexOf("\n\n");
    expect(snapRange(DOC, blank, blank + 2)).toBeNull();
    const a = DOC.indexOf("Larvae");
    expect(snapRange(DOC, a + 6, a)).toEqual({ start: a, end: a + 6 });
  });
});

describe("splice / locate", () => {
  it("replaces only the passage and leaves the rest byte-for-byte", () => {
    const passage = "share of marine species that use reefs";
    const start = DOC.indexOf(passage);
    const next = splice(DOC, start, start + passage.length, "share of marine species (about a quarter) that depend on reefs");
    expect(next.slice(0, start)).toBe(DOC.slice(0, start));
    expect(next.slice(next.length - (DOC.length - start - passage.length))).toBe(DOC.slice(start + passage.length));
  });

  it("finds a passage that moved, and refuses one that changed or is ambiguous", () => {
    const passage = "Larvae settle";
    const start = DOC.indexOf(passage);
    expect(locate(DOC, passage, start)).toEqual({ start, end: start + passage.length });
    const moved = `Intro line.\n${DOC}`;
    expect(locate(moved, passage, start)).toEqual({ start: start + 12, end: start + 12 + passage.length });
    expect(locate(DOC.replace("Larvae", "Eggs"), passage, start)).toBeNull();
    expect(locate(`${DOC}\n${passage}\n`, passage, start + 3)).toBeNull();
  });
});

describe("block edits", () => {
  it("replaces a block's text and removes an emptied block with its line", () => {
    const blocks = parseBlocks(DOC);
    const item = blocks[6]!;
    expect(replaceBlockText(DOC, item, "Larvae drift, then settle")).toBe(DOC.replace("1. Larvae settle", "1. Larvae drift, then settle"));
    expect(replaceBlockText(DOC, item, "  ")).toBe(DOC.replace("1. Larvae settle\n", ""));
  });

  it("continues lists with the next marker and splits other blocks into a new paragraph", () => {
    const blocks = parseBlocks(DOC);
    expect(newBlockText(blocks[4]!)).toBe("\n- ");
    expect(newBlockText(blocks[5]!)).toBe("\n  * ");
    expect(newBlockText(blocks[7]!)).toBe("\n3. ");
    expect(newBlockText(blocks[2]!)).toBe("\n\n");
  });
});
