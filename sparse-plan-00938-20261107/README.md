# Option closure repair, stopped Sparse32 trial and ER256 runtime baseline

The production repair at `d4e044949dd604cc0ca5deb692a6e82218d4b487` moves the
existing declarative option contract into one leaf module. Public compatibility
exports and executable worker admission remain. The editor no longer loads Scene
validation, SVG writing and backend execution merely to inspect options. No new
cache, limit, default or version change.

## Measured result

Actual complete standalone HTML, Bun1.4.4, gzip9 / Brotli11:

| Revision | Raw bytes | Gzip bytes | Brotli bytes |
|---|---:|---:|---:|
| Before00938cc04 |2,287,540|1,386,827|1,318,081|
| Option leaf d4e044949 |2,109,909|1,332,711|1,272,057|
| Main608 combined candidate |2,112,604|1,333,923|1,273,449|

The extraction saves54,116 gzip /46,024 Brotli bytes. Integrating main608 adds
1,212 gzip /1,392 Brotli bytes; the original1,334,500 gzip ceiling still passes,
with577 bytes spare. Main-thread graph228→63 inputs atd4; worker raw grows58
bytes while packed worker shrinks157. Pre-minification attribution is not a
compressed saving. No startup/CPU/RSS benefit of the extraction is established.
Pinned mainc366 has1,517,563 gzip /1,170,181 Brotli bytes: the PR retains an
adverse Brotli difference. Current maine7 was not rebuilt for a size comparison.

## Sparse32 remains unverified

The existing owning case delivers1,500 text programs and32 decorative markers,
but exhausts the unchanged400k XML/proof allowance. The named owner reproduces
2passes/1failure. This is proof unavailability, not a delivery refusal.

The outside-source eager streaming trial still exhausts at394,121 emission
operations; it shifts work rather than closing the deficit. Review also identifies
changed ambient lookup timing as an authority concern. This is source analysis,
not a reproduced exploit. `stream-review.md` records the concern and corrected
iterator probe. The removed-check diagnostic is an inadmissible upper-bound
subtraction; its passed status is not a repair. No XML production changes ship.

`profile-before`, `profile-stream`, `trace-stream` and `profile-knockout` retain
all products, profiles, traces and failed probes. Their inherited phase name
`edit` is the same Sparse fixture, not an edit measurement.

## Equivalent fully consumed ER products at d4

The existing `native-elk-d8c8-comparison/measure.mjs` ran24 fresh sequential
Node24 processes: ER256 BT/RL × selected Native/ELK × layout cache0/1 ×3
replicates. Each process timed cold +4 repeats +first caption edit +edited repeat.
All168 timed calls returned with passed proof;24 final cache audits are untimed.
Full SVG and entire receipt consumption is inside each timed window; import,
compression, explicitGC and artifact writes are outside. No profiling or raster
job overlapped these calls. Layout-cache0 does not clear every derived cache.

An independent actual-XML audit checks48 cold/edit products:256 entity identities,
255 ordered labelled relationships,510 cardinality carriers, actual authored text
and exact backend with no fallback. All48 pass. This does not establish glyph
attribution or whole-diagram readability.

| Case/cache | Native cold/repeat/edit p50 ms | ELK cold/repeat/edit p50 ms |
|---|---:|---:|
| BT/0 |2021.7 /1072.5 /1742.4|2379.9 /1082.4 /1073.6|
| RL/0 |1052.3 /756.3 /731.0|1522.8 /999.1 /951.7|
| BT/1 |1109.9 /651.7 /767.8|1607.1 /678.2 /980.5|
| RL/1 |1095.5 /641.3 /754.4|1486.1 /592.6 /961.8|

N=3 processes per cell; repeat p50 pools12 calls. Wide ranges and Native losses
for uncached BT edits and cached RL repeats remain. `COMPACT-COSTS.json` includes
CPU, RSS, heap and ranges; `PERFORMANCE.json` retains edited-repeat separation,
per-process medians and every outcome. Harness/retained-product memory contributes
to RSS/heap. These are source-API observations, not package/browser performance,
causal before/after speedups, p95 estimates or leak measurements. The subsequent
main608 integration is not covered by these timing numbers.

## Verification and scope

Atd4, canonical core/repository types and lint pass. Initial owning files report
102passes and6 esbuild sandbox failures; exact projection owner retry11passes.
Rebuilt standalone budget and persistent Blob worker pass2tests/657 assertions
using installed Chromium154. Hosted editor build also passes; summing emitted
files is not startup transfer measurement. All1,748 fixed-roster SVGs, route
vectors, delivery outcomes and proof statuses remain exact. Native740passed /
134unverified and ELK696/178. This replay preserves contracts; it is not a new
layout or independent visible-correctness gain.

`options-split-review.md` finds no actionable source regression: one metadata
owner, same values/object identities, explicit public exports, unchanged
request/callback tail and preserved build flags.

Current main advanced fromc366 to `e7cb05baa7f68154942a9ce9c6e9aaaee163dc94`
(#608). GitHub's base snapshot initially lagged its main ref, hiding the reason
for the conflict. The integration retains main's bounded queue settlement,
operation capture, private clone admission and hosted-worker consolidation, plus
PR ownership/capture and leaf option metadata. Both appended ownership/preview
test groups survive; stricter PR lazy budgets are retained. `main608-review.md`
records the independent boundary review. Combined qualification and final source
binding are recorded in `FINAL-RESULTS.json`.

Sparse32, contacts152/372/201/241, crossing276 and implemented Sparse256's
historical +5.04% area gap remain. Main608's independent improvements are not
claimed as PR inventions. Replacement24 remains sealed. Original baseline and
pinned Mermaid/Pele comparisons remain unavailable. Automation remains off.

Recovery: restore the archive under its original `/tmp/pr449-week-comparison-20261101/`
directory and check out the recorded source. Use the existing owning tests and
the retained runner jobs; no new qualification framework is introduced.
All failed attempts and adverse costs are retained. Archive member SHA256s and
the published branch checkpoint bind the evidence separately from source.
