# Research: Flint and computational aesthetics

Research began 2026-08-02 and was refreshed 2026-09-16 against released
Flint v0.5.1 (`34ef451`) and the explicitly unreleased `dev` branch
(`53ef6cd`). This note keeps the part of the Flint investigation that directly
informs Agentic Mermaid's rendering and verification design. It is not a
backlog or a proposal to copy Flint's product surface.

## Summary

Computational aesthetics turns visual-design knowledge into deterministic,
inspectable computation. Instead of asking a model or reviewer whether a chart
"looks good," the renderer owns named decisions and invariants: minimum readable
sizes, density and aspect-ratio rules, semantic color classes, fallback
precedence, and warnings when a constraint cannot be satisfied.

Flint is useful because it applies this idea on the feed-forward side of its
compiler. Agentic Mermaid is stronger on the feedback side: it exposes runtime
layout and color measurements, structured warnings, and quality checks that an
agent can inspect and use for correction. The productive lesson is to connect
the two approaches, not replace one with the other.

`BELOW_READABLE_SIZE` is the smallest concrete application in this branch. PNG
rasterization can make valid text illegible without changing the underlying
diagram. A named pixel floor, a deterministic effective-size calculation, and
a structured warning convert that invisible perceptual failure into evidence a
text-only agent can act on. The warning does not claim to measure beauty or
prove readability; it detects one bounded failure mode whose inputs are known.

## The structural comparison

Flint's aesthetics are primarily **feed-forward**. Perceptual principles become
compiler decisions: banking toward 45 degrees, band and arc floors, density
pressure, cardinality-sized palettes, and semantic diverging midpoints. Those
decisions are closed-form and deterministic.

Agentic Mermaid's existing posture is primarily **feedback**. Layout engines
produce geometry; `layout-rubric.ts`, `QualityBounds`, color contracts, and
targeted tests measure or reject known failures afterward. Unlike a single
"beauty score," these checks preserve the identity of the violated property.

The distinction is one of emphasis rather than exclusivity. Released Flint
v0.5.1 has behavioral quality assertions, readability safeguards, deterministic
holdouts, and artifact checks. Agentic Mermaid's differentiator is its reusable
runtime measurement surface. Flint's useful challenge is to move a small set of
well-supported perceptual constants earlier into generation while keeping the
feedback evidence.

## Transferable lessons

### 1. Make perceptual constants explicit

Flint names and documents values such as minimum steps, arc sizes, radii,
elasticity exponents, stretch caps, and maximum color counts. Agentic Mermaid
has analogous constants—quality bounds, contrast floors, label caps, and now a
PNG label-size floor—but they should remain reviewable as policy rather than
disappearing into rendering arithmetic.

Every constant should have:

- a name and value;
- an enforcement site;
- the reading task it protects;
- its evidence or provenance;
- the limitation of the measurement.

The legibility warning follows this shape: `minLabelPx` names the policy,
PNG projection is the enforcement site, effective raster pixels are the
measurement, and the extension/CSS boundary is documented explicitly.

### 2. Index floors by the reading task

Flint sometimes uses different density floors for detailed reading and pattern
comparison. That is more honest than pretending one threshold describes every
output. A thumbnail, a slide, an editable source diagram, and a dense overview
do not have identical reading requirements.

This branch uses 9px as a provisional product default for general-purpose
screen diagrams: it catches clear raster shrinkage without claiming an
empirically universal reading threshold. Callers with known tasks or viewing
conditions should set or disable the floor. A future task-derived default
should require real consumer evidence; it should not be inferred merely
because Flint exposes more knobs.

### 3. Organize tests around named aesthetic failures

Flint's strongest fixtures enumerate failure modes such as label overflow,
legend saturation, axis cutoff, sparse dropout, and extreme density. That is
more useful than a gallery of attractive happy paths because every specimen
answers a specific regression question.

Agentic Mermaid should continue the same pattern with focused stressors:
one fixture per perceptual claim, deterministic rendering, a machine assertion
where possible, and human review only for the remainder. The
`BELOW_READABLE_SIZE` tests do this for raster shrinkage without introducing a
new general-purpose aesthetic score.

### 4. Test semantic truth after presentation transforms

Unreleased Flint fixed a `Rank` regression where better ranks were rendered as
shorter, paler magnitude bars. The important lesson is not the specific bar
encoding. It is that style, projection, and backend compilation can preserve
valid syntax while changing the claim a reader perceives.

For Agentic Mermaid, a small set of cross-style and cross-output fixtures should
assert that direction, ordering, emphasis, denominators, and explicit units
survive compilation. Meaning must be checked before appearance is judged.

### 5. Hold out inputs and preserve meaning during comparison

Flint's deterministic theme holdouts keep development fixtures separate from
comparison fixtures and require the compared charts to retain titles and
orientation. Agentic Mermaid already holds out styles and uses paired judging;
the transferable increment is to hold out diagram inputs too and mechanically
confirm semantic equivalence before comparing presentation.

### 6. Explain fallbacks through existing diagnostics

Flint grounds theme values before measurement and records why unsupported or
approximated controls were dropped. Agentic Mermaid should expose the winning
source and reason for confusing style or projection decisions through its
existing diagnostics rather than creating another theme system.

The raster warning demonstrates the desired shape: it reports the natural
size, effective scale, base and effective minimum label size, floor, and whether
`fitTo` or `scale` caused the reduction. The consumer sees both the verdict and
the evidence behind it.

### 7. Use closed-form layout rules only where ownership is clear

Flint decides aspect ratio and density because its compiler owns the statistical
chart layout. Similar rules may be appropriate for Agentic Mermaid families
whose geometry is computed directly. They should not be transplanted into ELK
or topology layout without evidence, and statistical-chart truncation must not
silently drop nodes or edges whose presence changes the diagram's meaning.

## What not to copy

- Do not introduce a new visualization language; Mermaid compatibility and its
  existing corpus are core product advantages.
- Do not add a second ThemeSpec or BrandPack system. Extend the existing style
  and diagnostic contracts only when a demonstrated gap requires it.
- Do not use one scalar aesthetic score as a release oracle. Prefer named,
  task-specific invariants and holdouts.
- Do not copy truncation policies from statistical charts into topology
  diagrams. Warn or require an explicitly requested alternate view.
- Do not infer semantic identity from geometry or fuzzy-rebind missing IDs in a
  future editor. Keep compiler-owned IDs exact and preview state transient.

## Why this belongs with the PNG warning

The research earns its place in this PR because it states the design rule the
implementation exercises:

1. identify a perceptual failure invisible to a text-only agent;
2. express the smallest deterministic measurement that detects it;
3. expose the threshold as policy rather than hidden arithmetic;
4. return structured evidence without mutating the requested artifact;
5. document what the measurement cannot prove.

That is a reusable engineering pattern. The rest of the original Flint survey
and the speculative implementation plan were removed because they did not help
a reviewer decide whether this warning is correct.

## Sources

- [Flint project site](https://microsoft.github.io/flint-chart/)
- [Flint paper](https://arxiv.org/html/2607.20775v1)
- [Flint v0.5.1 stretch model](https://github.com/microsoft/flint-chart/blob/34ef4516554b323a740a426bd1a1e6ba31ee8245/docs/design-stretch-model.md)
- [Flint v0.5.1 color decisions](https://github.com/microsoft/flint-chart/blob/34ef4516554b323a740a426bd1a1e6ba31ee8245/docs/color-decisions.md)
- [Flint v0.5.1 test plan](https://github.com/microsoft/flint-chart/blob/34ef4516554b323a740a426bd1a1e6ba31ee8245/docs/test_plan.md)
- [Flint v0.5.1 deterministic theme holdout](https://github.com/microsoft/flint-chart/blob/34ef4516554b323a740a426bd1a1e6ba31ee8245/scripts/theme-holdout.ts)
- [Unreleased rank regression test](https://github.com/microsoft/flint-chart/blob/53ef6cdc004136aee23d2cc491c3c2c9c73176ac/packages/flint-js/tests/bar-table-rank.test.ts)
- [Unreleased interaction architecture](https://github.com/microsoft/flint-chart/blob/53ef6cdc004136aee23d2cc491c3c2c9c73176ac/packages/flint-js/src/interactive/README.md)
