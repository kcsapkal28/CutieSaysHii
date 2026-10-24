# DeckForge efficiency plan: measure, check deterministically, converge faster

Status: approved 2026-10-24 (steps 0 and 1 started). Supersedes the first draft of "context and harness engineering".

## Why
In the Moon test deck (4 slides) the build stage cost about $14 of $18, and every slide ran all 3 rounds (2 plus the Opus escalation); round 3 was the best attempt on all four and two still ended at "fix". Outline, script and storyboard together took about two minutes. The cost is slides that do not converge, not context passing between stages.

## Goals
- Cost per slide about $1.5 or less (from about $3.5), most slides passing by round 2, quality score no worse than before. These are proposals until the baseline exists.
- Quality comes first: a cheaper deck that looks worse is a loss.

## Steps
0. **Baseline.** A per-call journal (one JSON line per call: run, stage, label, model, tokens in/out/cache, ms, outcome) and `forge eval`, which builds a fixed set of 4 diverse topics and prints cost per deck, wall-clock, first-pass rate, rounds per slide and final score. Freeze a "before" run.
1. **Deterministic pre-checks.** Before the vision critic, a headless-browser pass measures overflow and clipping, off-canvas elements, overlapping text, tiny text, contrast, console errors, external requests, blank renders, WebGL canvases that draw nothing, and interaction steps that change nothing. Failures go straight to the builder as measured facts; the critic is skipped for that round.
2. **Converge faster.** Critic returns at most 5 ranked issues, each with a selector and a measurement. Stop rule decided from data. Screenshots stay out of the builder once step 1 supplies measurements.
3. **Context diet.** Order prompts so the stable parts come first (rules, design contract, exemplars) to raise cache hits; trim exemplars to the relevant snippets.
4. **Design contract as code.** Tokens and kit classes in the shell plus a lint (no literal colours, fonts or off-scale sizes) and a cheap deck-level cohesion check. No generated reference slide unless the cohesion check shows a gap.
5. **Outline unification (optional, last).** An arc first, then per-slide cards expanded in parallel, with a migration for existing projects. Justified as simplicity, not speed.
6. **Model tiering by experiment.** Builder and critic on Sonnet vs Opus across the eval set; choose on pass rate, score and cost.

## Rejected or changed from the first draft
- "Summary of the preceding visual state" for parallel builds is incoherent; entry and exit state belong in the outline instead.
- Opus builder plus a fast-model critic reverses what was measured (Sonnet with thinking off was 2.2x faster) and risks a critic that passes everything; decide by experiment (step 6).
- Merging outline, script and storyboard is a UX and migration change, not a cost fix, so it is step 5.
