// The prompts teach the failure classes (prompts/visual-bar.md) and the schemas carry them: the critic files each
// issue under a kind, the card carries what the builder needs to avoid them, and the builder's deck brief names the
// exact theme variables with their contrast.
import { statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { builderDeck, builderSchema, builderStatic, fixTokenNames, themeTokens } from "../src/agents/builder.ts";
import { cardProblems, cardSchema } from "../src/agents/outliner.ts";
import { loadPrompt, PROMPTS_DIR } from "../src/agents/prompts.ts";
import { CriticReport, ISSUE_KINDS, Outline, toStoryboard } from "../src/agents/schemas.ts";
import { toJsonSchema } from "../src/agents/json-schema.ts";
import { Style } from "../src/contract.ts";
import { FINDING_ISSUE_KIND, precheckIssues } from "../src/pipeline/precheck.ts";
import { cardOut, slideHtml, styleOut } from "./fakes.ts";

const BAR_KINDS = ["labels", "steps", "overlap", "sparse", "contrast", "storyboard", "tiny-text", "clipped", "accuracy", "form"];

describe("prompts", () => {
  it("load with every include and variable resolved", () => {
    for (const name of ["builder", "critic", "outline-card", "outline", "visual-bar"]) {
      const text = loadPrompt(name, { techniques: "" });
      expect(text, name).not.toMatch(/\{\{/);
      expect(text, name).toContain("## The visual bar");
    }
  });

  it("teach the failure classes to the builder, the critic and the card writer, under the critic's kind names", () => {
    for (const name of ["builder", "critic", "outline-card"]) {
      const text = loadPrompt(name);
      for (const kind of BAR_KINDS) expect(text, `${name}: ${kind}`).toContain(`\`${kind}\``);
    }
    const critic = loadPrompt("critic");
    for (const kind of ISSUE_KINDS) expect(critic, kind).toContain(`\`${kind}\``);
  });

  it("keep the builder's slide contract and recipes, at about today's size", () => {
    const builder = loadPrompt("builder");
    expect(builder).toContain("## The slide contract (follow exactly)");
    expect(builder).toContain('DF.slide("<id>", (api) => {');
    expect(builder).toContain("const STATES = [");
    for (const part of ["**Layout first.**", "**Labels.**", "**Steps as a state table.**", "**Simulations.**", "**3D.**", "tick off the storyboard"]) {
      expect(builder).toContain(part);
    }
    // builder.md was 9.8 KB (12 KB with the visual bar) before the rewrite; keep it near that.
    expect(statSync(join(PROMPTS_DIR, "builder.md")).size).toBeLessThan(11_000);
    expect(Buffer.byteLength(builder)).toBeLessThan(14_000);
    expect(builderStatic().length).toBeGreaterThan(builder.length);
  });

  it("stay topic-agnostic", () => {
    for (const name of ["builder", "critic", "outline-card", "outline", "visual-bar"]) {
      expect(loadPrompt(name, { techniques: "" }), name).not.toMatch(/earbud|\bANC\b|noise.cancell/i);
    }
  });
});

describe("critic report", () => {
  const issue = { severity: "high", kind: "labels", what: "Chip covers the part", where: "step 2, #s01 .chip, x 900–1100, y 400–440", fix: "Move the chip to left: 1240px" };
  const report = (issues: unknown[]) => ({ verdict: "fix", score: 6, summary: "Close.", issues });

  it("files every issue under a known kind", () => {
    expect(CriticReport.parse(report([issue])).issues[0]!.kind).toBe("labels");
    expect(CriticReport.safeParse(report([{ ...issue, kind: undefined }])).success).toBe(false);
    expect(CriticReport.safeParse(report([{ ...issue, kind: "label" }])).success).toBe(false);
  });

  it("puts the kinds in the tool's JSON schema as an enum", () => {
    const schema = JSON.stringify(toJsonSchema(CriticReport));
    expect(schema).toContain('"kind"');
    for (const kind of ISSUE_KINDS) expect(schema).toContain(`"${kind}"`);
  });

  it("maps every measured finding to a kind", () => {
    const issues = precheckIssues([
      { kind: "text-overlap", severity: "error", step: 0, selector: "#s01 h1", detail: "x", measured: { w: 10, h: 10 } },
      { kind: "dead-step", severity: "warn", step: 1, selector: "#s01", detail: "y", measured: { step: 2 } },
    ]);
    expect(issues.map((i) => [i.severity, i.kind])).toEqual([
      ["high", "overlap"],
      ["medium", "steps"],
    ]);
    for (const kind of Object.values(FINDING_ISSUE_KIND)) expect(ISSUE_KINDS).toContain(kind);
  });
});

describe("card", () => {
  const style = Style.parse({ look: "x", theme: { colors: styleOut().colors, fonts: styleOut().fonts }, motion: "rich", use3d: true, interactivity: 2, density: "balanced", features: {} });
  const slide = { id: "s02", explainer: "simulation" };

  it("needs a focus region, and anchors whenever it has callouts", () => {
    expect(cardSchema(slide, style).safeParse(cardOut("s02", { focus: undefined })).success).toBe(false);
    const card = cardSchema(slide, style).parse(cardOut("s02"));
    expect(cardProblems(slide, { ...card, visual: { ...card.visual, anchors: undefined } }, style)).toEqual([expect.stringMatching(/visual\.anchors is missing/)]);
    expect(cardProblems(slide, { ...card, callouts: [], visual: { ...card.visual, anchors: undefined } }, style)).toEqual([]);
  });

  it("carries focus, anchors and legend through the outline to the builder's and critic's storyboard", () => {
    const card = cardSchema(slide, style).parse(cardOut("s02"));
    const outline = Outline.parse({
      title: "T",
      subtitle: "S",
      throughline: "X",
      totalSec: 60,
      visualThroughline: "V",
      motifs: [],
      sections: [{ name: "A", slides: [{ id: "s02", title: card.title, point: "P", role: "mechanism", callouts: card.callouts, notes: card.notes, budgetSec: 60, visual: { explainer: "simulation", technique: "parametric-sim", ...card.visual } }] }],
    });
    expect(toStoryboard(outline).slides[0]).toMatchObject({ focus: expect.stringContaining("x 160"), anchors: expect.stringContaining("→"), legend: expect.stringContaining("accent") });
  });
});

describe("theme for the builder", () => {
  const theme = { colors: styleOut().colors, fonts: styleOut().fonts, backdrop: styleOut().backdrop };

  it("names the exact variables with their contrast, and the text colour that reads on each accent fill", () => {
    const text = themeTokens(theme);
    expect(text).toMatch(/^Theme tokens/);
    expect(text).toContain("- accent2 → var(--df-accent-2) = #5ee0b0: ");
    expect(text).toContain("- accent3 → var(--df-accent-3)");
    expect(text).toMatch(/- text → var\(--df-text\) = #f2f0f7: \d+\.\d:1 on bg, \d+\.\d:1 on surface/);
    expect(text).toMatch(/text on an accent fill: var\(--df-bg\) \(\d+\.\d:1\)/);
    const deck = builderDeck({ deckTitle: "D", style: Style.parse({ look: "x", theme, motion: "rich", use3d: true, interactivity: 2, density: "balanced", features: {} }), deck: { visualThroughline: "V", motifs: [] } });
    expect(deck).toContain(text);
  });

  it("repairs guessed accent variable names in what the builder returns", () => {
    expect(fixTokenNames("color: var(--df-accent2); fill: var(--df-accent3); x: var(--df-accent-2); y: var(--df-accent1)")).toBe(
      "color: var(--df-accent-2); fill: var(--df-accent-3); x: var(--df-accent-2); y: var(--df-accent)",
    );
    const html = slideHtml("s01").replace("color:var(--df-text)", "color:var(--df-accent3)");
    const out = builderSchema("s01").parse({ html, steps: 2, summary: "s" });
    expect(out.html).toContain("var(--df-accent-3)");
    expect(out.html).not.toContain("--df-accent3");
  });
});
