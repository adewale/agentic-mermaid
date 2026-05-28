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

1. **Deterministic layout** — same input → structurally identical layout JSON across runs with the same ELK version. (Not "byte-identical SVG across versions" — that's a stronger claim that needs a forked ELK to actually deliver.)
2. **Verifiable rendering** — structured "did this render cleanly?" check. Structural warnings (anchors, bounds, emptiness, group containment) are reliable; metric warnings (label fit, overlap) are best-effort because they depend on font-measurement parity with ELK.
3. **Round-trippable** — `parseMermaid` produces a `ValidDiagram` that carries the canonical source verbatim plus structured access to it. For flowchart + state, `mutate` operates on the structured form; for other families, the canonical source *is* the round-trip mechanism.

(Composition — `@include`, templates, layered scenarios — was the fourth in earlier drafts and is deferred. Agents do not currently reach for composition; they paste and edit. Add when evidence demands.)

(1) is a prerequisite for (2) and (3). Skip it and the others check moving targets.

## Honest scope

What this v1 actually delivers and what it doesn't:

| | Flowchart + State | Sequence, Class, ER, Timeline, Journey, XY, Architecture |
|---|---|---|
| `parseMermaid` | Full structured AST | Source preserved verbatim in `canonicalSource`, kind detected |
| `verifyMermaid` | All warning codes apply | Structural-only (emptiness, parseability); metric codes don't apply |
| `mutate` | All six op kinds | **Not supported** — the type signature reflects this |
| `serializeMermaid` | Re-emit from structured form, canonical | Re-emit `canonicalSource` verbatim |
| `renderMermaidSVG` / `ASCII` | Full | Full (via existing Beautiful Mermaid family renderers) |
| Determinism | Layout JSON byte-stable within an ELK version | N/A (renderers vary by family) |

The implication: for the 7 non-mutable families, the agent's tool surface is *parse → verify → render → serialize*, not *parse → mutate → verify → serialize*. Cross-cutting edits on those families happen at the source level (string operations against `canonicalSource`), not at the AST level. Code Mode opportunity #1 (composition without shipping composition) covers this for the small minority of cases where it matters.

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

- **Lint rule** bans `Math.random()`, `Date.now()`, `performance.now()`, and naked `new Map()` iteration in `src/agent/**` and `src/layout-engine.ts` via the `.eslintrc.json` shipped with the package. Substrate primitives (`createSeededRNG`, `createMockClock`) are explicitly allowlisted.
- **ELK call sites** are wrapped in `withSeededRandom(ctx.rng, fn)`. The helper saves the global `Math.random`, installs one backed by `ctx.rng.next()`, runs `fn()`, then restores. ELK's crossing minimizer uses `Math.random` internally, so changing `LayoutContext.rng.seed` now *actually changes the layout output*. The seed flows from public API → `LayoutContext` → wrapper → ELK.
- **Frozen font-metric table** ships at `src/agent/assets/font-metrics.json`. The Tier 2 metric warnings that depend on it (`NODE_OVERLAP`, `ROUTE_SELF_CROSS`) are clearly advisory; `LABEL_OVERFLOW` is now source-based and no longer needs font-table parity (see Tier 1 below).

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

Warnings split into two tiers by how reliable the underlying check is:

### Tier 1 — Source-and-structure (reliable)

Derived from parsed structure or character-level source properties. Deterministic, no font measurement dependency.

| Code | Severity | Description |
|---|---|---|
| `EMPTY_DIAGRAM`    | error   | Diagram contains no renderable elements |
| `EDGE_MISANCHORED` | error   | Edge endpoint does not attach to a real node / participant |
| `OFF_CANVAS`       | error   | Node or edge segment lies outside the canvas |
| `GROUP_BREACH`     | error   | Member node lies outside its group's bounds |
| `UNKNOWN_SHAPE`    | warning | Shape name unrecognized; default used |
| `LABEL_OVERFLOW`   | warning | Label character count exceeds the configurable limit (default 40 chars). Payload includes `charCount` and `limit`. Source-based, no font-table dependency. |

### Tier 2 — Geometric (advisory)

Correctly detect what they claim to detect, but the occurrence may be intentional. Suppress when intent is clear; do not gate CI on them alone.

| Code | Severity | Description |
|---|---|---|
| `NODE_OVERLAP`     | warning | Two laid-out node bounding boxes intersect |
| `ROUTE_SELF_CROSS` | warning | An edge route crosses itself |

Codes are the contract surface agents reason about. Emitting an undocumented code fails CI; documenting an unemitted one also fails CI. Agents omit known-irrelevant codes via `VerifyOptions.suppress`.

**Branded coordinate types** (`Finite`) prevent NaN / Infinity from reaching the renderer. `toFinite()` is the only constructor; it throws on invalid input.

**Model-gap property test**: for every generated `D` that parses successfully, `verify(D).warnings` filtered to Tier-1 `error` codes must be empty. Counterexamples are renderer bugs. Tier-2 warnings are excluded from this property because of the heuristic mismatch noted above.

---

## (3) Round-trippable

A sealed `ValidDiagram` that preserves everything the source had — and carries the canonical source verbatim as the round-trip pillar:

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
  /**
   * The canonical preprocessed source — frontmatter, init directives, and
   * comments stripped; line breaks normalized. THE LOAD-BEARING FIELD:
   * round-trip through `serializeMermaid` relies on this for families that
   * don't have structured serializers (i.e., all except flowchart + state).
   */
  readonly canonicalSource: string
}

type DiagramBody =
  | { kind: 'flowchart'; graph: MermaidGraph }
  | { kind: 'sequence'; participants: string[]; messages: SequenceMessage[] }
  | { kind: 'opaque'; family: DiagramKind; source: string }

type FlowchartValidDiagram = ValidDiagram & { body: { kind: 'flowchart' } }
type SequenceValidDiagram = ValidDiagram & { body: { kind: 'sequence' } }
type MutableValidDiagram = FlowchartValidDiagram | SequenceValidDiagram
```

```ts
parseMermaid(source: string):                                Result<ValidDiagram, ParseError[]>
serializeMermaid(d: ValidDiagram):                           string
synthesizeFromGraph(meta, kind, body): ValidDiagram          // builds a ValidDiagram without re-parsing
mutate(d: FlowchartValidDiagram, op: FlowchartMutationOp):   Result<FlowchartValidDiagram, MutationError>
mutate(d: SequenceValidDiagram,  op: SequenceMutationOp):    Result<SequenceValidDiagram, MutationError>
asFlowchart(d: ValidDiagram): FlowchartValidDiagram | null
asSequence(d: ValidDiagram):  SequenceValidDiagram | null
```

**`mutate` is overloaded by family.** Flowchart and sequence diagrams have first-class structured editing in v1. Other families parse to opaque body; mutation isn't typed for them, so the call doesn't typecheck — agents get a compile error rather than a runtime `UNSUPPORTED_FAMILY` rejection.

Two contracts:

- `serializeMermaid(parseMermaid(s)) ≡ normalize(s)` for canonical input. For flowchart + sequence this emits a fresh canonical form; for opaque families it emits `canonicalSource` verbatim with `meta` re-attached.
- `parseMermaid(serializeMermaid(d)) ≡ d` for every `d` produced by `parseMermaid` or `mutate`.

**Flowchart MutationOp kinds** (6):

| Kind | Required | Optional | Inverse |
|---|---|---|---|
| `add_node`    | `id`, `label`     | `shape`, `parent` | `remove_node(id)` |
| `remove_node` | `id`              | —                 | `add_node(id, label, shape, parent)` |
| `rename_node` | `from`, `to`      | —                 | `rename_node(to, from)` |
| `set_label`   | `target`, `label` | —                 | `set_label(target, prev_label)` |
| `add_edge`    | `from`, `to`      | `label`, `style`  | `remove_edge(id)` |
| `remove_edge` | `id`              | —                 | `add_edge(from, to, label, style)` |

**Sequence MutationOp kinds** (4):

| Kind | Required | Optional | Inverse |
|---|---|---|---|
| `add_participant`    | `id`                  | `label` | `remove_participant(id)` |
| `remove_participant` | `id`                  | —       | `add_participant(id, label)` |
| `add_message`        | `from`, `to`, `text`  | `style` (sync/async) | `remove_message(index)` |
| `remove_message`     | `index`               | —       | `add_message(...)` |
| `set_message_text`   | `index`, `text`       | —       | `set_message_text(index, prev_text)` |

For the 6 other diagram families (class, ER, timeline, journey, xychart, architecture), cross-cutting edits live at the source level — string operations against `canonicalSource`, composed by the agent in Code Mode. Adding structured mutation for each follows the same pattern: narrowed type + body parser + serializer + per-family ops. v1 ships two families to prove the pattern; expanding is multiplicative work.

Convention bans constructing `ValidDiagram` outside `parseMermaid`, `mutate`, and `synthesizeFromGraph`.

---

## Public API

```ts
parseMermaid(source: string):                              Result<ValidDiagram, ParseError[]>
layoutMermaid(d: ValidDiagram, ctx?: LayoutContext):       RenderedLayout
renderMermaidSVG(input: ValidDiagram | string, opts?):     string
renderMermaidASCII(input: ValidDiagram | string, opts?):   string
verifyMermaid(input: ValidDiagram | string, opts?: VerifyOptions): VerifyResult
serializeMermaid(d: ValidDiagram):                         string

// Mutation is overloaded by family. Other families don't typecheck.
mutate(d: FlowchartValidDiagram, op: FlowchartMutationOp): Result<FlowchartValidDiagram, MutationError>
mutate(d: SequenceValidDiagram,  op: SequenceMutationOp):  Result<SequenceValidDiagram, MutationError>

// Narrowing helpers; null when the diagram isn't of that family.
asFlowchart(d: ValidDiagram): FlowchartValidDiagram | null
asSequence(d: ValidDiagram):  SequenceValidDiagram | null

// Build a ValidDiagram from a JSON-safe graph payload without re-parsing
// source. Used by `am parse | am serialize` shell pipelines.
synthesizeFromGraph(payload: ValidDiagramPayload): Result<ValidDiagram, ParseError[]>
```

**CLI** (`am <verb>`) with `--json` everywhere: `render`, `verify`, `parse`, `serialize`, `mutate`, `format`. Plus `am --agent-instructions` printing the canonical agent-use guide embedded in the binary at build time — agents read the doc that ships with the tool, not whatever their training set indexed. The CLI's role is one-shot operations, shell-only contexts (CI, Bash-tool agents), and human inspection; multi-step editing belongs in the library or Code Mode, not in shell pipelines.

---

## Breaking changes from Beautiful Mermaid

- **Agent surface exposed via the `./agent` subpath export** on the existing `beautiful-mermaid` package. The package-rename to `agentic-mermaid` is a v1-ship operation, not a v1-implementation one — it requires coordinating with the package owner and invalidates every existing consumer. The subpath export keeps both surfaces side by side.
- **Deterministic-by-default *contract*.** The `LayoutContext` API is in place and the layout JSON is structurally deterministic. The runtime guarantee at the ELK boundary is partial (see Substrate). Callers that need cross-machine byte equality should pin ELK versions and run on a single platform until ELK seed-pinning lands.
- **IDs are content-hashed and stable** across runs (within an ELK version).
- **`MermaidGraph` is kept** as an exported type — `ValidDiagram` wraps it in `body.graph` for flowchart, rather than replacing it. The original spec called for removal; the implementation showed it would break 61 test files and the Craft Agents consumer. The wrapping shape costs nothing.
- **`renderMermaidSVGAsync` is kept**. Removing it was a v1-aspiration that turned out to break consumers for no win at the agent surface.
- **`mermaidConfig` precedence** (frontmatter < init < render options) is enforced by tests via a single merge function — unchanged from the existing pipeline.

---

## Distribution

Four artifacts, all derived from this doc:

- **npm package** `agentic-mermaid`. The full TypeScript API. Agents with shell access import the library directly and compose verbs in their own TS; no MCP wrapper required.
- **`.claude/skills/agentic-mermaid/`** Claude Code skill bundle. Master `SKILL.md` routes by *both* diagram family and composition channel: it picks Code Mode when the MCP is connected, library import when the agent can `import` and run TS, the CLI for shell-only contexts. Per-family references (`flowchart.md`, `sequence.md`, etc.) describe syntax. Two channel references — `code-mode.md` (the canonical multi-step pattern) and `cli.md` (shell-only) — describe composition. Progressive disclosure means the LLM loads only what it needs. Family references sync from upstream Mermaid docs weekly via the shipped GitHub Action at `.github/workflows/sync-mermaid-docs.yml`, alongside our additions (LayoutWarning codes, MutationOp taxonomy).
- **ESLint config** at `.eslintrc.json` enforces substrate conventions: `no-restricted-syntax` rules ban `Math.random()`, `Date.now()`, and `performance.now()` in `src/agent/**` and `src/layout-engine.ts`. Substrate primitives are exempt.
- **`agentic-mermaid-mcp`** Code Mode MCP server. **One tool, `execute(code: string)`**. The model writes an async arrow against the typed `mermaid.*` SDK declaration embedded in the system prompt; the server runs the arrow's body in a `node:vm` sandbox with the library exposed as `mermaid` and the arrow's return value captured as the structured result. The verify-after-mutate loop becomes one round-trip rather than N. Hosting: local stdio launched by the MCP client (Claude Desktop, Claude Code, Cursor) — same deployment shape as filesystem-MCP, git-MCP, sqlite-MCP. No infrastructure on our side or the user's. The pattern follows Cloudflare's `@cloudflare/codemode/mcp` design; we ship our own Node executor because our library is pure-functional and doesn't need `WorkerLoader` bindings. The same binary supports `--http` for self-hosted HTTP/SSE, and the architecture admits a Cloudflare Worker deployment via `DynamicWorkerExecutor` for orgs that want one, but we ship neither as a hosted service.
- **`AGENTS.md`** at repo root, hard-capped under 100 lines. `am --agent-instructions` prints the workflow section below at runtime; a doc-sync test asserts the two are byte-identical.

No HTTP endpoint or editor WebSocket watch in v1. The skill teaches Code Mode for both paths: agents-with-shell write TS against the imported library; agents-without-shell write TS against the MCP's `mermaid.*` SDK. Same surface in both cases.

---

## Agent workflow

(This section is the canonical agent-use guide. `am --agent-instructions` prints exactly this section.)

### Quick start

The code below runs unchanged whether you import the library, call it inside Code Mode `execute()` (as an async arrow returning the final value), or compose its CLI equivalents. Prefer Code Mode or library import for multi-step edits; reach for the CLI for one-shot operations.

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
| Layout JSON byte-equality across runs | Determinism grid (4 directions × node-counts 2..12 × {sparse, dense, star}) | 100% within one ELK version on one machine |
| Drift sentinel | 8 hand-picked canonical layout JSONs as snapshots; any change without explicit acknowledgment fails CI | — |
| Tier-1 verifier recall on broken-fixture cases | Inline tests per Tier-1 code | ≥95% |
| Tier-2 verifier precision | Inline tests per Tier-2 code | best-effort; do not gate CI |
| Round-trip identity | Small golden corpus + property test | 100% on canonical input |
| Round-trip property | Property test (fast-check), 100–1000 cases per PR | 100% on parseable input |
| Code Mode sandbox isolation | Property test: arbitrary TS input to `execute()` cannot reach the filesystem, network, `process`, `eval`, or `Function`; only `mermaid.*` globals are reachable | 100% |
| MermaidSeqBench score | Against vanilla Mermaid + vision baseline | Move the number — **deferred from v1**; benchmark integration is its own ticket |

Cross-cutting:

- **Doc-sync** (both directions): every `LayoutWarning` code and `MutationOp` kind must appear in the tables above. Emitting an undocumented code fails CI; documenting an unemitted one fails CI. `am --agent-instructions` output must equal the canonicalized Agent workflow section byte-for-byte.
- **Stryker mutation testing** runs on PRs touching `src/`. Act on findings; no fixed percentage target.
- **Property tests** (fast-check, already in the suite) extend with model-gap tests.

The single number that decides whether the bet was right: **MermaidSeqBench score against the Mermaid + vision baseline**. If it doesn't move, the spec was wrong.

---

## Risks

- **ELK doesn't always honor `Math.random` for every randomized decision.** v1 wraps every layout call in `withSeededRandom(ctx.rng, fn)`. ELK's layered algorithm's crossing minimizer reads `Math.random`, so seed changes do produce different layouts in measured cases. ELK calls that read seeded randomness from another source (rare) would bypass this. Mitigation: a determinism test that asserts seed changes produce different layouts on at least one randomized algorithm choice.
- **Font-metric table** ships as a curated stub. After moving `LABEL_OVERFLOW` to source-based detection, the table only feeds Tier-2 advisory warnings. Production-grade regeneration is no longer load-bearing.
- **`ValidDiagram` sealing.** TypeScript can't enforce sealed types across module boundaries. The ESLint config bans constructing `ValidDiagram` outside `parseMermaid`, `mutate`, and `synthesizeFromGraph`.
- **Bloat in agent-facing docs.** InfoQ 2026 research measured a 4pp regression on SWE-bench Lite plus ~20% token cost from oversize AGENTS.md files. `AGENTS.md` is hard-capped under 100 lines; doc-sync test enforces.
- **Scope creep on mutation.** Adding `mutate` for class / ER / timeline / journey / xychart / architecture is multiplicative work. Each family has its own grammar. v1 ships flowchart + state + sequence (the three with highest agent demand and tractable grammars). Expanding to other families follows the same pattern.

## What v1 delivers

The v1 surface delivers every property the spec claims, with the following honest scope decisions:

- **Determinism via `Math.random` override.** Seed changes change layout output. Cross-platform byte-equality is best-effort (depends on ELK's float arithmetic determinism across CPUs); structural-JSON determinism within an ELK version on one machine is guaranteed.
- **Mutation for flowchart + state + sequence** (the three most-requested families). Other 6 families: parse / verify / render / serialize via `canonicalSource`. The mutate type signature uses family-narrowed overloads so cross-family calls don't typecheck.
- **`canonicalSource` field** on every `ValidDiagram` — the round-trip pillar for opaque families, the fallback when no structured serializer applies. Documented in the type comment.
- **`Finite` branded type** enforced at every coordinate emission via `toFinite()`. Constructor throws on NaN / Infinity.
- **Tier-1 / Tier-2 warning split.** Tier 1 (6 codes) is reliable and source-or-structure based. Tier 2 (2 codes) is geometric and advisory. `LABEL_OVERFLOW` was moved from Tier 2 to Tier 1 by reframing as a source-based character-count check.
- **ESLint substrate enforcement** via `.eslintrc.json`. Substrate primitives explicitly allowlisted.
- **Upstream-doc sync** via shipped GitHub Action.
- **`MermaidGraph` and `renderMermaidSVGAsync` kept** as exports — wrapping rather than replacing keeps existing consumers working.
- **Subpath export** (`beautiful-mermaid/agent`) rather than package rename — coordinates with package owner deferred.
- **MermaidSeqBench integration** is the explicit follow-up; the eval is the single decisive number once wired.

---

## What Code Mode unlocks

The Code Mode MCP raises the ceiling on what an agent can do with the library in one call. We initially framed the agent surface as a fixed set of verbs (parse, verify, mutate, serialize) where each verb is one round-trip. Code Mode reframes the surface as a typed library that the agent composes against — and the only thing we ship is the small set of primitives plus a sandbox. The agent supplies the algorithm.

Concrete consequences, in roughly descending impact:

1. **Composition without shipping composition.** `@include`, `@template`, vars/`${}` are deferred indefinitely. An agent can implement its own splice or template flavor in TS — load two diagrams, parse both, build a new `ValidDiagram` body from selected parts of each, verify, serialize — in one round-trip. Whatever shape the agent needs, it writes. The spec stays smaller.
2. **Multi-diagram repo operations.** "Rename `AuthService` across every architecture diagram in this repo, verify each, and report which now have warnings." With verb-per-tool MCP that's `N × 3` round-trips. With Code Mode: one `execute()` walks the file list. Cross-cutting refactors become tractable.
3. **Auto-fix loops in one round-trip.** `verify` → identify mechanically fixable warnings → apply fixes → `verify` again, as a `while (!result.ok)` block. The agent only sees the final state plus a structured audit trail.
4. **Diagram-as-tests / CI gate.** A repo installs `agentic-mermaid-mcp` and writes a Code Mode snippet that verifies every `.mmd` on push. Diagrams become test artifacts that fail CI when they break.
5. **No need to ship `diffDiagrams` or `explainDiagram`.** Already cut. Code Mode confirms the cut: an agent that wants structural diff writes it from `parse` + `ValidDiagram` inspection in TS. Every "would be nice to have a verb for" becomes "write the code for it in `execute()`."
6. **Library as the cross-tool agent interface for diagrams.** A Mermaid linter, a `mermaid → d2` converter, a `graphviz → mermaid` importer can each expose the same Code Mode shape. Any agent then writes one TS snippet that composes across libraries. We've effectively defined the agent interface for diagrams in this language.
7. **Benchmark eval at speed.** MermaidSeqBench (and any future eval) runs as one `execute()` per case rather than N round-trips. Internal velocity multiplier.
8. **Cross-language reach via the Worker path.** Wrapping our library with `@cloudflare/codemode` + `DynamicWorkerExecutor` exposes it to any MCP-speaking model — not just Anthropic's. TypeScript is more universal than per-tool MCP definitions.
9. **The skill becomes runnable, not just descriptive.** `references/code-mode.md` ships canonical TS snippets the agent copy-pastes into `execute()`. Skill stops being prose; starts being a library of executable patterns.
10. **A diagram REPL falls out almost free.** `am repl` becomes an interactive Code Mode shell — paste TS, get structured results, iterate. Same sandbox, different transport.

The biggest single consequence is #1: it gives us permission to never grow the spec for composition, queries, diffing, explaining, or any "we should probably have a verb for that" feature. **The verb set is intentionally small; Code Mode makes it sufficient.**

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
