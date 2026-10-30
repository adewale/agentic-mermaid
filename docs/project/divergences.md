# Divergences

Current implementation decisions that differ from, or materially narrow, the broader `AGENT_NATIVE.md` architecture. This file is **not** a backlog; active work lives only in `TODO.md`. Historical loop logs were removed because they had become process noise. Use Git history for archaeology.

## What still matters

### Grammar finder triage (#461)

The triage covers all 1,283 distinct inputs retained in four linked workflow
summaries: 605 reduced and 678 original inputs across 23 families. These are
retained representatives, not every finder mutation. Silent-read counts are
not defect counts; invisible separators, header aliases and unwitnessed
mutations do not receive blanket warnings.

Grammar tokens, authored identities, formatting and literal text are separate
layers. Writers construct complete field tokens before joining statements;
readers classify syntax before expanding grammar escapes. The field repairs
cover Timeline keywords/separators, Sequence ACTOR identities, C4 arguments,
Gantt task labels, Block formatting, Journey actors and separators, Mindmap
anonymous identities, Ishikawa cause labels and Treemap quoted text.

The #494 follow-up examines its 162 reduced reports and their 162 original
witnesses. Readable aliases, Unicode whitespace, compact statements, comments,
leading-dot numbers, native-only identifiers and empty containers are not
missing rendering features. Their intended readings are retained; no blanket
warning is added merely because a fuzzer found another spelling. Class-header
aliases and Quadrant statement separators were fixed separately in #505.

Empty State notes and accessibility descriptions retain explicit empty fields
using block syntax. C4 raw statement reuse must satisfy its argument lexer;
otherwise the field writer constructs quotes and separators. Sequence writers
shield literal percent pairs and terminate a participant declaration when the
next message would be read as metadata. Placement keywords cannot become typed
message endpoints. State class assignments to non-word targets remain
source-only, with a warning and atomic refusal of typed class edits.

An init-directive opener inside ordinary accessibility text remains source-only
and warns: its current authored-text representation cannot add a protective
escape without changing the reloaded field. Comment-backed accessibility keeps
its existing JSON transport. Invalid or unusually delimited YAML wrappers can
remain verbatim on default export; canonical wrapper mode repairs those whose
metadata and configuration can be represented. Source-preserving output is not
a promise of external Mermaid acceptance.

Journey, Mindmap, Ishikawa and Treemap share grammar escape interpretation. XML
transport references expand inside classified fields, before formatting;
protected grammar escapes expand afterward, once. This prevents an encoded
separator from becoming a statement and distinguishes a source `&lt;` from an
edit that literally supplies `&lt;`. Native SVG/terminal consumers use the
retained authored grammar view rather than decoding that field twice.
Accessibility values retain the same distinction through body, metadata and
SVG title/description emission. Treemap newlines retain their text separately
from literal `<br/>` and entity-looking strings.

Gantt owns its effective axis format as a typed value. The statement lexer
cannot hold a hash, semicolon or physical newline, so the writer uses Mermaid's
configuration string for those formats without interpreting the calendar
format as a display label. Canonical wrappers retain family-generated config.
Grammar-classified Gantt and Sequence comments protect a directive-looking
opener instead of emitting it as an init directive.

C4 empty boundaries are portable. An empty block contains
`UpdateLayoutConfig("")`, which the pinned database treats as a no-op: neither
layout assignment passes its positive-value guard. It creates no child and
retains previously configured layout values. The reader treats that spelling
as trivia; incremental construction and removal of a final child no longer
need a Mermaid-rejected draft exception.

C4 portability includes the database argument contract, not just lexer
acceptance. Required aliases, labels, endpoints and style targets are emitted
positionally. Layout values occupy their declared positions even when the
input uses reordered or sparse names, because the pinned database ignores
those names. Missing layout values use an empty positional no-op. Zero-argument
layout calls are retained as no-op trivia with a warning and export with the
attribute the grammar requires. These pre-existing writer defects were found
by checking successful constructors against actual database values.

Mindmap serialization preserves the node's explicit Markdown syntax flag.
HTML formatting tags do not imply Markdown syntax: converting them changed
the body on reload and caused unrelated icon, class and accessibility edits
to fail. HTML and Markdown siblings now retain their respective modes and
literal stars through native rendering, export and typed edits. Mindmap
accessibility remains a warned native extension because the pinned grammar
has no accessibility production.

Floating State notes retain main's independent annotation namespace, containing
scope and collision-safe rendered IDs. A note alias does not introduce or
rename an ordinary state with the same name. All four imported floating-note
cases already render on base `9b64b5f4`; they are controls, not gains attributed
to this change. Mermaid's pinned grammar accepts the declaration but drops its
semantic action; retaining the note is intentional.

Block terminal cards reserve actual face demand before routing, growing
monotonically until allocated ports fit. Nested grid gutters derive from the
router's protected approach distance and retain a free channel. Shared terminal
faces reserve distinct contacts when marker meanings conflict; compound or
parallel classification alone cannot establish safety. Reciprocal/parallel
Block edges and cross-scope State edges are checked against actual owned
stroke/marker ink and frame contacts, independently of stored endpoint metadata.
Contact conflicts close over the affected routes locally. Compatible bundles
elsewhere retain their shared trunks. The terminal router still has bounded
search and can refuse a layout when it cannot certify protected approaches;
successful local contact allocation is not a proof for every later route cell.

Style construction follows each family's grammar and consumer. Flowchart
class definitions protect value commas and separate a trailing backslash from
the following declaration; its direct node/link styles have no equivalent
comma consumer. Functional CSS remains native-readable but source-only when
Flowchart or Requirement cannot spell it losslessly. Their typed writes refuse
unsupported values atomically, while native CSS validity stays independent.

Class and State protect style payload delimiters with entity codes. The writer
keeps exact RGB/HSL channel spelling, comma-valued fonts, quoted CSS strings and
literal entity/marker text. Encoding direction-like payloads protects the
complete statement from earlier lexer productions. Colon-space barriers prevent
one field from activating the global entity prepass against another.
Class memberships precede definitions because its pinned DB copies styles
eagerly; inline overrides follow definitions. An empty ordinary CSS declaration
opens the Class lexer when needed without setting paint or reordering fields.
Inline styles also require an ALPHA target even when declarations can name a
quoted identity. State label edits clear the mutually exclusive bare-declaration
flag; removing a label restores it.

The approach takes lexer-state ideas from
[Pele 1.10.0](https://github.com/obsidianmd/pele/tree/4eff76f98c73b6817800a05773517f35832e4e92),
which targets Mermaid 12.1.0. Emitted syntax is checked against Mermaid 12.2.0,
source `1fb7869866dd619168d840291c9c54b4f129758b`; Pele is not a dependency.
The unit oracle and modern reference both run Node/jsdom with actual
DOMPurify and public wrapper preprocessing. DB projections retain parent
fields and explicit cyclic references, with no arbitrary depth truncation.
The unit helper requires the development-only jsdom 26.1.0 dependency.

Real sanitization exposed previously hidden reference assumptions: Pie titles
normalize `<br/>` to `<br>`, Class annotation/label text can be removed or
rewritten, and Flowchart labels can be erased. Native output retains authored
text where that behavior loses meaning. The Flowchart grammar property
observes operands to real builder methods and still calls each original
method, including its sanitizer; it is a grammar contract, not equality with
lossy sanitized HTML. Separate modern tests inspect the public runtime. These
reference corrections are not additional native syntax capabilities.

The merged #490 public-parser replay against main `9b64b5f42a8260696052f8218fccfacd8ae44b80`
increases accepted typed canonical exports from 755 to 962: **207 additional
inputs across 17 families**, with no acceptance regressions and no remaining
crashes. This replaces the earlier comparison against `09425754`; changes
already merged into main receive no credit here. All 207 gains reload as typed
bodies. Facts match for 206; one wide Block spacer normalizes generated
occurrence names while retaining its two cells and authored nodes/endpoints.

The output audit compares raw source, typed rendering and exported source.
ASCII is identical in 206/207 cases; SVG strings are identical in 203/207.
Four SVGs differ only in equivalent numeric/`px` stroke widths and generated
metadata. One State serializer reorders declarations: SVG is identical, while
a disconnected state and pseudostate exchange terminal positions. Its labels,
identities, parents and endpoints are unchanged. Canonical serialization does
not preserve every layout-sensitive declaration order.

The historical #490 candidate has 992 typed inputs, 250 source-only inputs and 41 explicit parse
failures. These counts precede #499, whose same-corpus replay has 1,051 typed
inputs, 191 source-only inputs and 41 parse failures; accepted typed canonical
exports rise from 962 to 1,020. Neither comparison credits additional imported
upstream test passes. No reference-accepted retained input loses typed admission. The historical 250
source-only inputs retain family statements and cannot accept typed edits,
including edits to portable portions. One Radar input loses only adjacent empty
frontmatter delimiters under the existing warned `empty_frontmatter` policy.
Source preservation is not a portability certificate. Invalid identifiers and
unknown statement structure are not silently renamed or discarded to create a
portable typed result.

Timeline sections retain the latest period: a same-line event after a section
belongs to that period in its earlier section. Without a prior period, the
reader rejects the orphan event instead of inventing a period. An explicit
empty trimmed section is typed and editable. Its constructor preserves the two
blank characters required by the SECTION token, including at EOF; normalization
does not trim away that grammar distinction.

All emitted typed canonical documents in the replay are reference-accepted.
Thirty typed inputs and one source-only Mindmap input have malformed init
payloads or invalid theme configuration; canonical export rejects them with a
repair message. The follow-up replaces the handwritten admission guard with the actual pure
pinned merge, sanitizer, appearance and theme programs. Raw YAML metadata and
config stay distinct; raw directive kind, scope and order survive canonical
export. Multiple init layers are not flattened, and wrap does not increment the
init count. Every evaluation gets fresh defaults and state. Its 100000-loop
work limit is a host validation bound, not a claim of pinned rejection. Another 28 typed documents need canonical wrapper mode to repair their
verbatim wrapper spelling. Three GitGraph bodies require their configured main
branch; their complete documents pass.

Accessibility descriptions normalize physical CR/CRLF to logical newlines before
refolding. A successful mutation must retain the normalized fields in body,
metadata and reloaded source. Values a family writer cannot spell without
closing a description block or creating a directive return `INVALID_OP`
atomically. Block, Mindmap, Sankey and Ishikawa writers carry accessibility
in owned `%% agentic-mermaid accTitle/accDescr: <JSON string>` comments. Each
JSON string transports an authored grammar-text field, shielding global
entities, XML and init-directive processing before its field decoder runs.
The shared envelope classifies these as metadata rather than ordinary comments.
Native edits, JSON reload and SVG retain the fields; captured YAML stays verbatim.
External Mermaid ignores this metadata while retaining the actual topology, so
verify still reports the family's accessibility warning. Raw accessibility
statements remain generous reads. Pin acceptance of an Ishikawa/Mindmap raw
statement that becomes a node is never credited as metadata support.

State nodes retain the boundary of their standalone declaration among their
owning scope's transitions. Canonical writing merges these recorded events;
contextual start/end nodes remain at the transition that creates them. Edits
retain or rebase boundaries, with one survivor-prefix map for a deletion batch.
Notes that create ordinary states receive a declaration at that boundary.
Stereotypes still precede first use because the external type semantics require
it. Legacy/synthetic bodies without provenance keep a deterministic fallback.
This removes avoidable movement around isolated declarations and contextual
pseudostates. It does not preserve global event order for a detached composite
block that canonical writing relocates into its first owning scope; identities,
parents, endpoints and content remain the contract in that pre-existing case.

Pinned-suite counts, red/green discrimination, the combined adversarial audit,
exact-head CI results and publishing evidence belong in the PR description.
These retained-input counts are separate from upstream test counts and do not
claim complete Mermaid support.

### Practical reader fixes checked against Mermaid 12.2.0

The compatibility follow-up uses named upstream assertions before mutation
counts. It ports the Flowchart block-scalar label, Sequence participant metadata
spacing and GitGraph merge cherry-pick cases from the pinned release. Class
word-like names with hyphens, dots or Unicode and compact Architecture edges
are checked through the independent pinned parser and public parse/edit/write
surfaces. Flowchart metadata keeps physical indentation through graphical,
terminal and structured parsing; unknown metadata still stays source-preserved.

[Pele 1.8.0 at `1dd58b7`](https://github.com/obsidianmd/pele/tree/1dd58b7ebb0ec654fa7dc4304d50cf8fd3a65d7b)
renders the same selected inputs. Its ported parser specs and separate
differential tests are useful peer evidence, not an output or layout oracle.
Community reports establish practical context for
[Class names](https://github.com/mermaid-js/mermaid/issues/3423) and
[picking merge commits](https://github.com/mermaid-js/mermaid/issues/4497);
they are not measurements of current usage frequency. The exact failures and
repairs are asserted against this repository's pinned Mermaid reference.

The generated backtick/directive/entity writer cases remain a separate triage
queue. The 40 witnessed export failures are not 40 distinct bugs, and the
silent-read count is not a reason to add a new warning pass. The follow-up
adds ellipse geometry, service text icons and `par_over` branches. Ellipses
share their painted and routed boundary; literal icons preserve STRING text;
overlay branches share a time origin and join below the longest branch, with
clearance for conflicting ink in each output's units. The pinned parser
checks identities and source semantics; our own geometry assertions check
these placement contracts. Portable extension authoring and the generated
writer failures remain outside this work.

The reader-only browser comparison at `58b4209` against main `297eaaf` measures
Architecture's budgeted Brotli closure at 573,473 → 573,513 bytes and Sankey's
at 177,998 → 178,004. Their ceilings move to the next 500-byte step, 574,000
and 178,500. Request ceilings stay unchanged. Initial transfer is 5,493 bytes
gzip (5,494 on the base); this is a measured cost accounting, not a size win.

Adding the three features at `eb3221d`, compared with the reader-fix revision
`324ddcb`, adds 3 Brotli bytes to Flowchart, 704 to Sequence and 364 to
Architecture's budgeted closures. Initial gzip stays at 5,493 bytes and every
request count stays unchanged. The affected ceilings advance to the next
500-byte step only where measured closures cross them. CI's compression of
XYChart crosses its old Brotli ceiling by 31 bytes; that ceiling moves from
186,000 to 186,500. These byte measurements describe the named revisions,
not a promise that compression remains identical across toolchains.

### Stable-family semantic choices (Mermaid 12.2.0)

Packet keeps each authored inclusive field once and derives row segments from
its exact interval. Pinned Mermaid's internal split-block `bits` metadata can
be off by one; our segment count is always `end - start + 1`. Its visual bit
order and field endpoints remain compatible. The Packet bench records the
specific source and independent reference result.

Kanban retains duplicate authored IDs separately from collision-free public
occurrence IDs, so two cards named `id3` remain independently editable. Icons
without a bundled symbol show their authored name offline. Ticket navigation
uses safe inert action metadata and is disabled under strict hosting; it never
executes a callback or fetches a font/icon pack.

Treemap accepts underscores as numeric separators without truncating the
quantity and emits `UNSUPPORTED_SYNTAX`; canonical edits write plain numbers.
Three upstream parser tests deliberately accept a recovery AST while ignoring
errors for malformed class syntax. Such input remains opaque here rather than
claiming structured support. Sections and leaf identities remain distinct from
value-sorted placement; labels that cannot fit their quantitative cells are
reported, not used to distort the value partition.

Treemap terminal output represents hierarchy and exact values, and Ishikawa
terminal output represents the cause/effect tree. Both advertise that projection
explicitly; neither claims to reproduce the graphical area/fishbone geometry.
Their SVG renderers retain those domain hallmarks.

Mindmap reads a repeated node identity (the same text under two parents, or a
repeated explicit id) as another node, as Mermaid does; Mermaid keys nodes by
an internal counter. Ours gives the first node with an identity that id and
each later one the next free `<identity>#<n>` in document order, keeping the
authored identity as `sourceId` for serialization. Ours rejected repeated
identities as `MINDMAP_DUPLICATE_ID` before; that error is no longer thrown.

Generated occurrence IDs describe the current serialized artifact. Structural
edits normalize the published typed body to the same IDs and order seen by a
fresh parse, source map and renderer. Read the returned IDs before a subsequent
edit; arbitrary durable IDs cannot be encoded by these families' source syntax.

Requirement and Block use local occurrence IDs for generated relationships,
escape editable authored text at rendering, and read request-local config.
Mermaid's private generated-ID spelling, DOMPurify-transformed DB text,
singleton-config timing and generated CSS are implementation details. The
unchanged portable assertions and explicit internal exclusions are retained
beside their exact-pin benches; our identities, safe output and geometry have
separate owning tests.

Requirement preserves whitespace between authored `stroke-dasharray` lengths.
The pinned parser concatenates style tokens, changing a two-length `5 5`
pattern into the single length `55`. The native reader also keeps meaningful
whitespace in font families instead of concatenating `Foo Bar` into `FooBar`.
These sources remain drawable and source-preserved, with a portability warning;
typed writes refuse them atomically. Functional CSS and comma-valued lists
likewise require a supported lossless spelling before typed construction can
succeed. Portable word, hexadecimal and integer values remain editable.

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

### Reopened State composites continue one composite

A later `state A { … }` block adds its states to the one composite A, as Mermaid 12.2 does; the body stays source-preserved. Three readings differ from Mermaid's, each chosen so the drawing keeps what the author wrote, as repeated Flowchart groups keep their first declaration:

- **Placement.** A retains its first established scope: its first reference inside a composite, or its first block if no such reference preceded it. A root reference alone establishes no parent. Mermaid moves A into the composite holding its last nested block, and a block at the top level never moves it back: `state A {…}` followed by `state P { state A {…} }` draws A inside P there and at the top level here.
- **Regions.** A block reopening a composite split by `--` continues its last region. Mermaid draws the reopened states directly in A, beside its regions.
- **Direction.** The first block that sets a `direction` sets A's. Mermaid also keeps the first block's, but ignores a direction set only in a later block, which ours draws. In a composite split by `--`, the later block's direction sets the region it continues, as a direction written after the last `--` does.

Labels follow the rule for a composite mentioned outside its block: a label in a later block, or a description or alias between blocks, labels A, and several are joined into its label and reported (`state_composite_description`), where Mermaid rejects them. A state reopened inside itself is still the author's duplicate identity, which native parsing refuses; the editable API preserves its source as opaque.

### Floating State notes retain their authored content

Mermaid 12.2 accepts `note "text" as N` but drops it from its State database.
We preserve N, its text and its composite or concurrent-region scope as a
floating annotation. A note and a state with the same name remain separate
identities. The typed body, edits, writer, SVG and terminal output retain the
annotation; it participates in layout as a scoped object without an invented
attachment to a state. Serialization uses the accepted quoted-note syntax.

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

### Authored empty Class namespaces remain visible

Mermaid 12.2.0 rejects a namespace with no members. Agentic preserves that clear
authored container as opaque source and draws its measured frame, including in
documents with no classes. It retains the existing portability warning and
source-only edit policy; drawing the frame does not make the source portable.
Freestanding Class notes are accepted by Mermaid and remain visible without
requiring a class or namespace.

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

A warning for a spelling Mermaid rejects or reads otherwise earns its code by
being written. On 20 October 2026, PR #448 measured 106,252 unique real-world
and LLM-written diagrams: Stack Overflow, Hugging Face model and dataset cards,
WildChat and ShareGPT chats, and 14 public LLM datasets. Fixes whose construct
none of them used and which cost about 25 production lines or a runtime pass
were removed; their rows below say "0 of 106,252 real-world diagrams". Fixes
that prevent a crash, lost content, a wrong drawing of used input, duplicate
ids or writer output Mermaid cannot read stay whatever the count. A finder
report is triaged the same way: count the construct in real use before adding
code for it.

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

Universal cleanup is owned by `src/shared/mermaid-cleanup.ts`. Its receipt
keeps exact authored bytes and sparse UTF-16 mappings for line endings, XML
transport decoding, Mermaid's HTML-like attribute quote rewrite, and the
style/classDef semicolon prepass. Parsing normalizes CRLF/lone CR while keeping
wrapper bytes and public source spans authored; rendering also decodes XML
references once. The upstream quote rewrite is recorded rather than applied to
our grammar: it can join unrelated labels or break YAML metadata. Verification
reports `UNSUPPORTED_SYNTAX` / `mermaid_cleanup` once per affected authored line,
including for parsed diagrams, when the rewrite changes what is read: our
reading of the diagram with that kind of rewrite applied differs from our
reading of the authored text. A dropped `;` that only ends a style statement,
on its own row or sharing one (`graph TD;style Q fill:#fff;`), changes nothing;
so do tag attribute quotes inside one Flowchart label, which Mermaid draws as
HTML unless `htmlLabels` is off. Ordinary newline/entity protection needs no
portability warning either. A diagram that mixes harmless and reading-changing
rewrites of one kind reports each line of that kind: one reading per kind keeps
the cost bounded.

`#name;` / `#123;` remain protected through grammar reading and expand through
the shared entity codec only at text projection. They must never create new
quotes, statement delimiters, markup or terminal controls. Pie's authored-key
identity and Class's quote provenance still require grammar-specific views;
those readers consume the shared authored view rather than normalizing the
original document again. Sankey, Requirement and Kanban consume shared payload
views that normalize CRLF once while retaining lone CR for grammar-owned
identities. Their grammars distinguish structural line endings from quoted
names, CSV fields and implicit card IDs; the same view feeds graphical and
terminal rendering. Requirement and Kanban writers protect a stored CR/LF
adjacency from a second normalization when their output is read again. Source
spans still address the complete authored payload, including its original line
endings. Grammar-owned continuation boundaries also keep accessibility-looking
text inside a label from becoming universal metadata.

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
| `;` between style properties | **Read it as CSS does: a separator.** | Implemented for Class, State and ER `style` and `classDef`, and Flowchart `style`, `classDef` and `linkStyle`: Mermaid joins the pairs a `;` separates into one declaration (`style A fill:#f9f;stroke:#0a0` holds `fill:#f9fstroke:#0a0`), which paints nothing; in Flowchart it may instead end the statement and read the next property as a node. Ours reads each property and draws them; the writer separates them with `,`. In Flowchart, text after the `;` stays in the statement only when it is properties alone (no link, `:::`, `&`, metadata, shape text or string), and verify reports `flowchart_style_semicolon`; other text is its own statement, as before. Any name counts as a property, so `style A fill:red;a:b` reads `a:b` into the style and warns, where Mermaid accepts it and draws a node `a:b`. Reading such text as a node unless it names a CSS property was removed: 0 of 106,252 real-world diagrams write it. |
| ER first alias wins | **Keep the first-alias reading silently.** | Implemented: `A["first"]` followed by `A["second"]` retains `first` and writes portable source. |
| ER generic attribute types sharing a line | **Keep each attribute silently.** | Implemented: Mermaid's block lexer reads one type from a line's first `~` to its last, so `Z { List~int~ a List~str~ b }` is one attribute typed `List~int~ a List~str~` upstream. Ours pairs each `~` with the one that closes it, as brackets, so it reads two attributes and still reads `Map~string, List~int~~` as one type; the typed writer puts each attribute on its own line, which Mermaid reads the same way. |
| ER relation labels of several words | **Keep the whole label and warn (`er_label_words`).** | Implemented: Mermaid's label is one token, so `A \|\|--o{ B : places order` is label `places` plus a declared entity `order` upstream (upstream counts such phantom entities a defect, mermaid-js/mermaid#8054). Ours keeps the label `places order`, says Mermaid reads it otherwise, and writes it quoted, which Mermaid reads the same way. A word followed by a quoted name (`x"y"`, the label `x` plus an entity `y` upstream) is read whole too, reported the same way, and written `"x#quot;y#quot;"`. |
| ER lines naming a direction | **Keep the line's statements and warn (`er_direction_line`).** | Implemented: Mermaid's `.*direction\s+TB` lexer rule makes any line holding `direction TB` (BT, LR, RL) a direction statement, dropping the rest of it: `A \|\|--o{ B : direction LR` loses its relationship, and `A direction TB` its entity. Ours reads the relationship, or the entity and the direction, and says Mermaid reads the line otherwise (label text read as a direction is an old upstream bug, mermaid-js/mermaid#17). A run of declarations never reads past `direction TB` (`A direction RL\|\|--\|{ B` stays unsupported). |
| ER attribute keys parted by spaces, or after the comment | **Read them and warn (`er_attribute_form`); write Mermaid's key list.** | Implemented: Mermaid's attribute is `type name [key, key] ["comment"]` and rejects `int id PK FK` and `int id "c" PK`. Ours reads the keys and comment either way, reports the attribute, and writes `int id PK, FK` and `int id PK "c"`. An attribute whose type or name Mermaid cannot read as a word (`--string id`) is reported and kept as written, since Mermaid reads no spelling of it as the same attribute. |
| ER relationship naming a subgraph | **Keep the relationship on the subgraph silently.** | Implemented: Mermaid's docs draw `title1 \|\|--\|\| title2 : links` between two subgraphs, but its ER database also declares an entity for each endpoint, so its model holds entities `title1` and `title2` beside the subgraphs and lists entities and subgraphs in the order its database fills them. Ours attaches the relationship to the subgraph, declares no entity, keeps source order, and writes the relationship as authored. |
| ER names that start with digits | **Keep one name silently.** | Implemented: Mermaid's lexer takes a number before a name, so `2px` declares entities `2` and `px`, and `2.5abc` declares `2.5` and `abc`. Ours reads one entity `2px` or `2.5abc`. |
| Flowchart `x--`/`o--` at the start of a line | **Keep the node silently.** | Implemented: Mermaid's link token takes the whitespace before it, newlines included, and a leading `x` or `o`, so `A --> B` followed by a line `x--> C` loses `x` and draws B→C upstream. Ours reads x→C and writes `x --> C`, which Mermaid reads the same way. |
| Flowchart edge id repeated on a later link | **Read it as Mermaid draws it, and warn (`flowchart_duplicate_edge_id`).** | Implemented: an edge id names one link. A later link repeating it, on another statement, in a chain or in a `&` product, keeps no authored id: Mermaid gives it a generated `L_…` id, ours its endpoint identity. `e1@{…}` and `class e1` address the first link in both, and the writer leaves the id off the later link. Ours keeps an authored id that equals an id Mermaid generated earlier (`A --> B`, then `A L_A_B_0@--> B`), which Mermaid drops. |
| Flowchart edge id that a node or subgraph also has | **Keep the link and the node; the node keeps the id.** | Implemented: Mermaid accepts `A A@--> B` and `A S@--> B` beside `subgraph S`. Where the node comes after the link (`A e1@--> B`, then `e1 --> C`), Mermaid never creates node `e1` and the diagram fails to render (mermaid-js/mermaid#7033); ours draws node `e1` and both links and writes the source back as authored. The rendered link takes its generated identity (`edge:A->B#0`) so no two elements share a `data-id`. `class e1` paints the node and the link in both, `e1@{…}` addresses the link, and `set_label e1` labels the node (`A->B` labels the link). |
| XYChart keywords inside unquoted text | **Keep the whole text, and warn (`xychart_unquoted_text`, `xychart_unquoted_axis_title`).** | Implemented: Mermaid starts a statement at every `title`, `x-axis`, `y-axis`, `bar` or `line` where a word can start outside a string, so `title The title of the chart` is two titles upstream and draws "of the chart", and `x-axis Sales by line item [a, b]` or `bar Product line A [1, 2]` is rejected. Ours splits statements sharing a line (`bar [1, 2] line [2, 1]`, as Mermaid) but after unquoted title words only where the new statement carries data, so `title My Chart bar [1, 2]` is a title and a series in both; elsewhere it keeps the whole text and verify reports the keyword. Output quotes the text, which Mermaid reads the same way. An axis title of several unquoted words reads the same way and keeps its spaces, where Mermaid runs the words together (`x-axis Monthly totals bar [1, 2]` is the axis title "Monthlytotals" upstream). An unquoted category of several words keeps its spaces too (`x-axis [cat2 asdf, b]` is the category `cat2asdf` upstream); the writer quotes it. |
| XYChart unquoted text with characters or keywords Mermaid rejects | **Read it as written and warn (`xychart_unquoted_axis_title`, `xychart_unquoted_text`).** | Implemented: Mermaid's xychart lexer reads unquoted text (a title, an axis title, a series label or a category) as a run of ASCII letters, digits, whitespace and `&+=*.#_-`; in an axis title a digit starts a range number. Any other character, such as `(`, `%`, `,`, `:`, `/`, a single quote or a non-ASCII letter, is a lexical or parse error upstream (`title Sales (2024)`, `y-axis Revenue (USD) 0 --> 100`, `bar Trend/avg [1, 2]`, `x-axis [café, b]`), and so is `vertical`, `horizontal` or `xychart` where a word can start. Ours reads and draws the text, the writer quotes it, and verify reports it on its line: `xychart_unquoted_axis_title` for an axis title, `xychart_unquoted_text` for the rest. |
| GitGraph unquoted attribute values and branch names | **Read them as written, without a warning.** | Mermaid's GitGraph grammar reads `id:`, `msg:`, `tag:` and `parent:` only with a quoted string, and a bare branch name (after `branch`, `checkout`, `switch` or `merge`) only from letters, digits, `_` and inner `-./`. `commit id: abc`, `merge dev tag: v1` and `branch dev's` are rejected upstream. Ours reads the value or name as written, and the writer quotes it. The warnings (`gitgraph_unquoted_value`, `gitgraph_branch_name`) were removed: 0 of 106,252 real-world diagrams use the construct. |
| XYChart accTitle after a statement, beside a different one on its own line | **Keep the source and warn (`xychart_accessibility_order`).** | Implemented: a mid-line `accTitle:` or `accDescr` starts its statement, as in Mermaid, and its value reaches the envelope. Where a different value for the same field also stands on its own line, Mermaid keeps whichever comes last; ours draws the one on its own line, the typed body stays opaque and verify warns. Drawing the one written last was removed: 0 of 106,252 real-world diagrams use the construct. |
| Radar accTitle after a statement, beside a different one on its own line | **Keep the source and warn (`radar_accessibility_order`).** | Implemented: a mid-line `accTitle:` or `accDescr` is read into the envelope, as XYChart's is. Where a directive on its own line gives the same field a different value, Mermaid keeps whichever is written last; ours draws the one on its own line, as in XYChart, the typed body stays opaque and verify warns. Drawing the one written last was removed: 0 of 106,252 real-world diagrams use the construct. |
| XYChart quoted text with spaces at its ends | **Keep the text silently.** | Implemented: Mermaid trims every XYChart title, axis title and category (`y-axis "  Revenue  "` is `Revenue` upstream). Ours keeps the text inside the quotes as written and writes it quoted, which Mermaid reads trimmed, as it reads the source. |
| Text that runs across lines | **Keep each line break silently; drop the indentation after it.** | Implemented: Flowchart, Class, State, Mindmap, XYChart, Pie, Quadrant, GitGraph, Architecture and Radar read a quoted string across line breaks, and ER an attribute comment, as do Flowchart and Mindmap shape and link text and a Quadrant point's `[x, y]`, as Mermaid's lexers do. Readers drop the whitespace at each line break (a line's trailing space and the continuation's indentation), which Mermaid keeps, and except in GitGraph and Mindmap they drop a blank line inside the text, which Mermaid keeps too; in Mindmap a last line holding only the closing delimiter adds no line break. Mermaid removes a line starting with `%%` before lexing, even inside text; ours drops it too (verify reports `COMMENT_DROPPED`), except GitGraph and State, which keep it as text, as they keep a `%%` later on a line inside a string. Each writer spells the break as Mermaid reads it back in that family: `<br>` or `<br/>` in Flowchart, Class, State and Mindmap labels, `\n` in GitGraph and Radar, and a line break inside the quotes elsewhere. A State block note drops the blank lines it starts and ends with, as Mermaid does; Mermaid's kept indentation on later lines remains a divergence. |
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
| BUG-18: Flowchart `cleanupText` rewrite | **Keep reading and warn through shared `mermaid_cleanup`.** Write `<` safely in the affected label context. | The witness `A -->\|"<a="\| B["b"] --> C` draws and exports portably using `#lt;`. The shared cleanup receipt now supplies this warning for every family; no Flowchart-only quote-owner scanner is needed. |
| BUG-36: out-of-range `linkStyle` | **Keep reading and warn.** A forward reference can style its eventual edge; an index with no edge has no effect. | Implemented. Canonical output writes existing indices after their edges and omits nonexistent indices. |
| BUG-39: `A--a --> A--a` | **Keep rejection.** The intended IDs and link text are ambiguous. | Rejected with a grammar diagnostic. No parity fix is needed. |
| Flowchart `"` after other shape text, across lines | **Keep reading and warn (`flowchart_unclosed_quote`).** | Implemented: in shape text a `"` that does not start the text is text, as on one line, so `A[x "` followed by `y]` reads the label `x "⏎y`, where Mermaid rejects a string opened mid-label. A `&quot;` that the render path decodes joins lines as the authored entity does. An entity at the very start of a label (`A[&quot;x⏎y]`) is carried to later lines only when the first later `"` closes it before the shape's closer; otherwise the `"` is text and the label runs to its closer. |
| Flowchart subgraph title that no later line closes | **Keep the statements after it.** | Implemented: an `id[…`, `"…` or `id["…` title runs on only when the first later line holding one of its delimiters closes it with nothing after but `;`. Otherwise its line ends there and the title is the rest of that line (`S[Stage one`), where Mermaid rejects the diagram. A later line such as `more"` after `subgraph X "title` is then the node `more"`, as Mermaid's node string reads it. Verify reports `flowchart_subgraph_title`. |
| Flowchart ids listed alone in a subgraph body | **Keep the listing.** | Implemented: a statement of node ids alone (`a`, `a & b`, `a:::c`) lists them in its subgraph, as Mermaid's nested-subgraph spec reads it. A node no subgraph has listed yet joins it, and a subgraph id listed this way nests in the first lister to close when it is top-level, also when declared later. A link endpoint still claims only a node it creates, so `b --> B` inside A moves neither b nor subgraph B into A, where Mermaid moves both (subgraph.spec.js "nested subgraphs 1/3"). A subgraph declared inside another stays there when a sibling lists it, where Mermaid moves it to the first lister to close, and two subgraphs that list each other nest once, where Mermaid makes each the other's parent. |
| Flowchart subgraph without an id | **Use a title that is one node id as the id; otherwise generate one silently.** | Implemented: a title that is one whole node id is the id, as in Mermaid (`subgraph a.b` and `subgraph "a.b"` → `a.b`, `**Two**` → `**Two**`), and a markdown title's id is its text (`` "`**Two**`" `` → `**Two**`). Any other title gets a derived id: whitespace, a markup tag and a line break become `_`, and other punctuation is dropped (`a b`→`a_b`, `a<br>b`→`a_b`, `a,b`→`ab`), made unique against authored ids and written as `subgraph a_b[…]`. Mermaid names it `subGraphN` when the title holds whitespace, and otherwise uses the title text (`a^b`, and the quoted forms of `a<br>b` and `a,b`, whose unquoted forms it rejects); no statement both readers accept can reference those ids, so ours keeps derived ids that can be. A title holding whitespace or a line break names no group, so each such block is a group of its own (`a_b`, then `a_b_2`), as Mermaid's `subGraph0`, `subGraph1` are. A title without whitespace names one group, and its repeats merge, as Mermaid's title-as-id does. For `subgraph a b[c]` Mermaid's id is `a b`, which no link can name; ours derives `a_b` silently. A bare `subgraph` with no title is rejected with a named reason (`flowchart_untitled_subgraph`): Mermaid's grammar accepts it, and its database then fails. |
| Flowchart edge id | **Read Mermaid's LINK_ID, except region delimiters.** | Implemented: the id before `@` and a link may hold any character Mermaid's LINK_ID (`[^\s"]+@`) allows except `[](){}\|<>`, `;` and `@`, so `e.1@-->`, `e:1@==x`, `e&1@-->`, `e,1@-->` and `é1@-->` are edge ids, and `e.1@{ … }` sets that edge's metadata. An id holding one of those characters, or starting like a link (`--`, `-.`, `==`), stays rejected (`A e[1@--> B`, `A e\|1@--> B`, `A e1@x@--> B`), where Mermaid takes the text before the `@` as the id. Glued to a shape, Mermaid's id may also begin with a link opener or `:::` (`A["x"]x--e1@-->B` has the id `x--e1`, `A["x"]:::cx--e1@-->B` the id `:::cx--e1`); ours reads a link label and class there without a warning, or rejects the statement. No rejection here names its reason: 0 of 106,252 real-world diagrams use these ids, so the code that named it and read glued ids was removed. |
| Flowchart link with a start marker unlike its end | **Keep both markers silently.** | Implemented: ours reads the start marker of `x--o`, `x-.-o`, `x==o`, `<--x` and `<-.-x` as written. Mermaid keeps only the end marker: `x--o` is a circle end of length 2, and `x==o` a solid link of length 2. Our writer writes them as read, and Mermaid reads that output as it reads the source. An `x`/`o` start before an arrow or plain end (`x-->`, glued `A["x"]x-->B`, `o---`, `x-.->`, `x==>`) stays rejected; Mermaid drops the `x`, and reads `x==>` as a solid link of length 2. A labelled one (`x-- a -->`) is rejected with `flowchart_link_markers`; a plain one names no reason, since 0 of 106,252 real-world diagrams use it. After a blank, `x--`/`o--` before an `@` opens a link label, as Mermaid lexes it (`A x--e1@--x B` is a labelled link). |
| Flowchart node ids | **Read them as Mermaid's node string does, with two exceptions.** | Implemented: letters and digits of any script, `_`, `` !"#$%&'*+.`?\/ ``, `:` (not `:::`) and a `-` that no `-` or `.` follows make one id, so `A.B`, `A&B`, `:a`, `&a`, `1.5` and `` C`" `` are single nodes (a lone `&` is a node, as Mermaid's AMP is an id token; after a node, `&` joins a `&` list), and a subgraph id follows the same rule (`subgraph a.b` has the id `a.b`). Exceptions: Mermaid's `A,B` is one id, which ours rejects: Mermaid's `class`, `:::` and `click` split it at `,`, so no source can give a node `A,B` a class or a link, and its `style A,B` styles one node `A,B` where ours styles A and B; the parse error and verify (`flowchart_comma_id`) give that reason and suggest `A & B`. A letter outside ASCII before `"` or `.` is id text in ours, where Mermaid's UNICODE_TEXT token ends there. |
| Flowchart label string followed by text | **Read it as Mermaid does.** | Implemented: `A["a" b]`, a pipe or text-arrow label `"a" b`, and a subgraph title `"a" b` read `a b`; `subgraph "i"j` has the id `ij`. A markdown string followed by text keeps its quotes. |
| Flowchart entity references in the render path | **Draw what Mermaid's parser reads.** | Implemented: the renderers read the authored text when ours parses it. A reference in label text shows its character (`A[&quot;x&quot;]` draws `"x"`), one elsewhere stays as written, and `&lt;b&gt;` in a label is literal text, not markup. References in `click`/`href` statements, and control characters, are decoded as before; source that only parses decoded (`A --&gt; B`) is read decoded. HTML-escaped source ours also parses as written (`A &amp; B`) is drawn as written, as the typed body reads it. |
| Flowchart node or subgraph text running on to an `@` | **Keep reading and warn (`flowchart_node_edge_id`).** | Implemented: Mermaid's edge-id token takes `A[a@b.com]`, `A[x@--> B]` and `subgraph x[a1@ T]` up to the `@` and rejects them. A pipe label whose text runs from its opening pipe to an `@` with no blank or `"` between (`A -->|a@b| B`, `A["x"]-->|a@-->b|B`, `A --> |x@--> y| B`) is an edge id to Mermaid, which tries its edge-id token before its pipe and then rejects the statement; ours reads the label, warns, and writes it quoted. A blank before the `@`, quotes and a text-arrow label are read as a label by both. |
| Flowchart empty pipe label | **Keep reading and warn (`flowchart_empty_pipe_label`).** | Implemented: Mermaid's pipe label needs text, so it rejects `A -->|| B` on every link and accepts `| |`. Ours reads a link with no label, which the writer writes without pipes. |
| Flowchart empty quoted label | **Keep reading and warn (`flowchart_empty_string`).** | Implemented: Mermaid's string token needs a character, so it rejects `""` as a node label (`A[""]`), a pipe label, a text-arrow label and a subgraph title. Ours reads an empty label. The writer writes an empty node label or subgraph title as `" "`, which Mermaid accepts and ours reads back as empty, and writes a link with an empty label as an unlabelled link. |
| Flowchart HTML-escaped `&` after a node | **Keep ending the statement at its `;`, silently.** | Implemented: Mermaid rejects `&amp;`, `&#38;` and `&#x26;` after a node (`A &amp; B --> C`). Ours ends the statement at the reference's `;`, so it lists A and a node `amp`, then links B to C, without a warning. Reading the list `&` there, with `flowchart_escaped_amp`, was removed: 0 of 106,252 real-world diagrams use it. Glued to an id, or where a node begins, `&amp` is id text in both (`A&amp;B` is the node `A&amp`). |
| Flowchart `&` list without blanks | **Keep reading silently.** | Implemented: `A &B`, `A[x]& B` and `A & B &C` list the nodes, without a warning. Mermaid lists nodes only with a blank on each side of `&` and rejects these. The warning (`flowchart_amp_spacing`) was removed: 0 of 106,252 real-world diagrams use the spelling. |
| Flowchart label text holding delimiters | **Keep reading and warn (`flowchart_label_delimiter`).** | Implemented: unquoted shape text, a pipe label or a subgraph bracket title holding `[](){}\|"`, trapezoid text holding a bracket, and a text-arrow label holding a `"` after its start are read as written; Mermaid's text state ends the text there and rejects the line. The writer quotes them. |
| Flowchart subgraph title without quotes | **Keep reading and warn (`flowchart_subgraph_title`).** | Implemented: without quotes Mermaid reads only letters, ASCII digits, blanks and ``!#$%&'*+-./:?\^_` `` in a title, with no link, `:::` or word-initial `"`. |
| Flowchart `;` read by the entity prepass | **Keep reading and warn (`flowchart_entity_semicolon`).** | Implemented: Mermaid reads `#fff;` as an entity code, and drops the last `;` of a line where `style` or `classDef` precedes `:…#`, joining what follows to the statement. It rejects such lines (`linkStyle 0 stroke:#f00;` alone included) or reads them otherwise (`style A fill:#f00;B` styles A with `fill:#f00B` and draws no B). |
| Flowchart subgraph with no `end` | **Keep reading and warn (`flowchart_unclosed_subgraph`).** | Implemented: a subgraph still open at the end of the source closes there and holds what follows it; the writer writes its `end`. Mermaid rejects the diagram. |
| Flowchart `end` with no subgraph open | **Keep reading and warn (`flowchart_stray_end`).** | Implemented: the stray `end` is ignored, and a statement after it on its line (`end B --> C`) is read. Mermaid rejects both. |
| Mindmap accessibility directives | **Read native metadata and warn (`mindmap_accessibility`); write owned native comments.** | Mermaid has no Mindmap accessibility production and can interpret raw directives as nodes. Typed output carries the title/description in JSON grammar-text comments which native consumers read and external Mermaid ignores. Diagram topology remains portable; external accessibility remains unsupported. |
| An accTitle or accDescr without its colon | **Read it as the directive, without a warning.** | Every Mermaid grammar reads only `accTitle:` and `accDescr:` (or an `accDescr {` block). Without the colon, most families reject the line, State, ER and Timeline read its words as states, entities or an event, and Class drops them. Ours reads `accTitle Sales` as the accessible title in every family, and the writer adds the colon. The warning (`accessibility_colon`) was removed: 0 of 106,252 real-world diagrams use the construct. |
| `accDescr {…}` blanks in Langium families | **Keep the text as written silently.** | Implemented: Mermaid's Langium-grammar families (Architecture, GitGraph, Packet, Pie, Radar, Treemap and the others under its `parser` package) collapse each run of blanks in a block description to one space; its Jison families (Flowchart, Sequence, …) keep the text as written, and so does ours in every family. |
| Mindmap node text ending in whitespace | **Trim it silently.** | Implemented: Mermaid keeps the space in `root ` (header-line `mindmap root ` or a node line), so its id is `root `. Ours trims the text, as everywhere else, and writes `root`; the space draws nothing. |
| Mindmap shape text holding its own delimiters | **Keep reading and warn (`mindmap_nested_shape_delimiters`); write the text quoted.** | Implemented: Mermaid's NODE lexer state ends a shape at its first closing delimiter, so `root((a (b) c))` or `[text (x)]` is a parse error upstream. Ours reads the text inside the outermost pair when the delimiters in it pair up and it holds no quote, and writes `root(("a (b) c"))`. Unpaired delimiters (`root[The root]ot]`, `a(x)(y)`) or a quote (`root[a "b" (c)]`) are rejected, as upstream, as is a node id or plain node text holding `( [ ) { }` or a line break. |
| Mindmap blank line or trailing whitespace after the header | **Keep reading and warn (`mindmap_space_after_header`).** | Implemented: Mermaid's lexer reads whitespace ending the `mindmap` line, or a blank line after it, with the line break as one SPACELINE token its grammar accepts there only before another line break, so `mindmap⏎⏎  root` and `mindmap ⏎  root` are parse errors upstream (CRLF is not the cause). A `%%` line takes the blank lines before it with it, so `mindmap⏎⏎%% c⏎  root` is accepted. Ours ignores the space, reports it on the header's line, and writes none. |
| Flowchart metadata spacing and mixed-stroke arrows | **Keep reading and warn.** Canonicalize the clear metadata attachment or labelled link. | Implemented for `A @{...}`, `A@ {...}` and `A -- b ==> B`: named warnings, portable output and stable facts. A label that runs onto later lines closes the same way: `A -- b`, `C ==> D`, `E --> F` on three lines is A==>D labelled `b`/`C` and then E→F, with `flowchart_mixed_link_label`, where Mermaid reads one edge A→F labelled with all the text between. |
| ER keyword spelled as an entity name | **Keep reading and warn (`er_keyword_name`); write the name quoted.** | Implemented: Mermaid's ER lexer reads `end`, `subgraph`, `style`, `class`, the cardinality words (`one`, `many`, `to`) and the parent marker `u-` before a name, so it rejects them bare. Ours reads the evident entity, warns, and quotes the name (and any name Mermaid would split, such as `2px`) on output, which Mermaid reads as that one name. A stray `end` after a misspelled `subgraph` therefore warns rather than drawing silently. |
| ER names Mermaid's lexer splits | **Read the name whole; write it quoted.** | Implemented: Mermaid reads a bare name only as one UNICODE_TEXT token (letters of any script, digits, `_`, `-`, `*`, `.`) that no keyword, cardinality or leading number takes first. A name starting with a number is two names upstream (`1MANUFACTURER ||--|| ORDER` declares `1` and `MANUFACTURER`; `A ||--o{ 12f : x` is rejected). An alias and a subgraph id must be one such name, and each subgraph title word too (`CUSTOMER[Customer Account]`, `subgraph title1#`, `subgraph g [My (big) group]` are rejected). Ours reads each as written, without a warning, and writes the name, alias, subgraph id or title quoted, which Mermaid reads. A title of names and quoted names (`[a "b c"  d]`) keeps its quotes and blanks, where Mermaid joins the names one space apart. The warnings (`er_number_name`, `er_alias_text`, `er_subgraph_name`) and Mermaid's reading of such a title were removed: 0 of 106,252 real-world diagrams (2,285 ER) use these spellings. |
| ER relationship spellings Mermaid rejects | **Read them; write Mermaid's spelling.** | Implemented: Mermaid takes an alias only on a declaration of its own (`A[x] ||--o{ B : r` is rejected); ours reads it as A's alias and writes it on A's declaration. Mermaid reads `|o` and `}o` only where a word ends, so `HOUSE ||--|oROOM` is rejected; ours reads the cardinality `|o` before `ROOM` and writes a space between them. Neither is reported: the warnings (`er_relation_alias`, `er_cardinality_space`) were removed, as 0 of 106,252 real-world diagrams use these spellings. |
| ER style text Mermaid's style lexer rejects or discards | **Read and draw it, and construct a lossless entity spelling.** | Implemented: Mermaid's ER `style` and `classDef` lexer skips whitespace and rejects punctuation used by CSS functions and quoted font names. Ours retains those fields. The writer protects field whitespace, delimiters and literal Mermaid entity/marker text with decimal entities whose two-, five- or seven-digit widths cannot be CSS hex colors. Readers classify the property-list grammar before decoding the protected fields. The complete style statement determines its semicolon padding through both global prepass rules, including keyword-like target/class names. `{`, `\|`, `}` and `~` are constructible; the previous two-digit-only refusal was an artificial limit and is removed. Exact functional-color numbers, font names and dash spacing survive typed/native reload and the real pinned DB after Mermaid's marker/HTML resolution. The existing generous CSS-semicolon reading remains. Invalid XML characters, lone surrogates and control characters whose HTML numeric references change their value are refused atomically rather than substituted; ordinary TAB, CR/LF field data and Unicode whitespace have entity spellings. |
| C4 statements sharing a line | **Keep reading and warn; write a line break.** | Implemented: pinned Mermaid C4 needs a line break after each statement and after a boundary's `{` (only `}` may share the line before it), and its comment rule takes the line break after a comment. Ours reads `System_Boundary(b, "B") { Person(a, "A") }`, juxtaposed statements and a statement followed by a comment and another line, and reports each (`c4_statements_on_one_line`), as it reports `;` separators (`c4_semicolon_separator`). The C4 writer writes a line break after each such statement and in place of each `;`; a comment sharing the line moves to a line of its own, and a statement split out after a boundary's `{` goes one level deeper. Statements with no warning keep their exact bytes. A placement hint the layout cannot honour is reported as `c4_layout_conflict`. |
| C4 unquoted argument text | **Read it as written, without a warning.** | Mermaid's attribute lexer reads unquoted text up to the next comma, so after the last comma it takes the `)` too (a single space before `)` as well), and `$name=` takes only a quoted value: it rejects `Person(a, Ann Lee)`, `"Ann" )` and `$descr=Banker`, or reads on into the next statement. Ours reads them as written and keeps the authored bytes. The warning (`c4_unquoted_argument`) was removed: 0 of 106,252 real-world diagrams use the construct. |
| C4 arguments whose quotes Mermaid pairs otherwise | **Read them as written, without a warning.** | Text glued to a quote, a quote inside unquoted text, a `$` not followed by `name="…"`, or an unclosed quote: Mermaid rejects the diagram or, where a later comma, quote or `=` lets it read on into later statements, reads it otherwise. Ours reads the argument text as written (`"Ann"x` is the label `"Ann"x`), draws it and keeps the authored bytes. The refusal (`c4_argument_quoting`) was removed: 0 of 106,252 real-world diagrams use the construct. |
| C4 whitespace between a macro's name and `(` | **Keep reading and warn (`c4_space_before_arguments`).** | Implemented: Mermaid's lexer reads only a `(` straight after the macro's name, so `Person (a, "A")`, or a line break before the `(`, is a lexical error upstream. The writer drops the blank, so pinned Mermaid reads its output. |
| C4 argument lists Mermaid reads into other fields | **Keep ours, which follows our own quote and parenthesis pairing, without a warning.** | Where Mermaid's attribute lexer accepts the list but fills other fields (text glued to a quote, a blank before a comma after a quoted argument, a comma inside parentheses, a blank inside a `$name`), ours keeps its reading and the authored bytes. The warning (`c4_argument_reading`) was removed: 0 of 106,252 real-world diagrams use the construct. The writer respells the other C4 reader extensions with quoted and named arguments (`Person(a, "Ann", $descr="A customer")`); empty boundaries use a no-op statement; standalone `direction`, `SHOW_LEGEND` and tag directives, and bodies with unknown statements or arguments still have no meaning-preserving spelling and are written as authored. Required identity arguments and layout settings are emitted in their pinned positional slots even when the source names them in another order. |
| C4 blanks at either end of an argument | **Trim them, as Mermaid does.** | Implemented: Mermaid's C4 grammar trims every argument, quoted or not, before entity codes are displayed; ours does the same, so `Rel(a, b, " uses")` reads `uses` and `#32;` keeps a blank. The writer spells a typed value's leading or trailing blanks as entity codes. A tab or other control character at either end has no entity spelling, so a typed edit holding one is refused. |
| `;` between State statements | **Keep reading and warn (`state_semicolon_separator`, `state_text_cut`, `state_note_text_cut`, `mermaid_cleanup`).** | Implemented: Mermaid reads the `;` into a name (`A --> B; B --> C` is a state `B;`) and rejects it after the header; ours ends the statement there, as requested upstream (mermaid-js/mermaid#5410), and writes one statement per line. Text after a description, transition or one-line note colon keeps its `;` and colons, as before. Mermaid ends a description or transition label at `;`, at `::` and before a colon its line ends with, and a one-line note's text at any colon or `;`. It reads entity codes first, after a prepass that drops the `;` ending a line's `style…:…#…;` or `classDef…:…#…;` run. Ours writes such a description or label with `#59;` and `#58;`, and such a note as a block note, spelling a colon that starts the block `#58;` (Mermaid would read a one-line note there). Wherever the prepass would strip a `;` from a line it writes (a description, a label, a quoted name or a note line), it writes that text's colons `#58;`. Mermaid reads all of these back as the text. Verify reports the source forms: `state_text_cut`, except where Mermaid reads the text whole (an entity code's `;`, a colon followed by text or blanks, the text after `state "…" as X`, quoted names, block notes); `state_note_text_cut`; and `mermaid_cleanup` for text whose `;` the prepass drops. Verify reads the authored line whether given source or the diagram parsed from it. A block note whose text starts with a colon (after any blank lines) is a one-line note to Mermaid, which then rejects `end note`; ours reads the block, the writer spells that colon `#58;`, and verify reports `state_note_block_colon`. |
| State `}` right after a name, a `}` that closes nothing, and a blank line between `state X` and `{` | **Keep reading; warn for the brace (`state_brace_after_name`, `state_brace_unopened`).** | Implemented: Mermaid reads `A}` as a name, and the rest of the line after `state "…" as` (`A }` too), and inside a composite then rejects it as unclosed; at the top level it draws a state named `A}`, and a lone `}` that closes nothing is a state named `}`. Ours drops a `}` that closes nothing on every surface (the typed body used to go opaque). Mermaid also rejects a blank line before a `{` on its own line (a comment line is fine). Ours closes the composite and takes the `{`, and writes portable output. The blank line is not yet reported: the reader sees comment lines and blank lines alike. |
| State text after `state "…" as X` | **Read `: text` as X's description and `:::c` as its class, and warn (`state_alias_suffix`).** | Implemented: Mermaid takes the rest of the line as the name and splits it at every `:`. `state "x" as A : desc` declares A with title x and description desc, as `A : desc` does; `:::hot` gives an empty description and no class upstream, and `: d1 : d2` drops `: d2`. Ours keeps both and writes `class A hot`. A `{` after the description stays rejected. |
| State `state X` without a block, and words after it on its line | **Declare X and read the rest of the line as statements; warn (`state_statements_share_line`).** | Implemented: Mermaid's builder skips a bare `state X`, and its lexer reads every later word on the line as another dropped declaration (`state a [*] --> P` loses the transition). Its keywords are case-insensitive, and so are ours: `Small State 2` is `Small` and a declaration of `2`, which ours keeps. A `State` in any case but lower that starts no declaration, or that a transition or description follows (`State --> A`, `Small State 2ate1 --> B`), stays a name; Mermaid reads a dropped declaration there. |
| State `[*]` per transition | **Keep one start or end circle per transition, silently.** | Implemented: Mermaid merges each scope's `[*]` starts into one node and its ends into another. The writer keeps each transition as written. |
| Several descriptions of one State | **Show every description as a line of the label, silently.** | Implemented: Mermaid draws the first as a title and the others below a divider. Ours writes `state "x<br/>desc" as A`, which Mermaid draws without the divider. |
| A State composite mentioned outside its block | **The composite's block decides where it is; a mention adds nothing.** | Implemented: Mermaid nests a composite in the scope that first mentions it, and `state X { X }` makes X its own parent. Mermaid rejects a composite with more than one label or description; ours joins them into the label and warns (`state_composite_description`). A composite's classes' classDef paint is drawn on its body, outline and title, as Mermaid's cluster CSS draws it; its `style` paint is kept and written but not drawn, as Mermaid's composite shape draws none. |
| A State state mentioned in two composites or regions | **The first composite or concurrency region that mentions it owns it; a later mention elsewhere reaches across.** | Implemented: Mermaid moves the state into the last composite that mentions it, and a top-level mention never moves it back, so `state B { y }` followed by `state A { x --> y }` draws y in A there. Ours keeps y in B and draws the transition from A's x across to it, as repeated Flowchart group members keep their earlier membership. A state first mentioned at the top level still joins the composite that later mentions it, as in Mermaid. Each mention used to add the state to every composite, which the layout refused as a duplicate identity (`INTERNAL_ERROR`). |
| State `A:::c` outside a transition | **Keep the class silently.** | Implemented: Mermaid's builder passes no classes for a state statement, so `A:::hot` alone (also with blanks around `:::`, after `as`, or before `: text`) colours nothing upstream, while `class A hot` and `A:::hot --> B` do; ours keeps the class, and the description after it. Inside a composite Mermaid also drops the class of a state in a transition (`A:::hot --> B`); ours keeps it and writes `class A hot`, which Mermaid applies. |
| A State named only by `class` or `style` | **Draw it silently.** | Implemented: Mermaid draws nothing for a state that only a `class` or `style` statement names. |
| State ids Mermaid cannot read alone | **Write `state "X" as X`; write a transition naming a keyword with no blank after it, and one naming another such id, or a note on one, as authored.** | Implemented: Mermaid reads no hyphen in a name, takes `note`, `class`, `classDef`, `style`, `default`, `click`, `href`, `scale`, `stateDiagram` or `state` (any case) as its own statement, and drops a bare `state X`. A state declared with nothing else, or described, is written `state "X" as X` (`in-flight : x` is written `state "x" as in-flight`), which Mermaid draws and ours reads back. Verify reports a description naming such an id (`state_description_name`): Mermaid rejects `in-flight : x`, `note : x` and `class : x`, and draws nothing for `State : x`. It reads the name after `state "…" as` to the line's end, which is not reported. Mermaid reads `state`, `note`, `class`, `classDef`, `style`, `scale` and `stateDiagram` as keywords only before a blank, so a transition naming one is written with no blank after the name (`note--> A`, `A --> note: label`, `A --> note%%`), which Mermaid reads as that transition; verify reports such a name only where a blank follows it (`state_endpoint_name`). A hyphenated id, or `default`, `click` or `href`, has no other spelling, so output with such a transition is rejected upstream; verify reports it too. A note target has no other spelling either, and Mermaid's note target ends at a hyphen: it rejects `note right of in-flight : x` and puts a block note on `in`, reading `-flight` as text, here and in the output; verify reports a note on a hyphenated id (`state_note_target`). Mermaid reads a keyword id as a note target (`note left of note : y`), which is not reported. Verify reports a declaration naming such an id (`state_declaration_name`): Mermaid rejects `in-flight` or `default` alone, reads a bare `state` (or `State` before a name) as a declaration of the next name, which it drops, and `A--B` in a composite as two states and a divider. Elsewhere the naming checks ignore where the name stands and what follows it: verify reports `note: x`, and `default`, `scale` or `stateDiagram` inside a composite, which Mermaid reads as states, and not `in-flight:::hot` or `default:::hot`, which it rejects; ours reads `state :::hot --> A` and `note :::hot --> A` as a description `::hot --> A` of `state` or `note`, where Mermaid drops or rejects the line. Reading these as Mermaid's lexer does was removed: 0 of 106,252 real-world diagrams use a keyword or hyphenated name there. |
| State `state "L" as X <<fork>>` or `[[fork]]` | **Declare the fork X with the label L, which is not drawn; warn (`state_pseudostate_label`).** | Implemented: Mermaid's fork rule takes everything before `<<fork>>` or `[[fork]]` as the name, so the fork is named `"L" as X` upstream and no transition can reach it. Ours reads the alias as for any state. `[[fork]]`, `[[join]]` and `[[choice]]` read as their `<<…>>` forms and are written so. |
| State `cssClass` and `linkStyle` | **Read them as paint, and warn (`state_css_class`, `state_link_style`).** | Implemented: Mermaid 12.2's State grammar has neither: `cssClass A hot` is three states upstream, and `linkStyle 0 stroke:#f00` the states `linkStyle`, `0` and `stroke`. Ours reads them as paint and writes `class A hot`; the writer's `linkStyle` lines for transition paint are read by Mermaid as states. |
| State name after `as` holding a space | **Keep rejection.** | Mermaid reads the rest of the line after `state "…" as` as one name (`X Y`), which no transition can refer to. Ours cannot hold such a name, so the source stays opaque and is not drawn, and the renderer says why. `state X as Y`, which Mermaid rejects, is rejected too. |
| Class style-class assignment forms | **Keep the style class and warn (`class_style_assignment`, `class_css_class_before_class`); write `cssClass "A" c`.** | Implemented: Mermaid reads `class A c` as one class named `Ac`, rejects an unquoted `cssClass A c` and `A:::c` on a line of its own, and applies `cssClass "A" c` only to a class declared before it. Ours reads each as style class `c` on `A`, whatever the order, warns where Mermaid reads the source otherwise, declares no class for a cssClass (as Mermaid), reads a quoted cssClass's ids as written (`"my class"`), and writes `cssClass "A" c` after the class, which Mermaid reads as written. |
| Class member text with `:` or `;` after `Class :` | **Keep reading and warn (`class_member_text`).** | Implemented: Mermaid's LABEL token (`":"[^:\n;]+`) ends at either, so `BankAccount : t : +String owner`, `A::B` and `A : x; y` are rejected. Ours reads the member whole and writes it in the class body, which Mermaid reads. A relationship label with a colon stays rejected, as it is upstream. |
| Class `classDef` or `style` text before its first colon | **Keep reading and warn (`class_style_text`).** | Implemented: Mermaid takes only words, `#`, `%` and commas there, so it rejects `stroke-width:4px` first and accepts `fill:#fff,stroke-width:4px`. The writer inserts an empty `style:` declaration when the first requested property is not a word token. CSS ignores that empty ordinary declaration; every authored field follows in order, so lone hyphenated and keyword fields are writable without invented paint. Keywords occupying other lexer productions are included in that admission rule. |
| Class `{` in a class body member | **Keep rejecting it, on any line of the block.** | Implemented: Mermaid rejects it (OPEN_IN_STRUCT); the body stays opaque and the render is refused, as for a `{` on the block's own line. |
| Class `%%{…}%%` directive inside a statement | **Read the statement without it, as Mermaid does.** | Implemented: Mermaid removes directives before lexing, so `class A {⏎+literal(%%{init: {}}%%)⏎}` parses and `A : +x %%{a}%%` reads `+x`. An init directive's configuration is applied wherever it stands (see the next row). The writer spells `%%{` in text as `%%#123;`; member edits holding a directive are refused. Elsewhere a directive other than init inside a statement (`%%{wrap}%%`) stays in the text, where Mermaid removes it. |
| `%%{…}%%` directive inside a statement | **Remove it wherever it stands, in every family, as Mermaid does; apply `init`/`initialize` config and `wrap`.** | Implemented: the shared normaliser applies an `init` or `initialize` directive's configuration (also inside a `%%` comment line) and `wrap` (`wrap: true`) wherever it stands, applies nothing for `config` or other names, and removes each, so every family reads the statement without it (`A["x %%{init:…}%% y"]` reads `x  y`). The writer writes the applied directive before the header. Mermaid reads an unclosed `%%{…` to the end of the source; ours removes only closed directives. |
| Class name read as a keyword | **Refuse it, naming the keyword.** | Implemented for declarations, member statements and relationship endpoints: `note`, `click`, `link`, `cssClass`, `href` and `callback` are keywords to Mermaid anywhere, even in backticks; `o`, `_self`, `_blank`, `_parent` and `_top` when bare; `class`, `classDiagram`, `namespace`, `style`, `classDef`, and `call` before a blank, when bare at a statement's start. Those in the first set have no portable spelling; the writer wraps `call` and the link targets in backticks. `call` is a keyword only before a blank or the line's end, as a relationship endpoint too (`call --> A` is refused, `call-->A` read). Edits refuse the ids with no portable spelling (`note`, `click`, `link`, `cssClass`, `href`, `callback`) with INVALID_OP. |
| Class forms Mermaid's grammar reads otherwise | **Keep reading and warn (`class_repeated_header`, `class_member_parenthesis`, `class_link_form`).** | Implemented: a repeated `classDiagram` header in the body; a member Mermaid's method split cannot read (`+deposimount)`, `(x)`, where its parser throws); and `click A "…"` without `href`, `link A href "…"`, an unquoted URL or an upper-case keyword, which Mermaid does not read as a link. The writer writes `click A href "…"`. |
| State note position with extra blanks | **Keep reading and warn (`state_note_position`).** | Implemented: Mermaid reads `left of` and `right of` only with one space between the words; `note right  of X` is rejected upstream. |
| Non-colour paint (`fill:50%`) | **Keep refusing it in every family (#303).** | Implemented: a fill, stroke or text colour that is not a CSS colour fails the render with a message naming the property and the accepted forms; Mermaid's CSS drops the declaration and draws the default. |
| Class `:::style` before an inline annotation | **Keep reading and warn (`class_style_before_annotation`).** | Implemented: Mermaid takes `:::c` only before a body (`class A:::c { <<interface>> }`) and rejects `class A:::c <<interface>>`, with or without a body. Ours keeps the style class and the annotation in both forms. |
| Class statement after a block's `}` on its line | **Keep reading and warn (`class_statement_after_class_close`, `class_statement_after_namespace_close`).** | Implemented: Mermaid reads only braces after a class or namespace block's `}` on its line. Ours reads `class A {+x} class B` and `namespace N {⏎class A⏎} class B` as the two statements they hold, and writes them on separate lines. |
| State `}` ending the last description or label, and a composite never closed | **Read the brace and warn (`state_brace_after_description`); reject a composite never closed (`state_composite_unclosed`).** | Implemented: Mermaid reads `}` into a description (`state X { A : desc }` labels A `desc }`) and rejects the composite left open. Ours closes X with that `}` when it ends the source's last statement, nothing else closes X and the text did not open it, and writes the `}` on its own line. Where a `;` or `::` ends Mermaid's text before the `}` (`state X {⏎A : a; }`), Mermaid also reads the `}` as closing X; that line is reported as `state_text_cut`, not for its brace. A composite never closed at all is rejected on every surface, as by Mermaid, since nothing says where it ends; the renderer used to draw its members without it. |
| Class link URL or tooltip, or a backtick name, across lines | **Keep rejection.** | A URL, a plain-text tooltip or a class identity cannot hold a line break. |
| Gantt `click` whose `href` or `call` follows a blank or comment line | **Keep reading; not reported.** | Implemented: Mermaid's `click` state takes the line break before `href`/`call`, as ours now does, but rejects a blank or comment line between them. The renderer's normalized lines drop those lines before the reader sees them and the typed body agrees with it; the output keeps the authored lines, so Mermaid rejects it as it rejected the input. |
| Gantt and timeline bare word on the header line | **Keep it a diagnosed header suffix.** | Implemented: Mermaid reads a statement written on the header line of most families (`gantt dateFormat …`, `pie "a": 1`, `gitGraph LR: commit`, `radar-beta axis a, b`), and so do we. A bare word such as `gantt LR` or `timeline TB` is a task (rejected) or a period upstream; ours keeps it a header suffix, preserved and warned, since it is more likely a mistyped option. |
| BUG-54: Quadrant keywords and semicolons in text | **Keep reading and warn; write labels with grammar-aware quoting.** | Open: `x-axis title`, `quadrant-1 title` and `A;B: [0.3, 0.4]` draw but lack the portability warning and are written back in rejected form. This is a Quadrant codec/export defect, not a reason to reject clear labels on read. |
| BUG-58: Quadrant functional colors, variables, unknown keys and fractional radius | **Keep clear, safe reads and warn; refuse structured authoring/export when no meaning-preserving portable spelling exists.** See the bounded export choice below. | Open: RGB/HSL/`var()` and fractional radii draw but lack portability warnings and serialize in rejected form. Unknown style keys warn and remain inert locally, but their structured output is also rejected by 12.2. Tests at this baseline that call unknown keys upstream-valid are stale under 12.2. |
| Quadrant unquoted `<>()[]{}\|@^~` and keywords | **Keep reading and warn (`quadrant_unquoted_text`); quote canonical text.** | Implemented for the tested forms. Mermaid's quadrant lexer also reads `x-axis`, `y-axis`, `quadrant-1`…`quadrant-4` and `quadrantChart` where a word can start, and `classDef` or `title` as a whole word (any case), as tokens of their own, so unquoted text holding one (`quadrant-1 Grow x-axis fast`, `Low_title: [0.3, 0.4]`) is rejected upstream; ours reads it, reports it and writes it quoted. A literal quote that cannot be represented safely must remain outside structured authoring. |
| Class bare header and comments after declarations/namespaces/braces | **Keep reading and warn.** Preserve empty diagrams as empty; never invent a class to satisfy an upstream grammar floor. | Trailing comments canonicalize portably. Bare `classDiagram` is renderable, structured and warns, but the empty canonical output remains rejected by 12.2. Record this empty-diagram export limitation explicitly; no runtime change is implied by this disposition. |
| BUG-55: Class comment edge cases | **Apply the comment rule in its grammar context.** Keep comments after statements as generous reads with warnings; keep `%%` that is member or relation-label text as content. | Statement handling is implemented. PR #410 adds member admission guards for comments, init/accessibility directives and decoded line controls, preserving real members such as `+accTitle: String`. It does not make all Class source segment-editable; SRC-1 remains separate. |
| Architecture titles, dotted icons and edge-dash IDs | **Accept current grammar titles; keep other clear extensions with warnings.** Do not silently rename IDs or replace an icon to make output portable. | `[Café]`, `[Edge-Layer]`, break markup and title punctuation are accepted by 12.2 and have no rejection warning. Dotted icons and IDs such as `api-` still draw and warn, but their structured writer emits rejected source. Their export/admission boundary remains a family-reader follow-up. |
| ER trailing comments and escaped/empty quoted names | **Keep clear reads and warn; encode portable quoted text.** Empty entity names remain source-only when the typed identity model cannot preserve them safely. | Implemented for trailing comments, escaped quotes, backslashes and `%`: output uses entity encoding and parses upstream. Empty quoted names remain opaque and preserve their source, which is still upstream-invalid. |
| Sequence named reference before `;` | **Keep the reference in its statement and warn (`sequence_named_reference_semicolon`).** | Implemented: Sequence reads one text on every surface (`src/sequence/family-source.ts`). `A->>B: a &amp; b` and `a&nbsp;b` are one message drawing `a & b` and `a`, a no-break space, `b`; Mermaid ends the statement at the named reference's `;`, rejecting both and reading a final `x &amp;` as `x &amp`. A numeric reference to `#` or `;` (`&#35;`, `&#59;`) is text, as in Mermaid; `R&D;`, which names no character, ends its statement in both. Serialization writes text 12.2 accepts (`a & b`, `#35;`, a no-break space). Pie keeps its own authored-spelling reading; other families still decode every reference before their grammar. |
| Sequence participant declared in two boxes | **Keep the first box and warn.** Preserve the authored extension instead of changing unrelated source automatically. | Implemented. Box statements are opaque segments inside a Sequence body; serialization preserves the second declaration, so this source is still rejected by 12.2. Do not label that preservation a portable canonical rewrite. |
| Sequence local arrow spellings | **Keep reading them, warn (`sequence_local_arrow`), and write Mermaid's arrow.** | Implemented: ours reads twelve spellings Mermaid's lexer lacks (`-\|`, `-/`, `-\`, `\|-`, `/-`, `\-` and their dashed forms), each drawn as the Mermaid arrow with the same heads and line style (`-\|` as `-\\`, `-/` as `-//`, `\|-` as `\\-`, `/-` as `//-`). The writer writes the Mermaid arrow, including in lines a fragment or opaque block keeps verbatim. Where Mermaid's sender id runs past the spelling into one of its own arrows (`A\|-B->>C`), Mermaid reads a message from `A\|-B` to `C`; ours reads the spelling as the arrow, from `A` to `B->>C`, with no warning that Mermaid reads it otherwise. Reading Mermaid's message there was removed: 0 of 106,252 real-world diagrams use the construct. |
| Sequence deactivating an inactive participant | **Keep drawing, ignore the deactivation, and warn (`sequence_inactive_deactivation`).** | Implemented: Mermaid counts activations and rejects a deactivation at zero. The writer keeps the `-`, so that output is still rejected. |
| Sequence text wrapped in quotes | **Draw the text inside the quotes, silently.** Quotes around a name or message are how authors delimit text, as in Flowchart labels. | Implemented: `participant A as "Alice"`, `A->>B: "hi"` and `Note over A: "n"` draw `Alice`, `hi` and `n` in SVG, PNG and ASCII, and facts and `describe` read them the same way (`src/sequence/text.ts`). Mermaid 12.2.0 accepts the source but keeps the quotes in the label (its `parseMessage` only trims and removes a `wrap:` prefix), so it draws `"Alice"`. The typed body and the writer keep the authored quotes, so exported source still draws them in Mermaid. |
| BUG-51: Sankey's `parseFloat` leniency | **Keep strict numeric rejection.** `12x` and `x12` do not specify an unambiguous valid flow value. | The reader retains source as opaque and rendering refuses the invalid value. Upstream accepting a prefix or NaN is not a product requirement. |
| Timeline events on a section line | **Keep the section and attach events to the latest period.** | Implemented: the lexer classifies the section before its event tail. The preceding period retains the event even when it belongs to an earlier section. An event without a prior period is rejected instead of inventing one. |
| Timeline line starting with the word `timeline` | **Read it as a period and warn (`timeline_header_in_body`).** | Implemented: Mermaid's lexer reads the header keyword there (any case) and rejects the line; `timelines` is a period to both. |
| Sankey characters outside printable ASCII | **Keep the text and warn (`sankey_unsupported_character`).** | Implemented: Mermaid's CSV reader rejects a tab or a non-ASCII character in a row. It has no spelling for such a label, so the writer's output stays rejected: its entity prepass turns `#233;` (any `#name;`, after its `style`/`classDef` semicolon strip) into a non-ASCII placeholder its CSV reader rejects, so verify reports a row holding one too (`sankey_unsupported_character`); ours reads and draws the code as written. The same prepass first drops the last `;` of a line where `style` or `classDef` comes before a `:` and a `#` ahead of it, so Mermaid reads `style:x#a;` as `style:x#a`; ours keeps the `;`, verify reports the line (`mermaid_cleanup`), and Mermaid has no spelling that keeps it. `&eacute;` is drawn as literal text by both. A quote inside an unquoted field is refused, as text after a closing quote already was. |
| Sankey spaces around a quoted field | **Trim them, without a warning.** | Mermaid's CSV reader rejects a blank after a comma before a quoted field, after a closing quote, or indenting a row that starts with one (trailing whitespace at the end of the source excepted, which it trims). Ours reads the field; the writer emits no such blanks. The warning (`sankey_quoted_field_spacing`) was removed: 0 of 106,252 real-world diagrams use the construct. |
| Malformed metadata/frontmatter YAML | **Keep rejection.** Do not guess at ambiguous mappings, brackets or tags. | Implemented. The 12.2 scalar rules are current; valid scalar compatibility and the BUG-60 writer round-trip are distinct from malformed-input rejection. |

#### Bounded portable-output choice for extensions

Use the existing structured-or-opaque boundary rather than introduce a second
serializer framework. A newly supplied typed value must have a proven portable
spelling. A readable existing extension without such a spelling stays
source-preserved, carries the portability warning and is refused for any typed
edit that would require regenerating it. Merged writer work implements this boundary for the Quadrant and Architecture
witnesses below; its finite regression set does not cover every extension.

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
| BUG-56: Class style comment | **Accept the source and classify the comment before CSS validation.** | Implemented: `classDef`/`style` paint drops a trailing `%%` comment before CSS validation, so `fill:#f00 %% c` draws red, and COMMENT_DROPPED reports the loss. Mermaid's style token keeps the comment in the value, CSS drops that declaration, and Mermaid draws the default; verify reports `class_style_comment`. |
| BUG-56: Class `A()--B` | **Accept the native lollipop relationship.** | Fixed by merged PR #410: typed, rendered with authored endpoints, editable and portably serialized. The old rejection comparison is obsolete. |
| BUG-56: `classDiagram-v2` | **Accept the supported-family header alias.** | Deferred reader/routing gap: upstream accepts it; ours classifies it as a preserved upstream family and refuses native rendering. Source survives; native support must not be claimed. |
| BUG-56: Quadrant empty far-axis label | **Accept the explicit empty far label.** | Deferred reader gap: `x-axis a -->` is opaque and native rendering throws. Preserve source until implemented. |
| BUG-56: Quadrant semicolon-separated points | **Accept statement separators outside label quotes.** | Deferred reader gap: `A: [0.1, 0.2]; B: [0.3, 0.4]` is opaque and fails rendering. Do not implement this by splitting semicolons inside quoted labels. |
| BUG-56: Architecture extra text and declaration spacing | **Accept the grammar's declaration components and spacing at the shared reader.** | Deferred reader gaps: `service a "text"[A]` and `service a (server) [A]` remain opaque and fail rendering. The 12.2 title-punctuation upgrade did not fix these forms. |

### Implementation after the historical baseline

The table above records the historical baseline. The changes below are
merged. The linked PRs and commit below identify their delivery revisions;
npm publication and hosted delivery remain separate.

- [PR #418](https://github.com/adewale/agentic-mermaid/pull/418) supplies ER order
  preservation after grouped edits (BUG-10/#372) and #367's Journey break-only
  labels, renderable empty edits and YAML scalar/wrapper preservation
  (BUG-47/52/60). The footer follow-up is included. #367's terminal wrapping
  already landed in #394; BUG-9 had a passing owning regression at the baseline.
- Merged #419 completed CONS-46's source implementation. It
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
- #418 and #419 merged, and #372 is closed. The wholesale serializer WIP is
  superseded. REL-1 tracks publication and final release qualification.
- Merged CONS-44 implementation is in
  [PR #416](https://github.com/adewale/agentic-mermaid/pull/416), with family-owned
  config diagnostic hooks and transport schemas projected from existing
  contracts, including native C4's diagnostic hook. Its final-head checks are
  recorded in the PR. It was independent of CONS-46 and completion of these
  grammar dispositions.
- Merged commit `31fb78d` supplies the strict-writer boundaries for BUG-54/58
  and Architecture ID/icon extensions. Quadrant keyword/semicolon labels receive
  grammar-aware quoting and portability warnings. Unsupported styles retain
  source and native rendering with warnings; typed regeneration is refused.
  Architecture extensions use the same source-preserving/refusal distinction.
  The owning agent tests check canonical output against pinned Mermaid and
  retained text/fields through edits. The old “Open” rows above remain dated
  baseline evidence, not current implementation status.
- The Class header alias and Quadrant statement separators from BUG-56 now
  use their native family readers. `classDiagram-v2` remains editable and
  exports the canonical `classDiagram` header. Quadrant separates statements
  outside quoted labels and functional styles, including a separator after
  its header; titles keep their entire physical line. Pinned-Mermaid checks
  cover accepted input and edited canonical output. These source changes do
  not establish publication or hosted delivery.

The #363 investigation is complete independently of those runtime delivery
steps: every original item has a decision and a recorded implementation status.
Closing the investigation does not assert that every reader/export gap is fixed.

Original BUG-54/56/58 remain historical references for the Quadrant portability
and reader decisions in the tables. The original BUG-54/56/58 witnesses have
merged implementations; those historical rows are not an active backlog.
Architecture extensions remain source-only when no portable spelling exists,
and the empty-Class spelling remains an explicit limit. BUG-57 is a
consistent local reading, not a remaining defect. No new issues or parity-only
work are implied by these decisions.

### Sequence participant boxes with fragments

The historical `Header`/`Divider` omission no longer reproduces on current source.
`ascii-sequence-blocks.test.ts` retains the original combined participant-box,
fragment, note, and wide-label witness in both ASCII and Unicode. The shared
Flowchart lexer likewise already owns the parser and source-map quote rules;
its apostrophe/backslash counterexample remains in `agent-source-map.test.ts`.

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

## Community follow-up: empty plans and authored identities

Valid empty Gantt templates render an explicit empty state while verification retains `EMPTY_DIAGRAM`. This deliberately differs from legacy imported no-task render-error expectations and does not fabricate a schedule. Repeated GitGraph commit labels retain all occurrences using separate public identities; source references resolve to the latest preceding occurrence, and an unexpressible typed cherry-pick is rejected. Explicit duplicate merge IDs remain errors. Strict rendering continues to reject raw Mermaid `themeCSS`, whose selectors can alter document geometry outside declarative Style and certified paint.

State class/style assignments to undeclared targets remain pending authored directives and never create phantom nodes; later declarations and typed additions apply them. Lollipop Class endpoints retain independent interface occurrences and authored labels, distinct from ordinary classes with the same spelling. These repairs preserve source meaning rather than reproducing accidental data loss or inventing new diagram syntax.

### Sequence wrapping geometry

`wrap:` / `nowrap:` and the diagram wrap default are semantic controls, not
displayed text. Agentic retains them through parsing and typed edits, including
participant aliases, messages, notes, groups and fragment captions. The controls
are read before entity decoding, so encoded control-looking text stays literal.
Soft wrapping is measured in the output adapter: SVG uses a 240-pixel text budget
and terminal rendering a 40-cell budget (or a smaller requested target). Authored
line breaks survive `nowrap:`. Mermaid's renderer geometry is not the layout
contract; text, explicit controls and their inheritance are.

### Follow-up to #490: constructive Class/State style fields

Class and State now protect style payload delimiters with Mermaid entity codes,
then decode once after the reader classifies field boundaries. They retain exact
RGB/HSL channel spelling and comma-valued fonts, quoted CSS strings, literal
entity/marker text and directive-looking text. Encoding `direction` protects the
whole statement from each lexer's earlier complete-line direction production.
A syntax-space barrier on every property colon prevents a hex paint in one field
from activating the global entity prepass against another field.

Ordered `styleDeclarations` on Class/State nodes and `classDefDeclarations`
on their bodies retain repeated properties when the query record cannot hold
them. This preserves CSS priority and invalid-value fallbacks without evaluating
the cascade. JSON synthesis refuses inconsistent record/list pairs. Class inline
statements append, State inline statements replace, and repeated definitions
append in both families; replacing a style through a mutation replaces its list.
Earlier identical declarations can be removed because their later copy dominates
them. Class's constructor uses an empty ordinary CSS declaration as a lexer prologue
when needed, then preserves the complete authored sequence. The prologue shares
the statement's entity/colon-space barrier and sets no CSS property.

A lone `stroke-width` or `font-family` now uses this empty prologue. Class’s inline
`STYLE ALPHA stylesOpt` production also excludes quoted or keyword targets even
when the class declaration itself can name them. Such inline styles stay
source-only; mutation, synthesis and renaming a styled class refuse that target
domain. Explicit named style-class edits remain available where their own target
grammar applies. Flowchart functional values and Requirement functions or
meaningful spaces still have no demonstrated portable field spelling under the
pin. Invalid XML/control-character values remain outside the writable domain.

### Event Modeling metadata and literal payloads

The shipped Mermaid 12.2.0 / parser 2.0.1 rejects in-body Event Modeling
`title`, `accTitle` and `accDescr`, although the pinned Langium source declares
those productions. Agentic reads them and retains their meaning. Its writer
uses one merged YAML title field and the existing native accessibility-comment
transport. Unrelated wrapper fields and comments survive title edits. Mermaid
accepts that output but currently omits the YAML title from its Event Modeling
SVG and ignores native accessibility comments; Agentic paints the title and
exposes the accessibility envelope. Verification names the accessibility limit.

Event Modeling data is literal content in both graphical and terminal outputs.
The whole authored inline string survives; Agentic does not reproduce the
pinned upstream renderer's reported final-character loss. Reserved grammar
words used as identifiers are generous reads with an `UNSUPPORTED_SYNTAX`
warning. Writers reject them until renamed rather than emit invalid Mermaid.

### Follow-up to #494: generous reads and portable writes

The #548–#552 repairs align direct source rendering with typed admission.
Ishikawa header comments are classified by its native parser. Standalone
repeated Sankey headers are diagnosed and ignored outside quoted CSV records;
header-looking lines inside a quoted field remain payload. Canonical exports
write one header. Malformed CSV data rows still fail explicitly.

Class text escapes greedy `direction TB/BT/RL/LR` tokens before statement
construction. Greedy direction tokens in identities or raw inline members
have no lossless spelling and remain diagnosed source-only reads. Explicitly
empty Class labels and quote-requiring
Quadrant labels starting with a literal backtick have no supported lossless
token in the pinned grammar. They retain native source rendering and a syntax
diagnostic, with typed editing and synthesis refused. Absent Class labels,
nonempty whitespace labels and writable bare Quadrant backticks remain distinct.

Class and C4 can retain an explicitly empty accessibility description, although
Mermaid 12.2.0 rejects its empty `accDescr` block. Verification names that
reader extension. Writers carry the empty value in a native JSON metadata
comment, which our readers restore and Mermaid ignores with its empty default.
The non-empty mutation-input requirement is unchanged.

Kanban labels and implicit identities can contain literal `%%{` text. Writers
shield percent signs with entity codes in labels and IDs, and with YAML hex
escapes in metadata strings, including nested records. The text survives both
preprocessing and native round trips without becoming an init directive.

Kanban metadata retains literal private-marker text such as `ﬂ°°35¶ß`,
including nested keys and values and YAML-escaped spellings. Mermaid's global
entity prepass conflates those keys with authored `#35;` codes; Agentic keeps
their provenance through YAML and shields hashes in portable metadata writes.
Metadata `label` values interpret authored Mermaid codes (`#35;` displays `#`),
whereas `set_task_label` takes literal display text. Literal marker text stays
literal in metadata labels. Keys that collide after restoring authored codes
are rejected, including nested keys, rather than silently losing an entry.
Mermaid accepts these portable writes, but its final display decoder can still
conflate a literal private marker with an entity; Agentic retains the literal
text rather than reproducing that display loss.

Class namespace atoms beginning with a tilde, such as `~` or `~T~A::B`,
remain source-preserved: Mermaid's namespace lexer enters its generic state,
and its namespace DB does not decode an alternative escaped spelling. Tildes
later in an emitted backtick atom remain writable. A Flowchart style containing
the exact raw value `border:1px s:::colid red` likewise remains source-preserved:
Mermaid tokenizes `:::` as a style separator, while accepted backslash or
whitespace alternatives change the stored value. Portable structural writes
refuse these cases instead of changing identities or discarding authored style
text. Version 0.5 retains these three original export restrictions: source-level
editing keeps the authored identities and style fields, together with their
portability diagnostics. It does not invent portable IDs or discard unsupported
fields. The bounded edits, dependency refusals and appended-declaration growth
are described in [source-level editing](../agent-mutation-policy.md); successful
editing does not establish portable canonical export.

GitGraph STRING fields use the pinned Langium escape codec, including escaped
line breaks. Writers shield comment/directive percent signs, entity delimiters
and preprocessing keywords without changing the decoded field. A physical
continuation starting with `%%` therefore no longer requires source-only
admission. This does not extend scene identity admission to control characters
that cannot be rendered safely.

C4 reads titles and accessibility fields inside boundaries as global metadata
and warns that Mermaid requires them at document scope. Portable writes move
them after the header while preserving containment. Mermaid's C4 grammar maps
`accTitle` to its visible title rather than its accessibility-title field;
native Agentic fields remain distinct. Syntactic portability does not remove
that upstream accessibility limitation.

Sequence IDs such as `create)` can be declared in the participant-ID lexer
state but collide with keyword tokens when used as message endpoints. Their
native message reading remains available with `UNSUPPORTED_SYNTAX`; typed
editing stays unavailable for those sources. A leading `loop)` already starts
a block and retains the block-boundary error when no `end` follows. Longer
ordinary IDs such as `created)` remain writable.

### Typed edits publish only what reads back

A typed edit (`mutate`, `mutateChecked`, batches, `applyOps`, MCP `mutate`)
publishes its source only when re-reading that source states the same facts as
the edited body. Otherwise it is refused with `INVALID_OP` naming the facts
that would change. A value a writer cannot spell is refused, never written as
something else. Examples: `%%` in a Pie, Quadrant, Radar, Architecture or
Class title, whose readers keep entity codes literal, so no escape exists;
`<br>` in a Quadrant title or U+2028 in a Gantt title, which re-read as line
breaks a single-line title cannot hold. A Sequence edit that removes the
statement between two preserved segments leaves the one segment a re-read
builds, and Event Modeling's native accessibility comments are read back
decoded, as every other family's are.

### Identities a typed edit introduces

A typed edit writes only identities Mermaid 12.2.0 reads as themselves, even
where our reader is more generous. A Flowchart node id (`add_node`,
`rename_node`, `add_edge`) or subgraph id (`add_subgraph`) must read back as
that id when written as a statement of its own: `A;B`, `A[B]`, `A{B}`, `a b`
and ` A` are refused, as are ids shared with an existing subgraph or node. A
Flowchart classDef name cannot hold `--`, which Mermaid's lexer reads as a
link. A new State name (`add_state`, `rename_state`, `make_composite`,
floating notes) holds no hyphen and is not `default`, `click` or `href`.
Authored names of those shapes are still read, and verify still reports them.
