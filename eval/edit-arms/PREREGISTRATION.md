# Preregistration: typed editing vs text editing (edit arms)

Registered 2026-11-13, before any model response was collected. The corpus
digest recorded by `prepare` (`edit-arms-run.json` → `corpusDigest`) binds every
run to this corpus revision. Changes after the first confirmatory run are
deviations and must be listed in §10 with their reason.

## 1. Hypothesis

H1: On edits to existing real-world Mermaid diagrams, agents using Agentic
Mermaid's typed path (arm B: parse → narrow → mutate → verify → serialize)
cause less collateral damage than agents that edit the Mermaid text directly
and may verify/render with Agentic Mermaid (arm A), without making fewer
correct edits.

H0: Arm B's damage rate is not lower than arm A's by the margin in §5.

## 2. Design

Within-task paired comparison. Each of the 63 held-out tasks (41 diagrams,
`corpus/`) is attempted under each arm, by each model, in each run. Arms differ
only in the Tools section of the request (`arms.ts`). Optional arm C (no tools)
is a floor for both. Requests are dispatched to fresh agents, one request per
agent, in the seeded interleaved `dispatchOrder`, so arm and time are not
confounded. Agents run in a checkout of this repository with Agentic Mermaid
available; they are told not to read `eval/edit-arms/`.

## 3. Outcomes and scoring

Scored by `score.ts` against hand-written reference edits, with semantic
models from upstream Mermaid 12.2.0 (`oracle.ts`). Definitions in README
§Scores.

- **Primary:** damage rate — share of captured responses whose output either
  changes something the request did not ask for (collateral, b) or is missing
  or rejected by Mermaid 12.2.0.
- **Secondary:** success rate (a ∧ ¬b ∧ d; the non-inferiority endpoint in §5);
  intended-change rate (a); parse rate (d); collateral rate among parseable
  outputs; source preservation (c) overall and for comment, style and
  directive lines; per-family rates; observed tokens, turns and wall time;
  arm compliance from `AM_TRACE_LOG`.
- **Exploratory:** C − A and B − C contrasts; per-model results; tasks Agentic
  Mermaid cannot parse to a structured body.

## 4. Analysis

Unit of analysis: the task. For each task and arm, average the binary outcome
over all models and runs; take the paired difference (B − A) per task; report
the mean difference with a 95% percentile bootstrap interval over tasks
(10,000 resamples, seed 20261113; `stats.ts`). Primary analysis pools models;
per-model results are reported alongside. Analysis is intention-to-treat:
responses that ignore their arm's tool rules are scored as given. A
per-protocol sensitivity analysis drops `violated` responses.

## 5. Decision rule

Let D = damage(A) − damage(B) and S = success(B) − success(A), both pooled.

1. **Supported** — position the product around typed editing — if D ≥ 10
   percentage points, the 95% interval for D excludes zero, and the lower
   bound of the 95% interval for S is above −5 points.
2. **Typed path harmful** if the 95% interval for damage(B) − damage(A) lies
   entirely above zero.
3. **Not supported** otherwise. Then position the product around
   render-and-verify (text edits checked by `am verify`/render), not typed
   editing, and say so in the README and site copy.

`run.ts report` applies this rule (`decide`) to the pooled summary.

## 6. Sample size

Confirmatory run: at least 3 models (from at least 2 providers where
available) × 5 runs × all 63 tasks × arms A and B = 1,890 responses (2,835
with arm C). Rationale: with 63 task clusters and a per-task SD of the paired
damage difference around 0.35, the standard error of D is about 4.4 points and
the 95% interval half-width about 8.7 points, so a true reduction of 15 points
would usually meet rule 1, and a true reduction of exactly 10 points meets it
about half the time. Five runs per cell reduce within-task noise; more tasks,
not more runs, would narrow the interval further.

A pilot (10 family-stratified tasks, `--sample 10 --seed 1`, arms A and B,
1 run, 1 model) checks the harness end to end and calibrates cost. Pilot
responses are not pooled into the confirmatory analysis. The pilot may expose
harness bugs (capture, extraction, scoring); fixes to the harness are allowed
before the confirmatory run and are listed in §10. Tasks are not changed
because of pilot results, except to correct a reference edit that is wrong
about the request, which is also listed in §10.

## 7. Exclusions

- **Capture failures** (missing, empty or placeholder response; request
  digest mismatch): re-dispatch once; if still failing, exclude and report the
  count per arm.
- **Infrastructure failures** (agent crash, sandbox or network failure before
  a reply): re-dispatch once; otherwise exclude and report.
- **No exclusion** for wrong, partial or arm-violating answers — they are
  outcomes.
- **Tasks:** none are excluded after the first confirmatory run. A task whose
  reference is shown to be wrong is reported both ways.

## 8. Cost estimate

Request sizes are measured from the generated request files (characters ÷ 4).
Per-run token assumption, calibrated to the ~21k–36k mean tokens per
single-diagram case observed for in-checkout Claude subagents in
`eval/agent-usage/README.md`:

tokens per run = base(arm) + rereads(arm) × request tokens, with
A = 25,000 + 4 × request, B = 32,000 + 5 × request (operation discovery),
C = 4,000 + 1 × request.

| Run | Requests | Mean request tokens | Tokens per run | Total tokens |
|---|---:|---|---|---:|
| Pilot: 10 tasks × A, B × 1 run × 1 model | 20 | A 836, B 960 | A 28.3k, B 36.8k | ≈ 0.65M |
| Full: 63 tasks × A, B × 5 runs × 3 models | 1,890 | A 906, B 1,029 | A 28.6k, B 37.1k | ≈ 62.2M |
| Full with arm C | 2,835 | C 443 | C 4.4k | ≈ 66.4M |

Reproduce with `bun run eval:edit-arms -- cost --arms A,B --runs 1 --sample
10` and `-- cost --arms A,B,C --runs 5 --models 3`. Replace the assumption
with the pilot's observed per-run tokens (`summary.json` → `perArm.*.cost`)
before committing to the full run.

## 9. Threats to validity

- The oracle sees only what Mermaid's DB getters expose (README §Oracle);
  `linkStyle default`, init directives and theme config are covered only by
  the textual preservation sub-metrics.
- In-checkout agents can find tooling outside their arm; compliance is
  measured, not enforced.
- One author wrote all requests and references; requests are more explicit
  than many real ones so that the oracle can be strict.
- Agentic Mermaid's verifier rejects two held-out diagrams that Mermaid
  accepts, and two diagrams are opaque to the typed path; those tasks test
  how each arm copes with that, which is part of the claim.

## 10. Deviations

None yet.
