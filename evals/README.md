# Skill evals

This directory contains the `skill-eval-harness` manifest for the repository’s agent-agnostic skills under [`../skills/`](../skills/).

## Coverage matrix

The public tune split now includes:

- Diagram families: flowchart, state, sequence, timeline, class, ER, journey,
  architecture, xychart, pie, quadrant, gantt.
- Channels: library, CLI, and MCP Code Mode.
- Negative/no-trigger rows for unrelated work.
- Adversarial rows for source concatenation, skipping verify, editing generated `editor.html`, and using `type` instead of `kind`.
- Fixture-backed artifact rows under [`fixtures/`](./fixtures/) that require changed Mermaid/source plus `verifyMermaid` evidence.

The manifest also contains private `prompt_ref` stubs for `holdout` and `holdback`. Those paths are intentionally under ignored `evals/private/`; keep real hidden prompts and answer keys out of public commits.

## Harness

Install/run with:

```bash
uvx --from git+https://github.com/adewale/skill-eval-harness.git@v0.1.1 skill-benchmark --help
```

Validate and audit the public manifest:

```bash
skill-benchmark validate evals/shared-benchmark.json
skill-benchmark audit-manifest evals/shared-benchmark.json --format markdown --out /tmp/agentic-mermaid-skill-audit.md
```

Use strict hidden-prompt validation only in a private eval workspace where `evals/private/...` exists:

```bash
skill-benchmark validate evals/shared-benchmark.json --strict-holdback
```

Prepare visible tune tasks with repeated runs:

```bash
skill-benchmark prepare evals/shared-benchmark.json \
  --split tune \
  --runs-per-variant 5 \
  --out /tmp/agentic-mermaid-skill-tasks.jsonl
```

Use 3 runs per variant for cheap iteration; use 5 for pre-merge/release evidence. Fixture-backed artifact cases require a runner that preserves generated `outputs/...` files inside each run directory so `file_exists` assertions can grade them.

Run autonomous trigger/no-trigger checks separately:

```bash
skill-pi-trigger-eval evals/shared-benchmark.json \
  --split tune \
  --runs-per-query 5 \
  --out /tmp/agentic-mermaid-trigger-report.json
```

After running the prepared tasks with a coding-agent runner, grade with:

```bash
skill-benchmark benchmark evals/shared-benchmark.json \
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

That older result was a positive smoke signal. It is superseded as a coverage target by the expanded manifest above and should be rerun with 3–5 runs per variant before claiming benchmark-level evidence.
