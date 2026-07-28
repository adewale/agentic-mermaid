# Skill evals

This directory contains the `skill-eval-harness` manifest for the repository’s agent-agnostic skills under [`../skills/`](../skills/).

## Coverage matrix

The public tune split now includes:

- Diagram families: every registry-declared built-in, via the manifest's
  `family:*` tags (enforced by the doc-sync test rather than copied here).
- Channels: library, CLI, hosted MCP direct tools, and MCP Code Mode.
- Hosted MCP routing: direct `verify`/`describe`/`mutate`/`build` cases,
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
  overall mean. Output assertions avoid repeating literal prompt clues; regex
  checks are used where a structural relationship matters.

The manifest also contains private `prompt_ref` stubs for `holdout` and `holdback`. Those paths are intentionally under ignored `skill-evals/private/`; real hidden prompts and answer keys must stay out of public commits. Public stubs contain no `expected_behavior`, `assertions`, or `review_rubric`, because an unpublished prompt with a published answer key is not a holdback.

## Harness

Install/run with:

```bash
uvx --from git+https://github.com/adewale/skill-eval-harness.git@v0.4.0 skill-benchmark --help
```

Validate and audit the public manifest:

```bash
skill-benchmark validate skill-evals/shared-benchmark.json
skill-benchmark audit-manifest skill-evals/shared-benchmark.json --format markdown --out /tmp/agentic-mermaid-skill-audit.md
```

Create an ignored `skill-evals/private/cases.json` conforming to
[`private-bundle.schema.json`](./private-bundle.schema.json), add the referenced
prompt files, hydrate, then use strict validation:

```bash
bun run eval:skill:hydrate
skill-benchmark validate skill-evals/private/hydrated-benchmark.json --strict-holdback
```

Hydration fails on a missing/extra private case, a missing prompt, or any answer
key leaked into a public hidden stub. It also resolves skill, fixture, and prompt
paths absolutely so moving the hydrated file cannot silently retarget inputs.

Prepare visible tune tasks with repeated runs:

```bash
skill-benchmark prepare skill-evals/shared-benchmark.json \
  --split tune \
  --runs-per-variant 5 \
  --out /tmp/agentic-mermaid-skill-tasks.jsonl
```

Use 3 runs per variant for iteration and 5 for pre-merge/release evidence. Before
execution, run `eval:skill:prepare-evidence` with `--checkout`, `--runs-root`, and
`--cases`. It moves the agent to the exact checkout under test, re-homes its
skill/fixture inputs to that SHA, and rewrites requested `outputs/...` paths into
the matching run directory. Without this step, an agent can produce the right
artifact in the repository while `file_exists` grades the unrelated run folder.

Run autonomous trigger/no-trigger checks separately:

```bash
skill-pi-trigger-eval skill-evals/shared-benchmark.json \
  --split tune \
  --runs-per-query 5 \
  --out /tmp/agentic-mermaid-trigger-report.json
```

After running the prepared tasks with a coding-agent runner, grade with:

```bash
skill-benchmark benchmark skill-evals/shared-benchmark.json \
  --runs /tmp/agentic-mermaid-skill-runs \
  --split tune \
  --out /tmp/agentic-mermaid-skill-benchmark.json
```

## Latest smoke result

Runner: Pi CLI, one run per variant, tune split only, model reported by Pi as `gpt-5.5` / `openai-codex`.

| Variant | Cases | Runs | Mean objective pass rate |
|---|---:|---:|---:|
| `with_skill` | 2 | 2 | 1.00 |
| `without_skill` | 2 | 2 | 0.00 |

That older result is only a runner smoke signal: one run cannot estimate
variance, the two-case sample predates the MCP cohort, and it has no slice,
false-positive/negative, latency, or cost report. Do not cite it as benchmark or
release evidence.

## Evidence gate

[`../eval/skill-evidence/release-cohort.json`](../eval/skill-evidence/release-cohort.json)
pins the comparison SHAs, behavior cohort, model snapshot, repetition policy,
trigger repetition, pricing source, and required report fields. A behavior run
is not complete unless both variants have the exact expected run count and zero
missing outputs/timeouts. Run autonomous trigger/no-trigger evals separately;
good answers to forcibly loaded skills do not prove routing precision.

After grading both pinned checkouts, summarize only complete run matrices:

```bash
bun run eval:skill:summarize-evidence \
  --before /tmp/eval-before/report.json \
  --after /tmp/eval-after/report.json \
  --before-manifest /tmp/eval-before/checkout/skill-evals/shared-benchmark.json \
  --after-manifest /tmp/eval-after/checkout/skill-evals/shared-benchmark.json \
  --out /tmp/skill-evidence-comparison.json
```

The summary refuses duplicate or missing case/variant/run cells, ungraded rows,
missing outputs, and timeouts. It emits the runner/model identity, compared SHAs,
both manifest digests, absolute and headroom-normalized treatment gains, per-case
and taxonomy slices, false-positive/negative rows, latency, token usage, and
price-source-backed cost estimates.

The deterministic preflight is:

```bash
bun run eval:skill:sabotage
bun run eval:family-portfolio:check
skill-benchmark audit-manifest skill-evals/shared-benchmark.json --format markdown
```

The sabotage lane feeds known-good controls and targeted bad outputs through
every deterministic text assertion type. It must prove the control passes and
each mutation fails; otherwise the evaluator is not sensitive to the fault it
claims to detect. The balanced portfolio is a separate 4 × 15 registry-derived
input set for family-macro reporting; retain the 271-example documentation
corpus for syntax breadth and report both views.
