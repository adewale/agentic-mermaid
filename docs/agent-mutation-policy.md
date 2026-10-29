# Agent mutation policy: structured vs source-level

This note records why the agent surface exposes structured mutation only for modeled syntax, while preserving unmodeled syntax as opaque/source-level bodies even inside otherwise supported families.

## Goal

The agent-native goal is not "make every diagram editable somehow." The goal is:

1. preserve source-provided meaning;
2. never silently drop syntax we do not model;
3. expose typed mutation only when the parser, IR, serializer, and verifier can preserve that meaning;
4. make unsupported structured edits explicit instead of pretending they are safe.

So the rule is:

> Structured mutation is allowed only for modeled syntax. Unknown or lossy syntax must stay source-level/opaque and round-trip through preserved source.

This policy applies to **editing existing diagrams**. For a brand-new diagram, direct Mermaid source authoring is the native path: write source, parse it, verify it, then render or return it. Mutation is a preservation tool, not a required creation ritual.

## What "mutation exposure" means

A family has mutation exposure when public agent surfaces advertise typed structural edits for it, such as:

- library narrowers like `asFlowchart(d)` and `mutate(flow, op)`;
- CLI support through `am mutate --op ...`;
- MCP / Code Mode methods in the SDK declaration;
- `am capabilities` entries with `editPolicy: "structured-when-narrowed"`, `hasMutate: true`, and `mutationOps`;
- docs/examples telling agents which ops to call.

When a particular body does not narrow, agents are not told it can be safely edited through typed ops. The diagram may still parse, render, verify, describe, and serialize; that body just does not get structured mutation.

## Current split

Structured mutation is exposed for every built-in renderable family when its modeled subset narrows. `am capabilities --json` lists each family's narrower and `mutationOps`, and `describeOps(family)` gives the exact op fields; this page does not keep a second roster.

Some families are segment-preserving rather than all-or-nothing: sequence keeps `alt`/`opt`/`loop`/`par` as typed fragments (with their own read-back and mutation ops) while Note/box/critical/activate/autonumber/title ride along verbatim, and its top-level message indices stay separate from fragment-message indices; gantt keeps calendar directives and click/comment lines as verbatim segments; ER keeps ordered typed and opaque-block segments. Only input that cannot be segmented (e.g. an unbalanced `end`) falls back to a whole-body opaque body.

Opaque/source-level bodies:

- any known-family diagram that falls back to an opaque body because it contains unmodeled syntax (e.g. architecture `{group}` boundary modifiers, malformed pie entries, out-of-range quadrant coordinates, or un-segmentable sequence/gantt syntax).

For source-level bodies, the safe loop is:

1. preserve `body.source`;
2. if an edit is explicitly requested, edit the Mermaid text intentionally;
3. re-parse;
4. verify;
5. only then return or serialize.

Ordinary `am mutate` returns `UNSUPPORTED_FAMILY` for those bodies. Explicit
source-preserving mutation supports four bounded operations on opaque inputs:

- Class `add_member`: append an ordinary attribute or method declaration.
- Class `remove_member`: remove an unambiguous member that owns one complete
  physical line, without comments or directives. The index follows authored
  member order, including annotations; selecting an annotation is refused.
- Flowchart `set_label`: append a label override for an existing native node.
- Flowchart `rename_node`: replace owned lexical node identities in declarations,
  endpoints and group membership. Class assignments, styles, click/href
  dependencies and colliding group identities are refused.

These edits retain bytes outside the owned edit ranges and compare the complete
native read-back with the requested change before committing. Unsupported or
ambiguous ownership, dependency changes and semantic mismatches reject the edit
atomically. A repeated label with no semantic change retains the exact source,
including its final newline spelling.

Rename does not rewrite dependent directives. A changing rename refuses sources
with any `class`, `style`, `click` or `href` statement, even when it names another
node. An explicit ID-equal label such as `A[A]` also refuses the change because
the lexical edit would retain a label that ordinary rename changes. These
refusals keep the edit within the scanner's proven ownership.

Appending preserves the complete previous source as a prefix: each changing
Flowchart label adds an override, and each Class member addition adds a reopened
class block. Repeated edits therefore grow the document; this mode does not
compact earlier declarations. Member removal and node rename instead replace
only their owned ranges. Each changing edit still reparses the complete public
diagram and rebuilds its source spans.

```ts
const edited = mutatePreservingSource(diagram, {
  kind: 'set_label', target: 'A', label: 'Reviewed',
})
if (edited.ok) {
  const verification = verifyMermaid(edited.value.diagram)
  if (!verification.ok) throw new Error('verify failed')
  // Inspect warnings and save exact source; do not canonicalize it.
  await save(edited.value.source)
}
```

The result is `{ source, diagram }`. Its exact `source` is the save artifact;
the ordinary serializer may normalize the final newline. The diagram remains
opaque and retains its portability warning. This API does not make invalid
Mermaid syntax portable, admit every member/label payload, or expose opaque
bodies through structural narrowers. Structured inputs should use `mutate`;
the default mutation mode retains its structured-only contract.

The same explicit mode is available through the workflow surfaces:

- Library batches: `applyOps({ source, ops, mode: 'source-preserving' })`.
- CLI: `am mutate diagram.mmd --op '<JSON>' --preserve-source`; JSONL mutation
  requests use `preserveSource: true`.
- Declarative MCP `mutate`: pass `mode: 'source-preserving'` with `source` and
  `ops`.
- Code Mode: `mermaid.mutatePreservingSource(diagram, op)` returns the same
  `{ source, diagram }` result as the library. Returning that successful result
  or its diagram produces a verified envelope with the exact edited source.
- Editor adapter: programmatic `applyOps(source, ops, 'source-preserving')`
  queues the edit in the persistent worker; it does not add an editor control.

Batch success includes `mode: 'source-preserving'` and verification diagnostics.
A failed batch emits no edited source, even when earlier operations succeeded.
Builders have no original source and do not accept this mode. These entrypoints
do not remove the portability warning or promise portable Mermaid export.

## Why not every syntax construct?

Because "structured mutation" is a much stronger promise than parsing enough to render.

To expose one safe mutation op for a family, we need all of this:

- a parser that fully understands the syntax subset it accepts;
- an IR that stores all semantic details needed for edits;
- stable identifiers for edited elements;
- a serializer that can re-emit equivalent Mermaid without dropping constructs;
- verification that can inspect labels/emptiness/structure for both structured and opaque paths;
- tests proving parse → serialize → parse stays stable;
- CLI/MCP/docs/capability declarations that match the implementation.

Many Mermaid families are not one grammar. They are a mix of family syntax, directives, frontmatter, comments, accessibility blocks, style/config overlays, renderer conveniences, aliases, and syntax that Mermaid accepts but normalizes internally. Some constructs are also semantically important but hard to preserve if the IR does not model them exactly.

A partial structured parser is dangerous: it can make unsupported syntax disappear. For example, if we parse only the pieces we know and serialize from that partial IR, we can drop source-provided meaning. That is worse than refusing typed mutation, because the agent would produce a plausible-looking but semantically changed diagram.

External AST libraries do not automatically solve this. A render-oriented AST may canonicalize, normalize, omit comments/directives, or fail to preserve byte/source fidelity. We specifically need an **editing AST**, not just a render AST.

## What we have achieved

We have achieved the safety goal for the current surface:

- opaque fallback bodies round-trip through preserved source instead of lossy structured IR;
- public capabilities match the implementation: every built-in renderable family reports `structured-when-narrowed`, with source-level editing reserved for opaque fallback bodies;
- Code Mode, CLI, docs, MCP SDK declarations, and tests agree on the same public surface;
- the registry, live editor examples, eval manifest, generated `llms.txt`, and generated `am init-agent` snippets are now checked together so new family support cannot silently skip an agent-facing surface.

That is a success for semantic preservation, even though it is less convenient than pretending every Mermaid construct has a typed edit op.

## How an opaque path graduates

An opaque fallback path can become structurally mutable only when a scoped implementation satisfies the same bar:

1. define the syntax subset to model;
2. reject/fall back to opaque for everything outside that subset;
3. add typed body types and mutation ops;
4. serialize without semantic loss;
5. prove round-trip stability with tests and corpus examples;
6. update CLI/MCP/capabilities/docs together.

Until then, opaque/source-level editing is the honest behavior for that body.


## Comments and transaction boundaries

Flowchart and State body comments are retained in metadata beside semantic
statement identities. Serialization re-emits safe standalone `%%` comments;
inline placement may normalize. If an edit removes an anchor, its comment is
retained at the end rather than discarded. Leading wrapper bytes retain their
existing verbatim contract. Other families keep their existing segmented/opaque
policies and report any known loss.

Declarative edits, CLI batches, and builders apply checked operations to private
intermediate bodies, then serialize and reparse once at commit. A failed operation
returns its index and emits no edited source; the original diagram stays untouched.
Single public `mutate` calls retain parser-closure checks at each call boundary.
