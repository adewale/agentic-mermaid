This PR contains the PR449 ownership/capture foundation and recovery fixes for bounded layout delivery, marker paint, forest/Requirement geometry and worker packaging. **The campaign is stopped. The PR remains draft; the evidence does not establish a general ELK replacement or a performance win.**

Head: `62d521fbce155cdd3de928ec62fc5222fa3a8482`. Integrated main: `9fb35b8bf8dc654a19612de3cc6a50144d68b0a7`. No backend-default or version change relative to that main; no rebase or force push.

## What is demonstrably better

The frozen six-input main9fb/PR780 comparison consumed complete SVGs and entire receipts. These are selected results at that checkpoint, not a workload-wide ranking or a new final-head main comparison:

| Input | Main9fb → PR780 |
| --- | --- |
| ER208 chain, omitted backend and Native | 400k geometry refusal → delivered SVG; 208 identities, 207 ordered relationships |
| Nonlinear forest, omitted backend and Native | Area −26.98%, wire −37.60%; eight bends unchanged |
| Raw hollow circle | Selected marker contribution 0 → 225 pixels; proof remains unverified |
| Native Sparse256 | Area −77.05%; connected wire unchanged |
| Native Requirement TB | Area −22.95%, wire −8.56%; eight bends unchanged |
| ER256 chain | Both refuse at the unchanged geometry cap |

The latest commit independently repairs three selected visible losses against PR780: SHA201/241 arrowheads each go from **4 hidden / 12 attenuated pixels to 0/0**; SHA152's shaft/card interval goes from **122 hidden pixels to 0**. These are marginal owned-ink measurements, not whole-diagram readability scores.

Crowded ordinary rectangle/subroutine faces now use separate measured marker/shaft supports without growing bodies. The shared shortener retains known numeric foreign-node clearance. Endpoint support follows private reversals; unknown/oversubscribed faces retain legacy fallback. The ownership foundation preserves mutable/getter/CSS/definition isolation and UTF16 diagnostics. Existing caps remain; no cache was added.

## Tradeoffs and limits

Latest same-input comparison: **874 Native + 874 ELK** products. Native changes 271 SVGs, with no delivery changes, 76 proof upgrades and no proof downgrades. **76 proof upgrades are not 76 visible repairs.** ELK geometry/SVG is unchanged; 172 receipts change, including 171 proof-operation increases of 2–20.

| Latest Native quality vector | More | Less |
| --- | ---: | ---: |
| Area | 34 cases | 43 cases |
| Wire | 85 cases | 178 cases |
| Bends | 71 cases | 24 cases |

Actual standalone HTML: **1,323,398 → 1,323,609 gzip9 bytes (+211)**; raw +544, Brotli11 +206. The original 1,334,500 gzip ceiling remains. This is incremental cost against PR780, not the complete PR-versus-main download delta. Existing lazy payload failures remain.

The weighted-only trial introduced a real shaft/card contact in cyclic159. The joint fix removes it at +0.860714 wire and two bends versus PR780. That repairs an introduced regression; it is not a net delivery gain.

Open losses: oversubscribed SHA201 with three invisible constraints; other unverified drawings; Sparse32 proof cap; shared ER256 relationship-chain refusal; forest quality tradeoff (historical residual wire +10.19%, area −6.43% against ELK). Sparse256's implemented historical area gap is +5.04%; the +0.97% candidate is unshipped. Original2dad baseline, Trident and pinned Mermaid/Pele remain unavailable. Replacement24 remains sealed.

## Reproduction and verification

Run `bun test src/__tests__/native-layout-cache.test.ts --test-name-pattern 'measured primary port pitch'` to exercise the authored identities, text, written marker triangles and directional seating. Five supported output cases fail on PR780. Final nearby owners pass **223/223**; core types and canonical five-file lint pass. Actual standalone browser: **2/2, 504 assertions**. The broader run has 783 passes and 18 missing-jsdom loader failures; it is not a green run.

[Exact inputs, before/after SVGs, raw profiles, masks, adverse outcomes, logs and verified archive](https://github.com/adewale/agentic-mermaid/tree/ecfc69324aabf41fa39dca4e831f6cce08c42169/stopped-62d-20261107). The [fresh five-hotspot self/inclusive profile](https://github.com/adewale/agentic-mermaid/tree/ecfc69324aabf41fa39dca4e831f6cce08c42169/stopped-62d-20261107/PROFILE-FIRST.md) precedes this intervention; [the performance review](https://github.com/adewale/agentic-mermaid/blob/62d521fbce155cdd3de928ec62fc5222fa3a8482/docs/design/system/layout-0.6-performance-review.md) includes the cache inventory. No equal-work speedup is established.

[Final-head CI42374173275](https://github.com/adewale/agentic-mermaid/actions/runs/42374173275) was in progress when work stopped. Prior-head CI42368944274 failed on retained Sparse32/quality/payload losses. Neither result establishes readiness.

## Visual evidence

PR baseline SHA: `9fb35b8bf8dc654a19612de3cc6a50144d68b0a7`.
Latest incremental repair baseline: `780b5f1b04ac7ac5db35cdd442d98df652daf17d`.
Current PR head SHA: `62d521fbce155cdd3de928ec62fc5222fa3a8482`.

The latest overlap is small at whole-diagram scale. Inspect [201 before](https://github.com/adewale/agentic-mermaid/tree/ecfc69324aabf41fa39dca4e831f6cce08c42169/stopped-62d-20261107/before201.png) / [after](https://github.com/adewale/agentic-mermaid/tree/ecfc69324aabf41fa39dca4e831f6cce08c42169/stopped-62d-20261107/after201.png), [241 before](https://github.com/adewale/agentic-mermaid/tree/ecfc69324aabf41fa39dca4e831f6cce08c42169/stopped-62d-20261107/before241.png) / [after](https://github.com/adewale/agentic-mermaid/tree/ecfc69324aabf41fa39dca4e831f6cce08c42169/stopped-62d-20261107/after241.png), and their owned-pixel masks in INK.json. Full renders are preserved; no cosmetic crop is used as correctness evidence.

Campaign and deadline-report automations are disabled. No worker agents remain active. The preserved checkpoint is available for manual review; no further work is scheduled.

