# Agent-usage failure corpus

Captured and curated examples of ways real agents miss the Agentic Mermaid safe path. These fixtures are intentionally *not* passing transcripts: tests replay executable scripts through `runAgentUsageEval` or classify raw non-Code-Mode responses so regressions in the failure detector are visible.

The corpus feeds two loops:

- **EVAL-2** — keep concrete examples of agent failures instead of relying only on imagined anti-patterns.
- **BUILD-8** — choose Tier 3 lint and trace-lint rules from observed mistakes.

A fixture may be:

- `kind: "raw-response"` — a model/subagent returned prose, Mermaid fences, CLI advice, or another non-Code-Mode answer.
- `kind: "code-mode"` — executable Code Mode JavaScript that should fail task or trace checks.

Passing these fixtures would be suspicious; each case declares the raw classifications and/or trace findings expected from the deterministic oracle.
