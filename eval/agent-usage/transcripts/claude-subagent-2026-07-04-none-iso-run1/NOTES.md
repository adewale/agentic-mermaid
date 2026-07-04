# Run notes

Arm: `--surface none`, ISOLATED variant (none-iso-run1 of 2). Unlike the first
in-checkout baseline run, these subagents were pointed at a scratch
workspace, told the repository belongs to an unrelated project, and told
they have no diagram tooling — a much closer approximation of a true
no-docs floor (residual leak: the harness still injects the project's
CLAUDE.md, which names the product).

- Result: 6/6 taskOk on pure model knowledge, ~20.7k output tokens per
  case (single tool call each — the request read).
- Behavioral observation: agents ROLE-PLAYED structured mutation and
  verification in prose ("Applied mutation addTransition…",
  "Verification: …") with no tooling behind it — the exact
  fabricated-verification failure mode the prompt's honesty clause and
  the safe-path gate exist to catch. safePathRate 0 by construction.
- Implication recorded in the eval README: these six cases cannot
  differentiate surfaces on taskOk; they differentiate on the verified
  workflow. Knowledge-proof cases (product-specific semantics the model
  cannot guess) are required before taskOk deltas mean anything.
