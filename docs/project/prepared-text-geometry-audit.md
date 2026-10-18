# PR 395 independent audit

Delivery status: PR #395 merged on 2026-10-17 at
`53056ec569781d6f5153f90b5bd563aa70f8c5c7`. The observations below retain
their original reviewed scope; later source fixes and release status are
recorded in the [delivery reconciliation](archive/prepared-text-geometry-delivery-2026-10.md).

The owner requested implementation of the cross-family rendering contract and
an independent multi-agent audit of the resulting PR. Three fresh reviewers
examined PR [395](https://github.com/adewale/agentic-mermaid/pull/395) after it
was opened, without implementing its initial change or reading each other's
findings. Fixes were followed by focused regressions and independent rechecks.

| Review boundary | Findings and disposition | Verification |
| --- | --- | --- |
| Shared text / Scene / external admission | Fixed RTL word reordering, style-spanning combining clusters, underestimated natural advances/tracking, formatted-space preservation, orphan mark ink, native ascent bands and start/end ink bearings | 252 independent script/mark/tracking/anchor raster probes pass; tight viewport tests; forged external geometry rejected; external v1 keys unchanged |
| Graphical family adoption | Fixed vertical GitGraph multiline overlap; Class/ER literal projection bypass; Gantt accent-title containment; Class note 12px measurement versus 16px paint | New raster/clearance/font witnesses fail before fixes and pass afterward; existing huge-font rotated GitGraph case passes |
| Terminal ownership / semantics | Fixed anonymous Gantt action aliasing; duplicate/shared Radar occurrence identities; Class/ER rectangular canvas compatibility | Public action/metadata regressions fail before fixes; 150 terminal tests, 167 box/golden tests, 53 ownership/meta tests and independent 48 dense route probes pass |

Integration additionally reconciled the compositor's own audit fixes from
[394](https://github.com/adewale/agentic-mermaid/pull/394), retained the richer
XY domain/half-cell tests, fixed Architecture projection rounding under a hard
cell budget, and removed a phantom soft-break record after a final oversized
grapheme. Generated reconstruction cases combine formatting, casing expansion,
multiple spaces, hard breaks, scripts and wrapping. Terminal subprocesses agree
under C, English and Japanese locale settings.

## Evidence and intentional changes

- The meaning-review CI artifact renders immutable base/head revisions. Its
  graphical and terminal witnesses include source, SVG/PNG/plain output and
  captions. No new generated PR evidence is committed.
- Reviewed SVG goldens change for complete Architecture group headers, Gantt
  title/text bands, Journey prepared serialization and XY title/legend bands.
- The layout geometry golden changes for ER literal/monospace widths;
  conservative non-ASCII Flowchart/Journey widths; complete Pie/Radar title
  bands; Timeline text bands; GitGraph label clearance; and XY title allocation.
  The 296-diagram golden remains a determinism check, alongside independent
  content, clearance and raster oracles.
- All 16 styled SVG goldens were reviewed in native before/after pairs; all
  32 renders have zero off-canvas text. Six pairs are pixel-identical changes
  to prepared serialization; the others reflect canonical typography or
  complete title/header/container bands.
- Five existing browser rounded-fill baselines were independently reviewed at
  native size: no clipping, fill leakage or lost connections. ER grows from
  650 to 651 pixels wide and Timeline from 362 to 366 pixels tall; Flowchart,
  Class and Journey retain their dimensions. The refresh also captures the
  host-page corner backdrop changing from dark to light, outside the diagram
  surface; that change is not attributed to text geometry.
- The full browser sweep exposed a lightbox test synchronization race. A bare
  Chromium lifecycle probe confirmed that native `close()` removes `open`
  before the queued close event restores the grid. The test now waits for
  actual grid attachment while retaining closure and keyboard-reopen checks;
  no production behavior or assertion was weakened.
- Section B's 64 family-by-style cells and the existing cookbook images were
  visually reviewed. Their approval records identify an agent review, never
  human approval. The README hero uses bundled mono text with explicit column
  positions so its fallback box characters align across machines.
- Browser decoder checks now read complete visible text across nested tspans.
  Lazy package chunk expectations come from the compiler graph, while required
  exports and missing/unexpected package-file checks remain enforced.
- The accidental common ELK import was removed. Only the original five
  families load it. Sequence's payload allowance increases from 188,500 to
  195,000 gzip bytes for its prepared geometry and semantic controls; other
  family and initial budgets are unchanged.

## Rebase onto the completed compositor

The prepared-text branch is rebased onto PR 394 at
`70f5937b0cf38dbd27b1c8c9238665419e267861`. Its terminal artifact/model reuse,
typed parents, atomic footprint admission, logical strokes, numeric marks,
container allocation and later identity fixes are retained. All 21 earlier
compatibility counterexamples now pass against the combined implementation.

The XY adapter keeps the complete 60-cell boundary scale, authored endpoints,
fractional ticks and non-overlapping coarse endpoint labels inside the newer
terminal API. Its tests also retain PR 394's bar-coverage protection at line/bar
intersections; line segments remain visible outside filled marks. Radar keeps
distinct axis/curve occurrences and uses typed parent identities.

Independent rechecks pass 257 terminal tests, 76 counterexample/XY/chart tests,
312 shared/Scene/golden/package tests, and all 252 shaping raster probes. Root
checks pass 103 integration, 155 prepared/sequence and 219 compatibility tests;
these selections overlap and must not be summed. The README hero was regenerated
and visually reviewed. The PR records fresh quality/CI results for the rebased
head rather than treating earlier-head CI as current evidence.

PR 394's separate follow-ups remain separate: terminal lane capacity (#398),
interleaved compound membership (#397), graphical Sankey identity (#400), and
native C4 (#387). Rebase verification does not close those contracts.

## Editor payload investigation after landing PR 394

The branch is refreshed onto landed main `c361f4b`. The editor bundled its
renderer with minification but appended application code and example data in
authoring form. Removing that code's comments and whitespace with the pinned
Bun transpiler reduces the complete editor module by 37,162 raw bytes,
10,294 gzip bytes and 9,085 Brotli bytes. Renderer implementation and names are
unchanged by this build-only optimization.

Same-host Bun 1.4.2 browser capture reports the empty editor at two requests,
1,060,242 gzip bytes and 836,570 Brotli bytes, below its existing absolute
ceilings of 1,065,000 and 840,000. Landed main measures 1,061,826 and 839,937
bytes respectively. All four route budgets pass without a ceiling change.
CI supplies final same-runner comparison and browser behavior verification.

An independent lazy-graph cost review finds preparation emitted once, no new
runtime package, and no terminal/PNG/resvg leak into lazy SVG. Seven family
loads still grow 3.7–4.9 KB gzip, exceeding the separate default per-PR guard.
The review found no credible common 1.5 KB saving without weakening provenance,
shaping or compatibility; the PR records that intended cost separately from
the now-reduced editor transfer. No approval label is applied by this audit.

## Final audit after growth approval

Three reviewers rechecked the landed-main diff at `68d75d1`. Shared text/Scene
checks passed 110 focused tests and terminal/build/package checks passed 132;
these selections overlap with previous verification and must not be summed.
The graphical reviewer passed 206 focused tests and found three allocation defects in two families. All ten new regression cases fail against the untouched reviewed head and pass with the fixes. The first was an introduced Quadrant axis containment defect:
long Arabic and accented labels used taller prepared shaping bands, but gutter
allocation and first-line placement still assumed a fixed 1.3 line-height ratio.
The Arabic witness painted 450 glyph pixels outside the canvas.

Quadrant gutters now use the full prepared block height and placement uses its
resolved line height. Six independent raster cases cover both axes and both
anchors with Arabic, accented Latin and stacked combining marks; they require
visible ink, zero off-canvas glyphs and clearance from the plot. The immutable
meaning-review artifact includes a matching tall-axis witness. Final CI and
independent patch rechecks are recorded on the PR.

The same scan found Sankey node labels retaining tall native/combining bands
inside a canvas and layer packing sized only for node faces. An 18-line accented
label painted 1,365 glyph pixels outside the canvas; adjacent eight-line labels
overlapped by 32 pixels. Sankey now packs each node's complete face/label union
and expands/translates the canvas for outer label bands. Node order, node heights,
ribbon widths and authored values are preserved. Independent raster cases cover
outer containment and adjacent label clearance, with a corresponding review
witness. This allocation correction does not change public identity rules (#400).

Inspecting the new native-script witness also exposed a preexisting rasterizer
interaction: relative `dy` advances on nested RTL tspans can drift between lines
even when the serialized source is correct. Prepared native output now
uses absolute line baselines, and Scene text offsets recognize the resulting
first-line position. Arabic and Hebrew single-line controls and a thirteen-line
Arabic raster regression compare against independently positioned plain SVG
text; they fail with relative advances and pass with absolute placement. ASCII
serialization keeps its existing bytes. The author passed 122 focused tests; an
independent reviewer passed 90 tests plus 108 exact raster/Scene-offset probes
across anchors, rotations, baseline shifts, formatting and native scripts.

## Scope and limits

Coverage spans all 16 registry families, with directed tests for supported
family-specific roles rather than a copied role inventory. Deterministic pixel
metrics are conservative estimates verified with bundled fonts and resvg;
arbitrary external font ink is not guaranteed. Bundled PNG fonts do not cover
all CJK/emoji glyphs: source content, grapheme integrity and occupied geometry
are verified, and the review captions identify fallback boxes honestly.

This audit does not claim that every possible diagram is readable. Sparse
terminal ownership detects incompatible overlaps and retains element identity;
family routing and explicit hard-width refusals still have their own limits.
