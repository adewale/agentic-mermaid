# Railroad

Syntax target: Mermaid 12.2.0, commit `1fb7869866dd619168d840291c9c54b4f129758b`.
The [pinned official syntax](https://github.com/mermaid-js/mermaid/blob/1fb7869866dd619168d840291c9c54b4f129758b/packages/mermaid/src/docs/syntax/railroad.md)
and [domain reference](https://en.wikipedia.org/wiki/Syntax_diagram) establish the
family hallmark: A production is a traversable track: sequences continue, choices branch and rejoin, optional terms have bypasses, and repetitions have return paths.

## Semantics and editing

Four pinned headers select the function-style, EBNF, ABNF or PEG notation.
The shared expression model retains terminals, nonterminals, sequences, choices,
optional expressions and bounded repetitions, together with notation-specific
predicates, exclusions and literal distinctions. Rule order and repeated rule
names remain separate authored occurrences.

Use `asRailroad` after parsing and `describeOps('railroad')` for the current
operation schema. Edits retain the original notation; a definition that cannot
be written in it is rejected. Unsupported source stays opaque rather than
silently losing grammar constructs.

## Placement and limitations

Measured leaves and recursive track placement keep each production's branches
connected. Decorative rails are owned artwork, not fabricated relationships.
A shared rule/expression identity scheme connects source maps, layout and ink.
Terminal output expresses the grammar independently in text; it does not claim
the same pixel-track geometry.

## Executable evidence

The [grammar scenario](../../../eval/layout-compare/fixtures/railroad-native.mmd)
combines sequence, choice, optional and repeated terms. The
[independent citizenship expectations](../../../src/__tests__/helpers/family-conformance-profiles.ts)
assert its exact expression tree and production ownership before and after a
rule replacement.

[Railroad tests](../../../src/__tests__/railroad.test.ts) cover all four
notations, exact-zero repetition, grammar escapes, cycle rejection and connected
branch/return contours. The [operations-style golden](../../../src/__tests__/testdata/styled/railroad-basic.ops-schematic.svg)
shows complete tracks and role typography.

For shared style/configuration rules and cross-output checks, see the
[common rendering and verification contract](README.md#shared-rendering-and-verification).
