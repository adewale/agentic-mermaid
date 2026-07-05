# Mutation error

> A typed mutation was invalid for the narrowed family or target.

## How to recover

A typed edit was rejected because it does not apply to the narrowed family or its target does not exist (e.g. `set_label` on a missing node id). Re-narrow the parsed diagram, confirm the target id against the current model, and fall back to editing the preserved source directly when the construct is not structurally modeled (opaque fallback).

## Related

See the [library API](/docs/api/) for the typed parse → narrow → mutate → verify surface.

```
am verify diagram.mmd --json
```

Full page: https://agentic-mermaid.dev/errors/mutation-error/
