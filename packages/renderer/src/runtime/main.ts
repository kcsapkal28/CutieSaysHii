/// <reference lib="dom" />
import Reveal from "reveal.js";
import RevealNotes from "reveal.js/plugin/notes/notes.esm.js";
import { initMotion, motionOff, slideMotion } from "./engine.ts";
import { TRANSITIONS } from "./presets.ts";

declare global {
  interface Window {
    Reveal: typeof Reveal;
  }
}

const off = motionOff();
for (const section of document.querySelectorAll<HTMLElement>(".reveal .slides section")) {
  const wanted = off ? "none" : TRANSITIONS[slideMotion(section).transition];
  if (wanted) section.dataset.transition = wanted;
}

// initialize() resolves after "ready" has fired, so the motion listeners must be attached before it settles.
void Reveal.initialize({
  hash: true,
  width: 1920,
  height: 1080,
  margin: 0,
  controls: true,
  progress: true,
  slideNumber: "c/t",
  plugins: [RevealNotes],
});
window.Reveal = Reveal;
initMotion(Reveal);
