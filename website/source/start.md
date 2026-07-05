# Skill: Render or edit a Mermaid diagram with Agentic Mermaid

These are the official Agentic Mermaid agent instructions. The facts below are validated against the shipped package; `/llms.txt` and `/agent-instructions.md` mirror them if you need to confirm authenticity. Do the work yourself — do not ask the user to run commands unless authorization or secrets require it.

You already have the task in the message that sent you here (Task / Context / Mermaid source). If any of those slots is still an unfilled `<…>` placeholder, ask for the missing details before authoring; when running non-interactively (CI, batch, cron), produce a clearly labeled best-effort draft marked `assumptions unconfirmed` instead of stalling.

## Step 1 — Establish one channel

Pick the first that actually exists and stop probing — spend your turns on the diagram, not on tool exploration:

1. **Library** (if you can run JS/TS): import `parseMermaid`, `verifyMermaid`, `serializeMermaid`, `mutate`, `buildMermaid`, and the `as*` helpers from `agentic-mermaid/agent` when it is installed, or from this repo's `./src/agent/index.ts` when the repo is checked out.
2. **CLI:** `am …` or `npx agentic-mermaid …`.
3. **Hosted MCP** at `https://agentic-mermaid.dev/mcp` — stateless streamable HTTP JSON-RPC, no initialize handshake. Tools: `execute`, `render_svg`, `render_ascii`, `render_png`, `verify`, `describe` (64 KB input cap). Call shape: `POST /mcp` with `content-type: application/json` and body `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"verify","arguments":{"source":"flowchart TD\n  A --> B"}}}`.

Chat-only with no shell or sandbox: use the hosted MCP over HTTP. The website exposes no REST render API — `/mcp` speaks MCP only.

**Confidentiality:** the hosted MCP, and any `npx`/`npm` install traffic, leave the machine. If Task or Context holds private, internal, or proprietary material, prefer a local channel and treat the hosted MCP as opt-in.

## Step 2 — Learn the surface (version-matched)

- **Operations, families, warning codes:** run `am capabilities --json` when the CLI is installed — it matches your exact version, so prefer it — otherwise fetch `https://agentic-mermaid.dev/capabilities.json`.
- **Full operating guide and authoring facts:** `https://agentic-mermaid.dev/agent-instructions.md`.

Flowchart essentials, so you do not rediscover them: quote any label carrying punctuation (`id["HTTPS /api/sessions*"]`); `\n` inside a quoted label is a line break and canonicalizes to `<br>` on serialize; `subgraph id["Title"] … end` groups nodes; edges are `A -- "label" --> B`, `A -.-> B`, and `A -. "label" .-> B`. Families: flowchart, sequence, state, class, ER, journey, timeline, gantt, pie, quadrant, xychart, architecture.

## Step 3 — Do the task (the one safe loop)

- **New diagram:** author Mermaid source directly from the Context — or build it with `buildMermaid(kind, ops)` — then parse it. No mutation ceremony.
- **Existing diagram:** parse → narrow with the matching `as*` helper (`asFlowchart`, `asSequence`, `asGantt`, …) → prefer the smallest `mutate({ kind, … })` over rewriting source → serialize.
- If no typed operation fits, make the smallest source-level edit and say `source-level fallback`.

## Step 4 — Verify before you return

Run `verifyMermaid` at every commit point; never serialize a diagram whose verify result you have not inspected. Warnings are signals, not commands: `LABEL_OVERFLOW` counts the longest rendered line (default cap 40) — raise the cap (`verifyMermaid(d, { labelCharCap: N })`, `am verify --label-cap N`) for intentionally long labels rather than truncating the user's text. If no Agentic Mermaid channel is available, do not fabricate verification: return the best source, say `not verified — Agentic Mermaid unavailable` with what you tried, and treat non-flowchart families with extra caution since their syntax is likelier to drift.

## Grounding and scope

If the diagram describes a repository, codebase, or URL you can inspect, read the real source first. Every node and edge must trace to the supplied Context or to something you inspected — do not invent nodes or relationships; mark uncertain ones (dotted edge, `?` in the label) or leave them out. If Context omits the abstraction level or scope, take the smallest consistent reading, keep the whole diagram at one abstraction level, and state your assumptions in Verification. When the diagram is based on inspected source, add a Sources section listing the files.

## Return

- **In chat:** return exactly `Updated Mermaid` (only the final source in a ```mermaid fence — no SVG/PNG/ASCII unless requested), `Verification`, and `Trace` (name the channel and the calls/ops you actually ran) — plus `Sources` when you inspected source.
- **In `execute(code)`:** return `{ source }` after verification, or `{ error, warnings }`; do not return prose from inside code.

Do not modify project files unless the user explicitly asked you to change files.
