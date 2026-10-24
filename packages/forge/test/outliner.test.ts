import { describe, expect, it } from "vitest";
import { renderResearch, researchItems, runOutline } from "../src/agents/outliner.ts";
import { researchToMarkdown } from "../src/agents/researcher.ts";
import { Brief, Research } from "../src/agents/schemas.ts";
import { Style } from "../src/contract.ts";
import type { WireRequest } from "../src/llm.ts";
import { arcOut, cardOut, fakeLlm, researchOut, styleOut } from "./fakes.ts";

const research = Research.parse(researchOut);
const md = researchToMarkdown("Active noise cancellation", research);

describe("research items", () => {
  it("splits the notes into labelled items: bullets, paragraphs and whole ### blocks", () => {
    const items = researchItems(md);
    expect(items[0]).toEqual({ id: "R1", section: "Summary", text: "ANC adds an inverted copy of noise." });
    expect(items[1]).toMatchObject({ id: "R2", section: "Key facts", text: "**Fact 0** Detail." });
    const feedforward = items.find((i) => i.text.startsWith("Feedforward"))!;
    expect(feedforward).toMatchObject({ id: "R10", section: "Mechanisms" });
    expect(feedforward.text).toContain("Outer mic predicts.");
    expect(feedforward.text).toContain("3. play");
    expect(items.at(-1)).toMatchObject({ section: "Sources" });

    const some = renderResearch(items, new Set(["R1", "R10"]));
    expect(some).toBe(`## Summary\n[R1] ANC adds an inverted copy of noise.\n\n## Mechanisms\n[R10] ${feedforward.text}`);
  });

  it("copes with free-form markdown (presenter edits)", () => {
    const items = researchItems("Some intro line\nthat wraps.\n\n* one\n  continued\n2) two\n\n### Block\ntext\n\nmore");
    expect(items.map((i) => i.text)).toEqual(["Some intro line\nthat wraps.", "one\n  continued", "2) two", "Block\ntext\n\nmore"]);
  });
});

describe("per-card context", () => {
  // A realistic research size (~10k characters, like a real run) and the real technique catalogue.
  const big: Research = {
    ...research,
    keyFacts: Array.from({ length: 12 }, (_, i) => ({ fact: `Fact ${i}`, detail: `Detail ${i}: ${"a concrete detail with a number and a date ".repeat(4)}` })),
    numbers: Array.from({ length: 10 }, (_, i) => ({ value: `${i * 7} units`, what: `measure ${i}`, context: "context ".repeat(8) })),
    mechanisms: Array.from({ length: 3 }, (_, i) => ({ name: `Mechanism ${i}`, howItWorks: "how it works ".repeat(8), steps: Array.from({ length: 6 }, (_, k) => `step ${k} ${"of the chain ".repeat(3)}`) })),
  };
  const brief = Brief.parse({ topic: "A topic", audience: "students", minutes: 4, createdAt: "now" });
  const style = Style.parse({ look: "x", theme: { colors: styleOut().colors, fonts: styleOut().fonts }, motion: "rich", use3d: true, interactivity: 2, density: "balanced", features: {} });
  const cardOf = (req: WireRequest) => /Write the card for (s\d\d)/.exec(JSON.stringify(req.messages[0]))![1]!;

  async function run(cardContext: "slim" | "full") {
    const llm = fakeLlm({ plan_arc: () => arcOut(), write_card: (req) => cardOut(cardOf(req)) });
    await runOutline(llm, { brief, style, researchMd: researchToMarkdown("A topic", big) }, { cardContext });
    const card = llm.requests.find((r) => r.tools?.[0]?.name === "write_card" && cardOf(r) === "s02")!;
    const user = (card.messages[0]!.content[0] as { text: string }).text;
    // The deck context is a cached system block now; the user turn holds only the card's own brief.
    const system = typeof card.system === "string" ? card.system : card.system.map((b) => b.text).join("\n");
    return { system, user, size: system.length + user.length };
  }

  it("sends a card only its own technique entry and the research items the arc chose, at well under half the size", async () => {
    const slim = await run("slim");
    const full = await run("full");
    // s02 is a parametric-sim slide pointed at R9 and R10.
    expect(slim.user).toContain("## `parametric-sim`");
    expect(slim.user).not.toContain("## `particle-flow`");
    expect(slim.system).not.toContain("# Technique catalogue");
    expect(slim.user).toContain("[R1] ANC adds an inverted copy of noise.");
    expect(slim.user).toContain("[R9] ");
    expect(slim.user).toContain("[R10] ");
    expect(slim.user).not.toContain("[R2] ");
    expect(slim.user).not.toContain("Mechanism 2");
    expect(slim.system).toContain("## The visual bar");

    expect(full.system).toContain("# Technique catalogue");
    expect(full.system).toContain("Mechanism 2");
    expect(slim.size).toBeLessThan(full.size * 0.5);
    expect(slim.size).toBeLessThan(13_000);
  });
});

describe("parseSteps", () => {
  it("turns 'beat — motion' lines into step objects", async () => {
    const { parseSteps } = await import("../src/agents/outliner.ts");
    expect(parseSteps("1. Tokens reach the gate — slide right, 0.8 s\n- All gates lit | none\nPlain beat")).toEqual([
      { beat: "Tokens reach the gate", motion: "slide right, 0.8 s" },
      { beat: "All gates lit", motion: "none" },
      { beat: "Plain beat", motion: "none" },
    ]);
  });
});
