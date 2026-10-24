import { AA_RATIO, goldenChoices, wordsPerSlideMax, type Catalog } from "@deckforge/catalog";
import type { Choices } from "@deckforge/schemas";
import { beforeAll, describe, expect, it } from "vitest";
import type { PipelineState } from "../../src/kernel/contracts.ts";
import type { QaPort, QaRequest } from "../../src/kernel/ports.ts";
import { STAGE_TIMEOUTS_MS } from "../../src/kernel/stage.ts";
import { failingSlideIds, qaFailureReasons } from "../../src/qa/failures.ts";
import { createQaStage } from "../../src/stages/qa.ts";
import { makeTestContext, testCatalog } from "../helpers/context.ts";
import { MANIFEST, reportWith, slideReport } from "../qa/fixtures.ts";
import { STANDARD_DECK } from "../validate/fixtures.ts";

let c: Catalog;
let choices: Choices;
beforeAll(async () => {
  c = await testCatalog();
  choices = goldenChoices(c)[0]!;
});

const BRIEF = { topic: "x", brief: "y", audience: "general" as const, durationMin: 10 as const, language: "en" as const };
const state = (o: Partial<PipelineState> = {}): PipelineState => ({ brief: BRIEF, choices, deck: STANDARD_DECK, manifest: MANIFEST, ...o });

describe("qa failure reasons", () => {
  it('reasons "42 words > 40"', () => {
    expect(qaFailureReasons(slideReport("s04", { wordCount: 42 }), 40)).toEqual(["42 words > 40"]);
    expect(qaFailureReasons(slideReport("s04", { wordCount: 40 }), 40)).toEqual([]);
  });

  it("names overflow, console errors and contrast failures in order", () => {
    const s = slideReport("s06", {
      overflow: true,
      consoleErrors: ["TypeError: x is undefined"],
      contrastFails: [{ selector: ".df-stat-label", fg: "#777777", bg: "#888888", ratio: 1.234 }],
      wordCount: 50,
    });
    expect(qaFailureReasons(s, 40)).toEqual([
      "overflow",
      "console: TypeError: x is undefined",
      `contrast 1.23 < ${AA_RATIO} at .df-stat-label`,
      "50 words > 40",
    ]);
    expect(String(AA_RATIO)).toBe("4.5");
  });

  it("failingSlideIds lists slides with any reason, in deck order", () => {
    expect(failingSlideIds(reportWith({ s09: { overflow: true }, s04: { wordCount: 41 } }), 40)).toEqual(["s04", "s09"]);
    expect(failingSlideIds(reportWith({}), 40)).toEqual([]);
  });
});

describe("qa stage", () => {
  it("version qa.v1, the qa timeout, no validation retries, reads content and render", () => {
    expect(createQaStage()).toMatchObject({
      name: "qa",
      version: "qa.v1",
      timeoutMs: STAGE_TIMEOUTS_MS.qa,
      retry: { validation: 0 },
      dependsOn: ["content", "render"],
    });
  });

  it("wordCap from catalog", () => {
    const stage = createQaStage();
    expect(stage.select(state(), c)).toEqual({ deck: STANDARD_DECK, manifest: MANIFEST, wordCap: wordsPerSlideMax(c, "standard", choices.styleFamilyId) });
    const deep = stage.select(state({ choices: { ...choices, depth: "deep" } }), c);
    expect(deep.wordCap).toBe(wordsPerSlideMax(c, "deep", choices.styleFamilyId));
    expect(() => stage.select(state({ manifest: undefined }), c)).toThrow(/manifest/);
    expect(() => stage.select(state({ deck: undefined }), c)).toThrow(/deck/);
  });

  it("runs the QA port on the dist with the stage signal; reduce stores the report", async () => {
    const report = reportWith({ s04: { wordCount: 42 } });
    const seen: { req: QaRequest; signal: AbortSignal }[] = [];
    const qa: QaPort = { run: async (req, signal) => (seen.push({ req, signal }), report) };
    const { ctx } = await makeTestContext({ qa, stage: "qa" });
    const stage = createQaStage();
    const input = stage.input.parse(stage.select(state(), c));
    const out = await stage.run(input, ctx);

    expect(seen).toEqual([{ req: { distDir: ctx.paths.distDir, manifest: MANIFEST, deck: STANDARD_DECK, wordCap: input.wordCap }, signal: ctx.signal }]);
    expect(stage.output.parse(out)).toEqual({ report, wordCap: input.wordCap });
    expect(stage.reduce(state(), out).report).toEqual(report);
    expect(stage.fingerprint(input, c)).toEqual(input);
  });

  it("summarize → pass and per-slide failures with reasons", () => {
    const stage = createQaStage();
    const report = reportWith({ s04: { wordCount: 42 }, s09: { overflow: true } });
    expect(stage.summarize({ report, wordCap: 40 })).toEqual({
      stage: "qa",
      pass: false,
      failures: [
        { slideId: "s04", reasons: ["42 words > 40"] },
        { slideId: "s09", reasons: ["overflow"] },
      ],
    });
    expect(stage.summarize({ report: reportWith({}), wordCap: 40 })).toEqual({ stage: "qa", pass: true, failures: [] });
  });
});
