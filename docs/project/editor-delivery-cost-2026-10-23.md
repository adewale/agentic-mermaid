# Hosted editor delivery — 23 October 2026

The hosted editor now loads complete verified family implementations on demand,
with deferred terminal/PNG output, sketch backends and ELK. A cold simple
flowchart consumes **45.0% fewer gzip-equivalent asset bytes** in the PR recheck.
Its median local first preview fell from **502 ms to 469 ms**. Blank startup is essentially
unchanged. These are source-build Chromium diagnostics, not deployed-network
measurements.

## User-facing behavior

- The blank editor keeps its existing quick bootstrap. Opening or pasting a
  diagram downloads the implementation needed by that family, including its
  parsing and verification hooks.
- The first use of another family, text output, PNG or a sketch style can need
  another module fetch. Later calls reuse the same persistent worker and its
  loaded modules. An ELK-dependent layout loads ELK only when demanded; a native
  forest does not pay that download cost.
- A failed dynamic import produces a connection/retry message. The client
  discards the failed worker's module map, retains queue ordering, and permits
  the next edit to retry in a new worker. Stale work still cannot replace the
  newest verified source or authorize an export.
- Offline operation covers already loaded code. A new family or an edit that
  first needs an uncached provider can require a connection. This is an
  intentional consequence of the requested hosted loading behavior. The
  standalone editor retains its bundled implementation.

The first-use saving depends on the diagram. A diagram needing ELK immediately
will not realize the ELK portion of the simple-flowchart saving.

## Implementation

The former `agent/families.ts` registry implementation moved to
`agent/family-registry.ts`, preserving metadata, validation, conformance and
descriptor ownership. The full-library facade still installs every built-in
eagerly. Hosted worker builds resolve that facade to the registry core and
install complete built-ins through generated per-family loaders. Those loaders
come from the existing canonical family authority; there is no second family
inventory or parallel verifier.

Named agent/render hook exports let the bundler retain the owning family.
Terminal hooks suspend until their implementation loads and retain the native
terminal drawing identity, bounds, output policy and receipt. The worker build
now enables code splitting and selects its entry artifact without assuming a
single output file. Optional styles enroll their backends only when requested.

The hosted build uses the existing deferred ELK constructor. Internal dependency
suspension passes through layout wrappers and verification instead of becoming
an author-facing warning; execution retries after the provider loads. Heavy ER
and C4 error classes moved into engine-free error modules, with compatibility
re-exports from their original modules. Error classification therefore no
longer imports their layout/rendering implementations merely to recognize an
error class.

## Measured result

Baseline: the saved production site from
`87c9c3174c0d4edc16c69c0da82b69a325cc32ec`, before production edits in this task.
Candidate: the implementation before the PR rebase; the recheck below records
the newer main baseline. Both original builds use Bun 1.4.2 and Chromium
145.0.7632.6 on the same Apple M2 Ultra machine, with fresh contexts, remote
assets blocked and local uncompressed HTTP. The harness records hashes of the
actual fetched assets. Compression estimates use gzip level 9 and Brotli
quality 11/window 22. No package dependencies changed.

The table counts each requested asset URL once, cumulatively through each
stage, including requested HTML, fonts and JavaScript. It is a delivery-graph
comparison under successful immutable caching, not measured CDN wire traffic
or a count of repeated HTTP transfers.

| Session boundary | Baseline gzip | Candidate gzip | Change | Distinct assets, before → after |
| --- | ---: | ---: | ---: | ---: |
| Blank editor | 135,843 B | 135,844 B | +1 B | 3 → 3 |
| First verified five-node flowchart | 1,507,948 B | 831,039 B | **−44.9%** | 6 → 58 |
| Flowchart editing through 150 nodes | 1,507,948 B | 831,039 B | −44.9% | 6 → 58 |
| Then Sequence | 1,507,948 B | 846,619 B | −43.9% | 6 → 60 |
| All 23 default SVG family examples | 1,507,948 B | 1,429,730 B | −5.2% | 6 → 107 |
| Then Sequence Unicode and ASCII | 1,663,579 B | 1,676,874 B | +0.8% | 7 → 112 |
| Then PNG export | 1,983,523 B | 2,018,930 B | +1.8% | 9 → 116 |
| All family terminal implementations and a hand-drawn render | 1,983,523 B | 2,030,178 B | **+2.4%** | 9 → 139 |

The larger fully consumed graph is real: splitting introduces module/import
overhead and weaker compression across boundaries. Users who only need one or
two families benefit most. These results do not justify claiming that every
session downloads less. First use of text output rose from 24 ms to 36 ms in
this local diagnostic; subsequent calls reuse loaded modules.

Three fresh sessions per build produced these local medians. First preview
includes the initial module loads; warm samples are nine root-label edits per
tree size after one warmup in each session. DOM completion includes two
animation frames and verified output. The tree source and dispatch procedure
are identical between builds.

| Interaction | Baseline median | Candidate median |
| --- | ---: | ---: |
| First five-node preview | 507 ms | 453 ms |
| Warm five-node preview | 89 ms | 87 ms |
| Warm 50-node preview | 125 ms | 110 ms |
| Warm 150-node preview | 190 ms | 179 ms |

This exceeds the proposed 20% first-preview delivery reduction, with no warm
preview regression in these runs. It does not prove production-network timing:
the many additional small requests can introduce latency, particularly before
module caching. Coalescing small shared chunks and measuring the deployed
HTTP/2 or HTTP/3 waterfall is the next performance investigation. This work
does not attribute algorithmic layout improvements to the observed timing
variation.

## PR recheck after rebasing

Main advanced during the investigation. The PR was rebased onto
`861375d33807a668a0dd3674257840d027ea299e`, preserving its cache ownership
registration in the deferred installer and retaining its mutation drafts.
Both sites were rebuilt with that revision's frozen dependencies. The same
three-round diagnostic and complete official inventory were then run serially
against main and the candidate. The original measurements above remain dated
evidence; the following numbers qualify the rebased production implementation.

| Session boundary | Main gzip | Candidate gzip | Distinct assets, main → candidate |
| --- | ---: | ---: | ---: |
| Blank editor | 134,064 B | 134,065 B | 3 → 3 |
| First verified five-node flowchart | 1,507,773 B | 830,016 B | 6 → 58 |
| Then Sequence | 1,507,773 B | 845,573 B | 6 → 60 |
| All SVG families | 1,507,773 B | 1,429,249 B | 6 → 107 |
| Then terminal output | 1,663,404 B | 1,676,398 B | 7 → 112 |
| Then PNG export | 1,983,348 B | 2,018,448 B | 9 → 116 |
| All families and features | 1,983,348 B | 2,029,533 B | 9 → 139 |

First-preview medians were 502 ms on main and 469 ms on the candidate.
The first-flowchart gzip reduction is 45.0%; fully consumed gzip grows 2.3%.
All 87 captured artifacts and all 1,095 official results match exactly between
these builds, with 823 accepted inputs. No browser errors were recorded.
The same local-network and compression limits apply to this recheck.

## Correctness and checks

- **87/87 captured artifacts match exactly** between builds across three
  sessions: inserted tree SVG/receipt identity, all family SVG/receipts/
  verification, Sequence ASCII and Unicode output, a hand-drawn rendering and
  PNG export bytes.
- The complete official inventory has **1,095 identical results**, including
  errors and digests of SVG/receipt/verification data; **823 accepted** in both
  builds. Its corpus and acceptance definition come from the existing official
  fence inventory, not a newly selected subset.
- **309 focused unit tests pass**, covering family registration/conformance,
  hooks, verification/source evidence, browser-lazy rendering, PNG contracts,
  upstream cache ownership, mutation and wrapper fidelity. Six package manifest
  tests also pass, and the rebuilt tarball passes the exact 213-file manifest.
- **21 browser tests pass**, including each of the 23 families as the first
  family in a fresh context, native ASCII/Unicode parity, blocked-download
  recovery, cached-module editing, worker ownership/cancellation, strict SVG
  insertion, C4 and Kanban interactions, mobile export controls and PNG fonts.
  Packet coverage independently checks SVG keyboard access, dropdown selection,
  pane-switch persistence and canonical artifact/source/export integrity.
- The original Packet test failed on both baseline and candidate because it
  assumed ArrowUp commits a native dropdown selection on macOS. A follow-up
  bisect reproduced the failure at its introduction, `c24d4519` (2026-10-20);
  its parent had no Packet inspection test. The four replacement tests use
  `selectOption` for native dropdown choices and real keys for SVG navigation
  and activation. Clearing selection without moving SVG focus ensures Enter
  and Space are actually exercised. The complete editor interaction file now
  passes without exclusions (371 assertions); Packet production code is unchanged.
- The suspension regression test exercises verification directly. It passes
  on the candidate and fails its assertion against main production in the
  repository's red-to-green runner; a combined render call had masked this
  distinction by eventually rethrowing the original error.
- Typecheck, lint, generated-family checks, existing website payload budgets
  and `git diff --check` pass. The existing blank-editor budgets were not raised.

No rendering goldens changed. The work changes delivery and retry behavior,
with exact output evidence instead of manufactured before/after images.

## Reproduction

Build the unchanged baseline into one retained directory and the candidate into
another, using each revision's required Bun. At the candidate checkout:

```sh
bun run website
bun eval/benchmark/editor-delivery-bench.ts --site /path/to/baseline-site --out /tmp/editor-baseline --rounds 3 --corpus official
bun eval/benchmark/editor-delivery-bench.ts --site website/public --out /tmp/editor-candidate --rounds 3 --corpus official
bun run typecheck
bun run lint
bun run check:browser-families
bun run website:payload:check
bun test e2e/editor-site-interactions.e2e.test.ts --timeout 600000
```

The two `editor-delivery.json` files retain stage graphs, shipped-asset hashes,
samples, rendered artifacts and every official-corpus result. PNG exports are
saved alongside them. Compare artifacts by `(round,id)` and official results by
`id`; omit timing and site-path fields when checking output equivalence.
Generated evidence belongs outside the source repository.
