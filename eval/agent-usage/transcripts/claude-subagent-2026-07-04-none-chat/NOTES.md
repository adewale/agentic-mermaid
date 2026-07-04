# Run notes

Arm: `--surface none` (no-docs baseline), part of a three-arm comparison with
`claude-subagent-2026-07-04-homepage-a-chat` (prompt before the right-altitude
pass) and `claude-subagent-2026-07-04-homepage-b-chat` (after).

- Dispatch: one fresh Claude Code general-purpose subagent per request, inside
  this repository checkout.
- Contamination caveat: baseline subagents self-discovered the in-repo tooling
  (`src/agent/index.ts`, `am` CLI) despite receiving no docs, because the
  checkout and its project instructions were visible. Baseline taskOk is
  therefore an upper bound; a clean baseline needs an isolated workspace.
- safePathRate is expected ~0 here by construction: the baseline never saw the
  response-format contract, so only taskOk is meaningful.
- Subagent output tokens (per case, from the dispatch harness):
  cache 33821, state 30598, sequence 31294, er 30833, gantt 38849, author 25116
  (mean ~31.8k).
