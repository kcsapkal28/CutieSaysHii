# Spike: strict tool use and proxy controls through the live proxy (Task 3)

**Status: DONE, with a controller ruling.** In round 1, strict tool use rejected the real `emit_deck` wire schema (`400 The compiled grammar is too large`). The controller then ruled that tools get a per-tool `strict` flag. `emit_deck` is non-strict: it keeps the same `compileWireSchema` JSON Schema as `input_schema`, its reply is validated with Zod after `normalize`, and it gets ≤ 2 corrective retries. Strict stays on for every tool whose grammar compiles. Round 2 re-ran S2b, S5 and S7 under that ruling and probed the other tools' grammars. All checks now have an outcome.

- **Run:** 2026-10-24 (UTC timestamps 2026-10-23T19:55–20:03Z). Round 1 ran 19:55–19:58Z and round 2 ran 20:01–20:03Z.
- **Proxy:** `http://localhost:4001`, `claude-openai` branch `feature/deckforge-passthrough-controls` @ `e268330`, running with `VERBOSE=0`.
- **SDK:** `@anthropic-ai/sdk` 1.1.0 (the harness pin).
- **Models:** `claude-sonnet-5-5`, `claude-haiku-5-5`.
- **Client:** `new Anthropic({ baseURL, apiKey, maxRetries: 0, defaultHeaders: { "x-proxy-max-retries": "0" } })`. Every message request used `tool_choice {type:"auto"}` (S4 shows forcing is rejected), top-level `cache_control {type:"ephemeral"}` and `output_config.effort`. None sent sampling params or `thinking`.
- **Script:** scratch only, never committed (global constraint). It imported `compileWireSchema`, `SlideSchema`, `DeckSpecSchema` and `loadCatalog` from the repo by absolute path and ran under the repo's `tsx`.
- **Account state:** the 5h unified utilization was `0.66` and the 7d was `0.28` (from S2's headers).

## Results

| Check | Result | Key facts |
|---|---|---|
| S1 `models.list()` | PASS | 200, 740 ms. 14 ids, `has_more:false`. Includes `claude-sonnet-5-5` and `claude-haiku-5-5` (also `claude-opus-5-5`, `claude-fable-5-1`, `claude-opus-5`, `claude-sonnet-5`, `claude-fable-5`, `claude-opus-4-8`, `claude-opus-4-7`, `claude-sonnet-4-6`, `claude-opus-4-6`, `claude-opus-4-5-20251101`, `claude-haiku-4-5-20251001`, `claude-sonnet-4-5-20250929`). |
| S2 Sonnet strict probe | PASS | 200, 4794 ms, `stop_reason:"tool_use"`, `stop_details:null`. `emit_probe` called (nested object, discriminated `anyOf`+`const`, nullable `anyOf`, integer, enum), and the input passes Zod after `normalize`: `{meta:{count:3,level:"mid",tags:["a","b"]},shape:{kind:"rect",width:2,height:5},note:null}`. Usage: `input_tokens 4`, `cache_creation_input_tokens 728`, `output_tokens 139`. |
| S2b round 1: real deck schema, **strict** | FAIL | `400 BadRequestError` ×2 (1178 ms and 661 ms): `"The compiled grammar is too large, which would cause performance issues. Simplify your tool schemas or reduce the number of strict tools."` (`req_011CgKkwp4e8MFDpm6gBtC7b`, `req_011CgKkws2E2tzEnuX3KeZkL`). Effort `low` fails the same way. `unionParamCount 7`, 3849 B schema. |
| **S2b round 2: real deck schema, `strict:false`, effort `medium`, ×2** | **PASS** | **Run 1:** 200, **18119 ms**, `output_tokens 2516` (`thinking_tokens 0`), tool called, `stop_reason:"tool_use"`, no text blocks, `DeckSpecSchema.parse(normalize(input))` succeeds. 10 slides: title, agenda, diagram, bullets, chart, compare, stat, timeline, summary, qa. **Run 2:** 200, **19659 ms**, `output_tokens 2657`, tool called, parse succeeds. 13 slides (adds 3 `section` slides). |
| S3 Haiku strict probe | PASS | 200, 4293 ms, `tool_use`, valid input identical to S2. |
| S4 forced `tool_choice {type:"tool"}` | PASS (400 as expected) | `400 BadRequestError`: `tool_choice: type "tool" and "any" are not supported for this model.` |
| S4 `temperature: 0.2` | PASS (400 as expected) | `400 BadRequestError`: `` `temperature` is deprecated for this model. `` The 1.1.0 types don't declare `temperature` on `MessageCreateParamsBase`, so the call needed a cast. |
| **S5 cache on the deck request** | **PASS** | S2b round 2 run 1 wrote `cache_creation_input_tokens 3275`. Run 2, sent 20 s later with the identical request, read `cache_read_input_tokens 3275` with `cache_creation 0` and `input_tokens 4`. S7 (effort `low`, same prefix) also read 3275, so the effort setting doesn't break the cache prefix. Round 1's substitute on the S2 probe also read 728. |
| S6 `beta.messages.create` with `betas:["server-side-fallback-2026-07-01"], fallbacks:"default"` | PASS (accepted) | 200, 2055 ms, `tool_use`, valid probe input, `stop_details:null`. Usage carries `iterations:[{type:"message", model:null, …}]` (one entry, no fallback used). |
| **S7 effort `low` vs `medium` on the deck request (`strict:false`)** | **PASS** | `low`: 200, **23888 ms**, `output_tokens 2476`, tool called, parse succeeds, 10 slides. `medium`: 18119 / 19659 ms (S2b round 2). **`low` was not faster.** All runs are far under the 90 s per-attempt content timeout and the 60 s decision threshold. |
| S8 client on `http://127.0.0.1:1` | PASS, with a finding | `APIConnectionError` ("Connection error."), `instanceof APIError` with `status` undefined. Cause chain: `err.cause` = `TypeError "fetch failed"`, then `err.cause.cause` = `Error "bad port"` with **no `code`**. Port 1 is on the fetch spec's blocked-port list, so no connect is attempted. |
| S8b (supplementary) closed ephemeral port | PASS | `APIConnectionError`; `err.cause` = `TypeError "fetch failed"` (no `code`); **`err.cause.cause.code === "ECONNREFUSED"`**. The OS error code is at `err.cause.cause.code`; `err.cause.code` is undefined. |
| S9a `x-proxy-max-retries: 0` | PASS | `GET /v1/models` returned 200 with `x-proxy-controls: 1`. Every message call also sent the header (via `defaultHeaders`), and every response, including the 400s, carried `x-proxy-controls: 1`. |
| S9b `anthropic-ratelimit-*` on a 200 | PASS | On S2 via `withResponse()`: `anthropic-ratelimit-unified-{status,reset,representative-claim,fallback,fallback-percentage,overage-status,overage-disabled-reason}` and `anthropic-ratelimit-unified-{5h,7d}-{status,reset,utilization}`. No `retry-after` on a 200. |
| S9c abort Sonnet after 1 s | PASS | Client: `APIUserAbortError` ("Request was aborted.") at 1006 ms. Proxy log: `[passthru-a9e4c91b-…] client closed — upstream aborted`. **Method note:** the 4001 proxy runs with `VERBOSE=0`, so its `log()` is a no-op and it can't show this line. The check therefore ran against a temporary second instance of the same checkout (`VERBOSE=1 AUTO_REFRESH_AUTH=0 PORT=4010 ANTHROPIC_PORT=4011 BIND_HOST=127.0.0.1`), stopped right after. The 4001 proxy wasn't touched. The request was a long free-text generation. |
| S9d `x-proxy-max-retries: 99` | PASS | `400 BadRequestError` from the proxy itself, with body `{"error":{"message":"x-proxy-max-retries must be an integer 0-10","type":"invalid_request_error","param":null,"code":null}}`. It has no top-level `type` or `request_id`, and `requestID` is `null`. |

### Per-tool strict grammar probes (round 2)

Each probe used `max_tokens 32` and only checked whether the grammar compiles.

| Tool | Schema used | unionParamCount (ours) | Bytes | Strict result |
|---|---|---|---|---|
| `emit_deck` | real: `{title, subtitle, slides: SlideSchema.extend({type: enum(16 slide-type ids)})[]}` | 7 | 3849 | **400 grammar too large** (round 1) |
| `emit_design` | the plan's `designWireSchema` shape, built from the live catalog: `motion.overrides[{slideId enum, transition/enter/emphasis/exit enum (motion vocabulary), easing enum nullable, reason}]`, `interaction.placements[{slideId enum, componentId enum (12 components), blockIndex int nullable, propsJson string}]`; 12 slide ids | 2 | 1877 | **accepted** (200, `stop_reason:"max_tokens"`) |
| `emit_patches` | the plan's `patchWireSchema` shape: `patches[]` = discriminated union on `op` of `shortenText{slideId, title nullable, body: Block[]}`, `splitSlide{slideId, first: Slide, second: Slide}`, `swapLayout{slideId, type enum}`, `dropBlock{slideId, blockIndex int}` | 22 | 11636 | **400**: `"Schemas contains too many parameters with union types (18 parameters with type arrays or anyOf). This causes exponential compilation cost. Reduce the number of nullable or union-typed parameters (limit: 16 parameters with unions)."` (`req_011CgKmJK8Azagu1yYWevLVW`) |

The server counted 18 union parameters where `compileWireSchema` counts 22. The server apparently de-duplicates identical subschemas such as `first`/`second`. Our count is conservative, so `assertUnionBudget` will reject this schema locally before the call. `emit_patches` needs `strict:false` either way.

### Round 1 diagnostics on the deck grammar (strict; `max_tokens 32`)

| Variant | unionParamCount | Bytes | Result |
|---|---|---|---|
| D1: `slides[].type` = `z.string()`, all 11 block kinds | 7 | 3705 | 400 grammar too large |
| D2: enum type, `body` = only `Bullets`/`Paragraph` | 2 | 1007 | accepted |

The cause is the 11-way block union, not the slide-type enum. `UNION_PARAM_LIMIT` doesn't predict the grammar-size limit.

### Observations on non-strict `emit_deck` output (round 2)

These inform Task 11's validators and prompt.

- **Optional fields:** the model sometimes sends `null` (Stat `trend`, Timeline `date`) and sometimes omits the key. `normalize` deletes the nulls and Zod accepts both forms.
- **Ranges and types:** all three runs stayed inside the schema's enums and the 10–14 slide range. They used Bullets, Chart, Compare, Diagram, Stat and Timeline blocks.
- **Notes length:** too short on many slides, though the input said `notesWords [60,120]`. Counting slides after the first:
  - run 1: 4/9 outside the range (55, 57, 57, 25);
  - run 2: 11/12 outside;
  - low: 6/9 outside.

  So `validate/deck` `notes-length` and the corrective retries will do real work. The content prompt (Task 11) should stress the notes minimum.

## Confirmed SDK calls (1.1.0, through the proxy)

- `client.models.list({ limit: 1 }, { headers }).withResponse()` → `{ data, response }`, where `response.headers.get("x-proxy-controls")` is `"1"`.
- `client.messages.create({ model, max_tokens, system, messages, tools: [{ name, description, input_schema, strict }], tool_choice: { type: "auto" }, output_config: { effort }, cache_control: { type: "ephemeral" } }, { timeout, signal }).withResponse()`. `strict`, `output_config.effort` and top-level `cache_control` are typed in 1.1.0.
- `client.beta.messages.create({ …same…, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" })`. `fallbacks: "default"` is typed (`BetaFallbacksParam = Array<…> | 'default'`).
- Response fields: `stop_reason`, `stop_details` (`null` on normal tool use), and `usage` (`input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`, `output_tokens_details.thinking_tokens`).
  - With top-level `cache_control`, nearly all input is reported as cache creation or cache read; `input_tokens` was 4.
  - `thinking_tokens` was 0 on every deck call, at both efforts.

## Error classes observed

- `BadRequestError` (400):
  - Upstream: `e.status`, `e.error` = `{type:"error", error:{type, message}, request_id}`, `e.requestID`, `e.headers` (fetch `Headers`, with `x-proxy-controls`).
  - Proxy-local (S9d): `e.error` = `{error:{message, type, param, code}}`, `e.requestID === null`.
  - Strict-grammar rejections are 400s with the messages quoted above. They are not retryable; they are a schema problem.
- `APIConnectionError`: `instanceof APIError` with `status === undefined`. The OS code is at **`err.cause.cause.code`** (`ECONNREFUSED`); `err.cause` is a `TypeError "fetch failed"` without a code. It is absent entirely for fetch-blocked ports such as 1.
- `APIUserAbortError`: `instanceof APIError`, `status === undefined`, message `"Request was aborted."`.
- Not observed in this run: 401/403, 429 and 5xx.

## Decisions

| Decision | Value | Basis |
|---|---|---|
| Spike status | **DONE** (S2b passes under the controller's `strict:false` ruling) | S2, S2b round 2 and S3 pass. |
| Per-tool `strict` | **`emit_deck: false`, `emit_design: true`, `emit_patches: false`** | Strict grammar probes: deck too large, design accepted, patches over the 16-union limit. |
| `CONTENT_EFFORT` | **`medium`** | Both S2b `medium` runs were ≤ 60 s (18.1 s and 19.7 s), well within the 90 s per-attempt content timeout. `low` (23.9 s) gave no latency gain. |
| `REFUSAL_FALLBACK_DEFAULT` | `true` | S6 was accepted through the proxy's OAuth path. |
| `PROMPT_CACHE_EFFECTIVE` | `true` | S5: the deck request repeated within 5 min read `cache_read_input_tokens 3275 > 0`. |

### Other defaults these results imply (for Task 7)

- Classify connection errors by `instanceof APIConnectionError` **before** any generic `APIError`/status check, because its `status` is undefined. Read `ECONNREFUSED` from `err.cause?.cause?.code`.
- Tests must not use port 1 (or other fetch-blocked ports) as a "closed port". Bind port 0, close it, and use that port.
- Proxy-local 400s have a different body shape from upstream 400s. Don't rely on `request_id` or the top-level `type`.
- The fast-fail 400s on forced `tool_choice` and on `temperature` confirm the request rules: never send either.
- With `strict:false`, a reply can still be text-only or schema-invalid. The "no tool call" and Zod feedback paths in `invokeTool` are the guard.
