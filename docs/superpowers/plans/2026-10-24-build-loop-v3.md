# Build loop v3: journal-driven fixes, data-flow cuts, a loop that stops when it should

Branch: `feat/v3-build-loop` (from main @ d3ae31c). Evidence: every journal written so far (14 projects, 1,770 lines, 147 builder calls, 81 critic calls).

## What the journals say

| Finding | Evidence | Consequence |
|---|---|---|
| Hung model calls are the worst latency bug | 14 builder calls timed out at 15 min, each retried once (30 min lost per slide); 1 critic call at 10 min ×2. All in one run, same minute: the upstream stalled, every in-flight call waited the full cap. Median critic→next build gap in that run: 28 min. | A stall anywhere costs 20–30 min per slide. Median healthy builder call is 31 s. |
| Fix rounds past the second almost never pass | Pass by round: r1 9/35, r2 3/27, r3 0/9, r4 1/9. 11 slides ran 4 attempts, 1 ran 5. | Attempts 3+ cost ~1 min and ~$0.20 each and return a worse slide 95% of the time. |
| Patches that make the pre-check worse trigger a full rewrite | 40 patches applied, 12 fell back to a rewrite because hard failures grew (0→1, 0→2, …). | Each rewrite is another draft-sized call (~35 s, ~$0.15) with the round-3 pass rate above. |
| Pre-check catches real structure, mostly overlap | kinds: text-overlap 42, low-contrast 20, console-error 10, off-canvas 4, tiny-text 2, clipped 1. | Overlap is the one class worth a deterministic auto-fix later; the rest are builder-prompt territory (done on main). |
| Nested tool output still arrives flattened sometimes | critic `issues: Expected array, received string` (1/81); outline cards 100% before the repair. | Arrays of objects need the same repair as objects, or a retry that doesn't lose the round. |
| Research and style run in series though neither needs the other | style 9 s, research 41–87 s, always sequential before outline. | ~10 s per deck, free. |
| Outline cards never read each other's cache | outline: 854k cache-write vs 400k cache-read tokens. | ~$0.2 per deck at Sonnet prices; a warm call fixes it. |

## Changes (in order; each a commit with tests)

1. **Transport hardening (llm.ts).** Streaming idle timeout: abort a call when no stream event arrives for `idleMs` (default 45 s); per-attempt caps lowered to what the medians justify (builder 6 min, critic 4 min, outline 5 min, research 3 min; default 4 min); a timed-out call retries once, then fails fast. Journal `attempts` and the timeout reason.
2. **Build loop budget and stop rules (build.ts, config.ts).** `precheckRetries` 2→1; a patch that measures worse keeps the best version and ends the slide instead of rewriting (`patchWorse: "stop"`, "rewrite" stays available); a per-slide wall budget (`slideBudgetMs`, 8 min) after which no new attempt starts; `concurrency` 6→8 (the passthrough proxy has no limiter).
3. **Array repair (llm.ts parseLenient).** `expected array, received string` → parse JSON or a `<parameter>` list; unrecoverable → the existing retry.
4. **runAll parallel prelude (stages.ts).** style ‖ research when both are due.
5. **Outline card cache (outliner.ts).** System blocks with a cached shared prefix (card prompt + brief/style/arc) and one warm call before the fan-out; cards concurrency 8.
6. **Critic input diet (critic.ts).** Send the card's focus, anchors, legend, steps and concept instead of the whole storyboard JSON.
7. **Measure.** One 4-topic × 2-slide eval (~$8) against `prompts-before`; report cost, wall-clock, first-pass, rounds, score, per-class issue counts.

Not in scope: the Studio UI; the component/spec architecture; web search.
