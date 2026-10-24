import { getFamily, goldenChoices, resolveMotionPlan, resolveTheme, type Catalog } from "@deckforge/catalog";
import type { Choices, RenderManifest } from "@deckforge/schemas";
import { beforeAll, describe, expect, it } from "vitest";
import type { DesignPlan, PipelineState } from "../../src/kernel/contracts.ts";
import type { RenderRequest, RendererPort } from "../../src/kernel/ports.ts";
import { STAGE_TIMEOUTS_MS } from "../../src/kernel/stage.ts";
import { createRenderStage } from "../../src/stages/render.ts";
import { makeTestContext, testCatalog } from "../helpers/context.ts";
import { MANIFEST } from "../qa/fixtures.ts";
import { STANDARD_DECK } from "../validate/fixtures.ts";

let c: Catalog;
let choices: Choices;
let design: DesignPlan;
beforeAll(async () => {
  c = await testCatalog();
  choices = goldenChoices(c)[0]!;
  design = {
    motion: resolveMotionPlan(c, choices.motionTemplateId, STANDARD_DECK.slides),
    interaction: { modeId: choices.interactionModeId, slides: [{ slideId: "s04", components: [{ componentId: "df-fragment", blockIndex: 0, props: {} }] }] },
  };
});

const BRIEF = { topic: "x", brief: "y", audience: "general" as const, durationMin: 10 as const, language: "en" as const };
const state = (o: Partial<PipelineState> = {}): PipelineState => ({ brief: BRIEF, choices, deck: STANDARD_DECK, design, ...o });

function recordingRenderer(manifest: RenderManifest = MANIFEST) {
  const calls: { req: RenderRequest; signal: AbortSignal }[] = [];
  const renderer: RendererPort = { build: async (req, signal) => (calls.push({ req, signal }), manifest) };
  return { renderer, calls };
}

async function render(s: PipelineState, manifest?: RenderManifest) {
  const { renderer, calls } = recordingRenderer(manifest);
  const t = await makeTestContext({ renderer, stage: "render", iteration: 2 });
  const stage = createRenderStage();
  const output = await stage.run(stage.input.parse(stage.select(s, c)), t.ctx);
  return { ...t, calls, output, stage };
}

describe("render stage", () => {
  it("version render.v1, the render timeout, reads content and design", () => {
    expect(createRenderStage()).toMatchObject({
      name: "render",
      version: "render.v1",
      timeoutMs: STAGE_TIMEOUTS_MS.render,
      retry: { validation: 0 },
      dependsOn: ["content", "design"],
    });
  });

  it("select takes deck, design and the full choices; fingerprint is the input", () => {
    const stage = createRenderStage();
    const input = stage.select(state(), c);
    expect(input).toEqual({ deck: STANDARD_DECK, design, choices });
    expect(stage.fingerprint(input, c)).toEqual(input);
    expect(() => stage.select(state({ design: undefined }), c)).toThrow(/design/);
    expect(() => stage.select(state({ deck: undefined }), c)).toThrow(/deck/);
  });

  it("theme passed to the port equals resolveTheme(choices)", async () => {
    const { calls, ctx } = await render(state());
    expect(calls).toHaveLength(1);
    expect(calls[0]!.req).toEqual({
      jobId: ctx.jobId,
      iteration: 2,
      deck: STANDARD_DECK,
      theme: resolveTheme(c, choices),
      motion: design.motion,
      interaction: design.interaction,
      outDir: ctx.paths.distDir,
    });
    expect(calls[0]!.signal).toBe(ctx.signal);
  });

  it("palette change alters only the theme argument", async () => {
    const other = getFamily(c, choices.styleFamilyId).allowedPalettes.find((p) => p !== choices.paletteId)!;
    const a = (await render(state())).calls[0]!.req;
    const b = (await render(state({ choices: { ...choices, paletteId: other } }))).calls[0]!.req;
    const { theme: themeA, ...restA } = a;
    const { theme: themeB, ...restB } = b;
    expect(restB).toEqual(restA);
    expect(themeB.paletteId).toBe(other);
    expect(themeB).not.toEqual(themeA);
    expect({ ...themeB, paletteId: themeA.paletteId, roles: themeA.roles, mode: themeA.mode }).toEqual(themeA);
  });

  it("render stage emits each manifest warning", async () => {
    const warnings = ["slide s08: diagram 1 failed to render; showing its source", "slide s04: df-tabs is not supported", "slide s08: diagram 1 failed to render; showing its source"];
    const { events, output } = await render(state(), { ...MANIFEST, warnings });
    expect(events.filter((e) => e.type === "stage:warning").map((e) => (e as { message: string }).message)).toEqual(warnings);
    expect(output.warnings).toEqual(warnings);
  });

  it("summary slideIds", async () => {
    const { output, stage } = await render(state());
    expect(stage.summarize(output)).toEqual({ stage: "render", slideIds: MANIFEST.slideIds, totalBytes: MANIFEST.totalBytes, warnings: [] });
    expect(stage.reduce(state(), output).manifest).toEqual(MANIFEST);
  });
});
