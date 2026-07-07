# Agent workflow examples

These examples are runnable and covered by tests so they do not drift from the agent/CLI/MCP contracts.

## Create a complicated diagram through MCP and CLI

Run:

```bash
bun run examples/mcp-vs-cli-complex-diagrams.ts
```

What it demonstrates:

- MCP Code Mode path: `tools/call execute` runs `parseMermaid → asFlowchart → mutate[] → verifyMermaid → serializeMermaid` in one sandboxed call.
- CLI path: `am mutate auth-flow.mmd --ops ops.json --json` applies the same mutation batch and verifies before emitting source.
- The example asserts both channels produce byte-identical Mermaid source for multiple non-trivial cases: an Auth Flow with decisions/feedback loops and an Order Domain ER diagram.

This is the intended local equivalence story: MCP Code Mode and CLI/library can create the same diagram. The local non-Code-Mode helpers remain narrow (`render_png`, `describe`); the hosted `/mcp` endpoint additionally offers direct pure render/verify/describe tools plus declarative `mutate`/`build` for bounded structured edits.

## Improve a diagram through an agent loop

Run:

```bash
bun run examples/agent-improve-auth-flow.ts
# or choose a stable output location
bun run examples/agent-improve-auth-flow.ts --out-dir /tmp/auth-flow-improved
```

What it demonstrates:

1. The agent creates a draft Auth Flow via typed mutations.
2. It assesses the draft with `verifyMermaid(..., { labelCharCap: 28 })` and layout bounds.
3. It spots problems: long decision labels and wide LR layout.
4. It applies a second mutation batch (`set_label`) to improve readability while preserving structure.
5. It reassesses impact: warnings and longest-label length decrease, and bounds shrink.
6. It writes final render artifacts. SVG/ASCII come from Code Mode; PNG is rendered by the host from the verified final source, matching the local MCP helper rationale that binary output should stay a narrow helper/host responsibility. On the hosted endpoint, direct `render_svg`/`render_ascii`/`render_png` tools cover the same artifact path without a Code Mode isolate.
   - `auth-flow-before.mmd`
   - `auth-flow-improved.mmd`
   - `auth-flow-improved.svg`
   - `auth-flow-improved.txt` (ASCII)
   - `auth-flow-improved.png`
   - `assessment.json`

The point is not that `verify.ok` alone proves visual quality. The example records concrete assessment signals before and after mutation, then emits human-reviewable render artifacts.
