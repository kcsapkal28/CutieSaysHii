// The deterministic pre-check (measure.ts) in real Chromium: synthetic broken slides each trip exactly their own check,
// and a clean slide trips none. (The known-good fixture decks are checked for zero error findings in shoot.e2e.test.ts.)
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DeckConfig, type Finding, type ShootResult } from "../src/contract.ts";
import { bundleDeck, CHROMIUM_ARGS, shootDeck } from "../src/index.ts";
import { MEASURE } from "../src/measure.ts";
import { decodePng } from "../src/png.ts";

const light = JSON.parse(readFileSync(new URL("./fixtures/light/deck.json", import.meta.url), "utf8")) as { style: unknown };

const title = (id: string, text: string) =>
  `<h2 class="t">${text}</h2><style>#${id} .t{position:absolute;left:96px;top:72px;margin:0;font:600 64px/1.1 var(--df-font-display);color:var(--df-text)}</style>`;
const slide = (id: string, body: string, css = "", script = "") =>
  `<section class="df-slide" id="${id}">${body}<aside class="df-notes"><p>Notes.</p></aside></section>\n` +
  (css ? `<style>${css}</style>\n` : "") +
  (script ? `<script>${script}</script>` : "");
const split = (html: string) => {
  // title() carries its own <style>; move it after the section to keep the fragment contract.
  const styles = [...html.matchAll(/<style>[\s\S]*?<\/style>/g)].map((m) => m[0]).join("\n");
  return html.replace(/<style>[\s\S]*?<\/style>/g, "").replace("</section>\n", `</section>\n${styles}\n`);
};

/** id → [the slide, the error kinds it must produce (exactly)]. */
const CASES: Record<string, [string, Finding["kind"][]]> = {
  // A fixed-height card that hides the second half of its paragraph.
  s01: [
    slide(
      "s01",
      `${title("s01", "Clipped text")}<div class="card"><p>Every request is checked against the policy table, then logged, then forwarded to the service that owns the route, which replies.</p></div>`,
      `#s01 .card{position:absolute;left:96px;top:300px;width:620px;height:130px;overflow:hidden;padding:20px;background:var(--df-surface)}#s01 .card p{margin:0;font:400 32px/1.4 var(--df-font-body);color:var(--df-text)}`,
    ),
    ["clipped-text"],
  ],
  // A caption that runs past the right edge of the canvas.
  s02: [
    slide(
      "s02",
      `${title("s02", "Off canvas")}<p class="cap">This caption starts far right and keeps going past the edge</p>`,
      `#s02 .cap{position:absolute;left:1300px;top:600px;margin:0;white-space:nowrap;font:400 34px/1.3 var(--df-font-body);color:var(--df-text)}`,
    ),
    ["off-canvas"],
  ],
  // Two labels placed on top of each other.
  s03: [
    slide(
      "s03",
      `${title("s03", "Overlapping labels")}<span class="a">Inlet pressure</span><span class="b">Outlet flow rate</span>`,
      `#s03 span{position:absolute;font:500 30px/1.2 var(--df-font-body);color:var(--df-text)}#s03 .a{left:400px;top:500px}#s03 .b{left:470px;top:510px}`,
    ),
    ["text-overlap"],
  ],
  // Nothing renders at all.
  s04: [slide("s04", ""), ["blank-render"]],
  // A 3D view whose scene is empty: the canvas never shows anything.
  s05: [
    slide(
      "s05",
      `${title("s05", "Empty 3D view")}<div class="view"></div>`,
      `#s05 .view{position:absolute;left:400px;top:240px;width:1100px;height:700px}`,
      `DF.slide("s05", (api) => { const k = api.three(api.el.querySelector(".view")); k.render(); return { steps: 1 }; });`,
    ),
    ["dead-canvas"],
  ],
  // A 2D canvas filled with one flat colour and nothing drawn on it.
  s06: [
    slide(
      "s06",
      `${title("s06", "Flat canvas")}<canvas class="c" width="900" height="560"></canvas>`,
      `#s06 .c{position:absolute;left:500px;top:300px;width:900px;height:560px}`,
      `DF.slide("s06", (api) => { const c = api.el.querySelector("canvas").getContext("2d"); c.fillStyle = api.theme.colors.accent2; c.fillRect(0, 0, 900, 560); return { steps: 1 }; });`,
    ),
    ["dead-canvas"],
  ],
  // Clean: title, paragraph, a chip, a live 2D canvas and a step that changes something.
  s07: [
    slide(
      "s07",
      `${title("s07", "A clean slide")}<p class="lede">Two short lines of body copy that fit their box comfortably.</p><span class="df-tag"><b>01</b> Sensor</span><canvas class="c" width="700" height="500"></canvas>`,
      `#s07 .lede{position:absolute;left:96px;top:220px;width:700px;margin:0;font:400 34px/1.4 var(--df-font-body);color:var(--df-text)}#s07 .df-tag{position:absolute;left:96px;top:420px}#s07 .c{position:absolute;left:1000px;top:260px;width:700px;height:500px}`,
      `DF.slide("s07", (api) => { const c = api.el.querySelector("canvas").getContext("2d"); const draw = (n) => { c.clearRect(0, 0, 700, 500); for (let i = 0; i < n; i++) { c.fillStyle = [api.theme.colors.accent, api.theme.colors.accent2, api.theme.colors.accent3][i % 3]; c.beginPath(); c.arc(140 + i * 140, 250, 60, 0, 7); c.fill(); } }; return { steps: 2, step(i) { draw(i ? 4 : 2); } }; });`,
    ),
    [],
  ],
  // Deliberate patterns that must not block: 45° axis labels, text on a circular path around a centre label, a big
  // ghost numeral under a label, a line still hidden in its reveal mask, a rolling digit counter, a display-size
  // numeral bleeding off the edge, and labels over a canvas.
  s09: [
    slide(
      "s09",
      `${title("s09", "Tricky but fine")}` +
        `<div class="ticks">${Array.from({ length: 14 }, (_, i) => `<span style="left:${i * 46}px">Category ${i + 1}</span>`).join("")}</div>` +
        `<svg class="ring" viewBox="0 0 400 400"><defs><path id="s09-arc" d="M200,200 m-150,0 a150,150 0 1,1 300,0 a150,150 0 1,1 -300,0"/></defs>` +
        `<text class="arc"><textPath href="#s09-arc">Sense · Invert · Play back · Measure · Adapt · Sense ·</textPath></text><text class="mid" x="200" y="210" text-anchor="middle">Loop</text></svg>` +
        `<div class="ghost">07</div><div class="glabel">Seventh stage</div>` +
        `<div class="mask"><span>Revealed at the next step</span></div>` +
        `<div class="stat">Count: <span class="roll"><span class="col">0 1 2 3 4 5 6 7 8 9</span></span></div>` +
        `<div class="bleed">1969</div>` +
        `<canvas class="c" width="600" height="300"></canvas><span class="onc">Peak 4.2 kHz</span>`,
      `#s09 .ticks{position:absolute;left:120px;top:330px;width:700px;height:200px}` +
        `#s09 .ticks span{position:absolute;top:0;white-space:nowrap;font:400 20px/1.2 var(--df-font-body);color:var(--df-text);transform:rotate(-45deg);transform-origin:0 0}` +
        `#s09 .ring{position:absolute;left:1350px;top:180px;width:420px;height:420px}#s09 .arc{font:500 22px var(--df-font-mono);fill:var(--df-text)}#s09 .mid{font:600 40px var(--df-font-display);fill:var(--df-text)}` +
        `#s09 .ghost{position:absolute;left:900px;top:560px;font:700 260px/1 var(--df-font-display);color:var(--df-line)}#s09 .glabel{position:absolute;left:940px;top:680px;font:500 30px/1.2 var(--df-font-body);color:var(--df-text)}` +
        `#s09 .mask{position:absolute;left:120px;top:620px;height:44px;overflow:hidden;font:400 34px/1.3 var(--df-font-body);color:var(--df-text)}#s09 .mask span{display:block;transform:translateY(110%)}` +
        `#s09 .stat{position:absolute;left:120px;top:720px;font:600 40px/1.2 var(--df-font-display);color:var(--df-text)}#s09 .roll{display:inline-block;vertical-align:bottom;height:1.2em;overflow:hidden}#s09 .col{display:block;width:.7em;transform:translateY(-8.4em)}` +
        `#s09 .bleed{position:absolute;left:1500px;top:820px;font:800 360px/1 var(--df-font-display);color:var(--df-accent);opacity:.9}` +
        `#s09 .c{position:absolute;left:600px;top:820px;width:600px;height:200px}#s09 .onc{position:absolute;left:660px;top:860px;font:500 24px/1.2 var(--df-font-body);color:var(--df-text)}`,
      `DF.slide("s09", (api) => { const c = api.el.querySelector("canvas").getContext("2d"); c.strokeStyle = api.theme.colors.accent; c.lineWidth = 6; c.beginPath(); for (let x = 0; x <= 600; x += 10) c.lineTo(x, 150 + 100 * Math.sin(x / 40)); c.stroke(); return { steps: 1 }; });`,
    ),
    [],
  ],
  // Warnings only: tiny text, low-contrast text, and a step that changes nothing.
  s08: [
    slide(
      "s08",
      `${title("s08", "Warnings only")}<p class="tiny">Source: a footnote set far too small to read</p><p class="faint">Faint caption on the page</p>`,
      `#s08 .tiny{position:absolute;left:96px;top:300px;margin:0;font:400 12px/1.4 var(--df-font-body);color:var(--df-text)}#s08 .faint{position:absolute;left:96px;top:400px;margin:0;font:400 30px/1.4 var(--df-font-body);color:color-mix(in oklab, var(--df-bg) 70%, var(--df-text))}`,
      `DF.slide("s08", () => ({ steps: 2, step() {} }));`,
    ),
    [],
  ],
};

let browser: Browser;
let result: ShootResult;
const errorKinds = (id: string) => [...new Set((result.findings?.[id] ?? []).filter((f) => f.severity === "error").map((f) => f.kind))].sort();
const warnKinds = (id: string) => [...new Set((result.findings?.[id] ?? []).filter((f) => f.severity === "warn").map((f) => f.kind))].sort();

beforeAll(async () => {
  browser = await chromium.launch({ args: CHROMIUM_ARGS });
  const ids = Object.keys(CASES);
  const config = DeckConfig.parse({ title: "Pre-check cases", style: { ...(light.style as object), use3d: true }, slides: ids.map((id) => ({ id, title: id })) });
  const deckFile = join(mkdtempSync(join(tmpdir(), "forge-measure-")), "deck.html");
  await bundleDeck({ config, slides: Object.fromEntries(ids.map((id) => [id, split(CASES[id]![0])])), outFile: deckFile });
  result = await shootDeck({ deckFile, browser });
}, 120_000);
afterAll(async () => {
  await browser?.close();
});

describe("pre-check on synthetic slides", () => {
  it("shoots them without console errors", () => {
    expect(Object.values(result.errors).flat()).toEqual([]);
  });

  it.each(Object.entries(CASES))("%s trips exactly its own checks", (id, [, kinds]) => {
    expect(errorKinds(id), JSON.stringify(result.findings?.[id], null, 1)).toEqual([...kinds].sort());
  });

  it("states the measured facts", () => {
    const clip = result.findings!.s01!.find((f) => f.kind === "clipped-text")!;
    expect(clip.selector).toBe("#s01 > div.card > p");
    expect(clip.detail).toMatch(/hidden by its container #s01 > div\.card|cut off by its container #s01 > div\.card/);
    const off = result.findings!.s02!.find((f) => f.kind === "off-canvas")!;
    expect(off.detail).toMatch(/runs \d+px past the right edge/);
    expect(Number(off.measured.overflowPx)).toBeGreaterThan(100);
    const overlap = result.findings!.s03!.find((f) => f.kind === "text-overlap")!;
    expect(overlap.detail).toMatch(/"Inlet pressure".*"Outlet flow rate".*overlap/);
  });

  it("raises warnings (not errors) for tiny text, low contrast and a step that changes nothing", () => {
    expect(warnKinds("s08")).toEqual(["dead-step", "low-contrast", "tiny-text"]);
    expect(result.findings!.s08!.find((f) => f.kind === "tiny-text")!.measured.fontPx).toBe(12);
    // The clean slide's only possible warning is the kit chip's accent numeral, which is honestly under 4.5:1 here.
    expect(warnKinds("s07").filter((k) => k !== "low-contrast")).toEqual([]);
  });
});

describe("png decoder", () => {
  it("reads a Chromium screenshot's size and pixels", () => {
    const shot = result.shots.find((s) => s.slideId === "s04")!;
    const img = decodePng(shot.png);
    expect([img.width, img.height]).toEqual([1920, 1080]);
    // The blank slide is the light theme's background everywhere.
    expect([...img.data.subarray(0, 4)]).toEqual([0xf7, 0xf7, 0xf4, 255]);
    expect(MEASURE.blankEdgePx).toBeGreaterThan(0);
  });
});
