# Explainer techniques

This is a topic-agnostic catalogue for the storyboarder, which picks one technique per slide, and the builder, which implements it. Each `## id` is a technique id used in `index.json`. Pick exemplars by id, not by topic.

## Universal rules (every technique)
- **Canvas and type.**
  - The canvas is 1920×1080. Keep a margin of about 128px on the sides and 90px top and bottom.
  - Use only `--df-*` variables for colour and type. In JS, read `api.theme.colors`.
  - Set type sizes in px: titles 64–96, body 24–34, labels 18–22, footnotes 16–18 mono.
  - Never set text smaller than 16px.
- **One idea per step.**
  - Give each step a caption sentence that says what changed.
  - `step(i)` is absolute: it must reach state i from any state. Use `gsap.to` with `overwrite: true`, not relative tweens.
- **Hierarchy.**
  - One focal element per slide.
  - Muted colour for context, one accent for the story, and at most four accent hues.
  - The headline states the conclusion, not the topic.
- **Motion.**
  - Use GSAP for reveals, ease `power2/3.out` or `expo.inOut`, 0.4–1.6 s, with 0.05–0.15 s staggers.
  - Ambient loops go in `api.onFrame`. Respect `api.reducedMotion`.
  - Never animate layout-critical sizes every frame.
- **Shot mode.**
  - Screenshots settle finite tweens automatically.
  - Time-driven sims and ambient loops must show a representative state when `api.shot` is true. Use a fixed `t`, or a deterministic seed, never `Math.random()`.
- **Self-contained.**
  - No network, images or fonts from outside.
  - Draw with SVG, canvas or Three.js primitives. Use `CanvasTexture` for surface detail.
- **Labels.**
  - Use `.df-tag` boxes with a mono number and leader lines (SVG `line` plus a dot).
  - Alternate them above and below, and clamp them on-screen.
- **Honesty.**
  - Use real facts with dates or sources.
  - Label fictional or illustrative data as such in a footnote.
  - Say "not to scale" when it isn't to scale.

## `title-hero`
**When:** opening or section slides.
**Pattern:**
- Large light-weight display type (weight 200–300) with one `.df-grad` or accent word.
- A short lede and an optional three-beat agenda strip.
- A hero visual on the other half: a 3D object, generative SVG, or a big glyph.
- Enter timeline: stagger text from y +30, opacity 0.
**Polish:** asymmetric composition, generous space, and no more than about 20 words visible.

## `procedural-3d`
**When:** a physical object, body or system is the subject. Examples: a device, molecule, planet or organ.
**Pattern:**
- Use `const kit = api.three(container, { fov, environment, exposure })`.
- Build from primitives: `LatheGeometry` for turned shapes, `CapsuleGeometry`, `SphereGeometry` and `THREE.RoundedBoxGeometry`.
- Use `MeshPhysicalMaterial` with clearcoat for plastics and `metalness` for metal.
- For surface detail, paint a 2D canvas into a `CanvasTexture` with `colorSpace = SRGBColorSpace`.
- Lighting: environment on, one key light, a coloured rim light from behind (accent), and a dim fill.
- Add a floating contact shadow: a plane with a radial-gradient canvas texture.
- Call `kit.render()` inside `api.onFrame`.
**Polish:**
- The object fills 50–70% of the slide height.
- Not too dark: environmentIntensity 0.45–0.9.
- A slow idle sway of ±0.2 rad, plus a slight float.

## `exploded-3d`
**When:** "what's inside" or "the parts of X".
**Pattern:**
- Each part is a group with an assembled position `a` and an exploded position `e`.
- A single `explode.k` (0..1) is tweened by `step()`. In `onFrame`, set the position to `a + (e − a)·k`.
- Dolly the camera from close (assembled) to wide (exploded).
- Introduce labels 2–3 per step; each label owns a `vis` value tweened 0..1.
**Polish:**
- 6–10 parts.
- Explode along one main axis, with small parts offset up or down.
- Rotate the rig so disc faces show, never edge-on.

## `annotated-labels`
**When:** naming the parts of any 3D or 2D visual.
**Pattern:**
- Each frame, project the anchor with `kit.toSlide(worldVec)` (3D) or use known SVG coordinates (2D).
- Position a `.df-tag` at anchor + (dx, dy). Draw an SVG line from the anchor to the label edge, plus a dot at the anchor.
**Polish:**
- Labels never overlap each other or the caption.
- Use dy of 90–330px, chosen per part.
- Clamp to the slide bounds.
- Leader lines land exactly on the part.

## `particle-flow`
**When:** signals, energy, money, data or material moving between components.
**Pattern:**
- Define each flow as an SVG path `d`.
- Sample `getTotalLength`/`getPointAtLength` into a lookup table once.
- Each frame, draw dots on a 2D canvas, spaced 25–35px apart, with offset `= t·speed mod spacing`. Give each dot a glow ring plus a dark core.
- Tween `flow.on` (0..1) per step. Light the matching `.df-legend` key.
**Polish:**
- Colour-code flows with theme accents, at most four.
- Build the system one flow per step.
- Run parallel flows on offset tracks so they don't overlap exactly.

## `parametric-sim`
**When:** "what happens if…": any model with 1–3 parameters (physics, epidemics, finance, signals).
**Pattern:**
- A pure `simulate(params)` function, or one that depends only on `t`.
- Controls: `<input type=range class="df-range">` (set `--fill`) and `.df-toggle` buttons. Use `aria-pressed` for the selected one.
- On `input`, recompute and redraw immediately.
- Show live `.df-stat` values plus a one-sentence verdict that interprets the numbers.
**Polish:**
- Pick defaults that show the interesting regime.
- Show the governing equation as a mono footnote.
- The chart is the hero; controls sit in a right-hand column about 450px wide.

## `packet-channel`
**When:** protocols, queues, pipelines of messages, logistics.
**Pattern:**
- Draw endpoints as boxes and channels as lanes or pipes.
- Packets are DOM chips whose x is computed from `(t − emitTime)/travel`.
- Toggle buttons switch the scenario. The receiving side shows progress bars or counters, and big stats compare the scenarios.
**Polish:**
- Use a deterministic schedule so shots are reproducible.
- Make the difference between modes visible in the packet order or colour, not only in the numbers.

## `step-through-pipeline`
**When:** state machines, algorithms, CPU pipelines, multi-stage processes.
**Pattern:**
- Clickable step tabs at the top. On click, call `api.setStep(i)` so the deck step stays in sync.
- `render(i)` derives the whole view from a step table `[{tab, name, …, text}]`.
- Show a grid or diagram plus a "current state" panel.
**Polish:**
- Highlight the current column or cell with an outline.
- Mark hazards or exceptions with a hatched pattern in a warm accent.
- The caption explains the change.

## `timeline`
**When:** history, roadmaps, evolution of anything.
**Pattern:**
- An axis with a scale function. Use a piecewise scale with a visible break (≈) when the eras are uneven.
- Era bands are tinted rectangles with italic labels.
- Event cards sit on two alternating levels, each with a leader line and dot.
- Reveal events era by era with `step()`.
**Polish:**
- Few ticks.
- Each card holds a date, a title of 2–3 words and one line.
- Put one quantitative chip where it carries the argument.

## `data-story`
**When:** a trend, a change, or a result from data.
**Pattern:**
- An SVG chart with a scale function. Bars grow by tweening `attr: {y, height}`; lines draw via `strokeDashoffset`.
- Build in beats: baseline, then cause or marker, then effect, then the headline number counted with `gsap.to(obj,{v})` + `onUpdate`.
- Add annotations: brackets, dashed markers, text in the accent.
**Polish:**
- The headline is the conclusion.
- Context in a muted colour, the story in the one bright colour.
- Value labels on the bars, light gridlines, a source or "fictional" footnote.

## `comparison`
**When:** before/after, A vs B, old vs new.
**Pattern:**
- Aligned rows with a metric label, column A (muted) and column B (bold).
- Numbers count up, with delta chips (↑/↓ %) popping in using `back.out`.
- Hold B back until step 2.
**Polish:**
- At most 3–4 rows.
- Units are smaller than the numbers.
- Handle singular and plural units.

## `typographic-statement`
**When:** a quote, a thesis, a single provocative number.
**Pattern:**
- One sentence at 120–170px in the display face.
- Split it into masked word spans (`overflow:hidden` wrapper) and tween `yPercent` 110 → 0 with a stagger.
- Colour the key word and draw an SVG underline with `strokeDashoffset`.
- Add the attribution with a rule. Context arrives on step 2.
**Polish:**
- Plenty of empty space.
- A large ornamental mark in a muted accent.
- Real quotes only, with source and year.

## `network-graph`
**When:** relationships, spreading, dependencies, social or transport networks.
**Pattern:**
- Seeded random or hand-placed node positions. Edges come from data or nearest neighbours.
- Compute BFS, centrality or other metrics in the slide.
- Steps reveal hops or clusters with per-group colours, and pulses travel along the active edges.
**Polish:**
- 15–30 nodes.
- Inactive edges in `--df-line`, active ones thicker and in the group colour.
- A legend with counts.

## `equation-build`
**When:** a formula or derivation is the point.
**Pattern:**
- Put each term in its own span and reveal terms per step.
- Colour-link each term to the matching part of a small diagram, using the same accent.
- Use a mono or display face. Write maths with Unicode (·, ², √, Σ, −); don't load MathJax.
**Polish:**
- At most one equation on screen.
- Each step names what the new term means in plain words.

## `map-geo`
**When:** places, routes, spread over geography.
**Pattern:**
- Use a simplified hand-drawn SVG outline, or an abstract dot grid. No tiles or downloads.
- Points via a projection function. Routes as SVG paths with a `particle-flow` or dash animation.
- Steps add regions or routes.
**Polish:**
- Use a stylised map; don't fake precision.
- Label 3–6 places at most.
- Note the projection or simplification.

## `process-loop`
**When:** cycles and feedback (control loops, life cycles, iteration).
**Pattern:**
- Place nodes on a circle or rounded rectangle and connect them with arrowed arcs.
- A single glowing token travels the loop in `onFrame`.
- Each step highlights the active stage and its caption.
**Polish:**
- 3–6 stages.
- Put the loop's purpose in the centre.
- Use direction arrows sparingly.

## `layered-stack`
**When:** architectures, protocol stacks, anatomy layers, geology.
**Pattern:**
- Stacked bands, in 2D or as slightly separated 3D slabs (`RoundedBoxGeometry`).
- Steps lift or expand one layer to show its inside, while the others dim.
**Polish:**
- Use consistent band heights.
- Put labels on the left and details on the right.
- Keep the highlighted layer in the accent colour.

## `zoom-scale`
**When:** orders of magnitude (atoms to galaxies, bytes to petabytes).
**Pattern:**
- Use nested frames. Each step scales the container by ×10…×1000 with `expo.inOut`, and a new layer fades in.
- A scale bar or counter shows the magnitude.
**Polish:**
- Use log steps.
- Keep one recognisable reference object at each level.

## `key-takeaways`
**When:** the closing or summary.
**Pattern:**
- 3–4 equal cards, each with a mono number, a 2–3 word title, one or two sentences, and an optional footer fact.
- Staggered timeline reveal.
- An optional generative background that echoes the topic.
**Polish:**
- Card titles stay on one line.
- Bodies are of similar length.
- End with a single closing line.
