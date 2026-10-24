# DeckForge v2: agent-built single-file explainer decks

Status: approved 2026-10-24. This replaces the template and catalog pipeline (Plans 2, 2c and 3 are paused on `feat/design` and `feat/harness`).

## Goal
Turn a topic into **one self-contained HTML file**: a presentation as good as hand-built explainer decks. The bar is set by the reference decks. Their slides contain:
- bespoke interactive simulations: a FIFO overrun sim, a build-up of DCT patterns, AXI packets flowing along channels;
- procedural Three.js objects: an exploded earbud with labelled parts and particle signal paths;
- restrained typography and colour;
- optional presenter tools: a pacing timer, notes, step navigation.

Agents write each slide's code freely. A small fixed shell keeps the deck consistent.

## User decisions (binding)
- Explainers are bespoke per slide, written by agents and verified in a real browser.
- 3D is procedural only (Three.js primitives with named parts). No model downloads.
- One-page Style Studio covering look, palette, fonts, motion level, 3D on/off, interactivity level and density. It shows a live preview and has a "Recommend for my topic" button.
- The workflow is staged, with an approval at each stage, and any stage can be re-run:
  1. brief and style;
  2. research;
  3. outline;
  4. script;
  5. storyboard;
  6. build;
  7. refine.
- Research uses web search (with citations) plus model knowledge. There is no document upload.
- Editing works by chatting per slide. Every build is saved as a version, so you can compare and roll back.
- Presenter features are an opt-in checklist: pacing timer, speaker notes (N), step navigation, PDF/print.
- Output is fully self-contained: Three.js, GSAP and fonts are inlined, and it works offline.
- It runs as a local Next.js app for one user, through the claude-openai proxy (`LLM_BASE_URL`/`LLM_API_KEY` in the gitignored `.env`).
- Quality comes first. Opus (`claude-opus-5-5`) handles storyboard, slide code and critique. Every slide goes through a screenshot check-and-fix loop. 15–40 minutes per deck is acceptable.

## Architecture
```
packages/forge   engine: shell, slide contract, bundler, renderer (Playwright), agents, CLI
apps/studio      Next.js UI: Style Studio, stage views, live preview, per-slide chat (milestone 2)
projects/<id>/   brief.json style.json research.md outline.json script.json storyboard.json
                 slides/<id>.html  versions/<n>/deck.html  shots/
```

### Agents (one prompt and one tool schema each; all called through one LLM client)
| Agent | Model | Output |
|---|---|---|
| Stylist | Sonnet | `style.json`: palette tokens, font pair, motion level and density recommended for the topic |
| Researcher | Sonnet + web search | `research.md`: facts with sources |
| Script writer | Sonnet | `outline.json`, then `script.json` (per slide: title, key message, narration/notes, time budget) |
| Content designer + Creative | Opus | `storyboard.json` (per slide: layout idea, visual type, the interaction or simulation, motion beats, 3D object spec) |
| Builder | Opus | `slides/<id>.html`, following the slide contract |
| Critic | Opus (vision) | issues JSON from the screenshots of every step, plus console errors. Each issue is fed back to the builder, for at most 3 rounds |

### Slide contract (the only interface between shell and agents)
- The canvas is 1920×1080. The shell scales it to fit the viewport.
- `slides/<id>.html` holds exactly three things:
  - one `<section class="df-slide" id="<id>">…</section>`. Speaker notes may go in `<aside class="df-notes">` inside it;
  - an optional `<style>`. Every selector must start with `#<id>`;
  - an optional `<script>` that calls `DF.slide("<id>", (api) => ({ steps, enter, step, leave, dispose }))`. All members of the returned object are optional.
- `api` provides:
  - `el` and `THREE`, `gsap`;
  - `theme`: the resolved tokens;
  - `motion`: `"none" | "subtle" | "rich"`, and `reducedMotion`;
  - `onFrame(cb)`: a shared rAF loop, paused while the slide is hidden;
  - `onResize(cb)`;
  - `three(canvas)`: a helper returning a renderer, scene and camera sized to an element, disposed automatically.
- `step(i)` runs within a slide (0..steps-1). Arrow keys and space advance through the steps before moving to the next slide.
- Theme CSS variables:
  - colours: `--df-bg`, `--df-surface`, `--df-text`, `--df-muted`, `--df-line`, `--df-accent`, `--df-accent-2`, `--df-accent-3`;
  - fonts: `--df-font-display`, `--df-font-body`, `--df-font-mono`.

  Slides use only these variables for colour and type.
- Shot mode is for verification. `deck.html?df-shot=<id>&step=<n>` jumps to that state with motion settled. It then resolves `window.__dfReady`, and collects errors in `window.__dfErrors`.

### Shell
- Keyboard and click navigation, a progress bar, and per-slide lifecycle (enter/leave/dispose, pausing rAF and Three.js on hidden slides).
- Optional features, switched on by `deck.json.features`:
  - `timer`: per-slide budget plus an ahead/behind indicator;
  - `notes`: an N overlay and a presenter window;
  - `stepNav`: section tabs plus segmented progress;
  - `print`: one page per slide.
- The bundler inlines the shell, theme, fonts (only the weights used, as base64), Three.js and GSAP (when any slide uses them) and every slide, into `deck.html`.

## Milestones
1. **Engine and a proof deck (now).** `packages/forge`: shell, contract, bundler, Playwright shots, LLM client, agents and the build/critique loop, plus a CLI: `pnpm forge new "<topic>" --style ...` → `projects/<id>/versions/1/deck.html`. Proof: an ANC-earbud deck (dark, cinematic, 3D) and a JPEG/DCT deck (light, interactive). Judge them against the reference screenshots before doing anything else.
2. **Studio UI.** Next.js: Style Studio with live preview, stage views with approve/edit/re-run, a streaming build preview, per-slide chat, versions.
3. **Polish.** Web-search research, presenter window, PDF, deck-level critique (consistency across slides).

## Reused from v1
- The proxy LLM client (`feat/harness:packages/harness/src/llm.ts`, simplified).
- `@fontsource` packages, Playwright, the esbuild IIFE bundling pattern and the SQLite store (milestone 2).

Nothing from v1 is deleted.

## Testing (kept light)
- Unit tests for the bundler (self-contained: no external URLs) and the contract checks.
- One e2e test: build the fixture deck, screenshot every slide and step, and assert zero console errors and zero network requests.
- Visual quality is judged from screenshots by the critic agent and by the user. There are no pixel baselines.
