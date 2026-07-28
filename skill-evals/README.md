# Skill evals

This directory contains the `skill-eval-harness` manifest for the repository’s agent-agnostic skills under [`../skills/`](../skills/).

## Coverage matrix

The public tune split now includes:

- Diagram families: every registry-declared built-in, via the manifest's
  `family:*` tags (enforced by the doc-sync test rather than copied here).
- Channels: library, CLI, hosted MCP direct tools, and MCP Code Mode.
- Hosted MCP routing: direct `verify`/`describe`/`mutate`/`build` cases whose
  proposed JSON requests are executed locally against the production tool
  schemas and mutation core,
  schema-error recovery through `describe_sdk`, and local fallback for inputs
  beyond the hosted limit. A separate repository-grounding case requires scope
  claims to cite inspected implementation files rather than generic MCP lore.
- Negative/no-trigger rows for unrelated work.
- Adversarial rows for source concatenation, skipping verify, editing generated
  `editor.html`, using `type` instead of `kind`, underspecified quality goals,
  and oversized hosted inputs.
- Fixture-backed artifact rows under [`fixtures/`](./fixtures/) that require changed Mermaid/source plus `verifyMermaid` evidence.
- Every case is tagged by domain, difficulty, trigger type, and success goal so
  aggregate pass rates can be sliced instead of hiding regressions in one
  overall mean. Script oracles and regex checks replace keyword matching where
  a structural or executable contract matters.

The manifest also contains private `prompt_ref` stubs for `holdout` and `holdback`. Those paths are intentionally under ignored `skill-evals/private/`; real hidden prompts and answer keys must stay out of public commits. Public stubs contain no `expected_behavior`, `assertions`, or `review_rubric`, because an unpublished prompt with a published answer key is not a holdback.

## Harness

Install/run with:

```bash
uvx --from git+https://github.com/adewale/skill-eval-harness.git@v0.6.0 skill-benchmark --help
```

Harness 0.6.0 requires manifest paths to stay under the manifest root. Materialize
an ignored runner copy at the repository root before validation, preparation, or
grading so top-level `skills/`, fixtures, prompts, and oracle scripts resolve to
the files in this checkout:

```bash
bun run eval:skill:runner-manifest \
  --manifest skill-evals/shared-benchmark.json \
  --repo-root . \
  --out .skill-eval-runner-tune.json
skill-benchmark validate .skill-eval-runner-tune.json
skill-benchmark audit-manifest .skill-eval-runner-tune.json --format markdown --out /tmp/agentic-mermaid-skill-audit.md
```

Create an ignored `skill-evals/private/cases.json` conforming to
[`private-bundle.schema.json`](./private-bundle.schema.json), add the referenced
prompt files, hydrate, then use strict validation:

```bash
bun run eval:skill:hydrate
bun run eval:skill:runner-manifest \
  --manifest skill-evals/private/hydrated-benchmark.json \
  --repo-root . \
  --out .skill-eval-runner-private.json
skill-benchmark validate .skill-eval-runner-private.json --strict-holdback
```

Hydration fails on a missing/extra private case, a missing prompt, or any answer
key leaked into a public hidden stub. It also resolves skill, fixture, and prompt
paths absolutely so moving the hydrated file cannot silently retarget inputs.

Prepare visible tune tasks with repeated runs:

```bash
skill-benchmark prepare .skill-eval-runner-tune.json \
  --split tune \
  --runs-per-variant 5 \
  --out /tmp/agentic-mermaid-skill-tasks.jsonl
```

Use exactly 3 runs per variant with the `iteration` summary profile and exactly
5 with the `release` profile. Before execution, run
`eval:skill:prepare-evidence`. It treats the model workspace, the
fixture checkout, and the treatment skill checkout as three separate inputs.
This permits a skill-only A/B: both arms use one neutral workspace and frozen
fixture tree while only `--skill-checkout` changes. `--skills` removes unrelated
skills from the forced-load input, `without_skill` rows carry no skill paths,
and `--seed` creates one reproducible shuffled schedule.

For the hosted-MCP cohort, prepare the baseline and candidate from the same
source tasks like this:

```bash
bun run eval:skill:prepare-evidence \
  --tasks /tmp/agentic-mermaid-skill-tasks.jsonl \
  --workspace /tmp/agentic-mermaid-neutral-workspace \
  --fixture-checkout /tmp/agentic-mermaid-frozen-fixtures \
  --skill-checkout /tmp/agentic-mermaid-baseline \
  --skills agentic-mermaid-diagram-workflow \
  --cases pos-channel-mcp-direct-verify,pos-channel-mcp-direct-describe,pos-channel-mcp-direct-mutate,pos-channel-mcp-direct-build,adv-mcp-recover-invalid-op-schema,adv-mcp-hosted-size-fallback,adv-mcp-underspecified-quality-objective,neg-unrelated-typescript-helper \
  --seed agentic-mermaid-hosted-mcp-v2 \
  --runs-root /tmp/eval-before/runs \
  --out /tmp/eval-before/tasks.jsonl \
  --receipt /tmp/eval-before/preparation.json
```

Repeat with the candidate skill checkout and candidate output paths. The
preparation receipt hashes the selected skill tree, workspace and fixture bytes,
full stimuli, emitted task bytes, and run schedule. The comparison gate rejects
identical treatments, changed prompts or fixtures, different schedules, and
different workspaces. For repository-editing
cases that genuinely need a checkout, use one shared immutable workspace; do
not compare two repository roots and call the result a skill effect.

The preparer also rewrites requested `outputs/...` paths into the matching run
directory. Without that rewrite, an agent can produce the right artifact in the
repository while `file_exists` grades an unrelated run folder.

Run autonomous trigger/no-trigger checks separately:

```bash
skill-pi-trigger-eval skill-evals/shared-benchmark.json \
  --split tune \
  --runs-per-query 5 \
  --out /tmp/agentic-mermaid-trigger-report.json
```

Execute through the provenance wrapper so the exact runner binary, runner
version, model, reasoning effort, command, tasks, run root, timestamps, and exit
status are bound into a receipt:

```bash
bun run eval:skill:run-codex-evidence \
  --runner /absolute/path/to/skill-benchmark \
  --runner-version 0.6.0 \
  --tasks /tmp/eval-before/tasks.jsonl \
  --runs /tmp/eval-before/runs \
  --model gpt-5.4-mini \
  --reasoning-effort low \
  --codex-cmd 'codex exec --json --model gpt-5.4-mini -c model_reasoning_effort=low' \
  --receipt /tmp/eval-before/execution.json \
  --timeout 180 \
  --concurrency 8
```

The wrapper verifies that `--runner-version` matches the installed
`skill-eval-harness` package behind `--runner`; a version label cannot bless a
stale executable. After the harness exits, it also requires every expected run
to have provider return code zero, complete process/provider/trace/operation
observations, a completed final agent message, and a non-empty output. An
aggregate runner exit code of zero is not accepted when any task failed.

Then materialize and grade:

```bash
bun run eval:skill:materialize-codex-output \
  --runs /tmp/eval-before/runs \
  --execution-receipt /tmp/eval-before/execution.json \
  --receipt /tmp/eval-before/output-materialization.json

skill-benchmark benchmark .skill-eval-runner-tune.json \
  --runs /tmp/eval-before/runs \
  --split tune \
  --allow-scripts \
  --out /tmp/eval-before/report.json
```

Run materialization before grading Codex JSONL. It verifies the final
`agent_message` in the immutable trace against `output.md`, replaces only an
exact legacy prefix, preserves any replaced harness artifact as
`output.harness.md`, and binds every trace and output plus the execution receipt
into a content-addressed receipt. Harness 0.6.0 produced complete outputs for
all 160 executions in the latest release run, so none needed rewriting. Any
non-prefix mismatch or stale prior backup fails closed.

`--allow-scripts` runs repository-owned deterministic oracles. The hosted-MCP
oracle requires exactly one final fenced `{tool, arguments}` JSON request,
rejects extra prose or blocks, checks exact source bytes and requested detail
fields, validates the advertised production schema, and executes
verify/describe/mutate/build through the production core. Soft judge rows are
reported as deferred and must be calibrated separately; deterministic pass
rates are not a substitute for semantic review.

## Latest causal hosted result

The generated [2026-07-28 comparison](../eval/skill-evidence/hosted-mcp-causal-2026-07-28.json)
binds 160 hosted Codex executions: eight tune cases, two variants, five runs,
and two different treatment trees. With the neutral workspace, frozen fixtures,
full model stimuli, schedule, manifest, and treatment paths held constant, the
candidate raised both mean deterministic/executable objective pass rate and
all-graded-assertions pass rate from 55% to 100%. The no-skill control was
unchanged at 29.17% mean objective and 25% all-graded pass rate. There were no
missing outputs or timeouts.

This is an honest 45-point deterministic tune-set improvement, not a claim of
perfect semantic or generalized quality. Every variant still has 20 deferred
semantic-judge rows, so the 100% figure applies only to the graded executable
and deterministic assertions. The private holdout is frozen but unexecuted
because sending its ignored prompts to a hosted model requires explicit
data-egress approval.

The [artifact descriptor](../eval/skill-evidence/hosted-mcp-causal-2026-07-28-artifact.json)
points to the content-addressed archive containing prepared tasks, execution and
materialization receipts, immutable traces, outputs, grader reports, runner
manifest, source tasks, cohort policy, neutral workspace, frozen fixtures, and
both treatment trees. Extraction verification recomputes the workspace,
fixture, treatment, and task digests from those archived inputs. Extract it and run
`bun run eval:skill:bundle-evidence --verify <directory>` before independently
regenerating the comparison with relocated run roots.

## Latest smoke result

Runner: Pi CLI, one run per variant, tune split only, model reported by Pi as `gpt-5.5` / `openai-codex`.

| Variant | Cases | Runs | Mean objective pass rate |
|---|---:|---:|---:|
| `with_skill` | 2 | 2 | 1.00 |
| `without_skill` | 2 | 2 | 0.00 |

That older result is only a runner smoke signal: one run cannot estimate
variance, the two-case sample predates the MCP cohort, and it has no slice,
all-graded-assertions, trigger-classification, latency, or cost report. Do not
cite it as benchmark or release evidence.

## Evidence gate

[`../eval/skill-evidence/release-cohort.json`](../eval/skill-evidence/release-cohort.json)
pins the skill-only comparison design, behavior cohort, surface-specific model
identity, repetition policy, trigger repetition, pricing source, and required
report fields. A behavior run
is not complete unless both variants have the exact expected run count and zero
missing outputs/timeouts. Run autonomous trigger/no-trigger evals separately;
good answers to forcibly loaded skills do not prove routing precision.

After grading both pinned checkouts, summarize only complete run matrices:

```bash
bun run eval:skill:summarize-evidence \
  --before /tmp/eval-before/report.json \
  --after /tmp/eval-after/report.json \
  --before-manifest skill-evals/shared-benchmark.json \
  --after-manifest skill-evals/shared-benchmark.json \
  --before-receipt /tmp/eval-before/preparation.json \
  --after-receipt /tmp/eval-after/preparation.json \
  --before-output-receipt /tmp/eval-before/output-materialization.json \
  --after-output-receipt /tmp/eval-after/output-materialization.json \
  --before-tasks /tmp/eval-before/tasks.jsonl \
  --after-tasks /tmp/eval-after/tasks.jsonl \
  --profile release \
  --out /tmp/skill-evidence-comparison.json
```

The summary refuses duplicate or missing case/variant/run cells, ungraded rows,
missing outputs, timeouts, incomplete output-materialization receipts, identical
skill trees, or any causal-receipt mismatch.
It emits mean-assertion and all-graded-assertions pass rates, deferred semantic
judge counts, absolute and
headroom-normalized treatment gains, per-case and taxonomy slices, imperfect
positive rows, negative-behavior violations, latency, token usage, and
price-source-backed cost estimates. Reserve false-positive/false-negative
language for the separate autonomous trigger classifier, where those terms have
their standard meaning.

The deterministic preflight is:

```bash
bun run eval:skill:sabotage
bun run eval:family-portfolio:check
skill-benchmark audit-manifest .skill-eval-runner-tune.json --format markdown
```

The sabotage lane feeds known-good controls and targeted bad outputs through
every deterministic text assertion type. It must prove the control passes and
each mutation fails; otherwise the evaluator is not sensitive to the fault it
claims to detect. The balanced portfolio is a separate 4 × 15 registry-derived
input set for family-macro reporting; retain the 271-example documentation
corpus for syntax breadth and report both views.

The four declared skill ablations are blind, removal-based arms. Materialize
them before any ablation run and retain the provenance receipt:

```bash
skill-benchmark materialize-ablations .skill-eval-runner-tune.json \
  --out-dir /tmp/agentic-mermaid-ablations \
  --out /tmp/agentic-mermaid-ablation-receipt.json
```

The manifest audit must report `4/4` materialized, `0` instruction-simulated,
no isolation warnings in the materialization receipt, and no readiness blockers.
