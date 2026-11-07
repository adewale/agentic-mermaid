# What Native can learn from other Mermaid implementations and ELK research

Research date: 7 November 2026. Native source: `d8c8ac879793a586b4b741c178b89d7900bd27ed`. Production source was not changed. This is source research plus bounded Astra experiments, not a new peer performance ranking.

The most useful lesson is to make placement aware of the things routing and emission actually require: ports, labels, terminal leads and hierarchy. A faster language or smaller dependency graph can improve delivery cost, but cannot compensate for placing the wrong constraints at the wrong stage.

## What was actually recovered

The existing pinned [Trident](https://github.com/adewale/trident/tree/f080278e31e4202ca89d524e4ee9e4cf3cbff038) was fetched at its exact revision, its locked dependencies installed, and its real `bench --list --projects …` command executed successfully. Its 88-node community catalog supplied the implementation map. Selected sources and tests were inspected at exact revisions; the map does not claim all 88 repositories were audited. The catalog contains ports, forks, bindings and applications, not 88 independent layout algorithms.

`trident-list-recovered.log`, `SELECTED-CATALOG.json`, acquisition receipts and the reports below are retained. Three archives exceeded the 32 MiB acquisition bound; their partial downloads were retained and exact Git trees plus selected blobs recovered instead. No large upstream build was run. The initial install failed because the default Bun cache was read-only; a dedicated `/tmp` cache worked. These acquisition outcomes are not renderer failures.

Historical original-baseline, pinned Mermaid 12.2 and Pele 1.9 **artifact qualification remains unavailable**. Recovering source and Trident's runnable listing does not fill those historical result cells. Current Pele 1.13 source and its 1.9 tag were examined separately. There is no measured Native/Pele runtime, RSS or bundle ratio in this work.

## Conclusions

1. **Pele is the strongest direct algorithm comparison.** It puts offset-aware alignment and compound boundary-port order into layout, uses a single rank step by default and doubles it when labels or parallel/reciprocal edges need room. Long edges still require normalization. Native already implements many analogous mechanisms; the remaining question is their interaction and default policy, not whether Native lacks layered layout.
2. **Merman is important precisely because it also ports ELK.** A Rust implementation can retain ELK's algorithms while changing integration and packaging. Its phase-output parity, source provenance and typed interruption tests are more useful to us than language-level speed claims.
3. **Ondine and Bezel are Pele descendants.** They offer packaging, platform and compatibility lessons. Agreement with Pele is correlated evidence, not another independent layout vote.
4. **A source test is not final-output evidence.** Mermaid adapter tests, ELK phase tests, parser parity and independent paint checks answer different questions. We need the combination, while retaining refusal, unknown and unsupported outcomes.
5. **The best literature-backed memory opportunity is reducing long-edge expansion.** Sparse normalization removes work from the representation itself. It should precede a wholesale AoS→SoA rewrite or another cache, if an actual profile demonstrates expansion is material.

See [IMPLEMENTATION-MAP.md](IMPLEMENTATION-MAP.md) for pinned projects and concrete suites, [LITERATURE.md](LITERATURE.md) for the papers and our actual ELK options, and [Astra's corrected causal addendum](astra/ASTRA-PELE-ADDENDUM.md) alongside its [full Native/Pele review](astra/ASTRA-PELE-REVIEW.md).

## What Astra found in Native

The requested GPT-6 Astra agent inspected our source and official Pele.run/current Pele source, including the older Pele 1.9 source tag. Its strongest new experiment isolated spacing rather than comparing screenshots by eye.

For a four-node, four-edge diamond with literal 60×40 rectangles and requested 48 px layer separation:

| Fully consumed public Native SVG | Current source | External compensated experiment |
|---|---:|---:|
| Width × height | 160×227 | 160×216 |
| Physical gaps between real-node rows | 53.5 px | 48 px |
| Bends | 2 | 4 |
| Authored identities/relationships, literal outline contacts, no foreign-node interior hits | passed | passed |
| Strict final written-paint proof | passed | passed |

The cause is specific: Native halves nominal spacing for doubled ranks, but applies a two-sided terminal/track clearance floor at every active half-rank channel. Private dummy boundaries get terminal-like spacing. Dummy band heights are zero. The public producer's measured 13.375 px terminal lead becomes four 26.75 px gaps; later route simplification cannot recover the already allocated placement space.

The experiment compacts private ranks and compensates the spacing input. It is a **smaller admissible witness, not a nonregressing fix**: the sink moves horizontally and bends double. Simply enabling the existing compact flag is worse evidence: it changes physical separation and does not preserve the requested contract. The next useful geometry experiment must retain alignment and bends while assigning clearance to the boundary that actually needs it.

Other findings are narrower:

* The zero-crossing early return in owned refinement cannot be triggered by label conflict, overlap or excessive area alone, despite those quantities participating in its later score. This is a policy limitation; the diamond does not alone prove a better selection policy.
* Several completion, fitting and certification boundaries appear to repeat work. Their runtime contribution is unmeasured here. Native already skips many ELK-specific repair passes; calling the entire shared pipeline redundant would be false.
* A ladder produces three internal candidate computations but its final placement certificate records one candidate after recertification. This loses documented **internal search provenance**. Public backend-selection count one remains correct; paint-repair attempts are a third, separate counter. This is not a visible layout defect.
* Generic certification and owned refinement order some quality criteria differently. Make each phase's policy intentional and reviewable before changing it. A single universal weighted score is not automatically appropriate for every family.

Pele has different delivery obligations. Its ordinary curved rendering and long-edge direct-curve fallback are not equivalent to Native's orthogonal/contact/proof contracts. Native's final writing/paint binding, ownership isolation, UTF16 and work-cap tests remain valuable. Pele's more permissive SVG delivery does not justify weakening them.

## Recommended work, ranked by value

These are proposals, not implemented changes or guaranteed speedups.

| Rank | Intervention and first evidence needed | Why it matters / stop condition |
|---|---|---|
| 1 | Put real-terminal clearance, fixed offsets and long-edge alignment into producer constraints. Start with the diamond's proven half-rank cause, then a named ordinary/compound loss. Test a local allocation change while holding rank/order/offset decisions fixed where possible. | Potential quality gain without more repair passes. Stop if saved area necessarily trades away the owner's preferred bends, contact or spacing. Do not extrapolate this diamond to the forest fast path. |
| 2 | Profile fully consumed output, attributing solver, completion, fit, certificate, serialization and final ink separately. Attempt subtraction only at an identified duplicate ownership boundary. | Potential time/allocation reduction. The proposed removal must materially affect end-to-end cost and preserve final-output checking. Do not add caches or reuse a stale certificate after mutation. |
| 3 | If long-edge normalization dominates, prototype sparse segments instead of per-rank dummy objects; keep stable real/virtual identity and port/label constraints. | Potential structural memory and solver-time reduction. Measure normalized V/E, peak memory and ordering cost first; stop if current caps make the effect immaterial or feature reconstruction dominates. |
| 4 | Add missing **combinations** from peer tests to existing owning suites: compound boundary order + labels + all directions; long edges + terminal offsets; seeded parser mutations with explicit divergences; phase checks that fail if never reached. | Better correctness and localization. First establish the gap in current tests; do not copy an entire suite or count parser parity as visible correctness. |
| 5 | Measure emitted dependency closures for core, each family and each backend; retain explicit registration/lazy boundaries and honest optional-ELK failure. | Potential payload/startup savings. Native already has lazy solver boundaries. Report actual gzip/Brotli/request graphs and required fonts/WASM; do not substitute package metadata or an uncompressed single chunk. |

Preserving internal candidate trace is a small diagnostic correction worth doing beside the relevant producer work, not a substitute for a user-visible improvement. Offset-aware corrected Brandes–Köpf is an algorithm candidate for a demonstrated alignment/wire loss, not a mandate to replace the solver wholesale.

The prior forest fixed-dock routes were already shortest: investigate dock choice, ordering and coordinates, not another shortest-path pass over fixed endpoints. Shared ER256 relationship-chain refusal and Sparse32 proof limitations remain separate problems. This research does not solve them, reopen the stopped ER shortcuts, ship Sparse256's backfill candidate or unseal Replacement24. Automated campaigns remain disabled.

## Measurement boundaries

Trident's existing fidelity mutation tests distinguish swapped/missing endpoints, labels, direction and membership from paint. Its portable measurements distinguish browser heap from whole-process/native/WASM memory and use shared successful inputs for timing. Reuse those tools when qualifying recovered artifacts. Source experiments here are explicitly not release qualification.

All peer test descriptions below are inspected source unless an execution is explicitly recorded. No upstream suite was executed, and no measured speedup is claimed. Astra's small public Native probes did execute, with literal SVGs and independent contact checks retained under `astra/`.
