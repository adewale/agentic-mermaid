# CLI (shell-only / one-shot)

```
am render <file|->            SVG (or --ascii)
am verify <file|->            structured JSON warnings (exit 2 if not ok)
am parse <file|->             ValidDiagram JSON
am serialize                  ValidDiagram JSON (stdin) → canonical source
am mutate <file|-> --op JSON  one MutationOp → new source
am format <file|->            idempotent reformat
am --agent-instructions       canonical agent guide
am <cmd> --help               per-command help
```

`am verify` always emits JSON. `am mutate` dispatches by family; non-flowchart,
non-sequence (or opaque sequence) returns a structured `UNSUPPORTED_FAMILY`
error. `am parse | am serialize` round-trips through JSON.

```bash
# Validate a tree
find docs -name '*.mmd' -print0 | while IFS= read -r -d '' f; do
  am verify "$f" | jq -e '.ok' >/dev/null || { echo "FAIL: $f"; exit 1; }
done
# Flowchart op
am mutate flow.mmd --op '{"kind":"rename_node","from":"X","to":"Y"}'
# Sequence op
am mutate seq.mmd --op '{"kind":"add_message","from":"A","to":"B","text":"Hi"}'
```

Exit codes: 0 success, 1 usage/IO error, 2 not-ok (verify failed, parse failed,
mutate rejected).
