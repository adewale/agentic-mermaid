# PR449: profiling strategy and subtraction experiments

This is a static source review and an experiment design, not a new performance result. No benchmarks, profiles, builds or tests were executed for this note. Source inspected at PR449 head `9ffd5369cbc9676dbeb07c06abf3fc33c76bd5b9`; renderer remains `agentic-layered@22`. Preserve the exact artifact and runtime identities in every resulting report.

## What we should investigate first

| Priority | Question and evidence | Experiment that can reject the hypothesis | Potential action, conditional on evidence |
| --- | --- | --- | --- |
| P0 | Is the warm SVG gap mainly shared rendering work? Sequence/C4 have the same graph-independent implementation under both backend selections; existing peer results show large peer gaps even there. | Profile actual packaged SVG on cached flow5, seq20 and er40, native/ELK separately. Compare absolute CPU and allocation per consumed call, caller stacks and call counts. Sequence is the unchanged control. | Optimize demonstrated common work before extending the solver to additional families. |
| P0 | Does cyclic search spend its extra allocation on rejected candidates? Existing uncached qualification fails cyclic15/18-cuts latency and several cyclic allocation cases. | Profiles on cyclic11, cyclic15 and 18-cuts plus an acyclic size-matched control; count proposed, deduplicated, placed, scored, accepted and finally selected candidates, graph copies and scoring-pair work. | Remove redundant candidate construction, retain scratch representations, or reduce search only where independent quality tests show equivalent results. |
| P0 | Does a geometry cache hit remain expensive because we clone and recheck the result? `position-cache.ts:14–39` clones and walks evidence; `positioning.ts:94–95` projects and assesses after hits. | With `text-spans,indexed-layout` fixed, compare outer position cache enabled/disabled, native geometry cache on/off, and diagnostic clone/projection/assessment spans. Report actual hit counters. | Subtract a cache layer if its keying/cloning costs exceed saved work; alternatively retain immutable internal representations and dependency-complete proof results. |
| P1 | Are paint-entry construction and certification paying for repeated geometry traversal? Native crisp drawing already bypasses full SceneDoc. | Split fragment construction/flattening, native geometry inspection and paint certification, measure entries/ancestor depth/segments/conflict-pair candidates. | Reuse a proven immutable geometry index, fuse compatible traversals, or use compact internal data. Do not remove the certificate contract. |
| P1 | Are SVG string rewrites and rescans the common cost? Most postpasses currently have no named stage. | Count full SVG bytes read/written by each pass and exact-string inspection-cache hits; span each postpass separately. Compare unchanged controls and output size/depth. | Skip proven no-op passes, consolidate compatible scans or reuse inspection of identical bytes. Final output security must still inspect the final transformed document. |
| P1 | Is receipt consumption expensive for receipt users? It is **already lazy**. | Separate plain SVG, first receipt getter, repeat getter on the same artifact, and JSON serialization of an already materialized receipt. | Optimize receipt/digest encoding if significant for this contract; do not claim it explains SVG-only peer measurements. |
| P1 | Is a smaller closure actually faster to first useful render? Bundle bytes alone do not answer import, compile, lazy-load, font and WASM costs. | Fresh-process/realm import-only, import+first render, warm render, browser lazy-family entry, cold/warm HTTP cache; trace compilation and network separately. | Remove unnecessary dependencies or lazy-load only when end-user first-render time improves. |

## Corrections to easy but misleading explanations

* `graphical-render.ts:281–310` returns a lazy receipt getter. Plain `renderMermaidSVG(...).svg` does not call `receiptOf` or compute the final SVG digest. Request resolution, geometry and paint certification still happen. Comparing a full-consumption local call against peer SVG-only calls would answer a different question.
* `scene/positioned.ts:41` and `scene/native-drawing.ts` already implement default crisp built-in drawing without a complete SceneDoc/group tree. Existing Scene-lowering microcases describe an alternative diagnostic path, not default full-render time. Built-in assertions, extensions and alternative backends can select that alternative path.
* Cache “on” does not mean layout dominates. Outer cached-position hits still clone, restore provenance, project the positioned artifact, perform hard assessment, draw, certify paint, rewrite SVG and secure output. The retained drawing/projection WeakMaps reuse work within an individual request/layout identity, not across cloned requests.
* Outer positioned cache is 128 entries/16 MiB. Native measured-geometry cache is 64 entries/8 MiB. A 96-source churn can stay inside the outer cache and mask native eviction. Weighted limits may change this, so cardinality alone is insufficient: observe hit/miss/eviction/retained weight at every layer. Test 32/64/65/96/128/129/256 unique geometries with the outer layer both on and off.
* `createMeasuredLayoutCache` reads its legacy cache switch at module evaluation. Set `AGENTIC_MERMAID_ELK_CACHE` before import in fresh workers/realms. Changing an environment variable after import is not a cache-off experiment.
* Native results already reuse crossing-work arrays and use work budgets. Profiling must establish remaining allocations before proposing those existing optimizations again.

## What existing harnesses can and cannot establish

`eval/benchmark/renderer-profile.ts` is useful precedent: it preserves full CPU profiles and separates packaged timing from unminified source diagnostics. It is presently a Bezel/default-ELK browser comparison, not a native-versus-ELK profiler. It lacks an explicit native backend option. Its diagnostic stage helper clears only the ELK cache; its CPU loop starts sampling a new realm without explicit warmup, runs for 500 ms, and only encodes the final SVG. CPU cases are the slowest shared-success cases, excluding important failures and two relevant families (Requirement and Architecture). Adapt the harness deliberately; do not present its current default profile as evidence about native stages.

`src/layout/backend.ts:134–150` stage observation has an excellent zero-clock-read fast path when disabled. When enabled it emits only completed `{stage, ms}` samples. `layout` contains graph preparation and solver work, so durations overlap. There is no start/end span ID, parent ID or entry depth. A flame chart cannot reliably be reconstructed from these end-only samples. They can be labelled inclusive, but must not be summed to 100% or subtracted indiscriminately. Observer callbacks/allocations may themselves contribute to enclosing scopes.

`eval/benchmark/micro-bench*.ts` supplies source-stage and full-consumption cases; default options select ELK. Add an explicit backend or use a focused private driver. Fresh wrapper cases intentionally defeat retained Scene caches and are not normal request costs. Never sum independent microbenchmark medians into an imagined end-to-end time.

Release and peer harnesses remain the authority for qualified performance claims. Keep profiling output in a diagnostic report. A sampled profile and an instrumented source timer explain a result; they do not replace an uninstrumented paired result or relax the support, paint, fidelity and output-consumption gates.

## Minimal diagnostic trace if postpasses/certification dominate

Use a source-only local patch or diagnostic build with paired entry/exit records: `spanId`, `parentSpanId`, stage, start/end, request ordinal, family, backend, input hash, cache mode and consumption mode. Keep a stack for synchronous nesting, capture events into a bounded preallocated/ring buffer, and export once outside the render loop. Do not log, serialize, compute hashes or emit console events inside each span. Report dropped events. Keep the disabled production path unchanged. Instrumentation event counts and instrumentation-on/off A/A detect perturbation.

Suggested boundaries, with **inclusive** parent spans and explicitly computed **exclusive** child time:

| Boundary | Location | Additional counts |
| --- | --- | --- |
| input preparation/request resolution | `index.ts`, `graphical-render.ts:251` | source bytes, parse/cleanup count; prepared text hits/misses |
| position cache key / lookup / clone / evidence walk / retain | `positioning.ts:63–103`, `experimental/position-cache.ts` | hit/miss, key bytes, traversed objects, copied bytes estimate, retention/eviction |
| graph preparation / native cache key / native cache clone | `layout/agentic-producer-core.ts:53–80,101–140` | nodes, edges, labels, key bytes, hit/miss, retained weight |
| cyclic trial construction / placement / score / selection | `layout/cycle-layout-search.ts` | trial provenance, proposals, duplicate keys, selected trial, crossings/bends/area, actual work-budget counts |
| crossing minimization / rank / routing | `layout/agentic-layered-core.ts` | expanded dummy nodes, bands, attempted/accepted swaps, scored pairs, routing arcs/attempts |
| projection / hard assessment | `positioning.ts:94–95` | projected entities, conflict candidates and violations; cache hit status |
| native mark/fragments / paint flatten / geometry inspection | `scene/native-drawing.ts:94`, `scene/inspection.ts` | marks, paint entries, ancestors, route segments, pair candidates |
| paint certification | `scene/positioned.ts`, `scene/paint-certification.ts` | pair categories, narrow-phase checks, issue count, proof status |
| color inline / viewport expand / text fit / namespace / accessibility / style scope / compact | `graphical-render.ts:174–204` | input/output bytes, changed/no-op flag, full-string scans and copies |
| output security and budgets | `graphical-render.ts:205`, `svg-inspection-cache.ts` | input bytes, lexical scans, cache hit/miss, rejected nodes/attributes; each budget check |
| first receipt / digest / receipt assembly / receipt stringify | `graphical-render.ts:281–310`, caller | SVG bytes escaped/hashed, receipt bytes; first/repeat getter distinction |

If tracing is too perturbing, begin with cheap call counts plus CPU sampling. Add a narrow span only around a demonstrated hotspot, then remeasure without it. Use direct counters in source; replacing exported JS functions by monkey-patching can miss internal lexical calls and change optimization behavior. Report full stack-based CPU attribution as well as self time; aggregation by function name alone merges unrelated minified frames.

For paint, distinguish geometry inspection while building native drawing from certificate evaluation. A single broad `paint-certification` span cannot explain the combined cost because `drawing` has already created inspected paint geometry. Group flattening constructs ancestry arrays and transforms at multiple levels; count those copies before assuming the geometric conflict algorithm is the sole issue.

For SVG, the existing per-request inspection cache keys by exact immutable SVG string, with a 512 KiB retained-character and 512-entry limit. A rewrite produces a different key. Show repeated bytes scanned and cache capacity, not just the number of security calls. Reusing an old inspection after bytes change is unsound. Style scoping, accessibility and namespace changes have real output contracts; absence of a feature can justify a no-op fast path, not wholesale removal.

## Concrete experiment sequence

1. Preserve dist artifact SHA, source SHA, lockfile, Node/Bun/browser/V8/JSC versions, CPU/memory/cgroup limits, startup environment, renderer/backend/flags, raw fixture hash, and consumption checksum. Keep all source/module preparation outside warm loops. No parallel workers or builds during measurements.
2. Uninstrumented A/A first: same backend, same settings, independent fresh workers, randomized/alternating order. Compare complete per-call UTF-8/hash consumption and output identity. Treat rounds/processes as independent units; thousands of calls in one process are not thousands of independent experiments. Report paired ratios and dispersion/intervals, not only aggregate throughput.
3. Actual-dist CPU-only sampled workers, then independent heap-only sampled workers, native/ELK on the same cases. Start with cached flow5/seq20/er40 and uncached cyclic15/18-cuts; add cyclic11 if allocation and latency tell different stories. One backend/case/mode per fresh process; repeat selected profiles to distinguish stable stacks from sampling noise. Do not extend a 1 ms sample interval to submillisecond single renders: repeat calls and retain their count.
4. First receipt materialization/stringification arms only after the plain SVG profile. Include first getter and repeated getter on one retained artifact; repeated getter is a memoized lookup, not a fresh materialization.
5. Add source diagnostic counts/traces to explain packaged hotspots. Label results as source diagnostic. Validate that the diagnostic source produces equivalent SVG, decisions and certificates; optimized package behavior can differ from unminified source.
6. Cache factorial and churn. Hold `text-spans,indexed-layout` fixed. `AGENTIC_MERMAID_EXPERIMENTS=text-spans,indexed-layout` disables only the outer position-cache default; adding `,position-cache` enables it. Pair with `AGENTIC_MERMAID_ELK_CACHE=0/1` before import. Because switch 0 also disables the outer cache in positioning, there is no public environment setting for outer-only cache with inner off: that cell requires a source-only diagnostic hook and explicit labelling. Test measured weight/eviction, edited inputs and full input identity; comments/irrelevant source changes can be normalized, so ensure “distinct” entries really form distinct keys.
7. Only then controlled subtraction prototypes, followed by uninstrumented regression/holdout evaluation and an untouched A/A arm. Do not optimize against the exact profile seeds alone.

Suggested commands for a **new local diagnostic driver**, not existing files or claimed executed work:

```bash
env AGENTIC_MERMAID_ELK_CACHE=1 AGENTIC_MERMAID_EXPERIMENTS=text-spans,indexed-layout,position-cache node /workspace/pr449-exploration/profile-renderer.mjs --artifact /workspace/agentic-mermaid/dist/index.js --case flow5 --backend native --consume svg --mode cpu --out /workspace/pr449-exploration/profiles/flow5-native-cached

env AGENTIC_MERMAID_ELK_CACHE=0 AGENTIC_MERMAID_EXPERIMENTS=text-spans,indexed-layout node /workspace/pr449-exploration/profile-renderer.mjs --artifact /workspace/agentic-mermaid/dist/index.js --case cyclic15 --backend native --consume svg --mode heap --out /workspace/pr449-exploration/profiles/cyclic15-native-uncached
```

These illustrate the required interface; root is implementing its own isolated worker. Resolve the real dist export from `package.json` rather than assuming this illustrative `dist/index.js` exists. `--backend elk`, `--consume receipt`, and an uninstrumented mode must preserve identical fixture and per-call output consumption.

Use Node inspector `Profiler.enable`, `Profiler.setSamplingInterval({interval:1000})`, `Profiler.start/stop` **after** warmup for steady-state CPU attribution. Record time deltas, call counts, full profile tree and file output; profile export is outside the measured region. A second interval (e.g. 500 or 2000 µs) is a perturbation/aliasing check only when the first profile is ambiguous. Whole-process `node --cpu-prof --cpu-prof-interval=1000 driver.mjs` is better suited to **startup** because it includes module load and warmup.

For transient allocations, `HeapProfiler.startSampling({samplingInterval:32768,includeObjectsCollectedByMajorGC:true,includeObjectsCollectedByMinorGC:true})` where the actual protocol supports these options; stop after a fixed completed-call batch or recorded window. Do not silently drop unsupported flags. The default sampling profile reports surviving objects; that is retention, not all allocations. Smaller sampling intervals can distort execution. Sampled bytes/call are estimates, so provide sample counts, repeats and allocation/GC evidence together. Use separate CPU and heap runs.

For GC diagnosis, a separate `node --trace-gc driver.mjs` run can identify collection frequency and pause time. Use the pinned runtime's supported flags; `--trace-gc-nvp` is V8-specific and should be checked against that binary. Heap snapshots are high-perturbation retained-object diagnostics, never benchmark timings. Do not force GC per render; that creates an artificial allocation/lifetime pattern. Retention runs can force GC at declared before/after boundaries if supported, with an unforced control.

## Subtraction experiments and what they would mean

| Diagnostic subtraction | Causal question | Conditions before shipping |
| --- | --- | --- |
| Disable outer position cache only | Is repeated keying/cloning/provenance restoration more expensive than this native solver? | Better end-to-end time and memory under warm, edit, churn and cold workloads; preserve caller mutation isolation, proof provenance and decisions. |
| Replay a frozen positioned artifact at the private seam | How much of total cost lies after positioning? | A diagnostic upper bound only: replay may avoid input-dependent work and cannot become a public performance claim. Real optimization needs complete cache dependencies. |
| Replay immutable prepared paint geometry, then final certifier | Is paint construction/inspection repeated unnecessarily? | Same native geometry, issue witnesses, ancestor/viewport/terminal semantics and certificate status on adversarial and holdout inputs. |
| Skip only demonstrably no-op SVG passes | Is whole-document string churn dominating simple families? | Byte-identical output where promised; final security on final bytes, custom fonts, accessibility, IDs, CSS, compact mode and byte limits remain correct. |
| Stream identical canonical digest encoding instead of allocating escaped full SVG | Is receipt-only JSON string materialization causing the cost? | Bit-identical versioned digest; changed encoding requires explicit schema/version treatment. |
| Keep only primary cyclic candidate / disable one proposal family | Which extra candidates buy quality and at what cost? | Report crossing/bend/area/certification regression by input; retained 228/296/22 seeds and fresh holdouts. Lowering quality to pass timing is not a win. |
| Skip expensive quality assessment in a private lab run | Upper bound on certificate/assessment cost | Never ship this arm as an equivalent renderer. Replace repeated work with verified immutable proof reuse if safe; retain public hard constraints. |

Attempt fewer passes/data conversions before inventing another cache. A cache can increase memory pressure and clone work while hiding which computation is cheap. Conversely, removing a contract merely manufactures a faster but weaker product. Every subtraction arm needs a stated semantic delta and a public-contract validation gate.

## Runtime, closure and off-CPU distinctions

* Node/V8 packaged server SVG is the first attribution target because it matches current peer timing. Bun is JavaScriptCore: Bun 1.4 CPU profiles use compatible file formats, but its heap profiler is a snapshot, not V8 allocation sampling; current docs explicitly say heap-prof interval is accepted but ignored. Bun `node:v8` compatibility methods do not imply V8 semantics. Profile Bun separately only after checking actual supported APIs and pinning 1.4.2.
* Browser engine, DOM/font availability, text measurement, CSP, lazy import and network affect real user latency. Measure production lazy family entries as well as synchronous all-engines entry. Capture resource request count, transferred/compressed bytes, compile/evaluate time, first render and actual painted display separately. A compressed-size win does not prove wall-time or visual-paint parity.
* Native/WASM peers need cold module fetch/compile/instantiate and warm ABI/string conversion/memory-growth splits. JS heap excludes native/WASM allocations. Record external/ArrayBuffer memory, WASM linear-memory growth and process RSS separately; JS sampler gaps do not establish low allocation.
* Compare wall duration to process CPU deltas before looking for off-CPU bottlenecks. A synchronous renderer normally uses CPU; large wall/CPU divergence suggests scheduling/cgroup contention, file/network startup or waiting. Browser Performance/CDP tracing or Linux perf/scheduler tracing may clarify startup and kernel work if available. Do not run privileged tracing merely because a JS hotspot is inconvenient.
* CPU flame width is sample frequency, not call count or elapsed wall latency. Broad GC/native builtin frames need allocation stacks and caller context. A small self-time function can own a large inclusive subtree. Avoid multiplying independent per-function percentages by a source microbenchmark total.

## Evidence standard and decision rule

Publish the hotspot as an observation, the proposed explanation as a hypothesis, and the subtraction result as a controlled experiment. Require stable uninstrumented improvement plus unchanged contracts before calling it an optimization. Record input hashes and all failures/declines. A narrower supported set may improve the product, but changing the denominator does not establish that the existing broad PR beat ELK.

Existing peer A/A exceeds reciprocal 1.1 on five of ten inputs, so per-case all-input timing claims remain unqualified. Existing cyclic latency and allocation regressions remain failures even if a source instrumented loop looks good. Requalification must use unchanged public output consumption, support coverage, paint/fidelity gates, explicit fallback policy and fresh holdouts. Separate discovery seeds from final evaluation; report family and worst-case regressions rather than hiding them under a geometric mean.

## Primary sources and lessons applied

1. [Mytkowicz, Diwan, Hauswirth and Sweeney, ASPLOS 2009, *Producing Wrong Data Without Doing Anything Obviously Wrong!*](https://sape.inf.usi.ch/publications/asplos09.html), DOI [10.1145/1508244.1508275](https://doi.org/10.1145/1508244.1508275). Their measurement-bias experiments motivate setup randomization and A/A/causal controls; repetitions alone do not remove systematic bias. This is a methodological lesson, not evidence that JavaScript here has their exact SPEC/native bias.
2. [Curtsinger and Berger, SOSP 2015, *Coz: Finding Code that Counts with Causal Profiling*](https://arxiv.org/abs/1608.03676). Hotness does not itself prove optimization benefit. Apply controlled end-to-end ablations; Coz's native C/C++/Rust virtual-speedup tool is not a turnkey JS renderer profiler.
3. [Node CLI CPU/heap profiling options](https://nodejs.org/api/cli.html#--cpu-prof) and [Node inspector usage](https://nodejs.org/api/inspector.html#example-usage): separate whole-process startup collection from inspector-delimited warm collection, preserve interval/version metadata. Published docs are newer than the local Node24 runtime; verify actual protocol/flag support on the pinned binary.
4. [CDP Profiler](https://chromedevtools.github.io/devtools-protocol/tot/Profiler/) and [CDP HeapProfiler](https://chromedevtools.github.io/devtools-protocol/tot/HeapProfiler/#method-startSampling): sampling semantics, intervals and collected-object inclusion matter. Tip-of-tree is not the installed inspector protocol; capture supported protocol/version and fail clearly on unsupported options.
5. [Node GC-trace guide](https://nodejs.org/learn/diagnostics/memory/using-gc-traces): distinguish collection behavior and heap occupancy from total allocation and RSS.
6. [Brendan Gregg, CPU flame graphs](https://www.brendangregg.com/FlameGraphs/cpuflamegraphs.html) and [USE method](https://www.brendangregg.com/usemethod.html): use caller-stack attribution, then verify utilization/saturation/errors before inferring code inefficiency from noisy wall time.
7. [Bun benchmarking/profiling documentation](https://bun.sh/docs/project/benchmarking) and [Node compatibility](https://bun.sh/docs/runtime/nodejs-compat): JSC heap/CPU tooling and native memory differ from V8 despite compatibility-shaped APIs and profile file extensions.

Sources consulted 2026-10-22. This note proposes measurements; it does not claim they have passed.
