import { describe, expect, it } from "vitest";
import { refineResearch, researchSection } from "../src/agents/research-refiner.ts";
import { fakeLlm } from "./fakes.ts";

const brief = { topic: "How tides work", audience: "curious adults", minutes: 10 };
const md = [
  "# Research: How tides work",
  "",
  "## Summary",
  "",
  "Tides are the rise and fall of the sea caused mostly by the Moon's gravity [1].",
  "",
  "## Numbers",
  "",
  "- **12 h 25 min**: time between high tides (semidiurnal)",
  "- **~0.5 m**: open-ocean tidal range",
  "",
  "### Detail",
  "",
  "Spring tides happen near new and full moon.",
  "",
  "## Sources",
  "",
  "- Ocean physics textbook (model-knowledge)",
  "",
].join("\n");
const range = (s: string) => {
  const start = md.indexOf(s);
  return { start, end: start + s.length };
};
const userText = (llm: ReturnType<typeof fakeLlm>) => JSON.stringify(llm.requests[0]!.messages[0]);

describe("researchSection", () => {
  it("returns the level-2 section around the passage, including its subsections", () => {
    const { start, end } = range("open-ocean tidal range");
    const s = researchSection(md, start, end);
    expect(s.startsWith("## Numbers")).toBe(true);
    expect(s).toContain("Spring tides");
    expect(s).not.toContain("## Summary");
    expect(s).not.toContain("## Sources");
  });

  it("spans every section a multi-section passage touches", () => {
    const start = md.indexOf("Moon's gravity");
    const end = md.indexOf("12 h 25 min") + 5;
    const s = researchSection(md, start, end);
    expect(s.startsWith("## Summary")).toBe(true);
    expect(s).toContain("## Numbers");
    expect(s).not.toContain("## Sources");
  });

  it("cuts a long section to a window around the passage", () => {
    const long = `## A\n\n${"filler sentence. ".repeat(2000)}TARGET${" more filler.".repeat(2000)}\n`;
    const start = long.indexOf("TARGET");
    const s = researchSection(long, start, start + 6);
    expect(s).toContain("TARGET");
    expect(s.length).toBeLessThanOrEqual(6000);
  });
});

describe("refineResearch", () => {
  it("sends the brief, the passage, its section and the question, and returns the suggestion", async () => {
    const llm = fakeLlm({
      suggest_change: () => ({ answer: "Roughly right; it varies by basin.", replacement: "**~0.5 m** (varies by ocean basin): open-ocean tidal range" }),
    });
    const { start, end } = range("**~0.5 m**: open-ocean tidal range");
    const r = await refineResearch(llm, { brief, markdown: md, start, end, question: "  is this figure right?  " });

    expect(r).toMatchObject({
      answer: "Roughly right; it varies by basin.",
      passage: "**~0.5 m**: open-ocean tidal range",
      replacement: "**~0.5 m** (varies by ocean basin): open-ocean tidal range",
      changed: true,
    });
    const req = llm.requests[0]!;
    expect(req.model).toMatch(/sonnet/);
    expect(req.tool_choice).toEqual({ type: "auto" });
    expect(req.system).toMatch(/cannot browse/);
    expect(req.system).toMatch(/Never invent URLs/);
    const user = userText(llm);
    expect(user).toContain("How tides work");
    expect(user).toContain("curious adults");
    expect(user).toContain("<passage>\\n**~0.5 m**: open-ocean tidal range\\n</passage>");
    expect(user).toContain("is this figure right?\\n</question>");
    expect(user).toContain("## Numbers");
    expect(user).not.toContain("## Sources");
  });

  it("reports an unchanged passage as no change", async () => {
    const passage = "Spring tides happen near new and full moon.";
    const llm = fakeLlm({ suggest_change: () => ({ answer: "That is correct.", replacement: `${passage}\n` }) });
    const r = await refineResearch(llm, { brief, markdown: md, ...range(passage), question: "still true?" });
    expect(r.changed).toBe(false);
    expect(r.replacement).toBe(passage);
  });

  it("keeps the passage's own edge whitespace around the replacement", async () => {
    const passage = "- **12 h 25 min**: time between high tides (semidiurnal)\n- **~0.5 m**: open-ocean tidal range\n";
    const llm = fakeLlm({ suggest_change: () => ({ answer: "Simplified.", replacement: "\n- **12 h 25 min** between high tides\n- **~0.5 m** tidal range\n\n\n" }) });
    const r = await refineResearch(llm, { brief, markdown: md, ...range(passage), question: "simplify" });
    expect(r.replacement).toBe("- **12 h 25 min** between high tides\n- **~0.5 m** tidal range\n");
  });

  it("re-asks when a one-line passage gets a multi-line replacement", async () => {
    const llm = fakeLlm({
      suggest_change: (_req, n) =>
        n === 1 ? { answer: "Split it.", replacement: "Spring tides happen\n\nnear new moon." } : { answer: "Reworded.", replacement: "Spring tides come at new and full moon." },
    });
    const r = await refineResearch(llm, { brief, markdown: md, ...range("Spring tides happen near new and full moon."), question: "reword" });
    expect(llm.calls.suggest_change).toBe(2);
    expect(JSON.stringify(llm.requests[1]!.messages.at(-1))).toMatch(/must be one line/);
    expect(r.replacement).toBe("Spring tides come at new and full moon.");
  });

  it("rejects bad ranges and empty questions before calling the model", async () => {
    const llm = fakeLlm({});
    await expect(refineResearch(llm, { brief, markdown: md, start: 5, end: 5, question: "x" })).rejects.toThrow(/out of range/);
    await expect(refineResearch(llm, { brief, markdown: md, start: 0, end: md.length + 1, question: "x" })).rejects.toThrow(/out of range/);
    await expect(refineResearch(llm, { brief, markdown: md, start: 1, end: 2.5, question: "x" })).rejects.toThrow(/out of range/);
    const blank = md.indexOf("\n\n");
    await expect(refineResearch(llm, { brief, markdown: md, start: blank, end: blank + 2, question: "x" })).rejects.toThrow(/Select some text/);
    await expect(refineResearch(llm, { brief, markdown: md, ...range("Spring tides"), question: "   " })).rejects.toThrow(/question/);
    expect(llm.requests).toHaveLength(0);
  });
});
