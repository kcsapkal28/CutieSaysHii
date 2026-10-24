import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { goldenChoices, type Catalog } from "@deckforge/catalog";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_PROMPTS_DIR, loadPrompts } from "../../src/adapters/prompts-fs.ts";
import { buildContentRequest } from "../../src/agents/deck-tool.ts";
import { buildDesignRequest } from "../../src/agents/design-tool.ts";
import { buildPatchRequest } from "../../src/agents/patch-tool.ts";
import type { AgentPrompt, AgentRequest } from "../../src/agents/messages.ts";
import { toSkeleton } from "../../src/design/skeleton.ts";
import { ContentChoicesSchema, DesignChoicesSchema, PatchChoicesSchema } from "../../src/kernel/contracts.ts";
import { testCatalog } from "../helpers/context.ts";
import { reportWith } from "../qa/fixtures.ts";
import { STANDARD_DECK } from "../validate/fixtures.ts";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

let c: Catalog;
let prompts: Record<string, AgentPrompt>;
beforeAll(async () => {
  c = await testCatalog();
  prompts = await loadPrompts(DEFAULT_PROMPTS_DIR);
});

const TOOLS = { content: "emit_deck", design: "emit_design", patch: "emit_patches" } as const;
const JSON_LITERALS = ["null", "true", "false"];

/** Every object key the agent receives, in its input and in its tool's schema. */
function fieldNames(r: AgentRequest): Set<string> {
  const names = new Set<string>();
  const walk = (v: unknown, schema: boolean): void => {
    if (Array.isArray(v)) return v.forEach((x) => walk(x, schema));
    if (typeof v !== "object" || v === null) return;
    for (const [k, x] of Object.entries(v)) {
      if (!schema) names.add(k);
      else if (k === "properties") Object.keys(x as object).forEach((n) => names.add(n));
      walk(x, schema);
    }
  };
  walk(r.input, false);
  walk(r.tool.inputSchema, true);
  return names;
}

function requests(): Record<keyof typeof TOOLS, AgentRequest> {
  const choices = goldenChoices(c).find((g) => g.questionCount !== undefined)!;
  const brief = { topic: "Solar", brief: "How solar cells turn light into current.", audience: "general" as const, durationMin: 10 as const, language: "en" as const };
  const model = "claude-sonnet-5-5";
  return {
    content: buildContentRequest({ brief, choices: ContentChoicesSchema.parse(choices) }, c, { prompt: prompts.content!, model }),
    design: buildDesignRequest({ choices: DesignChoicesSchema.parse(choices), skeleton: toSkeleton(STANDARD_DECK) }, c, { prompt: prompts.design!, model }),
    patch: buildPatchRequest(
      { deck: STANDARD_DECK, report: reportWith({ s04: { overflow: true } }), choices: PatchChoicesSchema.parse(choices), wordCap: 40 },
      c,
      { prompt: prompts.patch!, model },
    ),
  };
}

describe("loadPrompts", () => {
  it("highest version", async () => {
    const dir = await mkdtemp(join(tmpdir(), "prompts-"));
    dirs.push(dir);
    const files: Record<string, string> = {
      "content.v1.md": "one",
      "content.v2.md": "two",
      "content.v10.md": "ten",
      "design.v3.md": "design three",
      "notes.txt": "ignored",
      "README.md": "ignored",
      "design.vx.md": "ignored",
    };
    for (const [name, text] of Object.entries(files)) await writeFile(join(dir, name), text);
    expect(await loadPrompts(dir)).toEqual({
      content: { name: "content.v10", text: "ten" },
      design: { name: "design.v3", text: "design three" },
    });
  });

  it("ships content, design and patch prompts", () => {
    expect(prompts.content?.name).toMatch(/^content\.v\d+$/);
    expect(prompts.design?.name).toMatch(/^design\.v\d+$/);
    expect(prompts.patch?.name).toMatch(/^patch\.v\d+$/);
  });
});

describe("prompt text", () => {
  it("prompts name their tool", () => {
    for (const [agent, tool] of Object.entries(TOOLS)) {
      const text = prompts[agent]!.text;
      expect(text).toContain(`\`${tool}\``);
      for (const other of Object.values(TOOLS).filter((t) => t !== tool)) expect(text).not.toContain(other);
    }
  });

  // A lowercase backticked word is a slide-type id unless it is a field the agent receives.
  it("backticked slide-type ids exist", () => {
    const ids = new Set(c.slideTypes.types.map((t) => t.id));
    for (const [agent, req] of Object.entries(requests())) {
      const known = new Set([...ids, ...fieldNames(req), ...JSON_LITERALS]);
      const tokens = [...prompts[agent]!.text.matchAll(/`([a-z]+(?:-[a-z]+)*)`/g)].map((m) => m[1]!);
      expect(tokens.filter((t) => !known.has(t)), `${agent} prompt`).toEqual([]);
      expect(tokens.some((t) => ids.has(t)), `${agent} prompt names slide types`).toBe(true);
    }
    expect(prompts.content!.text).toMatch(/`stat`.*`chart`/);
  });

  it("the content prompt states each depth's notes word range", () => {
    for (const [depth, rule] of Object.entries(c.slideTypes.depth)) {
      const [min, max] = rule.notesWordsPerSlide;
      expect(prompts.content!.text).toMatch(new RegExp(`\\b${depth}\\b[^\\n]*\\b${min}–${max} words`));
    }
  });

  it("the content prompt's limit statements match the catalog", () => {
    const text = prompts.content!.text;
    const limit = (id: string, key: string) => c.slideTypes.types.find((t) => t.id === id)!.limits![key]!;
    const max = (l: number | [number, number]) => (typeof l === "number" ? l : l[1]);

    expect(text).toContain("`titleWords` bounds `slide.title`, except on the cover type, where it bounds `deck.title`");
    const titleWords = c.slideTypes.types.flatMap((t) => (t.limits?.titleWords === undefined ? [] : [max(t.limits.titleWords)]));
    const [, title] = /slide titles to at most (\d+) words, and within the type's `titleWords` limit where it is lower/.exec(text) ?? [];
    expect(Number(title)).toBe(Math.max(...titleWords));

    const [, items, words] = /On a `bullets` slide: at most (\d+) bullets, each at most (\d+) words/.exec(text) ?? [];
    expect(Number(items)).toBe(max(limit("bullets", "items")));
    expect(Number(words)).toBe(max(limit("bullets", "wordsPerItem")));
  });

  it("the content prompt explains optional Paragraphs in subtitle, aside and caption regions", () => {
    expect(prompts.content!.text).toMatch(/Paragraph[^\n]*subtitle, aside or caption[^\n]*optional/);
  });

  it("the design prompt sees emphasis counts, not targets", () => {
    expect(prompts.design!.text).toContain("emphasisCount");
    expect(prompts.design!.text).not.toContain("emphasisTargets");
  });

  it("the content prompt covers the deck rules", () => {
    const text = prompts.content!.text;
    for (const phrase of ["exactly once", "rules.notesWords", "rules.quizSlides", "rules.wordsPerSlideMax", "rules.requiredTypes", "emphasisTargets", "verbatim"])
      expect(text).toContain(phrase);
  });

  it("the design prompt covers the design rules", () => {
    const text = prompts.design!.text;
    for (const phrase of ["exactly once", "reason", "blockIndex", "maxInteractiveComponentsPerSlide", "minComponentsPerSlides", "propsJson", "JSON object"])
      expect(text).toContain(phrase);
  });

  it("the patch prompt covers the patch rules", () => {
    const text = prompts.patch!.text;
    for (const phrase of ["exactly once", "least invasive", "rules.slides", "slideCount", "halves", "null"]) expect(text).toContain(phrase);
    expect(text).toMatch(/`dropBlock`.*`shortenText`.*`swapLayout`.*`splitSlide`/s);
  });
});
