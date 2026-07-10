# Journey Quality Retrospective

Status: retrospective for the defects that shipped in PR #136 and the
safeguard changes that answer them
Last reviewed: 2026-07-09
Companion docs: [`journey-migration-parity.md`](./journey-migration-parity.md),
[`journey-usage-research.md`](./journey-usage-research.md)

## Why this document exists

PR #136 replaced the card-based Journey renderer with the Mermaid-classic
experience-curve metaphor. It shipped with a green 4,687-test suite, updated
snapshots, regenerated visual evidence, property coverage, and a written
acceptance-criteria list — and it still contained, at merge:

1. a section-band overlap whenever a section label was wider than its tasks,
2. a renderer that silently dropped any body line starting with `journey`,
3. semicolon-joined statements misparsed into bogus actor names on every
   parse surface,
4. normalization drift (`<br>` handling) between the renderer parser and the
   structured agent parser,
5. PNG output whose raster font (DejaVu) was ~14% wider than the metrics font
   (Inter), pushing long labels out of their measured boxes,
6. 100% tofu PNG output for CJK/emoji text, silently,
7. invisible section labels under Mermaid's own stock journey theme
   (`sectionFills` dark + `sectionColours: ['#fff']` on a light background),
8. an ASCII width contract that broke on variation-selector emoji and split
   ZWJ emoji mid-grapheme,
9. actor dot colors that collapsed into near-identical tints beyond ~3 actors,
10. a spec'd facts/describe/mutation surface that was never implemented.

Every one of these had a plausible-looking safeguard nearby. This document
records why each safeguard did not fire, because the failure modes are
systemic, not Journey-specific.

## Why each safeguard missed

### 1. Acceptance criteria lived in prose, not in tests

The parity spec's Mermaid-classic acceptance criteria explicitly included
"avoid clipping long task labels, actor labels, and section names" — and no
test encoded it. The layout suite asserted band non-overlap on exactly one
happy-path example whose labels were narrower than its tasks. A criterion that
is not executable is a hope, not a gate.

**Now:** `src/__tests__/journey-layout-quality.test.ts` encodes the criteria
as geometry checks (span tiling, task-inside-span containment, wrap caps,
viewBox tightness, curve presence, palette distinctness, WCAG label
contrast), and the layout makes span overlap unrepresentable by construction
(sections are tiled blocks; the cursor advances by the span's full width).

### 2. Snapshots pin, they do not judge

The SVG snapshot suite, the geometry/styled/svg-output baselines, the
committed visual-quality sheet, and the browser screenshot baseline were all
*regenerated during the PR that introduced the bugs*. Golden files catch
unintended change after a good state exists; when the new state itself is
wrong, regeneration launders the defect into the baseline. Every geometry bug
above shipped inside freshly regenerated goldens.

**Now:** invariant-based gates run alongside the snapshots — checks that
compute properties (overlap, containment, contrast ratio, width budgets)
rather than compare bytes. Snapshots remain for regression detection; they are
no longer the primary quality argument.

### 3. One grammar had four hand-copied implementations

The renderer parser, the structured agent parser, the opaque-verify score
scanner, and the label extractor each re-implemented Journey's grammar. No
test asserted the surfaces agree, so they drifted exactly as the parity doc
predicted (its follow-up plan item 1 — a shared parse core — was written down
and deferred). The `journey`-prefix line drop and the `<br>` normalization
drift were both single-copy fixes that the other copies never received.

**Now:** `src/journey/parse-core.ts` is the single grammar; all four consumers
are event-driven walkers over it, and cross-surface convergence tests pin that
the same source yields the same labels and the same accept/reject decision
everywhere. Drift now requires editing one file, not forgetting three.

### 4. Known gaps were documented instead of diagnosed

The research pass *found* the semicolon issue (it is written in
`journey-migration-parity.md` as a "known remaining gap") and the sequence-era
no-op config fields (documented as "accepted for compatibility"). Documenting
a hazard does not protect users from it: semicolon inputs silently misparsed,
and no-op config was silently swallowed. A gap that is only prose generates no
signal at parse, verify, or render time.

**Now:** semicolons follow upstream lexer semantics (statement separators,
with HTML entities preserved), typed parse issues explain every opaque
fallback (`journey_section_colon`, `journey_unrecognized_line`, …), and
ineffective config fields produce a verify lint instead of silence.

### 5. The flagship quality loop was flowchart-only, with no enrollment forcing function

`src/layout-rubric.ts` and `bun run track` structurally consume the flowchart
pipeline; the tracker catalog contained zero non-flowchart examples; the
journey Stryker lane existed but never ran in CI and did not mutate the
renderer; `verify`'s group-containment geometry check was enabled for
xychart/quadrant but not journey. Nothing failed when a new family shipped
outside the loop, so every new family shipped outside the loop.

**Now:** a family-generic rubric scores every `RenderedLayout` family, the
tracker carries per-family example groups, the journey mutation lane covers
the renderer and runs in the nightly matrix, group containment is on for
journey — and the family-citizenship test fails CI for any future family that
registers without enrolling in the metamorphic fuzz registry, the tracker
catalog, and the layout projection. Enrollment is now the default, not a
favor.

### 6. Shallow generators starved the property oracles

Three property suites (metamorphic, all-families fuzz, SVG well-formedness)
drew journey inputs from a generator that emitted one section, constant score
5, one actor. The oracles were sound; the inputs could not reach the failure
space (multi-section tiling, wide labels, score extremes, many actors). The
overlap bug was reachable by the *existing* oracles with a richer generator.

**Now:** the shared journey generator produces multi-section, multi-actor,
full-score-range, long/CJK-label shapes deterministically, and the
well-formedness arbitrary was widened the same way.

### 7. Cross-format blindness: SVG was verified, PNG was trusted

All visual verification happened on SVG text or SVG-derived screenshots.
The PNG path substituted a different font at raster time — a category of bug
invisible to every SVG-level check and to byte-determinism tests (which
happily pin deterministic tofu). Nobody looked at pixels.

**Now:** a pixel-scan test decodes rendered PNGs and asserts glyph ink stays
inside measured boxes; the raster font IS the metrics font (Inter, bundled);
missing glyph coverage warns loudly with a documented `--font-dirs` escape
hatch instead of emitting silent tofu.

### 8. Theme tests asserted echoes, not outcomes

Journey theme tests asserted that configured hex values appear in the CSS —
which is true of invisible text too. Journey appeared in zero computed-
contrast gates (`theme-contrast-wcag`, `renderer-contrast`,
`property-readability`), so white-on-near-white section labels passed every
theme test we had.

**Now:** section label color is contrast-guarded at render time (explicit
colors win only when they clear WCAG AA against the band they sit on), and
rendered-contrast tests cover light and dark themes with Mermaid's stock
journey palette.

### 9. The width contract was tested against a friendly alphabet

Journey ASCII had a real width-contract test — exercised with CJK and a
single-codepoint emoji, the cases the implementation already handled. The
failing classes (FE0F variation selectors, ZWJ sequences) were exactly the
ones absent from the test corpus. A contract test is only as strong as its
adversarial inputs.

**Now:** wrapping iterates grapheme clusters measured by the same
display-width function the renderer uses, in one shared module (journey and
timeline both consume it), with FE0F/ZWJ cases pinned.

## The general lessons

1. **Encode acceptance criteria as tests in the same PR that states them.**
   A criteria list in a design doc has no enforcement power.
2. **Prefer correctness by construction over checked correctness.** The
   tiling layout cannot overlap; the shared grammar cannot drift; a palette
   sized to the actor count cannot run out. Where construction is possible,
   checks become regression guards instead of the only line of defense.
3. **Treat snapshot regeneration as a review event.** Any PR that regenerates
   goldens is claiming "the new output is correct" — that claim needs
   invariant gates or human eyes on the artifacts, not just a green diff.
4. **A documented limitation must emit a runtime signal** (diagnostic, lint,
   warning) or it will be experienced as silent data corruption.
5. **Quality infrastructure needs an enrollment forcing function.** If joining
   the rubric/tracker/fuzz/mutation loop is optional, coverage decays one
   family at a time. The citizenship test makes non-enrollment a CI failure.
6. **Fuzz generators are part of the oracle.** Auditing property tests means
   auditing input richness, not just assertion soundness.
7. **Verify every output format at its own fidelity.** SVG checks cannot vouch
   for raster output; terminal width contracts cannot be proven on friendly
   alphabets.
