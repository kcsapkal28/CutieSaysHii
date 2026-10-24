// The Style Studio's live preview: a two-slide sample deck bundled by the real engine (shell + kit + Three.js),
// plus a small bridge script so the studio can restyle it instantly over postMessage:
//   { type: "df-preview", css: ":root{--df-*…}", style: Style }  → swaps #df-theme, sets data-* flags
//   { type: "df-goto", index }                                   → DF.go(index)
// Feature toggles change the shell chrome, so those re-bundle (cached per feature set).
import type { DeckConfig, Features } from "@deckforge/forge";
import { cloneStyle, LOOKS } from "../looks";
import { engine } from "./engine";
import { fontFaceLinksCss } from "./fonts";

const S01 = `<section class="df-slide" id="s01">
<div class="copy"><p class="df-eyebrow">Active noise cancellation</p><h1 class="df-h1 t">Inside <span class="df-grad">ANC</span></h1><p class="df-lede">The engineering behind silence</p>
<div class="tags"><span class="df-tag"><b>06</b>Outer mic · feedforward</span><span class="df-tag"><b>09</b>ANC processor</span></div></div>
<div class="obj"></div>
<svg class="rings" viewBox="0 0 600 600"><circle cx="300" cy="300" r="70"/><circle cx="300" cy="300" r="140"/><circle cx="300" cy="300" r="210"/><circle cx="300" cy="300" r="280"/></svg>
<p class="cap">A wireless noise-cancelling earbud. Let’s look inside to see how signal processing makes it quieter.</p>
<aside class="df-notes"><p>Open on the object: the audience should want to look inside.</p></aside>
</section>
<style>
#s01 .copy { position: absolute; left: 140px; top: 300px; width: 860px; }
#s01 .t { font-size: 150px; margin: 26px 0 18px; letter-spacing: .02em; }
#s01 .t .df-grad { font-weight: 600; }
#s01 .tags { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 56px; }
#s01 .obj { position: absolute; left: 900px; top: 100px; width: 880px; height: 760px; }
#s01 .rings { position: absolute; left: 1040px; top: 180px; width: 600px; height: 600px; display: none; }
#s01 .rings circle { fill: none; stroke: var(--df-accent); stroke-width: 2; opacity: .6; transform-origin: 300px 300px; }
#s01 .rings circle:nth-child(2n) { stroke: var(--df-accent-2); }
#s01 .cap { position: absolute; left: 0; right: 0; bottom: 84px; margin: 0 auto; width: 1000px; text-align: center; font: 400 32px/1.45 var(--df-font-body); }
</style>
<script>
DF.slide("s01", function (api) {
  var root = document.documentElement, el = api.el, rings = el.querySelector(".rings"), circles = [].slice.call(rings.querySelectorAll("circle"));
  var kit = null, bud = null;
  if (api.THREE) {
    var T = api.THREE;
    kit = api.three(el.querySelector(".obj"), { fov: 30 });
    kit.camera.position.set(0, 0.2, 9);
    var white = new T.MeshPhysicalMaterial({ color: 0xf4f4f6, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.15 });
    var tipMat = new T.MeshPhysicalMaterial({ color: 0xe2e4ea, roughness: 0.55 });
    var metal = new T.MeshStandardMaterial({ color: 0x9aa3b4, metalness: 0.9, roughness: 0.25 });
    bud = new T.Group();
    var head = new T.Mesh(new T.SphereGeometry(1, 64, 48), white); head.scale.set(1, 1.18, 0.92); bud.add(head);
    var stem = new T.Mesh(new T.CapsuleGeometry(0.3, 2.1, 12, 32), white); stem.position.set(0.05, -1.95, 0); bud.add(stem);
    var nz = new T.Mesh(new T.CylinderGeometry(0.32, 0.36, 0.5, 40), metal); nz.rotation.z = Math.PI / 2; nz.position.set(-1.05, 0.15, 0); bud.add(nz);
    var tip = new T.Mesh(new T.SphereGeometry(0.62, 48, 32, 0, Math.PI * 2, 0, Math.PI / 2), tipMat); tip.rotation.z = Math.PI / 2; tip.position.set(-1.25, 0.15, 0); tip.scale.set(1, 0.75, 1); bud.add(tip);
    bud.position.set(0.3, 0.8, 0); bud.rotation.set(0.08, -0.5, 0.05);
    kit.scene.add(bud);
  }
  function apply() {
    var d3 = root.dataset.d3 === "1";
    if (kit) kit.canvas.style.display = d3 ? "block" : "none";
    rings.style.display = d3 ? "none" : "block";
  }
  apply();
  api.on(window, "df-preview", apply);
  api.onFrame(function (t) {
    var m = root.dataset.motion || "subtle", k = m === "rich" ? 1 : m === "subtle" ? 0.4 : 0;
    if (bud && kit && root.dataset.d3 === "1") { bud.rotation.y = -0.5 + Math.sin(t * 0.6) * 0.4 * k; kit.render(); }
    circles.forEach(function (c, i) { var s = 1 + 0.06 * k * Math.sin(t * 1.6 - i * 0.7); c.style.transform = "scale(" + s + ")"; });
  });
  return {};
});
</script>`;

const S02 = `<section class="df-slide" id="s02">
<p class="df-eyebrow">Signal path</p><h2 class="df-h2 t">Feedforward: hear the noise first</h2>
<p class="df-lede ld">The outer mic hears noise about 100 µs before your ear does. The DSP uses that head start to invert it.</p>
<div class="chain"><div class="wire"></div><div class="blk">Outer mic<span>MEMS</span></div><div class="blk">ADC<span>768 kHz</span></div><div class="blk dsp">ANC DSP<span>invert + shape</span></div><div class="blk">DAC<span>low latency</span></div><div class="blk">Driver<span>anti-noise</span></div></div>
<div class="ctl">
  <div class="df-toggle i1" role="group" aria-label="Path"><button class="df-btn" aria-pressed="true">Feedforward</button><button class="df-btn">Feedback</button><button class="df-btn">Hybrid</button></div>
  <div class="i2 rng"><span>Phase error</span><input class="df-range" type="range" min="0" max="180" value="30" style="--fill:17%"><b>30°</b></div>
  <div class="df-stat i2"><span class="df-stat-label">Noise left</span><span class="df-stat-value">−6 dB</span></div>
</div>
<div class="df-panel more"><b>Why it works</b><ul><li>Low frequencies change slowly enough to predict.</li><li>The filter models the path from shell to ear.</li><li>The driver plays the inverse in time.</li></ul></div>
<div class="df-legend lg"><span class="df-key" style="--c: var(--df-accent)"><i></i>Noise</span><span class="df-key" style="--c: var(--df-accent-3)"><i></i>Anti-noise</span></div>
<aside class="df-notes"><p>Point at the outer mic first, then follow one packet to the driver.</p></aside>
</section>
<style>
#s02 { --pad: 140px; --sc: 1; padding: 120px var(--pad) 0; }
#s02 .t { margin-top: 22px; font-size: calc(64px * var(--sc)); }
#s02 .ld { margin-top: 26px; max-width: 1180px; font-size: calc(32px * var(--sc)); }
#s02 .chain { position: absolute; left: var(--pad); right: var(--pad); top: 500px; height: 170px; display: flex; justify-content: space-between; align-items: center; }
#s02 .wire { position: absolute; left: 90px; right: 90px; top: 50%; height: 3px; background: linear-gradient(90deg, var(--df-accent), var(--df-accent-3)); opacity: .55; }
#s02 .blk { position: relative; z-index: 1; width: 230px; height: 140px; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 10px;
  font: 600 30px/1 var(--df-font-display); background: var(--df-panel-bg); border: max(1.5px, var(--df-border-w)) solid var(--df-border-color);
  border-radius: var(--df-radius); box-shadow: var(--df-shadow); backdrop-filter: blur(var(--df-blur)); }
#s02 .blk span { font: 400 20px/1 var(--df-font-mono); color: var(--df-muted); }
#s02 .dsp { border-color: var(--df-accent-2); box-shadow: 0 0 0 6px color-mix(in oklab, var(--df-accent-2) 20%, transparent), var(--df-shadow); }
#s02 .pk { position: absolute; z-index: 2; left: 90px; top: calc(50% - 8px); width: 16px; height: 16px; border-radius: 50%; background: var(--df-accent); box-shadow: 0 0 16px var(--df-accent); }
#s02 .ctl { position: absolute; left: var(--pad); top: 760px; display: flex; align-items: center; gap: 56px; }
#s02 .rng { display: flex; align-items: center; gap: 20px; width: 520px; font: 500 22px/1 var(--df-font-body); color: var(--df-muted); }
#s02 .rng b { font: 500 22px/1 var(--df-font-mono); color: var(--df-text); }
#s02 .rng .df-range { flex: 1; }
#s02 .df-stat-value { font-size: 56px; }
#s02 .more { position: absolute; right: var(--pad); top: 300px; width: 520px; padding: 28px 32px; display: none; font-size: 22px; }
#s02 .more b { font: 600 24px/1 var(--df-font-display); }
#s02 .more ul { margin: 14px 0 0; padding-left: 22px; color: var(--df-muted); }
#s02 .lg { position: absolute; left: var(--pad); bottom: 70px; }
</style>
<script>
DF.slide("s02", function (api) {
  var root = document.documentElement, el = api.el, chain = el.querySelector(".chain"), pks = [];
  for (var i = 0; i < 6; i++) { var p = document.createElement("div"); p.className = "pk"; chain.appendChild(p); pks.push(p); }
  var C = api.theme.colors;
  function apply() {
    var ia = Number(root.dataset.ia || "1"), dn = root.dataset.density || "balanced";
    [].forEach.call(el.querySelectorAll(".i1"), function (n) { n.style.display = ia >= 1 ? "" : "none"; });
    [].forEach.call(el.querySelectorAll(".i2"), function (n) { n.style.display = ia >= 2 ? "" : "none"; });
    el.style.setProperty("--pad", dn === "airy" ? "160px" : dn === "dense" ? "96px" : "140px");
    el.style.setProperty("--sc", dn === "airy" ? "1.08" : dn === "dense" ? "0.9" : "1");
    el.querySelector(".more").style.display = dn === "dense" ? "block" : "none";
    el.querySelector(".ld").style.maxWidth = dn === "dense" ? "1000px" : "1180px";
  }
  apply();
  api.on(window, "df-preview", apply);
  api.onFrame(function (t) {
    var m = root.dataset.motion || "subtle", n = m === "rich" ? 6 : m === "subtle" ? 3 : 2, sp = m === "rich" ? 0.45 : 0.22, w = chain.clientWidth - 180;
    var cs = getComputedStyle(root), a1 = cs.getPropertyValue("--df-accent").trim() || C.accent, a3 = cs.getPropertyValue("--df-accent-3").trim() || C.accent3;
    pks.forEach(function (p, i) {
      p.style.display = i < n ? "block" : "none";
      var f = m === "none" ? (i + 0.5) / n : ((t * sp) + i / n) % 1;
      p.style.transform = "translateX(" + (f * w) + "px)";
      var c = f > 0.5 ? a3 : a1; p.style.background = c; p.style.boxShadow = m === "rich" ? "0 0 22px " + c : "none";
    });
  });
  return {};
});
</script>`;

const BRIDGE = `<script>
(function () {
  var root = document.documentElement;
  addEventListener("message", function (e) {
    var d = e.data || {};
    if (d.type === "df-preview") {
      var st = document.getElementById("df-theme"); if (st && d.css) st.textContent = d.css;
      var s = d.style || {};
      root.dataset.motion = s.motion || "subtle"; root.dataset.d3 = s.use3d ? "1" : "0";
      root.dataset.ia = String(s.interactivity == null ? 1 : s.interactivity); root.dataset.density = s.density || "balanced";
      dispatchEvent(new CustomEvent("df-preview"));
      parent.postMessage({ type: "df-preview-applied" }, "*");
    } else if (d.type === "df-goto" && window.DF) {
      window.DF.go(d.index || 0, 0);
    }
  });
  addEventListener("load", function () { parent.postMessage({ type: "df-preview-ready" }, "*"); });
})();
</script>`;

const cache = new Map<string, Promise<string>>();

export function previewHtml(features: Features): Promise<string> {
  const key = JSON.stringify(features);
  let hit = cache.get(key);
  if (!hit) {
    const style = cloneStyle(LOOKS[0]!.style);
    style.features = features;
    const config: DeckConfig = {
      title: "Style preview",
      style,
      slides: [
        { id: "s01", title: "Inside ANC", section: "Intro", budgetSec: 60 },
        { id: "s02", title: "Feedforward", section: "Signal path", budgetSec: 120 },
      ],
    };
    hit = Promise.all([engine().then((e) => e.bundleHtml({ config, slides: { s01: S01, s02: S02 } })), fontFaceLinksCss()]).then(([html, fonts]) =>
      html
        .replace("</head>", `<style id="df-preview-fonts">${fonts}</style>\n${BRIDGE}\n</head>`)
        .replace("<html lang=\"en\">", '<html lang="en" data-motion="rich" data-d3="1" data-ia="1" data-density="airy">'),
    );
    hit.catch(() => cache.delete(key));
    cache.set(key, hit);
  }
  return hit;
}
