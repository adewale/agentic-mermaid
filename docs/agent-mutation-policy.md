# Agent mutation policy: structured vs source-level

This note records why the agent surface does **not** expose structured mutation for every Mermaid diagram family, even though all supported families should parse/render/verify/round-trip safely.

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

Removing mutation exposure means agents are no longer told that a family can be safely edited through typed ops. The diagram may still parse, render, verify, describe, and serialize; it just does not get structured mutation.

## Current split

Structured mutation is exposed for families where the in-tree model is strong enough:

- flowchart/state;
- simple sequence;
- timeline;
- class;
- ER.

Source-level only:

- journey;
- xychart;
- architecture;
- any known-family diagram that falls back to an opaque body because it contains unmodeled syntax.

For source-level bodies, the safe loop is:

1. preserve `body.source`;
2. if an edit is explicitly requested, edit the Mermaid text intentionally;
3. re-parse;
4. verify;
5. only then return or serialize.

`am mutate` should return `UNSUPPORTED_FAMILY` for those bodies.

## Why not all diagram types?

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

- unsupported families round-trip through preserved source instead of lossy structured IR;
- public capabilities no longer overclaim journey/xychart structured mutation;
- Code Mode, CLI, docs, MCP SDK declarations, and tests agree on the same public surface;
- timeline structured mutation remains exposed, but now updates `canonicalSource`, validates mutation text more strictly, allocates unique IDs, and falls back to opaque for header suffix/lossy syntax.

That is a success for semantic preservation, even though it is less convenient than exposing edits everywhere.

## How a source-level family graduates

A source-level family can become structurally mutable only when a scoped implementation satisfies the same bar:

1. define the syntax subset to model;
2. reject/fall back to opaque for everything outside that subset;
3. add typed body types and mutation ops;
4. serialize without semantic loss;
5. prove round-trip stability with tests and corpus examples;
6. update CLI/MCP/capabilities/docs together.

Until then, source-level is the honest behavior.
