// Hand-written slide files for the mock ANC deck, following the v2 slide contract
// (one <section class="df-slide">, slide-scoped <style>, one DF.slide script). The engine bundles them for real.
// Slide scripts avoid template literals so they can live inside these TS strings.
import { ANC_SCRIPT } from "./anc";

export interface SlideOpts {
  /** Animation speed multiplier (0.5 = half speed). */
  speed: number;
  /** Headline scale multiplier. */
  titleScale: number;
  /** Use the alternate (revised) caption copy. */
  altCopy: boolean;
}
export const DEFAULT_OPTS: SlideOpts = { speed: 1, titleScale: 1, altCopy: false };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function notes(id: string): string {
  const s = ANC_SCRIPT.slides.find((x) => x.id === id);
  return s ? `<aside class="df-notes"><p>${esc(s.narration)}</p></aside>` : "";
}

function caption(id: string, o: SlideOpts, base: string): string {
  const s = ANC_SCRIPT.slides.find((x) => x.id === id);
  return o.altCopy && s ? s.keyMessage : base;
}

const file = (id: string, section: string, css: string, js: string) =>
  `<section class="df-slide" id="${id}">\n${section}\n${notes(id)}\n</section>\n<style>\n${css}\n</style>\n<script>\n${js}\n</script>\n`;

// ------------------------------------------------------------------ s01 title + 3D earbud
function s01(o: SlideOpts): string {
  return file(
    "s01",
    `<div class="copy"><p class="df-eyebrow">Active noise cancellation</p><h1 class="df-h1 t">Inside <span class="df-grad">ANC</span></h1><p class="df-lede">The engineering behind silence</p></div>
<div class="obj"></div><div class="shadow"></div>
<p class="cap">${esc(caption("s01", o, "A wireless noise-cancelling earbud. Let’s look inside to see how signal processing makes it quieter."))}</p>`,
    `#s01 .copy { position: absolute; left: 140px; top: 330px; width: 900px; }
#s01 .t { font-size: ${Math.round(150 * o.titleScale)}px; letter-spacing: .02em; margin: 26px 0 18px; }
#s01 .t .df-grad { font-weight: 600; }
#s01 .obj { position: absolute; left: 820px; top: 120px; width: 900px; height: 760px; }
#s01 .shadow { position: absolute; left: 1060px; top: 740px; width: 420px; height: 70px; border-radius: 50%; background: radial-gradient(closest-side, rgb(0 0 0 / .55), transparent); }
#s01 .cap { position: absolute; left: 0; right: 0; bottom: 92px; margin: 0 auto; width: 1000px; text-align: center; font: 400 34px/1.45 var(--df-font-body); color: var(--df-text); }`,
    `DF.slide("s01", function (api) {
  if (!api.THREE) return {};
  var T = api.THREE;
  var kit = api.three(api.el.querySelector(".obj"), { fov: 30 });
  kit.camera.position.set(0, 0.2, 9);
  var white = new T.MeshPhysicalMaterial({ color: 0xf4f4f6, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.15 });
  var tipMat = new T.MeshPhysicalMaterial({ color: 0xe6e8ee, roughness: 0.5, transmission: 0.35, thickness: 0.4 });
  var metal = new T.MeshStandardMaterial({ color: 0x9aa3b4, metalness: 0.9, roughness: 0.25 });
  var bud = new T.Group();
  var head = new T.Mesh(new T.SphereGeometry(1, 64, 48), white); head.scale.set(1.0, 1.18, 0.92); bud.add(head);
  var stem = new T.Mesh(new T.CapsuleGeometry(0.3, 2.1, 12, 32), white); stem.position.set(0.05, -1.95, 0); bud.add(stem);
  var nozzle = new T.Mesh(new T.CylinderGeometry(0.32, 0.36, 0.5, 40), metal); nozzle.rotation.z = Math.PI / 2; nozzle.position.set(-1.05, 0.15, 0); bud.add(nozzle);
  var tip = new T.Mesh(new T.SphereGeometry(0.62, 48, 32, 0, Math.PI * 2, 0, Math.PI / 2), tipMat); tip.rotation.z = Math.PI / 2; tip.position.set(-1.25, 0.15, 0); tip.scale.set(1, 0.75, 1); bud.add(tip);
  bud.position.set(0.3, 1.25, 0); bud.rotation.set(0.08, -0.5, 0.05); bud.scale.setScalar(0.82);
  kit.scene.add(bud);
  var speed = ${o.speed};
  api.onFrame(function (t) { if (!api.reducedMotion && !api.shot) bud.rotation.y = -0.5 + Math.sin(t * 0.5 * speed) * 0.35; kit.render(); });
  kit.render();
  return {};
});`,
  );
}

// ------------------------------------------------------------------ s02 pressure wave
function s02(o: SlideOpts): string {
  return file(
    "s02",
    `<p class="df-eyebrow">Physics</p><h2 class="df-h2 t">Sound is a pressure wave</h2>
<canvas class="cv" width="1640" height="560"></canvas>
<div class="df-legend lg"><span class="df-key" style="--c: var(--df-accent)"><i></i>Air molecules</span><span class="df-key" style="--c: var(--df-accent-2)"><i></i>Pressure</span><span class="df-key" style="--c: var(--df-accent-3)"><i></i>Anti-noise</span></div>
<p class="cap">${esc(caption("s02", o, "Pressure rises and falls. Add a mirror wave, and the two sum to nothing."))}</p>`,
    `#s02 { padding: 120px 140px 0; }
#s02 .t { font-size: ${Math.round(64 * o.titleScale)}px; margin-top: 22px; }
#s02 .cv { position: absolute; left: 140px; top: 330px; width: 1640px; height: 560px; }
#s02 .lg { position: absolute; left: 140px; bottom: 96px; }
#s02 .cap { position: absolute; right: 140px; bottom: 90px; width: 760px; margin: 0; text-align: right; font: 400 30px/1.4 var(--df-font-body); color: var(--df-muted); }`,
    `DF.slide("s02", function (api) {
  var cv = api.el.querySelector(".cv"), g = cv.getContext("2d"), C = api.theme.colors, step = 0, speed = ${o.speed};
  function draw(t) {
    g.clearRect(0, 0, 1640, 560);
    var k = 2 * Math.PI / 420, w = t * 2.2 * speed;
    for (var row = 0; row < 7; row++) for (var i = 0; i < 70; i++) {
      var x0 = i * 24 + 10, x = x0 + Math.sin(x0 * k - w) * 9, y = 40 + row * 34;
      g.fillStyle = C.accent; g.globalAlpha = 0.35 + 0.65 * (0.5 + 0.5 * Math.cos(x0 * k - w)); g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill();
    }
    g.globalAlpha = 1; g.lineWidth = 4;
    function wave(color, sign, y0) { g.strokeStyle = color; g.beginPath(); for (var x = 0; x <= 1640; x += 4) { var y = y0 - sign * Math.cos(x * k - w) * 70; x ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); }
    wave(C.accent2, 1, 400);
    if (step > 0) { g.setLineDash([10, 10]); wave(C.accent3, -1, 400); g.setLineDash([]); }
    g.strokeStyle = C.line; g.lineWidth = 1.5; g.beginPath(); g.moveTo(0, 400); g.lineTo(1640, 400); g.stroke();
  }
  api.onFrame(function (t) { draw(api.reducedMotion ? 0 : t); });
  return { steps: 2, step: function (i) { step = i; draw(0); }, enter: function () { draw(0); } };
});`,
  );
}

// ------------------------------------------------------------------ s03 passive vs active
function s03(o: SlideOpts): string {
  const bands = ["50", "125", "250", "500", "1k", "2k", "4k", "8k"];
  const passive = [4, 6, 9, 14, 22, 30, 36, 40];
  const active = [28, 30, 27, 20, 9, 3, 1, 0];
  const bars = (vals: number[], cls: string) =>
    bands.map((b, i) => `<div class="b"><i class="${cls}" style="--h:${vals[i]! * 2.4}%"></i><span>${b}</span></div>`).join("");
  return file(
    "s03",
    `<p class="df-eyebrow">Two kinds of quiet</p><h2 class="df-h2 t">Passive blocks the highs. Active cancels the lows.</h2>
<div class="cols">
  <div class="df-panel p"><h3>Passive · ear tip seal</h3><p>Mass and seal reflect short wavelengths.</p><div class="bars">${bars(passive, "pv")}</div><div class="ax">Attenuation by frequency, Hz</div></div>
  <div class="df-panel p act"><h3>Active · anti-noise</h3><p>Long wavelengths are slow enough to predict and invert.</p><div class="bars">${bars(active, "ac")}</div><div class="ax">Attenuation by frequency, Hz</div></div>
</div>
<p class="cap">${esc(caption("s03", o, "Together they cover the spectrum: ANC below 1 kHz, the tip above it."))}</p>`,
    `#s03 { padding: 120px 140px 0; }
#s03 .t { font-size: ${Math.round(60 * o.titleScale)}px; margin-top: 22px; max-width: 1500px; }
#s03 .cols { position: absolute; left: 140px; right: 140px; top: 380px; display: grid; grid-template-columns: 1fr 1fr; gap: 40px; }
#s03 .p { padding: 36px 40px 30px; transition: opacity .5s; }
#s03 .p h3 { margin: 0; font: 600 34px/1.1 var(--df-font-display); }
#s03 .p p { margin: 10px 0 26px; font-size: 24px; color: var(--df-muted); }
#s03 .bars { height: 250px; display: flex; align-items: flex-end; gap: 18px; border-bottom: 1.5px solid var(--df-line); }
#s03 .b { flex: 1; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; position: relative; }
#s03 .b i { display: block; width: 100%; height: var(--h); border-radius: 6px 6px 0 0; transform-origin: bottom; transition: transform .8s cubic-bezier(.2,.7,.2,1); }
#s03 .b i.pv { background: linear-gradient(var(--df-accent-2), color-mix(in oklab, var(--df-accent-2) 40%, transparent)); }
#s03 .b i.ac { background: linear-gradient(var(--df-accent), color-mix(in oklab, var(--df-accent) 40%, transparent)); }
#s03 .b span { position: absolute; bottom: -38px; font: 500 22px/1 var(--df-font-mono); color: var(--df-muted); }
#s03 .ax { margin-top: 52px; font: 500 22px/1 var(--df-font-mono); color: var(--df-muted); }
#s03 .act.off { opacity: .25; }
#s03 .act.off i { transform: scaleY(0); }
#s03 .cap { position: absolute; left: 140px; bottom: 80px; margin: 0; font: 400 30px/1.4 var(--df-font-body); }`,
    `DF.slide("s03", function (api) {
  var act = api.el.querySelector(".act");
  return { steps: 2, step: function (i) { act.classList.toggle("off", i === 0); } };
});`,
  );
}

// ------------------------------------------------------------------ s04 exploded parts (3D)
function s04(o: SlideOpts): string {
  const parts = [
    ["03", "Ear tip"],
    ["04", "Nozzle + mesh"],
    ["05", "Speaker driver"],
    ["02", "Inner chamber"],
    ["11", "Circuit board"],
    ["09", "ANC processor"],
    ["01", "Outer housing"],
    ["12", "Battery"],
    ["07", "Inner mic"],
    ["06", "Outer mic"],
  ];
  return file(
    "s04",
    `<div class="obj"></div>
<div class="tags">${parts.map(([n, name]) => `<span class="df-tag"><b>${n}</b>${name}</span>`).join("")}</div>
<p class="cap">${esc(caption("s04", o, "Fourteen parts, layered from the ear tip to the outer shell. Each one plays a role in reducing noise."))}</p>`,
    `#s04 .obj { position: absolute; inset: 0 0 160px 0; }
#s04 .tags .df-tag { position: absolute; left: 0; top: 0; transition: opacity .5s; font-size: ${Math.round(25 * o.titleScale)}px; }
#s04.s04-closed .tags .df-tag { opacity: 0; }
#s04 .cap { position: absolute; left: 0; right: 0; bottom: 70px; margin: 0 auto; width: 1100px; text-align: center; font: 400 34px/1.45 var(--df-font-body); }`,
    `DF.slide("s04", function (api) {
  var tags = [].slice.call(api.el.querySelectorAll(".df-tag"));
  if (!api.THREE) return {};
  var T = api.THREE, kit = api.three(api.el.querySelector(".obj"), { fov: 28 });
  kit.camera.position.set(0, 1.2, 17); kit.camera.lookAt(0, 0.2, 0);
  function phys(c, r) { return new T.MeshPhysicalMaterial({ color: c, roughness: r, clearcoat: 0.6 }); }
  var M = { white: phys(0xf2f2f4, 0.3), tip: phys(0xe2e4ea, 0.55), metal: new T.MeshStandardMaterial({ color: 0x9aa3b4, metalness: 0.9, roughness: 0.3 }),
    dark: phys(0x3a3f4b, 0.5), pcb: phys(0x1f7a46, 0.45), chip: phys(0x15161a, 0.35), cream: phys(0xe8dcc0, 0.6), blue: phys(0x2c56b8, 0.35) };
  function mesh(geo, mat) { return new T.Mesh(geo, mat); }
  var list = [
    [mesh(new T.SphereGeometry(0.7, 40, 24, 0, Math.PI * 2, 0, Math.PI / 2), M.tip), -6.2, 0.6, 0, 0, 0, Math.PI / 2],
    [mesh(new T.CylinderGeometry(0.42, 0.42, 1.1, 32), M.metal), -4.6, 0.6, 0, 0, 0, Math.PI / 2],
    [mesh(new T.CylinderGeometry(0.85, 0.85, 0.25, 48), M.cream), -2.9, 0.6, 0, 0, 0, Math.PI / 2],
    [mesh(new T.TorusGeometry(0.9, 0.42, 24, 48), M.dark), -0.9, 0.6, 0, 0, Math.PI / 2, 0],
    [mesh(new T.CylinderGeometry(1.0, 1.0, 0.08, 48), M.pcb), 0.8, 0.6, 0, 0, 0, Math.PI / 2],
    [mesh(new T.BoxGeometry(0.55, 0.55, 0.12), M.chip), 2.3, 2.1, 0, 0.2, 0.4, 0],
    [mesh(new T.SphereGeometry(1.25, 48, 32), M.white), 4.6, 0.7, 0, 0, 0, 0],
    [mesh(new T.CylinderGeometry(0.38, 0.38, 1.5, 32), M.blue), -2.2, -2.6, 0, 0, 0, 0],
    [mesh(new T.BoxGeometry(0.3, 0.3, 0.2), M.metal), -3.4, 2.6, 0, 0.3, 0.3, 0],
    [mesh(new T.BoxGeometry(0.3, 0.3, 0.2), M.metal), 6.6, 2.4, 0, 0.3, 0.3, 0],
  ];
  var stem = mesh(new T.CapsuleGeometry(0.42, 2.6, 10, 32), M.white); stem.position.set(0.1, -2.1, 0); list[6][0].add(stem); list[6][0].scale.set(1, 1.15, 0.9);
  var group = new T.Group();
  list.forEach(function (p) { p[0].rotation.set(p[4], p[5], p[6]); group.add(p[0]); });
  group.rotation.set(0.12, -0.32, 0); kit.scene.add(group);
  var e = { v: 0 }, speed = ${o.speed};
  function place() {
    list.forEach(function (p) { p[0].position.set(p[1] * (0.18 + 0.82 * e.v), p[2] * e.v, p[3]); });
    kit.render();
    tags.forEach(function (tag, i) {
      var w = new T.Vector3(); list[i][0].getWorldPosition(w);
      var s = kit.toSlide(w), up = list[i][2] > 1 || (list[i][2] >= 0 && i % 2 === 0);
      tag.style.transform = "translate(" + (s.x - 90) + "px," + (s.y + (up ? -150 : 110)) + "px)";
    });
  }
  api.onFrame(function () { place(); });
  return { steps: 2, step: function (i) {
    api.el.classList.toggle("s04-closed", i === 0);
    if (api.reducedMotion || api.shot) { e.v = i; place(); } else api.gsap.to(e, { v: i, duration: 1.4 / speed, ease: "power3.inOut" });
  } };
});`,
  );
}

// ------------------------------------------------------------------ s05 feedforward signal chain (packets)
function s05(o: SlideOpts): string {
  const blocks = [
    ["Outer mic", "MEMS, on the shell"],
    ["ADC", "768 kHz"],
    ["ANC DSP", "invert + shape"],
    ["DAC", "low-latency"],
    ["Driver", "plays anti-noise"],
  ];
  const packetSec = (2.6 / o.speed).toFixed(2);
  return file(
    "s05",
    `<p class="df-eyebrow">Signal path · 1</p><h2 class="df-h2 t">Feedforward: hear the noise first</h2>
<div class="chain"><div class="wire"></div>${blocks.map(([a, b], i) => `<div class="blk${i === 2 ? " dsp" : ""}"><b>${a}</b><span>${b}</span></div>`).join("")}<div class="pk"></div><div class="pk"></div><div class="pk"></div><div class="pk"></div></div>
<div class="df-legend lg"><span class="df-key" style="--c: var(--df-accent)"><i></i>Noise samples</span><span class="df-key" style="--c: var(--df-accent-3)"><i></i>Inverted (anti-noise)</span></div>
<p class="cap">${esc(caption("s05", o, "Noise reaches the outer mic about 100 µs before your ear. That head start is the whole trick."))}</p>
<p class="rate">Packet transit ${packetSec} s</p>`,
    `#s05 { padding: 120px 140px 0; }
#s05 .t { font-size: ${Math.round(64 * o.titleScale)}px; margin-top: 22px; }
#s05 .chain { position: absolute; left: 140px; right: 140px; top: 440px; height: 200px; display: flex; justify-content: space-between; align-items: center; }
#s05 .wire { position: absolute; left: 100px; right: 100px; top: 50%; height: 3px; background: linear-gradient(90deg, var(--df-accent), var(--df-accent-3)); opacity: .55; }
#s05 .blk { position: relative; z-index: 1; width: 236px; height: 156px; padding: 24px; display: flex; flex-direction: column; justify-content: center; gap: 10px; text-align: center;
  background: var(--df-surface); border: 1.5px solid var(--df-line); border-radius: 18px; transition: border-color .4s, box-shadow .4s; }
#s05 .blk b { font: 600 32px/1 var(--df-font-display); }
#s05 .blk span { font: 400 21px/1.2 var(--df-font-mono); color: var(--df-muted); }
#s05.s05-hl .dsp { border-color: var(--df-accent-2); box-shadow: 0 0 0 6px color-mix(in oklab, var(--df-accent-2) 22%, transparent), 0 0 60px color-mix(in oklab, var(--df-accent-2) 35%, transparent); }
#s05 .pk { position: absolute; z-index: 0; left: 100px; top: calc(50% - 9px); width: 18px; height: 18px; border-radius: 50%; background: var(--df-accent); box-shadow: 0 0 18px var(--df-accent); }
#s05 .lg { position: absolute; left: 140px; top: 720px; }
#s05 .cap { position: absolute; left: 140px; bottom: 96px; margin: 0; width: 1200px; font: 400 32px/1.4 var(--df-font-body); }
#s05 .rate { position: absolute; right: 140px; bottom: 100px; margin: 0; font: 500 20px/1 var(--df-font-mono); color: var(--df-muted); }`,
    `DF.slide("s05", function (api) {
  var pks = [].slice.call(api.el.querySelectorAll(".pk")), chain = api.el.querySelector(".chain"), C = api.theme.colors, dur = ${packetSec};
  function pos(p, f) { var w = chain.clientWidth - 200; p.style.transform = "translateX(" + (f * w) + "px)"; var inv = f > 0.5; p.style.background = inv ? C.accent3 : C.accent; p.style.boxShadow = "0 0 18px " + (inv ? C.accent3 : C.accent); }
  pks.forEach(function (p, i) { pos(p, i / pks.length); });
  api.onFrame(function (t) { if (api.reducedMotion || api.shot) return; pks.forEach(function (p, i) { pos(p, ((t / dur) + i / pks.length) % 1); }); });
  return { steps: 2, step: function (i) { api.el.classList.toggle("s05-hl", i === 1); } };
});`,
  );
}

// ------------------------------------------------------------------ s06 feedback loop
function s06(o: SlideOpts): string {
  return file(
    "s06",
    `<p class="df-eyebrow">Signal path · 2</p><h2 class="df-h2 t">Feedback: fix what’s left over</h2>
<svg class="loop" viewBox="0 0 760 620"><defs><marker id="s06-a" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="currentColor"/></marker></defs>
<rect class="ring" x="110" y="90" width="540" height="440" rx="120"/>
<g class="nd"><rect x="280" y="40" width="200" height="100" rx="18"/><text x="380" y="100">ANC DSP</text></g>
<g class="nd"><rect x="560" y="260" width="180" height="100" rx="18"/><text x="650" y="320">Driver</text></g>
<g class="nd"><rect x="280" y="480" width="200" height="100" rx="18"/><text x="380" y="540">Ear canal</text></g>
<g class="nd"><rect x="20" y="260" width="180" height="100" rx="18"/><text x="110" y="320">Inner mic</text></g>
<circle class="dot" r="12" cx="110" cy="200"/></svg>
<div class="side"><div class="df-stat"><span class="df-stat-label">Residual after loop</span><span class="df-stat-value">−24 dB</span></div>
<p>${esc(caption("s06", o, "The inner mic hears what actually reaches your ear. Whatever is left becomes the error for the next correction."))}</p></div>`,
    `#s06 { padding: 120px 140px 0; }
#s06 .t { font-size: ${Math.round(64 * o.titleScale)}px; margin-top: 22px; }
#s06 .loop { position: absolute; left: 140px; top: 330px; width: 860px; height: 700px; color: var(--df-accent); overflow: visible; }
#s06 .ring { fill: none; stroke: var(--df-accent); stroke-width: 3; stroke-dasharray: 14 12; opacity: .7; }
#s06 .nd rect { fill: var(--df-surface); stroke: var(--df-line); stroke-width: 2; }
#s06 .nd text { fill: var(--df-text); font: 600 28px var(--df-font-display); text-anchor: middle; dominant-baseline: middle; }
#s06 .dot { fill: var(--df-accent-3); filter: drop-shadow(0 0 12px var(--df-accent-3)); }
#s06 .side { position: absolute; left: 1120px; top: 420px; width: 660px; }
#s06 .side p { margin: 40px 0 0; font: 400 32px/1.45 var(--df-font-body); }`,
    `DF.slide("s06", function (api) {
  var dot = api.el.querySelector(".dot"), ring = api.el.querySelector(".ring"), len = ring.getTotalLength(), speed = ${o.speed};
  function at(f) { var p = ring.getPointAtLength(((f % 1) + 1) % 1 * len); dot.setAttribute("cx", p.x); dot.setAttribute("cy", p.y); }
  at(0.62);
  api.onFrame(function (t) { if (!api.reducedMotion && !api.shot) { at(-t * 0.18 * speed); ring.style.strokeDashoffset = String(t * 30 * speed); } });
  return {};
});`,
  );
}

// ------------------------------------------------------------------ s07 anti-noise simulation
function s07(o: SlideOpts): string {
  return file(
    "s07",
    `<p class="df-eyebrow">Try it</p><h2 class="df-h2 t">The anti-noise wave</h2>
<canvas class="cv" width="1120" height="600"></canvas>
<div class="side">
  <label class="lab" for="s07-phase">Phase error <b class="pv">0°</b></label>
  <input id="s07-phase" class="df-range" type="range" min="0" max="180" value="20">
  <div class="df-stat st"><span class="df-stat-label">Noise left over</span><span class="df-stat-value rv">−9 dB</span></div>
  <div class="df-legend lg"><span class="df-key" style="--c: var(--df-accent-3)"><i></i>Noise</span><span class="df-key" style="--c: var(--df-accent-2)"><i></i>Anti-noise</span><span class="df-key" style="--c: var(--df-accent)"><i></i>What you hear</span></div>
  <p class="cap">${esc(caption("s07", o, "Drag the phase error. A quarter-cycle late, and the anti-noise barely helps."))}</p>
</div>`,
    `#s07 { padding: 120px 140px 0; }
#s07 .t { font-size: ${Math.round(64 * o.titleScale)}px; margin-top: 22px; }
#s07 .cv { position: absolute; left: 140px; top: 330px; width: 1120px; height: 600px; border-radius: 18px; background: color-mix(in oklab, var(--df-surface) 70%, transparent); border: 1px solid var(--df-line); }
#s07 .side { position: absolute; left: 1340px; top: 340px; width: 440px; }
#s07 .lab { display: flex; justify-content: space-between; font: 500 24px/1 var(--df-font-body); color: var(--df-muted); margin-bottom: 22px; }
#s07 .lab b { font: 500 24px/1 var(--df-font-mono); color: var(--df-text); }
#s07 .st { margin: 56px 0 44px; }
#s07 .lg { flex-direction: column; gap: 18px; }
#s07 .cap { margin: 44px 0 0; font: 400 26px/1.45 var(--df-font-body); color: var(--df-muted); }`,
    `DF.slide("s07", function (api) {
  var el = api.el, cv = el.querySelector(".cv"), g = cv.getContext("2d"), C = api.theme.colors, input = el.querySelector(".df-range");
  var pv = el.querySelector(".pv"), rv = el.querySelector(".rv"), show = 3, speed = ${o.speed}, tt = 0;
  function phase() { return Number(input.value) * Math.PI / 180; }
  function draw() {
    g.clearRect(0, 0, 1120, 600);
    var k = 2 * Math.PI / 360, ph = phase(), w = tt * 2.4 * speed;
    g.strokeStyle = C.line; g.lineWidth = 1; for (var y = 100; y < 600; y += 200) { g.beginPath(); g.moveTo(0, y); g.lineTo(1120, y); g.stroke(); }
    function wave(fn, color, y0, wd) { g.strokeStyle = color; g.lineWidth = wd; g.beginPath(); for (var x = 0; x <= 1120; x += 3) { var v = y0 - fn(x * k - w) * 70; x ? g.lineTo(x, v) : g.moveTo(x, v); } g.stroke(); }
    wave(function (a) { return Math.sin(a); }, C.accent3, 100, 4);
    if (show > 1) wave(function (a) { return -Math.sin(a + ph); }, C.accent2, 300, 4);
    if (show > 2) wave(function (a) { return Math.sin(a) - Math.sin(a + ph); }, C.accent, 500, 5);
  }
  function update() {
    var deg = Number(input.value), ph = deg * Math.PI / 180, amp = Math.abs(2 * Math.sin(ph / 2));
    var db = Math.max(-60, 20 * Math.log10(Math.max(amp, 1e-6)));
    pv.textContent = deg + "°"; rv.textContent = (db > 0 ? "+" : db < 0 ? "−" : "") + Math.abs(db).toFixed(0) + " dB";
    input.style.setProperty("--fill", (deg / 180 * 100) + "%"); draw();
  }
  input.addEventListener("input", update); update();
  api.onFrame(function (t) { if (!api.reducedMotion && !api.shot) { tt = t; draw(); } });
  return { steps: 3, step: function (i) { show = i + 1; draw(); } };
});`,
  );
}

// ------------------------------------------------------------------ s08 latency budget
function s08(o: SlideOpts): string {
  const segs = [
    ["ADC", 4, "var(--df-accent)"],
    ["Filter", 7, "var(--df-accent-2)"],
    ["DAC", 4, "var(--df-accent)"],
    ["Acoustic path", 5, "var(--df-accent-3)"],
  ] as const;
  return file(
    "s08",
    `<p class="df-eyebrow">Timing</p><h2 class="df-h2 t">A 20-microsecond budget</h2>
<div class="stats"><div class="df-stat"><span class="df-stat-label">Total path</span><span class="df-stat-value">20 µs</span></div>
<div class="df-stat"><span class="df-stat-label">Filter clock</span><span class="df-stat-value">768 kHz</span></div>
<div class="df-stat"><span class="df-stat-label">90° late at 1 kHz</span><span class="df-stat-value">250 µs</span></div></div>
<div class="bar">${segs.map(([n, us, c]) => `<div class="sg" style="flex:${us};--c:${c}"><i></i><b>${n}</b><span>${us} µs</span></div>`).join("")}</div>
<p class="cap">${esc(caption("s08", o, "Convert, filter, convert back and push air: all inside 20 µs. That is why ANC runs on fixed hardware."))}</p>`,
    `#s08 { padding: 120px 140px 0; }
#s08 .t { font-size: ${Math.round(64 * o.titleScale)}px; margin-top: 22px; }
#s08 .stats { position: absolute; left: 140px; right: 140px; top: 360px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 40px; }
#s08 .stats .df-stat-value { font-size: 96px; }
#s08 .bar { position: absolute; left: 140px; right: 140px; top: 640px; display: flex; gap: 8px; }
#s08 .sg i { display: block; height: 64px; border-radius: 12px; background: var(--c); opacity: .9; transform-origin: left; animation: s08-grow 1s cubic-bezier(.2,.7,.2,1) both; }
#s08 .sg b { display: block; margin-top: 20px; font: 600 26px/1 var(--df-font-display); }
#s08 .sg span { display: block; margin-top: 8px; font: 400 22px/1 var(--df-font-mono); color: var(--df-muted); }
#s08 .cap { position: absolute; left: 140px; bottom: 90px; margin: 0; width: 1300px; font: 400 32px/1.4 var(--df-font-body); }
@keyframes s08-grow { from { transform: scaleX(0); } to { transform: none; } }`,
    `DF.slide("s08", function () { return {}; });`,
  );
}

// ------------------------------------------------------------------ s09 hybrid / transparency
function s09(o: SlideOpts): string {
  return file(
    "s09",
    `<p class="df-eyebrow">Modes</p><h2 class="df-h2 t">Hybrid and transparency</h2>
<div class="df-toggle tg" role="group" aria-label="Mode"><button class="df-btn" data-m="anc" aria-pressed="true">Hybrid ANC</button><button class="df-btn" data-m="tr">Transparency</button><button class="df-btn" data-m="off">Off</button></div>
<div class="dia"><div class="df-panel n ff">Outer mic</div><div class="df-panel n dsp">DSP</div><div class="df-panel n drv">Driver</div><div class="df-panel n fb">Inner mic</div>
<div class="ln l1"></div><div class="ln l2"></div><div class="ln l3"></div></div>
<p class="cap ex"></p>`,
    `#s09 { padding: 120px 140px 0; }
#s09 .t { font-size: ${Math.round(64 * o.titleScale)}px; margin-top: 22px; }
#s09 .tg { position: absolute; left: 140px; top: 330px; }
#s09 .dia { position: absolute; left: 140px; top: 470px; width: 1640px; height: 300px; }
#s09 .n { position: absolute; width: 260px; height: 110px; display: grid; place-items: center; font: 600 30px/1 var(--df-font-display); transition: border-color .4s, opacity .4s, box-shadow .4s; }
#s09 .ff { left: 0; top: 0; } #s09 .dsp { left: 690px; top: 95px; } #s09 .drv { left: 1380px; top: 0; } #s09 .fb { left: 1380px; top: 190px; }
#s09 .ln { position: absolute; height: 3px; background: var(--df-accent); transition: opacity .4s, background .4s; }
#s09 .l1 { left: 260px; width: 430px; top: 100px; transform: rotate(10deg); transform-origin: left; }
#s09 .l2 { left: 950px; width: 430px; top: 145px; transform: rotate(-10deg); transform-origin: left; }
#s09 .l3 { left: 950px; width: 430px; top: 165px; transform: rotate(12deg); transform-origin: left; background: var(--df-accent-2); }
#s09[data-m="off"] .ln, #s09[data-m="off"] .dsp { opacity: .2; }
#s09[data-m="tr"] .l3 { opacity: .15; }
#s09[data-m="tr"] .l1, #s09[data-m="tr"] .l2 { background: var(--df-accent-3); }
#s09[data-m="anc"] .dsp { box-shadow: 0 0 50px color-mix(in oklab, var(--df-accent) 35%, transparent); border-color: var(--df-accent); }
#s09 .cap { position: absolute; left: 140px; bottom: 100px; margin: 0; width: 1300px; font: 400 32px/1.4 var(--df-font-body); }`,
    `DF.slide("s09", function (api) {
  var el = api.el, ex = el.querySelector(".ex");
  var T = { anc: ${JSON.stringify(caption("s09", o, "Hybrid: the outer mic predicts, the inner mic corrects. Both feed one filter."))}, tr: "Transparency: same mics, opposite intent. The filter adds the room back in.", off: "Off: only the ear tip’s passive seal is working." };
  function set(m) { el.dataset.m = m; ex.textContent = T[m]; [].forEach.call(el.querySelectorAll("[data-m]"), function (b) { if (b.tagName === "BUTTON") b.setAttribute("aria-pressed", String(b.dataset.m === m)); }); }
  [].forEach.call(el.querySelectorAll("button[data-m]"), function (b) { b.addEventListener("click", function () { set(b.dataset.m); }); });
  set("anc");
  return {};
});`,
  );
}

// ------------------------------------------------------------------ s10 attenuation chart
function s10(o: SlideOpts): string {
  const x = (f: number) => 80 + ((Math.log10(f) - Math.log10(20)) / (Math.log10(10000) - Math.log10(20))) * 1460;
  const y = (db: number) => 40 + (db / 45) * 440;
  const path = (pts: [number, number][]) => pts.map(([f, d], i) => `${i ? "L" : "M"}${x(f).toFixed(0)} ${y(d).toFixed(0)}`).join(" ");
  const passive: [number, number][] = [[20, 2], [100, 4], [300, 9], [1000, 20], [3000, 32], [10000, 38]];
  const active: [number, number][] = [[20, 18], [100, 30], [300, 27], [1000, 12], [3000, 3], [10000, 0]];
  const both: [number, number][] = passive.map(([f, d], i) => [f, Math.min(44, d + active[i]![1] * 0.9)]);
  const ticks = [50, 100, 500, 1000, 5000];
  return file(
    "s10",
    `<p class="df-eyebrow">Limits</p><h2 class="df-h2 t">What ANC can’t cancel</h2>
<svg class="ch" viewBox="0 0 1600 560">
${[0, 15, 30, 45].map((d) => `<line class="gr" x1="80" x2="1540" y1="${y(d)}" y2="${y(d)}"/><text class="yl" x="60" y="${y(d) + 8}">${d}</text>`).join("")}
${ticks.map((f) => `<text class="xl" x="${x(f)}" y="530">${f >= 1000 ? `${f / 1000}k` : f}</text>`).join("")}
<path class="c pv" d="${path(passive)}"/><path class="c ac" d="${path(active)}"/><path class="c bo" d="${path(both)}"/></svg>
<div class="df-legend lg"><span class="df-key" style="--c: var(--df-accent-2)"><i></i>Passive seal</span><span class="df-key" style="--c: var(--df-accent)"><i></i>Active</span><span class="df-key" style="--c: var(--df-text)"><i></i>Combined</span></div>
<p class="cap">${esc(caption("s10", o, "Steady low rumble: superb. Voices, clatter and wind: much less. The seal matters as much as the algorithm."))}</p>`,
    `#s10 { padding: 120px 140px 0; }
#s10 .t { font-size: ${Math.round(64 * o.titleScale)}px; margin-top: 22px; }
#s10 .ch { position: absolute; left: 140px; top: 320px; width: 1640px; height: 574px; overflow: visible; }
#s10 .gr { stroke: var(--df-line); stroke-width: 1.5; }
#s10 .yl, #s10 .xl { fill: var(--df-muted); font: 500 20px var(--df-font-mono); }
#s10 .yl { text-anchor: end; } #s10 .xl { text-anchor: middle; }
#s10 .c { fill: none; stroke-width: 5; stroke-linecap: round; stroke-linejoin: round; transition: opacity .5s; }
#s10 .pv { stroke: var(--df-accent-2); } #s10 .ac { stroke: var(--df-accent); } #s10 .bo { stroke: var(--df-text); stroke-dasharray: 12 10; }
#s10.s10-a .bo { opacity: 0; }
#s10 .lg { position: absolute; left: 220px; top: 340px; }
#s10 .cap { position: absolute; left: 140px; bottom: 80px; margin: 0; width: 1400px; font: 400 32px/1.4 var(--df-font-body); }`,
    `DF.slide("s10", function (api) { return { steps: 2, step: function (i) { api.el.classList.toggle("s10-a", i === 0); } }; });`,
  );
}

const BUILDERS: Record<string, (o: SlideOpts) => string> = { s01, s02, s03, s04, s05, s06, s07, s08, s09, s10 };

export function slideSource(id: string, opts: Partial<SlideOpts> = {}): string {
  const b = BUILDERS[id];
  if (!b) throw new Error(`no mock slide ${id}`);
  return b({ ...DEFAULT_OPTS, ...opts });
}

export const MOCK_SLIDE_IDS = Object.keys(BUILDERS);
