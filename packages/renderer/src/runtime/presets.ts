/// <reference lib="dom" />
import { gsap } from "gsap";
import { SplitText } from "gsap/SplitText";
import { FLICKER, formatCountUp, parseCountUp } from "./motion.ts";

gsap.registerPlugin(SplitText);

// flicker: false drops strobing effects; glowStatic: true shows the glow without animating it.
export type PresetOptions = { duration: number; stagger: number; ease: string; flicker?: boolean; glowStatic?: boolean };
export type Preset = (els: Element[], o: PresetOptions) => gsap.core.Timeline;

const none: Preset = () => gsap.timeline();

const fromPreset =
  (vars: gsap.TweenVars): Preset =>
  (els, o) =>
    gsap.timeline().from(els, { ...vars, duration: o.duration, stagger: o.stagger, ease: o.ease });

const toPreset =
  (vars: gsap.TweenVars): Preset =>
  (els, o) =>
    gsap.timeline().to(els, { ...vars, duration: o.duration, stagger: o.stagger, ease: o.ease });

const hold = { clearProps: "clipPath,filter" };

function split(els: Element[], type: "words" | "chars"): Element[][] {
  return els.map((el) => {
    const s = SplitText.create(el, { type });
    return type === "words" ? s.words : s.chars;
  });
}

function splitPreset(type: "words" | "chars", vars: gsap.TweenVars, divisor: number): Preset {
  return (els, o) => {
    const tl = gsap.timeline();
    split(els, type).forEach((parts, i) => {
      tl.from(parts, { ...vars, duration: o.duration, stagger: o.stagger / divisor, ease: o.ease }, i * o.stagger);
    });
    return tl;
  };
}

const typewriter: Preset = (els, o) => {
  const tl = gsap.timeline();
  split(els, "chars").forEach((chars, i) => {
    tl.from(
      chars,
      { autoAlpha: 0, duration: 0.01, stagger: o.duration / Math.max(chars.length, 1), ease: "steps(1)" },
      i * o.stagger,
    );
  });
  return tl;
};

// WCAG 2.3.1: FLICKER's dips (opacity 1 → 0.55 → 1), once, on every target at the same moment so no stagger
// multiplies the flashes on screen.
const flicker = (tl: gsap.core.Timeline, els: Element[], position?: gsap.Position): gsap.core.Timeline =>
  tl.to(
    els,
    { opacity: 0.55, duration: FLICKER.halfPeriod, repeat: FLICKER.dips * 2 - 1, yoyo: true, ease: "sine.inOut" },
    position,
  );

const glitchIn: Preset = (els, o) => {
  const tl = gsap.timeline();
  tl.from(els, {
    opacity: 0, x: -14, skewX: -24, duration: o.duration * 0.6, stagger: o.stagger, ease: "steps(4)",
  });
  if (o.flicker !== false) flicker(tl, els, ">");
  return tl;
};

const glitchOut: Preset = (els, o) => {
  const tl = gsap.timeline();
  if (o.flicker === false) return tl.to(els, { opacity: 0, duration: o.duration, stagger: o.stagger, ease: o.ease });
  flicker(tl, els);
  tl.to(els, { opacity: 0, x: 14, skewX: 24, duration: o.duration * 0.6, stagger: o.stagger, ease: "steps(3)" });
  return tl;
};

export const ENTER_PRESETS: Record<string, Preset> = {
  none,
  fade: fromPreset({ opacity: 0 }),
  fadeUp: fromPreset({ opacity: 0, y: 24 }),
  fadeDown: fromPreset({ opacity: 0, y: -24 }),
  slideLeft: fromPreset({ opacity: 0, x: 60 }),
  slideRight: fromPreset({ opacity: 0, x: -60 }),
  scaleIn: fromPreset({ opacity: 0, scale: 0.8 }),
  clipReveal: fromPreset({ clipPath: "inset(0 100% 0 0)", ...hold }),
  typewriter,
  splitWords: splitPreset("words", { opacity: 0, y: 20 }, 1),
  splitChars: splitPreset("chars", { opacity: 0, y: 12 }, 4),
  glitchIn,
  bounceIn: (els, o) =>
    gsap.timeline().from(els, { opacity: 0, y: -48, duration: o.duration, stagger: o.stagger, ease: "bounce.out" }),
  blurIn: fromPreset({ opacity: 0, filter: "blur(12px)", ...hold }),
  stepIn: (els, o) =>
    gsap.timeline().from(els, { opacity: 0, y: 14, duration: o.duration, stagger: o.stagger, ease: "steps(5)" }),
};

export const EXIT_PRESETS: Record<string, Preset> = {
  none,
  fade: toPreset({ opacity: 0 }),
  fadeDown: toPreset({ opacity: 0, y: 24 }),
  slideLeft: toPreset({ opacity: 0, x: -60 }),
  scaleOut: toPreset({ opacity: 0, scale: 0.85 }),
  glitchOut,
  blurOut: toPreset({ opacity: 0, filter: "blur(12px)" }),
};

// Transforms ignore inline boxes, so emphasis on inline phrases temporarily becomes inline-block.
function transformable(els: Element[], tl: gsap.core.Timeline, tween: (tl: gsap.core.Timeline) => void): gsap.core.Timeline {
  const inline = els.filter((el) => getComputedStyle(el).display === "inline");
  if (inline.length) tl.set(inline, { display: "inline-block" });
  tween(tl);
  if (inline.length) tl.set(inline, { clearProps: "display" });
  return tl;
}

const sweepImage = (color: string) => `linear-gradient(${color}, ${color})`;

function sweepPreset(image: string, size: string): Preset {
  return (els, o) =>
    gsap
      .timeline()
      .set(els, { backgroundImage: image, backgroundRepeat: "no-repeat", backgroundPosition: "0 100%" })
      .fromTo(
        els,
        { backgroundSize: `0% ${size}` },
        { backgroundSize: `100% ${size}`, duration: o.duration, stagger: o.stagger, ease: o.ease },
      );
}

// A GSAP revert cannot undo textContent, so owners of a reverted slide call this to put authored text back.
export function restoreCountUps(scope: ParentNode): void {
  for (const el of scope.querySelectorAll<HTMLElement>("[data-df-final]")) el.textContent = el.dataset.dfFinal ?? "";
}

/**
 * The targets countUp may rewrite. Counting replaces textContent, which would destroy any child element
 * (trend glyph, emphasis mark), and a target nested in another would be counted twice, so only leaf
 * targets with no other target above or below them qualify.
 */
export function countUpTargets(els: Element[]): Element[] {
  return els.filter(
    (el) => el.childElementCount === 0 && !els.some((other) => other !== el && (other.contains(el) || el.contains(other))),
  );
}

const countUp: Preset = (els, o) => {
  const tl = gsap.timeline();
  countUpTargets(els).forEach((el, i) => {
    // An interrupted count leaves partial text behind, so remember the authored value once.
    const data = (el as HTMLElement).dataset;
    const original = (data.dfFinal ??= el.textContent ?? "");
    const parsed = parseCountUp(original);
    if (!parsed) return;
    const proxy = { v: 0 };
    el.textContent = formatCountUp(parsed, 0);
    tl.to(
      proxy,
      {
        v: parsed.value,
        duration: o.duration * 2,
        ease: o.ease,
        onUpdate: () => {
          el.textContent = formatCountUp(parsed, proxy.v);
        },
        onComplete: () => {
          el.textContent = original;
        },
      },
      i * o.stagger,
    );
  });
  return tl;
};

const beat = (scale: number, repeat: number, ease: string): Preset => (els, o) =>
  transformable(els, gsap.timeline(), (tl) => {
    tl.to(els, {
      scale, duration: o.duration * 0.4, repeat, yoyo: true, ease, stagger: o.stagger, clearProps: "transform",
    });
  });

const glow: Preset = (els, o) => {
  const off = "0 0 0px currentColor";
  const on = "0 0 18px currentColor";
  const tl = gsap.timeline();
  if (!els.length) return tl;
  if (o.glowStatic) return tl.set(els, { textShadow: on });
  if (o.flicker !== false) flicker(tl, els);
  return tl.fromTo(els, { textShadow: off }, { textShadow: on, duration: o.duration, stagger: o.stagger, ease: o.ease });
};

const colorShift: Preset = (els, o) => {
  const tl = gsap.timeline();
  if (!els.length) return tl;
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--df-accent-text").trim();
  if (accent) tl.to(els, { color: accent, duration: o.duration, stagger: o.stagger, ease: o.ease });
  return tl;
};

export const EMPHASIS_PRESETS: Record<string, Preset> = {
  none,
  pulse: (els, o) =>
    transformable(els, gsap.timeline(), (tl) => {
      tl.to(els, {
        scale: 1.06, opacity: 0.75, duration: o.duration * 0.4, repeat: 3, yoyo: true, ease: "sine.inOut",
        stagger: o.stagger, clearProps: "transform,opacity",
      });
    }),
  underlineSweep: sweepPreset(sweepImage("currentColor"), "0.12em"),
  countUp,
  highlightSweep: sweepPreset(sweepImage("color-mix(in srgb, var(--df-accent) 35%, transparent)"), "100%"),
  glow,
  wobble: (els, o) =>
    transformable(els, gsap.timeline(), (tl) => {
      tl.to(els, {
        rotation: 3, duration: o.duration / 6, repeat: 5, yoyo: true, ease: "sine.inOut", stagger: o.stagger,
        clearProps: "transform",
      });
    }),
  scaleBeat: beat(1.15, 3, "back.out(2)"),
  colorShift,
};

export const TRANSITIONS: Record<string, "none" | "fade" | "slide" | "convex" | "concave" | "zoom"> = {
  none: "none",
  fade: "fade",
  slide: "slide",
  convex: "convex",
  concave: "concave",
  zoom: "zoom",
  cut: "none",
  wipe: "none",
};
