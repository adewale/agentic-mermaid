# Run notes

Arm: `--surface homepage`, prompt variant B (right-altitude pass), homepage-b-run2
of 3 total B runs (with claude-subagent-2026-07-04-homepage-b-chat).
Same six cases and dispatch harness as all other arms.

- Result: 6/6 ok, safePathRate 1.0, structuredPathRate 1.0.
- Across the three B runs (n=18 responses) the prompt held 100% on both
  the task oracle and the response contract; mean output ~29.5k tokens
  per case vs ~20.7k for the tooling-free isolated baseline — the ~9k
  delta buys real (not role-played) parse/narrow/mutate/verify calls.
- Notable probe behavior in run3/author: library import failed (package
  not installed), agent fell through to `am capabilities --json` per
  the prompt's probe order, then used the repo library — the channel
  fallback worked as written.
