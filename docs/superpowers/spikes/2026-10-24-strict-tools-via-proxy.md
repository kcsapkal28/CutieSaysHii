# Spike: strict tool use and proxy controls through the live proxy (Task 3)

**Status: BLOCKED.** S2b failed. Strict tool use rejects the real `emit_deck` wire schema with
`400 The compiled grammar is too large`. The rejection happens before generation, for both effort `medium` and `low`.
`CONTENT_EFFORT` therefore can't be determined, and S5 can't be measured on the deck request as specified.
Every other check ran and is recorded below.

- **Run:** 2026-10-24 (UTC timestamps 2026-10-23T19:55–19:58Z).
- **Proxy:** `http://localhost:4001`, `claude-openai` branch `feature/deckforge-passthrough-controls` @ `e268330`, running with `VERBOSE=0`.
- **SDK:** `@anthropic-ai/sdk` 1.1.0 (the harness pin).
- **Models:** `claude-sonnet-5-5`, `claude-haiku-5-5`.
- **Client:** `new Anthropic({ baseURL, apiKey, maxRetries: 0, defaultHeaders: { "x-proxy-max-retries": "0" } })`. Every message request used `tool_choice {type:"auto"}`, `strict: true`, top-level `cache_control {type:"ephemeral"}` and `output_config.effort`. None sent sampling params or `thinking`.
- **Script:** scratch only, never committed (global constraint). It imported `compileWireSchema`, `SlideSchema`, `DeckSpecSchema` and `loadCatalog` from the repo by absolute path and ran under the repo's `tsx`.
- **Account state:** the 5h unified utilization was `0.66` and the 7d was `0.28` (from S2's headers).

## Results

| Check | Result | Key facts |
|---|---|---|
| S1 `models.list()` | PASS | 200, 740 ms. 14 ids, `has_more:false`. Includes `claude-sonnet-5-5` and `claude-haiku-5-5` (also `claude-opus-5-5`, `claude-fable-5-1`, `claude-opus-5`, `claude-sonnet-5`, `claude-fable-5`, `claude-opus-4-8`, `claude-opus-4-7`, `claude-sonnet-4-6`, `claude-opus-4-6`, `claude-opus-4-5-20251101`, `claude-haiku-4-5-20251001`, `claude-sonnet-4-5-20250929`). |
| S2 Sonnet strict probe | PASS | 200, 4794 ms, `stop_reason:"tool_use"`, `stop_details:null`. `emit_probe` called, and the input passes Zod after `normalize`: `{meta:{count:3,level:"mid",tags:["a","b"]},shape:{kind:"rect",width:2,height:5},note:null}`. Usage: `input_tokens 4`, `cache_creation_input_tokens 728`, `cache_read 0`, `output_tokens 139` (`thinking_tokens 0` at effort `low`). |
| S2b real deck schema, effort `medium` ×2 | **FAIL** | Both runs returned `400 BadRequestError` in 1178 ms and 661 ms: `{"type":"error","error":{"type":"invalid_request_error","message":"The compiled grammar is too large, which would cause performance issues. Simplify your tool schemas or reduce the number of strict tools."}}` (`req_011CgKkwp4e8MFDpm6gBtC7b`, `req_011CgKkws2E2tzEnuX3KeZkL`). No tool call, no `output_tokens`, so `DeckSpecSchema.parse(normalize(input))` wasn't reachable. Schema: `unionParamCount 7` (under `UNION_PARAM_LIMIT = 16`), 3849 bytes of JSON Schema. |
| S3 Haiku strict probe | PASS | 200, 4293 ms, `tool_use`, valid input identical to S2. `cache_creation 728`, `output_tokens 139`. |
| S4 forced `tool_choice {type:"tool"}` | PASS (400 as expected) | `400 BadRequestError`: `tool_choice: type "tool" and "any" are not supported for this model.` |
| S4 `temperature: 0.2` | PASS (400 as expected) | `400 BadRequestError`: `` `temperature` is deprecated for this model. `` The 1.1.0 types don't declare `temperature` on `MessageCreateParamsBase` at all, so the call needed a cast. |
| S5 cache on S2b repeat | NOT MEASURABLE as specified | S2b never returned 200. **Substitute:** S2's exact probe request, repeated 59 s later, returned `cache_read_input_tokens 728`, `cache_creation 0`, `input_tokens 4` and 1970 ms (vs 4794 ms cold). Top-level `cache_control` caches the whole prefix, including the proxy's prepended billing system block. |
| S6 `beta.messages.create` with `betas:["server-side-fallback-2026-07-01"], fallbacks:"default"` | PASS (accepted) | 200, 2055 ms, `tool_use`, valid probe input, `stop_details:null`. Usage carries an `iterations:[{type:"message", model:null, …}]` array (one entry, no fallback used). The proxy merged the beta flag into its OAuth `anthropic-beta` header without complaint. |
| S7 effort `low` on S2b | **FAIL** | Same `400 compiled grammar is too large`, 837 ms (`req_011CgKm1gHBWUCARidmmZSFn`). Effort doesn't affect the rejection. |
| S8 client on `http://127.0.0.1:1` | PASS, with a finding | `APIConnectionError` ("Connection error."), `instanceof APIError` with `status` undefined. The cause chain is `TypeError "fetch failed"` → `Error "bad port"` with **no `code`**: port 1 is on the fetch spec's blocked-port list, so no connect is attempted. |
| S8b (supplementary) closed ephemeral port | PASS | `APIConnectionError` → `TypeError "fetch failed"` → `Error{code:"ECONNREFUSED"}`. The code sits at **`err.cause.cause.code`**, not `err.cause.code`. |
| S9a `x-proxy-max-retries: 0` | PASS | `GET /v1/models` returned 200 with `x-proxy-controls: 1`. Every message call above also sent the header (via `defaultHeaders`), and all their responses, including the 400s, carried `x-proxy-controls: 1`. |
| S9b `anthropic-ratelimit-*` on a 200 | PASS | On S2 via `withResponse()`: `anthropic-ratelimit-unified-{status,reset,representative-claim,fallback,fallback-percentage,overage-status,overage-disabled-reason}` and `anthropic-ratelimit-unified-{5h,7d}-{status,reset,utilization}`. No `retry-after` on a 200. |
| S9c abort Sonnet after 1 s | PASS | Client: `APIUserAbortError` ("Request was aborted.") at 1006 ms. Proxy log: `[passthru-a9e4c91b-…] client closed — upstream aborted`. **Method note:** the 4001 proxy runs with `VERBOSE=0`, so its `log()` is a no-op and it can't show this line. The check therefore ran against a temporary second instance of the same checkout (`VERBOSE=1 AUTO_REFRESH_AUTH=0 PORT=4010 ANTHROPIC_PORT=4011 BIND_HOST=127.0.0.1`), stopped right after. The 4001 proxy wasn't touched. The request was a long free-text generation, because the deck request is rejected in under 1 s. |
| S9d `x-proxy-max-retries: 99` | PASS | `400 BadRequestError` from the proxy itself, with body `{"error":{"message":"x-proxy-max-retries must be an integer 0-10","type":"invalid_request_error","param":null,"code":null}}`. This proxy-local error body has no top-level `type` and no `request_id`, and `requestID` is `null`. |

### Diagnostics on the S2b failure (not in the brief; max_tokens 32, so effectively nothing was generated)

| Variant | unionParamCount | Schema bytes | Result |
|---|---|---|---|
| Real: `slides[].type` = `z.enum(16 slide-type ids)`, `body` = all 11 block kinds | 7 | 3849 | 400 grammar too large (S2b) |
| D1: `slides[].type` = `z.string()` (`enumOrString` fallback), all 11 block kinds | 7 | 3705 | **400 grammar too large** |
| D2: enum type, `body` = only `Bullets`/`Paragraph` | 2 | 1007 | **accepted** (200, `stop_reason:"max_tokens"`, `cache_creation 1946`) |

The slide-type enum isn't the cause. The 11-way block union is: optional fields add 5 more `anyOf`s inside an array, inside an array. The `UNION_PARAM_LIMIT = 16` budget doesn't predict the server's grammar-size limit. A schema with 7 union params is still rejected.

## Confirmed SDK calls (1.1.0, through the proxy)

- `client.models.list({ limit: 1 }, { headers }).withResponse()` → `{ data, response }`, where `response.headers.get("x-proxy-controls")` is `"1"`.
- `client.messages.create({ model, max_tokens, system, messages, tools: [{ name, description, input_schema, strict: true }], tool_choice: { type: "auto" }, output_config: { effort }, cache_control: { type: "ephemeral" } }, { timeout, signal }).withResponse()`. `strict`, `output_config.effort` and top-level `cache_control` are typed in 1.1.0.
- `client.beta.messages.create({ …same…, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" })`. `fallbacks: "default"` is typed (`BetaFallbacksParam = Array<…> | 'default'`).
- Response fields: `stop_reason`, `stop_details` (`null` on normal tool use), `usage.{input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens, output_tokens_details.thinking_tokens}`. With top-level `cache_control`, almost all input is reported as cache creation/read (`input_tokens` was 4).

## Error classes observed

- `BadRequestError` (400):
  - Upstream: `e.status`, `e.error` = `{type:"error", error:{type, message}, request_id}`, `e.requestID`, `e.headers` (fetch `Headers`, with `x-proxy-controls`).
  - Proxy-local (S9d): `e.error` = `{error:{message, type, param, code}}`, `e.requestID === null`.
- `APIConnectionError`: `instanceof APIError` with `status === undefined`. The OS code is at `err.cause.cause.code` (`ECONNREFUSED`), and is absent for blocked fetch ports such as 1.
- `APIUserAbortError`: `instanceof APIError`, `status === undefined`, message `"Request was aborted."`.
- Not observed in this run: 401/403, 429 and 5xx.

## Decisions

| Decision | Value | Basis |
|---|---|---|
| Spike status | **BLOCKED** | Step 3: S2b failing → BLOCKED. S2 and S3 pass. |
| `CONTENT_EFFORT` | **undetermined (BLOCKED)** | Neither `medium` (S2b) nor `low` (S7) reaches generation, so no latency exists to compare against 60 s. |
| `REFUSAL_FALLBACK_DEFAULT` | `true` | S6 was accepted through the proxy's OAuth path. |
| `PROMPT_CACHE_EFFECTIVE` | `true` (provisional) | Measured on the S2 probe repeat (`cache_read_input_tokens 728 > 0`), not on S2b's request as specified. Re-measure S5 once S2b passes. |

### Other defaults these results imply (for Task 7)

- Classify connection errors by `instanceof APIConnectionError` **before** any generic `APIError`/status check (its `status` is undefined). Read `ECONNREFUSED` from `err.cause?.cause?.code`.
- Tests must not use port 1 (or other fetch-blocked ports) for "closed port". Bind port 0, close it, and use that port.
- Proxy-local 400s have a different body shape from upstream 400s. Don't rely on `request_id`/top-level `type`.
- Fast-fail 400s on `tool_choice` forcing and `temperature` confirm the request rules: never send either.

### To unblock

`emit_deck`'s strict grammar has to shrink. That is an architectural choice for the controller/plan. Options include:

- carry `body` as a JSON string field validated by Zod after parsing (as `emit_design` does with `propsJson`);
- flatten the block union into one object with a `type` enum and nullable fields;
- split generation.

Then re-run S2b ×2, S5 and S7 against the new schema to set `CONTENT_EFFORT` and confirm `PROMPT_CACHE_EFFECTIVE`.
