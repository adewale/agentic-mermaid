# Hosted MCP

Use `https://agentic-mermaid.dev/mcp` through an MCP client. It is a stateless,
tools-only Streamable HTTP server. Each diagram source or Code Mode program is
sent to the hosted service. Use the local library, CLI, or stdio MCP instead
for sensitive data, offline work, inputs over 64 KB, arbitrary local file I/O,
or file/URL PNG artifacts.

## Direct request contract

An MCP client selects the tool separately from its arguments. When showing a
request, name both explicitly:

```json
{"tool":"verify","arguments":{"source":"flowchart TD\n  API --> DB"}}
```

For raw JSON-RPC, the method remains `tools/call`:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "verify",
    "arguments": { "source": "flowchart TD\n  API --> DB" }
  }
}
```

Do not use `"method":"verify"`, put arguments directly under `params`, or
show an anonymous argument object without naming the selected tool.
The envelope's `tool` value is a bare server tool name. Never prefix it with a
provider or server name and never invent a diagram-specific tool such as
`update_state_diagram`.

If the answer calls for one final fenced JSON request, finish all prose first,
emit the request in the answer's only fenced block, then stop after its closing
fence. Never show a fenced request before the explanation, even as an example
or draft, and never repeat it. As a final preflight, count one fenced block
total and verify each op name and field against the family schema; a plausible
synonym is still an invalid call.

## Direct tools

- `verify({ source })` returns structural `ok`, detected `family`, `summary`,
  `warnings`, and layout counts. Confirm the family as well as `ok`.
- `describe({ source, format })` uses `text` for prose, `json` for an AX tree,
  and `facts` for compact deterministic semantic fact lines.
- `render_svg({ source, options? })`, `render_ascii({ source, useAscii?,
  targetWidth?, options? })`, and `render_png({ source, ...portableOptions,
  options? })` handle one-shot output.
- `mutate({ source, ops })` edits an existing modeled diagram.
- `build({ family, ops })` creates a new modeled diagram from an empty family.
- `describe_sdk({ family, detail: 'fields' })` returns exact version-matched op
  names, fields, enums, defaults, and constraints. Use `detail: 'signatures'`
  only for a compact menu.
- `execute({ code, timeoutMs? })` runs synchronous JavaScript with the injected
  `mermaid.*` global. Reserve it for custom control flow that a direct tool or
  op list cannot express.

There is no hosted `capabilities` tool. Use the MCP client's `tools/list` for
tool discovery and `describe_sdk` for one family's mutation schema.

## Declarative edit and recovery

Before unfamiliar `mutate` or `build` ops, call:

```json
{"tool":"describe_sdk","arguments":{"family":"class","detail":"fields"}}
```

Then use exactly the returned `kind` and fields. Ops are ordered,
all-or-nothing, and use `kind`, never `type`. A successful edit returns
`{ ok, family, source, verify }`; accept the source only when `ok` and
`verify.ok` are true, after inspecting `verify.warnings`.
Op kinds are not portable across families: state diagrams use `add_state` and
`add_transition`, never the flowchart-only `add_node` or `add_edge` kinds.
If the answer must identify the commit checks, spell out the exact response
paths: top-level `ok`, top-level `family`, `verify.ok`, and
`verify.warnings`. Do not paraphrase away those names.

Two common exact-schema patterns are:

```json
{"tool":"mutate","arguments":{"source":"stateDiagram-v2\n  [*] --> Idle\n  Idle --> Processing: start\n  Processing --> Complete: done","ops":[{"kind":"add_state","id":"Failed"},{"kind":"add_transition","from":"Processing","to":"Failed","label":"fail"}]}}
```

```json
{"tool":"build","arguments":{"family":"class","ops":[{"kind":"add_class","id":"Customer"},{"kind":"add_class","id":"Account"},{"kind":"add_relation","from":"Customer","to":"Account","relKind":"association"}]}}
```

For `mutate`, copy the original pre-edit source byte-for-byte into `source` and
put the desired change only in `ops`; do not pre-apply it to the source string.
For an attached or file-backed source, use a byte-aware read to determine its
line endings and final-newline state. A terminal LF is part of the source: the
JSON string must end in `\n` after the final visible line. Terminal output that
only displays the lines is not sufficient evidence that the file lacks one.
State `add_state` accepts `id`, optional `label`, `parent`, and `region`—there is
no `terminal` field. Model a terminal path explicitly with an `add_transition`
to `[*]` when the requested outcome requires one.

For class diagrams the family is `class`, not `classDiagram`; class identity is
`id`, and an association is `add_relation` with `relKind: "association"`.

On failure, read `opIndex` and `error`, refresh that family's field schema with
`describe_sdk`, and retry only the failed request with corrected documented
fields. Do not invent an op, switch to source concatenation, or split one
oversized diagram across hosted calls.
