// @vitest-environment jsdom
import { gsap } from "gsap";
import { beforeEach, describe, expect, it } from "vitest";
import { FLICKER, formatCountUp, parseCountUp } from "../src/runtime/motion.ts";
import { countUpTargets, EMPHASIS_PRESETS, ENTER_PRESETS, EXIT_PRESETS, restoreCountUps } from "../src/runtime/presets.ts";

const opts = (flicker: boolean) => ({ duration: 0.5, stagger: 0.1, ease: "none", flicker, glowStatic: false });

function targets(): HTMLElement[] {
  document.body.innerHTML = `<h2>One two three</h2><p>Four five</p><span>Six</span>`;
  return [...document.body.children] as HTMLElement[];
}

// Tweens read their start values when first rendered, so step forward like a real playhead would.
function playThrough(tl: gsap.core.Timeline) {
  tl.pause(0);
  for (let t = 0; t < tl.duration(); t += 0.01) tl.time(t, false);
  tl.progress(1);
}

const opacityOf = (el: Element) => Number(gsap.getProperty(el, "opacity"));

type Sample = { t: number; opacities: number[] };
const STEP = 0.01;
const DIP_BELOW = 0.7;

// Seeks the playhead forward in 10 ms steps over the timeline plus one more second.
function sample(tl: gsap.core.Timeline, els: Element[]): Sample[] {
  tl.pause(0);
  const steps = Math.ceil((tl.duration() + 1) / STEP);
  const out: Sample[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i * STEP;
    tl.time(t, false);
    out.push({ t, opacities: els.map(opacityOf) });
  }
  return out;
}

// Times at which element i's opacity drops from at least DIP_BELOW to below it.
function dipTimes(samples: Sample[], i: number): number[] {
  const times: number[] = [];
  for (let k = 1; k < samples.length; k++)
    if (samples[k - 1]!.opacities[i]! >= DIP_BELOW && samples[k]!.opacities[i]! < DIP_BELOW) times.push(samples[k]!.t);
  return times;
}

const maxPerSecond = (times: number[]) => Math.max(0, ...times.map((t0) => times.filter((t) => t >= t0 && t < t0 + 1).length));

function expectFlickerSafe(samples: Sample[], dips: number) {
  for (let i = 0; i < samples[0]!.opacities.length; i++) {
    const times = dipTimes(samples, i);
    expect(times, `element ${i}`).toHaveLength(dips);
    expect(maxPerSecond(times), `element ${i}`).toBeLessThanOrEqual(3);
  }
}

// Every target has the same opacity at every sample strictly between from and to.
function expectTogether(samples: Sample[], from: number, to = Infinity) {
  for (const { t, opacities } of samples)
    if (t > from + 1e-9 && t < to - 1e-9) expect(new Set(opacities).size, `t=${t.toFixed(2)}`).toBe(1);
}

describe("enter presets end fully visible", () => {
  for (const flicker of [true, false]) {
    for (const [name, preset] of Object.entries(ENTER_PRESETS)) {
      it(`${name} (flicker ${flicker})`, () => {
        const els = targets();
        const tl = preset(els, opts(flicker));
        playThrough(tl);
        for (const el of els) {
          for (const node of [el, ...el.querySelectorAll("*")]) expect(opacityOf(node), `${name} ${node.tagName}`).toBe(1);
        }
      });
    }
  }
});

describe("exit presets", () => {
  it("end in their exit state", () => {
    for (const [name, preset] of Object.entries(EXIT_PRESETS)) {
      if (name === "none") continue;
      const els = targets();
      playThrough(preset(els, opts(true)));
      for (const el of els) expect(opacityOf(el), name).toBe(0);
    }
  });
});

describe("flicker (WCAG 2.3.1)", () => {
  const o = opts(true);
  const flickerSpan = FLICKER.dips * 2 * FLICKER.halfPeriod;
  const lowestAfter = (samples: Sample[], from: number) =>
    Math.min(...samples.filter((s) => s.t > from).flatMap((s) => s.opacities));

  it("glitchIn dips at most 3 times in any second and dips all targets together", () => {
    const els = targets();
    const samples = sample(ENTER_PRESETS.glitchIn!(els, o), els);
    const entryEnd = o.duration * 0.6 + (els.length - 1) * o.stagger;
    expectFlickerSafe(samples, FLICKER.dips);
    expectTogether(samples, entryEnd);
    expect(lowestAfter(samples, entryEnd)).toBeCloseTo(0.55, 2);
  });

  it("glitchOut dips at most 3 times in any second and dips all targets together", () => {
    const els = targets();
    const samples = sample(EXIT_PRESETS.glitchOut!(els, o), els);
    // The final fade to 0 is the one extra crossing.
    expectFlickerSafe(samples, FLICKER.dips + 1);
    expectTogether(samples, 0, flickerSpan);
  });

  it("glow flicker obeys the same bound", () => {
    const els = targets();
    const samples = sample(EMPHASIS_PRESETS.glow!(els, o), els);
    expectFlickerSafe(samples, FLICKER.dips);
    expectTogether(samples, 0);
    expect(lowestAfter(samples, 0)).toBeCloseTo(0.55, 2);
  });

  it("glowStatic sets the glow without animating", () => {
    const tl = EMPHASIS_PRESETS.glow!(targets(), { ...o, glowStatic: true });
    expect(tl.getChildren()).toHaveLength(1);
    expect(tl.duration()).toBe(0);
    expect((tl.getChildren()[0] as gsap.core.Tween).vars.textShadow).toBeDefined();
  });

  it("flicker false never dips", () => {
    const cases = [
      ["glitchIn", ENTER_PRESETS.glitchIn!, 1],
      ["glow", EMPHASIS_PRESETS.glow!, 1],
      ["glitchOut", EXIT_PRESETS.glitchOut!, -1],
    ] as const;
    for (const [name, preset, direction] of cases) {
      const els = targets();
      const samples = sample(preset(els, opts(false)), els);
      for (let i = 0; i < els.length; i++) {
        const series = samples.map((s) => s.opacities[i]!);
        const monotonic = series.every((v, k) => k === 0 || (v - series[k - 1]!) * direction >= 0);
        expect(monotonic, `${name} element ${i}`).toBe(true);
      }
    }
  });
});

describe("countUp", () => {
  beforeEach(() => {
    document.body.innerHTML = `<span id="v">1,200+</span>`;
  });

  it("writes the final authored text on completion", () => {
    const el = document.getElementById("v")!;
    playThrough(EMPHASIS_PRESETS.countUp!([el], opts(true)));
    expect(el.textContent).toBe("1,200+");
  });

  it("leaves partial text mid-count, and restoreCountUps puts the authored text back", () => {
    const el = document.getElementById("v")!;
    EMPHASIS_PRESETS.countUp!([el], opts(true)).progress(0.4);
    expect(el.textContent).not.toBe("1,200+");
    expect(parseCountUp(el.textContent!)).not.toBeNull();
    restoreCountUps(document.body);
    expect(el.textContent).toBe("1,200+");
    expect(formatCountUp(parseCountUp(el.textContent!)!, 1200)).toBe("1,200+");
  });
});

describe("countUp target selection", () => {
  const MARKUP =
    `<div id="whole" data-count-up>22%<span class="trend" aria-label="trend up">▲</span></div>` +
    `<span id="outer" data-count-up><mark id="inner" data-emphasis>7</mark></span>` +
    `<span id="leaf" data-count-up>42%</span><mark id="mark" data-emphasis>9 V</mark>`;
  const all = () => [...document.querySelectorAll<HTMLElement>("[data-emphasis], [data-count-up]")];

  beforeEach(() => {
    document.body.innerHTML = MARKUP;
  });

  it("keeps only targets with no element children and no target ancestor or descendant", () => {
    expect(countUpTargets(all()).map((e) => e.id)).toEqual(["leaf", "mark"]);
  });

  it("never rewrites an element that holds markup, and counts each number once", () => {
    const tl = EMPHASIS_PRESETS.countUp!(all(), opts(true));
    tl.progress(0.4);
    expect(document.getElementById("whole")!.innerHTML).toBe(`22%<span class="trend" aria-label="trend up">▲</span>`);
    expect(document.getElementById("outer")!.innerHTML).toBe(`<mark id="inner" data-emphasis="">7</mark>`);
    expect([...document.querySelectorAll("[data-df-final]")].map((e) => e.id)).toEqual(["leaf", "mark"]);
    expect(document.getElementById("leaf")!.textContent).not.toBe("42%");
    playThrough(tl);
    expect(document.body.innerHTML.replace(/ data-df-final="[^"]*"/g, "")).toBe(
      MARKUP.replace("data-emphasis>", 'data-emphasis="">').replace("data-emphasis>", 'data-emphasis="">').replace(/data-count-up>/g, 'data-count-up="">'),
    );
  });
});

describe("colorShift", () => {
  it("shifts text to the legible accent, not the raw accent role", () => {
    document.documentElement.style.setProperty("--df-accent", "rgb(250, 240, 230)");
    document.documentElement.style.setProperty("--df-accent-text", "rgb(10, 20, 30)");
    const els = targets();
    playThrough(EMPHASIS_PRESETS.colorShift!(els, opts(true)));
    for (const el of els) expect(el.style.color).toBe("rgb(10, 20, 30)");
  });
});
