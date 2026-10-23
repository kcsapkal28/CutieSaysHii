# DeckForge — Build Prompt

You are building **DeckForge**, an engine that turns a topic + brief into a finished, animated, interactive HTML presentation through a 5-step wizard. The user makes ≤6 decisions total. Everything else is derived from the catalog files in `./catalog/`.

All paths in this document are relative to the repo root (`CutieSaysHii/`); this file lives at `docs/BUILD_PROMPT.md`. Read `./catalog/*.json` first. They are the single source of truth for styles, palettes, type families, motion templates, interactions, slide types and allowed combinations. Do not hard-code any of that in UI or renderer code — load it.

---

## 0. Non-negotiable design decisions

1. **LLMs write JSON, never HTML.** Content and design decisions are produced as validated JSON (Zod schemas). A deterministic renderer turns JSON into HTML. This is what makes output reliable and debuggable.
2. **Three agents, one harness.** No agent calls another agent. The harness sequences them, validates every output, retries on schema failure, and streams progress to the UI.
3. **Every stage is a pure function `(input, catalog) → output`** stored on disk under `jobs/<jobId>/<stage>.json`. Any stage can be re-run in isolation.
4. **Three.js is opt-in**, loaded only when the resolved theme requests it (`threeJs: "default"` or user-enabled `"optional"`). Default decks ship without it.
5. **QA is automated and blocking.** A deck is not "done" until Playwright confirms every slide renders without overflow, console errors, or contrast failures.
6. **One LLM client, local proxy by default.** Every model call (agents A–C and the Step 1 hint) goes through a single client in `packages/harness/llm.ts`, configured only from env. The default endpoint is the local `claude-openai` proxy's Anthropic passthrough (`http://localhost:4001`); see §1a. No other file constructs an SDK client or knows a URL.

---

## 1. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Monorepo | pnpm workspaces + Turborepo, TypeScript strict | shared schemas between UI, harness, renderer |
| Wizard UI | Next.js 15 (App Router), Tailwind v4, shadcn/ui, Framer Motion (UI micro-animations only) | fast to build, SSE-friendly |
| API / Harness | Next.js route handlers + a standalone `packages/harness` Node library | harness must be runnable from CLI too (`pnpm forge run brief.json`) |
| Job state | SQLite via Drizzle ORM (`jobs`, `stages`, `events`) | zero infra; swap to Postgres later |
| Queue | In-process `p-queue` (concurrency 2). No Redis. | keep it simple |
| LLM | Anthropic SDK (`@anthropic-ai/sdk`), `claude-sonnet-5-5` for Content & Design agents, `claude-haiku-5-5` for QA patch suggestions. Tool-use with `strict` JSON output. Default `baseURL` is the local `claude-openai` proxy on port 4001 (§1a). | proxy uses the developer's Claude login — no API key needed for local dev |
| Validation | Zod v3 (schemas in `packages/schemas`) | shared by harness, UI, renderer |
| Renderer | `packages/renderer`: Handlebars templates → Reveal.js 5 + compiled Tailwind (per-theme CSS file, not CDN) + GSAP 3 + Three.js r16x (lazy ESM import) | Reveal handles nav/fragments/notes/PDF export |
| QA | Playwright (Chromium) | screenshots, overflow detection, console capture, axe-core contrast |
| Export | Self-contained `dist/<jobId>/index.html` + `assets/`; PDF via Reveal `?print-pdf` + Playwright | |
| Testing | Vitest (unit), Playwright (e2e on the 9 golden combinations in `compat-matrix.json`) | |

Repo layout:
```
apps/web            # wizard + preview + progress UI
packages/schemas    # Zod: BriefSpec, Choices, DeckSpec, ThemeSpec, MotionPlan, InteractionPlan, RenderManifest, QAReport
packages/catalog    # loads ./catalog/*.json, exposes typed accessors + compat resolver
packages/harness    # pipeline runner, agents, retries, event bus, job store, llm.ts (the only LLM client)
packages/renderer   # JSON → HTML, templates/, themes/, motion/, interactions/
packages/qa         # Playwright checks, patch loop
catalog/            # the JSON files provided
jobs/               # runtime artifacts (gitignored)
.env.example        # LLM endpoint defaults (§1a); real .env is gitignored
```

### 1a. LLM endpoint (default: local `claude-openai` proxy)

All LLM traffic goes to the **`claude-openai` proxy** (sibling project at `~/Documents/Cursor-Projects/claude-openai`). DeckForge uses its **Anthropic Messages passthrough on port 4001**, which forwards `/v1/messages` and `/v1/messages/count_tokens` to `api.anthropic.com` unchanged using the developer's Claude login. Do **not** use the proxy's OpenAI-compatible port 4000: it has no tool calling, and the agents depend on strict tool-use output.

Config (read once in `packages/harness/llm.ts`, validated with Zod at startup):

| Env var | Default | Notes |
|---|---|---|
| `LLM_BASE_URL` | `http://localhost:4001` | Passed as the SDK's `baseURL`. Set to `https://api.anthropic.com` to bypass the proxy. |
| `LLM_API_KEY` | *(required)* | The proxy's shared key (`API_KEY` env var or `DEFAULT_API_KEY` in its `server.js`), or a real Anthropic key when bypassing. Never commit it. |
| `LLM_MODEL_CONTENT` | `claude-sonnet-5-5` | Agent A |
| `LLM_MODEL_DESIGN` | `claude-sonnet-5-5` | Agent B |
| `LLM_MODEL_FAST` | `claude-haiku-5-5` | Agent C and the Step 1 hint |

```ts
// packages/harness/llm.ts — the only place an SDK client is constructed
export const llm = new Anthropic({ baseURL: env.LLM_BASE_URL, apiKey: env.LLM_API_KEY, maxRetries: 4 });
```

Rules:
- **Preflight.** Before a job's first stage, call `GET {LLM_BASE_URL}/v1/models`. If the connection is refused, fail the job immediately with: `LLM proxy not reachable at <url> — start it with: cd ~/Documents/Cursor-Projects/claude-openai && bash start.sh`. `pnpm forge` and the web app's job page both show this message as-is.
- **Rate limits.** The proxy shares the Claude Code rate-limit pool. Retry 429/529 with the SDK's backoff (`maxRetries: 4`). Keep the queue's concurrency at 2, and log rate-limit retries as `StageEvent`s so the UI can show "waiting on rate limit".
- **Model IDs are passed through unchanged.** Port 4001 does not remap names, so use full Claude model IDs. Never use OpenAI aliases.
- **Browser never calls the LLM.** The Step 1 hint goes through a Next.js route handler that uses the same `llm` client, so the key never reaches the client.
- **CI** cannot use the proxy (it needs a local keychain login). CI sets `LLM_BASE_URL=https://api.anthropic.com` and `LLM_API_KEY` from a secret. No other code changes.

---

## 2. Pipeline and data contracts

```
BriefSpec ─┐
Choices  ──┼─▶ [Content Agent] ─▶ DeckSpec
           │
           └─▶ [Design Agent]  ─▶ ThemeSpec + MotionPlan + InteractionPlan
                                        │
                      DeckSpec ─────────┼─▶ [Renderer] ─▶ RenderManifest + dist/
                                        │
                                   [QA Agent] ─▶ QAReport (+ patched DeckSpec, loop ≤3)
```

### BriefSpec (Step 1)
```ts
{ topic: string(3..120), brief: string(20..1500), audience: "general"|"technical"|"executive"|"students",
  durationMin: 5|10|20|30, language: "en" }
```
### Choices (Steps 2–4)
```ts
{ depth: "overview"|"standard"|"deep",
  styleFamilyId: string,            // catalog/design-styles.json
  paletteId: string,                // auto-selected, user may override within allowedPalettes
  typeFamilyId: string,             // auto-selected, overridable
  motionTemplateId: string,         // catalog/motion-templates.json
  interactionModeId: string,        // catalog/interactions.json
  threeJs: boolean }                // only shown if family.threeJs !== "never"
```
### DeckSpec (Content Agent output)
```ts
{ title, subtitle, slides: Slide[] }
Slide = { id, type: SlideTypeId, title?, body: Block[], notes: string, emphasisTargets: string[] }
Block = Bullets | Paragraph | Stat | Quote | Diagram(mermaid) | Chart(data) | Compare | Timeline | Code | Image(prompt) | Quiz
```
Slide counts, max visible words per slide and speaker-note length come from `slide-types.json` → `depth` (currently overview 6–8 slides / ≤30 words, standard 10–14 / ≤40, deep 16–22 / ≤45). QA enforces the word cap. `Quiz` blocks appear only on `quiz` slides.

### ThemeSpec (Design Agent output)
Resolved CSS tokens: palette roles (`bg, surface, text, textMuted, primary, accent, border`), type (display/body/mono font + scale), radius, borderWidth, shadow, texture, gradient flags, image treatment. Compiled to `themes/<jobId>.css` by the renderer.

### MotionPlan
Per slide: `{ transition, enter, emphasis, exit }` resolved from the motion template's `bySlideType` defaults; Design Agent may override per slide with a reason. Must include `reducedMotion` fallback.

### InteractionPlan
Per slide: zero or more components from the chosen mode's `components` list, with props bound to DeckSpec blocks.

### QAReport
```ts
{ pass: boolean, slides: { id, overflow: boolean, consoleErrors: string[], contrastFails: {...}[], wordCount: number }[], patches: Patch[] }
```

---

## 3. The three agents

### Agent A — Content
- Input: BriefSpec, Choices.depth, catalog/slide-types.json
- Output: DeckSpec
- System prompt rules: one idea per slide; title ≤8 words; bullets ≤5 × ≤12 words; every non-title slide has speaker notes within the depth's `notesWordsPerSlide` range; choose slide **type** from the catalog deliberately (data → `stat`/`chart`, process → `timeline`/`diagram`, tradeoffs → `compare`); last slide is `summary` then `qa`.
- Tool: `emit_deck(DeckSpec)` with strict schema. Harness validates; on failure, re-prompt with Zod error text (max 2 retries).

### Agent B — Design
- Input: Choices, DeckSpec (slide types + emphasisTargets only, not full text), catalog (styles, palettes, type, motion, interactions, compat)
- Output: ThemeSpec, MotionPlan, InteractionPlan
- Rules: must respect `compat-matrix.json`; may only override per-slide motion for `stat`, `quote`, `title`, `summary`; must map at least one interaction component per 4 slides in Explorable/Assessment modes; must not invent tokens outside the catalog.
- Tool: `emit_design({theme, motion, interaction})`.

### Agent C — QA Patcher
- Input: QAReport, failing slides' DeckSpec entries
- Output: `Patch[]` = `{ slideId, op: "shortenText"|"splitSlide"|"swapLayout"|"dropBlock", payload }`
- Only invoked when Playwright finds failures. Harness applies patches, re-renders, re-runs QA. Max 3 loops; then surfaces remaining failures in UI with a "Fix manually" affordance.

---

## 4. Harness (`packages/harness`)

```ts
runJob(jobId):
  stage("content",  () => agentA(brief, choices))      // validate DeckSpec
  stage("design",   () => agentB(choices, deckSkeleton))
  stage("render",   () => renderer.build(deck, theme, motion, interaction))
  loop(max=3): stage("qa", () => qa.run(dist)); if pass break; stage("patch", agentC)
  stage("export",   () => pdf + zip)
```
Requirements:
- `stage()` persists input/output JSON, duration, token usage, retries; emits `StageEvent` on an in-memory EventEmitter bridged to SSE (`/api/jobs/:id/events`).
- Idempotent re-run: `pnpm forge rerun <jobId> --from design`.
- Hard timeouts per stage (content 90s, design 45s, render 30s, qa 60s).
- Cost guard: abort job if cumulative tokens > configurable cap.
- LLM preflight against `LLM_BASE_URL` before the first stage (§1a). Time spent in rate-limit backoff is reported separately from the stage's own timeout.
- Golden tests: the 9 combinations in `compat-matrix.json` → `golden`, one fixed brief each (`fixtures/golden/<n>.brief.json`), must render green in CI.

---

## 5. UI specification (`apps/web`)

**Global layout:** 3 columns on ≥1280px.
- Left rail (240px): vertical stepper — 1 Brief · 2 Look · 3 Motion · 4 Interaction · 5 Review. Completed steps show a checkmark and a one-line summary of the choice; clicking jumps back.
- Center (flex): the current step's form. Max width 720px.
- Right panel (420px, sticky): **Live Sample Slide** — a fixed sample slide ("How solar cells work") re-rendered client-side with the current theme/motion choice. This is the most important UI element; it is what lets the user decide without reading descriptions. Below it: small "What you'll get" summary (est. slide count, est. duration, libraries included).
- Below 1280px: right panel collapses into a "Preview" sheet (bottom drawer on mobile).
- Primary action bottom-right of center column: `Continue →` (disabled until valid). `← Back` secondary. `Enter` advances when the form is valid.

**Step 1 — Brief**
- `Topic` single-line input, placeholder "e.g. Kubernetes autoscaling for SREs", counter 3/120.
- `Brief` textarea 6 rows, counter, helper text: "What should the audience know or do afterwards?"
- `Audience` segmented control (4 options). `Duration` segmented (5/10/20/30 min).
- On blur of Brief, show a non-blocking hint from a `LLM_MODEL_FAST` call made server-side through the shared client (§1a): "Sounds like a technical deep-dive — we'll suggest Deep." (skippable).

**Step 2 — Look (the three questions)**
- Q1 Depth: 3 radio cards in a row. Each card: name, slide-count range, one-line "best for".
- Q2 Style family: 8 tiles in a 4×2 grid. Each tile is a **rendered 160×90 thumbnail** of the sample slide in that family (generated at build time from the catalog, cached as PNG). Hover: tile lifts, right panel previews it live. Below the grid: "Includes: Minimalism, Geominimalism, Flat Design, Bento" so the 30 names remain discoverable.
- Q3 Palette: auto-selected; shown as 6 swatch circles with a `Change` link that expands to the family's `allowedPalettes` (2–4 rows of swatches). Type family shown the same way beneath it. Both collapsed by default — the user should not have to touch them.

**Step 3 — Motion**
- 5 cards in a row. Each card contains a **looping 3-second CSS/GSAP micro-preview** of a title + bullet slide using that template (muted, autoplay, `prefers-reduced-motion` → static). Card body: name, 1 line, chips for "subtle / medium / bold".
- Cards not allowed by `compat-matrix` for the chosen family are rendered disabled with a tooltip "Not available with Brutalist".
- Toggle below: `3D depth effects (Three.js)` — only visible when `family.threeJs !== "never"`; off by default unless `"default"`.

**Step 4 — Interaction**
- 3 cards: Linear · Explorable · Assessment. Each shows an icon row of the components it adds and a 1-line "audience experience".
- Selecting Assessment reveals a single extra control: number of check-questions (2/4/6).

**Step 5 — Review & Generate**
- Summary table of all choices with inline `Edit` links.
- Big `Generate deck` button. On click → navigates to `/jobs/:id`.

**Progress page `/jobs/:id`**
- Horizontal stage stepper: Content → Design → Render → QA → Export, each with spinner/check/error state and elapsed time.
- Live log panel (SSE), collapsible, monospace.
- Filmstrip appears as soon as Render finishes: slide thumbnails populate left to right; QA failures badge the thumbnail red with the reason on hover.
- On completion the page transitions into the Result view (no navigation).

**Result view**
- Center: `<iframe>` of the deck, 16:9, with Reveal controls visible. Keyboard passes through.
- Left: filmstrip (vertical). Click to jump. Each thumbnail has a `⋯` menu: Regenerate text · Change layout · Delete slide · Edit notes. Regenerate text calls Agent A for that slide only, then re-renders.
- Top bar: deck title (editable), `Export ▾` (HTML zip · PDF · Speaker notes .md), `Open fullscreen`, `Share link`.
- Right (collapsible): Design tweaks — palette swatches, type family, motion template. Changing any re-runs from `design` stage, not `content`.

**Accessibility & polish**
- All palette pairs used for text must pass WCAG AA; the renderer asserts this at theme compile and QA re-checks in the browser. Text uses only `text`/`textMuted` on `bg`/`surface`, or a pair listed in the palette's `contrast`. `primary` and `accent` are fills and are never text on `bg`.
- Honor `prefers-reduced-motion` in both wizard and output.
- Wizard itself uses the **Minimal / Warm Minimalist** theme from the catalog so the product doesn't fight the previews.

---

## 6. Renderer details (`packages/renderer`)

- One Handlebars template per slide type in `catalog/slide-types.json`; each template exposes named regions (`title`, `body`, `aside`, `footer`).
- Theme compile: `ThemeSpec → CSS custom properties + Tailwind config → themes/<id>.css` (Tailwind CLI at build time, cached by theme hash).
- Motion: `MotionPlan → data-motion-*` attributes on elements; a single `motion/engine.ts` reads attributes and builds GSAP timelines on Reveal's `slidechanged`. Templates stay motion-agnostic.
- Interactions: web components (`<df-hotspot>`, `<df-reveal>`, `<df-quiz>`, `<df-chart>`, `<df-compare>`) in `interactions/`; each ≤5KB, no framework.
- Three.js: `motion/depth.ts` lazy-imported only when `threeJs=true`; provides a background particle/plane layer and parallax on `title` and `summary` slides. Nothing else depends on it.
- Output must work from `file://` (no absolute paths, no server).

---

## 7. Build order (do in this sequence; each step ends with a passing test)

1. `packages/schemas` + `packages/catalog` with loader, compat resolver, and tests that every catalog cross-reference resolves.
2. `packages/renderer` rendering a hand-written `DeckSpec` fixture in 3 families with the Calm template. Visual snapshot tests.
3. `packages/harness` CLI running Agent A → Agent B → render on a golden brief, through `llm.ts` against the local proxy (§1a), including the preflight and its "proxy not reachable" error. Also add `.env.example` with the §1a defaults. No UI yet.
4. `packages/qa` Playwright checks + Agent C loop.
5. `apps/web` Steps 1–5 with the live sample slide panel (drive it from the real renderer in the browser, not a mock).
6. Progress + Result pages with SSE.
7. Export (PDF, zip), per-slide regenerate, design tweaks.
8. CI: lint, unit, golden e2e (9 runs). CI points `LLM_BASE_URL` at `https://api.anthropic.com` with a secret key, because the proxy is local-only.

## 8. Acceptance criteria

- From empty form to downloadable deck in ≤6 user decisions and ≤120s wall time for a `standard` deck.
- 9/9 golden combinations render with zero QA failures without manual intervention.
- Output HTML opens from disk, is ≤2.5MB without Three.js, ≤4MB with.
- Changing palette or motion after generation never re-calls the Content Agent.
- No catalog value appears as a string literal anywhere outside `catalog/`.
