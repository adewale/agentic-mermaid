# Matched built-public performance plan — prepared, not executed

Control: frozen c18f607364ca1d85dd91a669c8ac33a2c7173a23 package at `/tmp/issue619-followup-20261121/package-c18f6073/package`.
Candidate: 32b025bff14e3020fd709a08d84f8543f57cb0cd, built package at `/workspace/elk-layered-port` after root's build completes. The earlier f491 control is deliberately not reused.

The existing `/tmp/issue619-followup-20261121/benchmark-final/receipt-worker.mjs` is called unchanged. The controller is a minimal adaptation of that directory's `run-three.cjs`; summarization and byte controls adapt its existing scripts. This is exploratory Node evidence, not full Trident scores or a browser result.

Seven cases (all exact retained source bytes):

- Four-node winning duplicate plus reverse return, balanced; retained qualification kept/control-4.
- Existing LCG-v1 seed135, balanced, paint-passed witness; kept/control-54.
- Existing LCG-v1 seed139, balanced, **unverified paint retained**; kept/control-62.
- Titled cyclic19, balanced failed proposal, plus default cost control; exact historical benchmark-final/cases.json source.
- Dense24, balanced, plus default cost control; exact benchmark-final/cases.json source.

Generated inputs come from retained snapshots produced by the existing `generatedFlowchartSamples` generator. No alternate generator is substituted. Each case has one actual node-label edit; cyclic19/dense24 retain their previous benchmark edits. Actual source/edit hashes and full render options are in cases.json. The controller preserves quality:'balanced' while merging explicit backend/fallback; the older launcher's overwrite of graphLayout would have silently dropped it.

84 fresh processes: seven cases × two ELK cache settings × three replicas × two arms. One child process runs at a time. Arm order alternates by case, replica and cache; all replicas remain paired by case/cache/replica. Each child measures module import separately, first render, seven warm original-source renders, first edited-source render and three edited-source repeats (12 consumed products/process, 1,008 total). Every API clock includes actual SVG consumption plus JSON.stringify of the **entire public product**, materializing the full receipt, and UTF-8 byte measurement. Compression, evidence writes, second retained-receipt encoding and explicit GC are outside the render clocks. No profilers or timed observers are enabled.

Cache0/cache1 retain the existing protocol's meaning: `AGENTIC_MERMAID_ELK_CACHE=0/1`. Source `positioning.ts` also gates its upper positioned cache on this flag. Cache0 therefore disables both ELK-result and positioned-result reuse, so its warm7 calls perform equivalent full public work with imported code/text caches warm. Cache1 permits normal upper positioned/drawing reuse and measures the cached product lifecycle. Import/cold/first-edit costs remain separate. The initial prepared-plan claim that positioned caches stayed enabled under cache0 was incorrect and was corrected by static source inspection before measurement.

Raw wall/CPU and before/after RSS/heap/heapTotal/external/array-buffer fields plus process peak RSS remain available. Summary retains the existing median-of-three per-process mean aggregation for warm7 and edited-repeat3, and adds the median of three within-replica paired deltas/ratios. Lifecycle/render failures and every native paint status stay in the denominator; partial successful pairs report `completePairs/expectedPairs` rather than implying three successes. RSS includes the harness, imported modules, retained warmup and compression history; it is not package-only memory.

Postmeasurement byte controls compare complete SVG and entire receipt on each paired phase. Both default cases require exact candidate-vs-c18 SVG bytes, including the edited source. Within each arm, repeat1–7 must equal warmup SVG and edit2–4 must equal edit1 SVG. Complete receipt bytes are always compared exactly and every mismatch flag and JSON difference path retained. Under cache1, cold→warm or edit-first→edit-repeat receipt mismatches confined exactly to `layoutOptimization.primaryProducerCalls`, `additionalProducerCalls`, `alternativesAttempted`, and `selected` can reflect the documented per-execution accounting (zero new producers/attempts and selected[] on a positioned-cache hit). These are explicitly counted as operational receipt differences, not erased before comparison. Any other receipt difference is separately counted for review. Cache0 has no exemption for these differences. Changes in balanced receipt/geometry are reported, not silently treated as failures or wins. LCG139's unverified paint must remain visible in the final performance report.

Small-winner aesthetic vocabulary: public total `metrics.routeGeometry.bends` is **8→0**; certified preference `totalBends` is **4→0** because its rubric exempts justified bundle turns. Keep them separate. LCG135 public total bends66→63; LCG139106→104.

No performance/render/build execution has occurred while preparing this plan. Wait for root's exclusive CPU grant and exact final build/head binding before running:

```sh
export PATH=/workspace/pr449-runtime-recovery/node-v24.19.0-linux-x64/bin:/workspace/elk-layered-tools/bun-1.4.4/package/bin:$PATH
node /workspace/elk-layered-tools/issue619-sol-experiments-20261121/benchmark/run-three.cjs \
  /workspace/elk-layered-tools/issue619-sol-experiments-20261121/benchmark/arms.json \
  /workspace/elk-layered-tools/issue619-sol-experiments-20261121/benchmark/results-32b025bf
python3 /workspace/elk-layered-tools/issue619-sol-experiments-20261121/benchmark/summarize.py \
  /workspace/elk-layered-tools/issue619-sol-experiments-20261121/benchmark/results-32b025bf
python3 /workspace/elk-layered-tools/issue619-sol-experiments-20261121/benchmark/byte-controls.py \
  /workspace/elk-layered-tools/issue619-sol-experiments-20261121/benchmark/results-32b025bf
```

The launcher requires pinned Node v24.19.0, a fresh output directory, the exact bound candidate HEAD and no inherited layout-feature ablation. It records control/candidate commits, executable, controller/worker/case hashes, and built public entry hashes. Root must rebind candidate metadata after a new commit/build. Existing artifacts are preserved; no full historical Trident replay, profiles or retries are scheduled.
