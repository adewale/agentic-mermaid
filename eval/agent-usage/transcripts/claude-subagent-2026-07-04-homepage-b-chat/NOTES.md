# Run notes

Arm: `--surface homepage`, prompt variant B (after the right-altitude pass:
workflow collapsed 8 steps → 4, warning handling stated as a heuristic, Trace
asks for the calls actually run instead of a prescribed call list). Same six
cases and dispatch harness as the `none` and `homepage-a` arms.

- Result: 6/6 ok, safePathRate 1.0, structuredPathRate 1.0 — no regression
  from the altitude change on these cases.
- Subagent output tokens (per case): cache 28679, state 25856, sequence 28434,
  er 28356, gantt 31972, author 29427 (mean ~28.8k, ~4% below variant A —
  within noise at n=6).
- Single run per arm: treat direction, not magnitude, as the signal; the run
  policy for decisions is ≥3 runs per variant.
