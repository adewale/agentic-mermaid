# Agent-Native Beautiful Mermaid — Plan

**Status.** Working spec, single source of truth. Branch: `claude/agentic-mermaid-blocks-r5lzs`. Not intended for upstream.

**Thesis.** Agents authoring Mermaid diagrams today regenerate the whole source on every edit, or render to PNG and read it back with vision. Beautiful Mermaid already fixed the worst of the rendering side (sync + DOM-free + ASCII). This fork adds the editing surface — structured verification, typed mutation, round-trippable IR — so an agent can edit one node and trust the result without ever opening an image.

---

## Why fork Beautiful Mermaid

The stack is three layers, each contributing something the others can't:

| Layer | Contribution |
|---|---|
| **Mermaid (grammar)** | 20+ diagram families. Rendered inline by GitHub, GitLab, Obsidian, Notion. Frontmatter + init + runtime config plane. `accTitle`/`accDescr` directives. **The corpus moat.** |
| **Beautiful Mermaid (renderer)** | Synchronous, zero DOM, pure TypeScript. ASCII output. Two-color theming. Semantic role styling. 9 diagram families with full layout/render coverage. Property + mutation + e2e test scaffold already in place. **The AI-era renderer Craft built for Craft Agents.** |
| **Agentic Mermaid (this spec)** | `ValidDiagram` IR. Deterministic layout. `verify()`. `mutate()` + round-trip `serializeMermaid`. Claude Code skill, CLI, `--agent-instructions`. **The editing surface.** |

D2 has a better language than Mermaid. Beautiful Mermaid has a better renderer than D2 for agent contexts. Mermaid has a corpus neither of them has. The bet: stacking the three wins.

---

## The three properties

1. **Deterministic layout** — same input → byte-identical canonical artifact.
2. **Verifiable rendering** — structured "did this render cleanly?" check.
3. **Round-trippable** — parse → mutate → serialize, semantics preserved.

(Composition — `@include`, templates, layered scenarios — was the fourth in earlier drafts and is deferred. Agents do not currently reach for composition; they paste and edit. Add when evidence demands.)

(1) is a prerequisite for (2) and (3). Skip it and the others check moving targets.

---

## (0) Substrate

Every source of nondeterminism in the layout/render path is parameterized via `LayoutContext`:

```ts
interface LayoutContext {
  rng: SeededRNG            // seeded LCG; default seed 0
  fontMetrics: MetricsTable // frozen JSON shipped with the package
  clock: Clock              // mock by default
}
```

Enforcement:

- **Lint rule** bans `Math.random()`, `Date.now()`, `performance.now()`, and naked `new Map()` iteration in `src/{layout,renderer,architecture,xychart,sequence,class,er,timeline,journey}/**`.
- **ELK call sites** swap from `thoroughness`-driven randomized trials to a seeded crossing minimizer.
- **Frozen font-metric table** is generated once via headless browser, checked in at `assets/font-metrics.json`. CI fails if live measurement diverges beyond tolerance.

This is the move the rest of the spec sits on top of.

---

## (1) Deterministic layout

`deterministic: true` is the default. The canonical artifact is the **layout JSON**, not the SVG:

```json
{
  "version": 1,
  "seed": 0,
  "kind": "flowchart",
  "nodes":  [{ "id": "A", "x": 12, "y": 36, "w": 80, "h": 40, "shape": "rect" }, ...],
  "edges":  [{ "id": "A->B", "from": "A", "to": "B", "path": [[..],[..]], "label": {...} }, ...],
  "groups": [{ "id": "g1", "x": 0, "y": 0, "w": 200, "h": 120, "members": ["A","B"] }, ...],
  "bounds": { "w": 320, "h": 180 }
}
```

SVG is the visual projection. Two render results are equal iff their layout JSONs are equal. Equality is structural deep equality. This sidesteps the rathole of sorting every SVG attribute.

---

## (2) Verifiable rendering

```ts
verifyMermaid(source: string | ValidDiagram, opts?: VerifyOptions): VerifyResult

interface VerifyOptions {
  suppress?: WarningCode[]      // codes to omit, e.g. ['UNKNOWN_SHAPE']
  layoutContext?: LayoutContext
}

interface VerifyResult {
  ok: boolean
  warnings: LayoutWarning[]
  layout: RenderedLayout
}
```

| Code | Severity | Description |
|---|---|---|
| `LABEL_OVERFLOW`   | error   | Label exceeds container bounds |
| `OFF_CANVAS`       | error   | Node or edge segment lies outside canvas |
| `EDGE_MISANCHORED` | error   | Edge endpoint does not attach to a real node |
| `GROUP_BREACH`     | error   | Member node lies outside its group's bounds |
| `EMPTY_DIAGRAM`    | error   | Diagram contains no renderable elements |
| `NODE_OVERLAP`     | warning | Two nodes overlap (sometimes intentional) |
| `ROUTE_SELF_CROSS` | warning | Edge route crosses itself |
| `UNKNOWN_SHAPE`    | warning | Shape unrecognized; default used |

Codes are the contract surface agents reason about. Emitting an undocumented code fails CI; documenting an unemitted one also fails CI. Agents omit known-irrelevant codes via `VerifyOptions.suppress`.

The data already exists — the layout pass computes bounds and discards them. Plumbing, not new analysis.

**Branded coordinate types** (`Finite`, `ValidCoord`) prevent invalid values from reaching the renderer.

**Model-gap property test**: for every generated `D` that parses successfully, `verify(D).warnings` filtered to severity `error` must be empty. Counterexamples are renderer bugs.

---

## (3) Round-trippable

A sealed `ValidDiagram` that preserves everything the source had:

```ts
interface ValidDiagram {
  readonly kind: DiagramKind
  readonly meta: {
    frontmatter?: Frontmatter
    initDirectives: InitDirective[]
    comments: Comment[]
    accessibility: { title?: string, descr?: string }
  }
  readonly body: DiagramBody
  readonly source: SourceMap
}

parseMermaid(source: string):           Result<ValidDiagram, ParseError[]>
serializeMermaid(d: ValidDiagram):      string
mutate(d: ValidDiagram, op: MutationOp): Result<ValidDiagram, MutationError>
```

Two contracts:

- `serializeMermaid(parseMermaid(s)) ≡ normalize(s)` for canonical input.
- `parseMermaid(serializeMermaid(d)) ≡ d` for every `d` produced by parse or mutate.

Six `MutationOp` kinds for v1 — they cover ~80% of agent edits:

| Kind | Required | Optional | Inverse |
|---|---|---|---|
| `add_node`    | `id`, `label`     | `shape`, `parent` | `remove_node(id)` |
| `remove_node` | `id`              | —                 | `add_node(id, label, shape, parent)` |
| `rename_node` | `from`, `to`      | —                 | `rename_node(to, from)` |
| `set_label`   | `target`, `label` | —                 | `set_label(target, prev_label)` |
| `add_edge`    | `from`, `to`      | `label`, `style`  | `remove_edge(id)` |
| `remove_edge` | `id`              | —                 | `add_edge(from, to, label, style)` |

Add more ops as evidence accumulates. Lint rule bans constructing `ValidDiagram` outside `parseMermaid` and `mutate`.

---

## Public API

```ts
parseMermaid(source: string):                              Result<ValidDiagram, ParseError[]>
layoutMermaid(d: ValidDiagram, ctx?: LayoutContext):       RenderedLayout
renderMermaidSVG(input: ValidDiagram | string, opts?):     string
renderMermaidASCII(input: ValidDiagram | string, opts?):   string
verifyMermaid(input: ValidDiagram | string, opts?: VerifyOptions): VerifyResult
serializeMermaid(d: ValidDiagram):                         string
mutate(d: ValidDiagram, op: MutationOp):                   Result<ValidDiagram, MutationError>
```

**CLI** (`am <verb>`) with `--json` everywhere: `render`, `verify`, `parse`, `serialize`, `mutate`, `format`. Plus `am --agent-instructions` printing the canonical agent-use guide embedded in the binary at build time — agents read the doc that ships with the tool, not whatever their training set indexed.

---

## Breaking changes from Beautiful Mermaid

- **Package renamed** to `agentic-mermaid` on npm. No drop-in claim.
- **Deterministic layout is the default.**
- **IDs are content-hashed and stable** across runs.
- **`MermaidGraph` is removed** in favor of `ValidDiagram`.
- **`renderMermaidSVGAsync` is removed** — sync path is deterministic; no reason for async.
- **`mermaidConfig` precedence** (frontmatter < init < render options) is enforced by tests via a single merge function.

---

## Distribution

Four artifacts, all derived from this doc:

- **npm package** `agentic-mermaid`. The full TypeScript API. Agents with shell access import the library directly and compose verbs in their own TS; no MCP wrapper required.
- **`.claude/skills/agentic-mermaid/`** Claude Code skill bundle. Master `SKILL.md` routes by diagram family to per-family references; progressive disclosure means the LLM loads only the reference it needs. References sync from upstream Mermaid docs weekly via GitHub Action, alongside our additions (LayoutWarning codes, MutationOp taxonomy).
- **`agentic-mermaid-mcp`** Code Mode MCP server. **One tool, `execute(code: string)`**. The model writes an async arrow against the typed `mermaid.*` SDK declaration embedded in the system prompt; the server runs the arrow's body in a `node:vm` sandbox with the library exposed as `mermaid` and the arrow's return value captured as the structured result. The verify-after-mutate loop becomes one round-trip rather than N. Hosting: local stdio launched by the MCP client (Claude Desktop, Claude Code, Cursor) — same deployment shape as filesystem-MCP, git-MCP, sqlite-MCP. No infrastructure on our side or the user's. The pattern follows Cloudflare's `@cloudflare/codemode/mcp` design; we ship our own Node executor because our library is pure-functional and doesn't need `WorkerLoader` bindings. The same binary supports `--http` for self-hosted HTTP/SSE, and the architecture admits a Cloudflare Worker deployment via `DynamicWorkerExecutor` for orgs that want one, but we ship neither as a hosted service.
- **`AGENTS.md`** at repo root, hard-capped under 100 lines. `am --agent-instructions` prints the workflow section below at runtime; a doc-sync test asserts the two are byte-identical.

No HTTP endpoint or editor WebSocket watch in v1. The skill teaches Code Mode for both paths: agents-with-shell write TS against the imported library; agents-without-shell write TS against the MCP's `mermaid.*` SDK. Same surface in both cases.

---

## Agent workflow

(This section is the canonical agent-use guide. `am --agent-instructions` prints exactly this section.)

### Quick start

```ts
import { parseMermaid, mutate, verifyMermaid, serializeMermaid } from 'agentic-mermaid'

const d0 = parseMermaid(source).unwrap()
const d1 = mutate(d0, { kind: 'add_node', id: 'Cache', label: 'Cache' }).unwrap()
const d2 = mutate(d1, { kind: 'add_edge', from: 'API', to: 'Cache' }).unwrap()

const result = verifyMermaid(d2)
if (!result.ok) {
  // result.warnings is structured; back up to d1 and try a different op
}

const out = serializeMermaid(d2)
```

### The verify-after-mutate rule

Run `verifyMermaid` at every **commit point** — anywhere the result would be saved, sent, or shown. You may batch several `mutate` calls between verifications, but never serialize a `ValidDiagram` whose `verify` result you have not inspected.

### Expected warnings

Suppress `UNKNOWN_SHAPE`, `NODE_OVERLAP`, or `ROUTE_SELF_CROSS` when intentional. Never suppress `LABEL_OVERFLOW`, `OFF_CANVAS`, `EDGE_MISANCHORED`, `GROUP_BREACH`, or `EMPTY_DIAGRAM` — these indicate rendering bugs or malformed input.

### Anti-patterns

- Regenerating source instead of mutating. Defeats round-trip; produces noise.
- Verifying once at the end of a long chain. Loses precision about which op broke it.
- Concatenating Mermaid source strings. Use `mutate` and `serializeMermaid`.

---

## Sequencing

Three phases, not stages:

| Phase | Lands | Notes |
|---|---|---|
| **Ship** | Substrate + `verify` + `mutate` + `serialize` + 6 MutationOp kinds + CLI + skill + Code Mode MCP + `AGENTS.md` | The minimum lethal version. |
| **Learn** | Run against MermaidSeqBench. Watch how the skill and MCP get used. Track which MutationOps are missing. | Decide what next-phase work is justified by evidence. |
| **Expand** | More MutationOps, composition primitives, HTTP/SSE MCP transport (if remote deployments materialize), additional diagram families | Earn by evidence, not by spec. |

---

## Measurement

| What | How | Target |
|---|---|---|
| Layout JSON byte-equality across runs | Determinism grid, ~100 cases (4 directions × 2..10 nodes × sparse\|dense) | 100% |
| Drift sentinel | 30 hand-picked canonical layout JSONs committed to the repo; any change without explicit acknowledgment fails CI | — |
| Verifier recall | Per-code positive fixtures (5–10 each) under `tests/fixtures/verifier/{CODE}/positive/` | ≥95% |
| Verifier precision | Per-code negative fixtures (5–10 each) under `tests/fixtures/verifier/{CODE}/negative/` | ≥98% |
| Round-trip identity | 30-fixture golden corpus with promoted diffs | 100% |
| Round-trip property | Property test (fast-check), 1K cases per PR | 100% |
| Code Mode sandbox isolation | Property test: arbitrary TS input to `execute()` cannot reach the filesystem, network, `process`, `eval`, or `Function`; only `mermaid.*` globals are reachable | 100% |
| MermaidSeqBench score | Against vanilla Mermaid + vision baseline | Move the number |

Cross-cutting:

- **Doc-sync** (both directions): every `LayoutWarning` code and `MutationOp` kind must appear in the tables above. Emitting an undocumented code fails CI; documenting an unemitted one fails CI. `am --agent-instructions` output must equal the canonicalized Agent workflow section byte-for-byte.
- **Stryker mutation testing** runs on PRs touching `src/`. Act on findings; no fixed percentage target.
- **Property tests** (fast-check, already in the suite) extend with model-gap tests.

The single number that decides whether the bet was right: **MermaidSeqBench score against the Mermaid + vision baseline**. If it doesn't move, the spec was wrong.

---

## Risks

- **ELK determinism.** If seeded ELK still drifts, options: fork ELK, replace it with a deterministic minimizer on the deterministic path, or accept structural-JSON determinism (counts, endpoints, topology) without exact coordinates. Decide after measuring.
- **Font-metric table drift.** CI check fails if live measurement diverges from the table.
- **`ValidDiagram` sealing.** TypeScript can't enforce sealed types across module boundaries. Lint rule bans construction outside `parseMermaid` and `mutate`.
- **Bloat in agent-facing docs.** InfoQ 2026 research measured a 4pp regression on SWE-bench Lite plus ~20% token cost from oversize AGENTS.md files. Keep `AGENTS.md` under 100 lines, reviewed manually on every change.

---

## Why totality matters

Each property alone leaves a gap. Determinism alone — agents can diff outputs but can't edit without regenerating. Round-trip alone — every edit shuffles the layout, drowning the signal. Verify alone — outputs aren't reproducible across runs, so a warning fixed in one run silently returns in the next.

Together they close a loop:

1. Parse the source into `ValidDiagram`.
2. `mutate` one node — the IR guarantees the edit produces valid Mermaid.
3. `verify` — structured warnings tell the agent whether anything broke.
4. If broken, back up to the previous `ValidDiagram` and try a different op.
5. `serializeMermaid` only after verify passes.

That loop is the agent-native claim. Replacing several rounds of vision-on-PNG with one structured query is what makes a coding agent reach for this fork before any other Mermaid library.

The API makes the loop possible. `AGENTS.md` and `am --agent-instructions` make it a habit. Both ship together.
