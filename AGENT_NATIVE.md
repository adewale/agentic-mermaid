# Agentic Mermaid — agent-native architecture

**Status.** Architecture/spec rationale for the merged agent-native surface on `main`. Current capabilities live in `FEATURES.md`; active work lives only in `TODO.md`. Not intended for upstream.

**Thesis.** Agents authoring Mermaid diagrams today regenerate the whole source on every edit, or render to PNG and read it back with vision. The Beautiful Mermaid renderer foundation already fixed the worst of the rendering side (sync + DOM-free + ASCII). Agentic Mermaid adds the editing surface — structured verification, typed mutation, round-trippable IR — so an agent can edit one node and trust the result without ever opening an image.

---

## Why fork Beautiful Mermaid

The stack is three layers, each contributing something the others can't:

| Layer | Contribution |
|---|---|
| **Mermaid (grammar)** | 20+ diagram families. Rendered inline by GitHub, GitLab, Obsidian, Notion. Frontmatter + init + runtime config plane. `accTitle`/`accDescr` directives. **The corpus moat.** |
| **Beautiful Mermaid (renderer foundation)** | Synchronous, zero DOM, pure TypeScript. ASCII output. Two-color theming. Semantic role styling. 9 diagram families with full layout/render coverage. Property + mutation + e2e test scaffold already in place. **The AI-era renderer Craft built for Craft Agents.** |
| **Agentic Mermaid (this product/workflow)** | `ValidDiagram` IR. Deterministic layout. `verify()`. `mutate()` + round-trip `serializeMermaid`. Agent-agnostic skills, CLI, `--agent-instructions`. **The editing surface.** |

D2 has a better language than Mermaid. The Beautiful Mermaid renderer foundation has a better fit than D2 for agent contexts. Mermaid has a corpus neither of them has. The bet: stacking the three wins.

---

## The three properties

1. **Deterministic layout** — same input → structurally identical layout JSON across runs with the same ELK version. (Not "byte-identical SVG across versions" — that's a stronger claim that needs a forked ELK to actually deliver.)
2. **Verifiable rendering** — structured "did this render cleanly?" check. Structural warnings (anchors, bounds, emptiness, group containment) are reliable; metric warnings (label fit, overlap) are best-effort because they depend on font-measurement parity with ELK.
3. **Round-trippable** — `parseMermaid` produces a `ValidDiagram` that carries source needed to re-emit the diagram. For flowchart/state, sequence, timeline, class, and ER, `mutate` operates on structured bodies; for journey, xychart, architecture, and opaque-fallback bodies, preserved source is the round-trip mechanism.

(Composition — `@include`, templates, layered scenarios — was the fourth in earlier drafts and is deferred. Agents do not currently reach for composition; they paste and edit. Add when evidence demands.)

(1) is a prerequisite for (2) and (3). Skip it and the others check moving targets.

## Honest scope

What the current Agentic Mermaid surface delivers and what it doesn't:

| Family | Parse / verify / render / round-trip | Structured mutation |
|---|---|---|
| Flowchart, State | Full | ✅ 6 ops |
| Sequence | Full for simple messages; unmodeled blocks fall back to opaque losslessly | ✅ 5 ops when structured |
| Timeline | Full | ✅ 10 ops |
| Class | Full | ✅ 10 ops |
| ER | Full | ✅ 7 ops |
| Journey | Full lossless source round-trip | Source-level edits only |
| XY chart | Full lossless source round-trip | Source-level edits only |
| Architecture | Full lossless source round-trip | Source-level edits only |

The implication: for journey, xychart, architecture, and any opaque fallback, the agent's tool surface is *parse → verify → render → serialize*, not *parse → mutate → verify → serialize*. Cross-cutting edits on those bodies happen at the preserved source level (`body.source` for opaque bodies), not at the typed mutation layer. Code Mode opportunity #1 covers this for the cases where it matters.

---

## (1) Deterministic layout — structural, not seeded

**Empirically established (v4):** ELK output in this configuration is already deterministic, byte-identical across separate processes. The determinism comes from ELK's `considerModelOrder.strategy: NODES_AND_EDGES` setting plus the absence of any `randomSeed` option — layout order is a pure function of model order, not of randomness. Verified by a cross-process test (three separate `bun` invocations on the same source produce identical layout JSON) and a determinism grid.

This is the honest, stronger position. Earlier drafts wrapped ELK in a `withSeededRandom(rng, fn)` helper and exposed a `LayoutContext.rng` seed, claiming the seed "drove" layout. **It did not.** Seed 1 and seed 999999 produced byte-identical output because ELK never consults `Math.random` on this path. That apparatus was theater and is removed. There is no seed because none is needed; determinism is a property of the engine configuration, guarded by test.

Enforcement that determinism stays true:
- A **grep-based lint test** (runs under `bun test`, not aspirational ESLint) fails if `Math.random`, `Date.now`, or `performance.now` appear in `src/agent/**` or `src/layout-engine.ts`. Introducing ambient nondeterminism breaks the build.
- A **cross-process determinism test** spawns child processes and asserts byte-identical layout.
- A **drift sentinel** pins canonical layout JSON for a hand-picked corpus; any change requires conscious re-baseline.

The canonical artifact is the **layout JSON**, not the SVG:

```json
{
  "version": 1,
  "kind": "flowchart",
  "nodes":  [{ "id": "A", "x": 12, "y": 36, "w": 80, "h": 40, "shape": "rect" }, ...],
  "edges":  [{ "id": "A->B", "from": "A", "to": "B", "path": [[..],[..]], "label": {...} }, ...],
  "groups": [{ "id": "g1", "x": 0, "y": 0, "w": 200, "h": 120, "members": ["A","B"] }, ...],
  "bounds": { "w": 320, "h": 180 }
}
```

There is no `seed` field (it was always `0` — a placeholder masquerading as state). SVG is the visual projection. Two render results are equal iff their layout JSON is structurally equal.

---

## (2) Verifiable rendering

```ts
verifyMermaid(source: string | ValidDiagram, opts?: VerifyOptions): VerifyResult

interface VerifyOptions {
  suppress?: WarningCode[]      // codes to omit, e.g. ['UNKNOWN_SHAPE']
  labelCharCap?: number         // default cap 40
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

### Tier 3 — Lint (advisory, reserved)

Tier 3 is reserved for future family-specific lint warnings: "common LLM mistakes" that the parser accepts but the agent probably didn't intend. No Tier 3 warning codes ship today (`Tier3WarningCode = never`), and `VerifyOptions` has no tier toggle.

`FamilyPlugin.verify` hooks are wired and run today, but built-ins use them for Tier 1 structural warnings (for example class/ER `EMPTY_DIAGRAM`, `EDGE_MISANCHORED`, `LABEL_OVERFLOW`), not for lint. When lint codes are added, the contract should grow deliberately: add codes to `WARNING_TIER`, document them here, and test that emitted codes and documented codes stay in sync.

Candidate future codes: `LINT_UNQUOTED_LABEL`, `LINT_MISSING_HEADER` (caught at parse for our IR; lint would catch near-misses like leading whitespace), `LINT_DUPLICATE_NODE_ID` (legacy parser dedupes, so the rule runs on raw source).

**Branded coordinate types** (`Finite`) prevent NaN / Infinity from reaching the renderer. `toFinite()` is the only constructor; it throws on invalid input.

**Model-gap property test**: for every generated `D` that parses successfully, `verify(D).warnings` filtered to Tier-1 `error` codes must be empty. Counterexamples are renderer bugs. Tier-2 warnings are excluded from this property because a `NODE_OVERLAP` or `ROUTE_SELF_CROSS` can be a legitimate property of a valid diagram, not a bug. Tier-3 is excluded because no lint codes ship yet.

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
   * comments stripped; line breaks normalized. Structured renderers use this as
   * input. Opaque/source-level fidelity relies on `body.source`, not this field.
   */
  readonly canonicalSource: string
}

type DiagramBody =
  | { kind: 'flowchart'; graph: MermaidGraph }
  | SequenceBody | TimelineBody | ClassBody | ErBody
  | { kind: 'opaque'; family: DiagramKind; source: string }

type MutableValidDiagram =
  | FlowchartValidDiagram | SequenceValidDiagram | TimelineValidDiagram
  | ClassValidDiagram | ErValidDiagram
```

```ts
parseMermaid(source: string):                                Result<ValidDiagram, ParseError[]>
serializeMermaid(d: ValidDiagram):                           string
synthesizeFromGraph(payload):                                Result<ValidDiagram, ParseError[]>
mutate(d: FlowchartValidDiagram, op: FlowchartMutationOp):   Result<FlowchartValidDiagram, MutationError>
mutate(d: SequenceValidDiagram,  op: SequenceMutationOp):    Result<SequenceValidDiagram, MutationError>
mutate(d: TimelineValidDiagram,  op: TimelineMutationOp):    Result<TimelineValidDiagram, MutationError>
mutate(d: ClassValidDiagram,     op: ClassMutationOp):       Result<ClassValidDiagram, MutationError>
mutate(d: ErValidDiagram,        op: ErMutationOp):          Result<ErValidDiagram, MutationError>
asFlowchart/asSequence/asTimeline/asClass/asEr(d): narrowed diagram | null
```

**`mutate` is overloaded by family.** Flowchart/state, simple sequence, timeline, class, and ER diagrams have first-class structured editing. Journey, xychart, architecture, and opaque-fallback diagrams are not typed for mutation, so agents get a compile-time/null-narrower stop rather than a lossy edit path.

Two contracts:

- `serializeMermaid(parseMermaid(s)) ≡ normalize(s)` for canonical input. For structured families this emits a fresh canonical form; for opaque families it emits preserved source with `meta` re-attached.
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

**Sequence MutationOp kinds** (5):

| Kind | Required | Optional | Inverse |
|---|---|---|---|
| `add_participant`    | `id`                  | `label` | `remove_participant(id)` |
| `remove_participant` | `id`                  | —       | `add_participant(id, label)` |
| `add_message`        | `from`, `to`, `text`  | `style` (sync/async) | `remove_message(index)` |
| `remove_message`     | `index`               | —       | `add_message(...)` |
| `set_message_text`   | `index`, `text`       | —       | `set_message_text(index, prev_text)` |

**Timeline MutationOp kinds** (10):

| Kind | Required | Inverse |
|---|---|---|
| `set_title`          | `title \| null`                                           | `set_title(prev_title)` |
| `add_section`        | `label`                                                   | `remove_section(index)` |
| `remove_section`     | `index`                                                   | `add_section(label)` |
| `set_section_label`  | `index`, `label`                                          | `set_section_label(index, prev_label)` |
| `add_period`         | `sectionIndex`, `label` (+ optional `events: string[]`)   | `remove_period(sectionIndex, periodIndex)` |
| `remove_period`      | `sectionIndex`, `periodIndex`                             | `add_period(...)` |
| `set_period_label`   | `sectionIndex`, `periodIndex`, `label`                    | `set_period_label(... prev_label)` |
| `add_event`          | `sectionIndex`, `periodIndex`, `text`                     | `remove_event(... eventIndex)` |
| `remove_event`       | `sectionIndex`, `periodIndex`, `eventIndex`               | `add_event(...)` |
| `set_event_text`     | `sectionIndex`, `periodIndex`, `eventIndex`, `text`       | `set_event_text(... prev_text)` |

**Class MutationOp kinds** (10):

| Kind | Required | Inverse |
|---|---|---|
| `set_title`         | `title \| null`                                      | `set_title(prev_title)` |
| `add_class`         | `id` (+ optional `label`, `members: string[]`)        | `remove_class(id)` |
| `remove_class`      | `id`                                                  | `add_class(id, label, members)` |
| `rename_class`      | `from`, `to`                                          | `rename_class(to, from)` |
| `add_member`        | `class`, `text`                                       | `remove_member(class, index)` |
| `remove_member`     | `class`, `index`                                      | `add_member(class, text)` |
| `add_relation`      | `from`, `to`, `relKind` (+ optional `label`)          | `remove_relation(index)` |
| `remove_relation`   | `index`                                               | `add_relation(...)` |
| `add_note`          | `text` (+ optional `for: class`)                       | `remove_note(index)` |
| `remove_note`       | `index`                                               | `add_note(text, for)` |

**ER MutationOp kinds** (7):

| Kind | Required | Inverse |
|---|---|---|
| `add_entity`        | `id` (+ optional `attributes: string[]`)             | `remove_entity(id)` |
| `remove_entity`     | `id`                                                  | `add_entity(id, attributes)` |
| `rename_entity`     | `from`, `to`                                          | `rename_entity(to, from)` |
| `add_attribute`     | `entity`, `text`                                      | `remove_attribute(entity, index)` |
| `remove_attribute`  | `entity`, `index`                                     | `add_attribute(entity, text)` |
| `add_relation`      | `from`, `to`, `leftCard`, `rightCard` (+ `dashed`, `label`) | `remove_relation(index)` |
| `remove_relation`   | `index`                                               | `add_relation(...)` |

**Source-level families:** journey, xychart, architecture, and opaque fallback bodies preserve source and do not expose structured mutation ops.

**Structured-or-opaque rule (v4): never lossy.** The parser only produces a structured body when it fully understands every non-blank, non-comment line for the structured families. If the source contains *any* construct the parser doesn't model — `Note over` / `alt` / `loop` / `activate` in sequence, `direction TB` in class, etc. — parsing **falls back to an opaque body**. Journey, xychart, and architecture are intentionally source-level today. The diagram still parses, renders, verifies (structurally), and round-trips losslessly via preserved `body.source`; it simply isn't offered for structured mutation (no narrower for source-level families; structured-family narrowers return `null` on opaque fallbacks). This guarantees the parser never silently drops information. Earlier drafts dropped unrecognized lines on the floor; v4 does not.

For source-level families and any opaque fallback, cross-cutting edits are source-level only: operate against preserved source intentionally, then re-parse and verify before returning. Adding structured mutation for any such family follows the same pattern: narrowed type + body parser + serializer + per-family ops.

Convention bans constructing `ValidDiagram` outside `parseMermaid`, `mutate`, and `synthesizeFromGraph`.

---

## Public API

```ts
parseMermaid(source: string):                              Result<ValidDiagram, ParseError[]>
layoutMermaid(d: ValidDiagram):                            RenderedLayout
renderMermaidASCII(input: ValidDiagram | string, opts?):   string
renderMermaidPNG(input: ValidDiagram | string, opts?):     Uint8Array
renderMermaidSVG(input: ValidDiagram | string, opts?):     string
verifyMermaid(input: ValidDiagram | string, opts?: VerifyOptions): VerifyResult
serializeMermaid(d: ValidDiagram):                         string

// Mutation is overloaded by family. Opaque/source-only families don't typecheck.
mutate(d: FlowchartValidDiagram, op: FlowchartMutationOp): Result<FlowchartValidDiagram, MutationError>
mutate(d: SequenceValidDiagram,  op: SequenceMutationOp):  Result<SequenceValidDiagram, MutationError>
mutate(d: TimelineValidDiagram,  op: TimelineMutationOp):  Result<TimelineValidDiagram, MutationError>
mutate(d: ClassValidDiagram,     op: ClassMutationOp):     Result<ClassValidDiagram, MutationError>
mutate(d: ErValidDiagram,        op: ErMutationOp):        Result<ErValidDiagram, MutationError>

// Narrowing helpers; null when the diagram isn't of that family or is opaque/source-level.
asFlowchart(d: ValidDiagram): FlowchartValidDiagram | null
asSequence(d: ValidDiagram):  SequenceValidDiagram | null
asTimeline(d: ValidDiagram):  TimelineValidDiagram | null
asClass(d: ValidDiagram):     ClassValidDiagram | null
asEr(d: ValidDiagram):        ErValidDiagram | null

// Build a ValidDiagram from a JSON-safe graph payload without re-parsing
// source. Used by `am parse | am serialize` shell pipelines.
synthesizeFromGraph(payload: ValidDiagramPayload): Result<ValidDiagram, ParseError[]>

// VerifyOptions carries the only real knob: the label character cap.
interface VerifyOptions { suppress?: WarningCode[]; labelCharCap?: number }  // default cap 40
```

There is no `LayoutContext`, no `SeededRNG`, no `Clock`, no font-metric table in the public surface. Those existed to support a seed apparatus that did nothing (see § (1)). The only verification knob is `labelCharCap`.

**CLI** (`am <verb>`) with JSON where useful: `render`, `preview`, `verify`, `parse`, `serialize`, `mutate`, `format`, `describe`, `capabilities`, `batch`, `render-markdown`, `llms-txt`. `am capabilities --json` reports each family's `editPolicy` (`structured-when-narrowed` vs `source-level-only`) plus `mutationOps`, so agents can route without trial-and-error. Plus `am --agent-instructions` printing the canonical agent-use guide embedded in the binary at build time — agents read the doc that ships with the tool, not whatever their training set indexed. The CLI's role is one-shot operations, shell-only contexts (CI, Bash-tool agents), and human inspection; multi-step editing belongs in the library or Code Mode, not in shell pipelines.

---

## Compatibility choices from the Beautiful Mermaid foundation

- **Agent surface exposed via the `./agent` subpath export** on the `agentic-mermaid` package. Agentic Mermaid is the product/docs name and npm identity; the repository path currently remains `adewale/beautiful-mermaid`. The subpath export keeps renderer and agent surfaces side by side.
- **Deterministic layout, verified.** Layout JSON is byte-identical across processes because ELK is configured for model-order layout with no random seed (see § (1)). No seed parameter is exposed because none affects output. Cross-machine byte equality across different CPU float behavior is not claimed; structural determinism within an ELK version is guaranteed and tested cross-process.
- **IDs are content-hashed and stable** across runs (within an ELK version).
- **`MermaidGraph` is kept** as an exported type — `ValidDiagram` wraps it in `body.graph` for flowchart, rather than replacing it. The original spec called for removal; the implementation showed it would break 61 test files and the Craft Agents consumer. The wrapping shape costs nothing.
- **`renderMermaidSVGAsync` is kept**. Removing it was a v1-aspiration that turned out to break consumers for no win at the agent surface.
- **`mermaidConfig` precedence** (frontmatter < init < render options) is enforced by tests via a single merge function — unchanged from the existing pipeline.

---

## Distribution

Five artifacts, all derived from this doc:

- **npm package** `agentic-mermaid` with the `agentic-mermaid/agent` subpath. The full TypeScript API, including ASCII, PNG, and SVG output helpers. Agents with shell access import the library directly and compose verbs in their own JS/TS runtime; no MCP wrapper required.
- **`skills/agentic-mermaid-diagram-workflow/`** agent-agnostic skill bundle. Master `SKILL.md` routes by *both* diagram family and composition channel: it picks Code Mode when the MCP is connected, library import when the agent can run JS/TS with imports, the CLI for shell-only contexts. Per-family references (`flowchart.md`, `sequence.md`, etc.) describe syntax. Two channel references — `code-mode.md` (the canonical multi-step pattern) and `cli.md` (shell-only) — describe composition. Progressive disclosure means the LLM loads only what it needs. Family references sync from upstream Mermaid docs weekly via the shipped GitHub Action at `.github/workflows/sync-mermaid-docs.yml`, alongside our additions (LayoutWarning codes, MutationOp taxonomy).
- **Substrate grep-lint** runs under `bun test` (not an uninstalled ESLint): `src/__tests__/agent-substrate-lint.test.ts` fails the build if `Math.random`, `Date.now`, or `performance.now` appear in `src/agent/**` or `src/layout-engine.ts`. This is real enforcement, executed in CI, not an aspirational config file.
- **`agentic-mermaid-mcp`** Code Mode-style MCP server. The primary tool is `execute(code: string)`: the model writes JavaScript against the typed `mermaid.*` SDK declaration embedded in the system prompt; the server runs the code in a local `node:vm` sandbox with the library exposed as `mermaid` and the code's return value captured as the structured result. The server also exposes narrow `render_png` and `describe` helpers for binary output and summaries. The verify-before-commit loop becomes one round-trip rather than N. Hosting: local stdio launched by the MCP client (Claude Desktop, Claude Code, Cursor) — same deployment shape as filesystem-MCP, git-MCP, sqlite-MCP. No infrastructure on our side or the user's. The current MCP is not Cloudflare Codemode, not a Worker, not backed by `@cloudflare/codemode`, and not a drop-in Cloudflare integration; HTTP/SSE transport, Worker deployment, or a Cloudflare executor remain future options, not shipped artifacts.
- **`Instructions_for_agents.md`** at repo root, hard-capped under 100 lines. `am --agent-instructions` prints the same content at runtime; a doc-sync test asserts the two are byte-identical.

No HTTP endpoint or editor WebSocket watch in v1. The skill teaches Code Mode for both paths: agents-with-shell write JS/TS against the imported library; agents-without-shell write JavaScript against the MCP's `mermaid.*` SDK. Same surface in both cases.

---

## Agent-contract verbs (CLI)

Agent-contract CLI verbs for explicit self-discovery, summaries, and batch operation:

- `am capabilities [--json]` — emit `{ sdkVersion, families: [{ id, editPolicy, hasParse, hasSerialize, hasMutate, hasVerify, hasExtractLabels, mutationOps }], warningCodes: [{ code, tier, severity }], outputFormats: ["svg","ascii","unicode","png","json"] }`. Sourced from the public dispatch surface, family-plugin registry, and `WARNING_SEVERITY` / `WARNING_TIER` tables — so the contract is self-describing, not hand-maintained. A JSON Schema is committed at `src/__tests__/__fixtures__/capabilities.schema.json`; any shape drift fails the test loudly.
- `am batch --jsonl` — read JSONL from stdin, dispatch per-line to render/verify/parse/serialize/mutate handlers, emit one JSON envelope per result. Malformed lines surface `{ ok: false, error: { code: 'INVALID_JSON' } }` and do **not** abort the stream.
- `am preview <file|-> [--output file.html] [--open] [--json] [--security strict]` — write a standalone strict-mode HTML preview for human inspection without hand-building wrapper files.
- `am mutate <file|-> (--op '<json>' | --ops '<json array|file>') [--json]` — apply typed mutations, verify once at the commit point, and omit source on verify failure.
- `am describe <file|-> [--format text|json] [--json]` — emit a prose summary or structured AX tree (`{kind,nodes,edges,entryPoints,sinks}`) for screen readers, doc generation, and agent context compaction.
- **Exit codes** are widened to 4: `EXIT_OK=0`, `EXIT_ARG_ERROR=2`, `EXIT_VERIFY_FAILED=3`, `EXIT_INTERNAL=4` (in `src/cli/exit-codes.ts`). The CLI was previously `0` or `2` only. `EXIT_VERIFY_FAILED=3` is the new code for "valid args, but the diagram failed verify" — important for agents wrapping `am verify` in batch.

**Counter-example, documented.** manuareraa PR #42 on `lukilabs/beautiful-mermaid` ships an MCP server with 4 render-only tools (`render_svg` / `render_ascii` / `list_themes` / `parse`). We rejected this design: a render-tool-per-format MCP forces the agent to chain calls and loses ValidDiagram context. Our Code Mode design keeps one primary `execute()` surface for multi-step edits; `render_png` and `describe` are narrow helpers, not a render-tool-per-format API. PR #42 is preserved here as the documented counter-example so future contributors understand why we chose Code Mode.

---

## Agent workflow

The canonical runtime guide lives in `Instructions_for_agents.md` and is emitted byte-for-byte by `am --agent-instructions`; this spec intentionally does not duplicate the full snippet. The stable contract is:

1. For new diagrams, author Mermaid source directly, then `parseMermaid` / `verifyMermaid` / render or return it.
2. For existing diagrams, `parseMermaid(source)` → `ValidDiagram`.
3. Narrow with `asFlowchart` / `asSequence` / `asTimeline` / `asClass` / `asEr`; `null` means no structured mutation for that body.
4. Apply typed `mutate` ops only to narrowed mutable bodies; Code Mode SDK-returned diagrams are read-only to block direct IR edits.
5. Run `verifyMermaid(d)` at every commit point and inspect `ok` / `warnings` / `layout`.
6. Only then `serializeMermaid(d)`.

Anti-patterns: whole-source regeneration of an existing parsed diagram, string concatenation to edit an existing structured diagram where a typed op exists, serializing before inspecting verify, and calling `mutate` on opaque/source-only bodies.

---

## Release discipline

This section records the design discipline for the branch, not an active roadmap. Active work lives only in `TODO.md`.

| Principle | Meaning |
|---|---|
| **Ship** | Keep the minimum lethal surface together: substrate + `verify` + `mutate` + `serialize` + typed MutationOps + CLI + skill + Code Mode MCP + `Instructions_for_agents.md`. |
| **Learn** | Use MermaidSeqBench, stored Code Mode evals, live model transcripts, and real consumers to decide what is missing. |
| **Expand by evidence** | Promote more MutationOps, composition primitives, HTTP/SSE MCP transport, or additional structured families only when evidence justifies them. |

---

## Measurement

| What | How | Target |
|---|---|---|
| Layout JSON byte-equality across runs | Determinism grid (4 directions × node-counts 2..12 × {sparse, dense, star}) | 100% within one ELK version on one machine |
| Drift sentinel | 8 hand-picked canonical layout JSONs as snapshots; any change without explicit acknowledgment fails CI | — |
| Cross-process determinism | Test spawns child `bun` processes; layout JSON byte-identical across them | 100% |
| Grep-lint substrate | Test fails if `Math.random`/`Date.now`/`performance.now` appear in `src/agent/**` or `src/layout-engine.ts` | 0 hits |
| Tier-1 verifier recall on broken-fixture cases | Inline tests per Tier-1 code | high |
| Round-trip identity | Golden corpus + property test | 100% on canonical input |
| Round-trip property | Property test (fast-check) | 100% on parseable input |
| Sequence fidelity | Property test: any sequence source with unmodeled constructs falls back to opaque and round-trips verbatim | 100% lossless |
| Sad-path coverage | CLI mutate on opaque family; malformed JSON-RPC; broken Code Mode script; N-round format idempotence | explicit tests |
| Fault-injection (poor-man's mutation testing) | Inject a known bug into each core function, confirm a test catches it, revert | every core fn covered |
| Code Mode sandbox isolation | Tests assert `execute()` cannot reach `process`, `require`, `fetch`, `eval`, `Function`, or host-constructor escape paths; dynamic code generation is disabled | explicit tests |

Cross-cutting:

- **Doc-sync** (both directions): every `LayoutWarning` code and `MutationOp` kind must appear in this spec. `am --agent-instructions` output must equal `Instructions_for_agents.md` byte-for-byte.
- **Test honesty:** no tautological assertions (`expect(typeof x).toBe('boolean')` is banned by review). Every test must be able to fail for the regression it names. Verified by the fault-injection pass.

MermaidSeqBench is wired as an external corpus signal; live model transcript evaluation remains periodic / pre-release rather than PR CI.

---

## Risks (honest, v4)

- **Determinism is empirical, not proven.** It's established by cross-process test over a corpus + the drift sentinel, plus reading ELK's config (`considerModelOrder: NODES_AND_EDGES`, no `randomSeed`). An ELK upgrade could in principle change this; the cross-process test and sentinel would catch it. There is no seed to fall back on because seeding never affected output.
- **Determinism claim, precisely.** Layout JSON is byte-identical (after structural parse) across processes AND across JS runtimes (bun, node) on the same machine and same ELK version; this is verified on same-machine x86_64 and ARM64 when Node + built `dist/` are present. Direct cross-architecture byte equality (x86_64 output compared to ARM64 output) is still not a separate claim.
- **Sequence structured coverage is deliberately narrow.** Only participant declarations + simple messages get a mutable structured body; everything else falls back to opaque (lossless, but not mutable). This is the honest tradeoff that replaced silent information loss.
- **Journey, xychart, architecture, and opaque fallbacks are source-level only.** They remain deliberate, lossless source-level paths; no structured mutation is exposed for them.
- **Live-model agent-usage eval is periodic, not PR CI.** Stored Code Mode scripts, sandbox traces, task oracles, and the committed pi-subagent transcript replay run in CI; API-backed release-model transcripts remain in `TODO.md` because they need model access and selected release tasks.
- **Bloat in agent-facing docs.** `Instructions_for_agents.md` is hard-capped under 100 lines; doc-sync test enforces.

## What v4 delivers (vs. earlier drafts)

- **Determinism is structural and verified cross-process** — not a seed apparatus. The seed/RNG/clock machinery and the font-metric table are *removed* (they did nothing).
- **Mutation for flowchart/state, sequence, timeline, class, and ER**, family-narrowed overloads, compile-time rejection of journey, xychart, architecture, and opaque/source-only families.
- **Sequence parsing is lossless** — structured-or-opaque fallback; never silently drops constructs.
- **Substrate enforcement is a real grep test** that runs under `bun test`, not an ESLint config that was never installed.
- **`synthesizeFromGraph`** lets `am parse | am serialize` round-trip without `canonicalSource` on the wire.
- **`LABEL_OVERFLOW` is a source-based char-count check** (Tier 1, reliable), not a font-metric heuristic.
- **`Finite` branded type** enforced at every coordinate emission.
- **Deliverable completeness:** CHANGELOG entry, README section, an `examples/` script, per-verb CLI `--help`, and a `FORK_DIFFERENCES.md` mention all ship with the code.
- **Test honesty:** the tautological seed-variance test is gone; a fault-injection pass proves the suite has teeth.

---

## What Code Mode unlocks

The Code Mode MCP raises the ceiling on what an agent can do with the library in one call. We initially framed the agent surface as a fixed set of verbs (parse, verify, mutate, serialize) where each verb is one round-trip. Code Mode reframes the surface as a typed library that the agent composes against — and the only thing we ship is the small set of primitives plus a sandbox. The agent supplies the algorithm.

Concrete consequences, in roughly descending impact:

1. **Composition without shipping composition.** `@include`, `@template`, vars/`${}` are deferred indefinitely. An agent can implement its own splice or template flavor in JavaScript over source strings and SDK-returned parsed diagrams — parse trusted inputs, use supported `mutate` operations, verify, serialize — in one round-trip. Code Mode does not bless hand-fabricated `ValidDiagram` clones; structured edits stay on SDK lineage.
2. **Multi-diagram repo operations.** "Rename `AuthService` across every architecture diagram in this repo, verify each, and report which now have warnings." With verb-per-tool MCP that's `N × 3` round-trips. With Code Mode: host/agent code supplies the file list and source strings, and one `execute()` can process them together. The sandbox itself does not expose filesystem access.
3. **Auto-fix loops in one round-trip.** `verify` → identify mechanically fixable warnings → apply fixes → `verify` again, as a `while (!result.ok)` block. The agent only sees the final state plus a structured audit trail.
4. **Diagram-as-tests / CI gate.** A repo installs `agentic-mermaid`, runs the `agentic-mermaid-mcp` binary, and writes a Code Mode snippet that verifies every `.mmd` on push. Diagrams become test artifacts that fail CI when they break.
5. **No need to ship `diffDiagrams` or `explainDiagram`.** Already cut. Code Mode confirms the cut: an agent that wants structural diff writes it from `parse` + `ValidDiagram` inspection in JavaScript. Every "would be nice to have a verb for" becomes "write the code for it in `execute()`."
6. **Library as the cross-tool agent interface for diagrams.** A Mermaid linter, a `mermaid → d2` converter, a `graphviz → mermaid` importer can each expose the same Code Mode shape. Any agent then writes one JavaScript snippet that composes across libraries. We've effectively defined the agent interface for diagrams in this language.
7. **Benchmark eval at speed.** MermaidSeqBench (and any future eval) runs as one `execute()` per case rather than N round-trips. Internal velocity multiplier.
8. **Potential future Worker path.** Cloudflare-hosted Agentic Mermaid is tracked as `TODO.md` BUILD-4. A separate wrapper could use `@cloudflare/codemode` + `DynamicWorkerExecutor` after the security boundary, auth/rate limits, persistence, and CLI/MCP/library parity are scoped. The current repo does not ship that dependency or runtime; JavaScript snippets plus a TypeScript-shaped SDK declaration are the reusable design idea, not a current Cloudflare deployment.
9. **The skill becomes runnable, not just descriptive.** `references/code-mode.md` ships canonical executable JavaScript snippets the agent copy-pastes into `execute()`. Skill stops being prose; starts being a library of executable patterns.
10. **A future diagram REPL would be a thin transport.** An `am repl` could become an interactive Code Mode shell — paste JavaScript, get structured results, iterate. Same sandbox, different transport. It is not shipped and would need promotion to `TODO.md` before implementation.

The biggest single consequence is #1: it gives us permission to never grow the spec for composition, queries, diffing, explaining, or any "we should probably have a verb for that" feature. **The verb set is intentionally small; Code Mode makes it sufficient.**

### Counter-example: why we did not ship a `render-tool-per-format` MCP

Upstream [manuareraa PR #42](https://github.com/lukilabs/beautiful-mermaid/pull/42) takes the opposite design: an MCP server with one tool per output format (`render_svg`, `render_ascii`, `render_png`, etc.), each pinned to a specific renderer call. We considered cloning that surface and decided against it for two reasons. First, the verb explosion is unbounded — every new output format means a new tool, every option flag means a new tool variant, and every cross-cutting workflow (parse → verify → render → write back) requires the agent to glue tools together via the host's tool-call protocol, multiplying round-trips. Second, the per-tool typing pushes structure into the tool schema where the agent can only see what the schema declares; it can't introspect `ValidDiagram`, can't compose `mutate` with `verify`, and can't write the algorithm that uses the answer. Code Mode inverts both: one `execute` tool with a typed `mermaid.*` SDK declaration in scope. Read-only inspection, cross-diagram lookups, and custom transforms are ordinary JavaScript inside that execution context rather than additional MCP tools. Anything PR #42's surface could do — render-to-format with options — is one line of JavaScript inside `execute`; anything our surface can do that PR #42's can't includes every multi-step workflow that touches more than one verb. The asymmetry justifies the cut.

---

## Why totality matters

Each property alone leaves a gap. Determinism alone — agents can diff outputs but can't edit without regenerating. Round-trip alone — every edit shuffles the layout, drowning the signal. Verify alone — outputs aren't reproducible across runs, so a warning fixed in one run silently returns in the next.

Together they close a loop:

1. Parse the source into `ValidDiagram`.
2. `mutate` one node — the IR guarantees the edit produces valid Mermaid.
3. `verify` — structured warnings tell the agent whether anything broke.
4. If broken, back up to the previous `ValidDiagram` and try a different op.
5. `serializeMermaid` only after verify passes.

That loop is the agent-native claim. Replacing several rounds of vision-on-PNG with one structured verification pass is what makes a coding agent reach for this fork before any other Mermaid library.

The API makes the loop possible. `Instructions_for_agents.md` and `am --agent-instructions` make it a habit. Both ship together.
