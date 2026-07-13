# MCP Code Mode rationale

Local `agentic-mermaid-mcp` is intentionally Code Mode first. Its primary tool is `execute(code)`, which runs synchronous JavaScript against the typed `mermaid.*` SDK in a local `node:vm` sandbox. This is a local implementation inspired by Code Mode as a product shape; it is not Cloudflare Codemode, not backed by `@cloudflare/codemode`, and not an OS/container security boundary. The local helper tools (`describe_sdk`, `render_png`, and `describe`) are narrow conveniences, not a second full authoring API.

There is now also a **hosted** MCP at `https://agentic-mermaid.dev/mcp` (stateless Streamable HTTP; see [`docs/project/hosted-mcp-cloudflare-plan.md`](./project/hosted-mcp-cloudflare-plan.md)). It keeps `execute` but runs agent code in a per-request Cloudflare Dynamic Worker isolate (`globalOutbound: null`, empty env, `cpuMs` budget) instead of a local `node:vm` — there the isolate configuration *is* the security boundary — and adds `describe_sdk` plus direct `render_svg`/`render_ascii`/`render_png`/`verify`/`describe` tools so schema discovery and common render/verify paths avoid a billable isolate, plus the declarative `mutate`/`build` tools (see below). Both share the same hardened `mermaid.*` facade; their semantics are pinned against each other by a differential test suite.

## Why the MCP server exists

Agents often need a multi-step diagram transaction:

1. parse source;
2. narrow to a mutable family;
3. apply one or more typed mutations;
4. verify and inspect the result;
5. serialize only after verify passes.

As separate MCP tools, that workflow becomes many tool calls and loses useful in-call state. In Code Mode it is one call: the agent writes the small algorithm and the server preserves lineage/tracing inside the execution.

## Code Mode first, plus a narrow declarative edit surface

Code Mode stays the primary tool for multi-step logic. But `execute` asks the
model to write correct sandboxed JavaScript, and a weaker model drives that
poorly (serialization pitfalls, provenance rules, sync-only constraints) when
all it wanted was to apply a few structured edits. So the hosted surface adds
exactly **two** declarative tools — `mutate` (edit a `source`) and `build`
(author from a `family`) — that take a JSON op list and return one canonical
`{ ok, family, source, verify }` envelope. They run verify internally and only
emit source when it passes, so the verify-before-commit contract holds without
the model writing it. Both funnel through the same validated `mutateChecked`
core as Code Mode's `mermaid.mutate`, so an op is rejected identically either
way — there is no second implementation to drift.

We still do **not** explode the surface into `parse`/`narrow`/`serialize`/… as
separate tools: those are the composable steps `execute` exists to sequence in
one call, and a full per-operation MCP API would multiply round trips, weaken
in-call lineage, and be another public contract to keep in lockstep. `mutate`
and `build` are the deliberate exception because a *structured edit* is the one
workflow that (a) is common, (b) needs no arbitrary logic, and (c) a weak model
gets wrong through `execute`. For everything richer, use `execute`, the CLI
(`am mutate --ops`, `am verify`, `am render`), or a library import.

## What the non-Code-Mode MCP tools are for

Local MCP keeps only three helpers:

- `describe_sdk({ family, detail })` returns version-matched mutation operations for one family without running Code Mode. `detail: "signatures"` returns a compact menu; `detail: "fields"` returns the exact field schema. The initial `execute` declaration stays limited to the core SDK, while `mermaid.describeOps` and `mermaid.opSignatures` expose the same registry inside an execution.

- `render_png(source)` exists because PNG is binary output and returning base64 from a dedicated MCP tool is simpler than putting binary handling into Code Mode snippets. It accepts local `fontDirs`/`loadSystemFonts` remedies and returns deterministic configuration/font-coverage warnings. For clients that cannot comfortably carry large base64 payloads, `render_png({source, output:"file"})` writes a managed local artifact and `output:"url"` returns an HTTP-served artifact when the server runs with HTTP/SSE transport. Because those modes create managed files, the tool is annotated as non-read-only and non-idempotent.
- `describe(source)` exists because one-shot natural-language summaries are common for screen readers, docs, and context compaction.

The hosted endpoint adds the same direct discovery tool and direct pure tools (`render_svg`, `render_ascii`, `render_png`, `verify`, `describe`) because every hosted `execute` spins a Dynamic Worker isolate; schema discovery and common render/verify calls should be ordinary Worker invocations and edge-cacheable. Hosted `mutate` and `build` are the only declarative authoring tools, and they exist to apply typed op lists with the verify-before-emit contract without asking a weaker model to write JavaScript. They do not introduce a separate mutation engine.

Local managed artifacts are generated under the server artifact directory with safe names, size limits, TTL cleanup, MIME type, byte count, and SHA-256 metadata; they are not arbitrary user-chosen file writes. Hosted `render_png` returns base64 only.

## Equivalence example

`examples/mcp-vs-cli-complex-diagrams.ts` builds the same complicated diagrams two ways: an Auth Flow flowchart with feedback loops and an Order Domain ER diagram.

- MCP Code Mode: `tools/call execute` runs parse → narrow → mutate[] → verify → serialize.
- CLI: `am mutate <diagram>.mmd --ops ops.json --json` runs the same typed mutation batch and verify-before-emit contract.

The example asserts that both channels produce byte-identical Mermaid source for every case. This is the supported equivalence story: **MCP Code Mode and CLI/library can produce the same diagrams**. Hosted `mutate`/`build` are a bounded shortcut for the same typed op-list workflows, not a replacement for Code Mode when custom control flow is needed.

## Transports

The default transport is stdio for local MCP clients:

```sh
agentic-mermaid-mcp
```

HTTP/SSE reachability is available when a client needs a network endpoint. See [`mcp-http-transport.md`](./mcp-http-transport.md) for the full quickstart, JSON-RPC examples, option table, and security defaults:

```sh
agentic-mermaid-mcp --transport http --host 127.0.0.1 --port 3000 \
  --artifact-dir .agentic-mermaid-artifacts
```

The HTTP transport exposes `/sse` for MCP SSE sessions, `/message?sessionId=...` for session messages, `/rpc` for direct JSON-RPC tests/integrations, `/health`, and `/artifacts/<name>` for managed outputs. It binds to loopback by default; non-loopback binding requires `--auth-token`, and `/rpc`/`/message` require `content-type: application/json` so browser-simple CSRF posts are rejected. Use an explicit host only when you have reviewed the sandbox and artifact exposure boundary.

Example stdio `.mcp.json` entry:

```json
{
  "mcpServers": {
    "agentic-mermaid": {
      "command": "npx",
      "args": ["-y", "agentic-mermaid-mcp"]
    }
  }
}
```

Example HTTP launch command for clients that manage MCP SSE URLs separately:

```sh
npx -y agentic-mermaid-mcp --transport http --host 127.0.0.1 --port 3000
# non-loopback requires --auth-token <token>
```

## When to add more MCP tools

Add another non-Code-Mode MCP tool only with evidence that a real client cannot use `execute`, hosted `mutate`/`build`, or the CLI/library path. Until then, keep the surface small: one compositional tool, direct pure render/verify/describe tools where they avoid hosted isolate cost, and the two declarative structured-edit tools.
