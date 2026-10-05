// ============================================================================
// Warning catalog — the one description of every verify warning code.
//
// Typed as Record<WarningCode, …>, so adding a code without describing it, or
// describing a code that does not exist, fails typecheck. Key order is the
// order the generated tier lists and tables print codes in.
//
// - `summary` and `guideNote` are Markdown. `bun run doc-blocks` writes
//   `summary` into the AGENT_NATIVE.md warning tables (`warning-table:<tier>`)
//   and `guideNote`, a clause without its final period, into
//   Instructions_for_agents.md as "`CODE` means <guideNote>."
//   (`warning-summaries:<tier>`). The agent-usage evals measure that guide and
//   it must stay under 100 lines, so only codes whose name does not say
//   enough carry a guideNote.
// - `what`, `triggers` and `fix` are inline HTML (<code> spans, entities) for
//   the per-code pages under /warnings/; website/build.ts converts them to
//   Markdown for the .md siblings and capabilities.json. `what` completes the
//   page lead "CODE is a <tier> <severity>: …". `example` is a minimal source
//   the build checks still fires the code; engine-bug tripwires with no small
//   deterministic reproduction have none.
// ============================================================================

import type { WarningCode } from './types.ts'

export interface WarningDescription {
  readonly summary: string
  readonly guideNote?: string
  readonly what: string
  readonly triggers: string
  readonly fix: string
  readonly example?: string
}

export const WARNING_CATALOG: Readonly<Record<WarningCode, WarningDescription>> = {
  EMPTY_DIAGRAM: {
    summary: 'Diagram contains no renderable elements',
    what: 'the source parses to a diagram with no drawable content.',
    triggers: 'A bare header like <code>flowchart TD</code> with no statements after it, a body containing only comments, or a mutation sequence that removed the last node, message, or task.',
    fix: 'Add at least one element — <code>add_node</code>/<code>add_edge</code> for flowcharts, <code>add_participant</code>/<code>add_message</code> for sequence, <code>add_task</code> for gantt/journey — or check that the intended body was not lost before serializing.',
    example: 'flowchart TD',
  },
  EDGE_MISANCHORED: {
    summary: 'Edge endpoint does not attach to a real node / participant',
    what: 'an edge, message, or dependency references an endpoint that is not in the diagram.',
    triggers: 'A gantt <code>after</code>/<code>until</code> dependency naming a missing task, a class <code>note for</code> a class that does not exist, or a diagram body assembled outside the parser whose edges, messages, or commit parents name missing endpoints. The typed <code>remove_node</code> and <code>remove_participant</code> mutations drop the attached edges and messages themselves.',
    fix: 'Add the missing endpoint (<code>add_node</code>, <code>add_participant</code>, <code>add_task</code>) or retarget/remove the dangling edge (<code>remove_edge</code>, <code>remove_message</code>).',
    example: 'gantt\n  dateFormat YYYY-MM-DD\n  section Build\n    Design :design, 2026-01-01, 2d\n    Ship :ship, after review, 3d',
  },
  OFF_CANVAS: {
    summary: 'Node or edge segment lies outside the canvas',
    what: 'a positioned node or edge route extends past the computed canvas on the reported axis.',
    triggers: 'Never in normal operation — the engine sizes the canvas around content, so this is a tripwire that fires only when a layout pass moves geometry after the canvas was sized. Layout is deterministic, so a firing input reproduces byte-identically.',
    fix: 'Not fixable by editing the diagram content itself: simplify or remove the construct that provokes it, and report the source as a renderer bug so the layout defect gets fixed.',
  },
  GROUP_BREACH: {
    summary: "Member node lies outside its group's bounds",
    what: 'a node that belongs to a subgraph or group is positioned outside its group rectangle.',
    triggers: 'An engine-bug tripwire like <code>OFF_CANVAS</code>: deeply nested subgraphs combined with cross-group edges are historically where containment slipped. The warning names both the group and the escaping member.',
    fix: 'Flatten the nesting or move the member out of the group (source edit, or <code>remove_node</code> then re-add outside the subgraph). A reproducible breach is a renderer bug worth reporting with the source.',
  },
  UNKNOWN_SHAPE: {
    summary: 'Shape name unrecognized; default used',
    what: 'a node carries a shape outside the renderer’s known vocabulary and falls back to a plain rectangle, or an architecture service names an icon the renderer cannot resolve and gets a text glyph instead.',
    triggers: 'Shape syntax the parser modeled but the renderer does not draw — typically newer Mermaid shape names reaching a structured flowchart or state graph — or an architecture icon that is neither built in nor in the bundled icon set.',
    fix: 'Switch the node to a supported shape (rectangle, rounded, diamond, stadium, circle, hexagon, cylinder, …) or the service to a supported icon with a source edit; the diagram still renders meanwhile, so this is a warning rather than an error.',
  },
  LABEL_OVERFLOW: {
    summary: "A label's longest rendered line exceeds the character cap (default 40, `labelCharCap`): `<br>` and `\\n` split lines, XML entities count as one character, and formatting tags are stripped. Families that draw text literally (Pie, Timeline, Gantt, XYChart, GitGraph, Radar) count `<br>` and tags as characters, as drawn. Payload includes `charCount` and `limit`. Character-based, no font-table dependency.",
    guideNote: "a label's longest displayed line is over the char cap — `<br>`/`\\n` split lines, XML entities decode to one char, formatting tags strip (families that draw text literally count them); default cap 40, raise via `labelCharCap` / `am verify --label-cap N` when long labels are intentional instead of truncating the user's text",
    what: 'a label\u2019s longest rendered line exceeds the character cap (default 40), which hurts layout and readability. The count measures what the renderer draws: <code>&lt;br&gt;</code> starts a new line, XML entities like <code>&amp;#160;</code> count as one character, and formatting tags are stripped, except in the families that draw text literally (Pie, Timeline, Gantt, XYChart, GitGraph, Radar), where <code>&lt;br&gt;</code> and tags count as characters.',
    triggers: 'Prose sentences pasted into node labels, edge labels, message text, or section/period titles — common when an agent copies requirement text verbatim into the diagram. Multi-line labels fire only when a single rendered line exceeds the cap.',
    fix: 'Shorten the text with <code>set_label</code>, <code>set_message_text</code>, or the matching family mutation; raise <code>labelCharCap</code> in <code>VerifyOptions</code> only when long labels are genuinely intended.',
    example: 'flowchart LR\n  A[This label is far longer than the forty character cap] --> B[Done]',
  },
  UNRESOLVABLE_SCHEDULE: {
    summary: "The diagram parses and round-trips but its semantics cannot resolve, so rendering will fail loudly. Emitted for structured gantt bodies whose scheduler raises a named `GANTT_*` error (unknown task reference, bad calendar date, dependency cycle, everything-excluded calendar); the payload's `reason` carries that error.",
    guideNote: 'a gantt parses but its schedule cannot resolve, so render would fail; `reason` names the `GANTT_*` error',
    what: 'a gantt schedule cannot be resolved to concrete dates, so bars cannot be positioned.',
    triggers: 'A task whose <code>after</code>/<code>until</code> expression references a task id that does not exist, a start/end that cannot be parsed against the declared <code>dateFormat</code>, a dependency cycle, or <code>excludes</code> that leave no working day. The warning carries the engine reason string.',
    fix: 'Point the reference at a real task id or give the task explicit dates with the <code>set_task_dates</code> mutation (or edit the offending source line named in the reason).',
    example: 'gantt\n  title Release\n  dateFormat YYYY-MM-DD\n  section Build\n    Ship :ship, after review, 3d',
  },
  RENDER_FAILED: {
    summary: "Any family: the source parses but the strict render parser, layout, or theme colors reject it, so rendering would fail. Generalizes `UNRESOLVABLE_SCHEDULE`'s seam-closing — a clean verify proves the diagram actually renders; the payload's `reason` carries the renderer error.",
    guideNote: 'the source parses but the strict render parser, layout, or theme colors reject it (any family), so rendering would fail; `reason` carries the renderer error — a clean verify proves the diagram actually renders',
    what: 'the diagram parsed, but rendering it throws, so <code>am render</code> would fail instead of producing an artifact.',
    triggers: 'Source the structured parser accepts but the render path rejects: an unrecognized diagram header, an invalid theme color, a family layout error, or a construct the strict render parser cannot handle. The warning’s <code>reason</code> carries the renderer’s message.',
    fix: 'Return the structured error and the source rather than a fabricated artifact; fix what <code>reason</code> names (for example the invalid color), or simplify, split, or drop the construct it points at. A reproducible failure on well-formed source is a renderer bug worth reporting.',
  },
  NODE_OVERLAP: {
    summary: 'Two laid-out node bounding boxes intersect',
    what: 'two nodes’ boxes intersect in the final layout; the warning reports the pair and the overlap area in pixels.',
    triggers: 'The deterministic layout separates nodes by construction, so no small flowchart source fires this — it appears only when a family adapter or post-pass produces colliding boxes on dense inputs. It is a tripwire, not an everyday lint.',
    fix: 'Shorten the labels of the named pair or reduce local density; if the overlap persists on a stable input, treat it as a layout defect and report the source.',
  },
  ROUTE_SELF_CROSS: {
    summary: 'An edge route crosses itself',
    what: 'a single edge’s routed polyline crosses over itself.',
    triggers: 'A routing tripwire on the final geometry: the router avoids self-intersection, so a firing means dense cyclic routing degraded. The warning names the edge and the crossing count.',
    fix: 'Remove or redirect the redundant edge (<code>remove_edge</code>, then <code>add_edge</code> along a simpler path); a persistent self-cross on unchanged source is an engine bug to report.',
  },
  ROUTE_HITCH: {
    summary: 'An edge bends although a direct lane for it is provably clear (route-contract tripwire)',
    what: 'an edge bends although a clear straight lane exists for it; the warning reports how far the route strays from that lane, in pixels.',
    triggers: 'The layout certifies clear lanes when routes are frozen; a hitch means a later pass mutated geometry after certification. Agents cannot cause this from source alone.',
    fix: 'Simplify the crossing edges near the named edge if a quick fix is needed, and report the reproducing source — the certificate/geometry mismatch is an engine defect.',
  },
  ROUTE_UNEXPLAINED_BEND: {
    summary: 'An edge contains a diagonal segment under orthogonal routing (route-contract tripwire)',
    what: 'an orthogonally-routed edge contains a diagonal segment, a bend its route certificate cannot explain.',
    triggers: 'Flowchart and state routes are orthogonal and certified; a diagonal segment on a forward or feedback edge means post-certification geometry drift. Not reachable from well-formed source in normal operation.',
    fix: 'No source-level fix is expected to be needed; if verify reports it, capture the source and report it as a renderer bug — determinism makes the reproduction exact.',
  },
  ROUTE_LABEL_ON_SHARED_TRUNK: {
    summary: 'A label pill sits on a line segment another edge shares (route-contract tripwire)',
    what: 'an edge label sits on a line segment shared with another edge, so it is ambiguous which edge it names.',
    triggers: 'Fan-in/fan-out patterns where several labeled edges merge onto a shared trunk and a label pill lands on the shared piece rather than the edge’s own segment.',
    fix: 'Shorten the label with <code>set_label</code> so it fits the edge’s exclusive segment, or restructure the fan so the labeled edge has its own approach.',
  },
  ROUTE_SELF_LOOP_OCCUPANCY: {
    summary: 'A self-loop certificate has invalid side/boundary geometry or collides with another loop/label (route-contract tripwire)',
    what: 'a self-loop cannot reserve a clear side, boundary span, route corridor, or label area without colliding with another loop or route.',
    triggers: 'Several self-loops competing for the same node side, or a later route/label pass entering space already certified for a loop. The warning names the conflict kind and, when applicable, the other edge.',
    fix: 'Move one relationship to a different endpoint or remove a redundant loop. If it persists on unchanged source, report it as a route-allocation defect.',
  },
  ROUTE_CONTAINER_MISANCHOR: {
    summary: 'A container edge does not terminate on the container border (route-contract tripwire)',
    what: 'an edge attached to a subgraph or group does not terminate on the container’s border.',
    triggers: 'Container-anchored edges must end exactly on the group rectangle; a miss means the border moved after routing. This is a tripwire over final geometry rather than a source mistake.',
    fix: 'Re-anchor the edge to a member node instead of the container as a workaround, and report the source — the container anchor contract is the engine’s to uphold.',
  },
  ROUTE_SHAPE_MISANCHOR: {
    summary: 'An endpoint is off the rendered shape boundary (route-contract tripwire)',
    what: 'an edge endpoint does not sit on the outline of the node shape it connects to (e.g. off a diamond’s facet).',
    triggers: 'Endpoint-on-shape is checked against the final node geometry; a miss usually accompanies a node that changed size or shape after routes were frozen.',
    fix: 'Switching the node to a simpler shape (rectangle) is the mechanical workaround; the underlying anchor drift is an engine defect worth reporting with the source.',
  },
  ROUTE_STALE_AFTER_NODE_MOVE: {
    summary: "An endpoint detached from its node entirely, or another node sits on the edge's route (route-contract tripwire)",
    what: 'an edge still follows a corridor computed before a node moved: an endpoint anchors where its node used to be, or another node now sits on the route.',
    triggers: 'A compaction or alignment pass moved a node after edge routing without re-anchoring the affected edges. Not producible from source alone in normal operation.',
    fix: 'No diagram edit reliably clears it; report the reproducing source. If it blocks a task, removing and re-adding the named edge forces a fresh route.',
  },
  DUPLICATE_EDGE: {
    summary: 'Flowchart/state contains an exact repeated edge with the same endpoints, label, style, and markers. Usually accidental regeneration or duplicate mutation.',
    what: 'two edges with identical endpoints, label, style, and arrowheads — the second adds ink but no information.',
    triggers: 'An agent re-adding an edge that already exists, typically an <code>add_edge</code> issued without checking the current edge list, or copy-pasted source lines.',
    fix: 'Remove one copy with <code>remove_edge</code> (or delete the duplicate source line); if two parallel edges are intentional, give them distinct labels so they stop being duplicates.',
    example: 'flowchart LR\n  A[Start] --> B[Finish]\n  A --> B',
  },
  UNREACHABLE_NODE: {
    summary: 'Flowchart/state contains a node not reachable from any entry root when the graph has roots. Usually a stranded branch after an edit.',
    what: 'a node cannot be reached from any root (a node with no incoming edges) by following edges.',
    triggers: 'Disconnected clusters left behind after <code>remove_edge</code>/<code>remove_node</code> mutations, or a cycle with no entry edge from the main flow.',
    fix: 'Connect the node into the flow with <code>add_edge</code> from a reachable node, or delete it with <code>remove_node</code> if it is leftover.',
    example: 'flowchart LR\n  A[Start] --> B[Done]\n  C[Orphan] --> D[Cycle]\n  D --> C',
  },
  DECISION_BRANCH_UNLABELED: {
    summary: 'A decision diamond has two or more exits and this branch carries no condition label. ISO 5807 (10.3.1.2) and ANSI X3.5 (4.10.2) require every exit of a multi-exit decision to be labeled with its condition value.',
    guideNote: 'a multi-exit decision diamond has an unlabeled branch',
    what: 'a decision diamond with two or more exits has at least one unlabeled exit, so the branch condition is ambiguous.',
    triggers: 'Adding a second exit to a diamond without a condition label. ISO 5807 / ANSI X3.5 require each exit of a multi-exit decision to be labeled with its condition value.',
    fix: 'Label every exit — <code>set_label</code> on the unlabeled edge (e.g. <code>yes</code>/<code>no</code>) or add <code>|condition|</code> to the source line.',
    example: 'flowchart TD\n  A{Ready?} -->|yes| B[Ship]\n  A --> C[Wait]',
  },
  FLOW_IMBALANCE: {
    summary: "A sankey intermediate node (one with both inflow and outflow) receives a different total than it emits. Conservation across stages is the domain's defining property — the ribbon widths are an account — and the layout silently renders `max(in, out)`, hiding the unaccounted quantity. Payload carries `node`, `inflow`, `outflow`, and a `message` naming the unaccounted amount. Balance the flows or add an explicit remainder link (e.g. a `Losses` sink).",
    guideNote: "a sankey intermediate node receives a different total than it emits — conservation across stages is the domain's defining property, so the warning names the node, its inflow, its outflow, and the unaccounted amount (which otherwise renders silently as node height); balance the flows or add an explicit remainder link",
    what: 'a Sankey intermediate node receives a different total flow than it emits, leaving part of its height without a matching ribbon.',
    triggers: 'A node appears as both a link target and source, but the sum of incoming values differs from the sum of outgoing values beyond floating-point tolerance.',
    fix: 'Balance the incoming and outgoing values, or add an explicit remainder link so every unit of flow has a named destination.',
    example: 'sankey-beta\n  Supply,Hub,10\n  Hub,Used,7',
  },
  COMMENT_DROPPED: {
    summary: "The source contains in-body `%%` comments that this diagram's structured serialization does not preserve (reported with `count` and `lines`). The leading wrapper — frontmatter, `%%{init}%%` directives, comments before the header — always round-trips byte-verbatim; in-body comments survive only in opaque bodies or preserved opaque segments. Re-home load-bearing comments into the wrapper, or accept the loss as canonicalization.",
    guideNote: 'in-body `%%` comments will not survive structured serialization; the leading wrapper (frontmatter, `%%{init}%%` directives, comments before the header) always round-trips byte-verbatim',
    what: 'in-body %% comments will not survive structured serialization; the loss is announced, not silent.',
    triggers: 'Comments between statements in a structurally-modeled body: the typed tree does not model them, so <code>serializeMermaid</code> writes the body back without them. The warning carries the count and line numbers.',
    fix: 'Move essential comment content into a label or title before mutating, keep a source-level edit instead of a typed mutation when comments must survive, or accept the loss knowingly.',
    example: 'flowchart LR\n  %% review note that structured serialization drops\n  A[Start] --> B[Done]',
  },
  UNSUPPORTED_SYNTAX: {
    summary: 'The source uses Mermaid syntax that is preserved losslessly but not fully modeled by local structured mutation/render semantics (for example flowchart edge IDs, edge metadata, click/href directives, or markdown strings), or, with `syntax: "empty_layout"`, the source carries content but the local layout renders a 0x0 canvas with no nodes, edges, or groups. Payload includes `syntax`, optional `line`, and `message`.',
    guideNote: 'either a Mermaid construct (for example flowchart edge IDs, edge metadata, click/href, or markdown strings) is preserved losslessly as source but is not fully modeled by local structured mutation/render semantics, or `syntax: "empty_layout"` means the source carries content but the local layout produced a 0x0 canvas with no nodes, edges, or groups. Inspect the warning message and `verify.layout` before accepting the artifact',
    what: 'the source uses syntax or content the local structured model cannot faithfully express.',
    triggers: 'Flowchart <code>click</code>/<code>href</code> directives, edge IDs and edge metadata, v11 <code>@{ shape: … }</code> node metadata, markdown strings, unclosed delimiters that would silently drop content, or <code>syntax: "empty_layout"</code> when content-bearing source lays out to a 0×0 canvas with no nodes, edges, or groups.',
    fix: 'For preserved Mermaid syntax, remove the directive if local rendering fidelity matters, or keep it knowing the local renderer ignores it; edits touching those lines need source-level editing rather than typed mutations. For <code>empty_layout</code>, inspect the warning message and <code>verify.layout</code>, then repair the malformed or unsupported source before accepting the artifact.',
    example: 'flowchart LR\n  A[Start] --> B[Docs]\n  click B callCallback',
  },
  CONTENT_DROPPED_ON_ROUNDTRIP: {
    summary: 'The structured `{nodes, edges, groups}` tally changed across a parse → serialize → re-parse cycle, so canonical serialization is silently dropping or duplicating content even though the bytes may re-parse (payload carries `before`/`after` counts). The faithfulness analogue of `COMMENT_DROPPED` — "100% parse success is not faithfulness". Runs on every verify, for every family; opaque bodies (byte-verbatim) are exempt.',
    guideNote: 'the structured node/edge/group tally changed across a parse → serialize → re-parse cycle — canonical serialization is silently dropping or duplicating content even though the bytes may re-parse; treat it as a faithfulness bug to report',
    what: 'a parse → serialize → re-parse cycle lost nodes, edges, or groups by count.',
    triggers: 'A serializer defect on unusual syntax: the faithfulness tally before and after the round trip disagrees. This is a tripwire that guards every verify; it should not fire on supported syntax.',
    fix: 'Do not serialize the typed tree for this diagram — fall back to source-level edits so nothing is lost, and report the source; the before/after counts on the warning pinpoint what vanished.',
  },
  INEFFECTIVE_CONFIG: {
    summary: "A Mermaid config field has no effect on this family's geometry or paint: it is accepted for config-shape compatibility but not wired (e.g. Journey's sequence-era fields `boxMargin`, `rightAngles`, …), unknown to the family's config section, or given an invalid value. Payload names the `field`. Accepting-and-ignoring silently misleads migrating users; this lint says so.",
    guideNote: "a Mermaid config field has no effect on this family's output — it was accepted for compatibility but is not wired, is unknown to the family, or has an invalid value (the warning names the field)",
    what: 'a Mermaid config field has no effect on this family’s geometry or paint: it was accepted for compatibility but is not wired, is unknown to the family, or has an invalid value.',
    triggers: 'Copying configuration between diagram families, using a documented upstream option that this deterministic renderer has not wired, supplying an unknown field under a known family section, or giving a field a value of the wrong type or range. The warning names the exact field.',
    fix: 'Remove the inert field, correct an invalid value, move the setting under the family that supports it, or use a wired render option. Do not rely on the accepted value until verify stops reporting it.',
    example: '---\nconfig:\n  flowchart:\n    madeUpKey: 1\n---\nflowchart LR\n  A --> B',
  },
  LOW_CONTRAST: {
    summary: 'A concrete authored paint remains authoritative but misses a measurable contrast threshold against the final resolved opaque background. Payload names the `field`, `foreground`, `background`, measured `ratio`, and required `minimum`; verification diagnoses without repainting authored intent. Transparent output is not measured because its host backdrop is unknown.',
    guideNote: 'a concrete authored paint remains authoritative but misses a measurable contrast threshold against the final resolved opaque background; the warning reports both colors, the measured ratio, and the minimum without repainting. Transparent output is not measured because its host backdrop is unknown',
    what: 'a concrete authored paint remains in the output but misses a measurable contrast threshold against the final resolved page background.',
    triggers: 'An authored color such as <code>themeVariables.radar.axisColor</code> resolves to less than 4.5:1 against an opaque page. Transparent output is not measured because its host backdrop is unknown.',
    fix: 'Choose a foreground or page color that meets the warning’s <code>minimum</code> ratio. The renderer preserves explicit authored paint, so re-run verify after changing the source rather than expecting an automatic repaint.',
    example: '---\nconfig:\n  themeVariables:\n    radar:\n      axisColor: "#dddddd"\n---\nradar-beta\n  axis speed, cost, safety\n  curve current{4,3,5}\n  max 5',
  },
  LABELS_HIDDEN: {
    summary: 'A chart\'s layout left out text the source asked for because it did not fit. XY chart: `target: "x-axis"` lists the authored category names the axis does not draw (tick labels thinned to avoid overlap, or the whole category axis dropped when its widest name does not fit); `target: "data-labels"` lists the bars (`category = value`) whose value label fits neither inside the bar nor in the plot beyond its end — shorten the names, flip with `set_orientation {horizontal: true}`, or widen the value range. Quadrant chart: `target: "point-labels"` lists the points whose label collides with labels placed first — spread the points, shorten the names, or enlarge the chart. The chart still renders; `describe` still lists every category and point, so this lint is the only signal that a reader cannot see them.',
    guideNote: 'a chart left out text the source asked for because it did not fit: for an XY chart, `target: "x-axis"` lists the category names the axis does not draw (thinned or dropped) and `target: "data-labels"` lists the bars whose value label has no room (shorten the names, flip the chart with `set_orientation {horizontal: true}`, or widen the value range); for a quadrant chart, `target: "point-labels"` lists the points whose label collides with labels placed first (spread the points, shorten the names, or enlarge the chart)',
    what: 'an XY or quadrant chart left out text the source asked for because it did not fit: category names on the x-axis, bar value labels, or quadrant point labels.',
    triggers: 'Many or long category names under a vertical chart, where the axis thins its tick labels to avoid overlap or drops a category axis whose widest name does not fit; a bar whose value label fits neither inside the bar nor in the plot beyond its end; or a quadrant point whose label collides with labels placed before it. <code>target</code> says which, and <code>labels</code> lists exactly what is missing.',
    fix: 'Shorten the category names, flip the chart with <code>set_orientation {horizontal: true}</code> so categories run down the side, or widen the value range so labels have room beyond the bars. For a quadrant chart, spread the points, shorten the names, or enlarge the chart.',
    example: 'xychart-beta\n  x-axis ["North region", "South region", "East region", "West region", "Central region", "Coastal region", "Mountain region", "Desert region", "Island region", "Border region"]\n  bar [12, 18, 9, 22, 15, 11, 7, 5, 3, 8]',
  },
  BAR_RANGE_EXCLUDES_ZERO: {
    summary: 'An XY chart with bar series has an authored y-axis range that excludes zero. Bars grow from zero clamped into the range, so they start at the reported `baseline` and their lengths stop being proportional to their values (a truncated axis). The authored range is kept. Include zero with `set_y_axis`, or draw the series as a line.',
    guideNote: 'an XY chart with bar series has an authored y-axis range that excludes zero, so bars start at the reported `baseline` and their lengths are not proportional to their values; include zero with `set_y_axis`, or draw the series as a line',
    what: 'an XY chart with bar series has an authored y-axis range that excludes zero, so bar lengths are not proportional to their values.',
    triggers: 'A <code>y-axis min --> max</code> range entirely above or below zero. Bars grow from zero clamped into the range, so every bar starts at the reported <code>baseline</code> and small differences look large.',
    fix: 'Include zero in the range with <code>set_y_axis</code>, or draw the series as a <code>line</code>, whose position (not length) carries the value.',
    example: 'xychart-beta\n  x-axis [Q1, Q2, Q3]\n  y-axis 90 --> 100\n  bar [92, 95, 97]',
  },
  VALUES_OUTSIDE_RANGE: {
    summary: 'An XY chart series has values outside the authored y-axis range. A bar stops at the edge of the range, so its length understates the value, and a line point is drawn past the plot. The warning names the `series`, the `values` outside the range, and the `range`; the range is kept. Widen it with `set_y_axis`, or remove it so the axis fits the data.',
    guideNote: 'an XY chart series has values outside the authored y-axis range: a bar stops at the edge of the range, so its length understates the value, and a line point is drawn past the plot; the warning names the `series` and its `values` outside the `range`. Widen the range with `set_y_axis`, or remove it',
    what: 'an XY chart has values outside its authored y-axis range, so the chart misstates them: a bar stops at the edge of the range and a line point is drawn past the plot.',
    triggers: 'A <code>y-axis min --> max</code> range that does not reach every value of a series. The warning names the <code>series</code>, the <code>values</code> outside the range, and the <code>range</code> itself; a bar chart drawn with <code>bar [5, 20]</code> on <code>0 --> 10</code> shows the two bars at a 1:2 length ratio instead of 1:4.',
    fix: 'Widen the range with <code>set_y_axis</code> so it reaches every value, or remove the range so the axis fits the data.',
    example: 'xychart-beta\n  x-axis [a, b]\n  y-axis 0 --> 10\n  bar [5, 20]',
  },
  BRAND_CONSTRAINT_WARNING: {
    summary: 'A caller-selected inspect-only `contrast`, `accent-area`, or `mono-role` Brand constraint failed or could not be measured. Payload reports the constraint, `measurement`, applicable role/mark, and concrete evidence without repainting or relayout.',
    what: 'an explicitly requested inspect-only Brand constraint failed or could not be measured.',
    triggers: 'A StyleSpec <code>contrast</code>, <code>accent-area</code>, or <code>mono-role</code> constraint with <code>action: "warn"</code> inspects final Scene paint. Transparent or unresolved compositing contexts report unmeasurable evidence without inventing a ratio.',
    fix: 'Inspect the structured measurement payload and adjust the role/slot paint or the constraint threshold. The renderer deliberately preserves the authored artifact and never repaints or relayouts it.',
  },
  BRAND_CONSTRAINT_ERROR: {
    summary: 'The same inspect-only Brand constraint contract with `action: "error"`; it preserves authored output but flips `verify.ok` so a caller can enforce its declared brand policy.',
    what: 'a caller-selected Brand constraint failed with error action and therefore blocks verification.',
    triggers: 'The same final-Scene rules as <code>BRAND_CONSTRAINT_WARNING</code>, selected with <code>action: "error"</code> when a project wants its declared brand policy to flip <code>verify.ok</code>.',
    fix: 'Correct the StyleSpec or diagram paint named by the payload, or deliberately change that constraint to <code>action: "warn"</code>. Suppression does not repair the visual issue.',
  },
}
