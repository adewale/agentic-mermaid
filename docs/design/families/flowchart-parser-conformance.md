# Flowchart parser conformance catalogue

Issue: #36. Last updated: 2026-07-13.

Agentic Mermaid's flowchart parser should never silently drop Mermaid source meaning. Each known syntax-range gap below is either supported directly, preserved as opaque source with an `UNSUPPORTED_SYNTAX` verify warning, or tracked as a narrower feature follow-up.

| Construct | Status | Local behavior |
|---|---|---|
| Compact edge syntax: `A-->B`, `A-->|x|B`, `A-- text -->B`, `A-.->B;`, `A---oB` | Supported | Parses nodes/edges without phantom shaft nodes; renders/layouts normally; structured serialization canonicalizes spacing. |
| Compact `&` chains: `A & B--> C & D` | Supported | Parses the documented Cartesian fanout/fanin topology. |
| Same-line semicolon statements: `A-->B; B-->C` | Supported | Splits top-level semicolons outside labels/metadata and parses every statement. |
| Variable-length and invisible links: `---->`, `-..->`, `====>`, `~~~` | Supported | Fixed by PR #30 and pinned in `src/__tests__/link-grammar.test.ts`. |
| Flowchart node metadata: `A@{ shape: ..., label: ... }` | Supported | Shape/label-only metadata parses structurally; all documented v11 shape names/aliases normalize to semantic ids, with exact existing geometry or an announced compatible substitution. |
| Edge IDs: `A e1@--> B` | Supported | Edge identity is structured, serialized, and exposed in semantic output without changing topology. |
| Edge metadata: `e1@{ animate: true }`, `e1@{ curve: natural }` | Modeled | The closed `animate`/`animation`/`curve` vocabulary parses and serializes structurally without phantom nodes. Static outputs retain animation metadata and use a deterministic dashed projection; active SVG animation is forbidden by the output-security policy. Unknown keys stay source-preserved and warned. |
| Interaction directives: `click A ...`, `click A href ...`, `href` | Safe subset modeled | Safe `http(s)`/`mailto` targets serialize and render as inert `data-href` metadata; callbacks and unsafe targets remain source-preserved and warned, and are never executable. |
| Mermaid markdown strings / multiline markdown labels | Rendered + source-preserved | Backtick-marked source renders bold/italic runs, breaks, and measured wrapping; the agent body remains opaque for byte-preserving round-trip and emits `syntax: flowchart_markdown_string` to announce that typed mutation is unavailable. |
| Multiple `classDef` names and escaped commas: `classDef a,b stroke-dasharray: 9\,5` | Supported | Class definitions are expanded per name and escaped commas stay inside style values. |
| Edge class styling / animation via `class e1 animate` | Preserved when paired with edge IDs | The source remains opaque when edge IDs are present. Local layout does not model edge classes/animation yet. |
| Full Mermaid v11 typed-shape vocabulary | Supported | Issue #44's canonical names and aliases are accepted; semantic intent survives serialization and appears in SVG metadata even where geometry uses a documented substitute. |

Primary regression coverage: `src/__tests__/flowchart-parser-conformance.test.ts`, `src/__tests__/flowchart-metadata.test.ts`, and `src/__tests__/link-grammar.test.ts`.
