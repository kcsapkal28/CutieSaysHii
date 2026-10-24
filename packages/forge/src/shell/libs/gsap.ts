/// <reference lib="dom" />
// esbuild entry: exposes GSAP as `window.gsap`.
import { gsap } from "gsap";

(window as unknown as { gsap: unknown }).gsap = gsap;
