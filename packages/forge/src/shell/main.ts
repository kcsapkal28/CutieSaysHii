/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
// The in-page runtime. Bundled by esbuild into one classic-script IIFE that defines `window.DF`.
// Slide scripts call DF.slide(id, factory) while the page parses; the bundler's last script calls DF.boot().
import type { FrameCallback, ShellConfig, SlideApi, SlideFactory, SlideInstance, ThreeKit, ThreeOptions } from "./types.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyObj = any;

declare global {
  interface Window {
    DF: { slide(id: string, factory: SlideFactory): void; boot(): void; go(index: number, step?: number): void };
    THREE?: AnyObj;
    gsap?: AnyObj;
    __dfReady: Promise<void>;
    __dfSteps?: number;
    __dfErrors: string[];
    __dfGoto?: (step: number) => Promise<void>;
  }
}

const W = 1920;
const H = 1080;
const DOCK_H = 72;
const KEEP_ALIVE = 2; // slides further than this from the current one are disposed

type Rec = {
  id: string;
  index: number;
  el: HTMLElement;
  html: string;
  notes: string;
  meta: ShellConfig["slides"][number];
  inst?: SlideInstance;
  steps: number;
  step: number;
  frames: Set<FrameCallback>;
  resizes: Set<(scale: number) => void>;
  cleanups: (() => void)[];
  ctx?: AnyObj;
  paused: AnyObj[];
  t0: number;
};

// ---------------------------------------------------------------- errors & shot-mode globals
const errors: string[] = [];
window.__dfErrors = errors;
let resolveReady: () => void = () => {};
window.__dfReady = new Promise<void>((r) => (resolveReady = r));

const factories = new Map<string, SlideFactory>();
let recs: Rec[] = [];
let active: Rec | undefined;
let config: ShellConfig;
let scale = 1;
let booted = false;

const params = new URLSearchParams(location.search);
const shotId = params.get("df-shot");
const shot = shotId !== null;

function message(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}${err.stack ? `\n${err.stack.split("\n").slice(1, 4).join("\n")}` : ""}`;
  return String(err);
}

/** Records an error the shell caught while running slide code (also visible as a console error). */
function report(slide: string, err: unknown): void {
  const text = `[${slide}] ${message(err)}`;
  errors.push(text);
  console.error(`[df:${slide}] ${message(err)}`);
}

window.addEventListener("error", (e) => {
  errors.push(`[${active?.id ?? "deck"}] ${e.message}`);
});
window.addEventListener("unhandledrejection", (e) => {
  errors.push(`[${active?.id ?? "deck"}] unhandled rejection: ${message(e.reason)}`);
});

// ---------------------------------------------------------------- helpers
const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T | null;
function h(tag: string, cls = "", html = ""): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}
const frames = (n: number) =>
  new Promise<void>((resolve) => {
    let k = 0;
    const tick = () => (++k >= n ? resolve() : requestAnimationFrame(tick));
    requestAnimationFrame(tick);
  });
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const fmt = (sec: number) => {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const reducedMotion = () =>
  config.motion === "none" || (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);

/** Forces finite GSAP tweens and CSS/Web animations to their end state. Infinite (ambient) ones keep running. */
function settle(): void {
  const g = window.gsap;
  if (g) {
    for (let pass = 0; pass < 6; pass++) {
      let changed = false;
      for (const t of g.globalTimeline.getChildren(false, true, true)) {
        if (t.paused() || t.repeat() === -1) continue;
        if (t.totalProgress() < 1) {
          t.totalProgress(1);
          changed = true;
        }
      }
      if (!changed) break;
    }
  }
  if (typeof document.getAnimations === "function") {
    for (const a of document.getAnimations()) {
      try {
        if (a.effect?.getComputedTiming().iterations !== Infinity && a.playState !== "finished") a.finish();
      } catch {
        /* an animation that cannot finish (e.g. zero duration, infinite) is left alone */
      }
    }
  }
}

/** Runs slide code inside the slide's GSAP context so its tweens can be paused and killed with it. */
function run<T>(rec: Rec, fn: () => T): T | undefined {
  let out: T | undefined;
  try {
    if (rec.ctx) rec.ctx.add(() => (out = fn()));
    else out = fn();
  } catch (e) {
    report(rec.id, e);
  }
  return out;
}

// ---------------------------------------------------------------- three helper
function pixelRatio(): number {
  return clamp((window.devicePixelRatio || 1) * scale, 0.75, 2);
}

function disposeScene(scene: AnyObj): void {
  scene.traverse((o: AnyObj) => {
    o.geometry?.dispose?.();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      for (const v of Object.values(m)) if ((v as AnyObj)?.isTexture) (v as AnyObj).dispose();
      m.dispose?.();
    }
  });
  scene.environment?.dispose?.();
  if (scene.background?.isTexture) scene.background.dispose();
}

function makeThree(rec: Rec, target: HTMLElement, opts: ThreeOptions = {}): ThreeKit {
  const T = window.THREE;
  if (!T) throw new Error("api.three: Three.js is not in this deck (the bundler adds it when a slide mentions THREE or api.three)");
  const created = !(target instanceof HTMLCanvasElement);
  const canvas = created ? (h("canvas", "df-three") as HTMLCanvasElement) : (target as HTMLCanvasElement);
  if (created) target.appendChild(canvas);
  const sizeEl = created ? target : canvas;

  const renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: "high-performance" });
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.NeutralToneMapping ?? T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = opts.exposure ?? 1;
  renderer.setClearColor(0x000000, 0);
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(opts.fov ?? 35, 16 / 9, 0.1, 500);
  camera.position.set(0, 0, 10);
  if (opts.environment !== false && T.RoomEnvironment) {
    const pmrem = new T.PMREMGenerator(renderer);
    const room = new T.RoomEnvironment();
    scene.environment = pmrem.fromScene(room, 0.04).texture;
    room.dispose?.();
    pmrem.dispose();
    scene.environmentIntensity = opts.environmentIntensity ?? 1;
  }

  const kit: ThreeKit = {
    renderer,
    scene,
    camera,
    canvas,
    render: () => renderer.render(scene, camera),
    resize() {
      const w = Math.max(1, sizeEl.clientWidth);
      const hgt = Math.max(1, sizeEl.clientHeight);
      renderer.setPixelRatio(pixelRatio());
      renderer.setSize(w, hgt, false);
      camera.aspect = w / hgt;
      camera.updateProjectionMatrix();
    },
    toSlide(p) {
      const v = new T.Vector3(p.x, p.y, p.z).project(camera);
      // Offset of the canvas inside the slide, in unscaled slide pixels.
      const cr = canvas.getBoundingClientRect();
      const sr = rec.el.getBoundingClientRect();
      const ox = (cr.left - sr.left) / scale;
      const oy = (cr.top - sr.top) / scale;
      return { x: ox + ((v.x + 1) / 2) * canvas.clientWidth, y: oy + ((1 - v.y) / 2) * canvas.clientHeight };
    },
  };
  kit.resize();
  rec.resizes.add(() => kit.resize());
  rec.cleanups.push(() => {
    disposeScene(scene);
    renderer.dispose();
    renderer.forceContextLoss?.();
    if (created) canvas.remove();
  });
  return kit;
}

// ---------------------------------------------------------------- slide lifecycle
function makeApi(rec: Rec): SlideApi {
  return {
    el: rec.el,
    id: rec.id,
    THREE: window.THREE,
    gsap: window.gsap,
    theme: config.theme,
    motion: config.motion,
    reducedMotion: reducedMotion(),
    shot,
    onFrame(cb) {
      rec.frames.add(cb);
      return () => rec.frames.delete(cb);
    },
    onResize(cb) {
      rec.resizes.add(cb);
      return () => rec.resizes.delete(cb);
    },
    on(target, type, fn, opts) {
      target.addEventListener(type, fn, opts);
      rec.cleanups.push(() => target.removeEventListener(type, fn, opts));
    },
    three: (el, opts) => makeThree(rec, el, opts),
  };
}

function create(rec: Rec): void {
  rec.el.innerHTML = rec.html;
  rec.frames.clear();
  rec.resizes.clear();
  rec.cleanups = [];
  rec.paused = [];
  rec.ctx = window.gsap?.context(() => {}, rec.el);
  const factory = factories.get(rec.id);
  let inst: SlideInstance | void = undefined;
  if (factory) inst = run(rec, () => factory(makeApi(rec)));
  rec.inst = inst && typeof inst === "object" ? inst : {};
  const n = Math.floor(Number(rec.inst.steps));
  rec.steps = Number.isFinite(n) && n >= 1 ? n : 1;
}

function dispose(rec: Rec): void {
  if (!rec.inst) return;
  const inst = rec.inst;
  if (inst.dispose) run(rec, () => inst.dispose!());
  try {
    rec.ctx?.kill();
  } catch (e) {
    report(rec.id, e);
  }
  for (const fn of rec.cleanups.splice(0)) {
    try {
      fn();
    } catch (e) {
      report(rec.id, e);
    }
  }
  rec.frames.clear();
  rec.resizes.clear();
  rec.inst = undefined;
  rec.ctx = undefined;
  rec.el.innerHTML = rec.html;
}

function pauseTweens(rec: Rec): void {
  const tweens: AnyObj[] = rec.ctx?.getTweens?.() ?? [];
  rec.paused = tweens.filter((t) => !t.paused() && t.totalProgress() < 1);
  for (const t of rec.paused) t.pause();
}
function resumeTweens(rec: Rec): void {
  for (const t of rec.paused) t.resume();
  rec.paused = [];
}

function setStep(rec: Rec, i: number): void {
  rec.step = clamp(i, 0, rec.steps - 1);
  const inst = rec.inst;
  if (inst?.step) run(rec, () => inst.step!(rec.step));
  if (config.motion === "none") settle();
}

// ---------------------------------------------------------------- navigation
let timerStarted = false;
function go(index: number, step: number | "last" = 0): void {
  if (!recs.length) return;
  const rec = recs[clamp(index, 0, recs.length - 1)]!;
  if (booted && !shot && !timerStarted && (rec !== active || step !== active?.step)) startTimer();
  if (rec === active) {
    setStep(rec, step === "last" ? rec.steps - 1 : step);
    updateChrome();
    return;
  }
  const prev = active;
  if (prev?.inst) {
    const inst = prev.inst;
    if (inst.leave) run(prev, () => inst.leave!());
    pauseTweens(prev);
    prev.el.classList.remove("df-active");
    prev.el.setAttribute("aria-hidden", "true");
  }
  active = rec;
  if (!rec.inst) create(rec);
  else resumeTweens(rec);
  rec.t0 = performance.now();
  slideStart = performance.now();
  rec.el.classList.add("df-active");
  rec.el.removeAttribute("aria-hidden");
  const inst = rec.inst!;
  if (inst.enter) run(rec, () => inst.enter!());
  setStep(rec, step === "last" ? rec.steps - 1 : step);
  for (const r of recs) if (r.inst && Math.abs(r.index - rec.index) > KEEP_ALIVE) dispose(r);
  updateChrome();
}

function next(): void {
  if (!active) return;
  if (active.step < active.steps - 1) go(active.index, active.step + 1);
  else if (active.index < recs.length - 1) go(active.index + 1, 0);
}
function prev(): void {
  if (!active) return;
  if (active.step > 0) go(active.index, active.step - 1);
  else if (active.index > 0) go(active.index - 1, "last");
}

// ---------------------------------------------------------------- frame loop & fit
let last = performance.now();
function loop(now: number): void {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const rec = active;
  if (rec?.inst) {
    const t = (now - rec.t0) / 1000;
    for (const cb of rec.frames) {
      try {
        cb(t, dt);
      } catch (e) {
        report(rec.id, e);
        rec.frames.delete(cb);
      }
    }
  }
  if (timerStarted) tickTimer();
}

let hasDock = false;
function fit(): void {
  const stage = $("#df-stage")!;
  const total = H + (hasDock ? DOCK_H : 0);
  const s = shot ? 1 : Math.min(innerWidth / W, innerHeight / total);
  const x = shot ? 0 : (innerWidth - W * s) / 2;
  const y = shot ? 0 : (innerHeight - total * s) / 2;
  stage.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
  const changed = s !== scale;
  scale = s;
  if (changed || !booted) {
    for (const r of recs) {
      for (const cb of r.resizes) {
        try {
          cb(s);
        } catch (e) {
          report(r.id, e);
        }
      }
    }
  }
}

// ---------------------------------------------------------------- chrome: progress, dock, timer, notes
let slideStart = performance.now();
let runStart = 0;
let runAccum = 0;
let running = false;

function startTimer(): void {
  if (!config.features.timer) return;
  timerStarted = true;
  running = true;
  runStart = performance.now();
  slideStart = performance.now();
}
function elapsed(): number {
  return (runAccum + (running ? performance.now() - runStart : 0)) / 1000;
}
function toggleTimer(): void {
  if (!config.features.timer) return;
  if (!timerStarted) return startTimer();
  if (running) {
    runAccum += performance.now() - runStart;
    running = false;
  } else {
    running = true;
    runStart = performance.now();
  }
  tickTimer();
}

const budget = (r: Rec) => r.meta.budgetSec ?? 60;
let lastTimerText = "";
function tickTimer(): void {
  const box = $("#df-timer");
  if (!box || !active) return;
  const total = recs.reduce((a, r) => a + budget(r), 0);
  const before = recs.slice(0, active.index).reduce((a, r) => a + budget(r), 0);
  const el = elapsed();
  const onSlide = running || timerStarted ? (performance.now() - slideStart) / 1000 : 0;
  const planned = before + Math.min(onSlide, budget(active));
  const delta = planned - el;
  const frac = clamp(onSlide / budget(active), 0, 1);
  const state = !timerStarted ? "idle" : delta >= 0 ? "ahead" : "behind";
  const text = `${state}|${fmt(Math.abs(delta))}|${fmt(el)}|${fmt(total)}|${Math.round(frac * 100)}|${running}`;
  if (text === lastTimerText) return;
  lastTimerText = text;
  box.dataset.state = state;
  box.dataset.running = String(running);
  $("#df-timer-delta")!.textContent = !timerStarted ? "ready" : `${fmt(Math.abs(delta))} ${state}`;
  $("#df-timer-clock")!.innerHTML = `${fmt(el)}<span> / ${fmt(total)}</span>`;
  $("#df-timer-ring")!.style.setProperty("--p", String(frac));
}

function buildChrome(): void {
  const stage = $("#df-stage")!;
  const f = config.features;
  stage.appendChild(h("div", "", "")).id = "df-progress";
  $("#df-progress")!.innerHTML = `<i></i>`;
  hasDock = !shot && (f.timer || f.notes || f.stepNav);
  if (!hasDock) return;
  document.documentElement.classList.add("df-has-dock");
  const dock = h("nav");
  dock.id = "df-dock";
  dock.setAttribute("aria-label", "Deck navigation");
  const arrow = (dir: "prev" | "next") =>
    `<button class="df-dock-btn" data-df="${dir}" aria-label="${dir === "prev" ? "Previous" : "Next"}"><svg viewBox="0 0 16 16" width="16" height="16"><path d="${dir === "prev" ? "M10 3 5 8l5 5" : "M6 3l5 5-5 5"}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;
  let mid: string;
  if (f.stepNav) {
    const groups: { name: string; slides: Rec[] }[] = [];
    for (const r of recs) {
      const name = r.meta.section ?? "";
      const g = groups[groups.length - 1];
      if (g && g.name === name) g.slides.push(r);
      else groups.push({ name, slides: [r] });
    }
    mid = `<div id="df-stepnav">${groups
      .map(
        (g) =>
          `<div class="df-sec" style="flex:${g.slides.length}"><button class="df-sec-name" data-df-go="${g.slides[0]!.index}">${esc(g.name || g.slides[0]!.meta.title)}</button><div class="df-segs">${g.slides
            .map((r) => `<button class="df-seg" data-df-go="${r.index}" title="${esc(r.meta.title)}"><i></i></button>`)
            .join("")}</div></div>`,
      )
      .join("")}</div>`;
  } else {
    mid = `<div id="df-dock-title"></div>`;
  }
  const timer = f.timer
    ? `<button id="df-timer" data-df="timer" title="Pacing timer (click to pause)"><i id="df-timer-ring"></i><span class="df-timer-budget"></span><span id="df-timer-delta"></span><span id="df-timer-clock"></span></button>`
    : "";
  const notes = f.notes ? `<button class="df-dock-pill" data-df="notes">Notes <kbd>N</kbd></button>` : "";
  dock.innerHTML = `${arrow("prev")}<div id="df-count"></div>${mid}${timer}${notes}${arrow("next")}`;
  stage.appendChild(dock);
  dock.addEventListener("click", (e) => {
    const b = (e.target as Element).closest("button");
    if (!b) return;
    e.stopPropagation();
    const what = b.getAttribute("data-df");
    if (what === "prev") prev();
    else if (what === "next") next();
    else if (what === "notes") toggleNotes();
    else if (what === "timer") toggleTimer();
    const to = b.getAttribute("data-df-go");
    if (to !== null) go(Number(to), 0);
  });
  if (f.notes) {
    const panel = h("aside");
    panel.id = "df-notes-panel";
    panel.setAttribute("aria-live", "polite");
    stage.appendChild(panel);
  }
}

let notesOpen = false;
function toggleNotes(): void {
  if (!config.features.notes || shot) return;
  notesOpen = !notesOpen;
  document.documentElement.classList.toggle("df-notes-open", notesOpen);
  updateChrome();
}

function updateChrome(): void {
  if (!active) return;
  const n = recs.length;
  const frac = (active.index + (active.step + 1) / active.steps) / n;
  const bar = $("#df-progress > i");
  if (bar) bar.style.transform = `scaleX(${frac})`;
  if (!shot) history.replaceState(null, "", `#${active.id}${active.step ? `.${active.step}` : ""}`);
  const count = $("#df-count");
  if (count) count.innerHTML = `<b>${String(active.index + 1).padStart(2, "0")}</b> / ${String(n).padStart(2, "0")}`;
  const title = $("#df-dock-title");
  if (title) title.textContent = active.meta.title;
  for (const seg of document.querySelectorAll<HTMLElement>(".df-seg")) {
    const i = Number(seg.dataset.dfGo);
    const fill = i < active.index ? 1 : i > active.index ? 0 : (active.step + 1) / active.steps;
    seg.classList.toggle("df-cur", i === active.index);
    (seg.firstElementChild as HTMLElement).style.transform = `scaleX(${fill})`;
  }
  for (const sec of document.querySelectorAll<HTMLElement>(".df-sec")) {
    sec.classList.toggle("df-cur", !!sec.querySelector(".df-seg.df-cur"));
  }
  const tb = $(".df-timer-budget");
  if (tb) tb.textContent = `slide ${fmt(budget(active))}`;
  lastTimerText = "";
  tickTimer();
  const panel = $("#df-notes-panel");
  if (panel && notesOpen) {
    const nxt = recs[active.index + 1];
    panel.innerHTML =
      `<header><span>Notes</span><b>${esc(active.meta.title)}</b><em>${active.step + 1} / ${active.steps}</em></header>` +
      `<div class="df-notes-body">${active.notes || "<p class=\"df-notes-empty\">No notes for this slide.</p>"}</div>` +
      (nxt ? `<footer>Next · ${esc(nxt.meta.title)}</footer>` : `<footer>Last slide</footer>`);
  }
}

// ---------------------------------------------------------------- input
const INTERACTIVE = "a,button,input,select,textarea,label,summary,[contenteditable],[role=button],[role=slider],.df-interactive,[data-df-no-advance]";

function onKey(e: KeyboardEvent): void {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target as HTMLElement | null;
  if (t?.closest?.("input,textarea,select,[contenteditable]")) {
    if (e.key === "Escape") t.blur();
    return;
  }
  switch (e.key) {
    case "ArrowRight":
    case "ArrowDown":
    case "PageDown":
    case " ":
      e.preventDefault();
      next();
      break;
    case "ArrowLeft":
    case "ArrowUp":
    case "PageUp":
    case "Backspace":
      e.preventDefault();
      prev();
      break;
    case "Home":
      go(0, 0);
      break;
    case "End":
      go(recs.length - 1, "last");
      break;
    case "n":
    case "N":
      toggleNotes();
      break;
    case "t":
    case "T":
      toggleTimer();
      break;
    case "f":
    case "F":
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen?.().catch(() => {});
      break;
  }
}

function onClick(e: MouseEvent): void {
  if (e.button !== 0) return;
  const t = e.target as Element;
  if (t.closest(INTERACTIVE) || t.closest("#df-notes-panel,#df-dock")) return;
  if (String(getSelection() ?? "").length > 0) return;
  if (e.shiftKey) prev();
  else next();
}

// ---------------------------------------------------------------- boot
async function bootShot(): Promise<void> {
  const index = recs.findIndex((r) => r.id === shotId);
  if (index < 0) {
    errors.push(`[deck] df-shot: unknown slide "${shotId}"`);
    console.error(`[df:deck] df-shot: unknown slide "${shotId}"`);
    window.__dfSteps = 0;
    resolveReady();
    return;
  }
  try {
    await document.fonts?.ready;
  } catch {
    /* fonts are inlined; a failure here only affects metrics */
  }
  const want = Math.max(0, Number(params.get("step") ?? 0) || 0);
  go(index, 0);
  const rec = recs[index]!;
  await frames(2);
  settle();
  for (let i = 1; i <= Math.min(want, rec.steps - 1); i++) {
    go(index, i);
    await frames(2);
    settle();
  }
  await frames(6);
  settle();
  await frames(4);
  window.__dfSteps = rec.steps;
  window.__dfGoto = async (n: number) => {
    const target = clamp(n, 0, rec.steps - 1);
    if (target <= rec.step) go(index, target);
    for (let i = rec.step + 1; i <= target; i++) {
      go(index, i);
      await frames(2);
      settle();
    }
    await frames(6);
    settle();
    await frames(4);
  };
  resolveReady();
}

function boot(): void {
  if (booted) return;
  const cfgEl = document.getElementById("df-config");
  config = JSON.parse(cfgEl?.textContent ?? "{}") as ShellConfig;
  config.features ??= { timer: false, notes: false, stepNav: false, print: false };
  const root = document.documentElement;
  if (shot) root.classList.add("df-shot");
  if (config.features.print) root.classList.add("df-print");
  if (reducedMotion()) root.classList.add("df-reduced");

  const sections = [...document.querySelectorAll<HTMLElement>("#df-slides > section.df-slide")];
  recs = sections.map((el, index) => {
    const notesEl = el.querySelector("aside.df-notes");
    const notes = notesEl?.innerHTML.trim() ?? "";
    notesEl?.remove();
    el.setAttribute("aria-hidden", "true");
    const meta = config.slides?.find((s) => s.id === el.id) ?? { id: el.id, title: el.id };
    return { id: el.id, index, el, html: el.innerHTML, notes, meta, steps: 1, step: 0, frames: new Set(), resizes: new Set(), cleanups: [], paused: [], t0: 0 };
  });
  for (const id of factories.keys()) {
    if (!recs.some((r) => r.id === id)) report("deck", new Error(`DF.slide("${id}") has no matching <section class="df-slide" id="${id}">`));
  }

  buildChrome();
  fit();
  addEventListener("resize", fit);
  requestAnimationFrame(loop);

  if (shot) {
    void bootShot();
  } else {
    addEventListener("keydown", onKey);
    $("#df-stage")!.addEventListener("click", onClick);
    const m = /^#(s\d{2})(?:\.(\d+))?$/.exec(location.hash);
    const start = m ? Math.max(0, recs.findIndex((r) => r.id === m[1])) : 0;
    go(start, m?.[2] ? Number(m[2]) : 0);
    resolveReady();
  }
  booted = true;
}

window.DF = {
  slide(id: string, factory: SlideFactory) {
    if (typeof factory !== "function") {
      report(id, new Error(`DF.slide("${id}", factory): factory must be a function`));
      return;
    }
    if (factories.has(id)) report(id, new Error(`DF.slide("${id}") registered twice`));
    factories.set(id, factory);
  },
  boot() {
    try {
      boot();
    } catch (e) {
      report("deck", e);
      resolveReady();
    }
  },
  go: (index: number, step = 0) => go(index, step),
};
