# Sequence ownership and cache lifetime follow-up

Status: retain the narrow Sequence ownership transfer in PR #468, stacked on #467, for repeatable miss-allocation savings. Full qualification and both bounded adverse-point confirmations are complete. Timing remains unresolved; this is not an overall speed or memory improvement claim. The native recorder experiment is rejected. Renderer cache lifetime controls are implemented separately but blocked by unchanged payload caps. None of these PRs has been merged or published by this campaign.

## Why this change

The earlier campaign established private borrowing on native render cache hits. A fresh Sequence miss still cloned the complete positioned model and certified projection before retention. The original Sequence hook parses a fresh private diagram; its mutable geometry has no caller alias, and shared prepared text is deeply frozen. The private SVG renderer reads that model without exposing it. Transferring it into the existing cache removes the temporary clone and provenance restoration while preserving public mutation isolation.

The transfer requires the original privately enrolled descriptor, exact default backend, private native render entry, SVG output, assertions disabled, and every existing cache eligibility rule. Replacement descriptors, public positioning, custom text measurement and other outputs keep the existing copy boundary. One helper still owns key isolation, estimated weight, quota checks and insertion. This keeps retention policy in one owner without creating another cache or public bypass flag.

The risk is future code exposing or mutating the retained private model. The owner guard now covers public miss/hit mutation in both orders, nested arrays, links, points, prepared text, parsed caller input, replacement layout aliases, projection failures and reentrant custom measurement. It passes against the old copying implementation too: this is a performance refactor with semantic regression guards, not a red/green behavior fix.

## Component selection

The selected implementation candidate is `cd735107876616bff09b53d4c38bdfae1bec7984`, based on #467 head `c9f70391c00366d02e7499f8b187f1a31360eecc`. Its production baseline is #467 `271197b7174692091c36b91ec65353e197777653`. The actual canonical build produces archive SHA-256 `61c513df1ad91724418ccaf79a4d4648017cee6548ed2c5403504e5bfc117744`; baseline archive is `0bfad2abf04f30a477749a01a4e794b2a794d0a89ea11c1dcbc467dbd68284c3`. The earlier a8da/13430 screen remains separate historical evidence. Its private string-valued helper selector was replaced by a boolean at the same owner after its Block Brotli closure exceeded the unchanged cap by 36 bytes. Current source passes the unchanged payload gates; no budget changed.

Node 24.19.0, Bun 1.4.2. Seven paired fresh-process rounds measure eleven unique-source misses, separately for SVG and fully JSON-consumed SVG-plus-receipt, cache off/on. Three same-package A/A rounds use the identical protocol. Source variants and separate memory inputs are built before timing, never primed, and compared with corresponding baseline oracles outside clocks. All 112 comparison cost workers (56 baseline and 56 candidate) and 48 A/A cost workers complete; all 96 corresponding candidate oracle variants match. The complete receipt includes an independently checked output binding.

Ratios below are medians of paired candidate/baseline observations; lower is better. Allocation is a separate GC-boundary JavaScript estimate, not native/WASM/process memory. Byte differences are median paired differences.

| New-source arm | Cache off time / allocation | Cache on time / allocation | Cache-on bytes saved per observed call |
| --- | ---: | ---: | ---: |
| Sequence20 SVG | 0.9842 / 1.0002 | 0.8948 / 0.9206 | 517,504 |
| Sequence300 SVG | 1.0392 / 0.9999 | 0.8732 / 0.9168 | 5,133,320 |
| Sequence20 full receipt | 0.8475 / 0.9990 | 0.9422 / 0.9245 | 513,344 |
| Sequence300 full receipt | 1.0785 / 1.0015 | 0.8359 / 0.9191 | 5,070,368 |

Every cache-on arm allocates less in all seven rounds. The approximately 8% primary gains exceed the matching A/A allocation displacement; cache-off allocation stays near parity. Both Sequence300 stages warm exactly twenty unique sources in every candidate and A/A round, so their allocation effect does not depend on unequal warm cache populations. Comment-only variants preserve labels and topology: these percentages do not describe arbitrary edits or warm hits.

Timing is less certain. Cache-on Sequence300 SVG has a 0.8732 median, while the matching A/A median is 0.8509. That cannot establish a general speedup. The uncached Sequence300 receipt is adverse at 1.0785, slower in six of seven pairs (+5.493 ms median paired difference). One preregistered confirmation retained the same clocks, packages, warmup and source variants, measuring both uncached Sequence300 arms in nine pairs plus three fresh A/A pairs. SVG was 0.9582, faster in six of nine; receipt was 1.0377, slower in six of nine. Allocation was 0.9988 and 1.0004. Neither met the predeclared persistent-adverse trigger (at least seven slower pairs, median over 1.05 and displacement beyond both matching A/A summaries). Controls remained noisy. That component screen supported proceeding to full qualification; the receipt risk remains, and the follow-up does not prove parity. The two studies are not averaged.

The cache-on output-held retained checkpoints, comparing stage medians, fell by approximately 1.3 MB for Sequence20 and 2.5–3.1 MB for Sequence300. They include live caches and output and do not establish post-release heap or process-memory savings.

## Full qualification

The twelve-phase serial queue closed on 23 October at 07:59 UTC. It measures the actual cd735107/61c513 candidate against #467 using the frozen d7 protocol and current 566-input fixture inventory, with three Architecture additions explicitly ported. Both release policies and all four payload phases pass. Peer and browser validation pass independently reviewed schema corrections described below. All twelve phases qualify after those corrections; the original failed queue remains preserved. One predeclared cached-corpus confirmation is also complete.

An earlier queue correctly failed its acquisition audit because fresh npm resolved different ELK/YAML versions; those measurements are not matched attribution. The replacement uses narrowly scoped temporary install-root overrides, verifies actual versions and archive integrity before timing, and preserves the original failed attempt. A supplemental audit finds matching versions and recorded archive integrities for all twelve host-active runtime packages in the ten captured release/peer locks, including the five transitive packages beyond the seven directly pinned dependencies. This does not recover deleted fresh installation files or retroactively change the original seven-package enforcement policy. No published manifest, dependency requirement or benchmark gate changed.

Each full release attempts 566 inputs in 30 groups, with three paired rounds and five repetitions: 431 shared successful renders and 135 refusals. All seventeen gates pass under both policies. All 431 successful SVG and ASCII fingerprints remain exact, with no coverage changes. The official corpus estimator covers 402 shared successes from 537 corpus inputs; 29 scaling/workflow inputs remain separate.

| Candidate / #467 | Cache off | Cache on |
| --- | ---: | ---: |
| Official Node corpus time | 1.0135 | **1.1055** |
| Separate matched-corpus JS allocation | 1.0000 | 0.9975 |
| Separate matched-corpus peak worker RSS | 0.9969 | 1.0007 |
| Browser matched-occurrence time | 1.0920 | 0.9986 |
| Browser sampled JS allocation per call | 0.9995 | 0.9955 |

The cached Node result is adverse despite passing the existing 1.25 gate. Its paired ratios are 0.9711, 1.1055 and 1.1234; 22 of 23 family medians are slower. Excluding Sequence still gives 1.1075, versus 1.0802 for Sequence. That breadth does not prove host drift: factoring the common retention helper also changes non-Sequence miss code. In the median round, Sequence contributes only about 14.2 ms of the 259.8 ms increase. Cached does not mean every corpus call hits the 128-entry positioned cache.

One predeclared confirmation, run after the full queue closed, retains all 537 corpus inputs and refusal prepasses, five repetitions and the original corpus-worker clocks. It excludes the 29 separate scaling/workflow groups, so the intervening process schedule differs from the full run. Three identical-path A/A pairs precede seven candidate pairs. All source, runtime, input and output checks pass, along with all sixteen applicable original gates; the original large-case gate is N/A. Candidate time is 0.9317, slower in two of seven pairs. The A/A median is 1.0086, but its median absolute displacement is 0.0856. The declared persistent-adverse trigger is not met; timing remains unresolved under noisy controls, with no parity or speedup claim and no averaging with the original 1.1055 result. The confirmation's separate memory pair has approximately 0.9985 allocation, 1.0159 peak JS heap and 1.0435 peak RSS; post-pass retained heap is 193 KB higher. Keep the narrow allocation improvement with those limits visible rather than claim lower overall memory.

Adverse scaling observations also remain: uncached Class80 is 1.3143, Tree300 1.1399 and XYChart 1.0855; cached Gantt150 is 1.1998, Mindmap200 1.1788 and Architecture40 1.1368. Full raw case/round results are preserved. A focused Sequence allocation benefit does not erase these observations or establish a universal speed improvement.

The browser attempts all 1,095 page occurrences with four engines and three rounds. Candidate and baseline each accept 823, Pele 1,063 and Mermaid 1,061. Its memory cohort contains 411 distinct jointly successful sources / 821 occurrences, with twelve fresh engine/round runs. Cached candidate released-minus-loaded heap is approximately 216–239 KB lower in all three paired browser rounds. These are forced-GC JS checkpoints, not process or native memory. Browser timing varies widely: uncached paired ratios are 0.5873, 1.0920 and 1.3362; cached ratios are 1.1080, 0.9986 and 0.9741. Browser timing receipts contain no output hashes; separate release fingerprints establish byte parity.

The completed peer scorecard puts Agentic seventh of eight distinct engines on the fixed seven-case shared SVG cohort under both cache policies. Merman's asynchronous API remains a separate diagnostic rather than a second engine in that ranking; mermaid-rs is the eighth engine and succeeds on all seven shared cases. Using each case's median of same-round time ratios, then an equal-case geometric mean, Agentic's time is 4.5760× Beautiful / 82.4305× Pele uncached, and 1.6831× / 28.4731× cached. With consumed SVG, the four-engine cohort gives 4.6547× / 77.6468× uncached and 1.5747× / 29.5507× cached. Agentic succeeds on all fourteen requested SVG workloads; Beautiful supports seven, Zombie eight, Pele and Ondine fourteen. Unsupported cases and label failures never enter the speed denominator. These results still show a large competitive gap; earlier campaign ratios are not paired observations of this patch.

Payload changes are small and mixed. The focused SVG consumer grows by 8 gzip bytes to 958,758; root grows by 81 and the shipped IIFE by 94. The entire lazy runtime shrinks by 5 gzip bytes while growing by 122 raw bytes. Initial lazy raw/gzip sizes and four requests stay unchanged; Brotli grows by 5 bytes. All unchanged canonical family caps pass. Beautiful's 470,020-byte and Pele's 248,064-byte gzip consumers have different API/family scopes; the production bundle goal remains unmet.

The queue's six reported failures are preserved. Four came from applying a worker `attempt` field check to aggregate process records, which intentionally lack that field. The reviewed correction binds every original worker receipt, population, parent process exit, package and lock. Individual peer worker exit codes are not published by this harness. Two browser checks incorrectly read `memory.inputs[].source`; the maintained report intentionally retains representative IDs and occurrence IDs instead. The reviewed browser correction resolves those IDs through the frozen corpus and validates the complete joint source cohort and all twelve allocation profiles, checkpoints, actual acquisition witnesses and captured locks. Neither correction changes measurements, thresholds, inputs or estimators. The final analyzer also restores the established eight distinct-engine ranking after its predecessor accidentally counted Merman async as a second engine and omitted mermaid-rs. Earlier analyses remain preserved. Release, consumed-output, browser and payload sections are exactly unchanged; every original peer case/estimate remains exact, with the corrected ranking and separately retained asynchronous diagnostic.

## Rejected native traversal

The first direct-recorder implementation eagerly copied ancestry per group, introducing quadratic reference copying for a deep chain. Its corrected version snapshots only visits that emit leaves. Output/owner checks pass, but the completed focused cost screen does not justify replacing the generator implementation: the largest Sequence is 1.0830× uncached and 1.1198× cached, while allocation falls less than 0.5%. Uncached Sankey is 1.1153× and cached Sequence300 receipt 1.0458×. Other cells improve; most allocation changes remain about 0–1%. This is a risk/benefit rejection under noisy timing, not proof of universal slowdown.

The experiment and dependent internal-adapter cleanup remain on their separate branch. They are absent from #468 and create no new native-drawing integration dependency with #433. Failed setup/oracle attempts and original measurements are preserved under their original identities rather than relabeled as successful final results.

## Unselected cache-lifetime prototype

A separate prototype, `ab87212a0a8b94e02100e59f49247ff8f9b68260`, adds shared, isolated and disabled cache policies plus clear and immutable estimated-residency statistics to the existing renderer factory. One router selects the persistent shared or renderer-owned scope for an invocation; scopes own the five existing stores, and WeightedLru remains the only eviction/accounting authority. Reentry, exceptions, pending lazy renders and clear-during-callback generation invalidation have owner tests. Public entrypoints restore shared scope, including backend conformance registration. “Shared” means the same loaded cache module, not arbitrary separately built bundles or workers.

Its 198 affected tests / 1,412 assertions, both typechecks, lint and canonical build pass. A meaningful baseline test fails because the cache API is absent. It nevertheless fails unchanged payload caps: Quadrant Brotli is 176,022 versus 176,000 bytes; Block gzip is 242,083 versus 242,000 and Brotli 213,294 versus 213,000. The new router and scalar-generation import also add 1,364 raw bytes to the initial closure. Moving that import alone would not remove family closure growth. No cost study ran, so no throughput or memory benefit is claimed. Preserve it as blocked work rather than include it in #468 or raise caps to admit it.

## Remaining work

A fresh built-in/external backend dependency audit found that default-backend enrollment still retains executable conformance and its public render method must admit arbitrary Scene input. Extracting geometry helpers would remove an accidental source dependency but not the actual current SVG/lazy closure. It is not selected as a bundle optimization; eliminating validation is not an acceptable shortcut.

Broader immutable geometry/proof lifetimes, graph workspaces, typed SVG emission, incremental topology and a production SVG-only distribution remain open. Claimed SVG postprocessing/calibrated gates stay with #433; native solver qualification stays with #449. Sequence transfer does not close the performance gap with Beautiful or Pele, and isolated gains must not be added to those PRs' reported ratios.

## Evidence and landing

Measured renderer source is cd735107, based on #467c9; its archive and baseline identities are recorded above. Both core/repository typechecks, canonical scoped lint, canonical build and unchanged family/lazy payload gates pass. The original affected ownership/Sequence/prepared-text/backend/lazy set passes 252 tests; the exact cd head's [CI39912603044](https://github.com/adewale/agentic-mermaid/actions/runs/39912603044) and [Ruff39912603016](https://github.com/adewale/agentic-mermaid/actions/runs/39912603016) pass. Its new ownership guards also pass unchanged #467 production. The exact-head `no-red-green` classification records this performance-refactor contract honestly. Source/output behavior does not change, so byte fingerprints provide the relevant before/after evidence.

The full queue ran serially with Node 24.19.0, Bun 1.4.2 and Chromium 154.0.8037.57. Release fixture harness a14b847e contains the current 566 inventory on the frozen d7 protocol; peer/browser/payload harness remains d7c929d8. This is not relabeled as a later maintained-runner comparison. Runtime enforcement checks seven primary versions before workers; the separately scoped full-closure audit is described above. The browser report's Node 26.3.0 field is Bun's compatibility field, separate from actual spawned Node and Chromium identities.

Raw evidence remains in the shared workspace, outside version control:

- `/workspace/am-continuation/final-qualification-v3`: all 12 original reports, samples, source/artifact/runtime/fixture pins, captured locks and unchanged original failures.
- `/workspace/am-continuation/final-analysis-reviewed-v4.{json,md}`: complete corrected scorecard, all adverse rows, output parity, browser heap checkpoints and payload deltas.
- `/workspace/am-continuation/peer-schema-supplement-v1` and `browser-schema-supplement-v1`: independently reviewed closed-report validation, original queue snapshots and hashed receipts.
- `/workspace/am-continuation/sequence-transfer-cost-v2` and `sequence-transfer-cost-aa-v2`: current component screens; the separate uncached and cached-corpus confirmation directories retain their own controls and raw observations.
- `/workspace/am-continuation/analyzer-v4-invariant-check.json`: unchanged measurement sections and common peer estimates, alongside the independently reproduced distinct-engine ranking.

The exact full invocation was:

```sh
node /workspace/am-continuation/final-followup-queue-v3.mjs \
  --candidate-stage /workspace/am-continuation/sequence-transfer-v2 \
  --expected-source-sha cd735107876616bff09b53d4c38bdfae1bec7984 \
  --expected-archive-sha256 61c513df1ad91724418ccaf79a4d4648017cee6548ed2c5403504e5bfc117744 \
  --build-receipt /workspace/am-continuation/sequence-transfer-final-build-v2-receipt.json \
  --out /workspace/am-continuation/final-qualification-v3
```

Those external runners refuse existing outputs and pin their inputs; a reproduction needs a new output directory and the recorded artifacts. Source ownership can be checked independently with `bun test --timeout 30000 src/__tests__/position-cache-ownership.test.ts`. Rebuilding creates a new package identity even when source is unchanged.

Current landing preference is #467, then #468, then #433 after integration qualification. #365 can land independently after rebasing onto #467 and preserving both hardened collection iteration and its execution-result changes. Keep #449 last and draft while uncached/native qualification failures remain. Its green source CI does not erase those failed measurements. #433 already has an isolated #467/#468 integration branch with passing source CI; its own performance qualification remains separate. Ratios from independent PRs cannot be added. Fresh main remains `87c9c317`, so no new upstream production change has appeared since #467's rebase.

The next separate prototype shares invocation-local directed-reachability scratch between source ordering and route classification. It preserves caller admission/order and leaves worst-case search complexity unchanged; it does not complete an end-to-end graph workspace or incremental topological ordering. Its independent 246-case oracle, 415 affected owner tests, both typechecks and scoped lint pass; eight cross-runtime tests explicitly skip because the source-only worktree has no built dist. The added guards also pass baseline production. Cost selection remains separate from this frozen #468 artifact.
