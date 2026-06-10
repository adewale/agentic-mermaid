# CLI (shell-only / one-shot)

Agentic Mermaid outputs ASCII, PNG, and SVG through the CLI, with Unicode text and JSON layout available for specialized workflows.

```text
am render <file|-> --format svg|ascii|unicode|json
am render <file> --format png --output file.png  # one-shot only; no watch/multi-input
am preview <file|-> [--output preview.html] [--open] [--json] [--security strict]  # strict standalone HTML
am verify <file|->            structured JSON warnings (exit 3 if not ok)
am parse <file|->             ValidDiagram JSON
am serialize                  ValidDiagram JSON (stdin) → canonical source
am mutate <file|-> --op JSON  one MutationOp → verify → new source
am mutate <file|-> --ops JSON|file  many MutationOps → verify → new source
am format <file|->            idempotent reformat
am describe <file|->          prose summary or --format json AX tree
am capabilities --json        families, editPolicy, mutationOps, warning codes, formats
am batch --jsonl              JSONL stdin → JSONL envelopes (render/verify/parse/serialize/mutate)
am render-markdown <file.md> [--ascii]  render fenced Mermaid blocks
am llms-txt                   agent discovery digest
am init-agent [--dir .] [--force]  write AGENTS.md, root skills/ bundle, and .mcp.json sample
am --agent-instructions       canonical agent guide
am <cmd> --help               per-command help
```

`am verify` always emits JSON. `am mutate` dispatches by family across
flowchart/state, sequence, timeline, class, and ER; journey, xychart,
architecture, and opaque bodies return a structured `UNSUPPORTED_FAMILY` error. `am mutate` verifies before
emitting source; verify failure exits 3 and omits `source`. Use direct Mermaid
source authoring plus `am verify`/`am render` for brand-new diagrams; reserve
`am mutate` for existing structured diagrams. `am parse | am serialize` round-trips through JSON.

```bash
# Validate a tree
find docs -name '*.mmd' -print0 | while IFS= read -r -d '' f; do
  am verify "$f" | jq -e '.ok' >/dev/null || { echo "FAIL: $f"; exit 1; }
done
# Flowchart op: verifies before output
am mutate flow.mmd --op '{"kind":"rename_node","from":"X","to":"Y"}'
# Sequence op: verifies before output
am mutate seq.mmd --op '{"kind":"add_message","from":"A","to":"B","text":"Hi"}'
```

Exit codes: 0 ok, 2 arg/parse/mutation error, 3 verify failed, 4 internal.
