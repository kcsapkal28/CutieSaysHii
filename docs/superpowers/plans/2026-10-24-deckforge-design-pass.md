# DeckForge Design Pass (Plan 2c) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every implementer and reviewer subagent runs on **Opus at high effort**.

**Goal:** Make every DeckForge deck look designed: each of the 8 style families gets a recognisable identity, every slide type has an intentional composition on a grid with a real modular type scale, and a rubric-scored visual gate covers all 8 families before baselines are accepted.

**Architecture:**
- The prose `layoutHints` in `catalog/design-styles.json` become a structured, schema-checked `layout` object per family. `resolveTheme` copies it into `ThemeSpec.layout`.
- The renderer turns layout tokens into two things:
  - **CSS custom properties** in `theme.css`: the type steps, grid spans and computed AA-safe colours;
  - **`data-df-*` attributes** on the deck root, each selecting one rule set in static stylesheets.
- No stylesheet ever names a family. A family is only the sum of its tokens, which also keeps `check:literals` at zero.
- Templates move from 300-character utility strings to Handlebars partials and semantic `df-*` classes. Tailwind stays the compiler, for preflight, `@theme` and the remaining utilities.

**Tech Stack:** unchanged from the renderer plan: reveal.js 5.2.1, gsap 3.15, handlebars 4.7, tailwindcss 4.3, mermaid 12 (build time only), playwright 1.64, vitest, zod 3. CSS features used: grid with `subgrid`, container query units (`cqi`), `text-wrap: balance | pretty`, `color-mix()`, `mask-image`. All are supported by the Chromium that Playwright ships.

**Spec:** `docs/BUILD_PROMPT.md` §5 (accessibility, AA), §6 (renderer), §8 (acceptance). The conventions come from `docs/superpowers/plans/2026-10-23-deckforge-renderer.md`. Deferred inputs were read from the renderer review log; each one is folded into a task or rejected under **Deferred items** below.

**Branch:** `feat/design-pass` from `main`. It runs in parallel with the harness plan on `feat/harness`; see **Harness overlap**.

---

## Design critique: why the current decks look plain

I reviewed 18 of the 24 baselines: all 8 slide types for minimal, title/stat/compare/diagram/chart for retro, and title/stat/diagram/chart/code/compare for atmospheric. I also read the templates, stylesheets, theme compiler and catalog.

**Verdict.** The decks are tidy, legible and AA-compliant. They are also one layout in three colourways. Swap the fonts and palette and minimal, retro and atmospheric are the same deck, and nothing in them is wrong enough to remember. They read as "a renderer's defaults", not as designed.

**What works (keep it):**
- Text contrast is enforced at compile time.
- Fonts are self-hosted.
- Textures are restrained, at ≤ 0.12 opacity.
- Code syntax colours map onto the palette roles.
- Long tokens wrap.
- The `--df-*` token pipeline is the right foundation. This plan adds to it rather than replacing it.

**Priority issues**

1. **[P0] No grid, no composition. Every slide is "title top-left, content stacked under it, then nothing".**
   - Bullets and summary use the top 45% of the frame and leave the rest empty.
   - Code fills the top third.
   - The diagram floats mid-frame with dead bands above and below.
   - The title slide is a centred-left text block with 60% unused canvas and no anchoring device.
   - The family `layoutHints` are never consulted: "bento grid for stat slides", "centred compositions", "ornamental frames", "text in one corner", "HUD corner brackets" and "oversized numerals" exist only as prose.
2. **[P0] Families have no identity beyond font and palette.**
   - Retro is "minimal on yellow paper".
   - Atmospheric is "minimal on navy".
   - No family has a signature device: no decoration, no panel language, no divider style, no emphasis style.
3. **[P1] The type scale is not modular and hierarchy is flat.**
   - Sizes are hand-picked rems multiplied by the ratio (`calc(2.5rem*var(--df-scale))`), so the ratio is a zoom factor, not a scale.
   - Title against body is about 1.4–1.6×.
   - There is no third level: no kicker, no section context and no rule.
   - The slide number is Reveal's default grey badge.
4. **[P1] The data slides are broken in detail.**
   - **Stat slides:**
     - `flex-wrap` orphans the third stat (2+1).
     - The emphasis mark renders as a heavy grey block behind "22%" (accent at 28% on minimal's near-black accent).
     - The "flat" trend glyph ▶ reads as a play button.
     - Retro's three values almost touch.
   - **Compare:** two identical panels stretched to full height with empty bottom halves, no contrast between the sides, and rows not aligned across columns.
   - **Charts:**
     - Ticks are non-round (355/710/1065/1420).
     - Units have no space ("1420GW") and are repeated as a stray "GW" footer.
     - The chart is letterboxed at 960×540 with empty side bands.
     - On atmospheric the bars are #004B49 on #1F2833, about **1.5:1**. That fails WCAG 1.4.11, and retro's bars are about 1.8:1.
   - **Diagrams:** labels are about 16 px in a drawing scaled to region width. Dark themes only set `primary*`, so clusters, notes, edge labels and pie use Mermaid defaults.
5. **[P2] AI-default tells.**
   - The cover meta is a tracked uppercase eyebrow.
   - Section and quote slides use a thick coloured **side-stripe border** (`border-l-4 border-df-accent`).
   - Bullets are default discs.
   - Retro's `titleCase: "title"` is CSS `capitalize`, which gives "Path Of A Photon" today and would turn "iPhone" into "IPhone" and "mRNA" into "MRNA".

**Not addressed here, flagged as a follow-up.** Several catalog typefaces are reflex picks: Inter, IBM Plex, Space Grotesk, Space Mono, Playfair Display and Fraunces. Changing type families is a catalog and product decision with wizard and font-dependency fallout. This pass carries identity through composition, decoration and colour instead, and the scorecard records whether type still drags a family down.

---

## Global Constraints

- **Works from `file://`:**
  - every `src`/`href` is relative;
  - no network requests;
  - classic `<script src>` only.
  Decoration art is CSS gradients or `data:` SVG used as `mask-image`. No external files.
- **Size:** `totalBytes ≤ 2_621_440` without Three.js. The existing `build.test.ts` assertion stays.
- **No catalog literals:** no family, palette or type-family id, font name or palette hex in source, CSS or templates. `pnpm check:literals` stays at 0.
  - Stylesheets select on **layout token values** (`[data-df-panel="offset"]`), never on family ids.
  - Token values must not equal any family, palette or type-family id.
- **Deterministic output:** identical inputs produce a byte-identical `index.html` and `theme.css`.
  - No `Math.random`.
  - Per-slide variation comes from `slideIndex % 3`.
  - Computed numbers are rounded: 4 decimals for rem, uppercase `#RRGGBB` for colours.
- **Contrast:**
  - text ≥ 4.5:1 against its actual background;
  - chart marks, timeline nodes, the progress bar, trend icons, diagram lines and borders ≥ 3:1 against the slide background (WCAG 1.4.11).
  - Text sits only on `bg`, `surface`, `--df-fill-1/2` (AA-safe by construction) or the inverse pair (bg-coloured text on a text-coloured fill).
- **Reduced motion is honoured**, and nothing flashes more than 3 times in any 1 s window (WCAG 2.3.1).
- **Motion-agnostic templates:** templates emit only `data-motion-*`, `data-region`, `data-emphasis` and `data-df-*` attributes.
- **Theme values are untrusted strings** at the CSS boundary (`assertSafe`). That still holds although `ThemeSpec` is now resolved from the catalog.
- **Canvas** is 1920×1080 (Reveal `width`/`height`), and 1 rem = 16 px inside the slide. The modular scale base is **2 rem**, which is 32 px body text at 1080p.
- **Minimum rendered text size** at 1080p (computed CSS px inside the slide):
  - **22 px** for captions, chart ticks and diagram labels;
  - **24 px** for everything else.
- **Every new or changed source file stays under 300 lines.** Split by responsibility if it would not.

## Review Focus

1. **Long titles in wide, large-ratio type families.**
   - Example: an 8-word title in poster-grotesk (ratio 1.414) or Orbitron (tracking 0.06em, upper case).
   - Expected: it steps down a size and wraps, and never clips or overflows vertically.
   - Pinned by Task 5 `lengthClass` and Task 7 `no region overflows vertically` on `stress.deck.json`.
2. **Long or mixed stat values in narrow bento cells**: "1,000,000 W/m²", "$1.2 trillion", "−3.5 °C". Expected: one line, never wrapped or clipped. Pinned by Task 7 `stat values stay on one line` on the stress deck (owner Task 6a).
3. **A non-default palette inside a family**: neon + synthwave-sunset, minimal + technical-slate (dark), glass-soft + midnight-gala.
   - Expected: computed fills, graphics and decorations stay AA / 3:1. Nothing assumes the default palette's mode.
   - Pinned by:
     - Task 2's every family × allowed-palette loop;
     - Task 8's loop;
     - Task 7's `alt` decks, which carry every contrast and overflow check.
4. **A compare whose sides differ in length**: one cell wraps to three lines, the other is one word; five rows. Expected: rows stay aligned across sides and nothing overflows. Pinned by Task 7 `compare rows align across sides` (owner Task 6a).
5. **Diagram kinds beyond a flowchart on dark themes**: subgraph clusters, edge labels, sequence notes, pie. Expected: every label is readable and every line visible. Pinned by Task 8 `every mermaid text pair passes AA and every line 3:1 for every family × allowed palette`, plus stress-diagram baselines for 3 families (Task 11).

---

## The design system (what the tasks build)

### Layout tokens: per-family values

Every family's `layout` object (schema in Task 1):

| family | grid title / body / wide / aside | align | coverAnchor | steps title / display / stat | kicker | stat | panel | divider | decoration | decorationOn | imageLayout | emphasis | tracking |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| minimal | [1,10] / [1,9] / [1,13] / [10,13] | start | bottom | 3 / 5 / 6 | section | bento | flat | hairline | none | [] | inset | underline | normal |
| swiss | [3,13] / [3,10] / [3,13] / [10,13] | start | bottom | 3 / 5 / 6 | index | oversized | none | bar | blocks | [title, section, qa] | split | ink | normal |
| brutalist | [1,11] / [1,10] / [1,13] / [10,13] | start | center | 3 / 5 / 5 | index | bento | offset | bar | gridlines | "all" | inset | highlight | normal |
| glass-soft | [1,10] / [1,10] / [1,13] / [10,13] | start | center | 3 / 5 / 5 | none | bento | glass | hairline | blobs | "all" | inset | underline | normal |
| retro | [2,12] / [3,11] / [2,12] / [9,12] | center | center | 3 / 5 / 5 | none | row | inset | ornament | frame | [title, section, summary, qa] | inset | ink | normal |
| neon | [1,10] / [1,9] / [1,13] / [10,13] | start | center | 2 / 4 / 5 | index | oversized | outline | glow | brackets | "all" | bleed | glow | normal |
| maximal-pop | [1,10] / [1,10] / [1,13] / [10,13] | start | center | 3 / 5 / 5 | none | bento | offset | squiggle | shapes | "all" | split | highlight | normal |
| atmospheric | [1,8] / [1,7] / [1,11] / [8,11] | start | bottom | 2 / 4 / 5 | section | row | none | hairline | vignette | "all" | bleed | ink | wide |

**How to read the table:**
- **Grid spans** are CSS grid lines on a 12-column grid inside the padded frame. The gutter is `--df-gap`.
- **Main column:** a code or diagram slide's main area is `wide.start / aside.start` when it has aside content, else `wide`.
- **Rail:** columns left of `title.start` form a rail, which holds the index kicker.
- **`tracking: wide`** adds 0.12em letter-spacing to the kicker, meta, subtitle and captions. It never applies to titles or body text. It structures atmospheric's "wide letter-spacing" hint.

### Family identity: design intent for Tasks 6a, 6b, 6c, 9 and the rubric

Each family gets one memorable thing. Everything else stays disciplined.

- **minimal: "a well-set page"**
  - Content is left-aligned on a visible-by-alignment grid with generous air.
  - The cover title anchors to the lower third, with the meta line at top-left. Nothing else on the cover.
  - The kicker is the current section, in sentence case.
  - Stats are a bento of flat white cells; the hero cell is filled with `--df-fill-1`.
  - Emphasis is a thin underline.
  - Signature: the asymmetric bento and the empty right four columns on text slides.
- **swiss: "the poster grid"**
  - Upper-case, flush-left, hung from a 2-column rail that holds a huge slide index.
  - Bauhaus `blocks` on title, section and qa: a primary-filled circle segment bleeding off the top-right, plus an accent bar.
  - Stats are oversized numerals, each under a thick bar rule.
  - Images split the frame: the image bleeds off the left edge across 7 columns; the caption is set large on the right.
  - No panels at all; separation is by rules and space.
- **brutalist: "the zine"**
  - Every block is a 3 px text-coloured outline with a 6 px hard offset shadow (the `--df-shadow` token).
  - Faint visible grid lines sit behind every slide.
  - The index kicker sits in an inverse box (bg-coloured text on a text-coloured fill).
  - Emphasis is a highlight block in `--df-fill-2`.
  - Bento cells are outlined and offset.
  - Signature: the offset shadow on everything boxy.
- **glass-soft: "floating layers"**
  - Two or three large blurred colour blobs (primary, accent) drift behind content. Their positions vary by `data-df-variant`.
  - Panels are translucent: surface at `surfaceAlpha`, `backdrop-filter` blur, a 1 px white-alpha border and a soft shadow, at radius 1.25 rem.
  - The bento sits on glass.
  - Signature: depth through blur.
- **retro: "the printed programme"**
  - Centred compositions. Title Case done properly (Task 3).
  - A double-rule inset `frame` with corner ornaments on title, section, summary and qa.
  - The divider is an ornament: rule, diamond, rule.
  - Stats sit in a centred `row` separated by ornaments.
  - Panels are `inset`: surface fill with an inner hairline.
  - Signature: the frame and the ornamented dividers.
- **neon: "the HUD"**
  - HUD corner `brackets` frame the slide and every panel.
  - The index kicker is set in mono, as `// 04`, with glow.
  - Panels are outlined with a 1 px `--df-graphic-1` border and an inner glow.
  - The divider is a glowing 1 px line.
  - Stats are oversized numerals with glow. Glow sits on accent-coloured text only, never on body text.
  - Images bleed full-frame behind a bg-filled caption plate.
  - Signature: the brackets plus the glow on numerals only.
- **maximal-pop: "the sticker sheet"**
  - Up to 3 `shapes` per slide (squiggle, dot cluster, triangle or ring), placed in the margins by variant. On the cover and section slides, one large shape sits behind the title.
  - Radius 2 rem; offset shadows in accent.
  - The bento uses distinct fills per cell (`fill-1`, `fill-2`, `surface`).
  - The divider is a squiggle.
  - Emphasis is a highlight.
  - Images split the frame.
  - Signature: the shapes and the colour-blocked bento.
- **atmospheric: "the film still"**
  - Content anchors to the bottom-left corner, in at most 7 columns.
  - The right third stays empty on purpose.
  - Edge `vignette` plus the existing fog texture.
  - The kicker is the section name with wide tracking (0.12em), in sentence case.
  - Stats are a quiet `row` with hairline separators.
  - No panels.
  - Images bleed full-frame.
  - Signature: negative space and the corner anchor.

### Slide-type compositions: design intent for Task 6a

Common skeleton:
- `.df-slide` is a 12-column grid with rows `auto auto 1fr auto` (kicker, title, body, footer).
- `title` sits on `--df-col-title` and `body` on `--df-col-body`. Data slides use `--df-col-wide`.
- Titles use `text-wrap: balance`; paragraphs use `text-wrap: pretty`.
- Numerals use `font-variant-numeric: tabular-nums lining-nums`.

Per slide type:
- **title (cover):**
  - `coverAnchor: bottom`: the meta line sits at top-left of the frame and the title and subtitle are anchored to the frame's bottom edge.
  - `coverAnchor: center`: everything is a vertically centred stack.
  - Title uses `--df-size-display`; the subtitle uses `--df-size-lead`.
  - The meta line is `--df-size-small` in `--df-accent-text`, sentence case, untracked, preceded by a `df-rule`.
- **section:**
  - The ordinal (`01`) is set large in `--df-graphic-1` and is aria-hidden.
  - Then a `df-rule`, the title at `--df-size-display`, and the subtitle.
  - Placement follows `coverAnchor` and `align`.
  - No side-stripe border.
- **agenda:**
  - The items are a real sequence, so each row is: a display-font ordinal in `--df-accent-text`, then the item at `--df-size-lead`, then a divider between rows.
  - Rows fill the body height, each capped at 9 rem.
- **bullets:**
  - The list is centred in the space below the title.
  - Items use `--df-size-lead` when `data-df-count ≤ 3`, else `--df-size-body`.
  - Markers are 0.35em shapes in `--df-graphic-2`: square when `--df-node-radius` is 0, round otherwise.
  - The list stays within `--df-col-body`, which keeps the measure at 60ch or less.
- **text (statement):** the paragraph is at `--df-size-title` in the body span, vertically centred. The title becomes a small lead-in in `--df-primary-text`.
- **stat:** see the stat layouts below.
- **quote:**
  - Quote text in display face at `--df-size-title`, measure ≤ 24ch.
  - A hanging opening quotation mark at `--df-size-stat` in `--df-graphic-2`.
  - The attribution follows a short `df-rule`.
  - No side stripe.
  - Retro centres it; atmospheric anchors it bottom-left.
- **chart:** the SVG fills `--df-col-wide` and the full body height. The footer is a caption line.
- **diagram:** the SVG fills its main column (Task 8). The aside is a caption column at `--df-size-small` with a top rule.
- **compare:**
  - One grid spanning `--df-col-wide`: two sides × (header + N rows) via `subgrid`, so rows align across sides.
  - Side A uses the panel style on `surface`; side B uses the panel style on `--df-fill-1`. The two sides differ in hue, and both are AA-safe.
  - Side titles are display face at `--df-size-lead`.
  - Rows are separated by dividers, each row `minmax(auto, 9rem)`, and the block is vertically centred. No stretched empty panels.
- **timeline:**
  - A horizontal track (2 px, `--df-graphic-3`) runs through nodes. Node size is 0.6 rem, shape `--df-node-radius`, fill `--df-graphic-1`.
  - Dates sit above at `--df-size-small` in `--df-accent-text`; labels sit below at `--df-size-lead` in display face; details at `--df-size-small` in muted colour.
  - Steps are equal columns across `--df-col-wide`, and the track is vertically centred.
- **code:** the panel is centred vertically in the main column with natural height. The aside is a caption with a top rule.
- **image:** see `imageLayout` (Task 9).
- **summary:**
  - A split composition: the title takes the first ⅓ of `--df-col-wide` at `--df-size-display`, and the items fill the remaining ⅔, each with a top divider instead of a bullet.
  - When `align: center`, it stacks centred instead.
- **qa:** the cover composition with the title at `--df-size-display`.
- **quiz:** keeps today's structure on the new skeleton. Options use `--df-size-lead`.

**Stat layouts (`data-df-stat`):**
- **bento:**
  - 1 stat: one cell spanning 8 columns.
  - 2 stats: cells of 7 and 5 columns.
  - 3 stats: a hero cell (7 columns, 2 rows) on the left and 2 stacked cells (5 columns) on the right.
  - The value sits at the bottom-left of each cell with the label above it; the trend icon is top-right.
  - The hero value uses `--df-size-stat` and the others use `--df-size-display`.
- **oversized:** `repeat(n, 1fr)` columns across `--df-col-wide`. Each column is a divider rule, then the numeral flush-left at `--df-size-stat`, then the label.
- **row:** equal columns across the body span. Dividers sit *between* the columns, not on their outer edges. The value is at `--df-size-display` above the label, aligned per `align`.

**No stat value ever wraps.** All stat layouts share these rules:
- `white-space: nowrap`;
- `.df-stat` is `container-type: inline-size`;
- the value size is `min(<layout size>, calc(100cqi / (var(--df-chars) * 0.7)))`.

---

## Harness overlap (files shared with `feat/harness`)

| File | Harness | This plan | Mitigation |
|---|---|---|---|
| `packages/schemas/src/catalog-files.ts` | Task 8: `CompatMatrixFileSchema`, `InteractionComponentSchema` | Task 1: replace `layoutHints` with `layout` in `StyleFamilySchema` | Our hunk is 2 lines: an import and one field. Merge whichever lands second by hand. |
| `packages/catalog/src/integrity.ts` | Task 8: designRules / `disallowedSlideTypes` rules | Task 1: one call to `checkLayout(c)` | All logic lives in the new `layout.ts`. The edit to `integrity.ts` is one line at the end of `checkIntegrity`. |
| `packages/renderer/src/diagrams.ts` | Task 4: AbortSignal in `renderDiagrams` | Task 8: `REVEAL_CLASSES`, `selectorClassNames`, the import of the theme variables | Mermaid theming moves to the new `diagram-theme.ts`. Our hunks avoid `renderDiagrams`. |
| `packages/schemas/src/design.ts` (`ThemeSpec`) | not edited. Harness rule: "ThemeSpec is only ever `resolveTheme(choices)`" | Task 1: required `layout` | Any hand-built ThemeSpec in harness tests must come from `resolveTheme`. Flag this to the harness controller when Task 1 merges. |
| `eslint.config.js` (root) | not listed | Task 10: one missing space | Trivial. |

**Untouched by this plan:**
- `catalog/compat-matrix.json` and `catalog/interactions.json`;
- `packages/renderer/package.json`;
- `packages/renderer/src/build.ts`;
- `src/blocks/hash.ts`.

The preview script runs via `pnpm exec tsx`, so no `package.json` script is needed.

## File Structure

```
catalog/design-styles.json                      # T1: layoutHints → layout; version 1.1.0
packages/schemas/src/design.ts                  # T1: LayoutSpecSchema, ThemeSpec.layout
packages/schemas/src/catalog-files.ts           # T1: StyleFamilySchema.layout (reuses LayoutSpecSchema)
packages/catalog/src/layout.ts                  # T1: checkLayout (new)
packages/catalog/src/integrity.ts               # T1: + checkLayout call
packages/catalog/src/resolve.ts                 # T1: copies layout
packages/renderer/
  src/theme/colours.ts                          # T2: legibleOn (moved), graphicOn, fillBehind, graphicPalette (new)
  src/theme/compile.ts                          # T2: steps, sizes, grid vars, colour vars; titleCase fix
  src/theme/safe.ts                             # T2: rejects /* and */
  src/blocks/title-case.ts                      # T3: titleCase (new)
  src/blocks/chart.ts                           # T4: rewrite (nice ticks, units, donut, graphic colours)
  src/blocks/render.ts                          # T5: stat/trend/compare markup
  src/blocks/image.ts                           # T9: placeholder composition
  src/html/deck.ts                              # T5: kicker, ordinals, lengths, root attrs, captions, diagram ids
  src/html/context.ts                           # T5: pure per-slide context helpers (new; keeps deck.ts < 300 lines)
  src/html/templates.ts                         # T5: partials, ReadonlyMap
  src/css.ts                                    # T5: cssSources (cache key covers partials)
  templates/*.hbs, templates/partials/*.hbs     # T5
  src/styles/deck.css                           # T5: @imports for new sheets; T6a: base cleanup
  src/styles/layout.css                         # T5 stub → T6a: grid, type, slide compositions, stat layouts
  src/styles/panels.css                         # T5 stub → T6b: panel, divider and emphasis styles
  src/styles/decorations.css                    # T5 stub → T6b: 7 decorations
  src/styles/chrome.css                         # T5 stub → T6c: Reveal controls, progress, slide number
  src/styles/diagrams.css                       # T5 stub → T8: diagram region sizing
  src/styles/images.css                         # T9: imageLayout rules + blend fix
  src/runtime/main.ts                           # T6c: slideNumber off for index kickers
  src/runtime/presets.ts, src/runtime/motion.ts # T10: WCAG-safe flicker, glowStatic
  src/bundle.ts                                 # T10: recursive source hash
  src/diagram-theme.ts                          # T8: mermaidThemeVariables (new)
  src/diagrams.ts                               # T8: reserved classes, fail-closed selectors
  scripts/preview.ts                            # T7: build + screenshot slides for visual iteration (new)
  fixtures/stress.deck.json, stress.interaction.json   # T7 (new)
  test/e2e/global-setup.ts, deck.spec.ts        # T7
  test/e2e/design.spec.ts, metrics.ts, pending.ts      # T7 (new)
  test/{chart,title-case,image,styles-layout,styles-panels,styles-chrome}.test.ts   # new, owned per task
docs/superpowers/reviews/2026-10-24-design-pass-scorecard.md   # T11
```

**Parallel waves.** Tasks within a wave touch disjoint files. Each runs in its own worktree from `feat/design-pass`, and the controller merges each wave before starting the next.

| Wave | Tasks | Files |
|---|---|---|
| 0 | 1, 3, 4, 10 | catalog + schemas + catalog pkg / `title-case.ts` / `chart.ts` + `chart.test.ts` + the chart `describe` in `blocks.test.ts` / runtime presets + motion, `bundle.ts`, `eslint.config.js` |
| 1 | 2, 7 | `src/theme/*`, `theme.test.ts` / `test/e2e/*`, `fixtures/stress.*`, `scripts/preview.ts`, old baselines |
| 2 | 5 | templates, `src/html/*`, `render.ts`, `deck.test.ts`, the `renderBlock` `describe` in `blocks.test.ts`, CSS stubs + `deck.css` imports |
| 3 | 6a, 6b, 6c, 8, 9 | `deck.css` + `layout.css` / `panels.css` + `decorations.css` / `chrome.css` + `runtime/main.ts` / `diagram-theme.ts` + `diagrams.ts` + `diagrams.css` / `image.ts` + `images.css` |
| 4 | 11 | baselines, scorecard, and fix-ups routed back to the owning file |

Task numbers group related work. **Execution order is the waves**: for example, Task 7 runs in wave 1, before Task 5.

**The one file wave-3 tasks share is `test/e2e/pending.ts`.** It holds the set of not-yet-passing design checks:
- each entry is its own block (owner comment line + entry line), separated by blank lines, so deleting one entry never touches a neighbour's lines;
- every task, before committing, deletes the entry of each check that now passes for every deck;
- Task 11 requires the set to be empty.

---

### Task 1: Structured layout tokens in the catalog and ThemeSpec

**Files:**
- Modify:
  - `packages/schemas/src/design.ts`
  - `packages/schemas/src/catalog-files.ts`
  - `catalog/design-styles.json`
  - `packages/catalog/src/integrity.ts`
  - `packages/catalog/src/resolve.ts`
  - `packages/catalog/src/index.ts`
- Create: `packages/catalog/src/layout.ts`
- Test:
  - `packages/schemas/test/contracts.test.ts` and `packages/schemas/test/catalog-files.test.ts`;
  - `packages/catalog/test/integrity.test.ts` and `packages/catalog/test/resolve.test.ts`;
  - new `packages/catalog/test/layout.test.ts`.

**Interfaces:**
- **Produces** in `design.ts`:
  ```ts
  export const GridSpanSchema = z.tuple([z.number().int().min(1).max(12), z.number().int().min(2).max(13)]);
  export const LayoutSpecSchema = z.object({
    grid: z.object({ title: GridSpanSchema, body: GridSpanSchema, wide: GridSpanSchema, aside: GridSpanSchema }).strict(),
    align: z.enum(["start", "center"]),
    coverAnchor: z.enum(["center", "bottom"]),
    steps: z.object({ title: z.number().int().min(1).max(4), display: z.number().int().min(3).max(6), stat: z.number().int().min(3).max(7) }).strict(),
    kicker: z.enum(["section", "index", "none"]),
    stat: z.enum(["bento", "oversized", "row"]),
    panel: z.enum(["flat", "outline", "offset", "glass", "inset", "none"]),
    divider: z.enum(["hairline", "bar", "ornament", "glow", "squiggle"]),
    decoration: z.enum(["none", "blocks", "gridlines", "blobs", "frame", "brackets", "shapes", "vignette"]),
    decorationOn: z.union([z.literal("all"), z.array(z.string())]),
    imageLayout: z.enum(["inset", "bleed", "split"]),
    emphasis: z.enum(["underline", "highlight", "ink", "glow"]),
    tracking: z.enum(["normal", "wide"]),
  }).strict();
  export type LayoutSpec = z.infer<typeof LayoutSpecSchema>;
  ```
- **`ThemeSpecSchema` gains `layout: LayoutSpecSchema`** (required).
- **`StyleFamilySchema` changes:** it drops `layoutHints` and gains `layout: LayoutSpecSchema`, imported from `./design.ts` the same way `HexSchema` is.
- **`checkLayout(c: Catalog): IntegrityIssue[]`** in `layout.ts`. Called at the end of `checkIntegrity` as "rule 11". Issues have `file: "design-styles.json"` and `path` like `families.3.layout.grid.aside`. Checks:
  - each span `start < end`;
  - `aside` lies inside `wide` with `aside[0] > wide[0]`;
  - `steps.title < steps.display` and `steps.stat > steps.title`;
  - `decorationOn` entries are slide-type ids;
  - `decoration === "none"` ⇔ `decorationOn` is `[]`.
- **`resolveTheme`** sets `layout: structuredClone(family.layout)`.

- [ ] **Step 1: Write the failing tests.**
  - `contracts.test.ts`:
    - `ThemeSpec requires layout`: the existing fixture without `layout` fails; with the minimal row from the table it parses.
    - `LayoutSpec rejects unknown keys and out-of-range spans`: `grid.title: [0, 10]` fails, `[1, 14]` fails, and `extra: 1` fails.
  - `catalog-files.test.ts`: `real design-styles.json parses and has no layoutHints`.
  - `layout.test.ts`:
    - `real catalog has no layout issues`.
    - `flags start ≥ end` (mutate `grid.body` to `[9, 9]`).
    - `flags aside outside wide` (atmospheric `aside: [8, 13]`).
    - `flags steps.title ≥ steps.display`.
    - `flags an unknown decorationOn slide type` (`["cover"]`).
    - `flags decoration none with a non-empty decorationOn`.
    - `flags a decoration with decorationOn []`.
    - Each asserts the exact `path`.
  - `integrity.test.ts`: `rule 11: checkIntegrity includes layout issues`.
  - `resolve.test.ts`:
    - `resolveTheme copies the family layout`: minimal gives `layout.stat === "bento"`, `layout.grid.body` deep-equals `[1, 9]`, and `layout.decorationOn` deep-equals `[]`.
    - `resolveTheme layout is a copy`: mutating the result does not change `getFamily(c, "minimal").layout`.
    - `every golden theme carries layout`.
- [ ] **Step 2: Run** `pnpm --filter @deckforge/schemas --filter @deckforge/catalog test`. Expected: FAIL (no `layout`).
- [ ] **Step 3: Implement.**
  - Add the schema and the field.
  - Write the eight `layout` objects exactly as in the token table. `decorationOn` lists use slide-type ids; `"all"` is the string literal.
  - Delete every `layoutHints` array and bump `design-styles.json` `version` to `"1.1.0"`.
  - Update its `notes` to say that layout tokens drive the renderer's composition.
  - Export `checkLayout` from `packages/catalog/src/index.ts`.
- [ ] **Step 4: Run** `pnpm --filter @deckforge/schemas --filter @deckforge/catalog test && pnpm check:literals && pnpm -r typecheck`. Expected: PASS. Renderer typecheck may fail only where its tests build a ThemeSpec by hand; fix those fixtures by spreading `resolveTheme(...)`.
- [ ] **Step 5: Commit** as `feat(catalog): structured per-family layout tokens replace prose layoutHints`.

---

### Task 2: Modular type scale, grid variables and computed AA-safe colours

**Files:**
- Create: `packages/renderer/src/theme/colours.ts`
- Modify: `packages/renderer/src/theme/compile.ts`, `packages/renderer/src/theme/safe.ts`
- Test: `packages/renderer/test/theme.test.ts`

**Interfaces:**
- **Consumes:** `ThemeSpec.layout` (Task 1); `contrastRatio` and `passesAA` from `@deckforge/catalog`.
- **Produces** in `colours.ts`. Every function steps in 1/20 increments with the existing `mix()`, which moves to `colours.ts` unchanged.
  - `legibleOn(roles, colour): string`: moved here unchanged. `compile.ts` re-exports it, so `diagrams.ts`'s import keeps working.
  - `graphicOn(roles, colour): string`: the first step from `colour` toward `roles.text` that has `contrastRatio ≥ 3` against both `roles.bg` and `roles.surface`.
  - `fillBehind(roles, colour): string`: the first step from `colour` toward `roles.bg` on which both `roles.text` and `roles.textMuted` pass AA.
  - `graphicPalette(roles): string[]` (length 6):
    - `g1 = graphicOn(primary)`, `g2 = graphicOn(accent)`, `g3 = graphicOn(textMuted)`;
    - `graphicOn(mix(g1, g2, 0.5))`, `graphicOn(mix(g2, g3, 0.5))`, `graphicOn(mix(g1, g3, 0.5))`.
- **Produces:** `typeStep(ratio: number, n: number): number` in `compile.ts`. Returns `2 × ratio^n` in rem, rounded to 4 decimals.
- **`compileThemeCss(theme)` additionally emits these declarations.** All values are literal numbers or hexes, never `pow()` or `min()`.
  - `--df-step-n2`, `--df-step-n1`, `--df-step-0` … `--df-step-7` as `<n>rem`.
  - `--df-size-body` = step 0 and `--df-size-lead` = step 1.
  - `--df-size-small` = max(step −1, 1.5rem).
  - `--df-size-caption` = max(step −2, 1.375rem).
  - `--df-size-title` = min(step `steps.title`, 5.5rem). `--df-size-title-m` and `--df-size-title-l` are one and two steps lower, floored at `--df-size-lead`.
  - `--df-size-display` = min(step `steps.display`, 9rem), plus `-m` and `-l` variants floored at the title size.
  - `--df-size-stat` = min(step `steps.stat`, 12rem).
  - `--df-col-title|body|wide|aside` as `"<a> / <b>"`, and `--df-col-main` = `"<wide.start> / <aside.start>"`.
  - `--df-graphic-1` … `--df-graphic-6` from `graphicPalette`.
  - `--df-fill-1 = fillBehind(primary)` and `--df-fill-2 = fillBehind(accent)`.
  - `--df-node-radius`: `0` when `parseFloat(radius) === 0`, else `50%`.
- **`--df-title-transform` becomes `uppercase` for `upper` and `none` otherwise.** `TITLE_TRANSFORM`'s `capitalize` is deleted; Task 3/5 title-case the text itself.
- **`safe.ts` `UNSAFE`** also matches `/*` and `*/`.

- [ ] **Step 1: Write the failing tests** in `theme.test.ts`.
  - **Type scale and sizes:**
    - `type steps follow the modular scale`: ratio 1.25 gives `--df-step-0: 2rem`, `--df-step-3: 3.9063rem` and `--df-step-n1: 1.6rem`. Ratio 1.333 gives `--df-step-5: 8.4175rem`.
    - `role sizes come from layout.steps`: minimal defaults give `--df-size-title: 3.9063rem`, `--df-size-display: 6.1035rem` and `--df-size-stat: 7.6294rem`.
    - `role sizes are capped and floored`: swiss + poster-grotesk gives `--df-size-title: 5.5rem`, `--df-size-display: 9rem`, `--df-size-stat: 12rem` and `--df-size-small: 1.5rem`.
  - **Grid:** `grid spans become grid-column values`: minimal gives `--df-col-title: 1 / 10`, `--df-col-main: 1 / 10` and `--df-col-wide: 1 / 13`. Swiss gives `--df-col-title: 3 / 13`.
  - **Computed colours, over every family × allowed palette:** build each combo with `resolveTheme` (default type and motion of the family).
    - `graphic colours reach 3:1 on bg and surface`: all six graphics.
    - `fills keep text and textMuted at AA`.
    - `fill-1 is visibly different from surface`: max |ΔR|,|ΔG|,|ΔB| ≥ 24.
    - `compiles deterministically`.
  - **`graphicOn`:**
    - `graphicOn keeps a colour that already passes`: tokyo-grid primary is returned unchanged.
    - `graphicOn lifts a failing one`: midnight-gala primary changes, and the result is ≥ 3 against bg.
  - **Other declarations:**
    - `title case no longer emits capitalize`: `titleCase: "title"` gives `--df-title-transform: none`. This replaces the old capitalize assertion.
    - `node radius is 0 for square families and 50% otherwise`: swiss gives 0, minimal 50%.
    - `rejects comment markers`: shadow `"0 0 1px red /* x"` throws `UnsafeThemeValueError`, and so does `"*/ x"`.
- [ ] **Step 2: Run** `pnpm --filter @deckforge/renderer exec vitest run test/theme.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The caps and floors are applied in TypeScript; the CSS receives final numbers.
  - Keep `compile.ts` under 300 lines by putting all colour maths in `colours.ts`.
- [ ] **Step 4: Run** `pnpm --filter @deckforge/renderer test && pnpm check:literals`. Expected: PASS.
- [ ] **Step 5: Commit** as `feat(renderer): modular type scale, grid spans and AA-safe graphic/fill colours in theme.css`.

---

### Task 3: Word-aware title casing

**Files:**
- Create: `packages/renderer/src/blocks/title-case.ts`, `packages/renderer/test/title-case.test.ts`

**Interfaces:**
- **Produces:** `titleCase(text: string): string`. It is pure and does not escape; callers escape afterwards. Rules:
  - Words are split on spaces; hyphenated parts are cased separately.
  - A word with an uppercase letter after its first character, or with a digit, is left unchanged.
  - These minor words are lower-cased unless they are first, last, or follow `:`: a, an, and, as, at, but, by, for, in, nor, of, off, on, or, per, so, the, to, up, via, vs, vs., yet.
  - Any other word gets its first letter capitalised. Leading punctuation (`"`, `'`, `(`, `“`, `‘`) is skipped.

- [ ] **Step 1: Write the failing test** `titleCase cases`, as a table of `[input, expected]`:
  - `"path of a photon"` → `"Path of a Photon"`
  - `"how solar cells work"` → `"How Solar Cells Work"`
  - `"the iPhone and mRNA: a story"` → `"The iPhone and mRNA: A Story"`
  - `"GPT-4 vs. 3D printing"` → `"GPT-4 vs. 3D Printing"`
  - `"energy-intensive purification"` → `"Energy-Intensive Purification"`
  - `"what is it for"` → `"What Is It For"`
  - `'a "quoted" word'` → `'A "Quoted" Word'`
  - `"NASA in 2024"` → `"NASA in 2024"`
  - `""` → `""`
  - `"  two  spaces "` keeps its whitespace runs exactly.
- [ ] **Step 2: Run** `pnpm --filter @deckforge/renderer exec vitest run test/title-case.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `titleCase`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** as `feat(renderer): word-aware title casing (replaces CSS capitalize)`.

---

### Task 4: Charts: round ticks, unit spacing, graphic colours, donut fixes

**Files:**
- Modify: `packages/renderer/src/blocks/chart.ts`. Rewrite it; this also fixes the `lo =Math.min` formatting nit.
- Create: `packages/renderer/test/chart.test.ts`. Move the existing `describe("chartSvg")` out of `test/blocks.test.ts` into it, deleting only that `describe` from `blocks.test.ts`.

**Interfaces:**
- **`chartSvg(block, { title })` keeps its signature.**
- **Constants:**
  - `W = 1600`, `H = 640`;
  - the series colours are `var(--df-graphic-1)` … `var(--df-graphic-6)` (Task 2), with no opacity variants.
- **Produces, exported for tests:**
  - `niceTicks(lo: number, hi: number, maxIntervals = 5): number[]`. Use the smallest step s from {1, 2, 2.5, 5} × 10^k such that `ceil(hi/s) − floor(lo/s) ≤ maxIntervals`. Ticks run from `floor(lo/s)·s` to `ceil(hi/s)·s`, rounded to the step's decimals.
  - `formatValue(v: number, unit?: string): string`. Formats with en-US grouping and up to 2 decimals. Negatives use U+2212. A unit is joined with one space, except `%`, `°`, `′` and `″`, which attach directly.
  - `donutSlices(labels: string[], values: number[], max = 6): { label: string; value: number }[]`. Returns the input as-is when it has ≤ `max` entries. Otherwise it sorts by value descending, keeps `max − 1`, and appends `{ label: "Other", value: <sum of the rest> }`.

**Rendering rules:**
- **Cartesian charts:**
  - Tick labels are `formatValue(tick, unit)` at font 24.
  - Category labels are at font 26.
  - The legend is top-right at font 24, shown only when there are > 1 series.
  - Gridlines use `var(--df-border)` and the zero line uses `var(--df-graphic-3)`.
  - A single-series bar chart with ≤ 8 points gets a direct value label (`<text class="df-value">`, `formatValue`) above each bar.
- **Donut charts:**
  - Built from `donutSlices`.
  - The legend swatch uses the slice's exact fill.
  - The centre total is `formatValue(total, unit)`.
- **The unit footer is gone.** It was assembled in `deck.ts`; Task 5 removes it there. This task only stops depending on it.

- [ ] **Step 1: Write the failing tests** in `chart.test.ts`.
  - **`niceTicks`:**
    - `niceTicks rounds`: `niceTicks(0, 1420)` deep-equals `[0, 500, 1000, 1500]`.
    - `niceTicks(-30, 80)` deep-equals `[-50, 0, 50, 100]`.
    - `niceTicks(0, 0.6)` deep-equals `[0, 0.2, 0.4, 0.6]`.
    - `niceTicks(5, 5)` returns ≥ 2 finite values.
  - **`formatValue`:**
    - `formatValue spaces units`: `(1500, "GW")` → `"1,500 GW"`, `(22, "%")` → `"22%"`, `(0.6, "V")` → `"0.6 V"`, `(-3.5, "°C")` → `"−3.5 °C"`, `(1000)` → `"1,000"`.
    - `no tick label glues a digit to a letter`: the solar chart's svg text never matches `/\d[A-Za-z]/`.
  - **Bar charts:**
    - `single-series bar shows direct value labels`: 4 `.df-value` texts, and the last is `"1,420 GW"`.
    - `bar marks use graphic colours only`: every `fill:` in `.df-plot` is `var(--df-graphic-<1..6>)`.
  - **Donut charts:**
    - `donut legend swatches match slices`: for 4 slices, the set of slice fills equals the set of legend fills and no `fill-opacity` < 1 appears.
    - `donut with 10 labels aggregates into Other`: 6 slice paths, 6 legend rows, and the last row starts with `"Other"` and carries the summed value.
  - **Text sizes:** `text sizes meet the 22 px floor`: every `font:` size in the svg is ≥ 22.
  - Keep the moved tests: NaN safety, escaping, role img and title, and "uses only theme variables".
- [ ] **Step 2: Run** `pnpm --filter @deckforge/renderer exec vitest run test/chart.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm --filter @deckforge/renderer test`. Expected: PASS.
- [ ] **Step 5: Commit** as `feat(renderer): legible charts — round ticks, spaced units, 3:1 marks, donut legend/Other fixes`.

---

### Task 5: Templates, partials and deck assembly on the layout tokens

**Files:**
- Create:
  - `templates/partials/{title,kicker,deco}.hbs`;
  - `src/html/context.ts`;
  - `src/styles/{layout,panels,decorations,chrome,diagrams}.css`. Each is a one-line comment stub naming its owning task.
- Modify:
  - `templates/*.hbs` (all 16);
  - `src/html/deck.ts`, `src/html/templates.ts`, `src/blocks/render.ts`;
  - `src/css.ts`: hash `cssSources()` instead of top-level files only;
  - `test/e2e/pending.ts` (the `stat-aria` entry);
  - `src/styles/deck.css`: add the five `@import`s and delete the duplicated `[data-region="title"]` base rule.
- Test: `test/deck.test.ts`, and the `describe("renderBlock")` block of `test/blocks.test.ts`.

**Interfaces:**
- **Consumes:** `ThemeSpec.layout` (Task 1), `titleCase` (Task 3), the CSS variable names from Task 2, and `listSources` (Task 10).
- **Produces in `context.ts`:**
  - `lengthClass(text: string): "s" | "m" | "l"`. Counts characters: ≤ 18 is `s`, ≤ 36 is `m`, otherwise `l`.
  - `kickerFor(slides: Slide[], index: number, layout: LayoutSpec): string`. Returns raw text; the caller cases and escapes it. Returns `""` on title, section and qa slides.
    - `section` gives the title of the nearest preceding `section` slide, or `""`.
    - `index` gives `String(index + 1).padStart(2, "0")`.
    - `none` gives `""`.
  - `sectionNumber(slides, index): string`. On section slides it returns the count of section slides up to and including this one, padded to 2 digits; otherwise `""`.
  - `decorates(layout: LayoutSpec, slideType: string): boolean`.
- **`TemplateContext` gains:**
  ```ts
  kicker: string; sectionNumber: string; titleLen: "s" | "m" | "l"; itemCount: number; decorate: boolean
  ```
  - `kicker` is escaped and title-cased when `theme.titleCase === "title"`.
  - `itemCount` counts the first Bullets items, Stat blocks, Timeline steps or Compare rows; it is 0 otherwise.
- **Markup contract** (the CSS tasks rely on these exact names):
  - `<div class="df-slide df-slide--<type>">` is the root of every template.
  - `<div class="df-deco" aria-hidden="true"></div>` is the first child when `decorate` is true.
  - `<p class="df-kicker">` carries `aria-hidden="true"` for index kickers. It gets the `hidden` attribute when empty.
  - The title partial emits `<h1|h2 class="df-title" data-region="title" data-df-len="<titleLen>">`.
  - Region classes: `df-subtitle`, `df-meta`, `df-body`, `df-aside`, `df-footer`, `df-caption`, `df-section-number` (aria-hidden), and `df-rule` (an empty `span`, aria-hidden).
  - `df-body` carries `data-df-count="<itemCount>"`.
  - **Every optional region that is empty gets the `hidden` attribute and no `data-motion-el`**; the region element itself stays present.
  - Root `.reveal` attributes:
    ```
    data-df-align, data-df-cover, data-df-kicker, data-df-stat, data-df-panel,
    data-df-divider, data-df-decoration, data-df-image-layout, data-df-emphasis, data-df-tracking
    ```
    Each takes its value from `theme.layout`.
  - Every `<section>` carries `data-df-variant="<index % 3>"`, plus `data-df-decorate` when `decorate`.
- **Stat block** (`render.ts`):
  ```
  <div class="df-stat" style="--df-chars:<value.length>"><div class="df-stat-value"><span class="df-stat-number">…</span><trend></div><div class="df-stat-label">…</div></div>
  ```
  - `<trend>` is `<span class="df-stat-trend" role="img" aria-label="Trend: up|down|flat" data-trend="…"><svg viewBox="0 0 10 10" aria-hidden="true" focusable="false"><path …/></svg></span>`.
  - The paths are an up triangle, a down triangle and a flat bar, all filled with `currentColor`.
  - Update `MOTION_TAGS` and the count-up insertion to the new opening tag.
- **Compare** (`deck.ts` `compareColumns`): `compare.hbs` wraps the sides in `<div class="df-compare-grid" style="--df-rows:<itemCount>">`.
  - The left side is `<div class="df-side df-side--a" data-region="left" data-motion-el>`, holding `h3.df-side-title` and `ul.df-side-list > li`.
  - The right side is the same with `df-side--b` and `data-region="right"`.
- **Text transforms:** title-case `title`, `meta`, the kicker and compare side titles when `theme.titleCase === "title"`, before emphasis and escaping.
- **Chart footer:** extra `Paragraph` blocks on a chart slide render into `footer` as a caption, never the unit.
- **Diagrams:** the n-th repeat (n ≥ 1) of the same diagram key on a deck gets every `d-<key>` in its svg rewritten to `d-<key>-<n>`.
- **`loadTemplates()`** returns `ReadonlyMap<string, TemplateDelegate>`. It registers `templates/partials/*.hbs` by basename and excludes partials from the slide-type map.

- [ ] **Step 1: Write the failing tests.**
  - **`deck.test.ts`, structure:**
    - `has a template for every catalog slide type, and partials are not slide types`.
    - `root carries one data-df attribute per layout token`: minimal gives `data-df-stat="bento"`, `data-df-panel="flat"` and `data-df-emphasis="underline"`.
    - `sections carry data-df-variant and data-df-decorate per decorationOn`:
      - retro decorates s01, s03, s14 and s15, and not s04;
      - minimal decorates none;
      - neon decorates all 15;
      - and `s05` carries `data-df-variant="1"`.
  - **`deck.test.ts`, kickers and numbering:**
    - `section kicker names the current section`: minimal s04's `.df-kicker` text is `From sunlight to current`, and s02's `.df-kicker` has `hidden`.
    - `index kicker is padded and aria-hidden`: swiss s04 gives `04` with `aria-hidden="true"`; s01 has an empty, hidden kicker.
    - `section slides carry their ordinal`: s03 `.df-section-number` is `01`.
  - **`deck.test.ts`, text and regions:**
    - `title-case families case the text, not the CSS`: retro s08 title is `Path of a Photon`, and the output contains no `capitalize`.
    - `lengthClass buckets by characters`: `"Questions?"` → `s`, 30 chars → `m`, 40 chars → `l`. Also `s01 title carries data-df-len`.
    - `empty optional regions are hidden and not animated`: a title slide whose `slide.title` equals `deck.title` has `.df-meta[hidden]` with no `data-motion-el`. This folds in the untested `title.hbs empty:hidden`.
  - **`deck.test.ts`, block routing:**
    - `chart footer carries extra paragraphs, never the unit`: the solar s09 footer is empty and hidden. Adding a Paragraph puts its text in the footer.
    - `a diagram used twice gets distinct ids`: two slides with the same mermaid source and a supplied svg give `d-<key>` once and `d-<key>-1` once, with no duplicate `id=` values in the document.
  - **`deck.test.ts`, templates:** `templates carry no hard-coded sizes`. No `.hbs` contains `text-[length:` or a class attribute longer than 200 characters. This folds in the deferred duplicated and 300-char utility strings.
  - **`deck.test.ts`, unchanged:** keep `stat footer carries the labels but is hidden, not sr-only`. That `hidden` is why labels are announced once; Task 7 pins it in the browser.
  - **`blocks.test.ts`, `renderBlock`:**
    - `stat trend is a named img with an aria-hidden svg`: `role="img"`, `aria-label="Trend: up"`, and the svg carries `aria-hidden="true"`.
    - `stat cells carry --df-chars`: `"1,000 W/m²"` gives `--df-chars:10`.
    - `compare emits both sides in one grid with --df-rows`.
  - **`deck.test.ts`, CSS cache:** `cssSources covers template partials and every stylesheet`. `cssSources()` (exported from `src/css.ts`) lists `templates/partials/title.hbs` and `src/styles/layout.css`; it is built on `listSources` (Task 10), so the deck-CSS cache key changes when a partial does.
  - Delete `stat-aria` from `test/e2e/pending.ts` (Task 7 created it; this task owns it).
- [ ] **Step 2: Run** `pnpm --filter @deckforge/renderer exec vitest run test/deck.test.ts test/blocks.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Templates:**
    - Templates now carry structure and semantic classes only. Geometry and appearance move to Task 6's stylesheets.
    - Utilities that are purely structural may stay.
  - **`deck.ts` and `context.ts`:**
    - Keep `deck.ts` under 300 lines by putting the per-slide helpers in `context.ts`.
    - Escape every new attribute value with `escapeHtml`.
    - `--df-chars` and `--df-rows` are integers produced by the renderer, never from deck text.
- [ ] **Step 4: Run** `pnpm --filter @deckforge/renderer test && pnpm --filter @deckforge/renderer typecheck && pnpm check:literals`. Expected: PASS.
  - Unit tests pass.
  - e2e visual tests are fixme'd by Task 7.
  - Run `pnpm exec tsx scripts/preview.ts --family minimal --deck solar --slides title,stat` once to confirm the deck builds and opens. It will look unstyled; that is expected.
- [ ] **Step 5: Commit** as `feat(renderer): token-driven template skeleton — partials, kickers, ordinals, length classes, a11y stat trend`.

---

### Task 6a: Grid, type and slide compositions (`layout.css`)

**Files:**
- Modify: `src/styles/layout.css`, `src/styles/deck.css`, `test/e2e/pending.ts` (entries owned here)
- Create: `test/styles-layout.test.ts`

**Interfaces:**
- **Consumes:**
  - the markup contract (Task 5);
  - `--df-size-*`, `--df-col-*`, `--df-graphic-*`, `--df-fill-*` and `--df-node-radius` (Task 2);
  - `metrics.ts` checks and `scripts/preview.ts` (Task 7).
- **Produces:**
  - the `.df-slide` 12-column grid;
  - every slide-type composition in **The design system → Slide-type compositions**;
  - the three stat layouts;
  - the `data-df-len` step-downs (`m` → `-m` size and `l` → `-l` size for title and display);
  - the `data-df-count` lead-size rule;
  - `[data-df-align]` and `[data-df-cover]` rules;
  - the `[data-df-kicker]` typography: section kicker at `--df-size-small` in muted colour; index kicker in display face at `--df-size-title` in the rail, or inline when the title starts at column 1;
  - the `[data-df-tracking="wide"]` rule.

- [ ] **Step 1: Write the failing tests.**
  - `test/styles-layout.test.ts`: `every stat, kicker, align, cover and tracking value has a rule in layout.css`. Read the enum options from `LayoutSpecSchema` and assert each `[data-df-<key>="<value>"]` appears, the same way the existing textures test does.
  - Delete these entries from `test/e2e/pending.ts`:
    - `fills-frame`
    - `title-ratio`
    - `vertical-overflow`
    - `stat-one-line`
    - `compare-rows-align`
    - `min-text-size`
    - `graphics-3to1`
- [ ] **Step 2: Run** `pnpm --filter @deckforge/renderer exec playwright test test/e2e/design.spec.ts`. Expected: those checks FAIL.
- [ ] **Step 3: Implement** `layout.css`.
  - Iterate visually: for each of minimal, swiss and retro, run `pnpm exec tsx scripts/preview.ts --family <id> --deck solar` and `--deck stress`, then Read the PNGs.
  - Self-critique each set against the rubric (Appendix A) before moving on.
  - Remove from `deck.css` any rule that `layout.css` now owns: the old `.df-quote` side stripe, `.df-timeline-step` `border-left`, and `.df-compare` table styles that the new markup no longer uses.
- [ ] **Step 4: Run** `pnpm --filter @deckforge/renderer test && pnpm --filter @deckforge/renderer exec playwright test test/e2e/design.spec.ts`. Expected: the six checks PASS for all 8 families on solar, stress and alt decks.
- [ ] **Step 5: Commit** as `feat(renderer): 12-column grid, modular type and per-slide-type compositions`.

---

### Task 6b: Panels, dividers, emphasis and decorations

**Files:**
- Modify: `src/styles/panels.css`, `src/styles/decorations.css`, `test/e2e/pending.ts` (entries owned here)
- Create: `test/styles-panels.test.ts`

**Interfaces:**
- **Consumes:** the markup contract (Task 5), Task 2's variables, and the existing `--df-shadow`, `--df-radius`, `--df-border-width`, `--df-backdrop-filter` and `--df-surface-alpha`.
- **Produces** the rules below.
- **Panels** (`[data-df-panel]`) apply to `.df-side`, `pre.df-code`, `.df-image` (inset only) and, under `[data-df-stat="bento"]`, `.df-stat`:
  - `flat`: fill only. Radius `--df-radius`, no border.
  - `outline`: transparent fill, 1 px `--df-graphic-1` border, inner glow `inset 0 0 1.5rem color-mix(in srgb, var(--df-graphic-1) 18%, transparent)`.
  - `offset`: `--df-border-width` solid `--df-text`, plus `box-shadow: var(--df-shadow)`.
  - `glass`: surface at `--df-surface-alpha`, `backdrop-filter: var(--df-backdrop-filter)`, a 1 px `color-mix(in srgb, white 45%, transparent)` border, and `box-shadow: var(--df-shadow)`.
  - `inset`: fill plus an inner hairline, `outline: 1px solid var(--df-border); outline-offset: -0.75rem`.
  - `none`: no box. Compare sides separate with a single 1 px vertical `--df-border` rule.
- **Panel fills:**
  - Compare side B, and the bento hero cell (first `.df-stat`), use `--df-fill-1`.
  - Under `[data-df-panel="offset"]` (the colour-blocked bento), the bento cells cycle `--df-fill-1`, `--df-fill-2`, `surface`.
- **Dividers** (`[data-df-divider]`) apply to `.df-rule`, agenda and summary row separators, row-stat separators and compare row separators:
  - `hairline`: 1 px `--df-border`.
  - `bar`: 0.5 rem `--df-graphic-1`.
  - `ornament`: rule, 0.6 rem diamond, rule, in `--df-graphic-2`. Built with `mask-image` on a `data:` SVG and `background-color`.
  - `glow`: 1 px `--df-graphic-1` with `box-shadow: 0 0 0.6rem var(--df-graphic-1)`.
  - `squiggle`: a 1 rem tall wave as a `mask-image` in `--df-graphic-2`.
- **Emphasis** (`[data-df-emphasis] mark.df-emph`). This replaces the grey `color-mix` block:
  - `underline`: `text-decoration: underline 0.08em var(--df-graphic-2); text-underline-offset: 0.14em`, transparent background.
  - `highlight`: `--df-fill-2` background, text colour unchanged.
  - `ink`: `--df-accent-text`, weight 700.
  - `glow`: ink plus `text-shadow: 0 0 0.35em color-mix(in srgb, var(--df-accent) 60%, transparent)`.
- **Decorations** (`[data-df-decoration] section[data-df-decorate] .df-deco`, `::before`, `::after`):
  - The element is `position: absolute; inset: 0; z-index: 0; pointer-events: none`, and slide content sits at `z-index: 1`.
  - Three placements per decoration are keyed by `data-df-variant`.
  - Shapes stay outside `--df-col-title` and `--df-col-body` on content slides. The one exception is maximal-pop's cover and section shape behind the title, which uses `--df-fill-1/2` (text is AA on those).
  - Anything that does sit under text has opacity ≤ 0.12. Fills come only from `--df-graphic-*` and `--df-fill-*`.
  - The seven decorations are as described in **Family identity**: `blocks`, `gridlines`, `blobs`, `frame`, `brackets`, `shapes`, `vignette`.

- [ ] **Step 1: Write the failing tests.**
  - `test/styles-panels.test.ts`:
    - `every panel, divider, emphasis and decoration value has a rule`, with enums read from `LayoutSpecSchema`; `decoration` excludes `none`.
    - `decorations.css uses only --df variables for colour`: no `#`, `rgb(` or named colour except `white`/`black` inside `color-mix`.
  - Delete the `decorations-behind` and `emphasis-legible` entries from `pending.ts`.
- [ ] **Step 2: Run** `pnpm --filter @deckforge/renderer exec vitest run test/styles-panels.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Iterate with `scripts/preview.ts` on brutalist, glass-soft, neon, maximal-pop and atmospheric (cover, stat, compare, section), and self-critique against Appendix A.
- [ ] **Step 4: Run** `pnpm --filter @deckforge/renderer test && pnpm --filter @deckforge/renderer exec playwright test test/e2e/design.spec.ts && pnpm check:literals`. Expected: PASS for the owned checks.
- [ ] **Step 5: Commit** as `feat(renderer): per-family panels, dividers, emphasis and decorations from layout tokens`.

---

### Task 6c: Themed Reveal chrome

**Files:**
- Modify: `src/styles/chrome.css`, `src/runtime/main.ts`, `test/e2e/pending.ts` (entries owned here)
- Create: `test/styles-chrome.test.ts`

**Interfaces:**
- **Produces:**
  - `.reveal .progress`: height 6 px, fill `var(--df-graphic-1)`, track `color-mix(in srgb, var(--df-text) 12%, transparent)`.
  - `.reveal .controls`: colour `var(--df-text-muted)`.
  - `.reveal .slide-number`:
    - no background, colour `var(--df-text-muted)`;
    - `font: 500 15px/1 var(--df-font-body)` with `tabular-nums`;
    - bottom-left at 20 px / 16 px, so it clears the arrows. It replaces the default grey badge.
  - **Runtime:** `main.ts` passes `slideNumber: false` when `.reveal` has `data-df-kicker="index"`, since the index is already on the slide; otherwise `"c/t"`.

- [ ] **Step 1: Write the failing tests.**
  - `styles-chrome.test.ts`: `chrome.css styles progress, controls and slide-number with --df variables only`.
  - Delete the `chrome-legible` and `slide-number-once` entries from `pending.ts`. Those checks, defined in Task 7, assert:
    - slide-number text ≥ 4.5:1 against the page background;
    - progress fill ≥ 3:1 against the page background;
    - control arrows ≥ 3:1 against the page background;
    - that only one of `.slide-number` (visible) and the index kicker is shown.
- [ ] **Step 2: Run** the design spec. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm --filter @deckforge/renderer exec playwright test test/e2e/design.spec.ts -g chrome`. Expected: PASS on light and dark families.
- [ ] **Step 5: Commit** as `feat(renderer): themed, legible Reveal controls, progress bar and slide number`.

---

### Task 7: E2E for all 8 families, stress deck, design checks, preview script

**Files:**
- Modify:
  - `test/e2e/global-setup.ts` and `test/e2e/deck.spec.ts`;
  - delete the 24 PNGs in `test/e2e/__screenshots__/`.
- Create:
  - `test/e2e/metrics.ts`, `test/e2e/design.spec.ts`, `test/e2e/pending.ts`;
  - `fixtures/stress.deck.json`, `fixtures/stress.interaction.json`;
  - `scripts/preview.ts`.

**Interfaces:**
- **`global-setup.ts`:**
  - Exports `FAMILIES` (read synchronously from `catalog/design-styles.json`) and `DECKS: { family, deck: "solar" | "stress" | "alt" }[]`.
  - Builds, for each family:
    - `solar` and `stress` with the family defaults (`defaultsForFamily`: default palette, type and **motion**, so every family runs an allowed motion template);
    - `alt`: the solar deck with the first allowed palette whose `mode` differs from the default's, else the last allowed palette.
  - Output path: `test-results/decks/<family> <deck> déck/`.
- **`stress.deck.json`** (12 slides; it must pass `DeckSpecSchema`) contains:
  - an 8-word title with a 14-letter word;
  - a 3-stat slide with `"1,000,000 W/m²"`, `"$1.2 trillion"` and `"−3.5 °C"` (trends up, down, flat);
  - a compare with 5 rows where one cell is about 18 words and its neighbour 1 word;
  - a donut with 10 labels;
  - a flowchart with a subgraph and edge labels;
  - a sequence diagram with a note;
  - a mermaid pie;
  - a 6-step timeline;
  - a 5-item agenda;
  - an image with a 15-word caption;
  - a quote of 35 words;
  - a 5-item summary.
- **`metrics.ts`** (browser-side helpers passed to `page.evaluate`, plus Node helpers):
  - `rgbContrast(a: string, b: string): number`, which parses computed `rgb()`/`rgba()`;
  - `safeFrame(section)`, which returns the section box minus computed padding;
  - `contentExtent(section): { top, bottom, left, right }`. It is the union of the client rects of text nodes and replaced elements (svg, img) inside `[data-region]`, excluding `.df-deco`.
- **`pending.ts`:** `export const PENDING: ReadonlySet<string>`, laid out as in the waves section.
- **`design.spec.ts` also has `no design check is pending`**: `expect([...PENDING]).toEqual([])`. It is itself `test.fixme` until Task 11 removes that fixme.
- **`design.spec.ts`:** one `test.describe` per entry in `DECKS`. Each check calls `test.fixme(PENDING.has(id))`.

| id | owner | assertion |
|---|---|---|
| `fills-frame` | 6a | for agenda, bullets, summary, stat, chart, diagram, compare, timeline and code: `(bottom − top) / safe.height ≥ 0.55` and `(safe.bottom − bottom) / safe.height ≤ 0.35` |
| `title-ratio` | 6a | on the bullets slide, title font-size / first `li` font-size ≥ 1.5 |
| `vertical-overflow` | 6a | no `[data-region]` has `scrollHeight > clientHeight + 1`, on every slide |
| `stat-one-line` | 6a | every `.df-stat-number` has exactly one client rect line (`getClientRects()` tops all equal) and `scrollWidth ≤ clientWidth + 1` |
| `compare-rows-align` | 6a | for each i, `top(left li i) === top(right li i) ± 1` |
| `min-text-size` | 6a | every visible text element inside `.slides` (svg text excluded) has computed font-size ≥ 24 px, or ≥ 22 for `.df-caption`, `.df-footer` and chart and diagram text |
| `graphics-3to1` | 6a | every `.df-chart .df-plot` mark fill and every timeline node is ≥ 3:1 against `--df-bg` |
| `decorations-behind` | 6b | `.df-deco` is the first child, `pointer-events: none`, and its z-index is lower than every sibling's |
| `emphasis-legible` | 6b | each `mark.df-emph`'s text colour against its own background (or the slide bg when transparent) is ≥ 4.5 |
| `chrome-legible` | 6c | as in Task 6c |
| `slide-number-once` | 6c | as in Task 6c |
| `stat-aria` | 5 | `section.present` `ariaSnapshot()` contains each stat label exactly once, and an `img "Trend: up"` |
| `diagram-fills` | 8 | the `.df-diagram svg` box is ≥ 0.8 of its region's width or height |
| `image-caption-legible` | 9 | on `bleed`, the caption's background is opaque `--df-bg` and contrast is ≥ 4.5 |

- **`deck.spec.ts` changes:**
  - It runs over `DECKS` where `deck === "solar"`.
  - `motion runs` samples the minimum opacity over `section.present [data-motion-el], section.present [data-motion-el] *`, so split and typewriter presets count.
  - `long unbroken tokens wrap` keeps its horizontal assertion; the vertical check lives in `design.spec.ts`.
  - `visual: <type>` covers 13 types: title, agenda, section, bullets, stat, quote, chart, diagram, compare, timeline, code, image, summary. Each saves `<family>-<type>.png`.
  - Add `visual stress: <name>` for neon, atmospheric and retro, saving `<family>-stress-flow.png` (flowchart with subgraph and edge labels), `<family>-stress-sequence.png` (sequence with note) and `<family>-stress-donut.png`.
  - **Every visual test is `test.fixme` until Task 11.**
- **`scripts/preview.ts`:**
  - Usage: `tsx scripts/preview.ts --family <id> [--deck solar|stress|alt] [--slides type,type]`.
  - Builds the deck to `test-results/preview/` and screenshots the chosen slides at **1920×1080** with `?df-motion=off` after `document.fonts.ready`.
  - Writes `test-results/preview/<family>-<deck>-<type>.png` and prints the paths.
  - It takes ids only from argv, never as literals.

- [ ] **Step 1: Write the tests above.**
  - Put every id in `PENDING` except any check that already passes for all decks at this point; leave those enabled.
  - Validate `stress.deck.json` with a vitest case, `stress fixture parses as DeckSpec and covers every stress case`, in `test/deck.test.ts`. Coordinate: Task 5 also edits this file, so add the case in its own `describe` at the end of the file.
- [ ] **Step 2: Run** `pnpm --filter @deckforge/renderer test:e2e`. Expected:
  - PASS, with fixme'd checks skipped;
  - the zero-request, slide-count, overflow, motion, reduced-motion and notes tests PASS for all 8 families;
  - global setup builds 24 decks.
- [ ] **Step 3: Run** `pnpm exec tsx scripts/preview.ts --family neon --deck stress --slides stat` and Read the PNG. Expected: a 1920×1080 image.
- [ ] **Step 4: Commit** as `test(renderer): 8-family e2e, stress deck, design checks (pending ratchet), preview script`.

---

### Task 8: Diagrams: full Mermaid theming, region scaling, reserved classes

**Files:**
- Create: `src/diagram-theme.ts`
- Modify: `src/diagrams.ts`, `src/styles/diagrams.css`, `test/e2e/pending.ts` (entry owned here)
- Test: `test/diagrams.test.ts`, `test/diagram-isolation.test.ts`

**Interfaces:**
- **Consumes:** `graphicPalette`, `fillBehind` and `legibleOn` (Task 2).
- **Produces:** `mermaidThemeVariables(theme: ThemeSpec): Record<string, string | boolean>`. Every colour is a validated hex.
  - **Nodes:**
    - `primaryColor`=surface, `primaryTextColor`=text, `primaryBorderColor`=g1;
    - `secondaryColor`=fill-1, `secondaryTextColor`=text, `secondaryBorderColor`=g1;
    - `tertiaryColor`=fill-2, `tertiaryTextColor`=text, `tertiaryBorderColor`=g2;
    - `mainBkg`=surface, `nodeBorder`=g1, `nodeTextColor`=text.
  - **Text and lines:** `textColor`=text, `titleColor`=text, `lineColor`=g3, `background`=bg, `edgeLabelBackground`=bg.
  - **Clusters and notes:**
    - `clusterBkg`=`mix(bg, surface, 0.5)`, `clusterBorder`=g3;
    - `noteBkgColor`=fill-2, `noteTextColor`=text, `noteBorderColor`=g2.
  - **Sequence diagrams:**
    - `actorBkg`=surface, `actorBorder`=g1, `actorTextColor`=text, `actorLineColor`=g3;
    - `signalColor`=g3, `signalTextColor`=text;
    - `labelBoxBkgColor`=surface, `labelBoxBorderColor`=g1, `labelTextColor`=text, `loopTextColor`=text.
  - **Pie charts:**
    - `pie1`…`pie6`=g1…g6;
    - `pieStrokeColor`=bg, `pieOuterStrokeColor`=g3;
    - `pieTitleTextColor`=text, `pieLegendTextColor`=text;
    - `pieSectionTextColor`: whichever of text or bg has the higher minimum contrast against `pie1…6`;
    - `pieSectionTextSize`: `"0px"` when that minimum is < 4.5, else `"24px"`. The legend carries the values.
  - **Scale colours:** `cScale0`…`cScale11` cycle [fill-1, fill-2, surface]; `cScaleLabel0`…`11`=text.
  - **Typography and mode:** `fontFamily` (as today), `fontSize: "28px"`, `darkMode: theme.mode === "dark"`.
- **`mermaidConfig`** uses it.
- **`REVEAL_CLASSES`** gains `"navigate-prev"`, `"navigate-next"` and `"enter-fullscreen"`.
- **`selectorClassNames(css)` fails closed:** it throws `UnenumerableClassSelectorError` (exported) when any selector prelude contains an attribute selector on `class`.
  - That is `/\[\s*(?:[\w-]*\|)?class\s*(?:[~|^$*]?=|\])/i`, tested after comments and strings are stripped.
  - `reservedClassNames` lets that error propagate, so a build fails loudly.
- **`diagrams.css`:**
  - `.df-diagram` fills its region.
  - `.df-diagram > svg` gets `width: 100%; height: 100%; max-width: 100% !important; max-height: 100%`. The `!important` beats any inline `max-width` Mermaid emits.
  - The body region is a grid on `--df-col-main` (aside present) or `--df-col-wide`.

- [ ] **Step 1: Write the failing tests.**
  - **`diagrams.test.ts`, theme variables:**
    - `mermaid theme variables cover every themed key`: the key set equals the list above.
    - `every mermaid text pair passes AA and every line 3:1 for every family × allowed palette`. Pairs are:
      - each `*TextColor` or `textColor` against its background key;
      - `cScaleLabelN` against `cScaleN`;
      - `lineColor`, `signalColor`, `actorLineColor`, `nodeBorder`, `clusterBorder` and `pie1`…`pie6` against `background`.
    - `darkMode follows the palette mode`.
  - **`diagrams.test.ts`, browser rendering:**
    - `a dark-theme flowchart with a cluster and edge label carries no mermaid default colours`:
      - render the stress flowchart once with `{ theme: "base" }` and no `themeVariables`, and collect its `<style>` hexes as D;
      - render it on atmospheric with `mermaidConfig`, collecting S;
      - let V be the hex values of `mermaidThemeVariables`;
      - assert `S ∩ (D \ V)` is empty.
    - `a diagram that exceeds the timeout …` and the existing tests stay green.
  - **`diagram-isolation.test.ts`:**
    - `reserves Reveal's navigation and fullscreen hooks`: `reservedClassNames()` contains `navigate-prev`, `navigate-next` and `enter-fullscreen`. A sanitised diagram whose node has `class="navigate-next"` loses that token.
    - `selectorClassNames fails closed on class attribute selectors`: it throws for `[class~="a"]{}`, `[ CLASS *= "df" ]{}`, `[*|class]{}` and `a[class]{}`. It does not throw for `[data-class]{}`, `/* [class] */ .a{}` or `.a{content:"[class]"}`.
  - Delete `diagram-fills` from `pending.ts`.
- [ ] **Step 2: Run** `pnpm --filter @deckforge/renderer exec vitest run test/diagrams.test.ts test/diagram-isolation.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Keep `diagrams.ts` edits to the import, `REVEAL_CLASSES`, `selectorClassNames` and `mermaidConfig`; see **Harness overlap**.
  - Preview neon, atmospheric and retro on the stress diagrams.
- [ ] **Step 4: Run** `pnpm --filter @deckforge/renderer test && pnpm --filter @deckforge/renderer exec playwright test test/e2e/design.spec.ts -g diagram`. Expected: PASS.
- [ ] **Step 5: Commit** as `feat(renderer): fully themed, region-filling diagrams; reserve Reveal nav hooks; fail closed on class attribute selectors`.

---

### Task 9: Images: placeholder composition and image layouts

**Files:**
- Modify: `src/blocks/image.ts`, `src/styles/images.css`, `test/e2e/pending.ts` (entry owned here)
- Create: `test/image.test.ts`

**Interfaces:**
- **`placeholderImageSvg(block)` keeps its signature.** The new composition is an abstract poster rather than clip-art shapes:
  - `viewBox="0 0 1600 900"` with `preserveAspectRatio="xMidYMid slice"`;
  - a full-bleed `linearGradient` from `--df-surface` to `--df-fill-1`;
  - one focal circle (radius 160–260) on a rule-of-thirds intersection;
  - 2–3 horizontal bands (horizon), in `--df-graphic-2` and `--df-fill-2`, at opacities 0.35–0.8.
  - Every choice comes from `sha256Bytes(prompt)`. Gradient ids are prefixed `df-img-<first 8 hex of the hash>` so two images never collide.
- **`images.css` adds `[data-df-image-layout]` rules on `.df-slide--image`:**
  - `inset`: the figure sits in `--df-col-wide` with the panel style. The caption sits below, left-aligned (centred when `align` is center) at `--df-size-small`.
  - `bleed`: the figure is `position: absolute; inset: 0` behind content. The caption sits bottom-left in a plate with an opaque `--df-bg` background and `--df-gap` padding, `--df-size-lead`, at most 7 columns wide.
  - `split`: the figure covers columns 1–7 and bleeds off the top, bottom and left edges. The caption is in display face at `--df-size-title`, vertically centred in columns 9–12.
- **Blend fix** (deferred T2 item): `duotone` and `neon-duotone` apply `mix-blend-mode` on an `::after` overlay *inside* the figure (`isolation: isolate`), so the slide background no longer bleeds through.

- [ ] **Step 1: Write the failing tests.**
  - `image.test.ts`:
    - `placeholder is deterministic and slice-fitted`: the same prompt gives identical output, `preserveAspectRatio="xMidYMid slice"`, and `viewBox="0 0 1600 900"`.
    - `two prompts never share gradient ids`.
    - `placeholder uses only theme variables`: no `#` hex.
    - `escapes alt`.
    - `every imageLayout value has a rule in images.css`.
  - Delete `image-caption-legible` from `pending.ts`.
- [ ] **Step 2: Run** `pnpm --filter @deckforge/renderer exec vitest run test/image.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Preview swiss (split, duotone), neon (bleed, neon-duotone) and retro (inset, sepia).
- [ ] **Step 4: Run** `pnpm --filter @deckforge/renderer test && pnpm --filter @deckforge/renderer exec playwright test test/e2e/design.spec.ts -g image`. Expected: PASS.
- [ ] **Step 5: Commit** as `feat(renderer): art-directed image placeholder and inset/bleed/split image layouts`.

---

### Task 10: Motion safety and build hygiene

**Files:**
- Modify:
  - `src/runtime/presets.ts`, `src/runtime/motion.ts`;
  - `src/bundle.ts`;
  - `eslint.config.js` (root): add the missing space before `".superpowers/**"`.
- Test: `test/presets.test.ts`, `test/motion.test.ts`, and the new `describe("bundle sources")` in `test/build.test.ts`.

**Interfaces:**
- **Produces in `motion.ts`:**
  - `export const FLICKER = { dips: 2, halfPeriod: 0.2 } as const;`, which is 2 opacity dips at 0.2 s down plus 0.2 s up;
  - `export function flashesPerSecond(f: { dips: number; halfPeriod: number }): number`, which returns the maximum number of flashes in any 1 s window (each dip is one flash).
- **`glitchIn`, `glitchOut` and `glow`** use `FLICKER`:
  - opacity 1 → 0.55 → 1;
  - applied to all targets at once, with no stagger, so flashes do not accumulate across elements;
  - at most once per slide entry.
  - With `flicker: false` the dips are skipped (unchanged).
- **`resolveSlideMotion(m, reduced)`:** under `fadeOnly`, emphasis `glow` is kept as `glow` when `reduced.glowStatic`. The engine then passes `glowStatic: true`, so the glow is static. This fixes "glowStatic unreachable under fadeOnly".
- **`bundle.ts`:** export `listSources(dir: string): string[]`, which returns relative paths of all files under `dir` recursively, sorted. `bundleIife` hashes those, so the cache key covers nested runtime files.

- [ ] **Step 1: Write the failing tests.**
  - **`motion.test.ts`:**
    - `flicker stays within WCAG 2.3.1`: `flashesPerSecond(FLICKER) ≤ 3`.
    - `fadeOnly with glow static keeps glow`: `resolveSlideMotion({…, emphasis: "glow"}, parseReducedMotion("fadeOnly; no flicker; glow static")).emphasis === "glow"`.
    - `fadeOnly without glow static still drops glow`.
  - **`presets.test.ts`** (jsdom + gsap, as today):
    - `glitchIn dips at most 3 times in any second and dips all targets together`. Build `glitchIn` on 3 elements; seek in 10 ms steps over its duration plus 1 s; count opacity crossings below 0.7 per 1 s sliding window (≤ 3); and assert the 3 elements' opacities are equal at every sample after the entry move.
    - `glow flicker obeys the same bound`.
    - `glowStatic sets the glow without animating`: one `set`, and the timeline duration is 0.
    - `flicker false never dips`.
  - **`build.test.ts`:** `listSources includes nested files`: a temp dir with `a.ts` and `sub/b.ts` gives `["a.ts", "sub/b.ts"]`.
- [ ] **Step 2: Run** `pnpm --filter @deckforge/renderer exec vitest run test/motion.test.ts test/presets.test.ts test/build.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm --filter @deckforge/renderer test && pnpm lint`. Expected: PASS.
- [ ] **Step 5: Commit** as `fix(renderer): WCAG 2.3.1-safe glitch/glow flicker, static glow under reduced motion, recursive bundle hash`.

---

### Task 11: Baselines and the design-review gate

**Files:**
- Modify:
  - `test/e2e/deck.spec.ts`: remove the visual `test.fixme`;
  - `test/e2e/pending.ts`, which must be left empty;
  - `test/e2e/__screenshots__/*`: 104 family baselines plus 9 stress baselines.
- Create: `docs/superpowers/reviews/2026-10-24-design-pass-scorecard.md`

- [ ] **Step 1: Remove the fixme** on `no design check is pending` and run `pnpm --filter @deckforge/renderer exec playwright test test/e2e/design.spec.ts -g pending`. Expected: PASS. If it fails, route each remaining id to its owning task and stop here.
- [ ] **Step 2: Generate the baselines.**
  - Remove the visual fixme.
  - Run `pnpm --filter @deckforge/renderer exec playwright test --update-snapshots`.
  - Expected: 113 PNGs written. Then run once more without the flag; expected: all PASS.
- [ ] **Step 3: Design review, one fresh reviewer agent per family (8 in parallel, Opus, high).**
  - Each reviewer receives:
    - Appendix A (rubric);
    - that family's paragraph from **Family identity** and its token row;
    - the paths of its 13 baselines (plus stress baselines where present);
    - the instruction to Read every PNG.
  - Reviewers are not given implementation notes or earlier reviews.
  - Each returns a table of `slide × criterion` scores (1–4), each with a one-line reason, plus a P0–P3 issue list naming the slide and element.
- [ ] **Step 4: Blind distinctiveness test, one more fresh agent.**
  - Make 8 triptychs (cover, stat, compare) with ImageMagick, `magick <cover> <stat> <compare> +append`, written to `test-results/blind/<random-letter>.png`. Shuffle the letters with a recorded seed.
  - Give the agent the 8 **Family identity** paragraphs and the 8 images, without names, and ask it to match them.
  - Pass: ≥ 7 of 8 correct.
- [ ] **Step 5: Gate.** The pass requires all of:
  - every criterion ≥ 3 on every baseline;
  - no P0 or P1 issues;
  - the blind test passes.
  - **On failure:**
    1. Route each issue to the task that owns the file: layout → 6a, look → 6b, chrome → 6c, diagrams → 8, images → 9, charts → 4.
    2. A fresh implementer fixes it.
    3. Regenerate the affected baselines.
    4. Re-review only the affected families with fresh reviewers.
  - **At most 3 rounds,** then stop and escalate to the user with the scorecard and the failing PNGs.
- [ ] **Step 6: Write the scorecard** to `docs/superpowers/reviews/2026-10-24-design-pass-scorecard.md`. It holds:
  - per-family score tables (final round);
  - the blind-test key and answers;
  - the issues fixed per round;
  - a short "type families" note. That note records any family whose reviewers blamed the catalog typeface, which is input for the deferred font follow-up.
- [ ] **Step 7: Final verification**, which must exit 0:
  ```
  pnpm -r test && pnpm --filter @deckforge/renderer test:e2e && pnpm check:literals && pnpm lint && pnpm -r typecheck
  ```
  Also confirm `fixture totalBytes` is ≤ 2,621,440 in the `build.test.ts` output.
- [ ] **Step 8: Commit** as `test(renderer): 8-family design baselines accepted by rubric review`.

---

## Deferred items from the renderer reviews

| Item | Decision |
|---|---|
| T2 duotone/neon-duotone blend needs a visual check | **Task 9** (overlay blend fix + swiss/neon baselines) |
| T3 font dedupe keeps original casing | **Rejected.** CSS `font-family` matching is ASCII case-insensitive, so a differently-cased name still resolves to the single declared face. ThemeSpec now comes only from the catalog, which has canonical names. |
| T4 donut legend opacity ≠ slice | **Task 4** |
| T4 donut ≥ 9 labels without legend rows | **Task 4** (`donutSlices`, max 6 with Other) |
| T4 `lo =Math.min` formatting | **Task 4** (rewrite) |
| T4 trend `aria-label` without a role | **Task 5** (`role="img"`, `Trend: …`) + Task 7 `stat-aria` |
| T7 glowStatic unreachable under fadeOnly | **Task 10** |
| T7 no tests for flicker/glowStatic | **Task 10** |
| T7 no tests for wipe and exit revert; slow engine smoke test | **Rejected here.** These are motion-engine coverage, not design. Carried to Plan 2b (interactions + depth), which owns the runtime engine next. |
| T5 duplicated or conflicting Tailwind utilities; 300-char class string repeated | **Task 5** (partials, semantic classes, test caps class length) |
| T5 second Compare dropped silently | **Rejected here.** The harness owns it (review M6 → harness design validator). |
| T5 empty `[data-motion-el]` on empty titles | **Task 5** |
| T5 quiz keeps `data-correct` in the DOM | **Rejected here.** It belongs to the Plan 2b `df-quiz` component, which owns answer reveal. |
| T5 stat labels read twice | **Task 5** keeps the footer `hidden`; **Task 7** `stat-aria` pins it in the browser |
| T5 `loadTemplates` shared mutable Map | **Task 5** (`ReadonlyMap`) |
| T5 templates path breaks if bundled | **Rejected.** The renderer is consumed from source via the workspace (`exports` → `src/`) and never bundled. Revisit if that changes. |
| T6 no timeout around `mermaid.render` | **Rejected: already resolved.** `diagram-page/main.ts` races a timeout; M3 (abort) is harness Task 4. |
| T8 eslint missing space | **Task 10** |
| T8 deck.css title rule duplicates utilities | **Task 5** (rule deleted; the partial owns it) |
| T9 motion poll window; `?df-motion=off` fragments ruling | **No action.** Closed as resolved / ruling stands. |
| T9 title.hbs `empty:hidden` untested | **Task 5** (`hidden` attribute, tested) |
| T9 mermaid themes only `primary*` | **Task 8** |
| T9 minimal-stat heavy grey mark, tight label | **Task 6b** (emphasis styles) + **Task 6a** (bento label spacing) |
| Final M4 `/*` in theme values | **Task 2** |
| Final M5 duplicate diagram ids | **Task 5** (occurrence suffix). Arrowhead markers otherwise resolve to a copy inside a `display:none` slide. |
| Final M7 glitch/glow ~12 Hz flicker | **Task 10** |
| Final M8 `titleCase` capitalize mangles names | **Tasks 3 + 5** |
| Final visual items: chart ticks and unit footer, retro-stat crowding, mark touching label, slide-number badge contrast, dark mermaid secondary colours | **Tasks 4, 6a, 6b, 6c, 8** |
| Final reserve `navigate-prev/next`, `enter-fullscreen`; `selectorClassNames` fail closed | **Task 8** |
| Final `bundleIife` hashes only top-level files | **Task 10** |
| Final renderer tsx test relies on root tsx | **Rejected here.** Harness Task 4 creates `tsx-diagrams.test.ts` and owns it. |
| Ruling: Plan 2c design pass | This plan |

---

## Appendix A: Design-review rubric

**Scoring:** each baseline is scored 1–4 on each of the five criteria below.
- **4** is excellent: it would survive a design director's review unchanged.
- **3** is good: ship it, with only minor nits.
- **2** is weak: it must be fixed.
- **1** is broken.

Reviewers judge the PNG as a projected slide seen from the back of a room, then up close.

**1. Composition**
- 4: content is anchored to the grid. Edges align to shared lines. The frame is filled with intent: either balanced, or deliberately asymmetric with meaningful negative space. The eye lands on one clear focal point.
- 3: grid-anchored and balanced, with small spacing inconsistencies.
- 2: top-heavy or bottom-empty without intent. Elements float off the grid. The composition is the same as another slide type for no reason.
- 1: overlaps, clipping, or content crammed into a corner by accident.

**2. Hierarchy**
- 4: at least 3 distinct levels (kicker or number, title, body or label) that read in order within one second of squinting. Size steps are clearly modular, and weight and colour reinforce them.
- 3: a clear title-body split plus one supporting device.
- 2: title and body compete. Labels are as loud as values. Supporting devices are decorative noise.
- 1: no discernible order.

**3. Contrast and legibility**
- 4: all text comfortably legible at projection distance. Graphics read at a glance. Chrome is visible but quiet. Nothing sits on a busy decoration.
- 3: legible throughout, with one marginal element (a thin hairline or a small caption) still readable.
- 2: an element strains: low-contrast marks, text over a pattern, or labels under 22 px.
- 1: unreadable text or invisible data.

The automated AA and 3:1 checks already passed. This criterion judges what the numbers miss.

**4. Family distinctiveness**
- 4: the family is identifiable from this slide alone, and its signature devices (see **Family identity**) are present and well executed.
- 3: identifiable from this slide with its siblings.
- 2: generic. It could be any family recoloured.
- 1: it contradicts the family, for example a glow on a minimal slide or rounded panels in brutalist.

**5. Polish**
- 4: these all hold:
  - titles balanced with no widows;
  - stat values on one line and optically aligned;
  - numerals tabular where they align;
  - quote marks hang;
  - consistent rhythm between blocks;
  - no default browser or Reveal styling visible;
  - none of these AI-default tells:
    - a tracked upper-case eyebrow used as decoration;
    - side-stripe accent borders;
    - identical card grids;
    - gradient text;
    - a grey highlight block;
    - default disc bullets.
- 3: one minor nit.
- 2: several nits, or one obvious tell.
- 1: visibly unfinished.

**Gate:**
- every criterion ≥ 3 on every baseline;
- no P0 or P1 issues;
- the blind triptych test matches ≥ 7 of 8 families.

**Severity:**
- **P0** breaks reading or accessibility.
- **P1** is visibly wrong to any viewer.
- **P2** is a design-quality nit.
- **P3** is a polish suggestion.
