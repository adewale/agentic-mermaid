# Agentic Mermaid — operating guide

Use this guide to create, edit, verify and render Mermaid diagrams. It is also
emitted by `am --agent-instructions` and served at
`https://agentic-mermaid.dev/agent-instructions.md`. `am init-agent` installs a
copy with the consumer's skill, so the operating rules remain available offline.

## Choose one channel

Do not assume this repository is checked out. Use the first available channel
that fits the task, then stop discovering tools:

| Available environment | Channel | Version-matched reference |
|---|---|---|
| JS/TS with the package installed | `agentic-mermaid/agent/core` for portable editing; `/agent` also supplies native PNG | Installed declarations and `am capabilities --json` |
| Shell | `am …` or `npx agentic-mermaid …` | `am <command> --help` |
| Connected local MCP | `agentic-mermaid-mcp` | `describe_sdk` and the connected tool list |
| Network only, with permission to send the source | Hosted MCP at `https://agentic-mermaid.dev/mcp` | Connected tool list and `describe_sdk` |

Private source should stay in a local library, CLI or self-hosted MCP. The
hosted endpoint sends source to another service; package installation also
makes network requests. Do not ask the user to perform work that your available
channel can complete.

CLI is convenient for one-shot work. In MCP, use the direct `verify`,
`describe`, render, `mutate` or `build` tool when the connected server advertises
it. Use `execute` for custom synchronous logic. The hosted and local tool lists
differ: inspect the connected server instead of borrowing another channel's
names. Hosted tools are <!-- BEGIN GENERATED: hosted-mcp-tools -->`execute`, `describe_sdk`, `render_svg`, `render_ascii`, `render_png`, `verify`, `describe`, `mutate`, and `build`<!-- END GENERATED: hosted-mcp-tools -->.

Hosted MCP is stateless Streamable HTTP JSON-RPC, with no initialize handshake
required. It has no REST render API. A raw verify request is
`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"verify","arguments":{"source":"flowchart TD\n  API --> DB"}}}`.
Use the published [MCP reference](https://agentic-mermaid.dev/docs/mcp/) for
transport and input limits; do not send private material merely to test access.

## Discover the family's actual schema

Run `am capabilities --json` for installed families, headers, examples, edit
policies, warning codes and operation fields. In MCP, use
`describe_sdk({ family, detail: 'fields' })`; `detail: 'signatures'` is a compact
menu. These describe the installed or connected version. Online
`https://agentic-mermaid.dev/capabilities.json` describes production and may be
newer than a local installation.

Choose the family from the reader's task. Use its own header, narrower and
operation vocabulary: state diagrams narrow with `asState`, not `asFlowchart`.
Mutation ops use a `kind` discriminator and family-specific fields; do not
invent synonyms or convenience flags. Pass one op to `mutate(d, op)`, not an
array. Library `applyOps({ source, ops })` and MCP `mutate({ source, ops })`
provide atomic batches; Code Mode repeats `mermaid.mutate(d, op)` instead.
For painted geometry, discover `describe_sdk({ capability: 'resolved-scene' })`
and use `renderResolvedScene`; its result limit and typed artwork failures are
part of that capability's declaration.

## Author or edit, then verify

<!-- BEGIN GENERATED: agent-workflow -->New diagrams: author Mermaid source directly, then parse → verify → render or return it. `buildMermaid(kind, ops)` / `createMermaid(kind)` build a diagram from typed ops when you are generating one programmatically (for example, from data). Existing structured diagrams: parse → narrow → mutate → verify → serialize.<!-- END GENERATED: agent-workflow -->

<!-- BEGIN GENERATED: family-narrowing -->Narrowing selects a structured, typed family with an as* helper. It does not select one element or freeze layout coordinates.<!-- END GENERATED: family-narrowing -->

For an existing structured diagram, retain its parsed value and apply the
smallest typed edit. Code Mode exposes synchronous `mermaid.*` methods and
read-only returned diagrams; use mutation operations rather than assigning into
the body. It does not support imports, async functions, Promise jobs or local
file I/O. Library calls use the same names without the `mermaid.` prefix.

This existing-diagram example runs in Code Mode:

```ts
const parsed = mermaid.parseRegisteredMermaid('flowchart TD\n  API --> DB')
if (!parsed.ok) return { phase: 'parse', errors: parsed.error }
const flow = mermaid.asFlowchart(parsed.value)
if (!flow) return { phase: 'narrow', family: parsed.value.kind }
const edited = mermaid.mutate(flow, { kind: 'add_node', id: 'Cache', label: 'Cache' })
if (!edited.ok) return { phase: 'mutate', error: edited.error }
const verify = mermaid.verifyMermaid(edited.value)
if (!verify.ok) return { phase: 'verify', warnings: verify.warnings }
return { source: mermaid.serializeMermaid(edited.value) }
```

A new diagram needs no mutation step:

```ts
const source = 'flowchart LR\n  API --> DB'
const parsed = mermaid.parseRegisteredMermaid(source)
if (!parsed.ok) return { phase: 'parse', errors: parsed.error }
const verify = mermaid.verifyMermaid(parsed.value)
if (!verify.ok) return { phase: 'verify', warnings: verify.warnings }
return { source }
```

Run `verifyMermaid` at every commit point: before source is saved, sent or
shown, and after the last edit before serialization. Inspect `ok`, `warnings`
and layout evidence. For MCP `mutate` or `build`, require top-level `ok`, the
intended `family` and `verify.ok`; inspect `verify.warnings`. If an op fails,
keep the previous artifact, inspect `opIndex` and the error, then rediscover
its exact fields before retrying. In a hosted edit request, `source` is the
original pre-edit input, byte-for-byte; express changes only in `ops`.

<!-- BEGIN GENERATED: verify-result -->`verify.ok` means no unsuppressed error was detected, including measured content occlusion and explicit error policies. It is not a visual-quality or semantic-correctness score.<!-- END GENERATED: verify-result -->

<!-- BEGIN SEMANTIC READBACK -->
Before returning, compare the result with the task. Preserve requested labels,
values, prefixes, endpoints and relationships exactly; verification alone will
not catch an omitted transition label or visibility marker. Use
`describeMermaidFacts(d)` / `checkMermaid(d, requiredFacts)` or MCP `describe`
with `format: 'facts'` for semantic read-back. For a new diagram, also check the
intended family and whether its advertised narrower returns a structured body.
If it unexpectedly falls back to opaque, inspect the warning and the family's
capability example instead of calling a merely renderable result editable.
<!-- END SEMANTIC READBACK -->

Do not suppress error-severity findings or truncate authored content to make
verification pass. For intentionally long labels, set `labelCharCap` or
`am verify --label-cap N` to the intended policy. For `INTERNAL_ERROR`, report
the original source and diagnostic; do not rewrite the diagram to hide a
renderer defect. The [warning reference](https://agentic-mermaid.dev/warnings/)
and [architecture reference](https://github.com/adewale/agentic-mermaid/blob/main/AGENT_NATIVE.md)
explain the generated warning catalog and its limits.

## Source-preserved and opaque input

Unmodeled syntax can remain as opaque source or verbatim segments. A null
narrower refuses structured mutation; it does not mean the source is empty.
If a task explicitly needs a source-level edit, make the smallest edit, say
`source-level fallback`, then reparse and verify. Preserve comments and bytes
outside the requested edit. Do not silently regenerate the diagram.

For bounded opaque Class/Flowchart edits, use
`mutatePreservingSource(diagram, op)`: Class `add_member`/`remove_member`, or
Flowchart `set_label`/`rename_node`. Save `value.source` exactly after inspecting
`verifyMermaid(value.diagram)`. The body remains opaque and its portability
warning remains. Ambiguous ownership and unsupported dependencies refuse
atomically. Library `applyOps` and MCP `mutate` select these batches with
`mode: 'source-preserving'`; CLI uses `--preserve-source`. Read the
[mutation policy](https://agentic-mermaid.dev/docs/agent-mutation-policy/) for
operation limits before choosing this path.

## Render and inspect

Use the requested SVG, PNG, ASCII, Unicode or layout output. Choose `style`
from `am styles --json`, an inline data-only spec or a stack; validate untrusted
specs with `validateStyleSpec`. `seed` varies styled ink without moving layout.
Use strict security when output must contain no external-fetch references;
render and verify with the same options. PNG sizing and font availability can
change readability: inspect the artifact rather than treating a successful
render or a `BELOW_READABLE_SIZE` warning as a general quality verdict.
Gantt has no implicit clock read: pass `ganttToday` to draw today's marker.

Flowchart labels containing punctuation should be quoted. In a quoted label,
`\n` is a line break and canonical serialization uses `<br>`. A group is
`subgraph id["Title"] … end`; labeled and dotted edges use
`A -- "label" --> B`, `A -.-> B` and `A -. "label" .-> B`. Use another family's
capability example for its syntax. The [API reference](https://agentic-mermaid.dev/docs/api/)
separates source objects, Scene parts and resolved painted primitives.

## Ground the task and return the result

Read supplied repositories, files and URLs when available. Every node and edge
must follow the supplied context or inspected source. Include each requested
entity and relationship; do not merge them to simplify the task. Mark uncertain
connections or omit them with an explanation. When context leaves the scope or
abstraction level open, choose the smallest consistent interpretation, keep
one abstraction level and state the assumptions. If the intended audience,
medium or improvement is unclear, inspect read-only information and ask for
the missing goal before changing the diagram.

In chat, return `Updated Mermaid` with the final source in a Mermaid fenced
code block, `Verification` with
what was actually checked and any limitations, and `Trace` naming the channel
and calls used. Include `Sources` for inspected files. Return additional
artifacts when requested. In Code Mode, return `{ source }` after verification
or an error object. If asked for one final fenced JSON tool request, finish
all prose before its only fenced block and stop after the block.

If no Agentic Mermaid channel is available, return the best source and say
`not verified — Agentic Mermaid unavailable`, naming what you tried. Label
secondary parser checks as secondary; never invent an Agentic Mermaid result.
Do not modify project files unless the user asked for file changes.

For task recipes, read the [editing cookbook](https://agentic-mermaid.dev/docs/agent-api-cookbook/).
Use local package declarations and discovery over newer online examples when
working with an older installed version.
