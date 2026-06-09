# Merged PR #11 review map

PR #11 has merged into `main`, but this map remains useful for auditing the agent-native contract as a whole rather than as one renderer patch.

## Public contract to inspect

- Library: `beautiful-mermaid/agent` exports parse, narrow, mutate, verify, serialize, SVG/ASCII/PNG render, describe, and quality helpers.
- CLI: `am render|preview|verify|parse|serialize|mutate|format|describe|capabilities|batch|render-markdown|llms-txt`.
- MCP: primary Code Mode `execute(code)` plus narrow helpers `render_png` and `describe`.
- Agent docs: `Instructions_for_agents.md`, `llms.txt`, `.claude/skills/agentic-mermaid/`, `docs/agent-mutation-policy.md`, `docs/mcp-code-mode-rationale.md`.
- Runnable examples: `examples/mcp-vs-cli-complex-diagrams.ts` and `examples/agent-improve-auth-flow.ts`.

## Editing policy

Use `am capabilities --json` as the machine-readable source of truth. Each family reports:

- `editPolicy: "structured-when-narrowed"` for flowchart/state, simple sequence, timeline, class, and ER.
- `editPolicy: "source-level-only"` for journey, xychart, architecture, and opaque fallbacks.

For new diagrams, direct Mermaid source authoring is allowed: write source → parse → verify → render. For existing modeled diagrams, use parse → narrow → mutate → verify → serialize. Do not regenerate an existing parsed diagram when a typed mutation exists.

## Visual-quality expectation

`verify.ok` means structurally valid, not visually beautiful. Layout quality is reviewed through `verify.layout`, `measureQuality`/`checkQuality`, geometry assertions, screenshots/PNG, and human inspection. Agentic Mermaid is a deterministic independent renderer; it does not promise pixel or layout parity with Mermaid's own renderer.

## Security/honesty expectation

Code Mode is local synchronous JavaScript in `node:vm`. It is not Cloudflare Codemode, not backed by `@cloudflare/codemode`, not a Worker deployment, and not an OS/container security boundary. SDK-returned diagrams are read-only in Code Mode; structured edits go through `mermaid.mutate(...)`.

## Focused verification commands

```bash
bunx tsc --noEmit
bun test src/__tests__/agent-doc-sync.test.ts src/__tests__/cli-capabilities.test.ts src/__tests__/agent-auth-flow.test.ts src/__tests__/layout-quality-heuristics.test.ts src/__tests__/architecture-layout.test.ts --timeout 600000
bun run examples/mcp-vs-cli-complex-diagrams.ts
bun run examples/agent-improve-auth-flow.ts
bun run build
```

For a fuller local pass before release or external-consumer validation, add:

```bash
bun test src/__tests__/ --timeout 600000
bun run eval/agent-usage/run.ts
bun run build:binary
bun run test:browser
```
