# MCP Code Mode rationale

`agentic-mermaid-mcp` is intentionally Code Mode first. Its primary tool is `execute(code)`, which runs synchronous JavaScript against the typed `mermaid.*` SDK in a local `node:vm` sandbox. This is a local implementation inspired by Code Mode as a product shape; it is not Cloudflare Codemode, not backed by `@cloudflare/codemode`, and not an OS/container security boundary. The helper tools (`render_png` and `describe`) are narrow conveniences, not a second full authoring API.

## Why the MCP server exists

Agents often need a multi-step diagram transaction:

1. parse source;
2. narrow to a mutable family;
3. apply one or more typed mutations;
4. verify and inspect the result;
5. serialize only after verify passes.

As separate MCP tools, that workflow becomes many tool calls and loses useful in-call state. In Code Mode it is one call: the agent writes the small algorithm and the server preserves lineage/tracing inside the execution.

## Why there is no parallel non-Code-Mode authoring surface

We deliberately do **not** expose `parse`, `mutate`, `verify`, `serialize`, `render_svg`, and every future operation as separate MCP tools. A full non-Code-Mode MCP surface would create:

- tool/schema explosion;
- extra round trips for every edit;
- weaker diagram lineage between calls;
- more chances to serialize before verify is inspected;
- another public API that must stay in lockstep with the library, CLI, docs, and capability JSON.

The non-Code-Mode path is the **CLI or library import**, not a second MCP toolset. Use `am` when the agent has shell access and wants explicit verbs such as `am verify`, `am mutate --ops`, `am render`, or `am preview`. Use the library when the agent can run JS/TS directly. Use MCP `execute` when an MCP client should compose the SDK in one sandboxed call.

## What the helper MCP tools are for

- `render_png(source)` exists because PNG is binary output and returning base64 from a dedicated MCP tool is simpler than putting binary handling into Code Mode snippets.
- `describe(source)` exists because one-shot natural-language summaries are common for screen readers, docs, and context compaction.

Both helpers consume source. They are not intended to independently author or mutate diagrams.

## Equivalence example

`examples/mcp-vs-cli-complex-diagrams.ts` builds the same complicated diagrams two ways: an Auth Flow flowchart with feedback loops and an Order Domain ER diagram.

- MCP Code Mode: `tools/call execute` runs parse → narrow → mutate[] → verify → serialize.
- CLI: `am mutate <diagram>.mmd --ops ops.json --json` runs the same typed mutation batch and verify-before-emit contract.

The example asserts that both channels produce byte-identical Mermaid source for every case. This is the supported equivalence story: **MCP Code Mode and CLI/library can produce the same diagrams**, while MCP helper tools remain intentionally narrow.

## When to add more MCP tools

Add a non-Code-Mode MCP tool only with evidence that a real client cannot use `execute` or the CLI/library path. Until then, keep the MCP surface small: one compositional tool plus narrow helpers for binary output and summaries.
