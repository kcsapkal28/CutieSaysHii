// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initMotion, slideMotion, type RevealApi } from "../src/runtime/engine.ts";

type Handler = Parameters<RevealApi["on"]>[1];

function fakeReveal() {
  const handlers: Record<string, Handler[]> = {};
  const api: RevealApi = {
    on: (event, cb) => void (handlers[event] ??= []).push(cb),
    getCurrentSlide: () => document.querySelector<HTMLElement>("#s01")!,
  };
  const emit = (event: string, e: Parameters<Handler>[0]) => handlers[event]?.forEach((h) => h(e));
  return { api, emit };
}

const slide = (id: string, attrs: string) =>
  `<section id="${id}" ${attrs}><h2 data-motion-el>Title</h2><p data-motion-el>Body <mark data-emphasis>key</mark></p>` +
  `<span data-motion-el data-count-up>42%</span></section>`;

function mount() {
  document.body.innerHTML =
    `<div class="reveal" data-motion-timing='{"enter":0.6,"stagger":0.08,"transition":0.5,"easing":"power2.out"}' data-motion-reduced="fadeOnly"><div class="slides">` +
    slide("s01", `data-motion-enter="fadeUp" data-motion-emphasis="countUp" data-motion-exit="fade"`) +
    slide("s02", `data-motion-enter="splitWords" data-motion-emphasis="underlineSweep" data-motion-exit="glitchOut" data-motion-transition="wipe"`) +
    `</div></div>`;
  const el = (id: string) => document.getElementById(id)!;
  return { s1: el("s01"), s2: el("s02") };
}

beforeEach(() => {
  delete document.documentElement.dataset.dfMotion;
  delete document.documentElement.dataset.dfMotionIdle;
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("initMotion", () => {
  it("animates on ready, then settles to idle and restores authored text", async () => {
    const { s1 } = mount();
    const { api, emit } = fakeReveal();
    initMotion(api);
    expect(document.documentElement.dataset.dfMotionIdle).toBe("false");
    emit("ready", { currentSlide: s1 });
    expect(document.documentElement.dataset.dfMotionIdle).toBe("false");
    expect(s1.querySelector("[data-count-up]")!.textContent).toBe("0%");
    await vi.waitFor(() => expect(document.documentElement.dataset.dfMotionIdle).toBe("true"), { timeout: 5000 });
    expect(s1.querySelector("[data-count-up]")!.textContent).toBe("42%");
  });

  it("runs through slide changes with wipe, split text and exit without throwing", async () => {
    const { s1, s2 } = mount();
    const { api, emit } = fakeReveal();
    initMotion(api);
    emit("ready", { currentSlide: s1 });
    emit("slidechanged", { currentSlide: s2, previousSlide: s1 });
    emit("slidechanged", { currentSlide: s1, previousSlide: s2 });
    await vi.waitFor(() => expect(document.documentElement.dataset.dfMotionIdle).toBe("true"), { timeout: 5000 });
    expect(s1.querySelector("h2")!.textContent).toBe("Title");
    expect(s2.querySelector("h2")!.textContent).toBe("Title");
  });

  it("?df-motion=off leaves content untouched and marks the document", () => {
    window.history.replaceState(null, "", "/?df-motion=off");
    const { s1 } = mount();
    const { api, emit } = fakeReveal();
    initMotion(api);
    emit("ready", { currentSlide: s1 });
    expect(document.documentElement.dataset.dfMotion).toBe("off");
    expect(document.documentElement.dataset.dfMotionIdle).toBe("true");
    expect(s1.querySelector("[data-count-up]")!.textContent).toBe("42%");
  });

  it("starts not idle, and only goes idle once the first enter has run", async () => {
    const { s1 } = mount();
    const { api, emit } = fakeReveal();
    initMotion(api);
    expect(document.documentElement.dataset.dfMotionIdle).toBe("false");
    emit("ready", { currentSlide: s1 });
    await vi.waitFor(() => expect(document.documentElement.dataset.dfMotionIdle).toBe("true"), { timeout: 5000 });
  });

  it("?df-motion=off goes idle only after ready", () => {
    window.history.replaceState(null, "", "/?df-motion=off");
    const { s1 } = mount();
    const { api, emit } = fakeReveal();
    initMotion(api);
    expect(document.documentElement.dataset.dfMotionIdle).toBe("false");
    emit("ready", { currentSlide: s1 });
    expect(document.documentElement.dataset.dfMotionIdle).toBe("true");
  });

  it("keeps the exited slide in its exit end state after the exit completes", async () => {
    const { s1, s2 } = mount();
    const { api, emit } = fakeReveal();
    initMotion(api);
    emit("ready", { currentSlide: s1 });
    emit("slidechanged", { currentSlide: s2, previousSlide: s1 });
    await vi.waitFor(() => expect(document.documentElement.dataset.dfMotionIdle).toBe("true"), { timeout: 5000 });
    expect(s1.querySelector<HTMLElement>("h2")!.style.opacity).toBe("0");
  });

  it("restores authored count-up text when the overview opens mid-count", () => {
    const { s1 } = mount();
    const { api, emit } = fakeReveal();
    initMotion(api);
    emit("ready", { currentSlide: s1 });
    const stat = s1.querySelector("[data-count-up]")!;
    expect(stat.textContent).toBe("0%");
    emit("overviewshown", { currentSlide: s1 });
    expect(stat.textContent).toBe("42%");
  });

  it("shows the final count-up text when the slide is left mid-count", () => {
    const { s1, s2 } = mount();
    const { api, emit } = fakeReveal();
    initMotion(api);
    emit("ready", { currentSlide: s1 });
    emit("slidechanged", { currentSlide: s2, previousSlide: s1 });
    expect(s1.querySelector("[data-count-up]")!.textContent).toBe("42%");
  });

  it("fails closed to fadeOnly when data-motion-reduced is missing or empty", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const { s1 } = mount();
    for (const value of [null, "", "  "]) {
      const reveal = document.querySelector<HTMLElement>(".reveal")!;
      if (value === null) reveal.removeAttribute("data-motion-reduced");
      else reveal.setAttribute("data-motion-reduced", value);
      expect(slideMotion(s1)).toMatchObject({ enter: "fade", emphasis: "none", exit: "fade" });
    }
  });

  it("keeps full motion for a same template under reduced motion", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const { s1 } = mount();
    document.querySelector(".reveal")!.setAttribute("data-motion-reduced", "same");
    expect(slideMotion(s1)).toMatchObject({ enter: "fadeUp", emphasis: "countUp" });
  });

  it("falls back to fade-only when reduced motion is preferred", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const { s1 } = mount();
    const { api, emit } = fakeReveal();
    initMotion(api);
    emit("ready", { currentSlide: s1 });
    // fadeOnly drops countUp, so the stat text is never rewritten
    expect(s1.querySelector("[data-count-up]")!.textContent).toBe("42%");
  });
});
