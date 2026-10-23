/// <reference lib="dom" />
import { gsap } from "gsap";
import { parseReducedMotion, resolveSlideMotion, type ReducedFlags, type SlideMotion } from "./motion.ts";
import {
  EMPHASIS_PRESETS,
  ENTER_PRESETS,
  EXIT_PRESETS,
  restoreCountUps,
  type Preset,
  type PresetOptions,
} from "./presets.ts";

export type RevealApi = {
  on(
    event: "ready" | "slidechanged" | "overviewshown",
    cb: (e: { currentSlide: HTMLElement; previousSlide?: HTMLElement }) => void,
  ): void;
  getCurrentSlide(): HTMLElement;
};

type Timing = { enter: number; stagger: number; transition: number; easing: string };

const DEFAULT_TIMING: Timing = { enter: 0.6, stagger: 0.08, transition: 0.5, easing: "power2.out" };
const EXIT_DURATION = 0.3;
const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

const root = () => document.querySelector<HTMLElement>(".reveal");

export function motionOff(): boolean {
  return new URLSearchParams(location.search).get("df-motion") === "off";
}

function readTiming(): Timing {
  try {
    const parsed: unknown = JSON.parse(root()?.dataset.motionTiming ?? "{}");
    return { ...DEFAULT_TIMING, ...(typeof parsed === "object" && parsed ? parsed : {}) };
  } catch {
    return DEFAULT_TIMING;
  }
}

// Returns the template's reduced-motion flags, or null when the viewer has no such preference.
function activeReduced(): ReducedFlags | null {
  if (typeof matchMedia !== "function" || !matchMedia(REDUCED_QUERY).matches) return null;
  // Missing, empty or unparsable values fail closed: a reduced-motion viewer gets the safest fallback.
  try {
    return parseReducedMotion(root()?.dataset.motionReduced?.trim() || "fadeOnly");
  } catch {
    return parseReducedMotion("fadeOnly");
  }
}

export function slideMotion(section: HTMLElement): SlideMotion {
  const d = section.dataset;
  return resolveSlideMotion(
    {
      transition: d.motionTransition ?? "none",
      enter: d.motionEnter ?? "none",
      emphasis: d.motionEmphasis ?? "none",
      exit: d.motionExit ?? "none",
      easing: d.motionEasing ?? readTiming().easing,
    },
    activeReduced(),
  );
}

const pick = (presets: Record<string, Preset>, name: string): Preset => presets[name] ?? (() => gsap.timeline());

type SlideState = { contexts: gsap.Context[]; timelines: Set<gsap.core.Animation> };

export function initMotion(reveal: RevealApi): void {
  const html = document.documentElement;
  const active = new Set<gsap.core.Animation>();
  const states = new WeakMap<Element, SlideState>();

  const touched = new Set<Element>();
  let ran = false;

  // Idle only means something once the first run has built its timelines.
  const refreshIdle = () => {
    html.dataset.dfMotionIdle = ran && active.size === 0 ? "true" : "false";
  };

  html.dataset.dfMotionIdle = "false";
  if (motionOff()) {
    html.dataset.dfMotion = "off";
    reveal.on("ready", () => {
      html.dataset.dfMotionIdle = "true";
    });
    return;
  }

  const stateOf = (section: Element): SlideState => {
    let s = states.get(section);
    if (!s) {
      states.set(section, (s = { contexts: [], timelines: new Set() }));
      touched.add(section);
    }
    return s;
  };

  // Reverting restores inline styles and split text, so a revisited slide starts from its authored state.
  const revertSlide = (section: Element) => {
    const s = states.get(section);
    if (!s) return;
    for (const ctx of s.contexts.reverse()) ctx.revert();
    restoreCountUps(section);
    for (const t of s.timelines) active.delete(t);
    s.contexts = [];
    s.timelines.clear();
    refreshIdle();
  };

  const track = (section: Element, tl: gsap.core.Timeline) => {
    if (tl.duration() === 0) return;
    stateOf(section).timelines.add(tl);
    active.add(tl);
    tl.eventCallback("onComplete", () => {
      active.delete(tl);
      refreshIdle();
    });
  };

  // Freeze whatever the slide was doing so an exit starts from its current look.
  const freeze = (section: Element) => {
    const s = states.get(section);
    if (!s) return;
    for (const t of s.timelines) {
      t.pause();
      active.delete(t);
    }
    s.timelines.clear();
    restoreCountUps(section);
  };

  const motionEls = (section: Element) => [...section.querySelectorAll("[data-motion-el]")];

  const options = (m: SlideMotion, reduced: ReducedFlags | null, duration: number, stagger: number): PresetOptions => ({
    duration,
    stagger,
    ease: m.easing,
    flicker: !reduced?.flicker,
    glowStatic: reduced?.glowStatic ?? false,
  });

  const exitSlide = (section: HTMLElement) => {
    freeze(section);
    const m = slideMotion(section);
    const reduced = activeReduced();
    const ctx = gsap.context(() => {
      const tl = pick(EXIT_PRESETS, m.exit)(motionEls(section), options(m, reduced, EXIT_DURATION, 0));
      // The exit end state stays until the slide is entered again (or the overview opens): Reveal keeps the
      // outgoing slide on screen for longer than the exit lasts.
      track(section, tl);
    });
    stateOf(section).contexts.push(ctx);
  };

  const enterSlide = (section: HTMLElement, transitioned: boolean) => {
    revertSlide(section);
    const timing = readTiming();
    const m = slideMotion(section);
    const reduced = activeReduced();
    const ctx = gsap.context(() => {
      const master = gsap.timeline();
      if (transitioned && m.transition === "wipe") {
        master.fromTo(
          section,
          { clipPath: "inset(0 100% 0 0)" },
          { clipPath: "inset(0 0% 0 0)", duration: timing.transition, ease: m.easing, clearProps: "clipPath" },
          0,
        );
      }
      const els = motionEls(section);
      master.add(pick(ENTER_PRESETS, m.enter)(els, options(m, reduced, timing.enter, timing.stagger)), 0);
      // Emphasis targets are read after the enter preset has split any text.
      const selector = m.emphasis === "countUp" ? "[data-emphasis], [data-count-up]" : "[data-emphasis]";
      const targets = [...section.querySelectorAll(selector)];
      master.add(pick(EMPHASIS_PRESETS, m.emphasis)(targets, options(m, reduced, timing.enter, timing.stagger)), ">");
      track(section, master);
    });
    stateOf(section).contexts.push(ctx);
  };

  const run = (current: HTMLElement, previous?: HTMLElement) => {
    if (previous && previous !== current) exitSlide(previous);
    enterSlide(current, previous !== undefined);
    ran = true;
    refreshIdle();
  };

  reveal.on("ready", (e) => run(e.currentSlide));
  reveal.on("slidechanged", (e) => run(e.currentSlide, e.previousSlide));
  reveal.on("overviewshown", () => {
    for (const section of touched) revertSlide(section);
    refreshIdle();
  });
}
