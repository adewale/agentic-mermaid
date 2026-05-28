# CLI (shell-only and one-shot operations)

When no MCP server is connected and TS isn't available, use `am`.

## Verbs

```
am render <file|->            Render to SVG (or ASCII with --ascii)
am verify <file|->            Verify; emits structured JSON warnings
am parse <file|->             Parse; emits ValidDiagram JSON
am serialize                  Read ValidDiagram JSON from stdin; emit canonical source
am mutate <file|-> --op <JSON>  Apply one MutationOp; emit new source
am format <file|->            Idempotent reformat
am --agent-instructions       Print the canonical agent-use guide
```

`am mutate` dispatches by family: flowchart and state accept `FlowchartMutationOp`; sequence accepts `SequenceMutationOp`. Other families return a structured `UNSUPPORTED_FAMILY` error.

`am parse | am serialize` round-trips through JSON without needing to retain `canonicalSource` on the wire (the serializer synthesizes from the graph).

## One-shot patterns

```bash
# Validate every diagram in a tree.
find docs -name '*.mmd' -print0 | while IFS= read -r -d '' f; do
  am verify "$f" | jq -e '.ok' >/dev/null || { echo "FAIL: $f"; exit 1; }
done

# Render.
for f in *.mmd; do am render "$f" > "${f%.mmd}.svg"; done

# Flowchart op.
am mutate flow.mmd --op '{"kind":"rename_node","from":"X","to":"Y"}' > flow.new.mmd

# Sequence op.
am mutate seq.mmd --op '{"kind":"add_message","from":"A","to":"B","text":"Hi"}' > seq.new.mmd
```

## Exit codes

- `0` — success
- `1` — usage error or unrecoverable I/O error
- `2` — operation completed but result is "not ok"
