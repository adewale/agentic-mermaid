# CLI (shell-only and one-shot operations)

When no MCP server is connected and TypeScript/library import isn't available, use the `am` CLI. Every subcommand supports `--json` for structured output.

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

`am verify` always emits JSON because the structured warnings are the point of the verb. Other verbs print text by default, JSON with `--json`.

## One-shot patterns

```bash
# Validate every diagram in a tree, fail CI on any error-severity warning.
find docs -name '*.mmd' -print0 | while IFS= read -r -d '' f; do
  am verify "$f" | jq -e '.ok' >/dev/null || { echo "FAIL: $f"; exit 1; }
done

# Render every .mmd to SVG.
for f in *.mmd; do am render "$f" > "${f%.mmd}.svg"; done

# Apply a single rename op.
am mutate flow.mmd --op '{"kind":"rename_node","from":"X","to":"Y"}' > flow.new.mmd
```

## When the CLI is the wrong tool

Multi-step editing through shell pipes is clumsier than TypeScript composition. If you find yourself piping `am parse` → `jq` → `am mutate` more than twice, prefer:

- Library import (`import { ... } from 'agentic-mermaid'`) if you can `import` TS.
- Code Mode (`execute()` on the MCP server) if you can't.

The CLI's job is one-shot operations, CI gates, and shells that have nothing else.

## Exit codes

- `0` — success
- `1` — usage error or unrecoverable I/O error
- `2` — operation completed but result is "not ok" (verify failed, parse failed)
