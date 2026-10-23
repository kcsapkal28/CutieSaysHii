# DeckForge Renderer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `@deckforge/renderer` turns `DeckSpec + ThemeSpec + MotionPlan + InteractionPlan` into a self-contained Reveal.js deck that opens from disk. A hand-written fixture deck renders in 3 style families with the Calm motion template, backed by visual snapshot tests (spec §7 step 2).

**Architecture:**
- **Pure parts** (`"."` export, browser-safe): theme CSS, block HTML, Handlebars slide templates and the HTML assembler.
- **Node parts** (`"./node"`): fonts, Mermaid → SVG via headless Chromium, the Tailwind CLI, the esbuild runtime bundle and `build()`.
- **Runtime:** browser code (`src/runtime/`) ships as **one classic IIFE script**, because Chromium refuses module scripts on `file://`. It contains Reveal 5, GSAP + SplitText, and a motion engine that reads `data-motion-*` attributes, so templates stay motion-agnostic.
- **Styling:** Tailwind compiles **once** from the templates. Themes vary only through CSS custom properties (`--df-*`), so each deck ships a shared `deck.css` plus its own small `theme.css`.

**Tech Stack:** reveal.js **5.2.1** (spec pins 5; 6.x exists, but upgrading is out of scope), gsap 3.15 (SplitText included), handlebars 4.7, tailwindcss + @tailwindcss/cli 4.3, highlight.js 11, mermaid 12 (build time only), playwright + @playwright/test 1.64, esbuild 0.28, `@fontsource/*` (all 24 catalog fonts confirmed to exist).

**Spec:** `docs/BUILD_PROMPT.md` §2 (ThemeSpec/MotionPlan/InteractionPlan/RenderManifest), §5 (accessibility), §6 (renderer), §7.2, §8. Builds on the foundation plan (`2026-10-23-deckforge-foundation.md`, merged).

## Global Constraints

- **Works from `file://`:**
  - Every `src`/`href` in the output is relative.
  - The output makes no network requests.
  - Scripts are classic `<script src>` tags, never `type="module"`.
- **Size:** output is ≤ 2.5 MB without Three.js. Measure as `totalBytes ≤ 2_621_440`.
- **Contrast:** text pairs pass WCAG AA (≥ 4.5). `compileThemeCss` throws otherwise (§5: "renderer asserts this at theme compile").
- **Reduced motion:** `prefers-reduced-motion` is honoured. The template's `reducedMotion` string decides the fallback.
- **Motion-agnostic templates:** templates emit only `data-motion-*`, `data-region` and `data-emphasis` attributes. All animation lives in `src/runtime/`.
- **No catalog literals:** no catalog ids, palette hexes or font names in source (`pnpm check:literals` must stay at 0). Colours and fonts reach the output only through `ThemeSpec` → CSS variables.
- **Deterministic output:** the same inputs produce a byte-identical `index.html`.
- **Theme values are untrusted:** `ThemeSpec` will come from an LLM (Design Agent), so any string written into CSS must not contain `;{}<>` or `\`.
- **CSS variable names** are fixed by the catalog, which already uses `var(--df-text)` and `var(--df-accent)`:
  - colours: `--df-bg`, `--df-surface`, `--df-text`, `--df-text-muted`, `--df-primary`, `--df-accent`, `--df-border`
  - fonts: `--df-font-display`, `--df-font-body`, `--df-font-mono`
- **Out of scope** (later plan "2b: interactions + depth"):
  - the `<df-*>` interaction web components beyond `df-fragment`/`df-notes`
  - Chart.js `df-chart`
  - Three.js `depth.ts`

  This plan renders those statically and adds a manifest warning instead.

## Review Focus

1. **Deck text that looks like markup or template syntax** (`</section><script>alert(1)</script>`, `{{x}}`, `&amp;`) in titles, bullets or notes. Expected: shown literally and never executed. → Task 5 test `escapes hostile text in every region and in notes`.
2. **Invalid Mermaid from the Content Agent** (`graph TD; A-->`). Expected: the build still succeeds, the slide shows the diagram source as readable text, and the manifest carries a warning. → Task 6 `invalid mermaid yields a warning, not a throw` and Task 5 `diagram without svg renders escaped fallback`.
3. **The deck folder path contains spaces or non-ASCII** (`~/My Decks/Énergie solaire/`). Expected: it opens from `file://` with zero console errors and zero failed requests. → Task 9 builds into `test-results/decks/<family> déck/`.
4. **An unbroken long token in a bullet** (a URL, `supercalifragilistic…` × 3). Expected: it wraps and never scrolls horizontally. → the fixture includes one; Task 9 `no region overflows horizontally`.
5. **Emphasis targets that are absent, overlap, or contain regex/HTML characters** (`C++`, `<b>`, `(1)`). Expected: matched literally or skipped, never corrupting markup. → Task 4 `emphasize` tests.

---

## File Structure

```
packages/schemas/src/design.ts            # + ThemeSpec mode/density/titleCase/backdropBlur/surfaceAlpha; MotionPlan.timing
packages/schemas/src/output.ts            # + RenderManifest.warnings
packages/catalog/src/resolve.ts           # resolveTheme, resolveMotionPlan (pure)
packages/renderer/
  package.json                            # exports "." → src/index.ts, "./node" → src/node.ts
  src/index.ts                            # pure exports
  src/node.ts                             # build, renderDiagrams, fontFaces, compileDeckCss, bundleRuntime
  src/theme/compile.ts                    # compileThemeCss, ThemeContrastError, UnsafeThemeValueError
  src/theme/fonts.ts                      # fontSlug, fontFaces (node)
  src/blocks/escape.ts                    # escapeHtml, emphasize
  src/blocks/chart.ts                     # chartSvg
  src/blocks/image.ts                     # placeholderImageSvg
  src/blocks/code.ts                      # highlightCode
  src/blocks/render.ts                    # renderBlock
  src/html/templates.ts                   # loadTemplates: reads + compiles templates/*.hbs (node)
  src/html/deck.ts                        # renderDeckHtml, RenderError
  src/diagrams.ts                         # renderDiagrams (node, Playwright Chromium)
  src/css.ts                              # compileDeckCss (Tailwind CLI, cached)
  src/bundle.ts                           # bundleRuntime (esbuild IIFE, cached)
  src/build.ts                            # build()
  src/styles/deck.css                     # Tailwind entry + @theme mapping to --df-* + base layout
  src/styles/textures.css                 # [data-df-texture="…"] rules
  src/styles/images.css                   # [data-df-image="…"] rules
  src/runtime/main.ts                     # Reveal.initialize + engine wiring (bundle entry)
  src/runtime/motion.ts                   # parseReducedMotion, resolveSlideMotion, parseCountUp (pure)
  src/runtime/presets.ts                  # ENTER/EMPHASIS/EXIT presets (GSAP), TRANSITIONS map
  src/runtime/engine.ts                   # DOM glue: slidechanged → timelines; ?df-motion=off
  templates/<slideTypeId>.hbs             # 16 templates, one per catalog slide type
  fixtures/solar.deck.json                # "How solar cells work", 15 slides
  fixtures/solar.interaction.json         # linear, df-fragment on bullets
  test/*.test.ts                          # vitest
  test/e2e/*.spec.ts                      # playwright (file:// e2e + visual)
  playwright.config.ts
  .cache/                                 # gitignored: compiled CSS + runtime bundle
```

---

### Task 1: Contract additions + catalog resolvers

**Files:**
- Modify: `packages/schemas/src/design.ts`, `packages/schemas/src/output.ts`, `packages/schemas/test/contracts.test.ts`
- Create: `packages/catalog/src/resolve.ts`, `packages/catalog/test/resolve.test.ts`
- Modify: `packages/catalog/src/index.ts`

**Interfaces:**
- Consumes: `validateChoices`, `getFamily`/`getPalette`/`getTypeFamily`/`getMotionTemplate` (foundation).
- Produces:
  - `ThemeSpecSchema` gains:
    - `mode: "light"|"dark"`
    - `density: "low"|"medium"|"high"`
    - `titleCase: "sentence"|"title"|"upper"`
    - `backdropBlur?: string`
    - `surfaceAlpha?: number` (0..1)
  - `MotionPlanSchema` gains `timing: { enter: number; stagger: number; transition: number; easing: string }`.
  - `RenderManifestSchema` gains `warnings: string[]`.
  - `resolveTheme(c: Catalog, choices: Choices): ThemeSpec`. It throws `Error` whose message lists `validateChoices` messages when they are non-empty. `roles`/`mode` come from the palette. `type` comes from the type family, with `display`/`body`/`mono` → `{font, weights, letterSpacing?}`. Tokens come from the family. `threeJs` = `choices.threeJs`.
  - `resolveMotionPlan(c: Catalog, templateId: string, slides: { id: string; type: string }[]): MotionPlan`. Per slide: `{ ...template.defaults, easing: template.timing.easing, ...template.bySlideType[slide.type] }`. `reducedMotion` = `template.reducedMotion`. `timing` = `template.timing`.

- [ ] **Step 1: Write the failing tests.**
  - `contracts.test.ts`: `ThemeSpec requires mode/density/titleCase` (the old fixture without them fails). `MotionPlan requires timing`. `RenderManifest requires warnings`. Update the existing valid fixtures so the other tests stay green.
  - `resolve.test.ts`:
    - `resolveTheme for every golden choice parses as ThemeSpec`: `goldenChoices(c).map(g => ThemeSpecSchema.parse(resolveTheme(c, g)))`.
    - `resolveTheme copies palette roles and family tokens`: for the minimal defaults, `theme.roles` equals the palette's `roles`, and `theme.radius === "0.5rem"`, `theme.density === "low"`, `theme.titleCase === "sentence"`.
    - `resolveTheme copies glass-soft backdropBlur "16px" and surfaceAlpha 0.55`.
    - `resolveTheme throws on invalid choices`: minimal + `paletteId: "brutal-pop"` throws `/does not offer palette/`.
    - `resolveMotionPlan applies bySlideType`: calm with `[{id:"a",type:"stat"},{id:"b",type:"bullets"}]` gives `a = {transition:"fade", enter:"fadeUp", emphasis:"countUp", exit:"fade", easing:"power2.out"}` and `b.enter === "fadeUp"`. Also `reducedMotion === "fadeOnly"` and `timing.stagger === 0.08`.
    - `resolveMotionPlan easing override`: pop stat gives `easing === "back.out(2)"`.
- [ ] **Step 2: Run** `pnpm test`. Expected: FAIL (new fields and `resolve.ts` missing).
- [ ] **Step 3: Implement** the schema additions and `resolve.ts`, and export from `index.ts`.
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck && pnpm lint`. Expected: all green.
- [ ] **Step 5: Commit** as `feat(catalog): resolveTheme/resolveMotionPlan; extend ThemeSpec, MotionPlan, RenderManifest`.

---

### Task 2: Renderer package + theme CSS

**Files:**
- Create: `packages/renderer/{package.json,tsconfig.json,src/index.ts,src/node.ts}`, `src/theme/compile.ts`, `src/styles/textures.css`, `src/styles/images.css`, `test/theme.test.ts`
- Modify: root `.gitignore` (add `packages/*/.cache/`, `test-results/`, `playwright-report/`)

**Interfaces:**
- Consumes: `ThemeSpec`, `passesAA`/`contrastRatio`, `resolveTheme`.
- Produces:
  - `compileThemeCss(theme: ThemeSpec): string`. It returns one `:root { … }` block containing:
    - the 7 colour vars
    - `--df-font-display|body|mono` (quoted family + generic fallback: `sans-serif`, or `monospace` for mono)
    - `--df-scale`, `--df-body-lh`, `--df-display-lh`, `--df-display-tracking` (em, default `0em`)
    - `--df-radius`, `--df-border-width`, `--df-shadow`
    - `--df-bg-image`: `linear-gradient(160deg, var(--df-bg), var(--df-surface))` if `gradients`, else `none`
    - `--df-pad` / `--df-gap`, by density: low `8%`/`2rem`, medium `6%`/`1.5rem`, high `4.5%`/`1rem`
    - `--df-title-transform`: sentence `none`, title `capitalize`, upper `uppercase`
    - `--df-title-tracking`: `0.04em` for upper, else `0em`
    - `--df-backdrop-blur` (default `0px`) and `--df-surface-alpha` (default `1`)
  - `class ThemeContrastError extends Error { pairs: string[] }`: thrown when `text`/`textMuted` on `bg`/`surface` is below AA.
  - `class UnsafeThemeValueError extends Error { field: string }`: thrown when a string token contains any of `;{}<>\`.
  - `textures.css` has one `[data-df-texture="<v>"] .slides::before { … }` rule per catalog texture except `none`. `images.css` has one `[data-df-image="<v>"] .df-image { filter/… }` rule per catalog image treatment.
- `package.json`:
  - `name @deckforge/renderer`, `type module`
  - `exports {".": "./src/index.ts", "./node": "./src/node.ts"}`
  - scripts: `test` (`vitest run`), `test:e2e` (`playwright test`), `lint`, `typecheck` as in the other packages
  - deps: the workspace packages + the libraries in Tech Stack + all 24 `@fontsource/<slug>` packages

- [ ] **Step 1: Write the failing tests** (`theme.test.ts`):
  - `emits every --df colour var from roles`: for the retro golden theme, the CSS contains `--df-text-muted: <roles.textMuted>`.
  - `density low sets --df-pad: 8%`. `titleCase upper sets uppercase + 0.04em`.
  - `gradients true sets a linear-gradient bg-image; false sets none`.
  - `throws ThemeContrastError when textMuted fails on surface`: retro theme with `roles.textMuted` set to `roles.surface`.
  - `throws UnsafeThemeValueError for shadow "0 0 1px red; } body { display:none"`.
  - `every catalog texture except none has a rule in textures.css` and `every catalog imageTreatment has a rule in images.css`. Read the CSS files as text and look for `[data-df-texture="${v}"]`.
- [ ] **Step 2: Run** `pnpm install && pnpm --filter @deckforge/renderer test`. Expected: FAIL.
- [ ] **Step 3: Implement** `compile.ts`, `textures.css` and `images.css`.
  - Textures: CSS-only overlays (inline SVG noise data-URI for `grain`, warm fibre gradient for `paper`, `repeating-linear-gradient` for `scanlines`, layered radial gradients for `fog`, small scattered radial dots in `var(--df-accent)`/`var(--df-primary)` for `confetti`). Opacity ≤ 0.12, `pointer-events:none`.
  - Images: plain CSS `filter`/`mix-blend-mode`, using only `var(--df-*)` colours.
- [ ] **Step 4: Run** the tests plus `pnpm typecheck && pnpm lint`. Expected: PASS, with `check:literals` at 0.
- [ ] **Step 5: Commit** as `feat(renderer): package scaffold and theme CSS compiler`.

---

### Task 3: Self-hosted fonts

**Files:**
- Create: `packages/renderer/src/theme/fonts.ts`, `test/fonts.test.ts`

**Interfaces:**
- Produces:
  - `fontSlug(name: string): string`: lowercase, whitespace → `-`.
  - `fontFaces(theme: ThemeSpec): { css: string; files: { from: string; to: string }[] }`.
    - `from` = `require.resolve("@fontsource/<slug>/files/<slug>-latin-<weight>-normal.woff2")`, via `createRequire(import.meta.url)`.
    - `to` = `fonts/<slug>-<weight>.woff2`, relative to `assets/`.
    - One `@font-face` per (font, weight), deduplicated, with `font-display: swap` and `src: url("fonts/<slug>-<weight>.woff2") format("woff2")`.

- [ ] **Step 1: Write the failing tests:**
  - `fontSlug("Source Serif 4") === "source-serif-4"`.
  - `every catalog font and weight resolves to an existing woff2`: loop over all type families and their 3 roles × weights, build a minimal ThemeSpec per family via `resolveTheme` with that type family, and `existsSync` every `from`.
  - `dedupes a font used twice`: a theme whose display and body are the same font and weight gives one file.
  - `css urls are relative`: no `url("/` or `url("file:`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** If a fontsource package names a weight file differently, fix the path pattern rather than skipping the font. The coverage test is the arbiter.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** as `feat(renderer): self-hosted woff2 font faces from @fontsource`.

---

### Task 4: Block renderers (pure)

**Files:**
- Create: `src/blocks/{escape,chart,image,code,render}.ts`, `test/blocks.test.ts`

**Interfaces:**
- Consumes: `Block` types from schemas.
- Produces:
  - `escapeHtml(s: string): string`, which escapes `& < > " '`.
  - `emphasize(text: string, targets: string[]): string`. It escapes the text, then wraps the **first case-insensitive literal** occurrence of each target in `<mark class="df-emph" data-emphasis>`. Targets are matched against the raw text. Ranges are computed first and overlapping or nested ranges are dropped (the earliest-starting wins), so the output never nests marks.
  - `chartSvg(block: Extract<Block,{type:"Chart"}>, opts: { title: string }): string`.
    - Returns an `<svg viewBox="0 0 960 540" role="img" aria-label="<title>">` with a `<title>`.
    - Series colours cycle `var(--df-primary)`, `var(--df-accent)`, `var(--df-text-muted)`.
    - `bar`: grouped rects, with the baseline at the zero line so negatives go below it.
    - `line`/`area`: one path per series.
    - `donut`: uses the first series only.
    - Labels escaped. The output never contains `NaN` or `Infinity`.
  - `placeholderImageSvg(block: Extract<Block,{type:"Image"}>): string`: a deterministic geometric SVG seeded by a hash of `prompt`, using only `var(--df-*)` colours, with `role="img"` and an escaped `aria-label` = alt.
  - `highlightCode(lang: string, code: string, highlightLines?: number[]): string`. It uses `hljs.highlight` and falls back to `plaintext` for unknown languages. Each line becomes `<span class="df-line" data-line="n">…</span>`, and highlighted lines also get `data-df-highlight`.
  - `type BlockContext = { emphasis: string[]; fragments: boolean; diagrams: Map<string, string> }`.
  - `diagramKey(source: string): string` (sha256 hex of the source, first 16 chars).
  - `renderBlock(block: Block, ctx: BlockContext): string`. Handles all 11 kinds. Every visible text node goes through `emphasize`. With `ctx.fragments`, Bullets `<li>` get `class="fragment"`. Diagram output:
    - if `ctx.diagrams.get(diagramKey(src))` exists: `<figure class="df-diagram">svg</figure>`
    - otherwise: `<figure class="df-diagram"><pre class="df-diagram-fallback">escaped source</pre></figure>`
- [ ] **Step 1: Write the failing tests:**
  - `emphasize`:
    - `escapes <b> in text`
    - `marks "C++" literally`
    - `skips a missing target`
    - `drops an overlapping target` (targets `["solar cell","cell"]` on `"solar cell"` gives exactly one `<mark`)
    - `is case-insensitive but preserves original case`
    - `matches targets containing HTML chars against raw text` (target `"<b>"` in text `"use <b> tags"` gives `<mark …>&lt;b&gt;</mark>`)
  - `chartSvg`:
    - `bar with 3 labels × 2 series has 6 rects in the plot group`
    - `negative values stay finite`
    - `all-zero donut has no NaN`
    - `escapes labels`
    - `has role img and title`
  - `placeholderImageSvg is deterministic and escapes alt`.
  - `highlightCode`:
    - `unknown lang does not throw`
    - `marks highlightLines [2]` (exactly one `data-df-highlight` on `data-line="2"`)
  - `renderBlock`:
    - `covers every block kind`: one fixture per kind, from the schemas test fixtures, each returns non-empty HTML.
    - `bullets get .fragment when ctx.fragments`.
    - `diagram without svg renders escaped fallback`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** as `feat(renderer): pure block renderers (text, chart, image, code, diagram slot)`.

---

### Task 5: Slide templates + deck HTML + fixture

**Files:**
- Create: `templates/*.hbs` (16, named by slide-type id), `src/html/templates.ts`, `src/html/deck.ts`, `fixtures/solar.deck.json`, `fixtures/solar.interaction.json`, `test/deck.test.ts`

**Interfaces:**
- Consumes: `renderBlock`, `emphasize`, `escapeHtml`, `diagramKey`, `resolveMotionPlan`, `Catalog`.
- Produces:
  - `type RenderInput = { deck: DeckSpec; theme: ThemeSpec; motion: MotionPlan; interaction: InteractionPlan; catalog: Catalog; templates: Map<string, HandlebarsTemplateDelegate>; diagrams: Map<string, string>; assets: { css: string[]; js: string[] } }`. `renderDeckHtml` stays pure (in `"."`); it receives the compiled templates rather than reading files.
  - `renderDeckHtml(input: RenderInput): { html: string; warnings: string[] }`.
  - `class RenderError extends Error`: thrown for a slide type with no template, or a motion entry missing for a slide id.
  - `loadTemplates(): Map<string, HandlebarsTemplateDelegate>` (exported from `"./node"`). It reads `templates/*.hbs` once, caches them, and uses a strict Handlebars `compile` (`{ strict: true }`). The key is the file basename, which is the slide-type id.
- **Template context:** `{ slide, title, subtitle, deckTitle, regions: Record<regionName, string>, index, total }`.
  - `deck.ts` fills `regions` with pre-rendered, already-escaped HTML. Body blocks go to `body`.
  - Compare blocks go to `left`/`right`.
  - The title slide uses `deckTitle`/`deck.subtitle`.
  - Stat/chart footers carry the stat labels or chart unit.
  - Templates insert regions with `{{{regions.x}}}` and nothing else unescaped.
- **Markup contract:**
  ```
  <div class="reveal" data-df-texture="<theme.texture>" data-df-image="<theme.imageTreatment>" data-df-mode="<theme.mode>" data-motion-timing='<json>' data-motion-reduced="<motion.reducedMotion>">
    <div class="slides">
      <section id="<slide.id>" data-slide-type="<type>" data-motion-transition data-motion-enter data-motion-emphasis data-motion-exit data-motion-easing>
        … [data-region="<name>"] … [data-motion-el] on each animatable child …
        <aside class="notes">escaped notes</aside>
      </section>
  ```
  - Every catalog region of the slide type appears as `[data-region="<name>"]`.
  - The document `<head>` links `assets.css` in order, and `<body>` ends with classic `<script src>` for `assets.js`.
- **Interaction:**
  - `df-fragment` with `props.mode === "one-by-one"` sets `ctx.fragments` for that slide.
  - `df-notes` is always satisfied by `<aside class="notes">`.
  - Any other component adds the warning `slide <id>: <componentId> is not supported by this renderer yet; rendered statically`.
- **Fixture `solar.deck.json`:** "How solar cells work".
  - 15 slides, one per catalog slide type in catalog order, **excluding `quiz`**, with ids `s01`…`s15`.
  - Valid Mermaid in the diagram slide. A code slide with `highlightLines`.
  - A bullet containing a 60-character unbroken token (Review Focus 4).
  - `emphasisTargets` on the stat and quote slides.
  - Every slide has 60–120 words of notes.
- **Fixture `solar.interaction.json`:** linear mode, with `df-fragment` (`one-by-one`) on the bullets slide.

- [ ] **Step 1: Write the failing tests** (`deck.test.ts`). Use `resolveTheme` (minimal defaults, calm), `resolveMotionPlan`, and an empty diagrams map:
  - `has a template for every catalog slide type`.
  - `every template renders every catalog region`: render a minimal slide of each type and check that `[data-region="<r>"]` exists for each region. Parse with `new JSDOM(html)`; add `jsdom` as a devDependency.
  - `fixture renders 15 sections in order with ids s01..s15`.
  - `every section has a non-empty aside.notes`.
  - `section data-motion-* attributes equal the MotionPlan entry`.
  - `one-by-one df-fragment marks every bullet li as .fragment`.
  - `unsupported component adds a warning and still renders`: `df-chart` on the chart slide.
  - `escapes hostile text in every region and in notes`: title `</section><script>alert(1)</script>`, a bullet `{{x}}`, notes `<img src=x onerror=alert(1)>`. The output has no `<script>alert`, no raw `<img src=x`, and the literal `{{x}}` text.
  - `diagram without svg renders escaped fallback` (deck level).
  - `throws RenderError for a slide type with no template`.
  - `no absolute or remote URLs`: `html` matches none of `/(src|href)="\//`, `/https?:/`, `/file:/`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** the templates, `templates.ts`, `deck.ts` and the fixtures. Layout uses Tailwind utilities that reference `--df-*` (Task 8 defines the `@theme` mapping in `deck.css`). Add `overflow-wrap:anywhere` on text regions.
- [ ] **Step 4: Run.** Expected: PASS, with `pnpm lint` (`check:literals`) at 0.
- [ ] **Step 5: Commit** as `feat(renderer): handlebars slide templates, deck HTML assembler, solar fixture`.

---

### Task 6: Build-time diagrams (Mermaid → SVG)

**Files:**
- Create: `src/diagrams.ts`, `test/diagrams.test.ts`

**Interfaces:**
- Produces: `renderDiagrams(sources: string[], theme: ThemeSpec): Promise<{ svgs: Map<string, string>; warnings: string[] }>` (exported from `"./node"`).
  - Keys come from `diagramKey`.
  - It launches Chromium once via `playwright` and injects `mermaid/dist/mermaid.min.js` with `page.addScriptTag({ path })`.
  - `mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "base", themeVariables })`. The theme variables map `primaryColor`/`primaryTextColor`/`lineColor`/`background`/`fontFamily` from `theme.roles`/`theme.type`.
  - Each source renders with the deterministic id `d-<key>`.
  - A failure adds the warning `diagram <key>: <first line of mermaid error>` and leaves that key absent.
  - With an empty `sources` array, it returns immediately without launching a browser.
- [ ] **Step 0: Install the browser.** Run `pnpm --filter @deckforge/renderer exec playwright install chromium`.
- [ ] **Step 1: Write the failing tests:**
  - `renders a valid flowchart to svg`: `graph TD; A-->B` gives a map with 1 entry starting with `<svg`.
  - `invalid mermaid yields a warning, not a throw`: `graph TD; A-->` gives 0 svgs and 1 warning.
  - `svg contains no script`.
  - `empty input launches nothing`: resolves in < 50 ms.
  - `same source twice gives one key`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** as `feat(renderer): build-time mermaid diagrams via headless chromium`.

---

### Task 7: Runtime: motion engine

**Files:**
- Create: `src/runtime/{motion,presets,engine,main}.ts`, `test/motion.test.ts`

**Interfaces:**
- Produces (pure, `motion.ts`):
  - `type ReducedFlags = { same: boolean; fadeOnly: boolean; parallax: boolean; three: boolean; flicker: boolean; glowStatic: boolean; decorationsStatic: boolean }`.
  - `parseReducedMotion(s: string): ReducedFlags`. It splits on `;`, trims, and recognises `same`, `fadeOnly`, `parallax off`, `three off`, `no flicker`, `glow static` and `decorations static`. It throws on an unknown token.
  - `type SlideMotion = { transition: string; enter: string; emphasis: string; exit: string; easing: string }`.
  - `resolveSlideMotion(m: SlideMotion, reduced: ReducedFlags | null): SlideMotion`.
    - `null` (no reduced-motion preference) returns the input unchanged.
    - `fadeOnly` sets enter/exit to `fade`, emphasis to `none`, and transition to `fade` when it isn't `none`/`cut`.
    - `same` returns the input unchanged.
  - `parseCountUp(text: string): { prefix: string; value: number; decimals: number; suffix: string; grouping: boolean } | null`.
- Produces (`presets.ts`, imports gsap and SplitText):
  - `ENTER_PRESETS`, `EMPHASIS_PRESETS` and `EXIT_PRESETS`: `Record<string, (els: Element[], o: { duration: number; stagger: number; ease: string }) => gsap.core.Timeline>`.
  - `TRANSITIONS: Record<string, "none"|"fade"|"slide"|"convex"|"concave"|"zoom">`. Reveal-native names map to themselves, `cut` → `none`, and `wipe` → `none` (the engine adds a GSAP `clipPath` wipe on the incoming slide).
- Produces (`engine.ts`): `initMotion(reveal: RevealApi): void`. Here `RevealApi` is a minimal local interface: `on(event: "ready"|"slidechanged", cb: (e: { currentSlide: HTMLElement; previousSlide?: HTMLElement }) => void): void; getCurrentSlide(): HTMLElement`. Reveal 5 ships no TypeScript types, so the engine shouldn't depend on any.
  - On `ready` and `slidechanged`, it runs the exit preset on the previous slide's `[data-motion-el]` (duration 0.3), then the enter preset on the current slide's elements, then the emphasis preset on `[data-emphasis]`.
  - Timing comes from `data-motion-timing`.
  - Reduced flags come from `data-motion-reduced`, applied only when `matchMedia("(prefers-reduced-motion: reduce)")` matches.
  - `?df-motion=off` sets every element to its final state and sets `document.documentElement.dataset.dfMotion = "off"`.
  - It sets `document.documentElement.dataset.dfMotionIdle = "true"` whenever no timeline is active.
- Produces (`main.ts`): `Reveal.initialize({ hash: true, width: 1920, height: 1080, margin: 0, controls: true, progress: true, slideNumber: "c/t", plugins: [RevealNotes] })`, then `initMotion`.
  - It applies `TRANSITIONS[section.dataset.motionTransition]` to each section's `data-transition` before initialising.
- [ ] **Step 1: Write the failing tests** (`motion.test.ts`, vitest, node):
  - `every catalog reducedMotion string parses`.
  - `parseReducedMotion throws on "sparkles"`.
  - `fadeOnly maps glitchIn/countUp/glitchOut to fade/none/fade`.
  - `null leaves motion unchanged`.
  - `parseCountUp`: `"42%"` gives `{prefix:"", value:42, decimals:0, suffix:"%"}`. `"$3.5B"` gives `{prefix:"$", value:3.5, decimals:1, suffix:"B"}`. `"1,200+"` gives `value:1200, grouping:true`. `"N/A"` gives `null`.
  - `presets cover the vocabulary`: `Object.keys(ENTER_PRESETS)` ⊇ `vocabulary.enter`, and the same for emphasis, exit and `TRANSITIONS` ⊇ `vocabulary.transition`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Each preset is a small `gsap.timeline()` from-state, e.g. fadeUp = `from(els, {opacity:0, y:24, …})`.
  - `splitWords`/`splitChars` use `SplitText`.
  - `typewriter` reveals characters with `steps`.
  - `countUp` tweens a proxy number and writes the formatted text using `parseCountUp`.
  - `glow`/`glitch*` respect `flicker`/`glowStatic` through options passed from the engine.
- [ ] **Step 4: Run.** Expected: PASS. Browser behaviour is verified in Task 9.
- [ ] **Step 5: Commit** as `feat(renderer): GSAP motion engine driven by data-motion attributes`.

---

### Task 8: `build()` (Tailwind CSS, runtime bundle, assets, manifest)

**Files:**
- Create: `src/styles/deck.css`, `src/css.ts`, `src/bundle.ts`, `src/build.ts`, `test/build.test.ts`
- Modify: `src/node.ts`

**Interfaces:**
- Produces (`"./node"`):
  - `compileDeckCss(): Promise<string>`.
    - It runs the Tailwind CLI (`tailwindcss -i src/styles/deck.css --minify`) via `child_process.execFile` with the package's local binary.
    - `deck.css` contains `@import "tailwindcss" source(none); @source "../../templates";`, an `@theme` block mapping `--color-df-*: var(--df-*)` and fonts, the base slide layout using `--df-pad`/`--df-gap`, the title transform and tracking, and imports of `textures.css`, `images.css` and `reveal.js/dist/reveal.css`.
    - The result is cached at `.cache/deck-<sha256(templates + styles + tailwind version)>.css`. The function returns the CSS text.
  - `bundleRuntime(): Promise<string>`: esbuild `bundle: true, format: "iife", minify: true, target: "es2020"` from `src/runtime/main.ts`, cached in `.cache/runtime-<hash>.js`.
  - `type BuildInput = { jobId: string; deck: DeckSpec; theme: ThemeSpec; motion: MotionPlan; interaction: InteractionPlan; catalog: Catalog; outDir: string }`.
  - `build(input: BuildInput): Promise<RenderManifest>`:
    1. Validate all four specs with their Zod schemas.
    2. Run `renderDiagrams` on every Diagram source.
    3. Write the assets:
       - `assets/deck.css`
       - `assets/theme.css` = `fontFaces(theme).css` + `compileThemeCss(theme)`
       - `assets/deck.js`
       - `assets/fonts/*`
       - `index.html` from `renderDeckHtml` with `assets: { css: ["assets/deck.css","assets/theme.css"], js: ["assets/deck.js"] }`
       `build` uses `loadTemplates()` for the `templates` input.
  4. Return the manifest:
       - `entry: "index.html"`
       - `slideIds`
       - `assets` with byte sizes, relative to `outDir`
       - `totalBytes`
       - `threeJs: theme.threeJs`
       - `warnings` = diagram warnings + HTML warnings + (`theme.threeJs` ? `"threeJs requested but not supported by this renderer yet"` : nothing)
- [ ] **Step 1: Write the failing tests** (`build.test.ts`, building the fixture with minimal + calm into `os.tmpdir()`):
  - `writes index.html and every asset listed in the manifest`.
  - `manifest parses as RenderManifest and totalBytes equals the sum of asset bytes`.
  - `stays under 2.5 MB`: `totalBytes <= 2_621_440`.
  - `index.html has no absolute or remote URLs and no type="module"`.
  - `deck.css contains a utility used by a template`: pick one class actually used in `templates/title.hbs`.
  - `is deterministic`: two builds give byte-identical `index.html`.
  - `css cache file exists after first compile`.
  - `threeJs theme adds a warning`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm --filter @deckforge/renderer test && pnpm lint && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** as `feat(renderer): build() writes a self-contained deck with manifest`.

---

### Task 9: Browser e2e + visual snapshots (3 families × Calm)

**Files:**
- Create: `packages/renderer/playwright.config.ts`, `test/e2e/global-setup.ts`, `test/e2e/deck.spec.ts`, `test/e2e/__screenshots__/…` (committed baselines)
- Modify: `turbo.json` (add `"test:e2e": { "cache": false }`), root `package.json` (`"test:e2e": "turbo run test:e2e"`)

**Interfaces:**
- `global-setup.ts` builds the fixture three times into `test-results/decks/<family> déck/`. The space and accent are deliberate (Review Focus 3). It uses `resolveTheme` with each family's defaults and `motionTemplateId: "calm"`, plus `resolveMotionPlan(c, "calm", slides)`. The families are `minimal`, `retro` and `atmospheric`: Calm is allowed for all three, and they cover light, textured and dark styles.
- Config: Chromium only, viewport 1280×720, `toHaveScreenshot` with `maxDiffPixelRatio: 0.01`, snapshot path `test/e2e/__screenshots__/{arg}{ext}`.
- [ ] **Step 1: Write the specs** (`deck.spec.ts`, parameterised over the 3 families):
  - `opens from file:// with zero console errors and zero failed requests`: collect `console` type `error`, `pageerror` and `requestfailed`, then expect all three lists to be empty.
  - `has 15 slides`: `Reveal.getTotalSlides() === 15`.
  - `no region overflows horizontally`: on every slide with `?df-motion=off`, every `[data-region]` has `scrollWidth <= clientWidth + 1`.
  - `motion runs`: go to `#/1` (motion on). The first `[data-motion-el]` has opacity < 1 within 100 ms, and opacity `"1"` once `dfMotionIdle === "true"`.
  - `reduced motion uses fades only`: with `emulateMedia({ reducedMotion: "reduce" })` on `#/1`, every `[data-motion-el]` computed `transform` is `none` or the identity matrix while the timeline is active.
  - `speaker notes are wired`: `Reveal.getSlideNotes()` on `#/1` is non-empty.
  - `visual`: with `?df-motion=off`, take `toHaveScreenshot("<family>-<type>.png")` for slide types `title, bullets, stat, chart, diagram, code, compare, summary` (24 baselines).
- [ ] **Step 2: Run** `pnpm --filter @deckforge/renderer test:e2e`. Expected: FAIL. Every non-visual test should fail for a real reason (e.g. a console error from missing CSS, an overflowing region). Fix the cause in the renderer, not in the test.
- [ ] **Step 3: Fix renderer issues** until the non-visual specs pass. Then run `pnpm --filter @deckforge/renderer test:e2e --update-snapshots` once, **open and look at all 24 PNGs**, and record in the ledger any slide that looks wrong. Fix it before accepting the baselines.
- [ ] **Step 4: Run** `pnpm --filter @deckforge/renderer test:e2e`. Expected: all PASS against the committed baselines.
- [ ] **Step 5: Commit** as `test(renderer): file:// e2e and visual snapshots for minimal, retro, atmospheric × calm`. Include the baselines.

---

## Roadmap after this plan

| Plan | Notes carried forward |
|---|---|
| 2b. Renderer interactions + depth | The `<df-*>` web components (≤5 KB each, no framework), Chart.js for `df-chart` (catalog cost note: ~60 KB), Three.js `depth.ts`. **Spec §6 says "lazy ESM import", but `file://` blocks module scripts, so load Three.js with a dynamically injected classic `<script>`.** The output with Three.js must be ≤ 4 MB. Remove the "not supported yet" warnings. |
| 3. Harness | Calls `build()` from `@deckforge/renderer/node`. `resolveTheme`/`resolveMotionPlan` give the Design Agent its baseline. Render stage timeout 30 s. The first build launches Chromium for diagrams, so measure it. |
| 4. QA | Reuses Task 9's file:// harness and console capture. Overflow detection can follow Task 9's `data-region` check. |
| 5. Wizard | Live sample slide: browser-safe `"."` exports plus precompiled Handlebars templates (Task 5 reads `.hbs` from disk, so the wizard needs a precompile step). |
