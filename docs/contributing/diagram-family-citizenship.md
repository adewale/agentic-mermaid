# Diagram-family citizenship ratchet

Issue: #41. Status: enforced checklist + checked matrix.

A diagram family is a **good citizen** when it is faithful before it is ubiquitous: it accounts for Mermaid's documented stable syntax, preserves the recognizable domain metaphor, and is then integrated into every runtime, documentation, agent, editor, eval, and distribution surface that teaches users or agents what Agentic Mermaid supports. Rendering is not enough: a family must be discoverable, safely editable, verifiable, represented in examples/evals, syntax-audited, and visually recognizable.

## Source of truth

The `FamilyDescriptor` registry in `src/agent/families.ts` is the canonical runtime authority for identity, detection, discovery metadata, and behavioral hooks. The built-in `DiagramKind` union stays closed and exhaustive; namespaced `family:<owner/name>` extensions are open and collision-checked. `BUILTIN_FAMILY_METADATA` is a frozen compatibility projection of the built-in descriptors, not a second registry. Tests project that authority into CLI capabilities, MCP/Code Mode, docs, editor examples, eval fixtures, package keywords, and generated discovery docs.

The version-pinned upstream inventory lives at [`upstream-mermaid-manifest.json`](../project/upstream-mermaid-manifest.json). It records every public Mermaid family/header separately from native Agentic Mermaid support, including unsupported and inventory-only dialects. Every family owns exactly one hashed official syntax page, heading-level feature inventory, deduplicated official example inventory, and explicit introduction/deprecation accounting (`declared` or `not-declared`). Upgrade work must regenerate its provenance/hash and review the machine-readable diff before changing any native claim; an upstream header is never silently treated as Flowchart. Runtime detection imports only the generated compact family index, never the semantic corpus.

The checked citizenship matrix lives at [`diagram-family-citizenship.matrix.json`](./diagram-family-citizenship.matrix.json). It is intentionally separate from the registry: the registry says “this family ships”; the matrix says “these citizenship surfaces are satisfied, these Mermaid/Wikipedia fidelity claims are evidenced, and these remaining gaps are tracked.” The human-readable registry-wide audit is [`mermaid-family-fidelity-audit.md`](../design/mermaid-family-fidelity-audit.md).

## Semantic correctness vs. system citizenship

Keep these distinct in reviews:

- **Semantic correctness** asks whether a parser/IR/serializer/verifier/renderer preserves the family’s own Mermaid meaning. Examples: Gantt schedule resolution, flowchart route certificates, sequence segment preservation, pie percentage invariants, XY axis/domain laws.
- **Syntax parity** asks whether every stable construct in the pinned Mermaid documentation has an executable semantic outcome. Parse-only, source-preserved-only, flattened, warned, or ignored syntax is not native support.
- **Visual metaphor** asks whether the rendered structure remains recognizably the domain diagram described by Mermaid and a Wikipedia/domain reference. A Mindmap must have a central idea and radiating hierarchy; generic boxes connected by lines do not satisfy that contract.
- **System citizenship** asks whether every supported entry point points to the same typed path. Examples: `am capabilities`, `llms.txt`, `am init-agent`, MCP initialize guidance, SDK declarations, Code Mode sandbox narrowers, editor examples/glyphs, eval fixtures, generated site samples, package exports, and docs tables.

A new family can be semantically good and still fail citizenship if an agent discovering the package through a different surface cannot find the same parse → narrow → mutate → verify → serialize path.

## Checklist surfaces

The matrix has one cell per family for each surface below. A cell is either `satisfied` with concrete evidence paths, or `exception` with a tracked TODO/issue reference. CI fails if a registered family is missing a row, a surface, evidence, or exception tracking.

| Surface | Contract |
|---|---|
| `registryDiscovery` | Family appears in the `FamilyDescriptor` authority, its derived built-in metadata projection, CLI capability metadata, and typed IDs. |
| `detectionParse` | Shared detector, agent parse, SVG render, ASCII render, CLI, and MCP paths route consistently; state’s flowchart renderer split is the only documented exception. |
| `semanticModel` | Modeled syntax subset and opaque/source-preservation ladder are explicit. |
| `serializeRoundTrip` | Modeled syntax has parse → serialize → parse stability; opaque/segment-preserved syntax round-trips losslessly. |
| `typedMutation` | A public narrower and mutation ops exist, and opaque fallback bodies do not fake structured mutation. |
| `verifyRenderSeam` | Modeled syntax has no “verify ok, render throws” path; render-blocking conditions surface as named warnings/errors. |
| `determinism` | No ambient wall clock/random/locale/process-order dependence; runtime knobs such as `ganttToday` are explicit. |
| `svgRender` | SVG/PNG-capable rendering path is covered for the family. |
| `asciiUnicodeRender` | ASCII/Unicode output is covered when advertised. |
| `layoutProjection` | `layoutMermaid`, quality metrics, and verify layout expose truthful geometry, not placeholder data. |
| `stableRegions` | Region metadata for editor/TUI/accessibility is present or explicitly tracked as a gap. |
| `editorExample` | Live editor has a working `Supported diagrams` example and explicit glyph for the family. |
| `docsAgentSurfaces` | README/docs/spec/skills/agent instructions/SDK declaration/llms surfaces stay in sync. |
| `evalFixture` | Shared skill benchmark has at least one fixture-backed case tagged `family:<id>`. |
| `upstreamHarvest` | Official upstream Mermaid examples/tests are harvested into an executable docs corpus, family bench, or accounted parser/DB bench. |
| `divergenceLedger` | Known compatibility divergences in harvested upstream examples/tests are executable and cannot rot, or tracked for ledger work. |
| `mermaidSyntaxParity` | The pinned Mermaid docs inventory is complete; every stable construct is natively semantic or a named, tested security/offline divergence. Parser acceptance alone does not satisfy this cell. |
| `domainProperties` | Family-specific invariants/properties exist beyond “renders without throwing.” |
| `familyVisualMetaphor` | Mermaid plus a Wikipedia/domain reference define a hallmark protected by independent geometry/semantic tests and a reviewer-visible artifact. |
| `goldensEvidence` | Text/SVG/visual evidence exists where reviewer judgment needs artifacts. |
| `generatedSite` | Site samples/gallery/generated docs include the family or have explicit exceptions. |
| `distributionPackage` | Package exports/files/consumer init artifacts include the public family surface. |

## Worked example: Gantt

Gantt is the bar for a new family entering the system:

- registry + mutation: `BUILTIN_FAMILY_METADATA`, `asGantt`, typed Gantt ops, CLI capabilities, SDK declaration, MCP sandbox, and `am init-agent` all expose the same path;
- semantics: `src/gantt/parser.ts`, `src/gantt/schedule.ts`, `src/gantt/layout.ts`, and `src/agent/gantt-body.ts` keep scheduling pure and wall-clock-free;
- verify/render seam: `UNRESOLVABLE_SCHEDULE` turns render-blocking schedule failures into named verification output;
- compatibility: `eval/mermaid-gantt-bench/` has cases plus executable exclusions; `src/__tests__/gantt-upstream-bench.test.ts` runs it;
- properties: `src/__tests__/property-gantt-schedule.test.ts` includes the CPM shadow-model property;
- evidence: SVG snapshots, ASCII/Unicode goldens, and `docs/assets/improvements/gantt-family.png` cover reviewer-visible paths;
- editor/skill-evals/docs: editor examples, eval fixtures, docs, `llms.txt`, and MCP/Code Mode surfaces are all registry-checked.

## Non-Gantt audit: XY chart

XY chart proves the checklist works for an older family that was promoted after the registry existed:

- citizenship surfaces are satisfied for registry, detection, typed mutation (`asXyChart`), CLI/MCP docs, editor examples, eval fixtures, generated site samples, package exposure, SVG/ASCII output, and layout projection;
- semantic correctness is pinned by parser/integration/layout/renderer tests and `src/__tests__/property-xychart.test.ts`;
- stable region citizenship is satisfied through `src/__tests__/agent-ascii-meta.test.ts`;
- upstream-docs harvest/divergence citizenship is satisfied through the regenerated `eval/mermaid-docs-corpus/corpus.json`, executable `divergences.json` ledger, `eval/mermaid-gantt-bench/`, and the fully accounted cross-family parser/DB bench in `eval/mermaid-upstream-suite-bench/`.

This is the intended ratchet shape: historical gaps are either closed or represented by a live checked cell. After the BUILD-22 backfill, the matrix has zero exceptions; if a future family introduces one, it must be tracked before merge.

## Review workflow

When adding or changing a family:

1. Add/update the built-in `FamilyDescriptor` seed first; `BUILTIN_FAMILY_METADATA` derives automatically. External families use a validated `family:<owner/name>` id and `registerFamily`. Update the pinned upstream manifest only when the upstream inventory or support classification changes.
2. Add/update parser, renderer, agent body, mutation ops, verify behavior, and examples.
3. Map the family to exactly one pinned official Mermaid syntax page. The generator accounts for all headings/examples; promote every stable construct claimed native to executable fixtures, and do not count parse-only or opaque preservation as support.
4. Cite Mermaid and a Wikipedia/domain reference, name the family hallmark, add an independent invariant, and commit a generated screenshot with a captioned PR Visual Evidence row.
5. Update the citizenship matrix row—including `mermaidSyntaxParity`, `familyVisualMetaphor`, and its `fidelity` record—in the same PR. These two surfaces cannot be deferred for a newly registered family.
6. Run `bun test src/__tests__/diagram-family-citizenship.test.ts src/__tests__/agent-doc-sync.test.ts src/__tests__/editor-examples.test.ts src/__tests__/cli-capabilities.test.ts` before wider validation.
7. For any other matrix exception introduced by the PR, add a follow-up issue or `TODO.md` entry before merge.
