# Agent architecture

Agentic Mermaid provides typed operations for editing Mermaid source while
preserving the parts an operation does not own. For runnable examples, use the
[editing cookbook](docs/agent-api-cookbook.md). Agents should start with
[Instructions_for_agents.md](Instructions_for_agents.md); contributors should
read the [renderer architecture](https://github.com/adewale/agentic-mermaid/blob/main/docs/design/system/README.md).

## The edit workflow

For an existing diagram, parse it with `parseRegisteredMermaid`, narrow it with
its `as*` helper, and apply the smallest supported `mutate` operation. Inspect
`verifyMermaid`, then save `serializeMermaid` output. A new diagram can be
written directly as Mermaid source before parsing and verification.

A successful edit must also match the request. Verification does not check
whether an agent changed the intended label, retained a requested value or
picked the right diagram family; read back those details before returning.

## (1) Deterministic layout

Within the supported runtime and dependency configuration, the same input and
options produce the same layout. Cross-process and cross-runtime tests exercise
this behavior, and the geometry corpus detects unintended layout changes.
This is not a promise of identical output across dependency upgrades or every
host font environment.

The `seed` option controls drawing variation in styles; it does not drive node
placement. Rendering, terminal layout and rasterization have separate output
contracts. See [quality](docs/quality.md) and [fonts](docs/custom-fonts.md).

## (2) Verifiable rendering

`verifyMermaid` reports structural diagnostics, measured geometry and advisory
warnings. Inspect warning severity and scope along with `ok`.

Rendering receipts separately report whether final painted output is `passed`,
`unverified` or failed. A successful render can still be unverified when a
backend lacks a final-paint proof or an ink intersection remains uncertain.
These statuses do not establish visual quality or task correctness.

The warning tables below are generated from `src/agent/warning-catalog.ts`.
The [warning reference](https://agentic-mermaid.dev/warnings/) explains individual
codes, and [quality](docs/quality.md) describes layout priorities and limits.

### Structural diagnostics

<!-- BEGIN GENERATED: warning-table:structural -->
| Code | Severity | Description |
|---|---|---|
| `EMPTY_DIAGRAM` | error | Diagram contains no renderable elements |
| `EDGE_MISANCHORED` | error | Edge endpoint does not attach to a real node / participant |
| `OFF_CANVAS` | error | Node or edge segment lies outside the canvas |
| `GROUP_BREACH` | error | Member node lies outside its group's bounds |
| `UNKNOWN_SHAPE` | warning | Shape name unrecognized; default used |
| `LABEL_OVERFLOW` | warning | A label's longest rendered line exceeds the character cap (default 40, `labelCharCap`): `<br>` and `\n` split lines, XML entities count as one character, and formatting tags are stripped. Families that draw text literally (Pie, Timeline, Gantt, XYChart, GitGraph, Radar) count `<br>` and tags as characters, as drawn. Payload includes `charCount` and `limit`. Character-based, no font-table dependency. |
| `UNRESOLVABLE_SCHEDULE` | error | The diagram parses and round-trips but its semantics cannot resolve, so rendering will fail loudly. Emitted for structured gantt bodies whose scheduler raises a named `GANTT_*` error (unknown task reference, bad calendar date, dependency cycle, everything-excluded calendar); the payload's `reason` carries that error. |
| `RENDER_FAILED` | error | Any family: the parser, the strict render parser, layout, or theme colors reject the source or its configuration, so rendering would fail; `origin` says which (`source` or `config`). Generalizes `UNRESOLVABLE_SCHEDULE`'s seam-closing — a clean verify proves the diagram actually renders; the payload's `reason` carries the renderer error. A defect in Agentic Mermaid itself is `INTERNAL_ERROR` instead. |
| `INTERNAL_ERROR` | error | Agentic Mermaid hit an internal defect while drawing this source; it is not caused by the source. `defaultRender` says whether an ordinary render still produces output: `succeeds-unchecked` — it does, but the extra consistency checks verify runs failed, so its layout evidence cannot be trusted; `fails` — rendering throws. The payload's `reason` carries the internal error. Do not rewrite the diagram to work around it; report it with the source. |
<!-- END GENERATED: warning-table:structural -->

### Geometric diagnostics

<!-- BEGIN GENERATED: warning-table:geometric -->
| Code | Severity | Description |
|---|---|---|
| `NODE_OVERLAP` | warning | Two laid-out node bounding boxes intersect |
| `CONTENT_OCCLUDED` | error | Final layout hides authored text or an interaction marker |
| `LAYOUT_LIMIT_EXCEEDED` | warning | Preserved content exceeds an explicitly requested layout budget |
| `LAYOUT_UNCERTIFIED` | error | No layout candidate passed certification, so the diagram was drawn from the best one anyway (fewest misleading, then fewest violations). One warning per failed check: `violation` names it (a hard rubric metric such as `endpointApproaches` or `edgeThroughNode`, `groupHeaderBand`, or a paint issue such as `CONNECTOR_CARD_CROSSING`) and `targets` the ids involved; a containment failure is `GROUP_BREACH`. Render still succeeds; `receipt.layoutCertification.geometry` names the candidate drawn. `layoutSafety: "strict"` refuses instead. |
| `ROUTE_SELF_CROSS` | warning | An edge route crosses itself |
| `ROUTE_HITCH` | warning | An edge bends although a direct lane for it is provably clear (route-contract tripwire) |
| `ROUTE_UNEXPLAINED_BEND` | warning | An edge contains a diagonal segment under orthogonal routing (route-contract tripwire) |
| `ROUTE_LABEL_ON_SHARED_TRUNK` | warning | A label pill sits on a line segment another edge shares (route-contract tripwire) |
| `ROUTE_SELF_LOOP_OCCUPANCY` | warning | A self-loop certificate has invalid side/boundary geometry or collides with another loop/label (route-contract tripwire) |
| `ROUTE_CONTAINER_MISANCHOR` | warning | A container edge does not terminate on the container border (route-contract tripwire) |
| `ROUTE_SHAPE_MISANCHOR` | warning | An endpoint is off the rendered shape boundary (route-contract tripwire) |
| `ROUTE_STALE_AFTER_NODE_MOVE` | warning | An endpoint detached from its node entirely, or another node sits on the edge's route (route-contract tripwire) |
<!-- END GENERATED: warning-table:geometric -->

### Advisory lint

<!-- BEGIN GENERATED: warning-table:lint -->
| Code | Severity | Description |
|---|---|---|
| `DUPLICATE_EDGE` | warning | Flowchart/state contains an exact repeated edge with the same endpoints, label, style, and markers. Usually accidental regeneration or duplicate mutation. |
| `UNREACHABLE_NODE` | warning | Flowchart/state contains a node not reachable from any entry root of its connected part, when that part has roots. Usually a stranded branch after an edit. |
| `DECISION_BRANCH_UNLABELED` | warning | A decision diamond has two or more exits and this branch carries no condition label. ISO 5807 (10.3.1.2) and ANSI X3.5 (4.10.2) require every exit of a multi-exit decision to be labeled with its condition value. |
| `FLOW_IMBALANCE` | warning | A sankey intermediate node (one with both inflow and outflow) receives a different total than it emits. Conservation across stages is the domain's defining property — the ribbon widths are an account — and the layout silently renders `max(in, out)`, hiding the unaccounted quantity. Payload carries `node`, `inflow`, `outflow`, and a `message` naming the unaccounted amount. Balance the flows or add an explicit remainder link (e.g. a `Losses` sink). |
| `COMMENT_DROPPED` | warning | A parsed payload carries a known comment-loss receipt, including payloads produced by older serializers. Current built-in serializers retain detected comments; Flowchart and State anchor them to statements, and other structured families append unassociated comments. The warning carries occurrence count and original line numbers. |
| `UNSUPPORTED_SYNTAX` | warning | The source uses Mermaid syntax that is preserved losslessly but not fully modeled by local structured mutation/render semantics (for example flowchart edge IDs, edge metadata, click/href directives, or markdown strings), or, with `syntax: "empty_layout"`, the source carries content but the local layout renders a 0x0 canvas with no nodes, edges, or groups. Payload includes `syntax`, optional `line`, and `message`. |
| `CONTENT_DROPPED_ON_ROUNDTRIP` | warning | A parse → serialize → re-parse cycle states different semantic facts, so canonical serialization is silently dropping, adding or altering content even though the bytes may re-parse (payload carries the `lost`/`gained` facts and `before`/`after` `{nodes, edges, groups}` counts). The faithfulness analogue of `COMMENT_DROPPED` — "100% parse success is not faithfulness". Runs on every verify, for every family; opaque bodies (byte-verbatim) are exempt. |
| `EVENT_SOURCE_TYPE` | warning | An explicit Event Modeling input connects frame types outside the domain source rules. The source and connection remain renderable; inspect node, source and message. |
| `INEFFECTIVE_CONFIG` | warning | A Mermaid config field has no effect on this family's geometry or paint: it is accepted for config-shape compatibility but not wired (e.g. Journey's sequence-era fields `boxMargin`, `rightAngles`, …), unknown to the family's config section, or given an invalid value. Payload names the `field`. Accepting-and-ignoring silently misleads migrating users; this lint says so. |
| `LOW_CONTRAST` | warning | A concrete authored paint remains authoritative but misses a measurable contrast threshold against the final resolved opaque background. Payload names the `field`, `foreground`, `background`, measured `ratio`, and required `minimum`; verification diagnoses without repainting authored intent. Transparent output is not measured because its host backdrop is unknown. |
| `LABELS_HIDDEN` | warning | A chart's layout left out text the source asked for because it did not fit. XY chart: `target: "x-axis"` lists the authored category names the axis does not draw (tick labels thinned to avoid overlap, or the whole category axis dropped when its widest name does not fit); `target: "data-labels"` lists the bars (`category = value`) whose value label fits neither inside the bar nor in the plot beyond its end — shorten the names, flip with `set_orientation {horizontal: true}`, or widen the value range. Quadrant chart: `target: "point-labels"` lists the points whose label collides with labels placed first — spread the points, shorten the names, or enlarge the chart. The chart still renders; `describe` still lists every category and point, so this lint is the only signal that a reader cannot see them. |
| `SCALE_RANGE_EXCLUDES_ZERO` | warning | The radial scale excludes zero. |
| `BAR_RANGE_EXCLUDES_ZERO` | warning | An XY chart with bar series has an authored y-axis range that excludes zero. Bars grow from zero clamped into the range, so they start at the reported `baseline` and their lengths stop being proportional to their values (a truncated axis). The authored range is kept. Include zero with `set_y_axis`, or draw the series as a line. |
| `VALUES_OUTSIDE_RANGE` | warning | An XY chart series has values outside the authored y-axis range. A bar stops at the edge of the range, so its length understates the value, and a line point is drawn past the plot. The warning names the `series`, the `values` outside the range, and the `range`; the range is kept. Widen it with `set_y_axis`, or remove it so the axis fits the data. |
| `BRAND_CONSTRAINT_WARNING` | warning | A caller-selected inspect-only `contrast`, `accent-area`, or `mono-role` Brand constraint failed or could not be measured. Payload reports the constraint, `measurement`, applicable role/mark, and concrete evidence without repainting or relayout. |
| `BRAND_CONSTRAINT_ERROR` | error | The same inspect-only Brand constraint contract with `action: "error"`; it preserves authored output but flips `verify.ok` so a caller can enforce its declared brand policy. |
<!-- END GENERATED: warning-table:lint -->

## (3) Round-trippable source

Every registered renderable family exposes typed edits for the syntax its
narrower can model. Unsupported statements can be retained as verbatim segments;
other inputs remain opaque source and refuse ordinary typed mutation. Preserving
source is preferable to silently dropping meaning to fit a smaller model.

Canonical serialization can normalize source spelling. Where exact retained
bytes matter, the explicit source-preserving mode supports a bounded set of
Class and Flowchart edits. It returns the edited source together with its parsed
diagram and refuses ambiguous ownership or unsupported dependencies. See the
[mutation policy](docs/agent-mutation-policy.md) for the operations and limits.

## Library, CLI and MCP

For Node/Bun applications, `agentic-mermaid/agent` provides rendering and editing.
Browser/Worker editing uses `agentic-mermaid/agent/core` to avoid the native PNG
dependency; browser rendering uses `agentic-mermaid/browser/lazy`.

The CLI and MCP tools use the same operations. Run `am capabilities --json` for
version-matched families and edit schemas; the registry is their source of truth.
The [MCP guide](docs/mcp-http-transport.md) distinguishes the local and hosted
tool sets. Code Mode composes SDK calls in JavaScript; it grants no filesystem
access. Local VM containment and hosted Worker isolation have different security
boundaries, documented in [SECURITY.md](SECURITY.md).

## Where to read next

- [API reference](docs/api.md): signatures, options and result shapes.
- [Mutation policy](docs/agent-mutation-policy.md): structured and source-level edits.
- [Testing strategy](docs/testing-strategy.md): behavior checks and their limits.
- [Fork differences](docs/fork-differences.md): additions to Beautiful Mermaid.
- [TODO.md](https://github.com/adewale/agentic-mermaid/blob/main/TODO.md): active work.

Earlier implementation narratives and removed approaches remain in Git history.
Current behavior belongs in the owning code, tests and reference guides above.
