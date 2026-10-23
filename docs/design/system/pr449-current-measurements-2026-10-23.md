# PR449: current measurements after the main861 rebase

The native engine has useful wins against ELK, but does not beat it on every aspect. ELK remains the default and the six native families remain opt-in. This note supplements the [sealed frontier report](pr449-frontier-2026-10-23.md); it preserves that report's dated evidence rather than relabelling historical measurements as current results.

The [structured companion](pr449-current-measurements-2026-10-23.json) binds this note and the [selected evidence packet](pr449-current-measurements-2026-10-23-evidence.json.gz). The packet is 13.8 MB compressed and retains complete canonical numerical records for both hosted canaries, the failed dirty-bilayer trial and all 126 constructor workers. [Inspection instructions](pr449-current-measurements-2026-10-23-evidence.md) explain its coverage and explicit omissions.

## Completed hosted canary

[CI39952102787](https://github.com/adewale/agentic-mermaid/actions/runs/39952102787) measures publication head `1276cd9b1af4435e1557c344a0c8050412e5d636`. That head differs from runtime `968b85564ec0745613abed1b114e5f729d67ca84` only in five documentation files. All three unit shards and the other required checks pass, but the fresh standalone editor exceeds its unchanged raw payload limit: 4,102,617 bytes against 4,100,000. The generated-layout advisory also retains geometry losses. The standalone failure is repaired by the later qualified build-only change below. [New-head CI39957320431](https://github.com/adewale/agentic-mermaid/actions/runs/39957320431) and Ruff pass, including all 95 canonical browser contracts and all three unit shards. Its raw advisory backend step nevertheless fails uncached cyclic15. The PR stays draft.

The backend canary completes all native, fallback and ELK A/A comparisons in both cache policies. Ratios below one favor native.

The two hosted replicas must be read separately. The following first table is the earlier 1276 observation; the later ec72 result is retained immediately afterward. No favorable replica is selected as the sole current estimate.

| Direct native / ELK measurement | Cache off | Normal cache | Interpretation |
| --- | ---: | ---: | --- |
| Seven official examples, wall time | 0.542213 | 0.980232 | Named seven-input population only. |
| Twenty large/workflow inputs, wall time | 0.873708 | 0.995815 | Aggregation retains every enrolled input. |
| Complete mixed 27-input pass, wall time | 0.853385 | 1.002017 | Uncached native is 14.7% faster; normal is effectively tied. |
| Nominal faster / slower individual inputs | 22 / 5 | 20 / 7 | Small differences require comparison with A/A variation. |
| Seven-example allocation | 0.735493 | 0.998416 | One fresh corpus memory group per arm. |
| Seven-example peak heap estimate | 0.602652 | 0.602674 | GC-boundary estimate, not exact allocation traffic. |
| Seven-example worker peak RSS | 0.797331 | 0.796950 | Includes import, warmup and measurement. |

Five of the six uncached cyclic tails remain slower: cyclic11 1.1931×, cyclic15 1.4501×, cyclic19 1.1960×, cyclic13 1.3838× and cyclic18-cuts 1.4586×. Cyclic9 is faster at 0.8110×. All six allocate more than ELK in their separate single-case observations, ranging from 1.117× to 1.588×. A passing stock 1.5× large-case limit allows these losses.

Every policy retains 12 actual timing workers, 84 memory workers, 324 case-round observations and 8,100 timing samples. Both finish inside their shared 480-second limit: 306.031 seconds uncached and 172.131 seconds normal. Whole27 ELK A/A medians are 0.993520 and 1.007652. Every case median satisfies the prospectively declared reciprocal 1.1 bound; two uncached and one normal individual case-round outliers remain. There is no stronger retrospective A/A gate.

Fallback-enabled native selects native on all 27 eligible cases, so this cohort does not force an ELK fallback. Every backend retains 18 passed and nine unverified paint certificates per policy, with no failures. Unverified evidence does not become a proof when timing gates pass.

Whole-pass time uses actual same-repetition sums, then within-round medians and the median of three paired round ratios. Memory uses a seven-example corpus group plus twenty separate single-case groups; it contains no whole27 memory process or three memory rounds. These groups must not be summed into a whole27 allocation or RSS claim.

Actual timing workers report Node24.21.0; coordinator Node26.3.0 is Bun1.4.2 compatibility metadata. The source launcher sets scene assertions to literal `0`, not unset; that fact is source-inferred because the raw environment is not logged. Timed calls include full SVG UTF8 encoding and receipt JSON serialization, with receipt UTF8 materialization outside this older boundary. This is not the new consumed-product `@2` protocol. The hosted ZIP lacks full compiled/dependency/binary digests, so its artifact binding is weaker than the isolated frozen local experiments. No causal repair of historical failures is inferred.

The later **ec72 replica fails uncached qualification**, despite its green job and overall CI conclusion: strict native cyclic15 is **1.520183× ELK**, and fallback-enabled native is **1.505952×**. The old passing replica remains valid on its named run. Required-check/job status and raw qualification have distinct policies.

| Later ec72 direct wall-time measurement | Cache off | Normal cache |
| --- | ---: | ---: |
| Seven official examples | 0.567293 | 1.010374 |
| Complete mixed 27-input pass | 0.868863 | 1.001458 |
| Nominal faster / slower cases | 22 / 5 | 14 / 13 |

Every actual worker completes again: 96 physical workers per policy, all three rounds and 25 timing repetitions, within 415.069/230.927 seconds of the unchanged 480-second limits. Retained output, receipt and quality fingerprints match the earlier replica across both policies and every comparison. The code change between these heads affects only the standalone build projection. The changing timing ratios therefore establish neither a causal gain nor a causal regression from that fix. Uncached native has useful aggregate gains but still loses cyclic cases; cached results remain effectively tied. The new primitive optimization experiments must qualify independently.

## CPU and heap attribution

All 66 fresh diagnostic workers complete within their unchanged 600-second campaign limit, taking 205.835 seconds. Each worker preserves the complete SVG and receipt values. CPU and collected-object heap sampling use separate processes, actual Node24.19, cache off and scene assertions unset.

Inspector sampled allocation is higher than ELK on all six cyclic inputs: 1.440×, 1.541×, 1.035×, 1.181×, 1.523× and 1.292× for 11, 15, 19, 9, 13 and 18-cuts respectively. Two small DAG controls are also worse (1.320×/1.350×), while two large controls are better (0.694×/0.689×). These are diagnostic estimates across four calls, not qualifying memory measurements.

On cyclic18-cuts, `collectLaneBlockers` accounts for 11.24%/10.59% native/native-A/A exclusive CPU samples, predominantly under `tryZRoute`; ELK is 3.67%. Pair crossings use 5.47%/7.64% CPU and 11.78%/11.51% sampled heap. General-crossing samples also identify cyclic candidate scoring and shortening as substantial owners. Inclusive figures overlap and cannot be summed. Inspector and GC contribute material overhead; no overhead or A/A correction is subtracted.

An unchanged-source counter campaign completes 1,200 exact public outcomes. Bounded candidate counting passes its prospective materiality gate on all six cyclic inputs: it could omit 24,431 pair queries, saving 18.32–30.06% of owner pair calls and 16.24–32.60% of inner visits. Unused crossing counts during occlusion repair have no activation and fail; a separately tested prepared-label capacity filter avoids only 95 lane scans and fails. These two mechanisms are rejected without pooling them with the successful one.

The abstract of Hellerstein and Stonebraker's 1993 [Predicate migration](https://doi.org/10.1145/170035.170078) motivates measuring the cost and selectivity of predicates, especially those involving user functions. The proposed label filter therefore counts its new peer-safety walk as real work and preserves callback evaluation. It fails the resulting net-work gate. The full paper was not available in this research pass; the graph-specific result comes from our counters.

Only bounded counting advances to a prototype. The strict cutoff occurs after a complete pair count exceeds the unchanged prior count; all accepted/equal counts, candidate ordering, budgets and final complete metrics/proofs must remain exact. Counter savings do not establish speed or allocation improvements. Public callback checks retain ELK's actual recovery/retry behavior after measurement exceptions; an initial observer protocol incorrectly demanded immediate termination and is preserved separately from its baseline-fidelity-only reassessment. Prior failed index, proof-reuse, record/ray, phase and zero-stop variants remain rejected.

## Rejected experiments and qualified delivery repair

The dirty-bilayer candidate `d269d99e` preserves public outputs and reduces scoring operations, but **fails its new 30-slot consumed SVG/receipt timing experiment and is rejected**. All 30 workers complete, all artifact/proof bindings pass and both policies finish within their unchanged deadlines (337.576/368.007 seconds). All 4,500 timed calls and 2,250 prewarm calls are retained. Its numerical targets, populations, A/A controls and deadlines remain unchanged. A preflight failure caused by metadata inside the baseline artifact is retained; a separate exact snapshot and fresh 1,800 byte-identical payload comparisons establish the replacement binding without changing runtime bytes or relaxing checks.

| Candidate / unchanged baseline observed wall time | OFF | NORMAL |
| --- | ---: | ---: |
| Whole75 | 1.064157 | 0.981435 |
| H27 | 1.210504 | 1.183625 |
| DAG48 | 1.026924 | 0.949842 |
| Inputs exceeding the 1.05 nonregression bound | 36 / 75 | 44 / 75 |

Zero of six required OFF tails reaches the declared improvement with both local A/A pairs healthy. Several aggregate A/A controls also fail: OFF whole75 baseline/ELK A/A are 1.034882/1.049472, and NORMAL ELK A/A is 1.174702. These observations do not establish a causal speedup or slowdown. The mandatory wrapper rejects the candidate; favorable NORMAL whole/DAG ratios cannot override the failed H27, per-input, A/A and tail gates. No memory, delivery or broad-quality promotion run follows this failed timing result. Two measured calls per input per round and three fresh rounds provide limited precision; the experiment establishes no p95 or throughput guarantee.

The private-worker metadata projection is qualified and published at `ec72a06dcf57d1e429fab9672a9acbf794e22d9f`. It saves **10,467 raw bytes and 3,641 gzip bytes**, reaching **4,092,150 raw / 1,227,748 gzip bytes**, with 7,850 raw bytes of reserve under the unchanged limits. It removes only six pure editor-description literals from the two owned seed tables in the private standalone worker. The page already embeds the complete canonical catalog. Public Node, IIFE and lazy APIs, all families, executable witnesses, schemas, errors, headers and terminal behavior remain.

Qualification passes 284 complete built Node24 SVG/receipt/verification/error pairs, all 23 page examples and three full catalog comparisons, 20 actual standalone Chromium contracts with 198 assertions, both type checks, lint and standard Node/DTS/IIFE/lazy builds. Ten new/existing projection tests pass with 240 assertions; the new six tests independently pass on the integration worktree without the existing esbuild worker workaround. Initial local service/sandbox failures are retained in the evidence. All 23 complete lazy byte/request/closure records exactly match the accepted968 control. The qualified isolated commit `ff6980212ef33f1d5f71a72a1e5820020ac2b38c` and integration commit `ec72a06d` have identical complete Git tree `99ae61f2e5756de85e7d42ae5e57a16e3b290e93`. The earlier eight-byte accessor experiment failed to repair the cap and is retained separately. No latency or memory benefit is inferred from this build-time subtraction.

The constructor registry experiment completes all 126 fresh workers but **fails its declared CPU target in both policies**. Restricting ELK registration to layered algorithms reduces registration counts, but does not establish the required startup benefit.

| Constructor candidate / baseline | OFF | NORMAL |
| --- | ---: | ---: |
| Combined import + first-render CPU | 0.994421864 | 0.982726441 |
| Whole A/A | 1.067520713 | 1.002195707 |
| Required CPU ratio | ≤0.98 | ≤0.98 |

All 14 per-input guards, 485 independent bindings, public payload comparisons and deadlines pass; the aggregate targets still fail. OFF A/A also exceeds its reciprocal 1.05 limit. The measured first-render window includes full SVG and receipt UTF8 consumption; bootstrap is outside the CPU windows. Separate import/render and wall-time decompositions are descriptive and cannot replace the combined CPU target. This experiment uses historical sources `e039bc9a` → `3f8c2df5`, not current968/ec72. It establishes no current runtime, warm throughput or memory improvement. The candidate's earlier 574,173-byte Architecture payload also still exceeds 574,000. No retry or promotion follows.

The bounded-crossing prototype `436ab65d` passes 184 owning tests with 28,420 assertions, both type checks and the complete canonical build. Independent mathematical checks cover 5,565 combinations and kill three incorrect cutoff mutants. Its first strict payload check nevertheless reaches **574,045 Architecture Brotli bytes**, 45 over the unchanged cap and 70 above baseline. That standalone candidate is held before public candidate proof or cost measurement. A separately declared relocation of private Architecture legality code must qualify independently before any combined candidate can receive a new source/proof declaration. The over-cap result remains retained.

The isolated legality relocation `b322f88b` subsequently **fails its declared 128-byte saving target**: default Architecture saves only 14 Brotli bytes (573,975 → 573,961), while the native Architecture closure grows by 162 bytes and initial delivery grows by one. All existing lazy caps and focused tests pass; no full public/browser qualification or combined candidate follows the target failure. Its complete assessment and prospective declaration are retained as supplemental originals in the structured companion because this result postdates the sealed packet. One separately declared lean bounded-counting representation is pending; it removes the unnecessary runtime default and must pass every unchanged limit before public proof or cost.

Contiguous same-cut rank-plan sharing (`539354dd`, C2-R) also fails its prospective zero-loss quality rule. The completed 1,209-input OFF scan has 1,197 exact outputs and 12 changed generated cases. Ten inputs lose 36 quality guards, including four crossing regressions, twelve route-invariant losses and two new paint-occlusion issues. All 249 saved source cases remain exact. Adversarial generated-cyclic47 has **20 → 21 crossings**, despite improving bends 90 → 88 and route length 17,505 → 16,045. Its output exactly matches the earlier rejected weighted-ranking candidate on SVG, receipts and positioned layout; this does not prove an identical internal cause. All ELK outcomes, including its seven retained failures, remain exact. Completed edit checks retain 36 exact undos and no edit guard losses; those successes do not offset the drawing regressions. The complete final assessment postdates the packet and is retained in the structured companion. NORMAL broad/control, future-population and cost roles remain explicitly unrun after rejection.

Further topology sharing that preserves ordering diversity, family scope choices, edit stability and fresh label-space quality remain open. The research frontier is not exhausted.

The 13:45 UTC refresh checks every page of all ten open issue and six open PR comment feeds: all 45 comments are unchanged from 12:19 (zero added, edited or deleted). PR433's body reports new ordinary-release measurements but its final calibrated/source CI remains pending; its environment projection is explicitly separate. PR469 remains blocked. These are useful related work, not merged dependencies or qualified improvements to PR449.
