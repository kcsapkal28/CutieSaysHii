import type { Block } from "@deckforge/schemas";
import { describe, expect, it } from "vitest";
import { highlightCode } from "../src/blocks/code.ts";
import { emphasize, escapeHtml } from "../src/blocks/escape.ts";
import { sha256Hex } from "../src/blocks/hash.ts";
import { placeholderImageSvg } from "../src/blocks/image.ts";
import { diagramKey, renderBlock, type BlockContext } from "../src/blocks/render.ts";

type ImageBlock = Extract<Block, { type: "Image" }>;

const count = (s: string, needle: string) => s.split(needle).length - 1;
const ctx = (patch: Partial<BlockContext> = {}): BlockContext => ({
  emphasis: [],
  fragments: false,
  diagrams: new Map(),
  ...patch,
});

describe("escapeHtml / sha256", () => {
  it("escapes & < > \" '", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });

  it("sha256Hex matches known vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("é".repeat(40))).toHaveLength(64);
  });
});

describe("emphasize", () => {
  it("escapes <b> in text", () => {
    expect(emphasize("a <b> c", [])).toBe("a &lt;b&gt; c");
  });

  it('marks "C++" literally', () => {
    expect(emphasize("I like C++ a lot", ["C++"])).toBe(
      'I like <mark class="df-emph" data-emphasis>C++</mark> a lot',
    );
  });

  it("skips a missing target", () => {
    expect(emphasize("hello", ["nope", ""])).toBe("hello");
  });

  it("drops an overlapping target", () => {
    const out = emphasize("solar cell", ["solar cell", "cell"]);
    expect(count(out, "<mark")).toBe(1);
  });

  it("never nests marks when a later target starts inside an earlier one", () => {
    const out = emphasize("abcdef", ["cdef", "abcd"]);
    expect(count(out, "<mark")).toBe(1);
    expect(out).toContain(">abcd</mark>ef");
  });

  it("is case-insensitive but preserves original case", () => {
    expect(emphasize("Solar Power", ["solar"])).toBe('<mark class="df-emph" data-emphasis>Solar</mark> Power');
  });

  it("matches targets containing HTML chars against raw text", () => {
    expect(emphasize("use <b> tags", ["<b>"])).toBe(
      'use <mark class="df-emph" data-emphasis>&lt;b&gt;</mark> tags',
    );
  });

  it("treats regex metacharacters literally", () => {
    expect(emphasize("f(1) = 2", ["(1)"])).toBe('f<mark class="df-emph" data-emphasis>(1)</mark> = 2');
  });
});

describe("placeholderImageSvg", () => {
  const img: ImageBlock = { type: "Image", prompt: "a sunrise over hills", alt: 'x "y" <z>' };

  it("is deterministic and escapes alt", () => {
    const a = placeholderImageSvg(img);
    expect(placeholderImageSvg(img)).toBe(a);
    expect(placeholderImageSvg({ ...img, prompt: "another" })).not.toBe(a);
    expect(a).toContain('role="img"');
    expect(a).toContain('aria-label="x &quot;y&quot; &lt;z&gt;"');
    expect(a).not.toContain("<z>");
    expect(a).not.toMatch(/#[0-9a-f]{3,6}\b/i);
    expect(a).not.toMatch(/NaN|Infinity/);
  });
});

describe("highlightCode", () => {
  it("unknown lang does not throw", () => {
    const out = highlightCode("klingon", "a < b\nsecond");
    expect(out).toContain("a &lt; b");
    expect(count(out, 'class="df-line"')).toBe(2);
  });

  it("marks highlightLines [2]", () => {
    const out = highlightCode("ts", "let a = 1;\nlet b = 2;\nlet c = 3;", [2]);
    expect(count(out, "data-df-highlight")).toBe(1);
    expect(out).toMatch(/data-line="2"[^>]*data-df-highlight|data-df-highlight[^>]*data-line="2"/);
  });

  it("closes and reopens token spans across lines", () => {
    const out = highlightCode("js", "/* a\nb */\nlet x;");
    const lines = out.split("\n");
    for (const l of lines) expect(count(l, "<span"), l).toBe(count(l, "</span>"));
    expect(lines).toHaveLength(3);
  });

  it("highlights known languages via aliases", () => {
    expect(highlightCode("ts", "const x: number = 1;")).toContain("hljs-keyword");
    expect(highlightCode("py", "def f(): pass")).toContain("hljs-");
  });
});

describe("renderBlock", () => {
  const fixtures: Block[] = [
    { type: "Bullets", items: ["a"] },
    { type: "Paragraph", text: "t" },
    { type: "Stat", value: "42%", label: "l", trend: "up" },
    { type: "Quote", text: "t", attribution: "a" },
    { type: "Diagram", mermaid: "graph TD; A-->B", hotspots: [{ nodeId: "A", label: "l", detail: "d" }] },
    { type: "Chart", kind: "line", labels: ["a", "b", "c"], series: [{ name: "s", values: [1, 2, 3] }], unit: "%" },
    { type: "Compare", leftTitle: "l", rightTitle: "r", rows: [{ left: "a", right: "b" }] },
    { type: "Timeline", steps: [{ label: "l", detail: "d", date: "2026" }] },
    { type: "Code", lang: "ts", code: "let x = 1;", highlightLines: [1] },
    { type: "Image", prompt: "p", alt: "a" },
    { type: "Quiz", question: "q", options: ["a", "b", "c"], answerIndex: 0, explanation: "e" },
  ];

  it("covers every block kind", () => {
    expect(new Set(fixtures.map((f) => f.type)).size).toBe(11);
    for (const f of fixtures) {
      expect(renderBlock(f, ctx()).length, f.type).toBeGreaterThan(0);
    }
  });

  it("bullets get .fragment when ctx.fragments", () => {
    const b: Block = { type: "Bullets", items: ["a", "b"] };
    expect(count(renderBlock(b, ctx({ fragments: true })), 'class="fragment"')).toBe(2);
    expect(renderBlock(b, ctx())).not.toContain("fragment");
  });

  it("applies emphasis and escaping to visible text", () => {
    const out = renderBlock(
      { type: "Quiz", question: "Is <b> bold?", options: ["yes", "no"], answerIndex: 0, explanation: "see <b>" },
      ctx({ emphasis: ["<b>"] }),
    );
    expect(out).not.toContain("<b>");
    expect(count(out, "<mark")).toBe(2);
  });

  it("escapes hostile text in every text-bearing block", () => {
    const evil = "</section><script>alert(1)</script>";
    const blocks: Block[] = [
      { type: "Bullets", items: [evil] },
      { type: "Paragraph", text: evil },
      { type: "Stat", value: evil, label: evil, trend: "down" },
      { type: "Quote", text: evil, attribution: evil },
      { type: "Compare", leftTitle: evil, rightTitle: evil, rows: [{ left: evil, right: evil }] },
      { type: "Timeline", steps: [{ label: evil, detail: evil, date: evil }] },
      { type: "Code", lang: evil, code: evil },
      { type: "Image", prompt: evil, alt: evil },
      { type: "Quiz", question: evil, options: [evil], answerIndex: 0, explanation: evil },
      { type: "Diagram", mermaid: evil },
      { type: "Chart", kind: "bar", labels: [evil], series: [{ name: evil, values: [1] }], unit: evil },
    ];
    for (const b of blocks) {
      const out = renderBlock(b, ctx());
      expect(out, b.type).not.toContain("<script>");
      expect(out, b.type).not.toContain("</section>");
    }
  });

  it("diagram without svg renders escaped fallback", () => {
    const out = renderBlock({ type: "Diagram", mermaid: "graph TD; A-->" }, ctx());
    expect(out).toBe(
      '<figure class="df-diagram"><pre class="df-diagram-fallback">graph TD; A--&gt;</pre></figure>',
    );
  });

  it("diagram with svg embeds it", () => {
    const src = "graph TD; A-->B";
    const svg = "<svg><title>d</title></svg>";
    const out = renderBlock({ type: "Diagram", mermaid: src }, ctx({ diagrams: new Map([[diagramKey(src), svg]]) }));
    expect(out).toBe(`<figure class="df-diagram">${svg}</figure>`);
  });

  it("diagramKey is the first 16 hex chars of sha256", () => {
    expect(diagramKey("abc")).toBe("ba7816bf8f01cfea");
  });
});
