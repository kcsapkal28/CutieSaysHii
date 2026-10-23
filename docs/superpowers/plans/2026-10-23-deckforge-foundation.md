# DeckForge Foundation (Scaffold + Schemas + Catalog) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the DeckForge monorepo and ship `@deckforge/schemas` (every data contract as Zod) and `@deckforge/catalog` (validated loader, integrity checks, contrast maths, compat resolver). All later packages build on these.

**Architecture:** pnpm + Turborepo workspace of TypeScript ESM "internal packages": each package's `exports` point at `src/*.ts`, so there is no per-package build step. Consumers (Vitest, tsx, Next `transpilePackages`) compile TS themselves. `schemas` is pure Zod. `catalog` splits into `parseCatalog` (pure and browser-safe, so the wizard's live preview can use it later) and `loadCatalog` (Node `fs`). `parseCatalog` runs the integrity checks, so a broken catalog fails at startup rather than mid-render.

**Tech Stack:** Node 25, pnpm (latest 10.x), Turborepo 2.x, TypeScript (latest stable, `strict`), Zod **v3** (`zod@^3.25`, default import, *not* `zod/v4`), Vitest (latest), ESLint 9 flat config + typescript-eslint.

**Spec:** `docs/BUILD_PROMPT.md`. This plan covers §7 steps 0–1. See the roadmap at the end for the later plans.

## Global Constraints

- Catalog files in `catalog/` are the single source of truth. No catalog value appears as a string literal outside `catalog/` (§8). Task 7 enforces this mechanically.
- TypeScript `strict: true`, plus `noUncheckedIndexedAccess: true`. ESM only (`"type": "module"`).
- Zod v3 only. Schemas live in `packages/schemas`, and the harness, UI and renderer all share them.
- WCAG AA means a contrast ratio ≥ 4.5. `text`/`textMuted` must pass on both `bg` and `surface`, and every pair in a palette's `contrast` list must pass (§5, `palettes.json` notes).
- `wordsPerSlideMax = min(depth.wordsPerSlideMax, family.tokens.maxWordsPerSlide)` (`compat-matrix.json` → `densityCaps`).
- Three.js is offered only when `family.threeJs !== "never"` AND `motionTemplateId ∈ compat.threeJs.requiresMotion`. It's on by default only when `family.threeJs === "default"`.
- The Assessment interaction mode requires depth ≥ `compat.interactionRules.assessment.minDepth`. Depth order is the key order of `slide-types.json` → `depth`.
- Package names are `@deckforge/<dir>`. Tests live in `packages/<pkg>/test/*.test.ts`.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Someone edits a catalog file and mistypes an id**, e.g. a family's `defaultPalette: "warm-minimalst"`. Expected: `loadCatalog` throws at startup and the error names the file, the JSON path and the bad id. Tested in Task 5 (`rejects a dangling defaultPalette`).
2. **The user picks a palette, then switches style family in the wizard**, leaving a palette the new family doesn't allow. Expected: `validateChoices` reports `palette-not-allowed`, and `defaultsForFamily` gives the replacement. Tested in Task 6.
3. **The Three.js toggle is left on after the user changes motion away from `depth`.** Expected: `validateChoices` reports `threejs-unavailable`. Tested in Task 6.
4. **Assessment mode chosen with `overview` depth.** Expected: `validateChoices` reports `assessment-depth`. Tested in Task 6.
5. **Hex values differ in case or use shorthand** (`#d0253b`, `#fff`) between ThemeSpec, palettes and browser-computed colours. Expected: contrast lookups give identical results. Tested in Task 4 (`normalizeHex`).

---

## File Structure

```
package.json                    # root: workspaces scripts (build/test/lint/typecheck/check:literals)
pnpm-workspace.yaml             # packages/*, apps/*
turbo.json                      # test, lint, typecheck pipelines
tsconfig.base.json              # strict ESM settings shared by all packages
eslint.config.js                # flat config, typescript-eslint
.gitignore                      # node_modules, dist, jobs/, .env, .turbo, *.tsbuildinfo
scripts/check-catalog-literals.ts  # §8 guard (Task 7)
packages/schemas/
  src/brief.ts                  # BriefSpec, Choices
  src/deck.ts                   # Block (11 kinds), Slide, DeckSpec
  src/design.ts                 # ThemeSpec, MotionPlan, InteractionPlan
  src/output.ts                 # RenderManifest, QAReport, Patch
  src/catalog-files.ts          # Zod for each catalog/*.json file
  src/index.ts                  # re-exports schemas + inferred types
packages/catalog/
  src/files.ts                  # CATALOG_FILES name map, Catalog type
  src/parse.ts                  # parseCatalog (pure), CatalogError
  src/load.ts                   # loadCatalog (fs), DEFAULT_CATALOG_DIR
  src/integrity.ts              # checkIntegrity → IntegrityIssue[]
  src/accessors.ts              # getFamily/getPalette/... + UnknownIdError
  src/contrast.ts               # normalizeHex, contrastRatio, passesAA
  src/compat.ts                 # resolver: allowed*, defaults, validateChoices, caps, golden
  src/index.ts
catalog/*.json                  # data; three fixes in Task 5
```

---

### Task 1: Workspace scaffold

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `eslint.config.js`, `.gitignore`, `packages/schemas/{package.json,tsconfig.json,src/index.ts,test/smoke.test.ts}`, `packages/catalog/{package.json,tsconfig.json,src/index.ts,test/smoke.test.ts}`

**Interfaces:**
- Produces: root scripts `pnpm test`, `pnpm lint`, `pnpm typecheck` (all via `turbo run`). Each package has `"exports": { ".": "./src/index.ts" }` and scripts `test` (`vitest run`), `lint` (`eslint .`) and `typecheck` (`tsc --noEmit`). `@deckforge/catalog` depends on `@deckforge/schemas` via `workspace:*`.

- [ ] **Step 1: Install pnpm.** Run `npm i -g pnpm@10`, then `pnpm -v`. Expected: `10.x`. (Node 25 no longer ships corepack.)
- [ ] **Step 2: `git init`** at the repo root (`CutieSaysHii/`). Write `.gitignore` with `node_modules/ dist/ .turbo/ jobs/ .env .env.local *.tsbuildinfo .DS_Store`.
- [ ] **Step 3: Write the root config files.** `tsconfig.base.json`: `target ES2023`, `module/moduleResolution NodeNext`, `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes: false`, `resolveJsonModule`, `verbatimModuleSyntax`, `skipLibCheck`. Each package `tsconfig.json` extends it with `include: ["src","test"]`.
- [ ] **Step 4: Write a smoke test in each package**: `expect(1).toBe(1)` in `test/smoke.test.ts`. This proves the Vitest wiring works.
- [ ] **Step 5: Install and verify.** Run `pnpm install && pnpm test && pnpm lint && pnpm typecheck`. Expected: 2 test files pass, and lint and typecheck exit 0.
- [ ] **Step 6: Commit** everything, including `catalog/` and `docs/`, as `chore: scaffold pnpm/turbo workspace with schemas and catalog packages`.

---

### Task 2: Pipeline contract schemas (`@deckforge/schemas`)

**Files:**
- Create: `packages/schemas/src/{brief,deck,design,output}.ts`
- Modify: `packages/schemas/src/index.ts`
- Test: `packages/schemas/test/contracts.test.ts`

**Interfaces:**
- Produces: Zod schemas + `z.infer` types exported with the same names. A schema `FooSchema` exports type `Foo`. `DepthSchema = z.enum(["overview","standard","deep"])` is exported separately (type `Depth`).
  - `questionCount` on Choices extends the spec's Choices (§2) to carry Step 4's check-question count.
  - `BriefSpecSchema`: `{ topic: string 3..120, brief: string 20..1500, audience: "general"|"technical"|"executive"|"students", durationMin: 5|10|20|30, language: "en" }`. Trim strings before the length checks.
  - `ChoicesSchema`: `{ depth: "overview"|"standard"|"deep", styleFamilyId, paletteId, typeFamilyId, motionTemplateId, interactionModeId: string(min 1), threeJs: boolean, questionCount?: int }`. Catalog-dependent rules live in Task 6, not here.
  - `BlockSchema`: a discriminated union on **`type`** over the 11 block kinds, with shapes taken from `slide-types.json` → `blocks`. Chart keeps its own `kind` field (`bar|line|area|donut`), which is why the discriminator is `type`. Refinements: Quiz `answerIndex` must be in `[0, options.length)`; every Chart series `values.length === labels.length`.
  - `SlideSchema`: `{ id: string(min 1), type: string(min 1), title?: string, body: Block[], notes: string, emphasisTargets: string[] }`.
  - `DeckSpecSchema`: `{ title, subtitle: string, slides: Slide[] (min 1) }`. Refinement: slide ids are unique.
  - `ThemeSpecSchema`: `{ familyId, paletteId, typeFamilyId: string, roles: Record<"bg"|"surface"|"text"|"textMuted"|"primary"|"accent"|"border", Hex>, type: { display: FontRef, body: FontRef, mono: FontRef, scale: number, bodyLineHeight: number, displayLineHeight: number }, radius, borderWidth, shadow, texture: string, gradients: boolean, imageTreatment: string, threeJs: boolean }`. Here `Hex = /^#[0-9A-Fa-f]{6}$/` and `FontRef = { font: string, weights: int[], letterSpacing?: number }`.
  - `MotionPlanSchema`: `{ templateId: string, reducedMotion: string(min 1), slides: Record<slideId, { transition, enter, emphasis, exit: string, easing?: string, overrideReason?: string }> }`.
  - `InteractionPlanSchema`: `{ modeId: string, slides: { slideId: string, components: { componentId: string, blockIndex?: int ≥0, props: Record<string, unknown> }[] }[] }`.
  - `PatchSchema`: `{ slideId: string, op: "shortenText"|"splitSlide"|"swapLayout"|"dropBlock", payload: Record<string, unknown> }`.
  - `QAReportSchema`: `{ pass: boolean, slides: { id, overflow: boolean, consoleErrors: string[], contrastFails: { selector: string, fg: Hex, bg: Hex, ratio: number }[], wordCount: int ≥0 }[], patches: Patch[] }`.
  - `RenderManifestSchema`: `{ jobId: string, entry: string, slideIds: string[], assets: { path: string, bytes: int }[], totalBytes: int, threeJs: boolean }`.

- [ ] **Step 1: Write the failing tests** in `contracts.test.ts`:
  - `BriefSpec accepts a minimal valid brief`: `{topic:"Solar", brief:"x".repeat(20), audience:"general", durationMin:10, language:"en"}` parses.
  - `BriefSpec rejects topic of 2 chars, brief of 1501 chars, durationMin 15`: three `safeParse(...).success === false`.
  - `Block rejects Quiz with answerIndex === options.length`.
  - `Block rejects Chart whose series length differs from labels`.
  - `Block accepts all 11 kinds`: one valid fixture per kind; `BlockSchema.options.length === 11`.
  - `DeckSpec rejects duplicate slide ids`.
  - `ThemeSpec rejects roles.bg = "#FFF"` (6-digit hex required in the contract).
  - `Patch rejects op "rewrite"`.
- [ ] **Step 2: Run** `pnpm --filter @deckforge/schemas test`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** the schemas above in the four files and re-export them from `index.ts`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** as `feat(schemas): pipeline contracts (BriefSpec…RenderManifest)`.

---

### Task 3: Catalog file schemas

**Files:**
- Create: `packages/schemas/src/catalog-files.ts`
- Modify: `packages/schemas/src/index.ts`
- Test: `packages/schemas/test/catalog-files.test.ts`

**Interfaces:**
- Produces: `DesignStylesFileSchema, PalettesFileSchema, TypeFamiliesFileSchema, MotionTemplatesFileSchema, InteractionsFileSchema, SlideTypesFileSchema, CompatMatrixFileSchema`, plus the inferred types (`DesignStylesFile`, …) and element types `StyleFamily, Palette, TypeFamily, MotionTemplate, InteractionMode, InteractionComponent, SlideType`.
- All objects use `.strict()` (unknown keys are errors). Each file has `version: string` and `notes: string`. `design-styles.json` may also have `$schema`.
- The shapes mirror the current files. Key points:
  - `family.threeJs` is `"never"|"optional"|"default"`.
  - `palette.mode` is `"light"|"dark"`. `palette.roles` has exactly the 7 roles. `palette.contrast` is `[Hex, Hex][]`.
  - `slideType.limits` is `Record<string, number | [number, number]> | null`. `required` is optional `"first"|"last"|"penultimate-or-last"`. Optional `requiredWhen`, `onlyIn: string[]`, `renderer`, `note`.
  - `motion.bySlideType` is `Record<string, Partial<{transition, enter, emphasis, exit, easing}>>`.
  - `component.props` is `Record<string, unknown>`. `mode.options` is optional.
  - `compat.golden[]` is `{ family, motion, interaction, palette: string, threeJs?: boolean }`.

- [ ] **Step 1: Write the failing tests:**
  - `each catalog file parses with its schema`: read `../../../catalog/<file>` with `fs` and expect `.parse` not to throw, for all 7 files.
  - `rejects an unknown key on a family`: clone family 0, add `foo: 1`, expect failure.
  - `rejects palette.mode "dim"`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** `catalog-files.ts`.
- [ ] **Step 4: Run.** Expected: PASS. If a real file fails because of an optional field the summary above missed, add that field to the schema. Don't edit the data to fit.
- [ ] **Step 5: Commit** as `feat(schemas): zod schemas for catalog files`.

---

### Task 4: Contrast utilities

**Files:**
- Create: `packages/catalog/src/contrast.ts`
- Test: `packages/catalog/test/contrast.test.ts`

**Interfaces:**
- Produces: `normalizeHex(input: string): string`, which returns uppercase `#RRGGBB`, expands `#RGB`, and throws on anything else. Also `contrastRatio(a: string, b: string): number` (WCAG 2.x relative luminance, symmetric) and `AA_RATIO = 4.5` with `passesAA(fg: string, bg: string): boolean` (≥ `AA_RATIO`). Integrity rule 10 (Task 5) and later the renderer's theme compile use these.

- [ ] **Step 1: Write the failing tests:**
  - `black on white is 21`: `contrastRatio("#000","#FFFFFF")` is close to `21` within 2 decimals.
  - `ratio is symmetric`.
  - `normalizeHex("#d0253b") === "#D0253B"` and `normalizeHex("#fff") === "#FFFFFF"`. `normalizeHex("red")` throws.
  - `fixed palettes pass`: `passesAA("#FBF3E4","#60578D")` and `passesAA("#F5F2EB","#D0253B")` are true.
  - `old values fail`: `passesAA("#FBF3E4","#786FA6")` is false (4.12).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** sRGB channel `c ≤ 0.03928 ? c/12.92 : ((c+0.055)/1.055)^2.4`; L = 0.2126R + 0.7152G + 0.0722B; ratio = (L1+0.05)/(L2+0.05).
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** as `feat(catalog): WCAG contrast utilities`.

---

### Task 5: Catalog loader + integrity checks (+ data fixes)

**Files:**
- Create: `packages/catalog/src/{files,parse,load,integrity,accessors}.ts`
- Modify: `packages/catalog/src/index.ts`, `catalog/motion-templates.json`, `catalog/design-styles.json`, `catalog/interactions.json`
- Test: `packages/catalog/test/load.test.ts`, `packages/catalog/test/integrity.test.ts`

**Interfaces:**
- Consumes: catalog file schemas (Task 3), `passesAA` (Task 4).
- Produces:
  - `CATALOG_FILES = { styles: "design-styles.json", palettes: "palettes.json", types: "type-families.json", motion: "motion-templates.json", interactions: "interactions.json", slideTypes: "slide-types.json", compat: "compat-matrix.json" } as const`, and `type CatalogKey = keyof typeof CATALOG_FILES`.
  - `type Catalog = { styles: DesignStylesFile; palettes: PalettesFile; types: TypeFamiliesFile; motion: MotionTemplatesFile; interactions: InteractionsFile; slideTypes: SlideTypesFile; compat: CompatMatrixFile }`.
  - `class CatalogError extends Error { file: string; issues: { path: string; message: string }[] }`.
  - `parseCatalog(raw: Record<CatalogKey, unknown>): Catalog` validates every file, then runs `checkIntegrity`. It throws `CatalogError` on the first file with problems, or with all integrity issues (`file` = the file the bad reference lives in).
  - `DEFAULT_CATALOG_DIR`: `fileURLToPath(new URL("../../../catalog/", import.meta.url))`. `loadCatalog(dir = process.env.DECKFORGE_CATALOG_DIR ?? DEFAULT_CATALOG_DIR): Promise<Catalog>`.
  - `checkIntegrity(c: Catalog): IntegrityIssue[]`, where `IntegrityIssue = { file: string; path: string; message: string }`.
  - `class UnknownIdError extends Error { kind: string; id: string }`. Accessors `getFamily(c, id)`, `getPalette`, `getTypeFamily`, `getMotionTemplate`, `getInteractionMode`, `getComponent`, `getSlideType` return the element or throw.
- `checkIntegrity` rules. Each rule is one check, with its message naming the offending value:
  1. A family's `defaultPalette ∈ allowedPalettes`, `defaultType ∈ allowedTypes`, and every allowed id exists.
  2. Every allowed palette's `mode` obeys `compat.paletteModeRules[familyId]` (`"dark only"` / `"light only"`).
  3. Every allowed type family's `pairsWith` includes the family. Every `pairsWith` id is a family.
  4. `compat.allowedMotion` has exactly one key per family. Every motion id exists. A family's `defaultMotion ∈ allowedMotion[family]`.
  5. Each motion template's `defaults` / `bySlideType` / `timing.easing` values are in `vocabulary` for their key. `bySlideType` keys are slide-type ids.
  6. Each mode's `components` exist. Each component's `binds` entries are `"*"` or a block name in `slideTypes.blocks`.
  7. Every slide type's `accepts` entries are block names. `onlyIn` entries are interaction mode ids. Hotspot-disallowed ids in `compat.interactionRules` are slide-type ids.
  8. Every `compat.golden` entry resolves: family exists, motion allowed for it, palette allowed for it, interaction mode exists. If `threeJs: true`, the motion is in `threeJs.requiresMotion` and the family isn't `"never"`.
  9. `compat.interactionRules.assessment.minDepth` is a key of `slideTypes.depth`.
  10. Contrast (uses Task 4's `passesAA`): `text` and `textMuted` pass on `bg` and `surface`, and every `contrast` pair passes.

- [ ] **Step 1: Write the failing tests:**
  - `load.test.ts`:
    - `loads the real catalog`: `await loadCatalog()` returns 8 families, 14 palettes, 10 type families, 6 motion templates, 3 modes, 12 components and 16 slide types.
    - `rejects a dangling defaultPalette`: clone the raw JSON, set family 0's `defaultPalette` to `"warm-minimalst"`, expect `parseCatalog` to throw `CatalogError` with `file === "design-styles.json"` and a message containing `warm-minimalst`.
    - `getPalette throws UnknownIdError for "nope"`.
  - `integrity.test.ts`:
    - `real catalog has zero integrity issues`: `checkIntegrity(await loadCatalog())` equals `[]`.
    - One mutation test per rule 1–10 (e.g. `flags a dark palette on a light-only family`), each asserting a single issue with the expected `file`.
- [ ] **Step 2: Run** `pnpm --filter @deckforge/catalog test`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** `files.ts`, `parse.ts`, `load.ts`, `integrity.ts` and `accessors.ts`.
- [ ] **Step 4: Run.** Expected: all mutation tests PASS. `real catalog has zero integrity issues` FAILS with exactly these three issues, which are the known data bugs:
  - rule 5: `pop.bySlideType.stat.easing "back.out(2)"` is not in the vocabulary
  - rule 2: `brutalist` (light only) allows dark `technical-slate` and `tokyo-grid`
  - rule 6: `df-score` binds `"Summary"`, which isn't a block
- [ ] **Step 5: Fix the data** (decisions confirmed with the user before execution):
  - `motion-templates.json`: add `"back.out(2)"` to `vocabulary.easing`.
  - `design-styles.json`: brutalist `allowedPalettes` becomes `["brutal-pop", "bauhaus-primary"]`. Both are light and high-contrast, which leaves two choices.
  - `interactions.json`: df-score `binds` becomes `["*"]`, and add the placement rule `"df-score appears only on the summary slide in assessment mode."`.
  - Bump each edited file's `version` to `1.0.1`.
- [ ] **Step 6: Run.** Expected: all PASS.
- [ ] **Step 7: Commit** as `feat(catalog): validated loader, integrity checks; fix 3 catalog conflicts`.

---

### Task 6: Compat resolver

**Files:**
- Create: `packages/catalog/src/compat.ts`
- Test: `packages/catalog/test/compat.test.ts`

**Interfaces:**
- Consumes: `Catalog`, accessors, `Choices`/`Depth` types from `@deckforge/schemas`.
- Produces:
  - `depthOrder(c): Depth[]`: keys of `slideTypes.depth`, in order.
  - `allowedMotionIds(c, familyId): string[]`, `allowedPaletteIds(c, familyId): string[]`, `allowedTypeIds(c, familyId): string[]`.
  - `motionDisabledReason(c, familyId, motionId): string | null`: `null` if allowed, else `"Not available with <family.name>"` (the §5 tooltip copy).
  - `threeJsToggleVisible(c, familyId, motionId): boolean` and `threeJsDefault(c, familyId, motionId): boolean`, following the Global Constraints rule.
  - `defaultsForFamily(c, familyId): { paletteId; typeFamilyId; motionTemplateId; threeJs: boolean }`.
  - `wordsPerSlideMax(c, depth, familyId): number` and `slideCountRange(c, depth): [number, number]`.
  - `type ChoiceIssueCode = "unknown-id" | "palette-not-allowed" | "type-not-allowed" | "motion-not-allowed" | "threejs-unavailable" | "assessment-depth" | "question-count"`. `validateChoices(c, choices: Choices): { code: ChoiceIssueCode; field: keyof Choices; message: string }[]`.
    - `question-count` applies when the mode has `options.questionCount` and `questionCount` is missing or not in `choices`. It also applies when `questionCount` is set on a mode without that option.
    - `assessment-depth` uses `compat.interactionRules[modeId].minDepth` generically, not just for `"assessment"`.
  - `goldenChoices(c): Choices[]`: one per `compat.golden` entry, with `depth: "standard"`, `typeFamilyId` = family default, `threeJs` = entry value ?? `threeJsDefault`, and `questionCount` = the mode's `options.questionCount.default` when present.

- [ ] **Step 1: Write the failing tests.** Use ids pulled from the loaded catalog where possible, e.g. `c.styles.families.find(f => f.threeJs === "never")`:
  - `wordsPerSlideMax(standard, minimal) === 35`, i.e. min(40, 35). `wordsPerSlideMax(deep, retro) === 40`, i.e. min(45, 40).
  - `slideCountRange(overview)` equals `[6, 8]`.
  - `motionDisabledReason(brutalist, "calm") === "Not available with Brutalist"`. `motionDisabledReason(brutalist, "kinetic")` is `null`.
  - `threeJsToggleVisible(glass-soft, depth)` is true. `(glass-soft, calm)` is false. `(minimal, any)` is false. `threeJsDefault(glass-soft, depth)` is true. `(neon, depth)` is false.
  - `palette from previous family is rejected`: minimal's defaults with `paletteId: "brutal-pop"` give `[{code:"palette-not-allowed", field:"paletteId"}]`.
  - `stale threeJs toggle is rejected`: glass-soft + calm + `threeJs: true` gives `threejs-unavailable`.
  - `assessment with overview depth is rejected`: gives `assessment-depth`.
  - `assessment requires questionCount from catalog choices`: missing gives `question-count`, `3` gives `question-count`, `4` gives `[]`.
  - `unknown family id gives unknown-id`, and does not throw.
  - `all 9 golden choices validate clean`: `goldenChoices(c)` has length 9, and every entry gives `validateChoices(...)` equal to `[]`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** `compat.ts`. `validateChoices` checks `unknown-id` first and skips dependent checks for a field whose id is unknown.
- [ ] **Step 4: Run** `pnpm test`. Expected: PASS.
- [ ] **Step 5: Commit** as `feat(catalog): compat resolver and choice validation`.

---

### Task 7: Catalog-literal guard (§8)

**Files:**
- Create: `scripts/check-catalog-literals.ts`, `scripts/check-catalog-literals.test.ts`
- Modify: root `package.json` (add `"check:literals": "tsx scripts/check-catalog-literals.ts"`; `lint` runs `turbo run lint && pnpm check:literals`), plus root devDependencies `tsx` and `vitest`.

**Interfaces:**
- Consumes: `loadCatalog`.
- Produces: `findCatalogLiterals(c: Catalog, files: { path: string; text: string }[]): { path: string; line: number; value: string }[]`. The CLI exits 1 and prints `path:line value` for each hit.
- **Forbidden values:** family ids, palette ids, type-family ids, font names, and palette hex values (case-insensitive). Motion-template and interaction-mode ids are excluded on purpose, because `none`, `calm`, `linear` and `pop` collide with ordinary code and CSS.
- **What counts as a hit:** a value inside a quoted string literal (`'`, `"`, `` ` ``) exactly, or a hex anywhere in the text.
- **Files scanned:** `apps/**` and `packages/**` with extensions `.ts .tsx .js .mjs .css .hbs`. Skipped: `node_modules`, `dist`, `.next`, `**/test/**`, `**/*.test.*`, `**/fixtures/**`, `packages/schemas/src/catalog-files.ts`.

- [ ] **Step 1: Write the failing tests:** `flags 'warm-minimalist' in a quoted literal`, `flags #d0253b case-insensitively`, `ignores 'calm'`, `ignores the unquoted identifier warmMinimalist`.
- [ ] **Step 2: Run** `pnpm vitest run scripts`. Expected: FAIL.
- [ ] **Step 3: Implement** the script.
- [ ] **Step 4: Run** the tests, then `pnpm lint`. Expected: tests PASS and the repo has zero hits.
- [ ] **Step 5: Commit** as `chore: guard against catalog literals outside catalog/`.

---

## Roadmap: later plans (one per subsystem, written when this one lands)

| Plan | Spec § | Notes carried forward |
|---|---|---|
| 2. Renderer | §6, §7.2 | Theme compile uses `passesAA`. Text only via `text`/`textMuted` on `bg`/`surface` or listed pairs. Fonts self-hosted woff2. Output ≤2.5 MB (≤4 MB with Three.js). |
| 3. Harness | §1a, §3, §4, §7.3 | `packages/harness/llm.ts` (only SDK client) and `.env.example` with §1a defaults. Preflight `GET {LLM_BASE_URL}/v1/models`. **First task: spike strict tool use through the proxy with `claude-sonnet-5-5`, and time one standard deck.** |
| 4. QA | §7.4 | Playwright plus axe. Agent C loop ≤3. |
| 5. Wizard | §5, §7.5 | Uses `parseCatalog` in the browser. `motionDisabledReason` for disabled cards. Spike Tailwind v4 per-theme compile speed vs. CSS-variables-only preview. |
| 6. Progress/Result | §7.6 | SSE from harness event bus. |
| 7. Export + edits | §7.7 | Design tweaks re-run from `design` only. Test that Agent A isn't called. |
| 8. CI | §4, §7.8 | 9 golden runs (`goldenChoices`) with one brief each in `fixtures/golden/`, against `api.anthropic.com`. |
