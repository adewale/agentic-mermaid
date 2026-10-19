# Divergences

Current implementation decisions that differ from, or materially narrow, the broader `AGENT_NATIVE.md` architecture. This file is **not** a backlog; active work lives only in `TODO.md`. Historical loop logs were removed because they had become process noise. Use Git history for archaeology.

## What still matters

### Determinism is structural, not seeded

- Removed the old `LayoutContext` / `SeededRNG` / `Clock` / `withSeededRandom` / font-metrics apparatus.
- `RenderedLayout` has no `seed` field.
- `VerifyOptions` is intentionally small: `{ suppress?, labelCharCap?, renderOptions? }`.
- Claim scope: same-input structural layout determinism is tested for the supported runtime/version matrix. Cross-machine or cross-architecture float equality is **not** claimed.

### Package and compatibility choices

- Product/docs, npm package name, and repository path are **Agentic Mermaid** / `agentic-mermaid` / `adewale/agentic-mermaid`. The full Node agent surface ships as `./agent`; the runtime-neutral subset ships as `./agent/core` for browser/workerd bundles.
- `MermaidGraph` and `renderMermaidSVGAsync` remain for compatibility with existing renderer/tests/consumers.
- State diagrams own a dedicated `StateBody` IR with state-shaped operations and `asState`; `asFlowchart` returns `null`. Notes, pseudostates, history, concurrency, paint, composites, and direction are modeled. Unsupported extensions remain lossless through the structured-or-opaque boundary.

### Repeated flowchart groups retain one ownership tree

Repeated `subgraph` IDs merge their members into one group, retaining the first authored title. A declaration nested inside an ancestor with the same ID extends that ancestor without adding another containment edge, so `S → S` and `S → T → S` retain all node bodies in an acyclic tree. Mermaid 12.1 can instead select the first completed declaration's title or produce cyclic parent references. Serialization and both renderers consume our normalized ownership tree; work budgets still count the full syntactic nesting before flattening.

### Mutation surface is intentionally narrower than Mermaid syntax

Structured mutation is exposed for every built-in renderable family, but only when that body's parser/IR/serializer/verifier can preserve the modeled semantics. The family roster, edit policies, and mutation operations are generated from `FamilyDescriptor`: read `am capabilities --json` rather than a copied list here. Two family-specific notes:

- sequence (BUILD-18 — segment-preserving: participants, top-level messages, and direct-message `alt`/`opt`/`loop`/`par` fragments are typed; Note/critical/box/activate/autonumber/title plus nested or unmodeled fragment content ride along verbatim as opaque-block segments; only un-segmentable input such as an unbalanced `end` falls back to whole-body opaque);
- architecture mutation includes group-boundary semantics.

Opaque/source-level bodies:

- any known-family diagram that falls back to opaque because it contains syntax its family model cannot preserve safely, such as malformed entries or un-segmentable blocks.

For source-level bodies, agents may render, verify, describe, and round-trip preserved source. They do **not** get typed mutation ops. `am mutate` returns `UNSUPPORTED_FAMILY` for those bodies.

### Class lollipops keep authored identities

The historical Mermaid 11.16.1 comparison used a one-ended lollipop such as
`Port ()-- Service`, where upstream substituted a generated `interface0` endpoint. Agentic Mermaid keeps `Port` and
`Service` as the authored endpoints in its editable body, SVG/Scene and terminal
metadata. Two-ended lollipops and mixed marker forms keep those authored
endpoints too; the tested two-ended forms already agree with upstream on
identity. Markers and solid/dashed shafts remain explicit properties, rather
than creating synthetic classes that collide with authored names.

### Sequence numbering keeps authored control intent

Bare `autonumber` enables or resumes numbering without resetting its counter or increment. `autonumber off` hides numbers while semantic messages continue advancing the retained counter; a late first enable therefore uses the message ordinal. An explicit start resets the counter, and a start without an increment selects increment one. This corrects earlier accidental resets on repeated enable or resume.

Explicit zero starts and zero increments remain meaningful values, unlike pinned Mermaid's truthiness fallback. Supported increments retain hundredths precision. Number evaluation happens once during parsing and reaches graphical and terminal displays through the shared message-label formatter; authored message text and ordered controls remain unchanged.

### Sequence aliases without a separating space

`participant A asAlice` is read as participant `A` with alias `Alice`, rather than pinned Mermaid's surprising participant ID `A asAlice`. Other unspaced aliases, such as an alias containing `:`, are rejected upstream but have equally clear authored meaning. Verification emits `UNSUPPORTED_SYNTAX` with `sequence_unspaced_alias`; canonical serialization writes `participant A as Alice`, preserving the intended identity and label in portable Mermaid.

### C4 retains distinct interactions and authored dynamic indices

The five legacy C4 dialects share a native typed model. Every relationship
occurrence survives, including repeated endpoint pairs, reciprocal interactions,
self interactions and boundary endpoints. `Rel_Back` retains its authored pair
separately from its effective arrow direction. `RelIndex` retains its explicit
index and displays it; other `C4Dynamic` relationships display their lexical
ordinal. Mermaid 11.16's repeated-pair overwrite and discarded explicit indices
are not the intended semantics here.

C4 interaction IDs select occurrences in the current artifact. Standard C4
source cannot encode durable arbitrary edge IDs: structural edits can reallocate
them, and callers must read returned IDs before their next edit. Both output
adapters, facts and a fresh parse of the edited source agree on the new IDs.
Directional relationship hints constrain placement when compatible; contradictory
hints are diagnosed. Empty boundaries and multiline arguments are generous
reader extensions, preserved with portability warnings. Their preservation does
not imply that Mermaid 11.16 accepts them. See [C4](../design/families/c4.md).

### Structured-or-opaque is load-bearing

Known-family input must never be partially parsed and then re-emitted with unknown constructs dropped. If the structured parser cannot preserve a construct, the body stays opaque/source-preserved and serializes from `body.source`.

Sequence, Gantt, and ER refine "opaque/source-preserved" into ordered typed and **opaque-block segments**, so structured operations survive around unmodeled lines. Whole-body opaque remains the fallback for un-segmentable input. Class and Timeline are the remaining segment-preservation candidates tracked in `TODO.md`.

This applies even when the diagram renders successfully. Render support is not the same as structured editing support.

### Code Mode has two checked runtimes

- Local MCP uses synchronous `node:vm`; it is not a container/OS security boundary.
- Hosted MCP uses per-request Cloudflare Dynamic Worker isolates with bounded CPU/subrequests and no outbound network. It deliberately differs from local execution in strict-module and CPU-time details; differential tests pin the shared contract and named divergences.
- SDK-returned diagrams are read-only. Structured edits go through `mermaid.mutate(...)` and trusted lineage from parse/mutate/narrower outputs.

### Runtime surfaces are part of the contract

Keep these in sync when changing agent behavior:

- `src/agent/*` public API;
- `am capabilities` and CLI help;
- MCP SDK declaration and server instructions;
- `Instructions_for_agents.md` / `am --agent-instructions`;
- `skills/agentic-mermaid-diagram-workflow/*`;
- `skills/agentic-mermaid-live-editor/SKILL.md`;
- `llms.txt`;
- `docs/agent-api-cookbook.md`.

Doc-sync tests exist because agents consume docs and capability JSON as runtime surface, not just prose.

## Mermaid input decisions (#363)

These dispositions resolve the investigation in [#363](https://github.com/adewale/agentic-mermaid/issues/363), not every reader or writer gap. Active implementation work remains in [TODO.md](../../TODO.md).
The implementation-status column records merged main
`03981f5a7fa99f04b884e629c5ca9631884ed23e`, with Mermaid **12.2.0** and upstream
source commit `1fb7869866dd619168d840291c9c54b4f129758b`. The original issue's
11.16 observations and dated test comments remain historical evidence.
PR #410 is included in this baseline. Unmerged work described below must not be
reported as delivered on main until its combined candidate is checked.

### Policy and shared causes

Mermaid supplies the input grammar, not a rendering specification. Read clear
authored intent generously and warn when the pinned grammar rejects that
spelling. Reject ambiguous syntax and invalid values. Keep authored content
when upstream discards it. Our drawing, styling and display policies are ours;
they must agree across our own projections. Newly generated structured source
must be accepted by the pinned grammar and retain the modeled meaning.

The differences in #363 came from repeated context-sensitive lexing, separate
renderer/editor parsers, source text being replaced with display text, and
upstream lexer/sanitizer quirks being treated as requirements. One universal
comment or quote regex is not a remedy: `%%` can be a comment, member text, an
accessibility value or part of a node description depending on its grammar
context. A source/display distinction also does not require the stored source
and the displayed string to be byte-identical.

The shared statement authorities delivered under #260 (Class), #261 (Gantt),
#262 (Architecture), #264 (Sequence) and #266 (ER) remain the owners of their
grammar rules. Those issues are closed; remaining cases do not reopen their
completed consolidation or require a new parser framework.

Continue the existing mechanisms:

- Context-specific readers and writers, using shared entity/YAML primitives
  where their semantics match. CONS-46 owns source/display text convergence;
  CONS-47 separately owns Flowchart token/span convergence.
- The existing `UNSUPPORTED_SYNTAX` channel, emitted from the same context that
  classified the input. Unknown or inert styling additionally needs an accurate
  diagnostic about its local effect.
- Structured-or-opaque admission. Preserve unmodeled source or opaque segments
  instead of dropping them or manufacturing a lossy portable replacement.
- Owning behavioral tests for parse/edit/write/reload and our public display,
  identity and metadata contracts. Upstream grammar/DB checks protect portable
  input/output meaning, not pixels or our display choices. Do not generate a
  new inventory or a machine-readable parity allow-list from this table.

`serializeMermaid` also returns source-preserved opaque bodies and segments.
That operation is lossless preservation, not a promise to repair an upstream-
invalid extension. The distinction must remain visible through body disposition
and diagnostics. Existing structured writers that emit invalid source are
identified below; this record does not excuse them as opaque preservation.

### A. Interpretation of accepted source

| Original item | Decision | Implementation at the historical baseline |
| --- | --- | --- |
| BUG-11 / BUG-27: duplicate subgraph membership | **Keep one deterministic owner silently.** Do not introduce duplicate membership to copy a parser artifact or require one upstream tie-break for every family. | Duplicate membership is removed. ER and labelled Flowchart redeclarations use the first-closing-subgraph rule. For a bare repeated Flowchart `A` inside an inner subgraph, ours keeps the earlier outer membership while Mermaid 12.2 puts A in the inner subgraph. Our renderer, typed body and reload agree. Retain this documented mention distinction; do not claim universal first-close parity. |
| BUG-12: `activate Z` creates a participant | **Accept the meaningful reading; no phantom participant.** Ordering alone is not a defect. | Already implemented: activation alone does not create Z. Messages, notes and declarations can create participants. Activation is retained as an opaque segment where it is outside the mutation model. |
| BUG-15: `properties` / `details` create participants | **Accept the reading silently.** These statements are authored mentions of their participant. | Already implemented in the common participant fold; creation order follows the mention. Their unrelated source content is preserved. |
| BUG-16: alias redeclaration resets links | **Keep ours silently.** Retain authored links when an actor is renamed or redeclared. | Implemented and covered across renderer, typed body and reload. Upstream still discards the links in the tested naming redeclaration. |
| BUG-17: box membership with an empty upstream actor list | **Keep semantic membership silently.** A box must enclose its assigned actors even when the auxiliary actor list is empty. | Implemented: layout derives membership from the actor's box. Mermaid 12.2 still exposes the empty-list quirk. |
| BUG-29: `style X` creates X | **Accept the reading silently.** An explicit style target may establish the node. | Implemented. The node is drawn; canonical output declares it explicitly before styling it. |
| ER first alias wins | **Keep the first-alias reading silently.** | Implemented: `A["first"]` followed by `A["second"]` retains `first` and writes portable source. |
| ER generic attribute types sharing a line | **Keep each attribute silently.** | Implemented: Mermaid's block lexer reads one type from a line's first `~` to its last, so `Z { List~int~ a List~str~ b }` is one attribute typed `List~int~ a List~str~` upstream. Ours pairs each `~` with the one that closes it, as brackets, so it reads two attributes and still reads `Map~string, List~int~~` as one type; the typed writer puts each attribute on its own line, which Mermaid reads the same way. |
| ER relation labels of several words | **Keep the whole label and warn (`er_label_words`).** | Implemented: Mermaid's label is one token, so `A \|\|--o{ B : places order` is label `places` plus a declared entity `order` upstream (upstream counts such phantom entities a defect, mermaid-js/mermaid#8054). Ours keeps the label `places order`, says Mermaid reads it otherwise, and writes it quoted, which Mermaid reads the same way. A word followed by a quoted name (`x"y"`, the label `x` plus an entity `y` upstream) is read whole too, reported the same way, and written `"x#quot;y#quot;"`. |
| ER lines naming a direction | **Keep the line's statements and warn (`er_direction_line`).** | Implemented: Mermaid's `.*direction\s+TB` lexer rule makes any line holding `direction TB` (BT, LR, RL) a direction statement, dropping the rest of it: `A \|\|--o{ B : direction LR` loses its relationship, and `A direction TB` its entity. Ours reads the relationship, or the entity and the direction, and says Mermaid reads the line otherwise (label text read as a direction is an old upstream bug, mermaid-js/mermaid#17). A run of declarations never reads past `direction TB` (`A direction RL\|\|--\|{ B` stays unsupported). |
| ER attribute keys parted by spaces, or after the comment | **Read them and warn (`er_attribute_form`); write Mermaid's key list.** | Implemented: Mermaid's attribute is `type name [key, key] ["comment"]` and rejects `int id PK FK` and `int id "c" PK`. Ours reads the keys and comment either way, reports the attribute, and writes `int id PK, FK` and `int id PK "c"`. An attribute whose type or name Mermaid cannot read as a word (`--string id`) is reported and kept as written, since Mermaid reads no spelling of it as the same attribute. |
| ER relationship naming a subgraph | **Keep the relationship on the subgraph silently.** | Implemented: Mermaid's docs draw `title1 \|\|--\|\| title2 : links` between two subgraphs, but its ER database also declares an entity for each endpoint, so its model holds entities `title1` and `title2` beside the subgraphs and lists entities and subgraphs in the order its database fills them. Ours attaches the relationship to the subgraph, declares no entity, keeps source order, and writes the relationship as authored. |
| ER names that start with digits | **Keep one name silently.** | Implemented: Mermaid's lexer takes a number before a name, so `2px` declares entities `2` and `px`, and `2.5abc` declares `2.5` and `abc`. Ours reads one entity `2px` or `2.5abc`. |
| Flowchart `x--`/`o--` at the start of a line | **Keep the node silently.** | Implemented: Mermaid's link token takes the whitespace before it, newlines included, and a leading `x` or `o`, so `A --> B` followed by a line `x--> C` loses `x` and draws B→C upstream. Ours reads x→C and writes `x --> C`, which Mermaid reads the same way. |
| XYChart keywords inside unquoted titles | **Keep the whole title silently.** | Implemented: Mermaid starts a statement at every `title`, `x-axis`, `y-axis`, `bar` or `line` outside a string, so `title The title of the chart` is two titles upstream and loses "The". Ours splits statements sharing a line (`bar [1, 2] line [2, 1]`, as Mermaid) but after unquoted title words only where the new statement carries data, so `title My Chart bar [1, 2]` is a title and a series in both. Output quotes the title, which Mermaid reads the same way. An axis title of several unquoted words reads the same way and keeps its spaces, where Mermaid runs the words together (`x-axis Monthly totals bar [1, 2]` is the axis title "Monthlytotals" upstream). An unquoted category of several words keeps its spaces too (`x-axis [cat2 asdf, b]` is the category `cat2asdf` upstream); the writer quotes it. |
| XYChart unquoted axis title with characters Mermaid rejects | **Read it as written and warn (`xychart_unquoted_axis_title`).** | Implemented: Mermaid's xychart lexer reads an unquoted axis title only from ASCII letters, whitespace and `&+=*.#_-`; in axis data a digit starts a range number. Any other character, such as `(`, `%`, `,`, `:`, `/`, `'` or a non-ASCII letter, is a lexical or parse error upstream (`y-axis Revenue (USD) 0 --> 100`, `x-axis cat, dog`, `x-axis Q1 [a, b]`). Ours reads and draws the title, the writer quotes it, and verify reports it on its line. |
| XYChart accTitle after a statement, beside a different one on its own line | **Keep the source and warn (`xychart_accessibility_order`).** | Implemented: a mid-line `accTitle:` or `accDescr` starts its statement, as in Mermaid, and its value reaches the envelope. Where a different value for the same field also stands on its own line, Mermaid keeps whichever comes last; ours cannot order the two, so the typed body stays opaque and verify warns. |
| Radar accTitle after a statement, beside a different one on its own line | **Keep the source and warn (`radar_accessibility_order`).** | Implemented: a mid-line `accTitle:` or `accDescr` is read into the envelope, as XYChart's is. Where a directive on its own line gives the same field a different value, Mermaid keeps whichever is written last; ours cannot order the two, so the typed body stays opaque, the one on its own line is drawn, as in XYChart, and verify warns. |
| XYChart quoted text with spaces at its ends | **Keep the text silently.** | Implemented: Mermaid trims every XYChart title, axis title and category (`y-axis "  Revenue  "` is `Revenue` upstream). Ours keeps the text inside the quotes as written and writes it quoted, which Mermaid reads trimmed, as it reads the source. |
| Text that runs across lines | **Keep each line break silently; drop the indentation after it.** | Implemented: Flowchart, Class, State, Mindmap, XYChart, Pie, Quadrant, GitGraph, Architecture and Radar read a quoted string across line breaks, and ER an attribute comment, as do Flowchart and Mindmap shape and link text and a Quadrant point's `[x, y]`, as Mermaid's lexers do. Readers drop the whitespace at each line break (a line's trailing space and the continuation's indentation), which Mermaid keeps, and except in GitGraph and Mindmap they drop a blank line inside the text, which Mermaid keeps too; in Mindmap a last line holding only the closing delimiter adds no line break. Mermaid removes a line starting with `%%` before lexing, even inside text; ours drops it too (verify reports `COMMENT_DROPPED`), except GitGraph and State, which keep it as text, as they keep a `%%` later on a line inside a string. Each writer spells the break as Mermaid reads it back in that family: `<br>` or `<br/>` in Flowchart, Class, State and Mindmap labels, `\n` in Radar, and a line break inside the quotes elsewhere. |
| Class members separated by `;` on a block's brace line | **Keep the author's members silently.** | Implemented: Mermaid's member token runs to a brace or line break, so `class A {+x; +y()}` is one method named `x; +y` upstream (and `{+x;}` keeps `x;`). Ours splits members on the line that opens the block at `;`, but not inside `(...)` or at an entity code such as `#59;`, and writes one member per line, which Mermaid reads as the same members. Members on later body lines keep `;` as text, as Mermaid does. |
| State statements sharing a line | **Read them as Mermaid does, and warn (`state_statements_share_line`).** | Implemented: Mermaid reads `A B` as two states and `A --> B C --> D` as two transitions, and so do we, but authors usually mean one name (mermaid-js/mermaid#2973), so verify says how to write one. |
| Gantt statements after `;` | **Read each statement and warn (`gantt_semicolon_separator`).** | Implemented: Mermaid ends a task's data, and a dateFormat, axisFormat, tickInterval, includes or excludes value, at `;` and reads what follows as the next task, labelled with the `;` (`Task :a1, …; Task2 :a2, …` is a task `; Task2`), or rejects it when no task follows. Ours reads the next statement as authored (`Task2`) and writes each statement on its own line. A `;` in a task label, a title, a section or a todayMarker's CSS stays text. |
| State class on a `[*]` endpoint | **Keep the class silently.** | Implemented: Mermaid colours the start or end node of `[*]:::c --> A`, drops the class inside a composite, and merges every `[*]` start in a scope into one node, so `[*]:::c --> A` also colours the start of `[*] --> B`. Ours keeps the class on that transition's own endpoint (each transition draws its own start, an existing difference) and writes it back inline, the only portable spelling. A hyphenated class there has none, so that source stays opaque. |
| State `direction XX` sharing a line | **Keep the line's statements silently.** | Implemented: Mermaid's `.*direction` lexer rule swallows the whole line, so `state X { direction LR` loses `state X {` and the later `}` becomes a state. Ours reads each statement, as for ER. |
| BUG-50: Mindmap `%%` in node text | **Real content-loss defect; preserve the node text.** | Still open at the baseline: `a %% b` becomes `a` in our body, drawing and output; Mermaid 12.2 retains the whole text. The historical claim that the newer pin strips this is not current. This and State description loss belong to #372 comment item 5, not a new issue. |
| BUG-53: accessibility text ends at `%%` | **Keep ours silently.** Do not truncate authored accessibility text to mimic upstream. | Pie, GitGraph and Architecture preserve `Full %% text` across our facts and output. Mermaid 12.2 truncates that value to `Full`; syntactic acceptance of our output does not mean another renderer preserves the same accessibility value. |
| BUG-57: Quadrant `"A" B` and `a ---> b` | **Keep ours silently.** Text surrounding a quoted fragment stays literal, and an extra dash before our `-->` delimiter stays in the left label. | This is a documented interpretation difference, not a demonstrated defect: ours reads `"A" B` and left label `a -`; both canonical outputs are accepted by 12.2, and our bodies, facts, SVG and terminal output are identical after reload. Upstream reading different label characters alone does not justify a change. |
| BUG-59: sanitizer tags, literal Sankey/Radar, Journey `<br>` | **Keep explicit local display policies silently.** Do not copy upstream sanitizer output or require a literal/formatted policy merely for parity. | The shared display/prepared-text path is in place. Source/display codec defects remain under CONS-46/#372; break-only Journey admission is BUG-47/#367. These real defects are separate from the decision to retain our formatting policy. |

### B. Generous reads and deliberate refusals

| Original item | Decision | Implementation at the historical baseline |
| --- | --- | --- |
| BUG-18: Flowchart `cleanupText` rewrite | **Keep reading and warn; abandon the historical rejection patch.** Write `<` safely in the affected label context. | The witness `A -->\|"<a="\| B["b"] --> C` draws and exports portably using `#lt;`, but its portability warning is missing. CONS-46/#372 item 3 owns this text-context warning, using the existing Flowchart warning path. |
| BUG-36: out-of-range `linkStyle` | **Keep reading and warn.** A forward reference can style its eventual edge; an index with no edge has no effect. | Implemented. Canonical output writes existing indices after their edges and omits nonexistent indices. |
| BUG-39: `A--a --> A--a` | **Keep rejection.** The intended IDs and link text are ambiguous. | Rejected with a grammar diagnostic. No parity fix is needed. |
| Flowchart `"` after other shape text, across lines | **Keep reading and warn (`flowchart_unclosed_quote`).** | Implemented: in shape text a `"` that does not start the text is text, as on one line, so `A[x "` followed by `y]` reads the label `x "⏎y`, where Mermaid rejects a string opened mid-label. A `&quot;` that the render path decodes joins lines as the authored entity does. Not covered: an entity at the very start of a label (`A[&quot;x⏎y]`), which the render path decodes before joining lines and then rejects (`RENDER_FAILED`), while the typed body reads it as Mermaid does. |
| Flowchart subgraph title that no later line closes | **Keep the statements after it.** | Implemented: an `id[…`, `"…` or `id["…` title runs on only when the first later line holding one of its delimiters closes it with nothing after but `;`. Otherwise its line ends there and the title is the rest of that line (`S[Stage one`), where Mermaid rejects the diagram. A later line such as `more"` after `subgraph X "title` is then the node `more"`, as Mermaid's node string reads it. No warning yet. |
| Flowchart ids listed alone in a subgraph body | **Keep the listing.** | Implemented: a statement of node ids alone (`a`, `a & b`, `a:::c`) lists them in its subgraph, as Mermaid's nested-subgraph spec reads it. A node no subgraph has listed yet joins it, and a subgraph id listed this way nests in the first lister to close when it is top-level, also when declared later. A link endpoint still claims only a node it creates, so `b --> B` inside A moves neither b nor subgraph B into A, where Mermaid moves both (subgraph.spec.js "nested subgraphs 1/3"). A subgraph declared inside another stays there when a sibling lists it, where Mermaid moves it to the first lister to close, and two subgraphs that list each other nest once, where Mermaid makes each the other's parent. |
| Flowchart subgraph without an id | **Generate an identifier from the title silently.** | Implemented: ours derives an id from the title: whitespace, a markup tag and a line break become `_`, and other punctuation is dropped (`a b`→`a_b`, `a<br>b`→`a_b`, `**Two**`→`Two`), made unique against authored ids and written as `subgraph a_b[…]`. Mermaid names it `subGraphN` when the title holds whitespace, and otherwise uses the title text (`a<br>b`, `**Two**`). A title holding whitespace or a line break names no group, so each such block is a group of its own (`a_b`, then `a_b_2`), as Mermaid's `subGraph0`, `subGraph1` are. A title without whitespace names one group, and its repeats merge, as Mermaid's title-as-id does. |
| Flowchart link with a start marker unlike its end | **Keep both markers silently.** | Implemented: ours reads the start marker of `x--o`, `x-.-o`, `x==o`, `<--x` and `<-.-x` as written. Mermaid keeps only the end marker: `x--o` is a circle end of length 2, and `x==o` a solid link of length 2. Our writer writes them as read, and Mermaid reads that output as it reads the source. An `x`/`o` start before an arrow end (`x-->`, `x-.->`, `x==>`) stays rejected; Mermaid drops the `x`, and reads `x==>` as a solid link of length 2. |
| Flowchart node ids | **Read them as Mermaid's node string does, with three exceptions.** | Implemented: letters and digits of any script, `_`, `` !"#$%&'*+.`?\/ ``, `:` (not `:::`) and a `-` that no `-` or `.` follows make one id, so `A.B`, `A&B`, `1.5` and `` C`" `` are single nodes. Exceptions: Mermaid's `A,B` is one id, which ours rejects because `style` and `class` read `,` as a list separator; a letter outside ASCII before `"` or `.` is id text in ours, where Mermaid's UNICODE_TEXT token ends there; and a subgraph id keeps the identifier rule (`subgraph a.b` gets the generated id `ab`, where Mermaid's is `a.b`). |
| Flowchart subgraph with no `end` | **Keep reading and warn (`flowchart_unclosed_subgraph`).** | Implemented: a subgraph still open at the end of the source closes there and holds what follows it; the writer writes its `end`. Mermaid rejects the diagram. |
| Flowchart `end` with no subgraph open | **Keep reading and warn (`flowchart_stray_end`).** | Implemented: the stray `end` is ignored, and a statement after it on its line (`end B --> C`) is read. Mermaid rejects both. |
| Mindmap accessibility directives | **Read them as the accessible title and description and warn (`mindmap_accessibility`); write them as written.** | Implemented: Mermaid 12.2's mindmap grammar has no accessibility statements, so it draws `accTitle: x` under the root as a node, and rejects it before the root as a second root. Authors write it, as in every other family, for the SVG's title, which ours draws. Mermaid has no spelling that keeps it, so the writer keeps the directive before the root, as for ER attributes Mermaid cannot read, and verify says so. |
| Mindmap node text ending in whitespace | **Trim it silently.** | Implemented: Mermaid keeps the space in `root ` (header-line `mindmap root ` or a node line), so its id is `root `. Ours trims the text, as everywhere else, and writes `root`; the space draws nothing. |
| Mindmap shape text holding its own delimiters | **Keep reading and warn (`mindmap_nested_shape_delimiters`); write the text quoted.** | Implemented: Mermaid's NODE lexer state ends a shape at its first closing delimiter, so `root((a (b) c))` or `[text (x)]` is a parse error upstream. Ours reads the text inside the outermost pair when the delimiters in it pair up and it holds no quote, and writes `root(("a (b) c"))`. Unpaired delimiters (`root[The root]ot]`, `a(x)(y)`) or a quote (`root[a "b" (c)]`) are rejected, as upstream, as is a node id or plain node text holding `( [ ) { }` or a line break. |
| Mindmap blank line or trailing whitespace after the header | **Keep reading and warn (`mindmap_space_after_header`).** | Implemented: Mermaid's lexer reads whitespace ending the `mindmap` line, or a blank line after it, with the line break as one SPACELINE token its grammar accepts there only before another line break, so `mindmap⏎⏎  root` and `mindmap ⏎  root` are parse errors upstream (CRLF is not the cause). A `%%` line takes the blank lines before it with it, so `mindmap⏎⏎%% c⏎  root` is accepted. Ours ignores the space, reports it on the header's line, and writes none. |
| Flowchart metadata spacing and mixed-stroke arrows | **Keep reading and warn.** Canonicalize the clear metadata attachment or labelled link. | Implemented for `A @{...}`, `A@ {...}` and `A -- b ==> B`: named warnings, portable output and stable facts. A label that runs onto later lines closes the same way: `A -- b`, `C ==> D`, `E --> F` on three lines is A==>D labelled `b`/`C` and then E→F, with `flowchart_mixed_link_label`, where Mermaid reads one edge A→F labelled with all the text between. |
| ER keyword spelled as an entity name | **Keep reading and warn (`er_keyword_name`); write the name quoted.** | Implemented: Mermaid's ER lexer reads `end`, `subgraph`, `style`, `class`, the cardinality words (`one`, `many`, `to`) and the parent marker `u-` before a name, so it rejects them bare. Ours reads the evident entity, warns, and quotes the name (and any name Mermaid would split, such as `2px`) on output, which Mermaid reads as that one name. A stray `end` after a misspelled `subgraph` therefore warns rather than drawing silently. |
| C4 statements sharing a line | **Keep reading and warn; preserve the authored layout.** | Implemented: pinned Mermaid C4 needs a line break after each statement and after a boundary's `{` (only `}` may share the line before it), and its comment rule takes the line break after a comment. Ours reads `System_Boundary(b, "B") { Person(a, "A") }`, juxtaposed statements and a statement followed by a comment and another line, and reports each as it already reported `;` separators. The C4 writer preserves authored source byte for byte, so that output is still rejected by 12.2, as for `;`. |
| `;` between State statements | **Keep reading and warn (`state_semicolon_separator`).** | Implemented: Mermaid reads the `;` into a name (`A --> B; B --> C` is a state `B;`) and rejects it after the header; ours ends the statement there, as requested upstream (mermaid-js/mermaid#5410), and writes one statement per line. Text after a description or transition colon keeps its `;`, as before; Mermaid ends that text at `;`, at `::` and at a final `:`, so ours writes those as `#59;` and `#58;`, which Mermaid reads back as the text. The source form is not reported. |
| State `}` right after a name, a `}` that closes nothing, and a blank line between `state X` and `{` | **Keep reading; warn for the brace (`state_brace_after_name`, `state_brace_unopened`).** | Implemented: Mermaid reads `A}` as a name, and the rest of the line after `state "…" as` (`A }` too), and inside a composite then rejects it as unclosed; at the top level it draws a state named `A}`, and a lone `}` that closes nothing is a state named `}`. Ours drops a `}` that closes nothing on every surface (the typed body used to go opaque). Mermaid also rejects a blank line before a `{` on its own line (a comment line is fine). Ours closes the composite and takes the `{`, and writes portable output. The blank line is not yet reported: the reader sees comment lines and blank lines alike. |
| State text after `state "…" as X` | **Read `: text` as X's description and `:::c` as its class, and warn (`state_alias_suffix`).** | Implemented: Mermaid takes the rest of the line as the name and splits it at every `:`. `state "x" as A : desc` declares A with title x and description desc, as `A : desc` does; `:::hot` gives an empty description and no class upstream, and `: d1 : d2` drops `: d2`. Ours keeps both and writes `class A hot`. A `{` after the description stays rejected. |
| State `state X` without a block, and words after it on its line | **Declare X and read the rest of the line as statements; warn (`state_statements_share_line`).** | Implemented: Mermaid's builder skips a bare `state X`, and its lexer reads every later word on the line as another dropped declaration (`state a [*] --> P` loses the transition). Its keywords are case-insensitive, and so are ours: `Small State 2` is `Small` and a declaration of `2`, which ours keeps. A `State` in any case but lower that starts no declaration, or that a transition or description follows (`State --> A`, `Small State 2ate1 --> B`), stays a name; Mermaid reads a dropped declaration there. |
| State `[*]` per transition | **Keep one start or end circle per transition, silently.** | Implemented: Mermaid merges each scope's `[*]` starts into one node and its ends into another. The writer keeps each transition as written. |
| Several descriptions of one State | **Show every description as a line of the label, silently.** | Implemented: Mermaid draws the first as a title and the others below a divider. Ours writes `state "x<br/>desc" as A`, which Mermaid draws without the divider. |
| A State composite mentioned outside its block | **The composite's block decides where it is; a mention adds nothing.** | Implemented: Mermaid nests a composite in the scope that first mentions it, and `state X { X }` makes X its own parent. Mermaid rejects a composite with more than one label or description; ours joins them into the label and warns (`state_composite_description`). A composite's classes' classDef paint is drawn on its body, outline and title, as Mermaid's cluster CSS draws it; its `style` paint is kept and written but not drawn, as Mermaid's composite shape draws none. |
| State `A:::c` outside a transition | **Keep the class silently.** | Implemented: Mermaid's builder passes no classes for a state statement, so `A:::hot` alone (also with blanks around `:::`, after `as`, or before `: text`) colours nothing upstream, while `class A hot` and `A:::hot --> B` do; ours keeps the class, and the description after it. Inside a composite Mermaid also drops the class of a state in a transition (`A:::hot --> B`); ours keeps it and writes `class A hot`, which Mermaid applies. |
| A State named only by `class` or `style` | **Draw it silently.** | Implemented: Mermaid draws nothing for a state that only a `class` or `style` statement names. |
| State ids Mermaid cannot read alone | **Write `state "X" as X`; write a transition naming one as authored.** | Implemented: Mermaid reads no hyphen in a name, takes `note`, `class`, `classDef`, `style`, `default`, `click`, `href`, `scale`, `stateDiagram` or `state` (any case) as its own statement, and drops a bare `state X`. A state declared with nothing else is written `state "X" as X`, which Mermaid draws and ours reads back as the bare declaration. A transition endpoint has no other spelling, so output with a transition naming such an id is rejected upstream (`state --> A` is a dropped declaration); verify reports such a transition (`state_endpoint_name`). |
| State `state "L" as X <<fork>>` or `[[fork]]` | **Declare the fork X with the label L, which is not drawn; warn (`state_pseudostate_label`).** | Implemented: Mermaid's fork rule takes everything before `<<fork>>` or `[[fork]]` as the name, so the fork is named `"L" as X` upstream and no transition can reach it. Ours reads the alias as for any state. `[[fork]]`, `[[join]]` and `[[choice]]` read as their `<<…>>` forms and are written so. |
| State `cssClass` and `linkStyle` | **Read them as paint, and warn (`state_css_class`, `state_link_style`).** | Implemented: Mermaid 12.2's State grammar has neither: `cssClass A hot` is three states upstream, and `linkStyle 0 stroke:#f00` the states `linkStyle`, `0` and `stroke`. Ours reads them as paint and writes `class A hot`; the writer's `linkStyle` lines for transition paint are read by Mermaid as states. |
| State name after `as` holding a space | **Keep rejection.** | Mermaid reads the rest of the line after `state "…" as` as one name (`X Y`), which no transition can refer to. Ours cannot hold such a name, so the source stays opaque and is not drawn, and the renderer says why. `state X as Y`, which Mermaid rejects, is rejected too. |
| Class style-class assignment forms | **Keep the style class and warn (`class_style_assignment`, `class_css_class_before_class`); write `cssClass "A" c`.** | Implemented: Mermaid reads `class A c` as one class named `Ac`, rejects an unquoted `cssClass A c` and `A:::c` on a line of its own, and applies `cssClass "A" c` only to a class declared before it. Ours reads each as style class `c` on `A`, whatever the order, warns where Mermaid reads the source otherwise, declares no class for a cssClass (as Mermaid), reads a quoted cssClass's ids as written (`"my class"`), and writes `cssClass "A" c` after the class, which Mermaid reads as written. |
| Class `:::style` before an inline annotation | **Keep reading and warn (`class_style_before_annotation`).** | Implemented: Mermaid takes `:::c` only before a body (`class A:::c { <<interface>> }`) and rejects `class A:::c <<interface>>`, with or without a body. Ours keeps the style class and the annotation in both forms. |
| Class statement after a block's `}` on its line | **Keep reading and warn (`class_statement_after_class_close`, `class_statement_after_namespace_close`).** | Implemented: Mermaid reads only braces after a class or namespace block's `}` on its line. Ours reads `class A {+x} class B` and `namespace N {⏎class A⏎} class B` as the two statements they hold, and writes them on separate lines. |
| State `}` ending the last description or label, and a composite never closed | **Read the brace and warn (`state_brace_after_description`); reject a composite never closed (`state_composite_unclosed`).** | Implemented: Mermaid reads `}` into a description (`state X { A : desc }` labels A `desc }`) and rejects the composite left open. Ours closes X with that `}` when it ends the source's last statement, nothing else closes X and the text did not open it, and writes the `}` on its own line. A composite never closed at all is rejected on every surface, as by Mermaid, since nothing says where it ends; the renderer used to draw its members without it. |
| Class link URL or tooltip, or a backtick name, across lines | **Keep rejection.** | A URL, a plain-text tooltip or a class identity cannot hold a line break. |
| Gantt `click` whose `href` or `call` follows a blank or comment line | **Keep reading; not reported.** | Implemented: Mermaid's `click` state takes the line break before `href`/`call`, as ours now does, but rejects a blank or comment line between them. The renderer's normalized lines drop those lines before the reader sees them and the typed body agrees with it; the output keeps the authored lines, so Mermaid rejects it as it rejected the input. |
| Gantt and timeline bare word on the header line | **Keep it a diagnosed header suffix.** | Implemented: Mermaid reads a statement written on the header line of most families (`gantt dateFormat …`, `pie "a": 1`, `gitGraph LR: commit`, `radar-beta axis a, b`), and so do we. A bare word such as `gantt LR` or `timeline TB` is a task (rejected) or a period upstream; ours keeps it a header suffix, preserved and warned, since it is more likely a mistyped option. |
| BUG-54: Quadrant keywords and semicolons in text | **Keep reading and warn; write labels with grammar-aware quoting.** | Open: `x-axis title`, `quadrant-1 title` and `A;B: [0.3, 0.4]` draw but lack the portability warning and are written back in rejected form. This is a Quadrant codec/export defect, not a reason to reject clear labels on read. |
| BUG-58: Quadrant functional colors, variables, unknown keys and fractional radius | **Keep clear, safe reads and warn; refuse structured authoring/export when no meaning-preserving portable spelling exists.** See the bounded export choice below. | Open: RGB/HSL/`var()` and fractional radii draw but lack portability warnings and serialize in rejected form. Unknown style keys warn and remain inert locally, but their structured output is also rejected by 12.2. Tests at this baseline that call unknown keys upstream-valid are stale under 12.2. |
| Quadrant unquoted `<>()[]{}\|@^~` | **Keep reading and warn; quote canonical text.** | Implemented for the tested forms. A literal quote that cannot be represented safely must remain outside structured authoring. |
| Class bare header and comments after declarations/namespaces/braces | **Keep reading and warn.** Preserve empty diagrams as empty; never invent a class to satisfy an upstream grammar floor. | Trailing comments canonicalize portably. Bare `classDiagram` is renderable, structured and warns, but the empty canonical output remains rejected by 12.2. Record this empty-diagram export limitation explicitly; no runtime change is implied by this disposition. |
| BUG-55: Class comment edge cases | **Apply the comment rule in its grammar context.** Keep comments after statements as generous reads with warnings; keep `%%` that is member or relation-label text as content. | Statement handling is implemented. PR #410 adds member admission guards for comments, init/accessibility directives and decoded line controls, preserving real members such as `+accTitle: String`. It does not make all Class source segment-editable; SRC-1 remains separate. |
| Architecture titles, dotted icons and edge-dash IDs | **Accept current grammar titles; keep other clear extensions with warnings.** Do not silently rename IDs or replace an icon to make output portable. | `[Café]`, `[Edge-Layer]`, break markup and title punctuation are accepted by 12.2 and have no rejection warning. Dotted icons and IDs such as `api-` still draw and warn, but their structured writer emits rejected source. Their export/admission boundary remains a family-reader follow-up. |
| ER trailing comments and escaped/empty quoted names | **Keep clear reads and warn; encode portable quoted text.** Empty entity names remain source-only when the typed identity model cannot preserve them safely. | Implemented for trailing comments, escaped quotes, backslashes and `%`: output uses entity encoding and parses upstream. Empty quoted names remain opaque and preserve their source, which is still upstream-invalid. |
| Sequence participant declared in two boxes | **Keep the first box and warn.** Preserve the authored extension instead of changing unrelated source automatically. | Implemented. Box statements are opaque segments inside a Sequence body; serialization preserves the second declaration, so this source is still rejected by 12.2. Do not label that preservation a portable canonical rewrite. |
| BUG-51: Sankey's `parseFloat` leniency | **Keep strict numeric rejection.** `12x` and `x12` do not specify an unambiguous valid flow value. | The reader retains source as opaque and rendering refuses the invalid value. Upstream accepting a prefix or NaN is not a product requirement. |
| Malformed metadata/frontmatter YAML | **Keep rejection.** Do not guess at ambiguous mappings, brackets or tags. | Implemented. The 12.2 scalar rules are current; valid scalar compatibility and the BUG-60 writer round-trip are distinct from malformed-input rejection. |

#### Bounded portable-output choice for extensions

Use the existing structured-or-opaque boundary rather than introduce a second
serializer framework. A newly supplied typed value must have a proven portable
spelling. A readable existing extension without such a spelling stays
source-preserved, carries the portability warning and is refused for any typed
edit that would require regenerating it. This is the chosen boundary, not a
claim that all the admission checks already exist.

For Quadrant styles, portable hexadecimal colors and supported integer radii
are the initial strict-authoring subset. Do not round a fractional radius,
resolve `var(--brand)` against the current page, or drop an unknown property.
Keep these source-only until an exact portable representation is available.
RGB/HSL may later be canonicalized to a supported hexadecimal color only when
conversion preserves the complete color, including alpha, and our semantic
reload contract is tested; a new conversion mechanism is not required to finish
this disposition. Until then, use the same explicit refusal/source-preservation
boundary. The generous renderer may continue to draw valid functional colors.

Apply the same rule to unsupported Architecture IDs/icons. A warning alone is
not sufficient to claim portable structured output. Empty Class output remains
an explicitly reported empty-family limitation; do not add fake entities or
accessibility text to conceal it.

### C. Previously rejected accepted source

| Original item | Decision | Implementation at the historical baseline |
| --- | --- | --- |
| BUG-34: Gantt task with trailing `%%` | **Keep the authored task duration; read and warn about the upstream quirk.** Do not copy a zero-length task caused by comment text entering upstream scheduling. | Implemented. `Task :a, 2024-01-01, 1d %% c` draws a one-day task and emits `gantt_inline_task_comment`; the writer separates `%% c` onto its own line and produces portable source. |
| BUG-56: Class style comment | **Accept the source and classify the comment before CSS validation.** | Open: `style A fill:#f00 %% c` is structured but rendering rejects `#f00 %% c` as a color. This is a Class reader/style-context defect. |
| BUG-56: Class `A()--B` | **Accept the native lollipop relationship.** | Fixed by merged PR #410: typed, rendered with authored endpoints, editable and portably serialized. The old rejection comparison is obsolete. |
| BUG-56: `classDiagram-v2` | **Accept the supported-family header alias.** | Deferred reader/routing gap: upstream accepts it; ours classifies it as a preserved upstream family and refuses native rendering. Source survives; native support must not be claimed. |
| BUG-56: Quadrant empty far-axis label | **Accept the explicit empty far label.** | Deferred reader gap: `x-axis a -->` is opaque and native rendering throws. Preserve source until implemented. |
| BUG-56: Quadrant semicolon-separated points | **Accept statement separators outside label quotes.** | Deferred reader gap: `A: [0.1, 0.2]; B: [0.3, 0.4]` is opaque and fails rendering. Do not implement this by splitting semicolons inside quoted labels. |
| BUG-56: Architecture extra text and declaration spacing | **Accept the grammar's declaration components and spacing at the shared reader.** | Deferred reader gaps: `service a "text"[A]` and `service a (server) [A]` remain opaque and fail rendering. The 12.2 title-punctuation upgrade did not fix these forms. |

### Implementation after the historical baseline

The table above records the historical baseline. The changes below are
implemented in the current candidates; final combined checks and merge remain
pending. Source completion is separate from npm publication and hosted delivery.

- [PR #418](https://github.com/adewale/agentic-mermaid/pull/418) supplies ER order
  preservation after grouped edits (BUG-10/#372) and #367's Journey break-only
  labels, renderable empty edits and YAML scalar/wrapper preservation
  (BUG-47/52/60). The footer follow-up is included. #367's terminal wrapping
  already landed in #394; BUG-9 had a passing owning regression at the baseline.
- CONS-46's source implementation is complete in this text candidate. It
  preserves literal entity-derived runs beside authored formatting through
  Flowchart, ER, Sequence and Class, including Sequence aliases/messages/notes
  and Class member/annotation metrics. The Flowchart preprocessor warning and
  State/Mindmap `%%` context fixes are implemented. Source strings and display
  strings need not be identical, but projections and reload preserve their
  intended meaning. The Flowchart rejection proposal is declined in favor of
  reading clear intent and warning about portability.
- Inside a State block note, a whole line beginning with `%%` remains literal
  note content. Mermaid 12.2 accepts that source but drops the line; keeping the
  authored text is an intentional divergence. Actual comments outside text
  contexts retain their comment behavior. Mindmap's existing accessibility
  extension policy is unchanged.
- Completing #372 requires both PR #418's ER implementation and this text
  candidate to be integrated and verified. The wholesale serializer WIP is
  superseded. Final CI and merge are tracked under REL-1, rather than keeping
  implemented defects in the active backlog.
- CONS-44 is implemented in separate, unmerged
  [PR #416](https://github.com/adewale/agentic-mermaid/pull/416), with family-owned
  config diagnostic hooks and transport schemas projected from existing
  contracts, including native C4's diagnostic hook. Final-head checks are
  recorded in the PR; merge remains pending. It is not a dependency of
  CONS-46 or of completing these grammar dispositions.

The #363 investigation is complete independently of those runtime delivery
steps: every original item has a decision and a recorded implementation status.
Closing the investigation does not assert that every reader/export gap is fixed.

Original BUG-54/56/58 remain the references for the Quadrant portability and
Class/Quadrant/Architecture reader gaps in the tables. Architecture ID/icon
exports and the empty-Class spelling remain explicit limits. BUG-57 is a
consistent local reading, not a remaining defect. No new issues or parity-only
work are implied by these decisions.

### Preexisting Sequence terminal limit

This combined box/fragment witness omits `Header` and `Divider` from terminal
ink, while SVG contains them. The terminal output was byte-identical at local
base `594b26cd` and during the text-codec work. Entity-encoded literal tags of
the same widths also trigger it; shorter box/fragment examples may work.

```text
sequenceDiagram
title [b]Title[/b]
box transparent [b]Box[/b]
participant A@{ "type": "boundary" } as [b]Alias[/b]
participant B
end
autonumber
alt [b]Header[/b]
A->>B: [b]Message[/b]
Note over A: [b]Note[/b]
else [b]Divider[/b]
B->>A: done
end
```

This is a known terminal geometry limitation under CONS-45 and qualifies release
claims. Separate box and fragment codec tests establish their text handling,
not the geometry of their composition. CONS-46 does not claim to fix it.

## Important fixed issues worth remembering

These are retained only because they explain guardrails that may otherwise look excessive:

- **Opaque fidelity:** opaque bodies serialize from preserved `body.source`, not normalized `canonicalSource`, so indentation/comments/source text survive parse → serialize.
- **`am parse | am serialize`:** JSON payloads preserve flowchart styling maps and defensively normalize loose SDK-shaped subgraphs.
- **Subgraph payload hardening:** `synthesizeFromGraph` tolerates missing `children`, null entries, cyclic references, non-tuple map arrays, and non-integer linkStyle keys.
- **Timeline mutation:** timeline edits update `canonicalSource`, validate mutation text, allocate unique IDs, and fall back to opaque for header-suffix/lossy syntax.
- **Shared routing cleanup:** SVG, ASCII, and agent parsing use shared diagram-family detection from `src/mermaid-source.ts`; agent parsing adds only a loose known-family path so malformed known headers can round-trip as opaque.
- **Source-based `LABEL_OVERFLOW`:** verification checks labels for opaque/source-level families via family label extractors, so fallback does not mean "unverified."

## Evidence and limits

What the current suite demonstrates:

- typed mutation works for the exposed structured families;
- unsupported/opaque/source-level bodies refuse structured mutation instead of losing source;
- verify-before-serialize and Code Mode trace linting catch key agent anti-patterns;
- corpus gates cover Mermaid docs examples and MermaidSeqBench round-trip stability;
- docs/capabilities/CLI/MCP declarations are checked for consistency.

What it does **not** yet prove:

- market demand;
- that a real external consumer likes the API;
- that a selected release model follows the intended loop from docs alone.

Those validation items remain in `TODO.md`.
