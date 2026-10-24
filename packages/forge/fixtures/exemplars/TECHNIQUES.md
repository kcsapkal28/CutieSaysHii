# Explainer techniques

A topic-agnostic catalogue. The storyboarder picks one technique per slide; the builder implements it. Each `## id` is a technique id used in `index.json`; exemplars are picked by id, never by topic. Recipes give a layout in px on the 1920×1080 canvas, what each step changes, the label rule, the interaction, and the failures reviewers find most often for that technique.

## Universal rules (every technique)
- **Canvas.** 1920×1080; text inside x 96…1824, y 72…1008. Title block top-left (eyebrow y≈90, title 64–88px). The main visual fills the rest: at least ~60% of the area below the title, no empty quadrant, no lopsided cluster.
- **Type.** Titles 64–88px (title slides up to 128px), captions 30–38px, callout labels 22–28px, kicker 18–22px uppercase mono, footnotes 18–20px mono. Nothing under 18px, canvas text included.
- **Tokens.** Only `var(--df-*)` (note the hyphen: `--df-accent-2`; a misspelt variable silently renders black) or `api.theme.colors` in JS; canvas and WebGL take those hex values (use `globalAlpha` for tints: they ignore `var()` and `color-mix()`). Tints in CSS via `color-mix()`. Text on a filled chip uses `var(--df-bg)` or `var(--df-text)`, whichever reaches 4.5:1.
- **Steps.** `step(i)` is absolute: tween to state i from any state (`overwrite: true`). Every step must change the picture visibly (a new layer, a colour shift, a moved part), not just the caption. Step 0 already shows a meaningful picture.
- **Labels.** `.df-tag` chips (mono number + name) with a 1.5px leader line ending in a dot ON the target; compute both ends from the same coordinates. Alternate above/below, keep 24px between chips, clamp on-screen, never over the caption or title.
- **Legend.** Any colour that means something gets a `.df-legend` key in that exact colour; numbers carry units.
- **Motion.** GSAP, `power2/3.out` or `expo.inOut`, 0.4–1.6 s. Ambient loops in `api.onFrame`; respect `api.reducedMotion`.
- **Shot mode.** Finite tweens are settled for screenshots; loops get a ~2 s burst. When `api.shot` is true show a representative settled state: fixed `t`, seeded random (never `Math.random()`), sims run forward inside `step(i)`.
- **Self-contained.** No network, images or external fonts: SVG, canvas or Three.js primitives.
- **Honesty.** Real facts with source and year; "illustrative" or "not to scale" in a footnote when true.

## `title-hero`
**When:** opening or section slides.
- **Layout:** copy left x 96–900 (eyebrow, 96–128px weight 200–300 title with one `.df-grad`/accent word, 30–34px lede, mono agenda strip at y≈880); hero visual right x 960–1800, y 100–980 (3D object, generative SVG, big glyph).
- **Steps:** 1; an enter timeline staggers copy from y +30, opacity 0; the hero idles gently.
- **Pitfalls:** hero small or dark (fill ≥ 60% of its half, light it); more than ~20 words (cut to title + lede); a busy hero behind the copy (keep the copy's half calm).

## `procedural-3d`
**When:** a physical object, body or system is the subject.
- **Layout:** object fills 50–70% of the canvas height, centred or right of centre; caption bottom or a side column ≤ 520px.
- **Build:** `api.three(el, {fov, environmentIntensity 0.45–0.9})`; Lathe/Capsule/Sphere/`RoundedBoxGeometry`; `MeshPhysicalMaterial`; `CanvasTexture` (`SRGBColorSpace`) for surface detail; key + accent rim + dim fill light; radial-gradient contact-shadow plane; `kit.render()` in `onFrame`; idle sway ±0.2 rad.
- **Steps:** turn, highlight (emissive) or cut away one part per step.
- **Pitfalls:** object too dark or lost in the void (raise env intensity, rim light, frame tighter); silhouette doesn't read as the thing (model the 2–3 defining features); slow first frame under software rendering (heavy PMREM + `MeshPhysicalMaterial` on many parts: prefer `MeshStandardMaterial` + a hemisphere light).

## `exploded-3d`
**When:** "what's inside", "the parts of X".
- **Layout:** assembled object centred at ~50% height; exploded along one main axis spanning x 240–1680; labels above/below the axis; caption bottom-centre y≈940.
- **Steps:** 0 assembled; 1 explode (`explode.k` 0→1, camera dollies wide); then name 2–3 parts per step. In `onFrame` place each part at `a + (e − a)·k`.
- **Labels:** each `.df-tag` owns a `vis` 0..1; anchor via `kit.toSlide()` every frame; dy 90–330px alternating.
- **Pitfalls:** labels overlap the caption or each other (pick dy per part, clamp); parts edge-on (rotate the rig ~0.5 rad); leader lines that stop short (draw from the projected anchor itself).

## `annotated-labels`
**When:** naming the parts of any 3D or 2D visual.
- **Layout:** labels in the free band around the visual, never on it; leader lines 60–330px.
- **Rule:** project the anchor (`kit.toSlide` or SVG coords), place the chip at anchor + (dx, dy), line from anchor to the chip edge, dot on the anchor.
- **Pitfalls:** chip text too faint or chip filled with an accent (use the panel background, muted mono number); labels covering the subject or caption; anchors computed once while the object moves (update every frame).

## `particle-flow`
**When:** signals, energy, money, blood or material moving between components.
- **Layout:** nodes spread across x 160–1760, y 160–820; caption + legend bottom-centre (y 880–1010).
- **Build:** each flow is an SVG path `d` sampled once with `getPointAtLength` into a lookup table; a 2D canvas draws dots 25–35px apart, offset `t·speed mod spacing`, glow ring + core; faint track under them.
- **Steps:** one flow per step: tween `flow.on` 0→1 and light its legend key.
- **Pitfalls:** dots too small/faint to see in a screenshot (≥ 6px core, full opacity, settled `t` in shot); dots running over node labels (route paths around chips, labels outside the lanes); every flow the same colour (one accent per flow, ≤ 4, legend).

## `parametric-sim`
**When:** "what happens if…": a model with 1–3 parameters.
- **Layout:** the plot is the hero: x 96–1300, y 240–940, axes with units and ticks; control column x 1360–1824 (≈450px): sliders (`.df-range`, set `--fill`), a `.df-toggle`, 2–4 `.df-stat` readouts with units, a one-sentence verdict; legend under the plot; equation as a mono footnote at y≈990.
- **Build:** pure `simulate(params)` with a fixed dt; on `input` recompute and redraw at once. Steps set parameter presets (each a different regime) through the same function the controls use.
- **Shot:** run the sim forward in `step(i)` when `api.shot`, so the plot is full.
- **Pitfalls:** sparse canvas (axis ranges that the default run fills; ghost runs or a fan of alternatives behind the live one); readouts without units or out of sync with the drawing (derive both from one result); unstyled controls (use the kit classes, active toggle filled).

## `packet-channel`
**When:** protocols, queues, logistics, messages through lanes.
- **Layout:** sources left (x 96–400), lanes across the middle (x 420–1400, 70–110px apart), receivers right; stats column or band x 1460–1824.
- **Build:** packets are DOM chips whose x is `(t − emit)/travel` on a deterministic schedule (pure function of t); a toggle switches the scenario; counters/progress at the receiver.
- **Steps:** 0 scenario A, 1 scenario B (call the same `setMode`).
- **Pitfalls:** the difference only shows in numbers (make it visible in order, colour or queue length); chips overlapping lane labels (labels above the lane); random schedule (seed it, so shots are stable).

## `step-through-pipeline`
**When:** state machines, algorithms, procedures, multi-stage processes.
- **Layout:** step tabs y≈260 (call `api.setStep(i)` on click); diagram/grid x 96–1300, y 360–900; "current state" panel x 1360–1824; caption y≈980.
- **Build:** `render(i)` derives the whole view from a table `[{tab, name, …, text}]`.
- **Pitfalls:** tab states reversed or all alike (active = filled ink, others outline); a highlight that never moves (outline the current cell each step); hazards/exceptions not marked (hatched pattern in the warm accent).

## `timeline`
**When:** history, roadmaps, evolution.
- **Layout:** axis at y≈470–560 spanning x 96–1824, drawn 2px in the text colour above the bands; era bands as tinted rectangles; event cards (≈240px wide) on two alternating levels above/below with leader lines + dots.
- **Build:** a scale function; piecewise with a visible break (≈) for uneven eras.
- **Steps:** reveal era by era; one quantitative chip where it carries the argument.
- **Pitfalls:** axis invisible against the grid (2px, full contrast, above the bands); cards colliding at dense dates (alternate levels, shift x, clamp to margins); era labels in a pale accent (mix the accent towards the text colour).

## `data-story`
**When:** a trend, a change, a result from data.
- **Layout:** chart x 96–1500, y 260–940 with light gridlines; annotations in the free space; headline number top-right or beside the effect.
- **Steps:** baseline → cause/marker → effect → headline number counted with `gsap.to(obj,{v})` + `onUpdate`. Bars tween `attr:{y,height}`; lines draw via `strokeDashoffset`.
- **Pitfalls:** curves that contradict the stated numbers (compute from data); values clamped flat at the axis top (scale the axis to the data); context and story in the same colour (muted vs one bright accent).

## `comparison`
**When:** before/after, A vs B.
- **Layout:** header row y≈320; 3–4 rows of 150–180px: metric label (x 96–760), column A (muted), column B (bold) with a delta chip.
- **Steps:** 0 A only (B dimmed); 1 B counts up, chips pop with `back.out`.
- **Pitfalls:** chips with low-contrast text on a bright fill; units as big as the numbers (≈ 45% size); singular/plural units wrong.

## `typographic-statement`
**When:** a quote, a thesis, one provocative number.
- **Layout:** one sentence at 120–170px across x 96–1700, y 240–760; attribution with a rule below; a large ornamental mark in a muted accent behind.
- **Build:** masked word spans (`overflow:hidden`) tweened `yPercent` 110→0 with a stagger; key word coloured with an SVG underline drawn by `strokeDashoffset`.
- **Steps:** 0 statement; 1 context (stat, dot field, source) arrives visibly.
- **Pitfalls:** step 2 changes nothing visible; the ornament collides with words (keep it ≥ 3× larger and faint, or apart); an unsourced or misattributed quote.

## `network-graph`
**When:** relationships, spreading, dependencies, food webs.
- **Layout:** 15–30 nodes across x 160–1500, y 220–940 (deterministic positions, by layer or seeded); legend with counts in a column x 1560–1824.
- **Build:** edges from data; compute degree, BFS or cascades in the slide.
- **Steps:** reveal hops/clusters/removals with per-group colours; pulses travel active edges.
- **Pitfalls:** hairball (lay out by level, short edges); node labels over edges or each other (labels beside nodes, offsets per side); the legend's colours not matching the nodes.

## `equation-build`
**When:** a formula or derivation is the point.
- **Layout:** the equation at 72–110px in display/mono, top band y 200–380 or a left column; a diagram fills the rest (≥ 50% of the canvas); plain-words caption under the equation.
- **Build:** each term its own span; Unicode maths (·, ², √, Σ, −, σ); the term and its diagram part share one accent.
- **Steps:** one term per step; the matching diagram part appears/glows; the last step evaluates it with a real number.
- **Pitfalls:** the diagram is small and the equation floats alone (size the diagram first); colours that don't link term to part; old-style figures in display serifs (put `font-variant-numeric: lining-nums` after the `font:` shorthand).

## `map-geo`
**When:** places, routes, spread over geography.
- **Layout:** the map fills x 96–1400 (or full width under the title); notes/stats column at the right; projection note as footnote.
- **Build:** a simplified outline from real lat/lon points through a projection function, or a stylised street/dot grid; routes as paths with flow or dashes; data as sized circles or bars.
- **Steps:** add layers: outline → regions/shading → points/routes → the headline chip.
- **Pitfalls:** unrecognisable shape (trace enough real coastline points: capes, gulfs); chips cut off at the canvas edge (clamp, flip side); more than 6 labelled places.

## `process-loop`
**When:** cycles and feedback.
- **Layout:** 3–6 stages on a circle (centre ≈ (760, 590), r 300–360) or rounded rectangle with arrowed arcs; the loop's purpose in the centre; stage captions outside the ring; detail column right.
- **Build:** one glowing token travels the loop path in `onFrame` (fixed angle in shot mode).
- **Steps:** highlight the active stage (fill + accent ring) and swap the caption.
- **Pitfalls:** the token parks over a stage label (keep it on the path between stages); every stage looks active (dim the rest to ~35%); arrows everywhere (one per arc).

## `layered-stack`
**When:** architectures, anatomy layers, geology, depth zones.
- **Layout:** bands of consistent height stacked in x 360–1300 (2D) or separated 3D slabs; labels left (x 96–340) with leader lines; detail panel right (x 1360–1824).
- **Steps:** lift or expand one layer per step in the accent while the others dim; the detail panel swaps.
- **Pitfalls:** labels floating off their band (leader to the band's edge); the highlighted layer not distinguishable (accent fill or outline + lift ≥ 30px); dimming by transparency (3D inner faces show through; tint towards the background instead).

## `zoom-scale`
**When:** orders of magnitude.
- **Layout:** a nested frame fills the canvas centre (≈ 1200×800); scale bar + magnitude counter bottom-left; level name top-right.
- **Build:** each level drawn inside the previous one at 1/10…1/1000 size; step scales the container with `expo.inOut` around the nested frame's centre, the new layer fades in.
- **Pitfalls:** scaling from the wrong origin so frames slide off-screen (set `transform-origin` at the child's centre); no familiar reference object at each level; text at extreme scales (fade a level out, `visibility:hidden`, once its scale leaves ~0.02–4).

## `key-takeaways`
**When:** the closing summary.
- **Layout:** 3–4 equal cards across x 96–1824, y 330–860; closing line y≈940.
- **Build:** mono number, 2–3 word one-line title, 1–2 sentence body, footer fact; staggered reveal; optional generative background echoing the topic.
- **Pitfalls:** card titles wrapping; bodies of very different length; a background that competes with the text (≤ 30% opacity behind the cards).
