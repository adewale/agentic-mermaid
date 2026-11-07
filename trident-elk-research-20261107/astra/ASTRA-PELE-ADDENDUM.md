# Addendum: exact diamond spacing cause and a bounded clearance-preserving experiment

2026-11-07. Native source remains `d8c8ac879793a586b4b741c178b89d7900bd27ed`. Production files were not edited. This follows `ASTRA-PELE-REVIEW.md` and qualifies its compact-diamond observation.

## Exact cause of the 32 px

The raw diamond (`n0→n1,n0→n2,n1→n3,n2→n3`) has four equal 60×40 boxes, padding0, nodeSpacing40, layerSpacing48 and edgeSpacing16. An external source observer captured:

| Contribution | Native default |
|---|---|
| Real node ranks | `[0,2,2,4]` |
| Rank-band heights | `[40,0,40,0,40]` |
| Four inter-rank channel gaps | `[32,32,32,32]` |
| Maximum assigned track in each gap | `0` |
| Escape columns | None |
| Edge labels / explicit minimumTerminalLead | None / absent |
| Height | `40+0+40+0+40 + 4×32 = 248` |

**The extra 32 px is not the height of two 16 px dummy bands. Both dummy-only bands have height zero.** Unlabelled dummy vertices have `mainSize:0` at [agentic-layered-core.ts:392–399](https://github.com/adewale/agentic-mermaid/blob/d8c8ac879793a586b4b741c178b89d7900bd27ed/src/layout/agentic-layered-core.ts#L392).

The code already halves the scalar separation: `halfGap=max(4,layerSpacing/2)=24` ([core:783–795](https://github.com/adewale/agentic-mermaid/blob/d8c8ac879793a586b4b741c178b89d7900bd27ed/src/layout/agentic-layered-core.ts#L783)). However, each of the four channels contains at least one cross-flow-changing segment. `assignChannelTracks` therefore applies its active-channel floor:

```
margin = max(12, edgeSpacing=16, minimumTerminalLead absent) = 16
needed = 2*margin + maxTrack*spacing + escapeAllowance = 32
gap = max(baseGap=24, needed=32) = 32
```

See [channel-tracks.ts:26–28](https://github.com/adewale/agentic-mermaid/blob/d8c8ac879793a586b4b741c178b89d7900bd27ed/src/layout/channel-tracks.ts#L26) and [82–89](https://github.com/adewale/agentic-mermaid/blob/d8c8ac879793a586b4b741c178b89d7900bd27ed/src/layout/channel-tracks.ts#L82). Relative to `3×40 + 2×48 = 216`, the excess is **four applications of an 8 px floor increase**. Each pair of real ranks is separated by `32+0+32=64`, rather than48. The traced source/target cross coordinates and offsets are retained in `diamond-baseline/result.json` under `rawTrace`.

This refines the Gansner §5.4 analogy supplied by the coordinator: rank doubling and spacing halving already exist here. The nonlinear channel-clearance floor defeats the cancellation. Dummy rank boundaries get the same two-sided clearance treatment as real terminal boundaries. Later route shortening can remove bends across those private boundaries but does not recompact the real-node placement.

The original raw compact184 result has ranks `[0,1,1,2]`, two32px gaps and height `120+64=184`; its real-node separation is32, so it does **not** retain the requested48px physical separation.

## One external intervention

For this bounded four-node/four-edge unlabelled case, the external loader replaces the core input with:

```ts
input = { ...input, compactPrivateRanks: true, layerSpacing: 2 * input.layerSpacing }
```

Removing intermediate ranks now accompanies restoring a full48px gap (`96/2`) per actual rank. Both observation and intervention are source copies under this directory, loaded through Node's existing source-override mechanism. `diamond-intervention.diff` contains the single experimental difference. It changes no production default, cache policy, cap, implementation version, published file or dependency.

The raw result is **160×216**, ranks `[0,1,1,2]`, band heights `[40,40,40]`, channel gaps `[48,48]`. It therefore retains48px real-node separation. Its terminal offsets are24px, exceeding the raw sixteen-pixel clearance floor.

This condition is intentionally a witness probe, not a proposed production predicate. Applying this rule to mixed labels, larger graphs, groups, reverse directions or cycles is unqualified.

## The public SVG check

A separate public rendering of the same diamond uses ordinary supported options to get exactly60×40 nodes:

```json
{
  "graphLayout":{"backend":"agentic"},
  "layoutSafety":"strict",
  "padding":0,
  "nodeSpacing":40,
  "layerSpacing":48,
  "style":{"roles":{"node":{"fontSize":10,"paddingX":0,"paddingY":13.5}}}
}
```

The public producer has its own **edgeSpacing6 and minimumTerminalLead13.375**, so its baseline is not the raw edgeSpacing16 experiment. The13.375 demand comes from the emitted arrow's backward paint depth8.375, `VISIBLE_SHAFT=4`, bend radius0, and border/shaft margin1: `8.375+4+0+1=13.375`. The canonical arrow probe returned bounds `x0=-7.375,x1=1.375` for an end anchored at x1. See [producer-core:267–291](https://github.com/adewale/agentic-mermaid/blob/d8c8ac879793a586b4b741c178b89d7900bd27ed/src/layout/agentic-producer-core.ts#L267), [323–338](https://github.com/adewale/agentic-mermaid/blob/d8c8ac879793a586b4b741c178b89d7900bd27ed/src/layout/agentic-producer-core.ts#L323), and [edge-label-geometry.ts:24](https://github.com/adewale/agentic-mermaid/blob/d8c8ac879793a586b4b741c178b89d7900bd27ed/src/shared/edge-label-geometry.ts#L24).

Consequently the public baseline's four gaps are26.75px (`2×13.375`), giving height `120+4×26.75=227` and real-node separation53.5. The compensated intervention has two48px gaps, height216 and physical real-node separation48.

| Literal SVG observable | Public baseline | Compensated intervention |
|---|---:|---:|
| Root width × height | 160×227 | 160×216 |
| Real-node vertical gaps | 53.5 each | 48 each |
| n0 upper-left | (100,0) | (100,0) |
| n1 upper-left | (0,93.5) | (0,88) |
| n2 upper-left | (100,93.5) | (100,88) |
| n3 upper-left | (50,187) | (100,176) |
| Total polyline bends | 2 | 4 |
| Final paint proof | passed | passed |
| Final viewport | `-1 -1 162 229.8375` | `-1 -1 162 218.7` |

`check-diamond-svg.py` parses each actual SVG and independently asserts:

* Exactly four authored node identities/labels, each literal rectangle60×40.
* Exactly the four authored directed relationships, unique edge IDs, and arrow markers resolving to an emitted marker.
* Each nondegenerate orthogonal polyline starts on its source's bottom outline and ends on its target's top outline, with nonzero perpendicular terminal leads.
* No segment crosses another node's interior; literal points match the public layout projection; every physical source/target row gap is at least48.
* Both fully consumed SVG-with-receipt results have strict final written-paint status `passed`, zero issues and four measured markers.

Results: `diamond-literal-checks.json`; complete products/traces: `diamond-baseline/result.json` and `diamond-compact-clearance/result.json`; literal drawings: each directory's `actual.svg`. This small XML check is specific to this rectangle/polyline witness, not a general peer-qualification framework. The production paint checker retains its documented text/CSS limitations.

**This proves a smaller, clearance-preserving, meaning/contact-admitted output for this one public input. It does not prove a nonregressing quality improvement.** The intervention moves the sink horizontally and doubles bends from2 to4. Native currently prioritizes fewer bends over area, so the diamond does not by itself justify removing the zero-crossing gate or selecting compact geometry. It supports improving phase ownership of real-terminal versus private-boundary clearance while preserving coordinate/alignment quality. The initial report's raw184 observation must not be presented as free area savings.

No speed result was collected. This is a causal geometry experiment, not a Pele-versus-Native benchmark. The recovered Pele stepped216px height remains a useful comparison of phase design, not proof of equivalent final paint contracts.

## Three different attempt counters

The provenance finding should be stated narrowly:

1. **Public backend-selection attempts:** `receipt.layoutDecisions[0].attempts` records trying Native, choosing it, and optionally trying ELK after eligible failure. [backend.ts:60–88](https://github.com/adewale/agentic-mermaid/blob/d8c8ac879793a586b4b741c178b89d7900bd27ed/src/layout/backend.ts#L60). One selected-Native entry is correct even if Native internally tries three placements. Both diamond renders show that correct entry.
2. **Graph placement-production/candidate evidence:** `PositionedGraph.certification.attempts` is documented as placement-production attempts, and `preference.compared` describes candidate strategy scores ([certification.ts:39–61](https://github.com/adewale/agentic-mermaid/blob/d8c8ac879793a586b4b741c178b89d7900bd27ed/src/layout/certification.ts#L39)). The original ladder probe demonstrates three preparation/solver invocations but a final single candidate entry because Native wraps the selected object in a fresh generic certification ([producer-core:487–501](https://github.com/adewale/agentic-mermaid/blob/d8c8ac879793a586b4b741c178b89d7900bd27ed/src/layout/agentic-producer-core.ts#L487)). That is loss of internal search/selection provenance relative to the documented candidate meaning. It is **not evidence of incorrect layout**, nor grounds to call the public backend count false.
3. **Final paint-certification attempts:** `receipt.layoutCertification.attempts` concerns paint checking/viewport repair. Both diamond results report2 with `expand-viewport`; this is unrelated to either backend selection or number of placement candidates.

The appropriate fix investigation, if authorized later, would preserve an honest internal search trace alongside a fresh final certificate. It should not inflate backend attempts to count every internal candidate or conflate paint-repair attempts with placement work.

## Reproduction

`make-diamond-probe.py` creates both external source copies, job files and the diagnostic loader. From any directory:

```sh
python3 /tmp/pr449-week-comparison-20261101/trident-elk-research-20261107/astra/make-diamond-probe.py
node /tmp/pr449-week-comparison-20261101/trident-elk-research-20261107/astra/diamond-clearance.mjs /tmp/pr449-week-comparison-20261101/trident-elk-research-20261107/astra/diamond-baseline /tmp/pr449-week-comparison-20261101/trident-elk-research-20261107/astra/diamond-baseline-job.json
node /tmp/pr449-week-comparison-20261101/trident-elk-research-20261107/astra/diamond-clearance.mjs /tmp/pr449-week-comparison-20261101/trident-elk-research-20261107/astra/diamond-compact-clearance /tmp/pr449-week-comparison-20261101/trident-elk-research-20261107/astra/diamond-compact-clearance-job.json
python3 /tmp/pr449-week-comparison-20261101/trident-elk-research-20261107/astra/check-diamond-svg.py
```

The fully consumed public product is captured before the separate public layout call. Experimental receipts retain the unchanged production version identifier but must be interpreted with their recorded module override; they are not qualification of a released implementation. Only one topology and direction were investigated.
