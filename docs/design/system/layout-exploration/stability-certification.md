# PR449: stability, proof scope, readability and architectural subtraction

Exploration date: 2026-10-22. Source inspected at PR HEAD `9ffd5369cbc9676dbeb07c06abf3fc33c76bd5b9`; the qualification renderer is frozen at `e9db0dbe8bac597f6db7198ecfe388f5cfbbbf01`, `agentic-layered@22`. This note reads source and retained evidence; it does not run builds, tests, renderers, timings or profiles. Proposed experiments below have not been implemented or measured here.

The most useful next step is to remove ambiguous claims and redundant derivation, then improve the few geometric predicates responsible for uncertainty. More global repair passes, more proof budget and a universal readability score would increase complexity without addressing the observed causes. Keep semantic validity, geometric proof, stability and human readability as separate outcomes.

## What the current evidence establishes

| Aspect | Existing evidence | Assessment against ELK |
| --- | --- | --- |
| Source paint certification | Native 219 passed / 27 unverified; ELK 217 / 29 across 246 occurrences. Native 180 uncertainty issues, ELK 208. | Small aggregate advantage in this source population; no universal superiority. |
| Generated paint certification | All 634 shared successes remain unverified for both; native 6,507 issues vs ELK 6,878, but native has more issues in 48 cases. | Neither has established strict paint certainty on the generated population. Unknown does not mean invalid output. |
| Edit motion | 31 comparable transitions: native 13 better / 14 equal / 4 worse for translation-aligned unchanged-node motion. Fallback has 20 relative-order inversions vs ELK 17. | Mixed; native has not beaten ELK on every edit. |
| Undo | 36/36 undo checks pass across both cache policies. | Deterministic undo is established for those sequences; this is not an incremental layout or usability guarantee. |
| Ports | One retained Architecture witness preserves `disk:T -- B:server` in both our engines; Zombie 5.8.2 default/simple use R/L. Full preferred-port evaluation is absent. | Demonstrated local semantic strength against one peer, not an all-input port ranking. |
| Symmetry/readability | Internal selective barycenter/port metrics exist; full external symmetry/preferred-port coverage and human task evidence do not. | Unestablished. Counting crossings does not prove comprehension superiority. |
| Browser delivery | Native solver closures are substantially smaller than selected ELK closures for all six families. Architecture default closure has only 7 Brotli bytes below its 574,000-byte cap; standalone has 2,749 raw bytes below its cap. | Native transfer advantage is measured; default/standalone maintenance headroom remains poor. |

Evidence: [`layout-qualification.md`](../../../../docs/design/system/layout-qualification.md), especially paint, edit, browser and qualification-table sections; [`layout-community-port-witness.json`](../../../../docs/design/system/layout-community-port-witness.json). Source population is 246 occurrences but only 231 distinct strings, so it is not 246 independent authored designs.

### A particularly informative retained cohort

I aggregated issue reasons from `pr449-evidence/qualified22/sha256-counter-v1-192-agentic.json` and its `-elk.json` counterpart (counter values 192–255; 64 samples per engine). This is analysis of saved JSON, not a new renderer run.

| Saved receipt field | Native | ELK |
| --- | ---: | ---: |
| Unverified certificates | 64/64 | 64/64 |
| Later fill / endpoint-marker uncertain intersection issues | 639 | 647 |
| Connector envelope / unrelated card uncertain crossing issues | 14 | 34 |
| Text-band uncertain intersection issues | 0 | 5 |
| Maximum recorded predicate operations | 4,576 / 400,000 | 5,059 / 400,000 |
| Maximum recorded occlusion pairs | 1,679 / 100,000 | 1,866 / 100,000 |

There is no budget-exhaustion issue in this cohort. Raising the operation or pair limits cannot resolve these unknowns. Marker/body representation and final-route/card predicates are the appropriate targets. These counts do not prove that all remaining unknowns are false alarms; inspect exact witnesses before deciding.

## Preserve three different contracts

1. **Validity and semantics:** endpoints, identity, text, directions, group membership, required ports, output security and renderability. A faster output that changes these is a regression even when prettier.
2. **Proof scope:** what can be established about the actual positioned artifact and final paint under explicitly admitted styles/fonts/backends. `unverified` is an honest result. It must not become `passed` because work was skipped or an approximation was ignored.
3. **Readability and stability:** task-dependent preferences about crossings, route continuity, motion, area, symmetry and orientation. They can conflict and need distributions and tasks rather than one alleged proof of beauty.

[`docs/layout-certification.md`](../../../../docs/layout-certification.md) already makes important distinctions: proof is bound to the positioned artifact and secured output digest; `strict` needs a passed final certificate; `report` retains limitations and still rejects proven native occlusion/pass-contract failures; viewport repair may expand outward once without changing graph geometry. Do not subtract these safeguards.

## Paint certification: subtract repeated derivation, retain soundness

Actual source: [`src/scene/paint-certification.ts`](../../../../src/scene/paint-certification.ts), [`src/scene/positioned.ts`](../../../../src/scene/positioned.ts), [`src/graphical-render.ts`](../../../../src/graphical-render.ts).

Several obvious-sounding optimizations already exist. Native crisp rendering already has a flat `NativeDrawing` path without a Scene document/group tree. Scene/native drawings and certificates are retained in per-layout/per-resolved-request WeakMaps. The checker already builds a spatial tree, uses exact inset rectangle interiors for positive occlusion evidence, tests convex polygon separating axes, handles ellipse support-line separation, accounts for transforms and distinguishes attached outlines from unrelated cards. Do not report these as newly discovered missing features.

The genuinely useful experiment is to carry **one authoritative retained geometry witness** through drawing, inspection and certification, rather than independently reconstructing bounds, ownership, path segments and projections. Start by profiling allocation/call attribution for the existing paths; request-object identity may prevent reuse across equivalent public calls even though reuse within one call is present. A content-addressed cache is only safe if its key binds geometry, text measurement/font state, style, backend, proof implementation version and final output/digest context. Cache-size/retention and invalidation costs must be enrolled; global source-string-only caching is insufficient.

For precision, use a filtered-predicate design: cheap disjointness tests first; exact or interval-bounded predicates for supported ambiguous pairs; `unverified` when the narrow phase cannot decide. [CGAL's Filtered_kernel documentation](https://doc.cgal.org/latest/Kernel_23/structCGAL_1_1Filtered__kernel.html) is useful industrial practice: exact predicates are distinct from potentially inexact constructions. Importing CGAL is not the recommendation, and a sound predicate does not make an approximate rendered path exact.

Concrete precision work should be driven by recorded witnesses:

- Retain the actual marker shape, local-to-world transform, anchor-owner relation and outline/contact band, then test the same painted shape against the later fill. Do not waive all attached marker issues: a marker can legitimately touch its owning outline yet be hidden by a different later card.
- Distinguish final straight segments, rounded joins, curves, stroke width, caps, dash and transforms. Certifying the raw orthogonal centerline does not establish that the rounded painted stroke avoids a card. Exact convex/ellipse separators already cover some cases; first identify which unsupported representation defeats them.
- For complex paths, conservative subdivision with explicit interval error bounds can sometimes prove disjointness. A bounded unresolved branch remains unknown. A numeric sampling test without an error bound is diagnostic evidence, not a proof.
- Preserve hard failures for proven hiding/crossing. The objective is fewer *unnecessary* unknowns with unchanged or stronger soundness, not lower issue totals by weakening the obligation.

An explicit noncertifying preview API could be explored only if profiling shows certification materially dominates a desired editor workflow. It is a new contract: today even plain SVG report mode certifies, can repair the viewport and rejects proven failures. Such a preview must explicitly report unavailable/unverified proof, retain output security and minimum hard invariants, and require certified export when strict proof is requested. Quietly skipping certification in the existing default is not compatible subtraction.

## Edit stability: subtract hidden policy switches before adding motion heuristics

Actual evaluator: [`eval/layout-compare/stability.ts`](../../../../eval/layout-compare/stability.ts), sequences: [`edit-sequences.ts`](../../../../eval/layout-compare/edit-sequences.ts).

The evaluator is already appropriately candid that it does not establish usability. It matches stable public node identities, uses median translation of unaffected nodes, normalizes by the original median node diagonal, retains raw/global and aligned motion, and reports relative order inversions. But route changes compare exact polyline vertex sequences, attachment sides are bounding-box proxies, and duplicate edge identities use source occurrence order. Segment splitting can therefore count as a changed route even with identical visible geometry. Duplicate insertion may have no unique correspondence.

Two controlled improvements should precede a new layout objective:

- Classify edit intent before running: local rename/label growth, structural insertion/removal, group membership, authored port change, global direction change, and backend-eligibility change. Empty affected sets for direction/hint changes currently expose global motion; retain that measurement but do not interpret it like a local rename. Do not enlarge the affected set after seeing poor results.
- Add geometric route distance modulo collinear segmentation, plus endpoint/route-topology changes, while retaining exact route differences as a determinism diagnostic. Add per-component/cluster translation as a secondary view, retaining current raw/global values so component translations cannot disappear from the report. Mark ambiguous duplicate matching unavailable rather than fabricating identity.

The strongest subtraction hypothesis is **explicit backend stickiness within an interactive edit session**. An automatic eligibility transition can replace native with ELK (or vice versa), causing a second source of motion unrelated to local placement quality. A declared session policy could keep the selected backend until a requested full relayout; unsupported native edits must still visibly decline or use an explicitly selected stable fallback policy. This is not permission to run unsupported constraints through native. Measure the switch boundary separately from the solver's own stability.

If we implement true incremental layout, make the previous positioned layout and edited identities explicit session inputs. Preserve stateless rendering's history-independent behavior; do not smuggle previous results into a global cache and make output depend on call order. Start with relative rank/order preservation and route-scope reuse under hard validity constraints, then add a bounded movement penalty. A user-requested global direction change must be allowed to move nodes; fixed coordinates can make valid geometry impossible after label growth.

Literature supports task-specific evaluation rather than a blanket zero-motion target. [Archambault and Purchase's orientation experiment](https://eprints.gla.ac.uk/78675/) found benefits for the tested navigation/orientation tasks. Their [subsequent review](https://eprints.gla.ac.uk/108356/) cautions that a general minimal-change definition did not have conclusive support for dynamic-series comprehension. [Xu, Kliger and Hero](https://arxiv.org/abs/1202.6042) provide an online temporal-regularization formulation, but their MDS/Laplacian results do not prove the same tradeoff for compound layered Mermaid diagrams.

Industrial reference points are explicit rather than magical: [yFiles incremental layout](https://docs.yworks.com/yfiles-html/dguide/layout-incremental_layout/) accepts an existing sketch and marks incremental elements; [ELK semi-interactive crossing minimization](https://eclipse.dev/elk/reference/options/org-eclipse-elk-layered-crossingMinimization-semiInteractive.html) preserves in-layer order from prior positions while still optimizing long-edge dummy crossings. Compare against a configured incremental ELK baseline when claiming an incremental advance; current cold stateless ELK is a different baseline.

## Ports, symmetry and human readability: narrow the claim, improve measurement

Internal [`src/layout/certification.ts`](../../../../src/layout/certification.ts) already orders candidates lexicographically by unreadable titles, crossings, label conflicts, bends, endpoint preference, peer barycenter delta and area. [`src/layout-rubric.ts`](../../../../src/layout-rubric.ts) is deliberately selective: `peerBarycenterDelta` covers 2–6 mutually unreachable co-layer fan-in/fan-out peers, with shape and group gates mirroring the optimizing pass. It measures that local promise, not graph automorphism, global reflective symmetry, visual balance or human preference. Some justified bundle/symmetric-convergence bends are also excluded from rubric bend totals. External comparisons must keep raw geometric bends separate from rubric-adjusted values.

Use three separate endpoint measurements: authored side/port/endpoint correctness as hard semantics; exact boundary contact and initial/final tangent as geometry; preferred canonical contact/centering as soft quality where no authored constraint overrides it. The current bounding-box side-change proxy cannot serve as all three, particularly for diamonds, circles, group terminals or explicit Architecture sides. Preserve unavailable denominators rather than score unsupported shapes as perfect.

For symmetry, first publish the narrow local metric with its eligibility count. Add a small independent suite for reflective arrangements and corresponding branch/label balance without claiming every graph should be symmetric. [De Luca, Kobourov and Purchase](https://arxiv.org/abs/1808.01031) show that different symmetry types have different perceptual salience; a centered barycenter is not a universal symmetry score.

Readability requires family tasks. [Purchase, Allder and Carrington's UML preference study](https://jgaa.info/index.php/jgaa/article/view/paper54) reports different priorities from domain-independent graph experiments. A practical small study should randomize engine labels/order and ask users to trace relationships, identify a required port, answer a Class inheritance or ER cardinality question, and locate changes after a local edit. Measure errors/time and collect reasons separately from visual preference. Curated cases should include native wins, native losses, labels, authored ports, compounds and high-degree graphs. Peer outputs must first pass semantic/text checks; a missing required relationship can make an output simpler and faster to understand for the wrong reason. An internal reviewer gallery is useful triage but does not establish statistical human-readability superiority.

## Distribution and architectural subtraction

The community JSON and comparison document expose useful product choices, not interchangeable payload claims:

| Referenced approach | Transferable subtraction | What must remain explicit |
| --- | --- | --- |
| [Ondine](https://github.com/wevm/ondine/tree/0b589ec34481856b4153526f10a0a35558a201a8): compile diagrams ahead of time; mount already compiled SVG; optional per-family WASM compiler | For documentation/static sites, remove parser/layout/proof execution from the reader's browser by doing it at build time. | This moves work to compilation. Its tiny mount runtime is not a renderer-byte comparison; runtime editing still needs a compiler. Bind exported SVG/receipt to source/config and maintain safe mounting. |
| [Pele](https://github.com/obsidianmd/pele/tree/1dd58b7ebb0ec654fa7dc4304d50cf8fd3a65d7b): core plus family registration/lazy imports | Offer small capability entrypoints rather than force all families into every application. | Our browser build already has lazy family/solver boundaries. Measure emitted reachability; deleting adapter LOC may not remove the shared solver or verification core. |
| [Zombie](https://github.com/dfadler/zombie-mermaid): separate ASCII and SVG renderer packages; opt-in narrow simple solver | Let terminal-only consumers avoid graphical dependencies and give small solvers explicit limits. | Current source supports this package design, not an equivalent cross-package benchmark. Our terminal report already defers proof where appropriate; graphical report has a different failure contract. Don't copy a known port-loss shortcut. |
| [Merman runtime ADR](https://github.com/Latias94/merman/blob/71da4cf6fbbf4fcf27fb0465cc9169f6fd6ebd8b/docs/adr/0074-browser-runtime-and-benchmark-ownership.md) | Give acquisition, session lifetime, request snapshot, cancellation and publication one explicit owner each; avoid duplicate coordinators/caches. | Synchronous WASM/JS cannot observe an abort handler mid-call on the same realm. Hard cancellation needs a worker/process boundary. This is architecture guidance, not a claim our current worker path is absent. |

Inspecting [`tsup.browser-lazy.config.ts`](../../../../tsup.browser-lazy.config.ts) and [`scripts/build/browser-lazy-report.ts`](../../../../scripts/build/browser-lazy-report.ts) prevents several false wins: both solvers are already on demand; HTML entity decoding is already separately loaded; schema documentation prose is already stripped while runtime validation remains. Initial, family-static and selected-solver closures are checked separately. Class/Requirement native closures add one request. A compressed-byte cap with 7 bytes of headroom is fragile to chunk hashes/boundaries and shared-code changes; maintain the cap but add a deliberate reserve target and an explained byte-delta report. Do not simply raise the cap or remove runtime validation to manufacture green status.

Architectural complexity should be assessed by ownership and work, not only line count: one owner of final route geometry, one authoritative projection, one certificate per exact artifact, and one candidate-selection policy. Remove a repair pass only after an ablation shows its required obligation has another owner and its unique counterexamples still pass. In particular, Architecture's final side-constrained router must retain every original relationship; a temporary placement route cannot replace it. Generic after-the-fact repairs can create oscillation, changed ownership and repeated scans. Prefer an earlier explicit constraint or remove a redundant repair rather than add another post-pass.

## Prioritized experiment plan and stop/go criteria

These are concrete experiments for subsequent implementation; no new performance result is claimed in this note.

| Priority | Experiment | Success / decision criterion | Main risks and retained controls |
| --- | --- | --- | --- |
| P0 | Census all saved uncertainty witnesses by primitive/shape/transform/owner/curve and stage; preserve issue-level examples and uncapped counts where issue truncation occurs. | Pick the smallest predicate/representation change explaining a large fraction of unknowns; distinguish real collisions from conservative envelopes. | Counting fewer issues is not proof improvement. Keep failures and unsupported cases enrolled. |
| P0 | Profile native flat drawing, projection, inspection and certification object/call attribution before introducing another representation/cache. | Identify a repeated derivation with measurable cost and a single authoritative replacement. | Existing retained fast path already solves some duplication; adding a cache may increase heap or hide font/style invalidation. |
| P1 | Ablate one duplicate geometry/projection pass, preserving exact final-artifact proof and digest/security order. | Identical output/proof semantics and lower attributed work; no new native/ELK quality regressions. | Do not skip security after byte-changing projections; preserve all proven-failure rejections. |
| P1 | Add one narrowly proved marker/fill or final stroke/card predicate selected from the census. | Converts independently verified disjoint cases to passed checks, catches planted positive intersections, preserves unknown near-degenerate cases; bounded cost. | Exact construction vs exact predicate; transforms, caps, joins, dashed/transparent paint, numeric margins. |
| P1 | Re-evaluate edits by declared intent; add segmentation-invariant route distance and semantic port correctness. | Better diagnosis of the four losses and eligibility discontinuity; unavailable/ambiguous denominators explicit. | Don't erase raw/global motion, redefine affected sets after seeing scores or relabel every loss expected. |
| P1 | Compare explicit session backend stickiness / previous-layout order constraints with stateless native, stateless ELK and configured incremental ELK. | Reduce local-edit p95 motion/order/port changes without worsening hard validity or agreed crossing/label limits; global relayout remains available. | History-dependent output is confined to session API; native declines remain truthful. |
| P1 | Reachability-based browser subtraction experiment: precompiled-SVG workflow and capability-specific entrypoints; reserve headroom. | Actual acquired bytes/requests and first-use work improve for stated workflows while runtime-edit users retain needed capabilities. | Mount runtime vs compiler comparison; source LOC vs emitted closure; extra request latency, CSP/security and artifact staleness. |
| P2 | Publish qualified port/local-symmetry metrics and run blinded family-task evaluation on retained wins and losses. | Task errors/time and metric agreement support a scoped claim; otherwise keep preference dimensions separate. | Small biased galleries, uneven author familiarity, semantics omitted by peers, overfitting one family. |

On narrower engine-family deployment: proof scope follows painted primitives and output modes, so dropping a diagram family does not automatically remove the shared marker/checker problem. Evaluate *eligibility and ownership complexity* within families as well as family names. It may be rational to keep difficult Architecture/ER constructs on ELK while exposing the owned engine for simpler supported subsets, but only a full retained counterfactual can establish the quality/cost tradeoff. Never remove authored ports, membership or labels to enlarge the eligible subset. A narrower truthful product promise is preferable to broad silent degradation; universal strict paint certainty and universal human-readability superiority remain unproved for both engines here.
