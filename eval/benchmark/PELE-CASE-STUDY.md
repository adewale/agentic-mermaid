# Pele benchmark case study, 25 October 2026

This run validates the new measurement and reuse protocol with Pele 1.9.0. It
compares three replicas of the same artifact, so their differences measure
variation rather than a product improvement. Earlier Dave, fixed-core community,
pinned-Mermaid and PR rankings retain their original dates and protocols.

## Evidence

| Item | Observed result |
| --- | --- |
| Measurement window | 2026-10-25 10:05:12–10:19:19 UTC |
| Harness source | `e69f8e4b0b198f5053f9231833469d4587d4cb32` |
| Public entry | Pele 1.9.0 `dist/pele.js`, SHA256 `7c40a25eeaf4370fb56c03d9d8f6780051c9c39b6c6ca36d53239075117097f5` |
| Retained record | `e7322d5f-2742-4b3c-afa2-1d76d8918572` |
| Corpus | 49 cases: 23 family, 15 scaling, eight interacting features, three invalid |
| Work | 15,930 workers; 2,804,100 timed calls |
| Declared check failures / blocked workers | 0 / 0 |
| Acceptance | All 46 valid cases accepted; all three invalid cases rejected |
| Declared native and painted criteria complete | 28 of 46 valid cases; 18 remain paint-unmeasured |
| Calibrated timing rows | 84 of 149; 65 exceed the predeclared A/A noise ceiling |
| First-use calibration | 49 of 49 rows calibrated |
| Warm calibration | Repeated: 10/49; comment-varied: 23/49; actual label/config edits: 2/2 |
| Resources | 245 fresh render processes, 245 independent baselines, five retention runs |
| Unchanged repeat | Same record reused; no new timing workers or measured attempt |

The standalone compiled kit ran from an empty working directory with only Node
on PATH, using the supplied installed artifact and explicit GNU time observer.
It required no Agentic Mermaid source, Git, Bun or harness node_modules. The
preceding functional smoke used deliberately insufficient sampling and correctly
reported uncalibrated results; it is not included in the full run's totals.

The complete report and four PNG/SVG/PDF charts are retained at
`/workspace/mermaid-unified-2026-10-25/pele/`. The verified compressed raw-evidence
archive is `/workspace/mermaid-unified-2026-10-25/pele-evidence.tar.zst`, with its
adjacent SHA256 receipt. These are generated workspace evidence, not library
package contents. Record reuse still reads and validates retained evidence; it
avoids measurement rather than promising zero I/O.

## What this changed and taught us

**First use and warmed work answer different questions.** For the family
flowchart, fresh-process first-render median/p95 were 9.413/11.001 ms, excluding
import. Its observed warm median was 0.126 ms, but that warm row did not calibrate.
It cannot support a precise warm speedup claim. All five scaling families had
calibrated fresh-use rows: at authored size 128, first-use p95 was 25.351 ms for
flowchart and 10.777 ms for sequence. Equal authored sizes do not imply equal work
across families, and these values do not establish a cross-project winner.

**Successful execution does not calibrate a benchmark.** Five rounds, 31 warm
batch means and 20 fresh calls per replica/round/case exposed substantial warm
variation even with the same artifact. The declared 25% control-spread ceiling
was not relaxed after seeing the data. A follow-up should investigate warmup/JIT
and batch-policy stability in a separately declared pilot, then give any revised
protocol a new identity. Extra samples alone are not evidence of convergence.

**Acceptance does not certify the drawing.** Owned painted identities,
connections, arrow multiplicity and simple sequence order are now checked for
five families. The projections currently recognize Pele's SVG format; equivalent
qualifiers are needed for other adapters before comparing their painted fidelity.
Curve interiors, computed CSS, perceptual quality and 18 positive case projections
remain unmeasured. A partial qualifier is not a failed renderer.

**Memory needs a named boundary.** The family flowchart's median API-return heap
increase was 564,584 bytes, and its post-GC retained increase was 364,368 bytes.
Its median whole-worker peak RSS was about 37 MiB. These are different quantities:
whole-worker peaks include runtime, import, driver, GC and qualification. The
1,000-call retention diagnostic changes source comments while preserving the
same semantic graph; observed growth does not by itself prove an engine leak.

**Costs and delivery need their own evidence.** The fetched package inventory was
2,318,456 bytes across 418 files; the sum of separately gzipped files was 909,069
bytes. Those values are not an observed browser download, tree-shaken entry size
or npm tarball size. CPU observations are retained, but dollar costs are
unavailable without a declared rate. No provider/model calls were made, so model
cost is unavailable rather than zero.

**Stronger functionality checks find real product bugs.** The family suite now
witnesses all 284 advertised mutation kinds, including an independently expected
positive effect and one malformed checked-operation rejection per kind. The
Timeline/Journey section-order controls exposed silent Timeline reparenting;
[#497](https://github.com/adewale/agentic-mermaid/pull/497) fixes that runtime bug.
The packed fixed candidate passed 920 rows, all 284 positive witnesses and all
284 rejection witnesses. Its archive is explicitly pinned to `a2a6ee69`; rebasing
that runtime change onto `835b5663` changed only the test command. Main retains
the diagnosed Timeline failure until that separate fix lands. These witnesses
still do not cover every operand combination, snapshot or family feature.

The [overview](OVERVIEW.md) explains how this lane fits the full suite. The
[inventory](INVENTORY.md) lists runnable suites, and the [assessment](ASSESSMENT.md)
keeps the remaining coverage and attribution limits explicit.
