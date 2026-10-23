# Hosted editor delivery — 23 October 2026

The hosted editor now loads complete verified family implementations on demand,
with deferred terminal/PNG output, sketch backends and ELK. A cold simple
flowchart consumes **45.0% fewer gzip-equivalent asset bytes** in the PR recheck.
Its median local first preview fell from **502 ms to 460 ms**. Blank startup is essentially
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
  the next edit to retry in a new worker. If a deployment removed the old
  module URLs, **Reload editor** preserves the current unverified source and
  settings in the URL before loading the current deployment. Stale work still
  cannot replace the newest verified source or authorize an export.
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
| First verified five-node flowchart | 1,507,773 B | 830,023 B | 6 → 58 |
| Then Sequence | 1,507,773 B | 845,580 B | 6 → 60 |
| All SVG families | 1,507,773 B | 1,429,232 B | 6 → 107 |
| Then terminal output | 1,663,404 B | 1,676,389 B | 7 → 112 |
| Then PNG export | 1,983,348 B | 2,018,438 B | 9 → 116 |
| All families and features | 1,983,348 B | 2,029,545 B | 9 → 139 |

First-preview medians were 502 ms on main and 460 ms on the candidate.
The first-flowchart gzip reduction is 45.0%; fully consumed gzip grows 2.3%.
All 87 captured artifacts and all 1,095 official results match exactly between
these builds, with 823 accepted inputs. No browser errors were recorded.
The same local-network and compression limits apply to this recheck.

## Audit follow-up

The audit found that a failed dependency import could arrive after an export
had been superseded by an edit. The client discarded the response before
resetting the worker, retaining its cached import failure. The next export
failed unnecessarily even after connectivity returned. Worker reset now runs
before the superseded-response branch. Both ASCII and PNG regression cases
fail against the pre-fix PR revision `4ed2ea241d123674965a76ae457f90db173a3fa7`
and pass with the fix. A Chromium reproduction confirms that the queued
preview and the first subsequent ASCII export succeed after recovery.

The rebuilt candidate was measured again for three rounds after this fix.
Blank-editor gzip is 134,070 B, first-flowchart gzip is 830,035 B across 58
assets, and fully consumed gzip is 2,029,557 B across 139 assets. This retains
the 45.0% first-flowchart saving and 2.3% fully consumed growth against the
same main build. The first-preview median was 473 ms; local timings remain
diagnostic. All 87 artifacts and 1,095 official results still match main
exactly, with 823 accepted inputs and no browser errors.

A second audit found that a cold terminal receipt could swallow deferred ELK
loading as an optional graphical failure. After a failed text download reset
the worker, switching Diagram → Unicode without editing returned correct text
but reported unavailable connector evidence. The terminal projection now
preserves provider suspension so the worker can load it and retry. Genuine
optional graphical failures still produce diagnostics. Cyclic and fan-in
flowcharts and a cyclic state diagram now have identical cold, warm and baseline
receipts. The normal text-pane recovery reproduction restores Scene evidence
for both Unicode and ASCII without another SVG render.

After both fixes, three rounds measured 134,068 B for the blank editor,
830,006 B across 58 assets for the first flowchart, and 2,029,557 B across 139
assets when fully consumed. The first-preview median was 472 ms. The 45.0%
first-flowchart saving, 2.3% fully consumed growth, 87-artifact parity and
1,095-result parity remain unchanged. These measurements retain the local
network limitations above.

## Correctness and checks

- **87/87 captured artifacts match exactly** between builds across three
  sessions: inserted tree SVG/receipt identity, all family SVG/receipts/
  verification, Sequence ASCII and Unicode output, a hand-drawn rendering and
  PNG export bytes.
- The complete official inventory has **1,095 identical results**, including
  errors and digests of SVG/receipt/verification data; **823 accepted** in both
  builds. Its corpus and acceptance definition come from the existing official
  fence inventory, not a newly selected subset.
- **144 affected tests pass** after the second audit fixes, covering terminal
  output/security, family registration/conformance, cache ownership, routing
  diagnostics, PNG, worker behavior, benchmark evidence and community discovery.
  Seven assertions fail against the pre-fix PR head `775155b1`; import failures
  from newly introduced modules are not counted as regression proof. The
  rebuilt tarball also passes the exact 213-file manifest.
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
- Typecheck, lint, generated-family checks, existing website and library-lazy
  payload budgets, the per-PR gzip comparison and `git diff --check` pass.
  No budgets were raised. Keeping the adapter option helper outside the shared
  render-contract module avoids perturbing its unused-function minification;
  Block remains within its existing Brotli ceiling (212,989 B / 213,000 B).

No rendering goldens changed. Output parity establishes rendering stability;
the recovery UI below has separate desktop and mobile screenshots.

## Third audit fix qualification

The production changes through `c97a25cb04cdc727f0b223278bc1018b8ce6ea26`
were measured against the retained `861375d3` main build in three Chromium
sessions. Recovery adds 662 B gzip to the preceding blank editor. The current
totals are 134,730 B for blank, 830,754 B across 58 assets for first flowchart
and 2,030,309 B across 139 assets fully consumed. Against main, the first
flowchart saves **44.9%** and the fully consumed graph grows **2.4%**. The
first-preview median was 467 ms versus 502 ms on main. These remain local
diagnostics under the measurement policy above.

All 87 captured artifacts and 1,095 official-corpus results still match main
exactly, with 823 accepted and no browser errors. The full browser library's
shipped bytes also match the previous Modern Mermaid engine qualification;
these recovery changes do not replace its retained 9,855 engine attempts.

The current 150 affected tests pass across 11 files. Six new cases fail their
behavioral assertions against `adbda37d` production in the canonical red/green
runner: three raw repository host cases and three runtime availability cases.
All 24 editor interaction tests pass (400 assertions). Reload preserves exact
source and settings with storage blocked at 1280 px and 390 px; failed encoding
leaves the draft in place. The actual two-build rollback probe also passes at
both widths, including reopening the older baseline editor. The synthetic npm
CLI fixture now retains its GitLab URL, package match and source-review status;
it is not evidence that the named package actually changed hosts.

Typecheck, lint, family-generator freshness, website/library payload budgets,
per-PR payload comparison and the exact 213-file package manifest pass. No
budget increased. The readiness heuristic's secret matches are registry
`Symbol` tokens, and its console matches are intentional diagnostic output.
The full suite remains assigned to CI. The existing browser CI artifact
captures `current-runtime-recovery-{1280,390}.png` before reload and
`current-runtime-restored-{1280,390}.png` after state restoration. Review the
visible recovery action, wrapping at mobile width and restored diagram.

## Why the earlier audits missed the third round of findings

The earlier checks covered many inputs within a fixed environment. They did
not cover every transition between environments or representations. Three
specific gaps explain these findings:

| Finding | What we checked | What we missed |
| --- | --- | --- |
| Removed SVG chunks after rollback | A fixed site tree; blocked downloads followed by restoration of the same files; cached-family editing | An old document and module map requesting an unseen family from a different deployment's asset manifest. Resetting a worker cannot repair a permanently removed URL. No earlier audit lane explicitly owned this deployment boundary. |
| Non-GitHub ownership conflict | Missing metadata and conflicting GitHub repositories at the candidate-matching boundary | npm ingestion had already discarded explicit URLs on other hosts. The preceding owner-fallback fix then treated that loss as absence and silently catalogued the package. This misclassification was introduced by the fix, rather than merely overlooked in the original implementation. |
| Missing responsibility categories | Valid category names, graph endpoints, benchmark roles and selected source reviews | Semantic completeness against each project's public packages and authoring flows. Crafter's parser package was already recorded, and Visimer's parser role obscured its separately exposed editor. Valid labels did not prove complete classification. |

The owner fallback entered in `0b5396e7`; its tests passed already-normalized
candidates to matching. They never composed the URL parser with that fallback.
The categories entered in `10e1bd92`. Our checks and audit assignments reused
the same assumptions about these boundaries, so additional agents and larger
input matrices did not provide independent coverage of those assumptions.

The deployment fix offers **Reload editor** on runtime loading failures. It
encodes the current source, palette, style, seed and config before reloading,
without requiring a successful render or browser storage. It refuses to reload
if that state cannot be encoded. The action also covers worker bootstrap
failures, and disappears after a successful retry. This is explicit recovery;
it does not retain every historical deployment's asset graph.

Permanent browser coverage retires unseen runtime assets after a successful
preview, then checks reload and exact state restoration at desktop/mobile
widths with storage denied. A separate case checks that failed state encoding
does not navigate away. A local reproduction switches between actual PR and
baseline builds to verify rollback recovery. Availability callbacks also
ignore superseded results.

Discovery regression cases now enter through the same repository parser as
the npm ingestion path, preserving explicit GitLab, Bitbucket and self-hosted
URLs before owner matching. The category corrections cite pinned public
READMEs. These guards address the demonstrated gaps; they do not establish
that every responsibility of all 87 projects has received a fresh source audit.

For future reviews of this delivery change, deployment transitions and raw
metadata ingestion need explicit ownership alongside rendering, benchmark
integrity and discovery policy. More agents or more diagram examples on the
same paths would not exercise those missing boundaries.

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
