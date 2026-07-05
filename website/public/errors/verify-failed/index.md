# Verify failed

> The diagram parsed but verification returned blocking structural warnings.

## How to recover

The diagram parsed and rendered, but `verify.ok` is false because a structural-tier warning is blocking. Inspect `verify.warnings`, fix the structural codes first, then re-verify before trusting the artifact.

## Related

Every code is documented under [warnings](/warnings/); start with the structural tier.

```
am verify diagram.mmd --json
```

Full page: https://agentic-mermaid.dev/errors/verify-failed/
