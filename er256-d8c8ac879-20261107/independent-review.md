# ER256 independent source review

Read AGENTS.md, CLAUDE.md and the contract-review instructions. Reviewed the
current uncommitted `src/er/layout.ts`, `src/shared/ink-index.ts` and existing
backend-owner table read-only. No tests, renders, source changes, commits or
network actions were performed by this reviewer.

**No demonstrated public correctness defect found.** Reusing the existing
obstacle query is causally appropriate for the two final checks. The proposed
value is delivery of the actual256-entity chain under the existing400k
allowance, not an independently measured CPU speedup. The coordinator's
combined/either-change-alone results support the bounded work opportunity;
those results were not rerun here.

## Snapshot lifetime and conservative coverage

- The entities/groups reach final placement and title translation before
  `finishErGeometry` begins. Its obstacle records at1349–1363 own numeric
  entity stroke-expanded boxes, exact group-header boxes and border strips.
  Subsequent terminal seating changes relationship points and label positions.
- `repairErFrameRoutes` at274 builds copied physical obstacles, canonicalizes
  route contacts and reroutes the middle. It does not move entity/group boxes.
  The other calls between obstacle creation and the final checks likewise move
  routes/labels or canvas extents, not those obstacle coordinates. Therefore
  terminal route changes do not invalidate this obstacle index.
- Glyph and shaft geometry are separate snapshots. Terminal changes refresh
  the retained seating snapshot; after final repairs, `allGlyphs`/`allShafts`
  are rebuilt before these final queries. No moving-shaft index is being
  substituted for the fixed-body index.
- A raw segment's AABB is conservative even when cardinal and zero-width or
  zero-height: the query's strict inequalities still admit a segment lying
  inside a positive-area body. Entity query boxes contain the logical body,
  including authored stroke expansion; headers use the same body rectangle as
  the old exact predicate. `segmentThroughShape` remains the narrow phase.
- The painted query uses the exact same entity border-expanded box as before,
  through `erEntityStrokeHalf`. Group border-only rows are skipped here as they
  were outside the old body/header loops; group-header checking and the exact
  incident terminal-border exemption remain. Corner/ray exemption semantics
  have not been relaxed.

## Sort reuse and custody

A child is a contiguous subsequence of its parent's sorted rows. If its chosen
axis and tie comparator are unchanged, it is already sorted by precisely the
same key; skipping its stable sort preserves equal-key order. If the axis
changes, sorting still happens. The two current call paths provide private
numeric snapshot bounds; the Scene tie is frozen primitive paint order.
No tie-order problem was found for those callers. This is not a guarantee for
arbitrary stateful bounds/tie callbacks or mutation during construction; such
inputs also violate the retained spatial-index snapshot premise. No new cache
or cross-request alias is introduced.

## Small simplifications and limits

- In the painted pass, `obstacle.box` is already the occupied group-header box,
  as well as the occupied entity box. It can replace the reconstructed header
  object; keep `subjects` for terminal identity and full subject dimensions.
- The old checks explicitly ignored group headers with `headerHeight<=0`.
  The replacement omits that guard. Current ER preparation produces positive
  headers, so this is not a demonstrated reachable public regression. Retaining
  the guard keeps the stated predicate equivalence precise: strict AABB tests
  can otherwise consider a zero-height box intersecting a positive-area shaft
  spanning its y coordinate.
- The256 rows extend the existing owning table rather than creating a second
  test framework. They check layout/SVG identities, endpoints, cardinality,
  identifying style, labels, proof status and route quality, not merely absence
  of a thrown budget error. Their main discrimination is the combined cap-bound
  chain; they do not alone prove grouped/header/styled route equivalence or
  every shared Scene sort caller.
- A useful existing-fixture qualification is a grouped relationship whose
  terminal seating actually changes points, with a wide authored border and a
  header near the repaired middle. It should preserve actual SVG/receipt or
  demonstrate the same intended refusal. For the shared sort change, mixed
  axis partitions with tied coordinates and distinct paint order are the
  purposeful counterexample shape; no need for a copied index inventory.

The unchanged400k cap, the existing construction/query charges and exact
narrow-phase checks are the relevant safeguards. Earlier refusal profiles are
not equal-success timing evidence. Final current-head CI, actual built size and
broader product preservation remain coordinator-owned qualification.
