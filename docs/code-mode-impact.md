# Code Mode in Agentic Mermaid: impact, comparison, and costs

Agentic Mermaid uses Code Mode to keep a diagram edit inside one execution:
parse the source, narrow it to a mutable family, apply typed operations, verify
the result, and serialize only after verification passes. This changes both
the model-facing boundary and the execution boundary. The model writes a small
algorithm instead of relaying each intermediate diagram through another tool
call, while the server retains the trusted diagram lineage needed to reject
forged or invalid edits.

This document uses **local Code Mode** for the self-hosted MCP process running
on the agent's machine and **hosted Code Mode** for the public
`https://agentic-mermaid.dev/mcp` endpoint. Cloudflare calls the same split
client-side and server-side Code Mode. The names describe where the sandbox
runs, not where the model runs.

## Local Code Mode

The local `agentic-mermaid-mcp` exposes `execute(code)`, which runs synchronous
JavaScript against the typed `mermaid.*` SDK in a hardened `node:vm` context.
The execution can retain parsed diagrams between SDK calls, so the model does
not have to copy an intermediate representation into another JSON request.
That matters because Agentic Mermaid's mutation checks depend on provenance:
SDK results are read-only, and structured changes must pass through
`mermaid.mutate`.

Running beside the agent also keeps diagram source local and avoids hosted
compute charges. The local server can return managed PNG files or URLs through
its direct `render_png` helper, while multi-step editing remains in `execute`.
The [MCP Code Mode rationale](./mcp-code-mode-rationale.md) explains why those
helpers stay narrow rather than recreating the full SDK as individual tools.

Progressive SDK discovery removed the largest client-side cost. The initial
`execute` declaration now contains the core SDK, while
`describe_sdk({ family, detail })` returns the mutation schema for one diagram
family. An agent that already knows an operation can skip discovery; an agent
handling an unfamiliar family can request compact signatures or exact fields.

## Hosted Code Mode

The hosted endpoint puts the sandbox behind the MCP server, so an ordinary MCP
client gets Code Mode without shipping its own execution environment. Each
uncached `execute` runs in a Cloudflare Dynamic Worker configured with an empty
environment, `globalOutbound: null`, no subrequests, and a bounded CPU budget.
The isolate configuration is the security boundary. The hardened SDK facade is
kept for behavioural parity with the local server.

Hosted execution has a per-call cost, so common pure operations do not enter
the sandbox. `render_svg`, `render_ascii`, `render_png`, `verify`, `describe`,
and `describe_sdk` run as ordinary Worker calls whose successful deterministic
results can be reused by the private server-side Workers Cache. The JSON-RPC
HTTP responses remain `cache-control: no-store`.
Declarative `mutate` and `build` apply typed operation lists through the same
mutation core and verify before returning source. They give smaller models a
direct path for routine edits while reserving `execute` for control flow that
the operation list cannot express.

Local and hosted Code Mode share the same `mermaid.*` facade. Differential
tests compare result envelopes, errors, trace behaviour, read-only enforcement,
and serialization across both runtimes. The
[hosted MCP as-built record](./project/hosted-mcp-cloudflare-plan.md) documents
the remaining runtime differences and abuse controls.

## Measured effect

[PR #157](https://github.com/adewale/agentic-mermaid/pull/157) measured the
serialized declarations and tool lists with `o200k_base`. These counts are a
stable before-and-after proxy, not a provider billing claim.

| Model-facing surface | Before | After | Tokens saved |
|---|---:|---:|---:|
| `execute` SDK declaration | 10,527 | 903 | 9,624 (91.4%) |
| Local `tools/list` | 11,781 | 1,840 | 9,941 (84.4%) |
| Hosted `tools/list` | 15,646 | 2,969 | 12,677 (81.0%) |

The median complete family schema is 495 tokens. A hosted client that loads the
initial tool list and then requests that schema consumes 3,464 tokens, 77.9%
less than the old hosted list. The largest family, flowchart, brings the total
to 4,928 tokens, which is still 68.5% lower. Compact signature responses have a
113-token median.

The same PR ran four schema-sensitive edits against the exact before and after
hosted tool lists. Each proposed mutation was replayed through the real
`applyOps` implementation and checked against semantic facts.

| Model | Before task-correct | After task-correct | After discovery |
|---|---:|---:|---:|
| `gpt-5.4-mini` | 3/4 | 4/4 | 4/4 |
| `gpt-5.3-codex-spark` | 4/4 | 4/4 | 4/4 |
| **Combined** | **7/8** | **8/8** | **8/8** |

All 16 mutations across both conditions applied successfully. The one incorrect
before-case omitted a requested Architecture edge label; the after-case kept
it. The combined four-case prompt fell from 16,048 to 5,833 tokens, a 63.7%
reduction even though the test prompt included all four family responses at
once. A normal request discloses one family.

This eval is evidence for the discovery change, not a broad model-quality
claim. It covers four tasks and two small models. Larger task sets, more model
families, and production latency measurements remain separate work.

## Comparison with Cloudflare and Anthropic

Agentic Mermaid applies Code Mode to a pure diagram library. Cloudflare and
Anthropic apply the same technique to general tool catalogs, where generated
code may call remote services and carry data between them. That scope
difference explains most of the implementation differences.

| Dimension | Agentic Mermaid | Cloudflare | Anthropic |
|---|---|---|---|
| Primary scope | One deterministic diagram SDK | MCP tools and large APIs | General tool catalogs |
| Discovery | `describe_sdk` for one diagram family | Typed connectors, or `search` over an OpenAPI document | Tool Search, or filesystem-shaped tool definitions |
| Model-written code | Synchronous JavaScript | Asynchronous JavaScript | Python in Programmatic Tool Calling |
| Execution | Local `node:vm` or hosted Dynamic Worker | Dynamic Worker isolate | Anthropic Code Execution sandbox |
| Calls made from code | Pure in-process SDK calls | MCP calls or an authenticated request callback | Developer-provided tools |
| External effects | None beyond returned diagram artifacts | Allowed through host-controlled bindings and authorization | Allowed for tools that opt into programmatic calling |
| Persistent state | None | Durable runtime options are available | Filesystem state and reusable skills are possible |

### Cloudflare

Cloudflare's first Code Mode implementation converted connected MCP tools into
a TypeScript API and ran the model's JavaScript in a Dynamic Worker. Its current
MCP patterns cover both a single `code` tool, where the complete generated API
fits in the tool description, and `search` plus `execute`, where a large
OpenAPI document stays inside the discovery sandbox. Authentication remains in
the host callback rather than entering generated code.

That general implementation supports asynchronous calls, remote APIs,
authorization and, in the durable runtime, pause-and-resume approval. Agentic
Mermaid does not need those facilities because its SDK calls are synchronous,
pure, and confined to one diagram transaction. It does use the same Dynamic
Worker substrate for hosted isolation, but it does not depend on
`@cloudflare/codemode`.

Cloudflare measured its server-side `search` and `execute` surface at roughly
1,000 tokens for more than 2,500 API endpoints, 99.9% fewer than direct MCP
definitions. Agentic Mermaid's percentage is not directly comparable because
its catalog is smaller and its hosted tool list retains more direct helpers.

Sources: [original Code Mode design](https://blog.cloudflare.com/code-mode/),
[server-side API implementation](https://blog.cloudflare.com/code-mode-mcp/),
and [current MCP server patterns](https://developers.cloudflare.com/agents/model-context-protocol/codemode/).

### Anthropic

Anthropic's November 2025 architecture generated a filesystem-like tree of MCP
tool definitions so an agent could inspect only the files it needed. It also
proposed a `search_tools` alternative with selectable detail levels. The code
execution environment could filter large results, retain intermediate state,
and pass data between tools without putting that data into the model context.

Anthropic later shipped the mechanism as Tool Search and Programmatic Tool
Calling. Deferred tools stay out of the initial prompt, while Python running in
the Code Execution sandbox can pause for an allowed tool, process the result,
and continue without sending that result through another model inference.
Anthropic reported an 85% token reduction for Tool Search in a large catalog,
along with accuracy gains on its MCP evaluations.

Agentic Mermaid's `describe_sdk` follows the same progressive-disclosure
principle but uses a family key instead of general search. Its execution model
is intentionally smaller: no filesystem, no persistence, no arbitrary tool
catalog, and no asynchronous callback loop.

Sources: [Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp)
and [advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use).

## Costs and limits

Progressive discovery moves schema tokens out of the initial prompt, but an
unfamiliar edit now needs a `describe_sdk` call before `mutate`, `build`, or
`execute`. That extra round trip is wasted on a small catalog whose definitions
are used in every session. It pays off here because most diagram tasks use one
of 14 families, and the old declarations devoted 93.1% of the hosted tool-list
tokens to the full SDK and repeated mutation menus.

Code execution also adds work that a direct tool does not need. A one-shot
render, verification, or straightforward operation list should use the hosted
direct tools. Models, especially smaller ones, can make JavaScript mistakes or
violate the SDK's provenance and serialization rules; `mutate` and `build`
exist because those failures were observed in practice.

The local and hosted sandboxes have deliberate constraints:

- Code Mode is synchronous. It rejects `async`/`await`, Promise jobs, dynamic
  imports, finalizers, and queued microtasks.
- Sandbox code has no filesystem, external network, environment variables, or
  persistent workspace.
- Local `node:vm` is hardened but is not an operating-system or container
  security boundary. It is a local tool for trusted use.
- Hosted execution creates a billable Dynamic Worker for an uncached code
  string. Direct tools and response caching keep routine work off that path.
- Hosted `execute` caches by exact code. A script that reads time or randomness
  can have its first result retained for the cache lifetime, so hosted Code
  Mode is intended for deterministic SDK workflows.
- Local timeouts use wall-clock time, while hosted limits use CPU time. Warm
  hosted isolates can retain module globals, hosted output is capped, and
  hosted PNG bytes are not part of the cross-runtime byte-determinism contract.

Keeping intermediate results outside model context is useful only when code
can decide what to discard. If the model must inspect each intermediate result
to make a semantic judgment, direct calls may be more appropriate. Anthropic
makes the same distinction for simple lookups and tasks where Claude should see
all intermediate data.

## Decision

Because Agentic Mermaid's useful unit of work is a verified diagram
transaction rather than a general agent computer, its Code Mode surface can
stay narrow. The model receives the core SDK, requests one family schema when
needed, and returns reviewable Mermaid source only after the same verifier used
by the library and CLI has accepted it. That verified source is the outcome by
which the extra sandbox and discovery call should be judged.
