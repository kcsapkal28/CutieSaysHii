# DeckForge

Turn a topic into **one self-contained HTML file**: a presentation with bespoke animated explainers, interactive simulations and procedural 3D, written slide by slide by AI agents and checked in a real browser.

You steer it from a local web app (the **Studio**): pick a look, approve each stage, then refine any slide by chatting with it. The result is a single `deck.html` with Three.js, GSAP and fonts inlined. It works offline.

## Quick start

```bash
./start.sh
```

That starts the LLM proxy (if it isn't already running) and the Studio, then opens <http://localhost:3210>. Ctrl-C stops both.

```bash
./start.sh --mock      # fake backend with timed fake output: no proxy, no LLM cost, good for UI work
./start.sh --no-open   # don't open the browser
```

### First-time setup

1. **Node 24+** and **pnpm** (`corepack enable`).
2. **The [claude-openai](https://github.com/gsapkal/claude-openai) proxy** checked out next to this repo (`../claude-openai`), or set `CLAUDE_OPENAI_DIR`. It must be on the `feature/deckforge-passthrough-controls` branch. `start.sh` launches it bound to `127.0.0.1` only.
3. **`.env`** in the repo root (gitignored):
   ```bash
   cp .env.example .env   # then set LLM_API_KEY to the proxy's key
   ```
4. `./start.sh` installs dependencies and the Playwright Chromium on first run.

Logs for a proxy started by the script go to `.logs/proxy.log`.

## How it works

A deck is built in stages. You approve each one, and any stage can be re-run.

| # | Stage | Agent | Output |
|---|---|---|---|
| 1 | Brief and style | Stylist (Sonnet) | `style.json`: palette, fonts, motion, 3D, interactivity, density, presenter features |
| 2 | Research | Researcher (Sonnet) | `research.md` |
| 3 | Outline | Script writer (Sonnet) | `outline.json` |
| 4 | Script | Script writer (Sonnet) | `script.json`: key message, narration, time budget per slide |
| 5 | Storyboard | Storyboarder (Opus) | `storyboard.json`: the explainer idea, interaction, motion beats and 3D parts per slide |
| 6 | Build | Builder (Sonnet) and Critic (Opus, vision) | `slides/sNN.html`, then `versions/<n>/deck.html` |
| 7 | Refine | Builder | per-slide chat edits; every build is a saved version |

The build stage writes up to 6 slides concurrently. Each slide goes through draft → screenshot every step in Chromium → critique → fix, for up to 2 rounds. The last fix escalates to Opus if the critic still reports a high-severity issue. Models and limits live in [`packages/forge/src/pipeline/config.ts`](packages/forge/src/pipeline/config.ts).

Presenter features (pacing timer, speaker notes, step navigation, PDF/print) are an opt-in checklist in the Studio.

## Layout

```
apps/studio/        Next.js Studio (port 3210): style page, stage views, live build, per-slide chat, versions
packages/forge/     the engine
  src/shell/        runtime for the final HTML: navigation, scaling, step lifecycle, Three.js kit
  src/bundle.ts     inlines shell, slides, Three.js, GSAP and fonts into one file
  src/shoot.ts      Playwright screenshots of every slide step, plus console and network errors
  src/check.ts      static check of the slide contract
  src/agents/       the agents; their prompts are in packages/forge/prompts/
  src/pipeline/     stage runner: runStage, reviseSlide, versions, events
  fixtures/exemplars/  14 reference slides across 5 decks, indexed by explainer technique
projects/           your decks (gitignored): brief, style, research, outline, script, storyboard, slides, versions
docs/               design docs
```

`packages/harness`, `packages/renderer`, `packages/schemas`, `packages/catalog` and `catalog/` belong to the earlier template-based pipeline. It is paused, not deleted.

### The slide contract

Each `slides/sNN.html` holds one `<section class="df-slide" id="sNN">` on a 1920×1080 canvas, an optional `<style>` whose selectors all start with `#sNN`, and an optional `<script>` calling `DF.slide("sNN", (api) => ({ steps, enter, step, leave, dispose }))`. Colours and fonts come only from the `--df-*` CSS variables, so the theme can change without touching slides. See [`docs/superpowers/specs/2026-10-24-deckforge-v2-design.md`](docs/superpowers/specs/2026-10-24-deckforge-v2-design.md).

## CLI

Without the Studio, from `packages/forge`:

```bash
pnpm forge bundle <projectDir>                            # writes <projectDir>/versions/<n>/deck.html
pnpm forge shoot <deck.html> [--slides s01,s03] --out <dir>   # screenshot every step of the slides
```

## Development

```bash
pnpm install
pnpm test        # engine and agent tests
pnpm typecheck
pnpm lint
```

Run just the Studio on the fake backend: `STUDIO_BACKEND=mock pnpm --filter studio dev`.

## Known limits

- **Cost:** a real build is expensive (about $14 for a 4-slide deck at the defaults). Cost reduction is planned.
- **Stop** in the Studio does not cancel a running build on the server.
- Runs are held in memory; restarting the Studio loses a run in progress. Finished decks stay on disk in `projects/`.
- Research uses model knowledge. Web search is a hook, not wired up yet.
