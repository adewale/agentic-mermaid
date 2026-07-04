# Run notes

Arm: `--surface homepage`, prompt variant A (before the right-altitude pass;
prompt as of commit 8c1a322). Compare with the `none` baseline and the
`homepage-b` after-pass arm captured the same day, same six cases, same
dispatch harness (one fresh Claude Code general-purpose subagent per request,
inside this checkout).

- Result: 6/6 ok, safePathRate 1.0, structuredPathRate 1.0 (after the
  auth-flow oracle learned to accept "Credentials valid?" — both arms had
  failed that case only on label word order).
- Subagent output tokens (per case): cache 29577, state 28943, sequence 29705,
  er 33212, gantt 28431, author 30329 (mean ~30.0k).
