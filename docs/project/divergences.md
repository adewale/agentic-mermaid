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
| Flowchart metadata spacing and mixed-stroke arrows | **Keep reading and warn.** Canonicalize the clear metadata attachment or labelled link. | Implemented for `A @{...}`, `A@ {...}` and `A -- b ==> B`: named warnings, portable output and stable facts. |
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
  contracts. Its final-head CI passes; merge remains pending. It is not a dependency of
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
