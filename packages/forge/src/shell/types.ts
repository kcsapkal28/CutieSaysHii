// Types of the in-page slide contract (the `DF` global). Shared by the shell runtime and by docs/prompts.
import type { Features, MotionLevel, Theme } from "../contract.ts";

/** What the bundler embeds as JSON for the shell (`<script type="application/json" id="df-config">`). */
export type ShellConfig = {
  title: string;
  theme: Theme;
  motion: MotionLevel;
  features: Features;
  slides: { id: string; title: string; section?: string; budgetSec?: number }[];
};

/** Called every animation frame while the slide is the visible one. `t` = seconds since enter, `dt` = seconds since last frame. */
export type FrameCallback = (t: number, dt: number) => void;

export type ThreeOptions = {
  /** Vertical field of view in degrees. Default 35. */
  fov?: number;
  /** Image-based studio lighting (RoomEnvironment through PMREM). Default true. */
  environment?: boolean;
  /** Scene environment intensity. Default 1. */
  environmentIntensity?: number;
  /** Renderer tone-mapping exposure. Default 1. */
  exposure?: number;
};

/** What `api.three(el)` returns. Everything is disposed automatically when the slide is torn down. */
export type ThreeKit = {
  // `any` keeps slides free of a compile-time dependency on three's types; in the page these are real THREE objects.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  renderer: any;
  scene: any;
  camera: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */
  canvas: HTMLCanvasElement;
  /** renderer.render(scene, camera). */
  render(): void;
  /** Projects a world-space point (THREE.Vector3 or {x,y,z}) to slide pixel coordinates (0..1920, 0..1080). */
  toSlide(p: { x: number; y: number; z: number }): { x: number; y: number };
  /** Re-reads the element size; called automatically on resize. */
  resize(): void;
};

export type SlideApi = {
  /** The slide's `<section class="df-slide">`. */
  el: HTMLElement;
  id: string;
  /* eslint-disable @typescript-eslint/no-explicit-any */
  /** Three.js namespace (plus `RoomEnvironment`, `RoundedBoxGeometry`), present when the deck bundles it. */
  THREE: any;
  /** GSAP. Tweens created inside the factory or lifecycle calls are killed on dispose. */
  gsap: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */
  theme: Theme;
  motion: MotionLevel;
  /** True when motion is "none" or the OS asks for reduced motion. */
  reducedMotion: boolean;
  /** True when the deck is being screenshotted (shot mode). Show a representative, settled state. */
  shot: boolean;
  onFrame(cb: FrameCallback): () => void;
  /** Called with the stage scale whenever the viewport changes. */
  onResize(cb: (scale: number) => void): () => void;
  /** addEventListener that is removed automatically on dispose (use for window/document listeners). */
  on(target: EventTarget, type: string, fn: (e: Event) => void, opts?: AddEventListenerOptions): void;
  /** Moves the deck to step `i` of this slide (for in-slide step tabs); the shell then calls `step(i)`. */
  setStep(i: number): void;
  /** Renderer + scene + camera sized to `el` (a canvas is used as-is; any other element gets a filling canvas). */
  three(el: HTMLElement, opts?: ThreeOptions): ThreeKit;
};

/** What a slide factory returns. All members are optional. `step(i)` must set state i (0..steps-1) from any prior state. */
export type SlideInstance = {
  steps?: number;
  enter?(): void;
  step?(i: number): void;
  leave?(): void;
  dispose?(): void;
};

export type SlideFactory = (api: SlideApi) => SlideInstance | void;
