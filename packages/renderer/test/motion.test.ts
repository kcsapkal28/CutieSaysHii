import { loadCatalog } from "@deckforge/catalog/node";
import type { Catalog } from "@deckforge/catalog";
import { beforeAll, describe, expect, it } from "vitest";
import {
  FLICKER,
  flashesPerSecond,
  formatCountUp,
  parseCountUp,
  parseReducedMotion,
  resolveSlideMotion,
  type SlideMotion,
} from "../src/runtime/motion.ts";
import { EMPHASIS_PRESETS, ENTER_PRESETS, EXIT_PRESETS, TRANSITIONS } from "../src/runtime/presets.ts";

let c: Catalog;
beforeAll(async () => {
  c = await loadCatalog();
});

const base: SlideMotion = { transition: "wipe", enter: "glitchIn", emphasis: "countUp", exit: "glitchOut", easing: "power2.out" };

describe("parseReducedMotion", () => {
  it("every catalog reducedMotion string parses", () => {
    for (const t of c.motion.templates) expect(() => parseReducedMotion(t.reducedMotion), t.id).not.toThrow();
  });

  it("throws on an unknown token", () => {
    expect(() => parseReducedMotion("sparkles")).toThrow(/sparkles/);
    expect(() => parseReducedMotion("fadeOnly; sparkles")).toThrow(/sparkles/);
  });

  it("maps each token to its flag", () => {
    expect(parseReducedMotion("fadeOnly; parallax off; three off")).toMatchObject({
      fadeOnly: true, parallax: true, three: true, flicker: false,
    });
    expect(parseReducedMotion("fadeOnly; no flicker; glow static")).toMatchObject({
      fadeOnly: true, flicker: true, glowStatic: true,
    });
    expect(parseReducedMotion("fadeOnly; decorations static")).toMatchObject({ decorationsStatic: true });
    expect(parseReducedMotion("same")).toMatchObject({ same: true, fadeOnly: false });
  });
});

describe("resolveSlideMotion", () => {
  it("fadeOnly maps glitchIn/countUp/glitchOut to fade/none/fade", () => {
    const out = resolveSlideMotion(base, parseReducedMotion("fadeOnly"));
    expect(out).toMatchObject({ enter: "fade", emphasis: "none", exit: "fade", transition: "fade" });
    expect(out.easing).toBe(base.easing);
  });

  it("fadeOnly keeps none and cut transitions", () => {
    const r = parseReducedMotion("fadeOnly");
    expect(resolveSlideMotion({ ...base, transition: "none" }, r).transition).toBe("none");
    expect(resolveSlideMotion({ ...base, transition: "cut" }, r).transition).toBe("cut");
  });

  it("null leaves motion unchanged", () => {
    expect(resolveSlideMotion(base, null)).toEqual(base);
  });

  it("same leaves motion unchanged", () => {
    expect(resolveSlideMotion(base, parseReducedMotion("same"))).toEqual(base);
  });

  it("fadeOnly with glow static keeps glow", () => {
    const out = resolveSlideMotion({ ...base, emphasis: "glow" }, parseReducedMotion("fadeOnly; no flicker; glow static"));
    expect(out).toMatchObject({ enter: "fade", emphasis: "glow", exit: "fade" });
  });

  it("fadeOnly without glow static still drops glow", () => {
    expect(resolveSlideMotion({ ...base, emphasis: "glow" }, parseReducedMotion("fadeOnly; no flicker")).emphasis).toBe("none");
  });

  it("glow static keeps only glow, not other emphasis", () => {
    expect(resolveSlideMotion(base, parseReducedMotion("fadeOnly; glow static")).emphasis).toBe("none");
  });
});

describe("flashesPerSecond", () => {
  it("flicker stays within WCAG 2.3.1", () => {
    expect(flashesPerSecond(FLICKER)).toBeLessThanOrEqual(3);
  });

  it("counts every dip that can start inside one closed 1 s window", () => {
    expect(flashesPerSecond({ dips: 10, halfPeriod: 0.2 })).toBe(3);
    expect(flashesPerSecond({ dips: 10, halfPeriod: 0.125 })).toBe(5);
    expect(flashesPerSecond({ dips: 10, halfPeriod: 0.04 })).toBe(10);
    expect(flashesPerSecond({ dips: 2, halfPeriod: 0.01 })).toBe(2);
    expect(flashesPerSecond({ dips: 0, halfPeriod: 0.2 })).toBe(0);
  });
});

describe("parseCountUp", () => {
  it("parses a percentage", () => {
    expect(parseCountUp("42%")).toEqual({ prefix: "", value: 42, decimals: 0, suffix: "%", grouping: false });
  });

  it("parses a currency with decimals and a suffix", () => {
    expect(parseCountUp("$3.5B")).toEqual({ prefix: "$", value: 3.5, decimals: 1, suffix: "B", grouping: false });
  });

  it("parses grouped thousands", () => {
    expect(parseCountUp("1,200+")).toMatchObject({ value: 1200, grouping: true, suffix: "+", decimals: 0 });
  });

  it("returns null for non-numeric or multi-number text", () => {
    expect(parseCountUp("N/A")).toBeNull();
    expect(parseCountUp("Q3 2025")).toBeNull();
    expect(parseCountUp("")).toBeNull();
  });

  it("formatCountUp round-trips the original text", () => {
    for (const s of ["42%", "$3.5B", "1,200+", "-7.25x", "1,234,567"]) {
      const p = parseCountUp(s);
      expect(p, s).not.toBeNull();
      expect(formatCountUp(p!, p!.value), s).toBe(s);
    }
  });

  it("formatCountUp formats intermediate values", () => {
    expect(formatCountUp(parseCountUp("1,200+")!, 600.4)).toBe("600+");
    expect(formatCountUp(parseCountUp("$3.5B")!, 1.25)).toBe("$1.3B");
  });
});

describe("presets", () => {
  it("cover the vocabulary", () => {
    const v = c.motion.vocabulary;
    expect(Object.keys(ENTER_PRESETS)).toEqual(expect.arrayContaining(v.enter));
    expect(Object.keys(EMPHASIS_PRESETS)).toEqual(expect.arrayContaining(v.emphasis));
    expect(Object.keys(EXIT_PRESETS)).toEqual(expect.arrayContaining(v.exit));
    expect(Object.keys(TRANSITIONS)).toEqual(expect.arrayContaining(v.transition));
  });

  it("transitions map to Reveal-native names", () => {
    expect(TRANSITIONS.cut).toBe("none");
    expect(TRANSITIONS.wipe).toBe("none");
    expect(TRANSITIONS.fade).toBe("fade");
  });

  it("every preset returns an empty-safe timeline for no targets", () => {
    const o = { duration: 0.1, stagger: 0.01, ease: "none", flicker: true, glowStatic: false };
    for (const set of [ENTER_PRESETS, EMPHASIS_PRESETS, EXIT_PRESETS])
      for (const [name, fn] of Object.entries(set)) expect(() => fn([], o), name).not.toThrow();
  });
});
