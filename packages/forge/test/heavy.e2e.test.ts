// Shot mode under a heavy per-frame loop: a 6-step simulation whose onFrame burns CPU on every call and draws only
// from its simulated state (and ignores api.shot). Shooting it, pre-check included, must stay fast, and every step
// must show the state the simulation reaches for that step (the final step its end state), not a blank canvas.
// s01 burns ~40 ms per frame; s02 burns 250 ms, about what a particle-heavy 2D canvas costs under software rendering.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DeckConfig, type ShootResult } from "../src/contract.ts";
import { bundleDeck, CHROMIUM_ARGS, shootDeck } from "../src/index.ts";
import { decodePng, type Pixels } from "../src/png.ts";

const light = JSON.parse(readFileSync(new URL("./fixtures/light/deck.json", import.meta.url), "utf8")) as { style: unknown };

const STEPS = 6;
// Where the canvas sits on the slide, and the bars the simulation grows: bar k rises once the step reaches k.
const CX = 260;
const CY = 220;
const CW = 1400;
const CH = 760;
const BAR_W = 150;
const barX = (k: number) => 80 + k * 210;

const heavySlide = (id: string, burnMs: number) => `<section class="df-slide" id="${id}"><h2 class="t">Six stages fill in</h2><canvas class="c" width="${CW}" height="${CH}"></canvas><aside class="df-notes"><p>Notes.</p></aside></section>
<style>#${id} .t{position:absolute;left:96px;top:72px;margin:0;font:600 64px/1.1 var(--df-font-display);color:var(--df-text)}#${id} .c{position:absolute;left:${CX}px;top:${CY}px;width:${CW}px;height:${CH}px}</style>
<script>
DF.slide("${id}", (api) => {
  const ctx = api.el.querySelector("canvas").getContext("2d");
  const sim = { goal: 0, h: [0, 0, 0, 0, 0, 0] };
  api.onFrame((t, dt) => {
    const until = performance.now() + ${burnMs};
    while (performance.now() < until) { /* a heavy simulation step */ }
    for (let k = 0; k < ${STEPS}; k++) sim.h[k] += ((k <= sim.goal ? 1 : 0) - sim.h[k]) * Math.min(1, dt * 30);
    ctx.clearRect(0, 0, ${CW}, ${CH});
    ctx.fillStyle = api.theme.colors.accent;
    for (let k = 0; k < ${STEPS}; k++) {
      const h = sim.h[k] * ${CH - 80};
      ctx.fillRect(80 + k * 210, ${CH - 40} - h, ${BAR_W}, h);
    }
  });
  return { steps: ${STEPS}, step(i) { sim.goal = i; } };
});
</script>`;

const CASES = [
  ["s01", 40],
  ["s02", 250],
] as const;

// A slide whose third step hangs the page: the shooter gives up on that step and keeps the shots it has.
const HANG = `<section class="df-slide" id="s03"><h2 class="t">Step <b class="n">1</b></h2><aside class="df-notes"><p>Notes.</p></aside></section>
<style>#s03 .t{position:absolute;left:96px;top:72px;margin:0;font:600 64px/1.1 var(--df-font-display);color:var(--df-text)}</style>
<script>
DF.slide("s03", (api) => ({
  steps: 3,
  step(i) {
    api.el.querySelector(".n").textContent = String(i + 1);
    if (i === 2) { const until = performance.now() + 30000; while (performance.now() < until) {} }
  },
}));
</script>`;

let browser: Browser;
const results: Record<string, { result: ShootResult; ms: number }> = {};

beforeAll(async () => {
  browser = await chromium.launch({ args: CHROMIUM_ARGS });
  const ids = [...CASES.map(([id]) => id), "s03"];
  const config = DeckConfig.parse({ title: "Heavy loops", style: light.style, slides: ids.map((id) => ({ id, title: id })) });
  const deckFile = join(mkdtempSync(join(tmpdir(), "forge-heavy-")), "deck.html");
  await bundleDeck({ config, slides: { ...Object.fromEntries(CASES.map(([id, burn]) => [id, heavySlide(id, burn)])), s03: HANG }, outFile: deckFile });
  for (const id of ids) {
    const t0 = performance.now();
    const result = await shootDeck({ deckFile, browser, slideIds: [id] });
    results[id] = { result, ms: performance.now() - t0 };
  }
}, 180_000);
afterAll(async () => {
  await browser?.close();
});

/** Is the pixel at slide coordinates (x, y) the theme accent (#2e8b80)? */
function accentAt(img: Pixels, x: number, y: number): boolean {
  const i = (y * img.width + x) * 4;
  return Math.abs(img.data[i]! - 0x2e) + Math.abs(img.data[i + 1]! - 0x8b) + Math.abs(img.data[i + 2]! - 0x80) < 24;
}
// A point 30% up a full-height bar: inside the bar once it has mostly risen, background while it is down.
const probe = (k: number) => [CX + barX(k) + BAR_W / 2, CY + CH - 40 - Math.round(0.3 * (CH - 80))] as const;

describe.each(CASES)("shot mode with a heavy onFrame loop (%s, %i ms per frame)", (id) => {
  it("shoots every step, pre-check included, in well under 10 s", () => {
    const { result, ms } = results[id]!;
    console.log(`${id}: ${STEPS} steps shot and measured in ${Math.round(ms)} ms`);
    expect(Object.values(result.errors).flat()).toEqual([]);
    expect(result.steps[id]).toBe(STEPS);
    expect(result.shots).toHaveLength(STEPS);
    expect(ms).toBeLessThan(10_000);
  });

  it("shows the simulation's state at every step, the end state at the last", () => {
    const { result } = results[id]!;
    const imgs = result.shots.map((s) => decodePng(s.png));
    for (let step = 0; step < imgs.length; step++) {
      for (let k = 0; k < STEPS; k++) expect(accentAt(imgs[step]!, ...probe(k)), `step ${step}, bar ${k}`).toBe(k <= step);
    }
    const blocking = (result.findings?.[id] ?? []).filter((f) => f.severity === "error");
    expect(blocking.map((f) => `${f.kind}: ${f.detail}`)).toEqual([]);
  });
});

describe("a step that never settles", () => {
  it("is reported by name within the step timeout, and the earlier steps' shots are kept", () => {
    const { result, ms } = results.s03!;
    expect(result.shots.map((s) => s.step)).toEqual([0, 1]);
    expect(result.steps.s03).toBe(3);
    expect(result.errors.s03).toHaveLength(1);
    expect(result.errors.s03![0]).toMatch(/^shoot failed at step 3 of 3: timed out after 8000 ms waiting for s03 step 3 of 3 to settle \(the shots of steps 1–2 are kept\)$/);
    expect(Object.keys(result.findings ?? {})).toEqual(["s03"]);
    expect(ms).toBeLessThan(20_000);
  });
});
