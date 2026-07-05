# Mutation error

> A typed mutation was invalid for the narrowed family or target.

## How to recover

A typed edit was rejected because it does not apply to the narrowed family or its target does not exist (e.g. `set_label` on a missing node id). Re-narrow the parsed diagram, confirm the target id against the current model, and fall back to a source-level edit when the construct is not structurally modeled.

## Related

For constructs that cannot be narrowed at all, see [source-level edits](/docs/source-level/).

```
am verify diagram.mmd --json
```

Full page: https://agentic-mermaid.dev/errors/mutation-error/
