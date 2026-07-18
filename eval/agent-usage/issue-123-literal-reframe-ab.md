# Issue #123 — Haiku A/B of the start.md literal-reframe sentence (PR #111 tweak #3)

Measured 2026-07-17. This is the weak-model measurement issue #123's reopen
comment asked for: the PR #111 tweak-#3 sentence ("Treat every label, value,
endpoint, and prefix the task names as a required op argument, not descriptive
prose — put it in the op verbatim …") toggled **alone**, on Haiku, with observed
traces, recorded durably in-repo.

## Protocol

- **Model:** Claude Haiku 4.5 (`claude-haiku-4-5`), one fresh Claude Code
  general-purpose subagent per request, dispatched inside this checkout (same
  harness and channel condition as the PR #111 Haiku rows; in-checkout `taskOk`
  is an upper bound, identical for both arms). A second weak model was not
  available in the dispatch environment (subagent models: Sonnet/Opus/Haiku
  only), so this is Haiku-only by necessity, not choice.
- **Cases:** the three mode-(a) verify-green-but-wrong cases from #121:
  `state_add_done_transition` (the deterministic discriminator),
  `class_add_duck`, `gantt_add_docs_task`. Chat mode, homepage surface.
- **Arms:** A = `--prompt-variant baseline`, B = `--prompt-variant
  no-literal-reframe`. Both prepared with `--inline-start-md`, so each request
  carries the exact (variant-applied) start.md body inline and forbids fetching
  the deployed protocol — the arm request files are byte-identical except the
  one sentence (`diff` confirms). The #122 `describe`/`checkMermaid` read-back
  guidance is present in **both** arms; only the tweak-#3 sentence toggles.
- **Seeds:** 4 independent runs per arm (the issue's minimum), 3 cases each →
  24 fresh subagents. Run dirs `claude-haiku-2026-07-17-issue123-{a,b}-run{1..4}`.
- **Traces:** every subagent dispatched with
  `AM_TRACE_LOG=<run-dir>/traces/<case>.jsonl`; `finalize` grades from the
  observed verbs. 23/24 cases confirmed observed; 7/8 run summaries
  `traceSource: observed`, 1 `mixed` (`a-run3/class_add_duck` logged only
  `verify` — no structured mutate — so its `traceOk` fell to the narrated
  heuristic; it is a `taskOk=false` case either way, so narration cannot have
  inflated the comparison).

## Results (`taskOk`, the primary metric)

| Case | A: with #3 (baseline) | B: without #3 (`no-literal-reframe`) |
|---|---|---|
| `state_add_done_transition` | **4/4** | **2/4** |
| `class_add_duck` | 1/4 | 3/4 |
| `gantt_add_docs_task` | 4/4 | 4/4 |
| **Total** | **9/12** | **9/12** |

`traceOk` was 12/12 in both arms (every agent drove the typed surface;
`{ok:false}` op attempts appear in the trace logs and were retried past).

In the shape of the PR #111 op-error table:

| Model | taskOk with #3 → without #3 | traceSource |
|---|---|---|
| Haiku 4.5 | 9/12 → 9/12 (state case: 4/4 → 2/4; class case: 1/4 → 3/4) | observed (23/24 cases; 1 narrated) |

## Failure anatomy (from the committed transcripts)

- **Arm B state failures (2/4)** ship `Processing --> [*]` with the `: done`
  label **dropped** — exactly the #121 deterministic discriminator, and the
  literal the sentence names as its worked example. Zero occurrences in arm A.
- **All four class failures (A 3, B 1)** ship `+quack() void` — the model
  **added** a return type the task never named. This is the adjacent
  non-verbatim mode (embellishment, not omission); the sentence's examples
  cover dropping only, and it did not prevent adding in either arm.
- **Gantt 8/8:** the #121 literal-date failure did not reproduce in either arm
  (the capabilities `opFields` note and the #122 rail have landed since).

## Interpretation

- **Aggregate: null.** 9/12 vs 9/12. With n=4 seeds/arm neither per-case split
  is statistically significant (Fisher exact, one-tailed: state p≈0.21, class
  p≈0.23) — read direction, not magnitude.
- **On its target failure, the sentence earns its keep:** the dropped-`: done`
  mode reappeared only when the sentence was removed, with the #122 mechanical
  rail present in both arms — so the rail alone did not prevent the drop, and
  the sentence is not redundant with it.
- **The class-case reversal is a different defect:** `+quack() void` is
  over-specification, hit both arms, and is untouched by tweak #3's
  dropping-oriented wording. It is the reason the aggregate reads null.

## Decision (per the issue's acceptance criteria)

**Keep the sentence** (do not revert): the deterministic discriminator it was
written for regresses 4/4 → 2/4 without it, and its cost is one sentence that
the `homepagePromptChecklist` budget already carries. The measured gap that
remains — literal *embellishment* (`+quack() void`) — is not addressed by
strengthening #3's current wording and is better tracked as its own follow-up
if it recurs outside this case.

## Reproduce

```sh
# prepare one arm/seed (the committed run dirs were made exactly this way)
bun run eval:agent-subagent -- prepare --provider claude-subagent \
  --model claude-haiku-4-5 --surface homepage --mode chat \
  --prompt-variant no-literal-reframe --inline-start-md \
  --cases state_add_done_transition,class_add_duck,gantt_add_docs_task \
  --out-dir eval/agent-usage/transcripts/<run-dir>
# dispatch one fresh Haiku subagent per requests/*.md with
#   AM_TRACE_LOG=<run-dir>/traces/<case>.jsonl
# then grade:
bun run eval:agent-subagent -- finalize --run-dir <run-dir>
```
