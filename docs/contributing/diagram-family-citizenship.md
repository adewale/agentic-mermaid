# Diagram-family citizenship ratchet

Issue: #41. Status: enforced checklist + checked matrix.

A diagram family is a **good citizen** when it is integrated into every runtime, documentation, agent, editor, eval, and distribution surface that teaches users or agents what Agentic Mermaid supports. Rendering is not enough: a family must be discoverable, safely editable when its modeled body narrows, verifiable before render, represented in examples/evals, and either backed by evidence or tracked as an explicit exception.

## Source of truth

`BUILTIN_FAMILY_METADATA` in `src/agent/families.ts` is the canonical shipped-family registry. It records the family id, label, Mermaid headers, typed narrower, live-editor example id/type, and editor glyph. The registry has compile-time coverage against `DiagramKind`; tests then project it into CLI capabilities, MCP/Code Mode, docs, editor examples, eval fixtures, package keywords, and generated discovery docs.

The checked citizenship matrix lives at [`diagram-family-citizenship.matrix.json`](./diagram-family-citizenship.matrix.json). It is intentionally separate from the registry: the registry says “this family ships”; the matrix says “these citizenship surfaces are satisfied, and these remaining gaps are tracked.”

## Semantic correctness vs. system citizenship

Keep these distinct in reviews:

- **Semantic correctness** asks whether a parser/IR/serializer/verifier/renderer preserves the family’s own Mermaid meaning. Examples: Gantt schedule resolution, flowchart route certificates, sequence segment preservation, pie percentage invariants, XY axis/domain laws.
- **System citizenship** asks whether every supported entry point points to the same typed path. Examples: `am capabilities`, `llms.txt`, `am init-agent`, MCP initialize guidance, SDK declarations, Code Mode sandbox narrowers, editor examples/glyphs, eval fixtures, generated site samples, package exports, and docs tables.

A new family can be semantically good and still fail citizenship if an agent discovering the package through a different surface cannot find the same parse → narrow → mutate → verify → serialize path.

## Checklist surfaces

The matrix has one cell per family for each surface below. A cell is either `satisfied` with concrete evidence paths, or `exception` with a tracked TODO/issue reference. CI fails if a registered family is missing a row, a surface, evidence, or exception tracking.

| Surface | Contract |
|---|---|
| `registryDiscovery` | Family appears in `BUILTIN_FAMILY_METADATA`, registered plugins, CLI capability metadata, and typed IDs. |
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
| `domainProperties` | Family-specific invariants/properties exist beyond “renders without throwing.” |
| `goldensEvidence` | Text/SVG/visual evidence exists where reviewer judgment needs artifacts. |
| `generatedSite` | Site samples/gallery/generated docs include the family or have explicit exceptions. |
| `distributionPackage` | Package exports/files/consumer init artifacts include the public family surface. |
| `mutationLane` | Targeted mutation/sabotage lane exists, or a tracked exception explains the gap. |

## Worked example: Gantt

Gantt is the bar for a new family entering the system:

- registry + mutation: `BUILTIN_FAMILY_METADATA`, `asGantt`, typed Gantt ops, CLI capabilities, SDK declaration, MCP sandbox, and `am init-agent` all expose the same path;
- semantics: `src/gantt/parser.ts`, `src/gantt/schedule.ts`, `src/gantt/layout.ts`, and `src/agent/gantt-body.ts` keep scheduling pure and wall-clock-free;
- verify/render seam: `UNRESOLVABLE_SCHEDULE` turns render-blocking schedule failures into named verification output;
- compatibility: `eval/mermaid-gantt-bench/` has cases plus executable exclusions; `src/__tests__/gantt-upstream-bench.test.ts` runs it;
- properties: `src/__tests__/property-gantt-schedule.test.ts` includes the CPM shadow-model property;
- evidence: SVG snapshots, ASCII/Unicode goldens, `docs/assets/improvements/gantt-family.png`, and `mutation-test:gantt` cover reviewer-visible and sabotage paths;
- editor/skill-evals/docs: editor examples, eval fixtures, docs, `llms.txt`, and MCP/Code Mode surfaces are all registry-checked.

## Non-Gantt audit: XY chart

XY chart proves the checklist works for an older family that was promoted after the registry existed:

- citizenship surfaces are satisfied for registry, detection, typed mutation (`asXyChart`), CLI/MCP docs, editor examples, eval fixtures, generated site samples, package exposure, SVG/ASCII output, and layout projection;
- semantic correctness is pinned by parser/integration/layout/renderer tests and `src/__tests__/property-xychart.test.ts`;
- mutation-testing citizenship is satisfied through `mutation-test:families`, which mutates `src/xychart/*` together with Architecture;
- stable region citizenship is satisfied through `src/__tests__/agent-ascii-meta.test.ts`;
- upstream-docs harvest/divergence citizenship is satisfied through the regenerated `eval/mermaid-docs-corpus/corpus.json`, executable `divergences.json` ledger, `eval/mermaid-gantt-bench/`, and the fully accounted cross-family parser/DB bench in `eval/mermaid-upstream-suite-bench/`.

This is the intended ratchet shape: historical gaps are either closed or represented by a live checked cell. After the BUILD-22 backfill, the matrix has zero exceptions; if a future family introduces one, it must be tracked before merge.

## Review workflow

When adding or changing a family:

1. Add/update `BUILTIN_FAMILY_METADATA` first.
2. Add/update parser, renderer, agent body, mutation ops, verify behavior, and examples.
3. Update the citizenship matrix row in the same PR. Prefer `satisfied` with evidence; use `exception` only with a concrete TODO/issue reference.
4. Run `bun test src/__tests__/diagram-family-citizenship.test.ts src/__tests__/agent-doc-sync.test.ts src/__tests__/editor-examples.test.ts src/__tests__/cli-capabilities.test.ts` before wider validation.
5. For any matrix exception introduced by the PR, add a follow-up issue or `TODO.md` entry before merge.
