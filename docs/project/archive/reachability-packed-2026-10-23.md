# Reachability rebase and packed public decision evidence

PR #469 is rebased onto main `861375d33807a668a0dd3674257840d027ea299e`. It remains a blocked draft: the unchanged Block lazy-browser budget fails. The new measurements support a narrow Node parsed-analysis benefit, but do not establish faster public SVG rendering or uniformly lower public allocation. There is no basis here for raising a payload budget or advertising an overall rendering improvement.

## Frozen comparison

The measured rebased candidate is `ccc511d77a801827cfa6246233681018c465db1e`; its production, package, dependency, build and maintained evaluator inputs are unchanged from the previous PR head `3420c378a7c98e9a4f40f89f2da82d42ad3cc23c`. Main has the same tree as the former #468 reporting base. The rebase introduces no additional production change.

| Artifact | Source revision | Verified npm archive SHA-256 |
|---|---|---|
| Main baseline | `861375d33807a668a0dd3674257840d027ea299e` | `dd29c5601aef482f2f8522209b1393a611062642be8d6751854bedbe5e24b207` |
| Rebased candidate | `ccc511d77a801827cfa6246233681018c465db1e` | `cfa22f1765b20044b637b006f46225ee1138a6564f418408174ea5c92a88fffb` |

Both packages were built with Bun 1.4.2 and verified with npm 11.18.0. All 213 extracted files per package match an independent extraction of their original archive. Both roots resolve the identical frozen 12-package runtime dependency graph, including the host-active native Resvg package and nested dependency versions. The acquisition receipt distinguishes lockfile integrity metadata from independently verified installed dependency bytes; it is an inspected offline installation, not a fresh registry acquisition.

Measurements use Node 24.20.0 on macOS arm64, plus Bun 1.4.2 for the analysis supplement. The older owner's Node 24.19.0 results retain their original attribution. New runs select the packed library's feature defaults: an absent `AGENTIC_MERMAID_EXPERIMENTS` setting enables those defaults, whereas an explicitly empty setting disables them. An earlier complete release run with the empty setting is retained as a legacy-feature diagnostic and is not relabeled as default-feature qualification. Current release/browser follow-ups and their exits are recorded separately in the PR validation notes and downloadable evidence.

## Payload decision

Fresh same-toolchain builds reproduce the current CI measurement exactly:

| Block lazy-browser closure | Brotli bytes |
|---|---:|
| Main | 212,995 |
| Candidate | 213,172 |
| Unchanged cap | 213,000 |

The candidate adds 177 bytes, consumes the baseline's five bytes of headroom and exceeds the cap by 172 bytes. The older 213,108/+108 result is historical. Both canonical builds and package-manifest verification succeed; the candidate's separate browser-lazy budget check fails. The frozen npm archive is 260 bytes smaller overall, which does not satisfy a particular browser transfer-closure ceiling. #433 is not included in this comparison and its independent savings do not establish combined headroom.

## Fully consumed public rendering

The original focused screen has 80 serial fresh workers: seven baseline/candidate pairs and three interleaved baseline/baseline controls for each cache policy and measurement mode. It measures public `renderMermaidSVG` with complete UTF-8 encoding, and public `renderMermaidSVGWithReceipt` with complete SVG encoding and full receipt JSON serialization. Full output fingerprints are checked outside timing. Timing and V8 allocation observations use separate processes. All workers and output checks complete without failures or refusals; the empty flowchart actually returns SVG.

These fixtures are newly defined public workloads, not a reconstruction of the unavailable earlier owner runner. Exact repeats and visible-label new-source inputs are separate rows. Cache-enabled repeats are not a guarantee that every internal cache admits every graph. Node allocation results are GC-boundary V8 heap estimates and exclude external typed-array backing stores, native/WASM memory, retained memory and per-call peak memory.

Chain400's eight SVG/receipt/cache/regime timing ratios span **0.9858–1.0291**, with mixed paired directions. They do not reproduce the earlier owner-level ratios near 0.5–0.65. Public allocation is mixed too: Chain400 ratios span approximately **0.9937–1.0345**, with noisy controls. One original Branch50 SVG/cache-off/repeat allocation row is 0.9958, lower in all seven pairs; its fixed-population confirmation is 0.9964, lower in five pairs and higher in two, within the matching A/A displacement. This does not establish a uniform public allocation improvement.

The original minimum-duration warming produces unequal warmup counts for fast inputs. Large-chain rows have matching direct counts, but earlier-row carryover remains a limitation. A separately frozen confirmation therefore retains the same six small/branch/nested/Sequence fixtures, uses exactly 20 warmups per row, and preserves seven paired rounds plus three interleaved A/A controls. Its 80 workers and all 1,760 successful worker rows complete with exact output agreement and exactly 20 warmups. The studies are not pooled.

| Earlier timing concern | Original ratio | Fixed-20 ratio | Fixed slower pairs |
|---|---:|---:|---:|
| Zero-edge consumed receipt, cache off, new source | 1.2329 | 0.9941 | 3/7 |
| Zero-edge SVG, cache on, new source | 1.1104 | 0.9894 | 3/7 |

The earlier adverse movements do not repeat under fixed warming. No preregistered material adverse timing/allocation diagnostic fires. This is not a proof of parity or zero overhead: two zero-edge allocation controls increase in all seven confirmation pairs by **144** and **240 estimated V8 bytes**, about 0.01–0.015%. The earlier approximately 9.714 ns Bun owner overhead remains historical owner evidence; these public measurements do not erase it.

## Public analysis supplement

The classifier also serves the public agent analysis APIs. A separate 40-worker supplement measures Node and Bun, each with seven fresh paired rounds and three interleaved A/A controls, fixed warmups and batches, complete JSON/UTF-8 consumption, and exact output checks. Source-inclusive `analyzeMermaidSource` and `analyzeMermaid` over an already parsed diagram remain distinct endpoints; parsing is excluded only from the explicitly parsed-once arm.

The clearest narrow positive is **Node parsed-once Branch50 analysis: 0.9109**, faster in all seven pairs, with a median paired saving of **25.36 microseconds per call**. Matching A/A maximum absolute displacement is 3.62% / 9.92 microseconds, below that median effect. It does not extend to source-inclusive Branch50 analysis (1.0023, mixed directions), Node parsed-once Chain400 (1.0017, mixed directions), or a general Bun speed claim. Bun parsed-once Chain400 is 0.9353 but has mixed direction and an A/A median of 0.9214. All source/parsed facts and paired output checks pass. No allocation claim comes from this supplement.

## Interpretation and reproduction

The code still performs repeated searches with total worst-case work O(E(V+E)). Sharing an implementation does not share one workspace across different owner invocations. Correctness evidence includes 381 affected-owner/built-determinism tests, both typechecks, scoped lint, 1,888,400 independent reachability queries, 50,000 mutation states, 1,000 owner cases and a forced rollover with a stale generation mark and pending stack work.

The narrow parsed-analysis result is a concrete reason to retain this as an experiment. The rendering and allocation data do not justify selecting it as a broad performance improvement. Keep the unchanged payload failure blocking. Any source tuning or integration with #433 needs a new named combined artifact and affected measurements; independent PR ratios cannot be added.

The [portable reproduction instructions](../../../eval/benchmark/reachability/README.md) and runner sources are committed. Raw configurations, original and confirmation runners, process exits, output fingerprints, acquisition inventories, all observations, independent checks and the frozen npm archives are supplied in the chat's `pr469-rebased-measurements.zip`; generated reports are not committed. The older [owner report](reachability-followup-2026-10-23.md) is retained as historical evidence. Measurements are from serialized jobs on one desktop host, not isolated hardware; A/A noise, limited rounds, workload selection and the stated memory limits remain material constraints.
