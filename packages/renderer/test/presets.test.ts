// @vitest-environment jsdom
import { gsap } from "gsap";
import { beforeEach, describe, expect, it } from "vitest";
import { formatCountUp, parseCountUp } from "../src/runtime/motion.ts";
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
