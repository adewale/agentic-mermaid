# Correctness problems and deliberate differences

Agentic Mermaid must keep the author's meaning through reading, rendering,
editing and writing. A difference from Mermaid becomes a product defect when
it breaks that contract. A benchmark disagreement alone does not establish a
defect.

The rule owner is [CLAUDE.md, “Mermaid is our input language, not our
spec”](../../CLAUDE.md#mermaid-is-our-input-language-not-our-spec). This document
explains that rule using the existing family decisions and the eight-family
review in PR #601. It adds no parity gate, exclusion list or second backlog.
[Divergences](divergences.md) records deliberate behavior;
[testing strategy](../testing-strategy.md#3-derived-oracles--differential-corpora)
defines what the independent reference checks establish.

## What makes a correctness problem legitimate

Describe the failure without referring to Mermaid's private implementation.
For example, “copying the published canonical source moves this child to the
root” establishes a defect. “Mermaid's database returns a different AST object”
needs further investigation.

A legitimate problem has an observable consequence:

- Authored identities, text, values, memberships, relationship directions or
  other domain meaning are lost, changed or invented.
- Source rendering, a typed body, checked edits, serialization, reload or
  terminal output disagree about that meaning. Output-specific layout can
  differ while preserving the same relationships.
- A structured writer produces source the pinned Mermaid cannot read, or
  reload changes the modeled meaning. A failed edit must leave the original
  diagram intact.
- Parsing or rendering crashes, fails to terminate, crosses the work/security
  limits, or attributes a public source position to the wrong authored token.
- Verification silently certifies a substituted or unmodeled feature. An
  accurately warned extension or source-only result has a narrower contract.
- The drawing misrepresents its own domain: a Packet interval has the wrong
  length, a quantitative area encodes the wrong value, or a connector attaches
  to the wrong participant. Mermaid's pixels are unnecessary to establish it.

The fix belongs at the producer that lost the distinction, with a regression
at the public boundary that consumes it. A model need not retain every lexer
detail: retain the information required by its documented behavior, and keep
unmodeled source explicitly preserved.

## What is illegitimate as a product-fix demand

These are valid benchmark observations, but do not by themselves justify
changing the product:

- Matching Mermaid's database mutation methods, parser callbacks, singleton
  state, internal AST tables, generated IDs or publication after rejection.
  If an equivalent native field exists, the benchmark should observe it
  honestly. Missing information must remain unsupported.
- Copying an English error message, caret layout, Jison `.hash` or YAML
  library `.mark`. Our declared error class and authored coordinates still
  have to be correct.
- Reproducing Mermaid's layout, sanitizer losses, shape-name aliases or
  incidental ordering. Our own rendering, safety and ordering contracts remain
  testable.
- Dropping authored content because upstream drops it. Retained State floating
  notes and Cynefin self-transitions are examples of deliberate preservation.
- Rejecting clear input merely because Mermaid rejects its spelling. Read
  generously and use the existing portability diagnostic where required;
  reject ambiguous intent and invalid values. Typed writers must still emit a
  portable representation or refuse the edit atomically.
- Preserving an exact indentation width, redundant expression wrapper or
  equivalent icon spelling when it changes neither meaning nor a promised
  source-fidelity contract. Structural indentation that encodes a parent is
  different: flattening the hierarchy is a defect.

Default serialization can return preserved unsupported source. It does not
certify that the input is portable. Structured construction and canonical
writing have the stricter output contract. An opaque body must disclose its
limits and refuse typed edits it cannot perform faithfully; opaque fallback
does not excuse a structured writer that generates invalid source.

A parsed diagram's public `canonicalSource` is an executable family projection:
copying it must preserve the native reading, including structural indentation.
It can retain a generous input spelling. That field alone is not a certificate
of external Mermaid acceptance; use the structured writer and its validation
for portable generated output.

## How earlier family fixes establish the distinction

The [input investigation](divergences.md#mermaid-input-decisions-363), its
[real-input cost review](divergences.md#policy-and-shared-causes), the
[stable-family decisions](divergences.md#stable-family-semantic-choices-mermaid-1220)
and the [family notes](../design/families/README.md) provide the precedents.
The current implementation and owning tests determine delivery; dated rows
in those records retain their historical revisions.

| Earlier decision | Correctness obligation | Difference we deliberately allow |
|---|---|---|
| Flowchart, Class, State and ER identity/text/style repairs | Keep Unicode identities, repeated paint and unrelated editable content. | Shape-name aliases, sanitized HTML and exact diagnostic prose. |
| Sequence and ZenUML interactions | Keep participants, calls, returns, messages and control scopes; shield field text from becoming syntax. | Different lifeline geometry and renderer configuration timing. |
| Architecture and Event Modeling ownership | Keep declared containers, endpoint sides, frame sources and reset semantics. | Container placement and generated drawing IDs can differ. |
| Mindmap and Ishikawa hierarchy; Timeline and Journey grouping | Keep parents, cause/effect, periods, events and actor assignments through edits and reload. | Indentation width and display whitespace can normalize when the relationships and text remain intact. |
| XYChart, Pie, Quadrant, Radar and Sankey data | Keep axes, categories, values, coordinates, labels and flow quantities. | Mermaid's drawing and callback/`yy` protocol are separate interfaces. |
| Gantt scheduling | Resolve the represented task dependencies and calendar rules consistently, retaining authored task data. | Database helper methods and renderer-resolved fields need not be parser fields. |
| Packet and Block geometry | Conserve exact inclusive intervals and authored cells/spans; draw genuine endpoint-connected routes. | Mermaid's erroneous internal bit metadata and automatic placement are not targets. |
| Kanban and Treemap identity | Keep duplicate authored occurrences, hierarchy, values and independently editable records. | Generated occurrence-ID spelling and value-sorted placement are implementation choices. |
| Requirement and C4 domain/security | Keep relationship kinds, field values and boundaries; export valid positional arguments and safe inert actions. | Callback execution, host-dependent wrapping and generated CSS are not required. |

This review applies those same obligations to AgentFlow roles and scopes,
TreeView hierarchy, UseCase relationships, Railroad expressions, Wardley
coordinates, Cynefin transitions, Venn memberships and Swimlane handoffs.
They do not receive a stricter Mermaid-internals contract because their
specifications were ported more directly.

## Classifying the new-family benchmark gaps

The review starts from candidate `9fceb4c2065b9b17b7b6ef550e50ec8c8d2f703f`
against Mermaid 12.2.0, source
`1fb7869866dd619168d840291c9c54b4f129758b`. There are 513 qualified complete
original tests: 339 pass, 13 fail and 161 are unsupported. Swimlane has no
qualified original case; its independent semantic witnesses stay separate.
These counts are evidence for this revision, not a maintained capability roster.

| Family | Recorded nonpasses | Disposition under the existing policy |
|---|---|---|
| AgentFlow | 11 failed, 40 unsupported | Literal `%%` retention and declared lexical ownership are deliberate. A bare node and an explicitly labeled default rectangle can share a semantic shape. Database and exact diagnostic interfaces are parity-only demands. Incorrect public coordinates or silent substitution of an authored unsupported shape are legitimate defects, regardless of whether fixing them passes a test demanding `.hash` or an English message. |
| Cynefin | 2 failed, 10 unsupported | Keep authored self-transitions rather than copying upstream filtering. The ten unsupported database-method cases do not establish missing transition semantics. |
| Railroad | 22 unsupported | Eleven request database methods; four inspect expression wrappers that normalize to the same expression; seven expect rejection where default parsing preserves invalid source with explicit diagnostics. None alone establishes missing valid syntax. Lost accessibility fields across our own render/edit surfaces are a legitimate independent defect. |
| TreeView | 26 unsupported | Sixteen request database methods, eight inspect written indentation width and two distinguish equivalent no-icon spellings. Those demands are parity-only. Losing parentage when copying canonical source is a legitimate defect. |
| UseCase | 60 unsupported | Forty-four inspect database publication after rejection and three request database model creation. Seven request alternate normalized AST tables and six renderer-derived fields. Native data already retains labels, relationships, animation and source occurrences; any actual loss of these fields would remain a defect. |
| Venn | 3 unsupported | Invalid identifier/union inputs are explicitly preserved and diagnosed, with rendering refused. A default opaque result is not a false native model or a promise that those inputs are valid. |
| Wardley | No recorded nonpasses | The qualified suite supplies no remaining defect. It cannot prove exhaustive syntax or density support. |
| Swimlane | No qualified original cases | This is an evidence gap. Use independently qualified semantic witnesses; do not infer perfection or add them to the upstream denominator. |

The 161 unsupported cases comprise 93 database/API/state contracts, 24
diagnostic contracts, 28 model-representation or authored-spelling distinctions,
six renderer-derived fields and ten invalid-input preservation cases. These
are first blocking observations. A complete case can contain later assertions
that have not run, so the classification is not a prediction of extra passes.

The three literal-percent failures, containment failure and two self-loop
failures describe intentional semantics. The other seven failed cases inspect
diagnostic interfaces or formatting; the investigation must still verify our
actual public positions independently. A compatibility-only assertion can
therefore expose a genuine underlying defect without being an appropriate
regression oracle for its repair.

## Product defects found by following the gaps

The review found defects beyond the first blocked benchmark assertion:

- TreeView's published canonical source removed structural indentation.
  Copying it flattened children. The same assumption affected Mindmap and
  Ishikawa. All three now use the existing descriptor-owned preserved-source
  policy. Their owning tests check nested and sibling membership after copying
  canonical source, as well as SVG/terminal correspondence. Mindmap diagnostics
  still use physical positions when a root shares its header line.
- Railroad parsed accessibility fields but omitted them from its registered
  body and native SVG, and an unrelated title edit discarded them. Its existing
  body metadata adapter and field writer now retain those fields. The shared
  accessibility block reader preserves internal paragraph breaks, matching the
  existing mutation normalizer. Railroad's classified description token uses
  that retained-line interpretation; other grammar callers keep their default.
  Unrepresentable writes fail atomically instead of silently dropping text.
- AgentFlow delegated grammar errors used folded Flowchart positions after
  metadata removal. They now retain the error type while reporting the actual
  AgentFlow family and authored location, through wrappers and line endings.
- AgentFlow's role classifier missed supported shape aliases and could let an
  empty/falsy metadata shape erase a declared role. It now uses the existing
  shared shape authority. A genuinely substituted unsupported shape is reported
  through verification, with the authored metadata retained. This does not
  emulate Mermaid's diagnostic database.

The regression owners are [Mindmap](../../src/__tests__/mindmap-agent-ops.test.ts),
[Ishikawa](../../src/__tests__/ishikawa-native.test.ts),
[TreeView](../../src/__tests__/treeview-native.test.ts),
[Railroad](../../src/__tests__/railroad.test.ts),
[AgentFlow](../../src/__tests__/agentflow.test.ts) and
[shared accessibility](../../src/__tests__/renderer-accessibility.test.ts).
The seven UseCase AST witnesses were also followed through native parsing,
canonical-copy parsing, export/reload and an unrelated title edit. Their
represented meaning survives; adding an alternate database-shaped AST would
not repair a demonstrated product defect.

## Evidence for repairs and comparisons

Protect repairs with independently stated fields and relationships, portable
output checks and parse/edit/write/reload correspondence. For hierarchy,
include a grandchild and a sibling so flattened output cannot pass by keeping
only node counts. For accessibility, inspect the parsed body, emitted SVG
metadata and an unrelated edit. For errors, point at the actual authored token
through wrappers and transformed grammar rows.

Keep the original cross-project benchmark unchanged. Report passed, failed,
unsupported, blocked and reference-unqualified results separately, with pinned
packages and complete-case denominators. A project-specific filtered score
would conceal the API differences this document explains. Native contract
witnesses complement the comparison; they do not replace its denominator.

Before/after correctness, runtime, allocation, retained memory and shipped
bytes belong with the measured candidate in the PR and benchmark artifacts.
Do not encode this triage as another exclusion inventory or claim that passing
a finite corpus closes every possible correctness problem.
