# SHA37 stage investigation — independent read-only review

Review context: source `0ff57be43892519224ebff3c3f72169cf12f01b9`, restored to the
retained `6edd3fd3bb70bfa4232d61aba6cd0822b5adc82d` runtime. The stopped capacity
producer `4db9d6db226c5957c1b003b5ad58b56af4b55480` supplies the diagnostic
enlarged-card result. This review reads existing source and saved SVGs only. No
render, test, build, source modification or external action was performed.

## Actual final contact, independently established

The stopped trial's `generated-sha256-counter-v1:37` Native SVG has:

- Foreign rectangle `node-shape:n11`: x1202.983, y342.4, width99.748,
  height49.75, opaque fill, border width0.75. Its bottom is y392.15.
- Relation `edge:n9->n17#0`: a solid 1px horizontal shaft at y392.4 spans the
  card's full width. Its selected path includes
  `(1794.801,392.4) -> (970.485,392.4)`.

The raw centerline clears the logical body by0.25px, but the combined border and
shaft half-widths are0.875px. Actual stroke supports overlap by0.625px. The
shaft also enters opaque fill by0.25px across approximately99.748px; for example
`(1252.857,392.025)` lies strictly inside both the shaft strip and card fill.
This is not a bounding-box-only warning. Because cards paint after shafts, there
is vector occlusion; pixel attribution and reading impact are separate questions.

The retained baseline's corresponding card is height36.9 (bottom379.3), and its
shaft is at385.3, leaving6px of centerline clearance. Trial geometry has no bend
or crossing reduction for this drawing: bends83→83 and crossings17→17; wire
increases28.024px (+0.155%) and area increases0.272%. These are costs of this
counterexample, not acceptance thresholds.

Evidence: `../marker-capacity-6edd/ADVERSE-REVIEW.md` and the before/trial CI
archives identified there. The first stage responsible for this final contact
has **not** been established by this review.

## Current shortcut admission does not account for that paint

`src/layout/shorten-measured-routes.ts:28` constructs node boxes from logical
origins and measured width/height, without border expansion. At75–77 the
candidate is checked against those boxes, measured headers and foreign captions.
The owning predicate, `measured-route-safety.ts:13–14`, checks strict centerline
entry into a box. A shaft0.25px below a foreign rectangle therefore passes this
specific check despite its0.875px combined half-stroke requirement.

Shortening separately preserves terminal ray signs (72–74), limits route length
and point count, rechecks route crossings/shared shafts (78–87,117–123), and
retains or reseats an authored caption (88–115). Those contracts neither imply
border clearance nor identify this stage as SHA37's first cause.

The existing work controls remain512 shared attempts,8,000,000 comparisons,
24 local attempts per eligible edge, at most128 edges and2,048 route points.
They must not be reset or increased as part of a causal repair.

## The implemented full-body admission is not active here

`agentic-producer-core.ts:96–105` invokes `finalizeFlatMeasuredMarkers` before
shortening. But `compound-boundary-routes.ts:624–625` returns immediately when
`input.maximumEdgeStrokeWidth` is absent. Native Flowchart preparation does not
populate that field, node `paintStrokeWidth`, or edge `markerPaint` in its return
records (`agentic-producer-core.ts:304,338–342`). Its measured footprint work
currently feeds lead, spacing and node-size reservations instead.

There is a genuine stroke-aware full-body validator at
`compound-boundary-routes.ts:526–531`: foreign runs use half the proved shaft
width plus half the node's supplied painted border. Only the actual source's
first segment and target's final segment receive its intentional-contact
exemption. It is not a proof of this Flowchart path when its entry metadata is
missing. With no node paint metadata, its border term also defaults to zero.

When marker seating runs, this finalizer marks proved carriers as `boundaryRoutes`
(`compound-boundary-routes.ts:658–665`), and shortening skips those routes
(`shorten-measured-routes.ts:46`). Thus activation changes admission, optional
repairs, protected-shortening scope and resource consumption together. Supplying
those shared metadata fields wholesale would be a cross-surface contract change,
not a small automatic way to repair SHA37.

Shared cleanup also cannot be presumed to repair this input: the added written
contact detector is circle-only (`graph-paint-support.ts:89–95`), while the raw
rectangle predicate tests centerline interior. The final public paint certifier
reports the unresolved contact; a report is not an upstream repair or a new
acceptance gate.

## Invariants for a justified causal repair

1. Keep measured capacity coherent with served bodies. The producer projects
   measured width/height to actual `PositionedNode` geometry; reserving only
   virtual port space, hiding marker paint or silently shrinking an enlarged card
   would not preserve the demonstrated marker-capacity behavior.
2. Preserve authored identities, ordered relation occurrences, endpoint owners,
   actual outline attachments and terminal rays. Intentional endpoint contacts
   must remain possible; that does not authorize a blanket exemption for a
   nonterminal run through its own body.
3. Preserve the selected foreign rectangle/shaft's written-paint separation.
   For its fixed0.75px border and1px shaft, a run below the trial card needs a
   centerline beyond y393.025 plus serialization separation. This number is a
   diagnostic bound, not authorization to move the route through other live ink.
4. Keep caption ownership and feasibility, group/header reservations, marker
   resources and other live carriers. A successful change cannot be inferred
   solely from an improved proof status or lower wire/crossing count.
5. Preserve deterministic shared work accounting and cache identity. Any new
   output-relevant paint input must participate in the existing geometry cache
   key. Unknown CSS widths cannot be replaced by an invented numeric bound.

## Stage trace needed before choosing a repair

Record the card's origin, dimensions and actual paint widths together with the
owned n9→n17 route at raw layout, marker finalization, shortening and shared
cleanup. Tag **primary/authored/compact** alternatives and bind the final selected
arm: `selectNativeGraphCandidate` compares completed alternatives, so a clear
primary trace alone does not locate the selected drawing's first loss.

The decisive evidence is the first boundary that changes positive actual
border/shaft clearance to nonpositive clearance while retaining the responsible
card and route identities. If raw layout is already wrong, the shortener is not
the first cause; if shortening creates the loss, keep the responsible candidate
proposal and its incoming clear route. No responsibility is assigned in advance.

Only after that observation should an intervention be chosen at the responsible
lane or shortcut constructor. Do not replay the stopped global box-floor,
introduced-segment-only floor, frame-domain expansion or trailing-budget probes
under a new name. They have their own retained positive and adverse evidence.

## Update — stage binding established; relative-clearance probe stopped

The later isolated traces now bind their complete selected SHA37 SVGs exactly
to both saved CI products (`BINDING-AND-ADVERSE.json`). They establish the first
responsible boundary for the stopped capacity producer's **compact** arm:

| Boundary | Signed actual rectangle/shaft gap |
| --- | ---: |
| Raw measured layout | +5.125px |
| Marker finalization | +5.125px |
| Measured shortening | −0.625px |
| Before and after shared cleanup | −0.625px |

The retained baseline compact arm stays at approximately+5.125px through those
same stages. Other primary/authored arms were also recorded, so responsibility
is not inferred from a different candidate. The shortener is therefore the
demonstrated first cause of this named contact in the stopped capacity result;
marker finalization and shared cleanup do not change that gap.

A distinct isolated probe then required each shortcut to preserve the incoming
route's minimum nonnegative clearance from each foreign logical node box. It
introduced no stroke metadata or production cache. That rule fixes current152,
but current17 changes from proof-passed to unverified with three actual opaque
arrow-fill intersections. This adverse result is recorded in `RELATIVE-PROBE.json`
and `BINDING-AND-ADVERSE.json`; the production source remains unchanged.

For current17, the new heads all point west at x132.338. The three pairs are:

| Pair | Tip y coordinates | Fill intersection |
| --- | --- | ---: |
| n3→n1#0 / n3→n1#1 | 329.2045 /324.592 | 0.120125px² |
| n3→n1#0 / n4→n1#0 | 329.2045 /333.817 | 0.120125px² |
| n0→n1#0 / n4→n1#0 | 338.4295 /333.817 | 0.120125px² |

The unchanged8-by-5 opaque triangular resource has5px fill width; pitch4.6125
therefore gives `0.8*(5-4.6125)^2 = 0.120125px²` intersection per pair. The
intersection lies inside the marker viewports and needs no stroke expansion to
establish it. Tips remain distinct. Raster visibility and reading loss remain
unmeasured; proof downgrade alone is not the finding.

Stopping this probe is justified: preserving one route's logical-body gap does
not preserve the final diagram's face capacity when shortcut results participate
in alternative selection. This is not a metric-zero rule or a count of adverse
versus improved cases. The local body-gap invariant is insufficient to establish
the intended coupled behavior. No production implementation is retained.

The next causal question is **which current17 alternative changes rank under
the relative rule, and where that alternative first receives its crowded face
ports**. Record each finished primary/authored/compact score and its actual
marker tips before selection. The existing comparison at
`agentic-producer-core.ts:443–447` orders label conflicts, route overlaps,
crossings, bends and area; those values are not evidence of marker separation.
Locate the changed score component and the owning port-allocation boundary
before proposing another local-clearance or sizing rule. This is a request for
causal observation, not a new acceptance gate or an implementation recommendation.

## Update — Native17 selection cause established

The exact-output selection trace in `NATIVE17-SELECTION-CAUSE.json` resolves the
question above. Baseline primary has10 crossings/55 bends versus compact's
12 crossings/50 bends, and primary is selected. Under the relative-clearance
probe, primary has10 crossings/63 bends versus compact's4 crossings/56 bends,
and compact is selected. Both complete SVGs bind exactly to their saved current17
and relative17 products.

Compact's4.6125px head pitch already exists at `root-raw` in both versions and is
unchanged through marker finalization, shortening and shared cleanup. Primary's
pitch is8px. The relative veto therefore exposes a **latent crowded compact face
by changing candidate ranking**; it does not itself compress those marker ports.
This distinguishes the shortener-created SHA37 card contact from the independently
existing compact marker-capacity defect. It does not justify a new score penalty,
warning-based rejection gate or another unqualified sizing change. The isolated
probe remains stopped and production runtime unchanged. The coordinator records
16 fully consumed public calls for this bounded investigation.
