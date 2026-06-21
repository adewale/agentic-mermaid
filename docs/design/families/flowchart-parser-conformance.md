# Flowchart parser conformance catalogue

Issue: #36. Last updated: 2026-06-16.

Agentic Mermaid's flowchart parser should never silently drop Mermaid source meaning. Each known syntax-range gap below is either supported directly, preserved as opaque source with an `UNSUPPORTED_SYNTAX` verify warning, or tracked as a narrower feature follow-up.

| Construct | Status | Local behavior |
|---|---|---|
| Compact edge syntax: `A-->B`, `A-->|x|B`, `A-- text -->B`, `A-.->B;`, `A---oB` | Supported | Parses nodes/edges without phantom shaft nodes; renders/layouts normally; structured serialization canonicalizes spacing. |
| Compact `&` chains: `A & B--> C & D` | Supported | Parses the documented Cartesian fanout/fanin topology. |
| Same-line semicolon statements: `A-->B; B-->C` | Supported | Splits top-level semicolons outside labels/metadata and parses every statement. |
| Variable-length and invisible links: `---->`, `-..->`, `====>`, `~~~` | Supported | Fixed by PR #30 and pinned in `src/__tests__/link-grammar.test.ts`. |
| Flowchart node metadata: `A@{ shape: ..., label: ... }` | Safety-supported | Agent parse is opaque/source-preserving; legacy render/layout preserves topology and label with rectangle fallback. Full shape vocabulary is #44. |
| Edge IDs: `A e1@--> B` | Preserved + warned | Legacy parser ignores the ID for layout but preserves topology. Agent parse is opaque/source-preserving. `verifyMermaid` emits `UNSUPPORTED_SYNTAX` with `syntax: flowchart_edge_id`. |
| Edge metadata: `e1@{ animate: true }`, `e1@{ curve: natural }` | Preserved + warned | Legacy parser ignores metadata and never creates a phantom `e1` node. Agent parse is opaque/source-preserving. `verifyMermaid` emits `UNSUPPORTED_SYNTAX` with `syntax: flowchart_edge_metadata`. |
| Interaction directives: `click A ...`, `click A href ...`, `href` | Preserved + warned | Ignored by local render/layout for security and geometry; never creates a phantom `click` node. Agent parse is opaque/source-preserving. `verifyMermaid` emits `syntax: flowchart_interaction_directive`. |
| Mermaid markdown strings / multiline markdown labels | Preserved + warned | Backtick-marked flowchart source falls back to opaque and emits `syntax: flowchart_markdown_string`; full markdown label modeling is not implemented. |
| Multiple `classDef` names and escaped commas: `classDef a,b stroke-dasharray: 9\,5` | Supported | Class definitions are expanded per name and escaped commas stay inside style values. |
| Edge class styling / animation via `class e1 animate` | Preserved when paired with edge IDs | The source remains opaque when edge IDs are present. Local layout does not model edge classes/animation yet. |
| Full Mermaid v11 typed-shape vocabulary | Follow-up | Tracked in #44; this issue only ensures no silent loss/phantom nodes. |

Primary regression coverage: `src/__tests__/flowchart-parser-conformance.test.ts`, `src/__tests__/flowchart-metadata.test.ts`, and `src/__tests__/link-grammar.test.ts`.
