# DeckForge Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `@deckforge/harness` sequences Agent A (content) → Agent B (design) → render → QA (→ Agent C patch loop ≤ 3) as pure, typed, persisted stages, and runs them from the CLI (`pnpm forge run|rerun|resume`). The whole pipeline, including the 9 golden combinations and one patch-loop golden, runs offline and deterministically against a FakeLlm. An opt-in live test runs it against the local `claude-openai` proxy (spec §7 step 3).

**Architecture:** hexagonal.
- **Kernel** (`src/kernel/`, pure, no `node:*` I/O and no `node:crypto`):
  - contracts, the error taxonomy, the `StageEvent` union, the event bus, deadline, token meter, input hashing, issues;
  - the port interfaces (`LlmPort`, `RendererPort`, `QaPort`, `Store` with fenced `JobSession`s, `Clock`, `Logger`, `IdSource`).
- **Stages** (`src/stages/`): each is a `StageDef` with:
  - a pure async `run(input, ctx)`;
  - Zod input/output schemas;
  - a per-attempt timeout and a validation-retry policy;
  - `dependsOn` (used for rerun checks);
  - a `fingerprint`, recorded as `inputHash` for audit and for rerun choice checks;
  - `select`/`reduce` over an immutable `PipelineState`;
  - a typed `summarize` for the progress UI.

  Stages reach the outside world only through `ctx`. There is **no stage-output caching**: every run executes its stages.
- **Executor** (`src/stages/execute.ts`): the only place stage I/O happens. It handles deadlines, cancellation (it waits for an abandoned run to settle), artifacts, the DB row and events. Every write goes through the job's fenced `JobSession`.
- **Pipeline** (`src/pipeline/`):
  - `runJob` folds the stages over state and maintains the job's **accepted documents** (`accepted/deck.json`, `accepted/design.json`, content stored inline). `rerun` and `resume` start from these.
  - A `p-queue` `JobQueue` (concurrency 2).
  - Owner-fenced jobs with a heartbeat.
- **Adapters** (`src/adapters/`, `src/llm.ts`): node:sqlite + Drizzle, filesystem artifacts, the renderer (staged `dist` promotion), the Anthropic SDK and the system clock. They are wired only in `src/node.ts`.
- **LLM output** arrives through tool use, strict or non-strict per tool (see Global Constraints). Wire schemas are compiled from Zod per job, with catalog-derived enums, by a single walk that yields the JSON Schema and a schema-directed `normalize`. The output then passes Zod and deterministic catalog-aware validators, which drive ≤ 2 retries.
- **ThemeSpec is never an LLM output.** The render stage resolves it from Choices with `resolveTheme`, so palette, type-family and threeJs changes are render-only reruns that call no LLM.

**Tech Stack:**
- `@anthropic-ai/sdk` **^1.2.0**.
- `drizzle-orm` **0.45.4** with the `sqlite-proxy` driver over built-in **`node:sqlite`**. Stable Drizzle has no `node-sqlite` driver (it is beta-only). This needs no native module and no pnpm `allowBuilds` change.
- `drizzle-kit` **0.31.11** (dev).
- `p-queue` **^10.0.0**.
- `zod` ^3.25.76.
- `node:util` `parseArgs`, `process.loadEnvFile`.
- Vitest 4, `tsx` (the CLI runner).

**Spec:** `docs/BUILD_PROMPT.md`: §0, §1/§1a, §2, §3, §4, §5 (progress UI needs), §7.3, §8. Builds on the foundation and renderer plans (`2026-10-23-*.md`). The review findings (`.superpowers/sdd/2026-10-23-deckforge-renderer/harness-plan-review.md`) and the follow-up decisions N1–N4 are mapped in the Self-review.

**Proxy:** `~/Documents/Cursor-Projects/claude-openai`, port 4001. Task 1 adds to it:
- per-request retry control;
- rate-limit header forwarding;
- upstream abort on disconnect;
- an `x-proxy-controls: 1` marker header.

The controller merges Task 1 to the proxy's `main` after review. The harness preflight refuses a proxy without the marker.

## Global Constraints

- **LLMs write JSON, never HTML** (§0.1). Every agent output arrives as a tool call (`emit_deck`, `emit_design`, `emit_patches`). Each tool declares `strict: boolean`, and the spike (Task 3, `docs/superpowers/spikes/2026-10-24-strict-tools-via-proxy.md`) fixed these values: **`emit_deck: false`** (the server rejects its grammar as too large), **`emit_design: true`**, **`emit_patches: false`** (the server counts more than 16 union params). Non-strict tools still send the full `compileWireSchema` JSON Schema as `input_schema`. Strict tools must pass `assertUnionBudget`. Task 8 must add an opt-in live test (`DECKFORGE_LIVE=1`) that sends the final `emit_design` tool with `strict:true` and `max_tokens` 32 through the proxy and asserts no 400. It must also assert `assertUnionBudget([designWire])` locally. If either fails, `emit_design` becomes non-strict and the plan's Global Constraints are updated. It goes through `normalize` → Zod → `src/validate/*`. Invalid output is fed back as an `is_error` `tool_result`, with **at most 2 retries** (3 attempts).
- **One SDK client** (§0.6):
  - Only `packages/harness/src/llm.ts` imports `@anthropic-ai/sdk`, and only `src/node.ts` calls `createLlmClient`.
  - `localhost:4001` appears in `src/` only in `src/env.ts`.
  - The spike's script is never committed.
  - The architecture test enforces this.
- **Request rules**:
  - Never send `temperature`/`top_p`/`top_k`, and never force `tool_choice`. Use `{type:"auto"}`, the tool's own `strict` flag, a prompt naming the tool, and a check that a call was made.
  - Leave thinking at its default and set `output_config.effort` per agent. Spike defaults:
    - `CONTENT_EFFORT=medium`. A standard deck took ~18–20 s and ~2.5k output tokens. A single `low` sample was not faster.
    - `PROMPT_CACHE_EFFECTIVE=true`, with 3275 cached tokens read on a repeat.
    - `REFUSAL_FALLBACK_DEFAULT=true`.
  - Speaker notes often came back under the depth minimum (4/9 to 11/12 slides short). Agent A's prompt must state the per-depth notes word range explicitly, and the `notes-length` validator's feedback must name each short slide.
  - Use non-streaming requests with `max_tokens` ≤ 16000 and top-level `cache_control: {type:"ephemeral"}` (Anthropic prompt caching, unrelated to stage caching).
- **Proxy controls**: `LLM_PROXY_CONTROLS` defaults on whenever `LLM_BASE_URL`'s origin isn't `https://api.anthropic.com`.
  - **When on**, every request sends `x-proxy-max-retries: 0`, and preflight **fails** if the response lacks `x-proxy-controls: 1`.
  - **When off** and the URL isn't Anthropic, preflight only logs a warning that proxy retries are hidden.
- **Models come from env only** (`/^claude-[a-z0-9-]+$/`). Defaults: `claude-sonnet-5-5` for content/design, `claude-haiku-5-5` for fast.
- **Preflight message** (exact, §1a): `LLM proxy not reachable at <url> — start it with: cd ~/Documents/Cursor-Projects/claude-openai && bash start.sh`.
- **Timeouts (ms) apply per LLM attempt**: `content 90_000`, `design 45_000`, `render 30_000`, `qa 60_000`, `patch 45_000`. Each stage also has an overall cap of `timeoutMs × (1 + retry.validation)`.
  - Rate-limit backoff extends both deadlines, by up to `MAX_BACKOFF_MS = 120_000` per stage, and is reported as `backoffMs`.
  - **Spec deviation:** §4's "content 90 s" bounds each attempt, because three attempts can't fit in 90 s.
- **QA loop**: at most **3** patch rounds (`MAX_PATCH_LOOPS = 3`), each followed by render + QA. Remaining failures end the job as `qa_failed`.
- **Concurrency** 2 (`p-queue`). Every job has its own `AbortController`.
- **Cost guard**: `DECKFORGE_TOKEN_BUDGET` (default `250000`) caps one job invocation (input + output + cache read + cache write). It is checked before and after every LLM call. `job.usage` accumulates across invocations. Aborted calls record `usageKnown: false`.
- **No stage caching (N2)**:
  - Every `run`, `rerun` and `resume` executes each stage it reaches.
  - Each stage records `inputHash = hashOf({ stage, version, fingerprint })`. The fingerprint is the built LLM request (model, system, tool schema, effort, `maxTokens`, first user message) for agents, and the stage input for render/QA.
  - `inputHash` is used for audit and by `checkRerunChoices`.
- **Accepted documents** (`jobs/<id>/accepted/{deck,design}.json`): the job's current truth, with **content stored inline**. They are written by `runJob` after content, design and every patch. `source` is provenance only, and pruning never touches `accepted/`.
- **Dist safety**:
  - Builds go into `jobs/<id>/dist.tmp-<iteration>-<hex>`.
  - At the start of each render, stale `dist.tmp-*`/`dist.old-*` dirs are removed.
  - `dist` is promoted by rename only if `!signal.aborted`.
  - The renderer honours the AbortSignal (Task 4).
  - The executor waits up to `SETTLE_GRACE_MS = 15_000` for an abandoned run to settle.
- **Events**: each event is appended (fenced) and then published as `{ seq, event }`. Subscribers can replay from `afterSeq` with no gap. Stages emit `start`, `progress`, `retry`, `warning`, `done` (with `backoffMs` and a typed `summary`) and `error`.
- **Ownership fencing (N1)**:
  - Jobs carry `ownerId` + `heartbeatAt` (`HEARTBEAT_MS = 5_000`, `STALE_AFTER_MS = 30_000`).
  - **Every job, stage and event write is conditional on `owner_id`** (through a `JobSession`). A write that affects 0 rows throws `CancelledError("ownership lost")`.
  - A heartbeat affecting 0 rows aborts the job the same way.
  - Filesystem artifact writes are preceded by a fenced ownership check. The remaining check-then-write window is accepted and documented.
  - `claim` refuses a job with a fresh heartbeat or one in this process's queue.
  - `rerun`/`resume` of a queued or running job fails with `InputError("job <id> is <status> (owner <ownerId>); cancel it or wait")`.
- **`node:sqlite` is synchronous**: `busy_timeout=5000` can block the event loop for up to 5 s under cross-process write contention. That is acceptable, because writes are single small rows; don't raise it.
- **Pure layers**:
  - no top-level `let`/`var`;
  - `process.env` only in `src/env.ts`, `src/node.ts` and `src/cli/main.ts`;
  - `src/{kernel,wire,fakes,validate,agents,design,patches,qa,stages,pipeline}/**` import no `node:fs*`, `node:child_process`, `node:crypto`, `src/adapters/**`, `src/llm.ts`, `src/env.ts` or `*/node` entries;
  - the only workspace imports allowed there are `@deckforge/schemas`, `@deckforge/catalog`, and **exactly** `@deckforge/renderer/hash` (the pure `sha256Hex`, M4).

  The architecture test resolves import specifiers to absolute paths.
- **Catalog is the source of truth** (§8). Rule data comes from:
  - `slide-types.json`;
  - `interactions.json`, including the per-component `disallowedSlideTypes`;
  - `compat-matrix.json` → `designRules`.

  `pnpm check:literals` stays at 0.
- **CLI runner is `tsx`**: native type stripping rejects TS parameter properties, which workspace packages use. A spawn test runs the real CLI path under tsx with a diagram slide.
- **Offline by default**: `pnpm test` makes no network calls. Live tests need `DECKFORGE_LIVE=1`.
- **Out of scope**: the export stage (Plan 7), Playwright QA (Plan 4), SSE routes (Plan 6), the Step 1 hint (Plan 5).
- **Package conventions**: `@deckforge/harness`, ESM, `exports { ".": "./src/index.ts", "./node": "./src/node.ts" }`. Only Tasks 5 and 13 edit `src/index.ts`.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **The proxy isn't running, is an old build without controls, the key is wrong, or the account is out of quota.** Expected:
   - an exact, actionable message on stderr, exit 1;
   - the job is `failed` with kind `llm_unreachable`/`llm_config`/`llm_auth`/`llm_quota`, and zero stage rows exist;
   - quota is never retried.

   → Task 7 preflight and quota tests, Task 13 `preflight failure fails the job before any stage`, Task 14 `prints the preflight message and exits 1`.
2. **A deck renders with a silently degraded block.** Expected:
   - every manifest warning becomes a `stage:warning` event that the CLI prints;
   - the golden suite fails on any warning except an explicitly pending component id;
   - the tsx spawn test proves diagrams arrive as SVG.

   → Task 12 `render stage emits each manifest warning`, Task 14 `forge run under tsx renders the diagram as svg`, Task 15 warnings assertion.
3. **Ctrl-C mid-stage (including mid-render), cancelling a queued job, or a second process taking over a job.** Expected:
   - status `cancelled`;
   - no later stage starts and no row is left `running`;
   - Chromium is closed and the previous `dist/` is intact;
   - a process that lost ownership writes nothing more.

   → Task 4 abort tests, Task 10 `cancel is not reported as timeout`/`waits for the abandoned run to settle`, Task 12 promotion tests, Task 9/13 ownership tests.
4. **A rate-limit storm.** Expected: every 429/529 surfaces with `retry-after` (proxy retries off); each wait emits `stage:retry{reason:"rate-limit"}` and adds to `backoffMs`; the attempt deadline isn't consumed; after 4 retries the call fails as `llm_transient`.

   → Task 1 header forwarding, Task 7 retry tests, Task 10 `extendDeadline postpones the timeout`.
5. **Rerun or resume after a patched run, with a palette change, or with an upstream document missing or corrupt.** Expected:
   - patched text is never reverted;
   - a palette change re-renders without any LLM call;
   - a missing/corrupt accepted doc gives an `InputError` naming the file, exit 2;
   - a choice change that affects content or design is refused for a later `--from`.

   → Task 13 rerun/resume tests.

---

## File Structure

```
~/Documents/Cursor-Projects/claude-openai (branch feature/deckforge-passthrough-controls → merged to main by the controller)   # Task 1
  lib/anthropic-passthrough.js, api-backend.js, test/anthropic-passthrough.test.js, test/fetch-with-retry.test.js
.env.example                                   # Task 7
package.json                                   # + "forge" script (Task 14)
catalog/compat-matrix.json, catalog/interactions.json, packages/schemas/src/catalog-files.ts, packages/catalog/src/integrity.ts   # Task 8
packages/renderer/                             # Task 4: AbortSignal, tsx-safe sanitiser, "./hash" export
fixtures/golden/<n>.brief.json, <n>.cassette.json, 1.patch-loop.cassette.json   # Task 15
docs/superpowers/spikes/2026-10-24-strict-tools-via-proxy.md                    # Task 3
packages/harness/
  package.json, tsconfig.json, vitest.config.ts                # Task 2
  drizzle.config.ts, drizzle/                                  # Task 9
  prompts/{content,design}.v1.md (Task 11), patch.v1.md (Task 12)
  scripts/record-golden.ts                                     # Task 15
  src/wire/schema.ts                                           # Task 2
  src/kernel/{contracts,errors,events,bus,deadline,meter,hash,issues,ports,stage,llm-port}.ts   # Task 5
  src/fakes/{llm,recording}.ts                                 # Task 6
  src/llm.ts, src/env.ts                                       # Task 7
  src/validate/{words,rules,deck,design,design-wire}.ts        # Task 8
  src/adapters/sqlite/{schema,db,repos,session}.ts, src/adapters/fs-artifacts.ts   # Task 9
  src/stages/execute.ts                                        # Task 10
  src/agents/{invoke-tool,messages,deck-tool,design-tool}.ts, src/design/{skeleton,assemble}.ts,
  src/stages/{content,design}.ts, src/adapters/prompts-fs.ts   # Task 11
  src/agents/patch-tool.ts, src/patches/apply.ts, src/design/reconcile.ts, src/qa/{word-count,fail-first}.ts,
  src/stages/{patch,render,qa}.ts, src/adapters/renderer.ts    # Task 12
  src/pipeline/{registry,run-job,rerun,queue,events,ownership,harness}.ts, src/adapters/system.ts, src/node.ts   # Task 13
  src/cli/{args,format,run-cli,main}.ts, test/cli/fake-entry.ts, test/fixtures/solar.brief.json   # Task 14
  test/helpers/{context,clock,stages}.ts (Task 5), test/helpers/store.ts (Task 9), test/fixtures/standard.deck.json (Task 8)
```

**Parallel waves.** Tasks within a wave touch disjoint files:

| Wave | Tasks | Files |
|---|---|---|
| 0 | 1, 2, 4 | proxy repo / `packages/harness` scaffold + `src/wire` + lockfile / `packages/renderer` |
| 1 | 3, 5 | the spike doc / `src/kernel`, `test/kernel`, `test/helpers/{context,clock,stages}`, `test/architecture.test.ts`, `src/index.ts` |
| 2 | 6, 7, 8, 9 | `src/fakes` / `src/llm.ts`, `src/env.ts`, `.env.example` / `catalog`, `schemas`, `catalog` pkg, `src/validate`, `test/fixtures/standard.deck.json` / `src/adapters/sqlite`, `fs-artifacts`, `drizzle*`, `test/helpers/store.ts` |
| 3 | 10, 11 | `src/stages/execute.ts` / agents, content and design stages, `prompts/{content,design}` |
| 4 | 12 | |
| 5 | 13 | |
| 6 | 14, 15 | `src/cli`, `test/cli`, `test/fixtures/solar.brief.json`, root `package.json` / `fixtures/golden`, `scripts`, `test/golden.test.ts`, `test/live` |

---

### Task 1: Proxy passthrough controls (claude-openai)

**Files** (repo `/Users/jarvis/Documents/Cursor-Projects/claude-openai`, new branch `feature/deckforge-passthrough-controls` from the current HEAD; never commit `.DS_Store`):
- Modify: `lib/anthropic-passthrough.js`, `api-backend.js` (`fetchWithRetry`)
- Test: `test/anthropic-passthrough.test.js`, Create: `test/fetch-with-retry.test.js`

**Interfaces:**
- Produces:
  - **Inbound header `x-proxy-max-retries`**: an integer 0–10 that overrides `MAX_RETRIES` for that request. Anything else → 400 `invalid_request_error` `x-proxy-max-retries must be an integer 0-10`. It is never forwarded upstream.
  - `fetchWithRetry(url, options, { log, debug, completionId, maxRetries?, signal? })`: `signal` is passed to `fetch` and also aborts the backoff sleep, which rejects with an `AbortError`.
  - **Forwarded response headers**: in addition to `content-type`/`request-id`, every upstream `retry-after`, `retry-after-ms`, `x-should-retry` and `anthropic-ratelimit-*`.
  - **Marker**: every response from the passthrough app (including `/health`, `/v1/models` and errors it generates) carries `x-proxy-controls: 1`.
  - **Client disconnect**: when `res.on("close")` fires and `!res.writableFinished`, the proxy aborts the upstream fetch and logs `[<id>] client closed — upstream aborted`.
  - Entitlement 429s stay verbatim (the harness maps them).

- [ ] **Step 1: Branch and baseline.** Run `git switch -c feature/deckforge-passthrough-controls && npm test`. Expected: green. Record the count.
- [ ] **Step 2: Write the failing tests:**
  - `x-proxy-max-retries: 0 reaches fetchWithRetry as maxRetries 0 and is not sent upstream`.
  - `x-proxy-max-retries: abc → 400`.
  - `forwards retry-after, retry-after-ms, x-should-retry and anthropic-ratelimit-* on 429 and 200`.
  - `x-proxy-controls: 1 on /v1/models, /v1/messages, a 404, and a 400 the proxy generates`.
  - `client disconnect aborts the upstream signal` (within 500 ms).
  - `fetch-with-retry.test.js`:
    - `maxRetries 0 returns the first 429 without sleeping`;
    - `maxRetries 2 makes 3 calls on persistent 529`;
    - `abort during backoff rejects with AbortError and fetches no more`.
- [ ] **Step 3: Run** `npm test`. Expected: the new tests FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run** `npm test`. Expected: all green.
- [ ] **Step 6: Commit** on the branch as `feat(passthrough): per-request retry override, rate-limit header forwarding, upstream abort, controls marker`, then restart the proxy from the branch (`bash stop.sh && bash start.sh`) so Task 3 can run S9. **After this task's review, the controller merges the branch to the proxy's `main`.** The harness doesn't depend on any user action.

---

### Task 2: Harness scaffold + wire-schema compiler

**Files:**
- Create: `packages/harness/{package.json,tsconfig.json,vitest.config.ts}`, `src/index.ts` (`export {}`), `src/wire/schema.ts`, `test/wire/schema.test.ts`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces:
  - `package.json`: deps per Tech Stack + `@deckforge/{schemas,catalog,renderer}: workspace:*`; dev `drizzle-kit`; scripts `test`, `lint`, `typecheck`, `db:generate`, `record:golden`. `vitest.config.ts`: `testTimeout: 30_000`.
  - `type JsonSchema = Record<string, unknown>`.
  - `compileWireSchema(schema: z.ZodTypeAny): { jsonSchema: JsonSchema; normalize(raw: unknown): unknown }`. **One walk** over the Zod v3 subset produces both outputs:

    | Zod node | `jsonSchema` | `normalize` |
    |---|---|---|
    | `ZodObject` | `{type:"object", properties, required:[all keys], additionalProperties:false}` | recurse into fields |
    | `ZodOptional(T)` | `{anyOf:[T,{type:"null"}]}` (still required) | `null` → **key deleted** |
    | `ZodNullable(T)` | `{anyOf:[T,{type:"null"}]}` | `null` **kept** |
    | `ZodString` | `{type:"string"}` (checks dropped) | |
    | `ZodNumber` | `integer` if an `int` check, else `number` (bounds dropped) | |
    | `ZodBoolean` | `{type:"boolean"}` | |
    | `ZodLiteral` | `{const}` | |
    | `ZodEnum` | `{type:"string", enum}` | |
    | `ZodDiscriminatedUnion` | `{anyOf}` | normalise against the branch chosen by the discriminator |
    | `ZodUnion` | `{anyOf}` | normalise against the first branch that parses after normalisation |
    | `ZodArray` | `{type:"array", items}` (lengths dropped) | recurse into items |
    | `ZodEffects` | its inner schema | its inner schema |

    Anything else throws `UnsupportedSchemaError(path, typeName)`, e.g. at `$.payload`.

- [ ] **Step 1: Write the failing tests:**
  - `object: every key required, additionalProperties false`.
  - `optional and nullable both become anyOf [T, null] and stay required`.
  - `int().min(0) → integer; string().min(3) → string`.
  - `literal/enum/discriminatedUnion mapping`.
  - `superRefine unwrapped`.
  - `record throws UnsupportedSchemaError at "$.payload"` (`PatchSchema`).
  - `DeckSpecSchema has no forbidden keywords`: no `minLength, maxLength, minimum, maximum, exclusiveMinimum, exclusiveMaximum, multipleOf, minItems, maxItems, pattern`; every object has `additionalProperties:false` and `required` = its keys.
  - `normalize deletes null only for optional fields`: `{a:null, b:null}` → `{b:null}`.
  - `normalize picks the union branch by discriminator`: Stat `trend:null` → no `trend`.
  - `round-trip: schema.parse(normalize(raw)) succeeds for raw values with nulls wherever allowed`.
- [ ] **Step 2: Run** `pnpm install && pnpm --filter @deckforge/harness test`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests + typecheck + lint. Expected: PASS, and no build-script approval prompt.
- [ ] **Step 5: Commit** as `feat(harness): package scaffold; zod → strict tool schema compiler with schema-directed null normalisation`.

---

### Task 3: Spike: strict tool use and proxy controls through the live proxy

**Prerequisites:** Task 1 (the proxy runs the branch), Task 2 (`compileWireSchema`), and `LLM_API_KEY` in the gitignored root `.env`. If the proxy can't run, **stop, BLOCKED**.

**Files:**
- Create: `docs/superpowers/spikes/2026-10-24-strict-tools-via-proxy.md`

**Interfaces:**
- Produces a **Decisions** section that later tasks read: `REFUSAL_FALLBACK_DEFAULT` (bool), `CONTENT_EFFORT` (`medium`|`low`), `PROMPT_CACHE_EFFECTIVE` (bool). The record also lists the confirmed SDK calls and error classes.

- [ ] **Step 1: Write the spike script in your scratch dir, not the repo.** Import repo modules by absolute path and run with `tsx`. Checks:
  - **S1** `models.list()`: status, model ids present.
  - **S2** Sonnet, `tool_choice auto`, `strict:true`, probe schema (nested object, discriminated `anyOf` + `const`, nullable `anyOf`, integer, enum). Tool call present and valid; latency, usage.
  - **S2b** the **real** deck wire schema `compileWireSchema(z.object({ title, subtitle, slides: z.array(SlideSchema.extend({ type: z.enum(slide-type ids) })) }))` with a standard-depth brief (12 slides, 60–120-word notes), effort `medium`, `max_tokens` 16000, run twice. Record acceptance, latency, `output_tokens`, and whether `DeckSpecSchema.parse(normalize(input))` succeeds.
  - **S3** S2 on Haiku.
  - **S4** `tool_choice {type:"tool"}` → 400, and `temperature: 0.2` → 400 (regression checks).
  - **S5** S2b's request repeated within 5 min with top-level `cache_control`: record `cache_read_input_tokens` on the second call (the proxy prepends a billing system block).
  - **S6** `beta.messages.create` with `betas:["server-side-fallback-2026-07-01"], fallbacks:"default"` through the proxy's OAuth path: accepted, or the 4xx body.
  - **S7** effort `low` vs `medium` latency on S2b.
  - **S8** a client on `http://127.0.0.1:1`: error class + `cause.code`.
  - **S9** (Task 1 branch):
    - (a) `x-proxy-max-retries: 0` → 200, and the response has `x-proxy-controls: 1`;
    - (b) `anthropic-ratelimit-*` reach the client on a 200 (`withResponse()`);
    - (c) aborting a Sonnet call after 1 s makes the proxy log `upstream aborted`;
    - (d) `x-proxy-max-retries: 99` → 400.
- [ ] **Step 2: Run** the script and paste the full table into the spike doc.
- [ ] **Step 3: Write the Decisions:**
  - S2/S2b/S3 failing → **BLOCKED**.
  - `CONTENT_EFFORT` = `medium` if both S2b runs ≤ 60 s; else `low` if `low` ≤ 60 s; else BLOCKED.
  - `REFUSAL_FALLBACK_DEFAULT` = S6 accepted.
  - `PROMPT_CACHE_EFFECTIVE` = S5 `cache_read_input_tokens > 0`.
- [ ] **Step 4: Commit** as `docs(harness): strict-tool and proxy-controls spike results`.

---

### Task 4: Renderer touchpoints (AbortSignal, tsx-safe diagrams, pure hash export)

Skip any step the renderer's final fix wave already landed. Its test must still exist and pass.

**Files:**
- Modify: `packages/renderer/src/{build,diagrams}.ts`, `packages/renderer/package.json` (exports `"./hash": "./src/blocks/hash.ts"`)
- Test: `packages/renderer/test/{build,diagrams}.test.ts`, Create: `packages/renderer/test/tsx-diagrams.test.ts`

**Interfaces:**
- Produces:
  - `BuildInput` gains `signal?: AbortSignal`. `build()` checks it before each step and rejects with `signal.reason`.
  - `renderDiagrams(sources, theme, opts?: { signal? })` closes the browser on abort and rejects.
  - The page sanitiser is injected from a static string or file, never `Function#toString` (the C1 root cause: tsx injects `__name`).
  - `@deckforge/renderer/hash` exports `sha256Hex`.

- [ ] **Step 1: Write the failing tests:**
  - `diagrams render under tsx`: spawn `tsx` on a temp script that renders `graph TD; A-->B` → 1 svg, 0 warnings.
  - `renderDiagrams rejects promptly on abort and closes chromium` (< 2 s; a later call still works).
  - `build rejects with the abort reason and writes no index.html`.
  - `hash subpath matches node:crypto`.
- [ ] **Step 2: Run** `pnpm --filter @deckforge/renderer test`. Expected: FAIL (unless already landed).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the unit + e2e tests. Expected: PASS, with baselines unchanged.
- [ ] **Step 5: Commit** as `feat(renderer): abortable build and diagrams, tsx-safe sanitiser, pure hash export`.

---

### Task 5: Kernel: contracts, ports, errors, events, deadline, meter, hash, test helpers, architecture test

**Files:**
- Create: `src/kernel/{contracts,errors,events,bus,deadline,meter,hash,issues,ports,stage,llm-port}.ts`, `test/kernel/*.test.ts`, `test/architecture.test.ts`, `test/helpers/{context,clock,stages}.ts`
- Modify: `src/index.ts`

**Interfaces:**
- **`contracts.ts`**:
  - `STAGE_NAMES = ["content","design","render","qa","patch"]`, `StageName`.
  - `RERUN_FROM = ["content","design","render","qa"]`, `RerunFrom`.
  - `JobStatus = "queued"|"running"|"succeeded"|"qa_failed"|"failed"|"cancelled"`.
  - `TokenUsage {inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens}`, `ZERO_USAGE`, `addUsage`, `totalTokens`.
  - `DesignPlanSchema = z.object({ motion: MotionPlanSchema, interaction: InteractionPlanSchema })`, `DesignPlan`. There is no theme (N3).
  - `DeckSkeletonSchema {slides: {id, type, emphasisTargets, blockTypes}[]}`.
  - `ContentChoicesSchema = ChoicesSchema.pick({depth, styleFamilyId, interactionModeId, questionCount})`.
  - `DesignChoicesSchema = ChoicesSchema.pick({motionTemplateId, interactionModeId, questionCount})`.
  - `JobInputs {brief, choices}`.
  - `PipelineState = JobInputs & {deck?, design?: DesignPlan, manifest?, report?}`.
  - `AcceptedDoc = {kind:"deck"; revision; source:{stage:"content"|"patch"; iteration}; deck} | {kind:"design"; revision; source:{stage:"design"|"patch"; iteration}; design: DesignPlan}`, with the content inline.
  - `StageSummary`, one of:
    - `{stage:"content"; slideCount; slideTypes}`
    - `{stage:"design"; overrides; placements}`
    - `{stage:"render"; slideIds; totalBytes; warnings}`
    - `{stage:"qa"; pass; failures: {slideId; reasons}[]}`
    - `{stage:"patch"; patches: {slideId; op}[]}`
  - `JobRecord {id, status, brief, choices, ownerId, heartbeatAt, createdAt, updatedAt, error, usage, distDir}`.
  - `StageRecord {jobId, stage, iteration, status:"running"|"succeeded"|"failed", inputHash, artifactPath, startedAt, finishedAt, durationMs, backoffMs, attempts, usage, summary, error}`.
  - `AttemptRecord {n, outcome:"ok"|"invalid"|"no-tool-call"|"truncated"|"error", issues?, usage, usageKnown, durationMs}`.
  - `StageArtifact {jobId, stage, iteration, version, inputHash, fingerprint, input, output|null, error|null, startedAt, durationMs, backoffMs, usage, attempts}`.
  - `artifactFileName(stage, i)`: `"content.json"` for 0, `"qa.2.json"` for 2.
- **`errors.ts`**:
  - `ErrorKind` = `input | validation | timeout | budget | cancelled | llm_unreachable | llm_config | llm_auth | llm_quota | llm_transient | llm_refusal | llm_bad_request | render | internal`.
  - Subclasses:
    - `InputError`
    - `ValidationError(issues, attempts)`
    - `TimeoutError(stage, ms)`, message `stage <stage> exceeded <ms> ms`
    - `BudgetError`, message `token budget exceeded: 250,123 > 250,000`
    - `CancelledError(reason = "cancelled")`; the message is the reason, e.g. `ownership lost`
    - `LlmUnreachableError(baseUrl)`, with the exact §1a message
    - `LlmConfigError`
    - `LlmAuthError`
    - `LlmQuotaError`
    - `LlmTransientError`, the only `retryable`
    - `LlmRefusalError`
    - `LlmBadRequestError`
    - `RenderFailedError`
    - `InternalError`
    - `CorruptArtifactError(relPath)`, kind `input`, message `artifact <relPath> is missing or invalid`
  - `toHarnessError`, `ErrorInfo`, `errorInfo`.
- **`events.ts`**: `StageEvent`. Every member has `{jobId, at}`:
  - `job:queued`
  - `job:started{from: RerunFrom|null; mode: "run"|"rerun"|"resume"}`
  - `job:finished{status, error, usage}`
  - `stage:start{stage, iteration}`
  - `stage:progress{…, message}`
  - `stage:warning{…, message}`
  - `stage:retry{…, reason:"validation"|"rate-limit"|"transient", attempt, maxAttempts, waitMs, detail}`
  - `stage:done{…, durationMs, backoffMs, usage, inputHash, summary}`
  - `stage:error{…, error, durationMs}`

  Also `StageEventSchema` and `EventEnvelope {seq, event}`.
- **`bus.ts`**: `EventBus` over envelopes (`publish`, `subscribe(jobId|"*", fn) → unsubscribe`). Listener errors are isolated.
- **`deadline.ts`**: `Deadline(ms, {maxExtensionMs, stage})` with `signal`, `fired`, `extend(ms)`, `restart()` (full `ms` again, extension budget kept) and `dispose()`. The reason is `TimeoutError`.
- **`meter.ts`**: `TokenMeter(cap)` with `add` (throws above cap), `assertCanSpend` (throws at cap), `total`, `usage`.
- **`hash.ts`**: `canonicalJson`, and `hashOf(v) = sha256Hex(canonicalJson(v))` from `@deckforge/renderer/hash`.
- **`issues.ts`**: `Issue {path, code, message}`, `zodToIssues`, `formatIssues(issues, max=20)`.
- **`ports.ts`**:
  - `Clock { now(); sleep(ms, signal?); every(ms, fn): () => void }`, `Logger`, `IdSource { jobId(); instanceId() }`.
  - `RendererPort.build({ jobId, deck, theme: ThemeSpec, motion, interaction, outDir }, signal): Promise<RenderManifest>`.
  - `QaPort.run({distDir, manifest, deck, wordCap}, signal)`.
  - **Reads** (unfenced):
    - `Store.jobs { get(id); list({limit, status?}) }`, newest first;
    - `Store.stages { get; list(jobId) }`;
    - `Store.events { list(jobId, afterSeq?) }`;
    - `Store.artifacts { read(jobId, stage, i); readAccepted(jobId, kind); jobDir(jobId) }`. Reads throw `CorruptArtifactError` for bad files and return `undefined` when missing.
  - **Lifecycle**:
    - `Store.createJob({id, brief, choices, ownerId, now}): Promise<JobSession>`.
    - `Store.claim(id, ownerId, now, staleBefore): Promise<JobSession | null>`: succeeds only if the job's status isn't `queued`/`running`, or its `heartbeatAt < staleBefore`. It is one conditional `UPDATE`.
    - `Store.reclaimStale(staleBefore, error): Promise<string[]>`: fails stale `queued`/`running` jobs and their `running` stage rows in one transaction.
    - `Store.close()`.
  - **`JobSession`** (fenced writes; each throws `CancelledError("ownership lost")` when its conditional write affects 0 rows):
    - `jobId`, `ownerId`
    - `heartbeat(now): Promise<boolean>`
    - `updateJob(patch)`, `upsertStage(r)`, `retainOnly(keep)`, `appendEvent(e): Promise<number>`
    - `writeArtifact(a): Promise<string>`, `removeArtifact(stage, i)`, `writeAccepted(doc)`: these filesystem writes run after a fenced ownership check.
- **`stage.ts`**:
  - `RetryPolicy = { validation: number }`.
  - `STAGE_TIMEOUTS_MS = {content:90_000, design:45_000, render:30_000, qa:60_000, patch:45_000}`, `MAX_PATCH_LOOPS = 3`, `MAX_BACKOFF_MS = 120_000`, `SETTLE_GRACE_MS = 15_000`, `HEARTBEAT_MS = 5_000`, `STALE_AFTER_MS = 30_000`.
  - `StageReporter { progress; warn; retry; attempt; usage /* throws BudgetError */; beginAttempt(); extendDeadline(ms, "rate-limit") }`.
  - `StageContext = { jobId; iteration; llm; catalog; renderer; qa; clock; logger; signal; paths:{distDir}; retry; report }`. It has no store.
  - `StageDef<I, O> = { name; version; timeoutMs; retry; dependsOn; input; output; select(s, catalog): I; reduce(s, o): PipelineState; fingerprint(i: I, catalog): unknown; summarize(o): StageSummary; run(i, ctx): Promise<O> }`.
- **`llm-port.ts`**: the LLM types (`ToolName`, `Effort`, `ToolSpec`, `UserBlock`, `AssistantTurn`, `LlmMessage`, `LlmRequest`, `StopReason`, `LlmCompletion`, `LlmRetryInfo`, `LlmCallOptions`, `LlmPort { preflight(signal); complete(req, opts) }`), plus `requestFingerprint(req) = { model, systemHash, toolSchemaHash, effort, maxTokens, firstUserHash }`.
- **Test helpers**:
  - `FakeClock`;
  - toy `StageDef`s (echo, hang-until-abort with a settle delay, throw-kind);
  - `makeTestContext(overrides?) → { ctx, events, attempts }`. The default `llm` throws, renderer/qa reject, and `catalog = loadCatalog()`.

- [ ] **Step 1: Write the failing tests:**
  - `errors.test.ts`:
    - `only LlmTransientError is retryable`.
    - `exact §1a message`.
    - `BudgetError grouping`.
    - `CancelledError("ownership lost").message`.
    - `toHarnessError wraps unknown`.
  - `events.test.ts`: `schema round-trips every event and summary`.
  - `bus.test.ts`: delivery, unsubscribe, isolation.
  - `deadline.test.ts`:
    - `fires with TimeoutError`.
    - `extend(60) at 40/50 fires at 110`.
    - `restart at 40 fires at 90`.
    - `extension clamp`.
    - `dispose`.
  - `meter.test.ts`, `hash.test.ts` (`hashOf equals node:crypto sha256 of canonicalJson`), `issues.test.ts`.
  - `llm-port.test.ts`: `requestFingerprint ignores later messages, changes with tool schema`.
  - `architecture.test.ts` (resolved paths; exact package names):
    - `only src/llm.ts imports @anthropic-ai/sdk` (all packages).
    - `only src/adapters/sqlite/** imports drizzle-orm or node:sqlite`.
    - `pure layers import no I/O, node:crypto, adapters, llm.ts, env.ts or */node entries`.
    - `pure layers import only @deckforge/schemas, @deckforge/catalog and exactly @deckforge/renderer/hash`.
    - `process.env only in env.ts, node.ts, cli/main.ts`.
    - `no top-level let/var`.
    - `"localhost:4001" only in src/env.ts`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** and export from `src/index.ts`.
- [ ] **Step 4: Run** the tests + typecheck + lint. Expected: PASS.
- [ ] **Step 5: Commit** as `feat(harness): kernel contracts, fenced store ports, error taxonomy, event envelopes, deadline, meter, test helpers`.

---

### Task 6: FakeLlm and RecordingLlm with request fingerprints

**Files:**
- Create: `src/fakes/{llm,recording}.ts`, `test/fakes/*.test.ts`

**Interfaces:**
- Produces:
  - `FakeReply` is one of the following, each with optional `expect?: RequestFingerprint`:
    - `{kind:"tool"; input; usage?; rateLimitFirst?:{waitMs}}`
    - `{kind:"text"; text; stopReason?}`
    - `{kind:"refusal"; category?}`
    - `{kind:"error"; error:{kind, message}}`
    - `{kind:"hang"}`
  - `CassetteSchema = { version: 1; replies: Partial<Record<ToolName, FakeReply[]>> }`, with `expect` **required** in cassettes.
  - `class FakeLlm`: `constructor({replies?, preflightError?, source?})`, `fromCassette(c, source)`, `calls`, `push`, `remaining()`.
    - A reply whose `expect` differs from `requestFingerprint(req)` throws `cassette <source> is stale at <tool> #<n>: <field> differs — re-record with: pnpm --filter @deckforge/harness record:golden`.
    - Default usage is `{1000,500,0,0}`.
  - `class RecordingLlm(inner)` with `toCassette()`. It records every completion with its `expect`, and records then rethrows errors.

- [ ] **Step 1: Write the failing tests:**
  - `replays per tool in order and records calls`.
  - `exhausted script message`.
  - `expect mismatch → stale message naming toolSchemaHash`.
  - `matching expect replays`.
  - `rateLimitFirst calls onRetry`.
  - `error reply kind`.
  - `refusal`.
  - `hang + abort → CancelledError`.
  - `preflightError`.
  - `recording round-trip incl. expect`.
  - `CassetteSchema rejects a reply without expect`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** as `feat(harness): FakeLlm and RecordingLlm with fingerprinted cassettes`.

---

### Task 7: `llm.ts` adapter, env, preflight, `.env.example`

**Files:**
- Create: `src/llm.ts`, `src/env.ts`, `.env.example`, `test/llm/anthropic.test.ts`, `test/llm/fake-server.ts`, `test/env.test.ts`

**Interfaces:**
- Produces (`env.ts`):
  - `Env = { llm: { baseUrl; apiKey; models:{content, design, fast}; refusalFallback; proxyControls }; jobsDir; dbPath; tokenBudget }`.
  - `loadEnv(source)`:
    - `LLM_BASE_URL` (default `http://localhost:4001`, trailing `/` stripped)
    - `LLM_API_KEY` (required)
    - the models (spec defaults, regex)
    - `LLM_REFUSAL_FALLBACK` (spike default)
    - `LLM_PROXY_CONTROLS` (default: origin ≠ `https://api.anthropic.com`)
    - `DECKFORGE_JOBS_DIR` (`jobs`), `DECKFORGE_DB_PATH` (`<jobsDir>/deckforge.sqlite`), `DECKFORGE_TOKEN_BUDGET` (`250000`)
  - `EnvError`.
- Produces (`llm.ts`):
  - `createLlmClient(llm): Anthropic`: `maxRetries: 0`, with `defaultHeaders {"x-proxy-max-retries":"0"}` when `proxyControls`.
  - `createAnthropicLlm(client, { baseUrl, clock, logger, proxyControls, maxRetries = 4, fallbackModels }): LlmPort`:
    - **Retries:** 429/529 are `rate-limit`, 408/409/5xx and connection errors are `transient`. The wait is `retry-after-ms` | `retry-after`×1000 | `min(8000, 500·2^(n-1))`. `onRetry` is called, then `clock.sleep(wait, signal)`. Exhausted → `LlmTransientError`, or `LlmUnreachableError` on a refused connection. Per the spike (S8/S8b):
      - Check for `APIConnectionError` before any status check.
      - The refused-connection code is at `err.cause?.cause?.code` (`ECONNREFUSED`), not `err.cause.code`.
      - Tests must use a closed high port, never port 1, which `fetch` blocks before connecting.
    - **Quota:** a 429 body containing any `QUOTA_PATTERNS` (`"Extra usage is required"`, `"credit balance is too low"`, `"credit balance too low"`) → `LlmQuotaError` with no retry.
    - **Request:** `messages.create({ model, max_tokens, system, messages, tools:[{…, strict: tool.strict}], tool_choice:{type:"auto"}, output_config:{effort}, cache_control:{type:"ephemeral"} }, {signal})`. No sampling params, no `thinking`. Fallback models use `beta.messages.create` with `betas:["server-side-fallback-2026-07-01"], fallbacks:"default"`.
    - **Response mapping:**
      - `toolCall` = the first `tool_use`, `text` = the joined text;
      - `refusalCategory` = `stop_details?.category`;
      - `usage` = `{input_tokens, output_tokens, cache_read_input_tokens ?? 0, cache_creation_input_tokens ?? 0}`;
      - `turn = {role:"assistant", content}`, replayed verbatim.
    - **Errors:** auth 401/403 → `LlmAuthError("LLM_API_KEY rejected by <url> (<status>)")`, other 4xx → `LlmBadRequestError`, abort → `CancelledError`.
    - **`preflight(signal)`:**
      - `models.list({limit:1}).withResponse()` with `{signal, timeout:5000, maxRetries:0}`; connection error → `LlmUnreachableError`, 401/403 → `LlmAuthError`.
      - When `proxyControls` and the response lacks `x-proxy-controls: 1` → `LlmConfigError("LLM proxy at <url> lacks passthrough controls (x-proxy-controls header missing) — update and restart it: cd ~/Documents/Cursor-Projects/claude-openai && git pull && bash stop.sh && bash start.sh")`.
      - When `!proxyControls` and the origin isn't Anthropic → `logger.warn("LLM_PROXY_CONTROLS=0: proxy-side retries are hidden from the harness")`.

- [ ] **Step 1: Write the failing tests** (`fake-server.ts` on port 0; it sends `x-proxy-controls: 1` unless told not to):
  - `preflight GETs /v1/models with x-api-key`.
  - `preflight against a closed port → exact LlmUnreachableError message`.
  - `preflight 401 → LlmAuthError`.
  - `preflight without x-proxy-controls → LlmConfigError (controls on)`; `… → warning only (controls off)`.
  - `sends x-proxy-max-retries: 0 when proxyControls; omits it otherwise`.
  - `body: tool's own strict flag (one strict and one non-strict case), auto tool_choice, effort, cache_control; no temperature/top_p/top_k/thinking`.
  - `maps usage and tool call`.
  - `replays the assistant turn verbatim`.
  - `429 with retry-after-ms: 5 then 200 → one onRetry {reason:"rate-limit", status:429, waitMs:5}`.
  - `529 is rate-limit`; `500 is transient`.
  - `gives up after 4 retries (5 requests)`.
  - `entitlement 429 → LlmQuotaError after 1 request`.
  - `400 → LlmBadRequestError after 1 request`.
  - `refusal mapping`.
  - `abort → CancelledError`.
  - `fallback model uses the beta endpoint; others don't`.
  - `env.test.ts`:
    - `defaults`.
    - `missing LLM_API_KEY`.
    - `rejects "gpt-4o" and "sonnet"`.
    - `trailing slash`.
    - `proxyControls false for https://api.anthropic.com`.
    - `.env.example lists the §1a vars with spec defaults`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** (SDK errors matched by `instanceof`).
- [ ] **Step 4: Run** the tests + typecheck + lint. Expected: PASS.
- [ ] **Step 5: Commit** as `feat(harness): anthropic LlmPort with observable backoff, quota mapping, proxy controls check, env config`.

---

### Task 8: Catalog rule data + validators + design wire schema

**Files:**
- Modify: `catalog/compat-matrix.json`, `catalog/interactions.json`, `packages/schemas/src/catalog-files.ts`, `packages/catalog/src/integrity.ts`, their tests
- Create: `src/validate/{words,rules,deck,design,design-wire}.ts`, `test/fixtures/standard.deck.json`, `test/validate/*.test.ts`

**Interfaces:**
- **Catalog:**
  - `compat-matrix.json` gains `"designRules": { "motionOverrideSlideTypes": ["title","stat","quote","summary"], "maxInteractiveComponentsPerSlide": 2 }`.
  - The hotspot list moves to `interactions.json` `df-hotspot.disallowedSlideTypes`, and `disallowedSlideTypesForHotspots` is removed from the compat schema. `InteractionComponentSchema` gains `disallowedSlideTypes?`.
  - Integrity checks: the referenced slide types exist, and the max is an int ≥ 1.
- **`words.ts`**: `countWords`, and `visibleWords(slide)`, which counts title, bullets, paragraph, stat value+label, quote+attribution, compare titles+rows, timeline label/detail/date, chart labels+series names, quiz question+options. It excludes notes, code, mermaid and image prompt/alt.
- **`rules.ts`**:
  - `DeckRules {slides, wordsPerSlideMax, notesWords, firstType, lastType, penultimateOrLastType, requiredTypes, modeOnlyTypes, quizTypes, quizCount, types}`.
  - `deckRules(c, choices: ContentChoices)`.
  - `evalRequiredWhen(expr, choices)`: grammar `^depth\s*(==|!=)\s*([\w-]+)$`, else throws.
- **`deck.ts`**: `validateDeck(c, rules, deck): Issue[]`. Codes:
  - `slide-count`, `unknown-slide-type`, `first-slide`, `last-slide`, `penultimate-slide`;
  - `required-slide`, `slide-type-not-in-mode`, `quiz-count`, `quiz-adjacent`;
  - `block-not-accepted`: `accepts` ∪ `Paragraph` when regions include `subtitle`/`aside`/`caption`;
  - `limit`: the measured keys are `titleWords`, `subtitleWords` (deck.subtitle on the first-type slide), `items`, `wordsPerItem`, `words`, `stats`, `steps`, `options`, `rows`, `series`, `points`, `lines`, `cols`, `captionWords`; `UNMEASURED_LIMITS = ["nodes","columns"]`;
  - `words-per-slide`, `notes-length` (every slide except index 0), `emphasis-missing`.
- **`design-wire.ts`**:
  - `designWireSchema(e?: {slideIds?, overrideSlideIds?, componentIds?, vocabulary?})` = `{ motion:{ overrides:[{slideId, transition, enter, emphasis, exit, easing: nullable, reason}] }, interaction:{ placements:[{slideId, componentId, blockIndex: int nullable, propsJson}] } }`.
  - `enumOrString(values)`.
  - `type DesignWire = z.infer<ReturnType<typeof designWireSchema>>`.
- **`design.ts`**: `validateDesign(c, choices: DesignChoices, skel, w): Issue[]`. Codes:
  - `unknown-slide`, `override-slide-type`, `override-reason`, `duplicate-override`, `vocabulary`;
  - `component-not-in-mode`, `components-per-slide` (interactive = `binds` lacks `"*"`), `components-density` (`ceil(slides / mode.minComponentsPerSlides)`);
  - `component-slide-type`, `component-binding`, `props-json`, `duplicate-placement`.

  Choices validity is checked at submit/rerun, not here.
- **Fixture `standard.deck.json`**: `solar.deck.json` minus `s03`, `s12` and `s13` (12 slides), trimmed to pass with linear/minimal/standard.
- **Conflict resolved:** the catalog's `minComponentsPerSlides` wins over spec §3 (assessment is stricter, at 1 per 3).

- [ ] **Step 1: Write the failing tests:**
  - catalog:
    - `designRules integrity: unknown slide type`.
    - `df-hotspot.disallowedSlideTypes integrity: unknown slide type`.
    - `compat schema rejects disallowedSlideTypesForHotspots`.
  - `words.test.ts`:
    - `countWords("  C++ is   fun ") === 3`.
    - `visibleWords includes title/bullets/stat/compare, excludes notes/code/mermaid/image prompt`.
  - `deck.test.ts` (fixture + linear/minimal/standard):
    - `fixture has no issues`.
    - `9 slides → slide-count "has 9 slides; standard needs 10–14"`.
    - first/last/penultimate.
    - `standard without agenda → required-slide`; `overview without agenda → none`.
    - `quiz in linear → slide-type-not-in-mode`; `assessment questionCount 4 with 3 quizzes → quiz-count`; `adjacent quizzes`.
    - `Bullets on stat → block-not-accepted`; `Paragraph on section accepted`.
    - `6 bullets → limit`; `13-word bullet → limit`; `9-word title on title slide → limit`.
    - `words-per-slide`; `59-word notes on slide 2 → notes-length`; `slide 1 notes unchecked`; `emphasis-missing`.
    - `every catalog limit key measured or unmeasured`.
    - `evalRequiredWhen rejects "audience == x"`.
  - `design-wire.test.ts`:
    - `enums applied / plain strings when empty`.
    - `round-trips through normalize keeping easing:null and blockIndex:null`.
  - `design.test.ts`:
    - `valid wire`.
    - `override on bullets`, `blank reason`, `enter "spin"`, `duplicate override`.
    - `df-quiz in explorable`.
    - `3 interactive on one slide; df-notes not counted`.
    - `12 slides with 2 interactive → components-density (needs 3)`.
    - `df-hotspot on title → component-slide-type`.
    - `df-chart on Bullets`, `df-notes with blockIndex`.
    - `propsJson "[1]"`, `unknown slideId`.
- [ ] **Step 2: Run** `pnpm test`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck && pnpm lint`. Expected: PASS, with `check:literals` at 0.
- [ ] **Step 5: Commit** as `feat(harness): catalog-driven deck/design validators and design wire schema; catalog designRules`.

---

### Task 9: Store: Drizzle over node:sqlite, fenced sessions, artifacts, accepted documents

**Files:**
- Create: `drizzle.config.ts`, `src/adapters/sqlite/{schema,db,repos,session}.ts`, `src/adapters/fs-artifacts.ts`, `drizzle/*` (generated), `test/store/*.test.ts`, `test/helpers/store.ts`

**Interfaces:**
- Produces:
  - **Tables:**
    - `jobs`: `id` PK, `status`, `brief_json`, `choices_json`, `owner_id`, `heartbeat_at`, `created_at`, `updated_at`, `error_json`, `usage_json`, `dist_dir`.
    - `stages`: PK (`job_id`,`stage`,`iteration`); `status`, `input_hash`, `artifact_path`, `started_at`, `finished_at`, `duration_ms`, `backoff_ms`, `attempts`, `usage_json`, `summary_json`, `error_json`.
    - `events`: `seq` AUTOINCREMENT PK, `job_id`, `type`, `stage`, `at`, `payload_json`; index (`job_id`,`seq`).
  - `openSqlite(path)`:
    - `DatabaseSync`, with `PRAGMA journal_mode=WAL; foreign_keys=ON; busy_timeout=5000`;
    - the `sqlite-proxy` callback returns value arrays;
    - migrations via `sqlite-proxy/migrator`.
  - **Fencing:**
    - Job updates: `UPDATE jobs … WHERE id=? AND owner_id=?`.
    - Stage upserts and event inserts: `INSERT … SELECT … WHERE EXISTS (SELECT 1 FROM jobs WHERE id=? AND owner_id=?)`, with an `ON CONFLICT` upsert for stages.
    - `changes() === 0` → `CancelledError("ownership lost")`.
    - `heartbeat` returns `false` on 0 rows.
    - `claim` is a single `UPDATE … WHERE id=? AND (status NOT IN ('queued','running') OR heartbeat_at < ?)` and returns `null` on 0 rows.
    - `reclaimStale` runs in `BEGIN IMMEDIATE`.
  - `createSqliteStore({dbPath, jobsDir}): Promise<Store>` (`":memory:"` allowed).
  - `createFsArtifacts(jobsDir)`: used by the sessions (after a fenced `SELECT owner_id`) and by the reads. Writes are atomic (temp + `rename`); stage artifacts go to `<jobId>/<artifactFileName>` and accepted docs to `<jobId>/accepted/<kind>.json`. Reads validate shape with Zod and throw `CorruptArtifactError("<jobId>/accepted/deck.json")`.
  - `test/helpers/store.ts`: `memoryStore() → { store, jobsDir }`.

- [ ] **Step 1: Write the failing tests:**
  - `migrates to jobs, stages, events with the listed columns`; `migrations idempotent across two opens`.
  - `createJob returns a session; jobs round-trip`.
  - `list newest first; status filter`.
  - `stage upsert idempotent on (jobId, stage, iteration)`; `retainOnly`.
  - `events seq increasing; list afterSeq`.
  - `stolen-ownership writer`: session A; force a stale heartbeat; `store.claim(id, "B", …)` succeeds → A's `upsertStage`, `appendEvent`, `updateJob`, `writeArtifact` each throw `CancelledError("ownership lost")`, and the rows and files are unchanged. A's `heartbeat` returns `false`.
  - `claim refuses a running job with a fresh heartbeat` (returns `null`).
  - `claim succeeds on a finished job`.
  - `reclaimStale fails only stale jobs and their running stage rows`.
  - artifacts:
    - `stage artifact round-trip at qa.2.json`.
    - `accepted deck round-trip at accepted/deck.json with deck inline`.
    - `no .tmp left`.
    - `missing → undefined`.
    - `corrupt → CorruptArtifactError naming the file`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement**, run `db:generate`, and commit `drizzle/`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** as `feat(harness): sqlite job store over node:sqlite with owner-fenced sessions, atomic artifacts, accepted documents`.

---

### Task 10: Stage executor

**Files:**
- Create: `src/stages/execute.ts`, `test/stages/execute.test.ts`

**Interfaces:**
- Produces:
  - `ExecutorEnv = { ports: Pick<StageContext,"llm"|"catalog"|"renderer"|"qa"|"clock"|"logger">; session: JobSession; emit(e: StageEvent): void; meter; distDir: string; timeouts? }`.
  - `executeStage<I, O>(def, req: { iteration; state; signal }, env): Promise<O>`:
    1. `input = def.input.parse(def.select(state, catalog))`. A failure is an `InternalError`.
    2. `inputHash = hashOf({ stage, version, fingerprint: def.fingerprint(input, catalog) })`.
    3. Emit `stage:start` and upsert the row `running`.
    4. Create `attempt = Deadline(timeout)` and `cap = Deadline(timeout × (1 + retry.validation))`, with `signal = AbortSignal.any([req.signal, attempt.signal, cap.signal])`. The reporter maps `beginAttempt` → `attempt.restart()`, `extendDeadline` → both deadlines + `backoffMs`, and `warn` → `stage:warning`.
    5. Race `def.run` against `signal`. On abort, await the run settling (≤ `SETTLE_GRACE_MS`), then classify: `req.signal.aborted` → its reason (a `CancelledError`, possibly "ownership lost"); a fired deadline → `TimeoutError`; otherwise `toHarnessError`.
    6. On success: `def.output.parse`, write the artifact, upsert `succeeded` with the summary, emit `stage:done{backoffMs, summary, inputHash}`.
    7. On failure: write the artifact with `error`, upsert `failed`, emit `stage:error`, rethrow.

    Every write goes through `env.session`. There is no caching and there are no stage-level transient retries.
  - `validateRegistry(defs)` and `upstreamOf(defs, name): StageName[]`.

- [ ] **Step 1: Write the failing tests** (toy stages, `memoryStore`, `FakeClock`):
  - `runs, persists artifact + row, emits start→done with summary and inputHash`.
  - `identical input runs again (no caching) and upserts the same row`.
  - `warn → stage:warning`.
  - `per-attempt timeout with beginAttempt restarts succeeds`.
  - `single attempt over 50 ms → "stage content exceeded 50 ms"`.
  - `overall cap at timeout × 2 with retry.validation 1`.
  - `extendDeadline postpones the timeout and is reported as backoffMs`.
  - `cancel is not reported as timeout`.
  - `waits for the abandoned run to settle`.
  - `ownership lost mid-stage surfaces as CancelledError("ownership lost") and writes nothing further`.
  - `usage over budget → BudgetError`.
  - `failed stage writes artifact with input and error`.
  - `bad select → InternalError`.
  - `validateRegistry errors`; `upstreamOf("qa")` = `{render, content, design}`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** as `feat(harness): stage executor with per-attempt deadlines, settle-before-fail, fenced writes`.

---

### Task 11: Agents A and B

**Files:**
- Create: `src/agents/{invoke-tool,messages,deck-tool,design-tool}.ts`, `src/design/{skeleton,assemble}.ts`, `src/stages/{content,design}.ts`, `src/adapters/prompts-fs.ts`, `prompts/content.v1.md`, `prompts/design.v1.md`, `test/agents/*.test.ts`

**Interfaces:**
- Produces:
  - `AgentRequest = { model; effort; maxTokens; system; input; tool: ToolSpec; normalize }`.
  - `invokeTool<T>(ctx, req, parse): Promise<T>`. Per attempt:
    1. `beginAttempt` + progress `calling <model> (attempt n/max)`.
    2. `complete`. Rate-limit `onRetry` → `report.retry` + `extendDeadline`.
    3. `report.usage` (`usageKnown:false` if aborted).
    4. `refusal` → `LlmRefusalError`, no retry. `max_tokens` → truncation feedback. No tool call → `Call the <tool> tool exactly once with the complete result.` Invalid → `is_error` `tool_result` with `formatIssues`.
    5. Messages are append-only. After the last attempt, throw `ValidationError(lastIssues, attempts)`.
  - `renderInput(payload)`: `<input>\n…\n</input>`.
  - `requestFingerprintOf(r: AgentRequest)` = `requestFingerprint` of the first-turn `LlmRequest`.
  - `buildContentRequest(i: {brief; choices: ContentChoices}, c, o)`:
    - tool `emit_deck` from `compileWireSchema(z.object({title, subtitle, slides: z.array(SlideSchema.extend({type: enumOrString(slide-type ids)}))}))`;
    - `maxTokens 16000`;
    - input `{ brief, rules: { slides, wordsPerSlideMax, notesWords, quizSlides, agendaRequired, slideTypes: [{id, name, accepts, limits, required?, onlyIn?}] } }`.
  - `buildDesignRequest(i: {choices: DesignChoices; skeleton}, c, o)` (**N3**):
    - tool `emit_design` from `compileWireSchema(designWireSchema({…enums}))`, effort `low`, `maxTokens 8000`;
    - input `{ motionTemplate: {id, name, intensity, defaults, bySlideType}, vocabulary, mode: {id, components (with binds), minComponentsPerSlides, questionCount}, designRules, skeleton }`;
    - **no theme, palette, type family, family tokens or threeJs**.
  - `toSkeleton(deck)`.
  - `assembleDesign(c, choices: DesignChoices, skel, wire): DesignPlan`:
    - motion = `resolveMotionPlan(c, motionTemplateId, skel.slides)`, then each override sets `{…, easing: easing ?? base.easing, overrideReason: reason}`;
    - interaction = placements grouped in deck order, `props = JSON.parse(propsJson)`, `blockIndex` omitted when null.
  - `DEFAULT_CONTENT_EFFORT` = the spike's `CONTENT_EFFORT`.
  - `createContentStage({prompt, model, effort?})`:
    - `select = s => ({ brief, choices: ContentChoicesSchema.parse(s.choices) })`;
    - `fingerprint = (i, c) => requestFingerprintOf(buildContentRequest(i, c, o))`;
    - `retry {validation: 2}`;
    - `summarize → {stage:"content", slideCount, slideTypes}`.
  - `createDesignStage({prompt, model})`:
    - `dependsOn ["content"]`;
    - `select = s => ({ choices: DesignChoicesSchema.parse(s.choices), skeleton: toSkeleton(s.deck) })`;
    - output `DesignPlan`;
    - `summarize → {overrides, placements}`.
  - `loadPrompts(dir)`: the highest `<agent>.v<N>.md` per agent.
- **Conflicts resolved (endorsed):**
  - ThemeSpec is never produced by Agent B. `emit_design` carries `{motion, interaction}` only.
  - The skeleton includes `blockTypes` (no text).
- **Prompts** (prose the implementer writes). Each must state:
  - **content**:
    - call `emit_deck` exactly once;
    - one idea per slide; title ≤ 8 words; bullets ≤ 5 × ≤ 12 words;
    - notes within `rules.notesWords` on every slide after the first;
    - choose slide types deliberately (data → `stat`/`chart`, process → `timeline`/`diagram`, trade-offs → `compare`);
    - the `required:first` type first, ending with the `penultimate-or-last` then the `last` type;
    - exactly `rules.quizSlides` quiz slides, never adjacent;
    - stay within `wordsPerSlideMax`;
    - verbatim `emphasisTargets`.
  - **design**:
    - call `emit_design` exactly once;
    - override motion only where it serves emphasis, with a reason;
    - place mode components bound to a compatible block index;
    - respect `maxInteractiveComponentsPerSlide` and `minComponentsPerSlides`;
    - `propsJson` is a JSON object.

- [ ] **Step 1: Write the failing tests:**
  - `invoke-tool.test.ts`:
    - `valid first reply`.
    - `issues fed back as is_error tool_result; retry event validation 1/3`.
    - `ValidationError after 3 invalid replies`.
    - `text-only feedback exact`.
    - `max_tokens feedback`.
    - `refusal no retry`.
    - `budget stop`.
    - `rate-limit extends the deadline and accrues backoff`.
    - `beginAttempt once per attempt`.
  - `content.test.ts`:
    - `request: model, emit_deck, slide-type enum in catalog order, effort, maxTokens 16000`.
    - `standard rules: slides [10,14], notesWords [60,120], wordsPerSlideMax = wordsPerSlideMax(c,"standard",family), quizSlides 0, agendaRequired true`.
    - `assessment questionCount 4 → quizSlides 4`.
    - `fixture accepted; optional null title removed`.
    - `slide-count violation retried`.
    - `select exposes only ContentChoices fields`.
    - `fingerprint changes with prompt text, model, effort and catalog slide types; not with paletteId, typeFamilyId or motionTemplateId`.
    - `emits progress`.
  - `design.test.ts`:
    - `request contains no slide text`.
    - `request carries no theme, palette, type-family or family-token fields` (N3).
    - `fingerprint unchanged by paletteId/typeFamilyId/threeJs; changed by motionTemplateId`.
    - `skeleton fields only`.
    - `tool enums from designRules/mode/vocabulary`.
    - `override carries overrideReason; others = resolveMotionPlan`.
    - `easing:null keeps the template easing`.
    - `placements grouped in deck order`.
    - `override on bullets retried`.
    - `output parses as DesignPlanSchema`.
  - `prompts.test.ts`:
    - `highest version`.
    - `prompts name their tool`.
    - `backticked slide-type ids exist`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** and write the prompts.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** as `feat(harness): content and design agents with request fingerprints, narrowed design input, validation feedback`.

---

### Task 12: Agent C, patches, render/QA stages, staged dist, QA stub

**Files:**
- Create: `src/agents/patch-tool.ts`, `src/patches/apply.ts`, `src/design/reconcile.ts`, `src/qa/{word-count,fail-first}.ts`, `src/stages/{patch,render,qa}.ts`, `src/adapters/renderer.ts`, `prompts/patch.v1.md`, tests

**Interfaces:**
- Produces:
  - `patchWireSchema({slideIds, slideTypeIds})`: `{ patches: (shortenText{slideId, title: nullable, body} | splitSlide{slideId, first, second} | swapLayout{slideId, type} | dropBlock{slideId, blockIndex})[] }`. A `null` title keeps the original.
  - `patchTool(c, failingIds)`.
  - `toDomainPatch(w): Patch` = `{slideId, op, payload: rest}`.
  - `applyPatches(deck, patches, rules): {ok:true; deck} | {ok:false; issues}`. Pure, in order:
    - `shortenText`: types match position for position (`patch-shape`) and visible words strictly decrease (`patch-not-shorter`).
    - `splitSlide`: in place, ids `<id>a`/`<id>b` (`duplicate-id`).
    - `swapLayout`: body accepted by the new type (`block-not-accepted`).
    - `dropBlock`: the index must exist (`patch-shape`).
    - A missing or removed id → `unknown-slide`.
  - `reconcileDesign(c, choices: DesignChoices, plan, deck): DesignPlan`:
    - keeps surviving same-type motion entries, uses the base for new or retyped slides, drops removed ids;
    - drops placements on removed or retyped slides and those whose `blockIndex` no longer binds.
  - `failingSlideIds(report, wordCap)`, `qaFailureReasons(slide, wordCap)` (`overflow`, `console: <msg>`, `contrast <r> < 4.5 at <sel>`, `<n> words > <cap>`).
  - `createPatchStage({prompt, model})`:
    - `dependsOn ["qa"]`, fingerprint from the built request, effort `low`, `maxTokens 8000`;
    - input `{ report, failing slides, wordCap, rules }`;
    - output `{patches, deck, design: DesignPlan}`;
    - `summarize → {patches:[{slideId, op}]}`.
  - `createRenderStage()`:
    - `version "render.v1"`, `dependsOn ["content","design"]`;
    - `select = s => ({ deck, design, choices: s.choices })`;
    - `fingerprint = input`;
    - `run`: `theme = resolveTheme(ctx.catalog, choices)` (N3), then `ctx.renderer.build({jobId, deck, theme, motion, interaction, outDir: ctx.paths.distDir}, ctx.signal)`, then `ctx.report.warn(w)` for **every** manifest warning;
    - `summarize → {slideIds, totalBytes, warnings}`.
  - `createQaStage()`: `version "qa.v1"`; `select` computes `wordCap = wordsPerSlideMax(c, depth, family)`; `summarize → {pass, failures:[{slideId, reasons}]}`.
  - `wordCountQa: QaPort`: per slide `overflow:false`, `consoleErrors:[]`, `contrastFails:[]`, `wordCount = visibleWords`; `pass` = all ≤ `wordCap`; `patches: []`.
  - `failFirstQa(inner, pickSlide)`: the first call fails the picked slide (`overflow:true`); later calls delegate.
  - `createRendererPort(catalog): RendererPort`:
    1. remove stale `<jobDir>/dist.tmp-*` and `dist.old-*`;
    2. build into `dist.tmp-<iteration>-<6 hex>` with `signal`;
    3. if `signal.aborted` after `build` resolves → remove tmp and throw `signal.reason`;
    4. otherwise rename `dist` → `dist.old-<hex>`, tmp → `dist`, and remove old;
    5. on failure or abort, remove tmp after `build` settles;
    6. wrap non-abort errors in `RenderFailedError`.
- **Prompt `patch.v1.md`** must state:
  - call `emit_patches` once;
  - fix only the listed failures with the least invasive op (`dropBlock` < `shortenText` < `swapLayout` < `splitSlide`);
  - keep the slide count within `rules.slides`.

- [ ] **Step 1: Write the failing tests:**
  - `apply.test.ts`:
    - `shortenText replaces`; `changed types → patch-shape`; `not shorter`.
    - `split in place s04a/s04b`.
    - `swap rejecting body`.
    - `dropBlock out of range`.
    - `split-away id → unknown-slide`.
  - `reconcile.test.ts`:
    - `split gets base motion and loses placements`.
    - `swap to non-overridable drops the override`.
    - `untouched keeps it`.
    - `every id has motion; parses`.
  - `word-count.test.ts`: `counts; pass under cap`; `fails over cap`.
  - `patch-stage.test.ts`:
    - `only failing slides sent`.
    - `fast model, emit_patches, effort low`.
    - `patched deck + reconciled plan`.
    - `rule-breaking patch fed back`.
    - `slideId enum = failing ids`.
    - `null title keeps the original`.
  - `render-stage.test.ts`:
    - `render stage emits each manifest warning`.
    - `theme passed to the port equals resolveTheme(choices)`.
    - `palette change alters only the theme argument`.
    - `summary slideIds`.
  - `qa-stage.test.ts`: `wordCap from catalog`; `reasons "42 words > 40"`.
  - `fail-first.test.ts`.
  - `renderer-adapter.test.ts` (real `build`, the fixture deck):
    - `promotes a complete dist; stale files gone; no tmp/old left`.
    - `stale dist.tmp-* and dist.old-* from a crashed run are removed at the start`.
    - `abort mid-build keeps the previous dist and removes the tmp dir`.
    - `abort after build resolves does not promote`.
    - `build error → RenderFailedError, previous dist intact`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** and write the prompt.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** as `feat(harness): patch agent, render stage resolving theme, qa stage, staged dist promotion`.

---

### Task 13: Pipeline, events, queue, rerun, resume, ownership, composition root

**Files:**
- Create: `src/pipeline/{registry,run-job,rerun,queue,events,ownership,harness}.ts`, `src/adapters/system.ts`, `src/node.ts`, `test/pipeline/*.test.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Produces:
  - `createStageRegistry({prompts, models})`, validated.
  - **`events.ts`**: `createEventLog(session, bus) → { emit(e); flush() }`. A serial chain does `seq = await session.appendEvent(e)`, then `bus.publish({seq, event})`. `subscribeWithReplay(store, bus, jobId, fn, afterSeq)`: no gap, no duplicates.
  - **`run-job.ts`**: `runJob(session, state, { from: RerunFrom|null; signal }, env): Promise<{ status; state }>`:
    1. preflight;
    2. the stages from `from` onward: content → `writeAccepted(deck, rev n)`; design → `writeAccepted(design)`; render; qa;
    3. the patch loop, where each patch writes both accepted docs (rev + 1);
    4. afterwards, stale loop iterations are pruned (`retainOnly`/`removeArtifact`). `accepted/` is never pruned.
  - **`rerun.ts`**:
    - `restoreState(store, jobId, from)`:
      - `content` → `{brief, choices}`;
      - `design` → `+ deck` from `accepted/deck.json`;
      - `render|qa` → `+ design` from `accepted/design.json`;
      - missing/corrupt → `InputError("cannot rerun from <from>: artifact <jobId>/accepted/<kind>.json is missing or invalid")`.
    - `checkRerunChoices(registry, state, stored, next, from, catalog)`:
      - `validateChoices` issues → `InputError`;
      - for each stage in `upstreamOf(from)` that has an LLM fingerprint (content, design), compare `inputHash` under stored vs next choices;
      - a difference → `InputError("this choice change affects <stage>; rerun --from <stage>")`.
      - So palette/type/threeJs changes pass for `--from render`.
    - `resumePoint(store, jobId): RerunFrom`:
      - the first of `content, design, render, qa` without a `succeeded` iteration-0 row;
      - if all four succeeded (the failure was in the patch loop) → `render`, using the accepted docs;
      - a `succeeded` job → `InputError("job <id> already succeeded")`;
      - a `qa_failed` job → `InputError("job <id> exhausted its patch loop; use rerun")`.
  - **`ownership.ts`**:
    - `startHeartbeat(session, clock, onLost)` (every `HEARTBEAT_MS`). `heartbeat()` returning `false` → `onLost()`, which aborts the job's controller with `CancelledError("ownership lost")`.
    - `reclaimStaleJobs(store, clock)` with `InternalError("interrupted: owner <id> stopped heartbeating")`.
  - **`queue.ts`**: `JobQueue(2)` with `enqueue`, `cancel`, `running` and `has(jobId)`, using `p-queue` `add(fn, {signal})`.
  - **`harness.ts`**: `createHarness(deps)`, where `deps = { llm, catalog, renderer, qa, store, clock, logger, ids, prompts, config: { jobsDir; models; tokenBudget; timeouts? } }`. It reclaims stale jobs on start. `Harness`:
    - `submit(i)`: sync `InputError` on invalid input.
    - `rerun(jobId, {from, choices?})` and `resume(jobId)`:
      - if `queue.has(jobId)` or the job is `queued`/`running` with a fresh heartbeat → `InputError("job <id> is <status> (owner <ownerId>); cancel it or wait")`;
      - otherwise `store.claim` (`null` → the same error);
      - restore and check before enqueueing; `done` rejects with `InputError` before any event.
    - `cancel`, `subscribe(jobId|"*", fn, {afterSeq?})`, `listJobs`, `getJob`.
    - `close()`: stops heartbeats, awaits jobs, flushes events.

    `job.usage` accumulates across invocations.
  - **`adapters/system.ts`**: `systemClock` (with `every`), `consoleLogger`, `randomIds()`.
  - **`node.ts`**: `createNodeHarness(o?: { env?; cwd?; wrapLlm? })`, wiring `loadEnv`, `createAnthropicLlm(createLlmClient(…), {…, proxyControls, logger})`, `loadCatalog`, `createRendererPort`, `wordCountQa`, `createSqliteStore`, `loadPrompts`.

- [ ] **Step 1: Write the failing tests** (FakeLlm, fake renderer/QA ports, `memoryStore`):
  - `registry.test.ts`:
    - `timeouts 90000/45000/30000/60000/45000`.
    - `dependsOn graph`.
    - `content/design/patch versions embed prompt version and model`.
  - `events.test.ts`:
    - `persisted before publish; envelope seq matches`.
    - `afterSeq replay then live with no gap or duplicate`.
  - `pipeline.test.ts`:
    - happy path (artifacts, accepted rev 1);
    - event order with summaries;
    - `QA fail then pass` (patch.1/render.1/qa.1; accepted deck rev 2);
    - `QA never passes → qa_failed`;
    - `preflight failure before any stage`;
    - `budget`;
    - `stage error stops`;
    - `render warnings as stage:warning`;
    - `cancel during content`;
    - `cancel a queued job never preflights`;
    - `max 2 concurrent`;
    - `listJobs newest first`.
  - `ownership.test.ts`:
    - `a second harness leaves a fresh-heartbeat job alone`.
    - `stale job and its running rows failed on start`.
    - `losing ownership mid-run aborts the job as cancelled "ownership lost" and it emits nothing further`: harness B claims after a forced-stale heartbeat while A's FakeLlm hangs.
    - `heartbeat advances while running`.
  - `rerun.test.ts`:
    - `rerun from design after a patched run starts from accepted deck rev 2; emit_deck and emit_patches not called`.
    - `palette change reruns render only, emit_design and emit_deck are not called` (N3: `rerun({from:"render", choices: newPalette})` → `theme.paletteId` changes in the render input).
    - `motion template change from render → "this choice change affects design; rerun --from design"`.
    - `depth change from design → "… affects content; rerun --from content"`.
    - `rerunning twice gives identical stage rows and artifact set`.
    - `rerun from render prunes patch.1/render.1/qa.1 but keeps accepted/`.
    - `missing accepted/deck.json → InputError naming it, no events`.
    - `corrupt accepted/design.json → InputError`.
    - `rerun of a running job → InputError "is running"`.
    - `job.usage accumulates`.
  - `resume.test.ts`:
    - `failed at design → resumes from design without calling emit_deck`.
    - `failed in the patch loop → resumes from render with accepted docs`.
    - `succeeded → InputError`.
    - `qa_failed → InputError "use rerun"`.
  - `node.test.ts`: `missing LLM_API_KEY → EnvError`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the harness tests + `pnpm typecheck && pnpm lint`. Expected: PASS.
- [ ] **Step 5: Commit** as `feat(harness): pipeline with accepted documents, fenced ownership, replayable events, rerun and resume`.

---

### Task 14: CLI (`pnpm forge run|rerun|resume`) + tsx spawn test

**Files:**
- Create: `src/cli/{args,format,run-cli,main}.ts`, `test/cli/*.test.ts`, `test/cli/fake-entry.ts`, `test/fixtures/solar.brief.json`
- Modify: root `package.json` (`"forge": "tsx packages/harness/src/cli/main.ts"`)

**Interfaces:**
- Produces:
  - `parseCli(argv)` returns one of:
    - `{kind:"run"; briefPath; choicesPath?}`;
    - `{kind:"rerun"; jobId; from; choicesPath?}`;
    - `{kind:"resume"; jobId}`;
    - `{kind:"usage"; message}`. `--from patch` gives `from must be one of content, design, render, qa`.
  - `formatEvent(e): string | null`. Exact strings, with the label `[stage]` or `[stage#n]`:
    - `[content] started`
    - `[content] calling claude-sonnet-5-5 (attempt 1/3)`
    - `[content] retry 1/3 (validation): <detail>`
    - `[content] rate limited (429), waiting 2.0s`
    - `[render] warning: <message>`
    - `[content] done in 41.2s · 12,345 tokens`, plus ` · 4.0s rate-limited` when `backoffMs > 0`
    - `[content] error (timeout): stage content exceeded 90000 ms`
    - `job <id> succeeded · 54,321 tokens · <distDir>/index.html` | `qa_failed` | `failed (<kind>): <message>` | `cancelled (<reason>)`
    - queued/started → `null`
  - `runCli(argv, io:{stdout, stderr, cwd, signal?}, makeHarness): Promise<number>`:
    - reads the JSON files;
    - without `--choices`, uses `defaultChoices(catalog)`: depth `standard`, the first family's `defaultsForFamily`, the first interaction mode, its `questionCount` default;
    - streams `formatEvent` lines;
    - aborting `io.signal` cancels;
    - **always awaits `harness.close()` (the event flush) before returning**.

    Exit codes: succeeded 0, failed 1, usage/`InputError` 2, qa_failed 3, cancelled 130. `main.ts` wires SIGINT and `createNodeHarness`.
  - `test/fixtures/solar.brief.json`: a test-only brief, not a golden.
  - `test/cli/fake-entry.ts`: `runCli` with `createHarness`, a FakeLlm scripted with `standard.deck.json` (contains a Diagram) and a valid design wire, the **real** `createRendererPort`, `wordCountQa` and `createSqliteStore`.

- [ ] **Step 1: Write the failing tests:**
  - `args.test.ts`: run, run --choices, rerun, `resume j_1`, missing --from, `--from patch`, unknown command.
  - `format.test.ts`: every exact string above.
  - `run-cli.test.ts`:
    - `run exits 0`.
    - `preflight message exact, exit 1`.
    - `invalid brief exit 2 naming "topic"`.
    - `qa_failed exit 3`.
    - `abort → 130`.
    - `rerun --from design prints no "[content]"`.
    - `resume after a design failure exits 0`.
    - `rerun with missing accepted deck exits 2`.
    - `every emitted event is persisted before runCli resolves` (`store.events.list` length equals the events seen).
  - `main.spawn.test.ts`:
    - `no args → usage, exit 2`.
    - `forge run under tsx renders the diagram as svg`: spawn `tsx test/cli/fake-entry.ts run test/fixtures/solar.brief.json` with a tmp jobs dir → exit 0; `<svg` inside `.df-diagram`; no `df-diagram-fallback`; no `[render] warning: diagram` line.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests, then `pnpm forge` from the root. Expected: tests PASS; usage text, exit 2.
- [ ] **Step 5: Commit** as `feat(harness): forge CLI (run, rerun, resume) with streamed events; tsx end-to-end spawn test`.

---

### Task 15: Golden suite, patch-loop golden, live test

**Files:**
- Create: `fixtures/golden/{1..9}.brief.json`, `fixtures/golden/{1..9}.cassette.json`, `fixtures/golden/1.patch-loop.cassette.json`, `packages/harness/scripts/record-golden.ts`, `test/golden.test.ts`, `test/live/pipeline.live.test.ts`

**Interfaces:**
- Produces:
  - Brief n pairs with `goldenChoices(catalog)[n-1]` (`language:"en"`; 2–4 sentences on what the audience should know or do afterwards). Topic / audience / duration:
    1. "How solar cells work" / general / 10
    2. "Kubernetes autoscaling for SREs" / technical / 20
    3. "Quarterly revenue review" / executive / 10
    4. "Why your startup needs a design system" / general / 10
    5. "The water cycle" / students / 10
    6. "Personal budgeting basics" / students / 20
    7. "Zero-trust networking basics" / technical / 10
    8. "Healthy sleep habits" / students / 20
    9. "Creatures of the deep sea" / general / 10
  - `record-golden.ts [n…] [--patch-loop]`:
    - `createNodeHarness({ wrapLlm: l => new RecordingLlm(l) })` with a tmp jobs dir;
    - `--patch-loop` (golden 1) wraps QA with `failFirstQa(wordCountQa, deck => the id of the slide with the most visible words)`;
    - requires `succeeded`;
    - writes the cassette.
  - **Allow-list (N4)**, in the test file:
    - `PENDING_COMPONENT_IDS = ["df-hotspot","df-reveal","df-chart","df-compare","df-tabs","df-timeline","df-zoom","df-quiz","df-poll","df-score"]`: the catalog components the renderer doesn't implement yet, pending Plan 2b.
    - `PENDING_THREEJS_WARNING = "threeJs requested but not supported by this renderer yet"`, allowed only for goldens whose choices have `threeJs: true`.
    - A guard test asserts `PENDING_COMPONENT_IDS` ⊆ the catalog component ids.

- [ ] **Step 1: Write the briefs and the failing tests:**
  - `golden.test.ts` (sequential, `timeout 180_000`, real renderer):
    - `one brief per compat.golden entry`.
    - `PENDING_COMPONENT_IDS are catalog components`.
    - Per n, `golden <n> (<family>/<motion>/<interaction>)`:
      - `succeeded`;
      - artifacts and accepted docs exist;
      - `slideIds` match the deck;
      - `index.html` exists;
      - `totalBytes <= 2_621_440`;
      - `qa.pass`;
      - `fake.remaining() === 0`;
      - `dist/assets/theme.css` contains `--df-bg: <golden palette roles.bg>`;
      - **every manifest warning** either matches `/^slide (\S+): (\S+) is not supported by this renderer yet; rendered statically$/` with the captured component id ∈ `PENDING_COMPONENT_IDS`, or equals `PENDING_THREEJS_WARNING` on a threeJs golden. Anything else, including any `diagram` warning, fails;
      - every `stage:warning` is in `manifest.warnings`.
    - `golden patch loop`: patch.1/render.1/qa.1; `succeeded`; accepted deck rev 2 from patch#1, differing from `content.json`'s output.
    - `replay is deterministic`: identical outputs and `inputHash`es.
    - `a stale cassette fails loudly` (modified prompt text → the re-record message).
  - `pipeline.live.test.ts` (`DECKFORGE_LIVE === "1"`):
    - `preflight passes, including the x-proxy-controls check`.
    - `golden 1 end to end`: `succeeded`; each content attempt < 90 s; **job wall time ≤ 120_000 ms** (§8); tokens < budget.
- [ ] **Step 2: Run** the harness tests. Expected: golden FAIL (no cassettes); live skipped.
- [ ] **Step 3: Record** with `DECKFORGE_LIVE=1 pnpm --filter @deckforge/harness record:golden` and `… record:golden 1 --patch-loop` (proxy on `main` with Task 1 merged). On a validation failure, improve the prompt and re-record. **Never loosen a validator.** If the proxy is unavailable, report BLOCKED.
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck && pnpm lint` with the proxy **stopped**, then `DECKFORGE_LIVE=1 pnpm --filter @deckforge/harness test -- test/live`. Expected: PASS. Note the golden wall time in the commit body.
- [ ] **Step 5: Commit** as `test(harness): golden briefs + fingerprinted cassettes, patch-loop golden, live §8 timing test`.

---

## Roadmap after this plan

| Plan | Notes carried forward |
|---|---|
| 2b. Renderer interactions + depth | As each component or Three.js lands, delete it from `PENDING_COMPONENT_IDS` / `PENDING_THREEJS_WARNING`. |
| 4. QA | Implement `QaPort` with Playwright and add QA error kinds. `qaFailureReasons` feeds the badges. |
| 5. Wizard | `LlmPort.completeText` for the Step 1 hint. `"."` is browser-safe. |
| 6. Progress/Result + SSE | `/api/jobs/:id/events` = `harness.subscribe(jobId, fn, { afterSeq })`. The filmstrip comes from the render summary, badges from the qa summary, and the list from `listJobs`. |
| 7. Export, per-slide regenerate, tweaks | Add a `regenerateSlide` stage that writes `accepted/deck.json`, then `rerun --from render`. Palette/type tweaks = `rerun --from render --choices` (no LLM); motion tweaks = `--from design`. Add the `export` stage. |

## Self-review

- **Spec coverage:**
  - §0 → Tasks 5, 7, 10, 11.
  - §1a → Tasks 1, 3, 7.
  - §2/§3 → Tasks 8, 11, 12.
  - §4 → Tasks 9, 10, 13, 15.
  - §5 progress needs → Tasks 5, 12, 13.
  - §7.3 → Tasks 7, 14.
  - §8 (≤ 120 s; tweaks never call content) → Tasks 13, 15.
- **Findings:**
  - C1 → Tasks 4, 12, 14, 15.
  - C2 → superseded by N2 (no caching; `inputHash` for audit/rerun).
  - C3 → Tasks 4, 10, 12.
  - C4 → accepted docs with content inline (Tasks 9, 13).
  - I1 → Task 2.
  - I2 → Tasks 3, 5, 10, 15.
  - I3 → Task 1 (+ marker, controller merge), Task 7 (quota, controls check), S9.
  - I4 → Tasks 5, 9, 13, 14 (flush before exit).
  - I5/N1 → fenced `JobSession` (Tasks 5, 9), heartbeat loss + claim/rerun refusal (Task 13).
  - I6 → Tasks 6, 15.
  - I7 → Task 3.
  - I8 → helpers in Task 5, design wire in Task 8, the test-only brief in Task 14.
  - I9 → `ContentChoices`/`DesignChoices` + `inputHash` comparison.
  - M1 → `upstreamOf`.
  - M2 → no stage transient retries.
  - M3 → resolved-path architecture test.
  - M4 → exact `@deckforge/renderer/hash` whitelist (kept in the renderer to avoid churn).
  - M5 → `usageKnown`.
  - M6 → per-component `disallowedSlideTypes`.
  - N3 → Tasks 11, 12, 13.
  - N4 → Task 15.
- **Type consistency checked:**
  - `StageDef` (`fingerprint`, no `cacheable`/`cacheKey`)
  - `JobSession`
  - `DesignPlan` (no theme) and `RendererPort.build({theme, motion, interaction})`
  - `ContentChoices`/`DesignChoices`
  - `EventEnvelope`
  - `AcceptedDoc`
  - `compileWireSchema`
  - `AgentRequest`/`requestFingerprintOf`
- **Ordering:** the spike is Task 3. It needs the compiled deck schema (Task 2) and the proxy branch (Task 1), both wave 0.
