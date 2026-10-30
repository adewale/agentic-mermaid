# Owned layout compared with the Mermaid community

The owned TypeScript solver is a useful, broader alternative to a small
Flowchart-only layout. It is not yet a replacement for ELK on every quality or
cost dimension, and it does not establish leadership over the browserless
renderers. ELK remains our default. Here, **native** means our owned solver;
Rust native code, Rust/WASM and TypeScript are separate execution models.

This comparison supplements the [full backend qualification](layout-qualification.md).
It distinguishes inspected source, a project's published measurements, and our
same-input experiment. None is substituted for another. The peer campaign's frozen renderer is
`e9db0dbe8bac597f6db7198ecfe388f5cfbbbf01`, `agentic-layered@22`;
its subsequent reporting and benchmark-check commits do not change that artifact.
Runtime26 source `3258d80ce165457a1dd4695bb2bc12171f492006` has separate
historical [follow-up evidence](layout-followup-results.md). The current accepted
source is `678af21d8f2fc4de62f6dcf98d7f0489c8cde9c0`, published through reporting
head `8ac0040d8002952edd1c4e6c66adad97f510398e`. Each campaign retains its original
revision and date; earlier timing and memory ratios do not qualify this current
source. The [accepted forest delivery report](pr449-forest-boundary-2026-10-23.md)
and [complete cost controls](pr449-controls-2026-10-23.md) record the newer evidence.

| Evidence by source and scope | What is established | What is still missing |
| --- | --- | --- |
| ELK quality | Historical runtime26 evidence records known-source crossing/label gains and bounded Architecture cleanup. | That study retains21/64 fresh Architecture crossing losses and48/128 worse edit transitions; bends, length, area and proof uncertainty remain separate dimensions. Current-source claims require their own qualification. |
| ELK cost | At accepted678, Architecture's measured Brotli JavaScript closure is251,198B native versus572,973B ELK. Historical timing and memory observations retain their original source and scope. | Current qualification has not established a CPU or RSS win over ELK. Failed controls, deadlines and unavailable observations remain explicit. Both engines remain shipped; fallback and combined feature closures need complete accounting. |
| Pele/Ondine, Merman and other published peers | The pinned capability/source review and exact historical same-input experiment below remain evidence. | No current accepted678 same-input peer or blinded readability experiment establishes a new lead. Compiler/mount-runtime and Rust-native/V8 memory scopes remain distinct. |
| Zombie simple and family scope | Zombie's narrower optional solver remains a useful comparison with our six-family opt-in backend. | Neither expanding our families nor narrowing to Flowchart alone has measured justification; Flowchart-only would retain the cyclic tails. |

Four historical subtraction prototypes were measured against runtime26:
rank-first, best-band reuse, ray views, and a separately declared combined
query-local crossing-record/ray-view variant. None meets its declared improvement
targets; the complete combined memory run is allocation-flat and would reduce
payload reserve. All remain outside production. Their exact source patches,
controls and adverse results are retained in the
[follow-up report](layout-followup-results.md#further-cyclic-attribution-on-frozen-runtime-26).
Removing temporary objects or visits is therefore an evaluated mechanism here,
not evidence that we have caught up with another implementation.

## What the community inventory actually represents

[Mermaid Community](https://github.com/adewale/agentic-mermaid/blob/ee9c9dc32f9bc3b47de2f5990bc1466b55815649/docs/mermaid-community.json) contains **83 nodes**:
45 forks, 8 ports, 3 bindings, 26 independently rooted projects and the language
origin. Those are provenance categories, not 83 independent layout algorithms.
64 nodes have the observed role. Roles overlap: the inventory marks 9 graphical
peers, 8 terminal peers and 4 parser peers, as well as ourselves and the origin.
An independent git root alone does not establish an independent algorithm.

The inventory observations retain their original 18–20 October dates. Later
source inspections and the supplementary Zombie 5.8.2 package pin below do not
silently refresh that snapshot or its published-package claims. Sketch, the Go
Pele port in `eval/fork-graph/population.json`, is a separate recorded lead; it
is not added to the 83-node total.

## Approaches and the useful differences

| Project / lineage | What its inspected approach offers | How ours compares; what remains open |
| --- | --- | --- |
| [Mermaid.js](https://mermaid.js.org/config/layouts.html) + [ELK Layered](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html) | Language reference, mature layered routing, labels, arbitrary port constraints, compounds and cross-hierarchy edges. Mermaid 12 documentation identifies ELK as the default for several graph families. | Our six-family adapters retain measured content and authored relationships, with an explicitly selected owned solver and truthful fallback receipts. We still decline active hints and ancestor-container terminals, and lose individual quality cases. Our comparison uses ELKjs 0.11.0 inside our own pipeline; it is not a score of Mermaid.js's entire renderer. |
| [Beautiful Mermaid](https://github.com/lukilabs/beautiful-mermaid/tree/2ac8bbbb060ca0a65a6a21f3200bd99b1587b488) | Our ancestor: browserless TypeScript SVG and a terminal engine ported from the Go Mermaid ASCII lineage. | We add the owned graph solver behind existing typed editing, Scene, measurement and verification contracts. The fresh public-API timings below expose the remaining cost of our complete pipeline. Shared ancestry does not imply identical current code or semantics. |
| [Zombie Mermaid: simple layout](https://github.com/dfadler/zombie-mermaid/blob/ae30b804c70d89b072e3d20265d0d0c752a9f11f/docs/decisions/simple-layout-1685.md) | Opt-in Flowchart Sugiyama layout with label/dummy ranks, barycenter sweeps, least-squares coordinates and inside-out subgraphs. Its source documents ignored subgraph directions, routing limitations, and the marker-free State detection caveat. Published incremental cost is about 3.5 KB gzip, using its own bundler/method. | This is the closest design comparison: preserving the default while offering an owned small solver. Ours spans Flowchart, State, Class, ER, Requirement and Architecture, preserves supported local directions, and bounds cross-scope routing. Zombie deliberately accepts a narrower target. Its 3.5 KB increment is not comparable to our entire renderer closure. Node can auto-load ELK for other families; the measured simple arm is hybrid and also takes its simple path for marker-free State80. |
| [Pele](https://github.com/obsidianmd/pele/blob/1dd58b7ebb0ec654fa7dc4304d50cf8fd3a65d7b/src/layout/layered.ts) | Browserless TypeScript; explicit priorities for distinct routes, crossings, length/bends, attachment centering, balance, source order and compactness. [Compound scopes](https://github.com/obsidianmd/pele/blob/1dd58b7ebb0ec654fa7dc4304d50cf8fd3a65d7b/src/layout/compound.ts) coordinate boundary ports. Its README claims all Mermaid 12.1.0 built-in families; browser mount/reflow and per-family entries are separate useful features. | We apply completed-route and boundary-port ideas while preserving original endpoints and explicit declines. We have no demonstrated speed or payload lead over Pele, nor an equivalent automatic browser mount/reflow contract. Its advertised breadth is not per-construct fidelity proof; our six-family solver coverage is not whole-library breadth. |
| [Ondine](https://github.com/wevm/ondine/blob/0b589ec34481856b4153526f10a0a35558a201a8/crates/compiler/src/layout/compound.rs) | Rust/WASM port of Pele's layout lineage; build-time compilation, Node compiler and per-family browser modules. The small mount-only runtime inserts already compiled SVG. | Ours supports runtime graph selection and existing agent workflows in TypeScript. Ondine supplies a strong distribution strategy and a fast compiler comparator. Its mount-runtime byte claim excludes the parser/layout/compiler, so cannot beat or lose to our renderer by that number alone. The experiment uses published 0.0.1, not newer inspected source. |
| [Merman](https://github.com/Latias94/merman/blob/71da4cf6fbbf4fcf27fb0465cc9169f6fd6ebd8b/README.md) | Headless Rust, native and WASM bindings, pinned compatibility checks, typed capability/backend policies and selectable package features. Its [runtime ADR](https://github.com/Latias94/merman/blob/71da4cf6fbbf4fcf27fb0465cc9169f6fd6ebd8b/docs/adr/0074-browser-runtime-and-benchmark-ownership.md) separates acquisition, initialization, realm lifetime, cancellation and rendering. | Our explicit selection and receipts are not unique in the ecosystem. Its lifecycle discipline informs our separate first-use, cache, warm and browser measurements. We test the published native Node API below; its native allocation is invisible to V8-only counters, and its wider Rust/terminal surfaces are not established by this Node test. |
| [mermaid-rs-renderer](https://github.com/1jehuang/mermaid-rs-renderer/tree/3726ccbffe0e8032361eb9668694b24f77858060) and [its WASM binding](https://github.com/akashacms/mermaid-wasm-renderer/tree/cf6338f0e905d02620296ad77f75ec9d59ecd7b8) | Browserless Rust SVG/PNG and distinct runtime bindings. | We measure `mermaid-wasm-renderer@0.3.1`, not the current native CLI or the N-API binding. A Node/WASM timing cannot rank all Rust delivery forms; advertised speedups against a browser-starting CLI are not a solver comparison. |
| [Dart / Flutter Mermaid](https://github.com/orestesgaolin/mermaid/tree/3e92b91bcbad0b883ce6a4c8826015b5fa1c10f7) | Own parser/layout/SVG pipeline and Flutter scene painting without a WebView; the inventory records published 0.3.0 separately from source. | A platform capability we do not offer natively. Not executed in this campaign; neither runtime nor quality superiority is established in either direction. |
| [Frankenmermaid](https://github.com/Dicklesworthstone/frankenmermaid/tree/29536a1308acd1bae4da8b72b4cebffb39709ae0) | Rust/WASM SVG, diagnostics and edit-related surfaces; native CLI/terminal delivery is separate. | The inventory distinguishes checked-in WASM, source, release CLI and deployment bytes and records the restrictive license rider. No code is adopted; this campaign does not execute it or relabel older results as current native-backend measurements. |
| Terminal peers: [Mermaid ASCII](https://github.com/AlexanderGrooff/mermaid-ascii), [pgavlin's fork](https://github.com/pgavlin/mermaid-ascii), [Termaid](https://github.com/fasouto/termaid), [Mermansi](https://github.com/kingsword09/mermansi), [Figurehead](https://github.com/Mootikins/figurehead-rs) and the related ports in the inventory | Cell placement, connected text routes and terminal-width decisions; some share substantial code ancestry. | Pixel layout, terminal projection and terminal receipts are different workloads. This PR's graphical solver cannot claim a terminal improvement from their rankings. Cell routing, compactness and preserved labels remain useful ideas to test through the existing terminal contract. |
| Parser/editor peers: [Visimer](https://github.com/inkeep/visimer), [mermaid-ast](https://github.com/neongreen/mermaid-ast), [Maid](https://github.com/probelabs/maid) | Lossless CST/edit operations, AST parsing or diagnostics. Visimer's DOM renderer uses Mermaid. | Relevant to source preservation, edit closure and diagnostics; not independent layout-quality competitors. Our owned layout does not replace those editing benchmarks. |

The rest of the inventory's forks, bindings and integrations remain accounted
for by their provenance entries. A wrapper using Pele, Mermaid or Merman does
not add another independent layout result. The source table supplies capability
comparisons, not an assertion that every named project was installed.

## Same-input public SVG experiment

The corrected harness is frozen at `61746a28`; the complete local distribution is hashed
in every local pin. Public packages retain exact versions and npm integrity.
The additional `@zombie-mermaid/svg-renderer@5.8.2` pin is intentionally warned
as absent from the older inventory. The registry's provenance identifies
`61f646912e276bf6f928e28e61836e6f5363e336`; that does not establish byte parity
with later source `ae30b804`.

The experiment has ten inputs, ten arms and three alternating-order rounds:
30 fresh Node workers and 300 enrolled arm/input/round observations. The inputs
are Flowchart 5, a 50-node tree and labelled 50-node mesh, Class80, ER40, State80,
Requirement100, grouped Architecture3, Sequence20 and C4. Sequence and C4 do
not use the new graph solver and cannot count as solver wins.

`node-svg-consumed@2` includes UTF-8 conversion and SHA-256 of the complete SVG
on every warm timed call. Expected label text is checked before timing, including decorated field rows;
a changing output is checked again. Invalid later output cannot become a fast
success. SVG text is the common consumed surface: peers' additional metadata
and our additional receipt serialization are excluded. Receipts and their final
SVG digest are lazy: the plain SVG call does not materialize them. Request,
geometry, paint and security work still runs. First-render timing excludes output
consumption/capture. Snapshot writes and label checks are outside steady-state
timing, except the explicit recheck for changing outputs.

All local arms start with normal bounded caches, using the same startup flags;
peers keep their defaults. Thus this is a repeated-source public-API comparison,
not uncached layout-kernel time. Source strings, hashes, expected labels, raw
samples, failures, output fingerprints and environment accompany the results.
The three local arms share renderer/dependencies. Default ELK is measured twice
as A/A. Zombie's same-version default and simple arms share their package;
Class, ER and Architecture can auto-discover our installed ELKjs 0.11.0.
Zombie also uses simple for the marker-free State80 input: its State detector
relies on a `[*]` marker, a caveat documented by the project. A separate admission
probe registers an ELK constructor that always throws. All three Flowcharts and
State80 still render with zero ELK constructor attempts and byte-identical SVGs;
Class, ER and Architecture attempt ELK. Sequence/C4 do not need it. This proves
the observed paths without claiming full State support for Zombie simple.

The first campaign (`node-svg-consumed@1`, harness `5b5baa2d`) is retained
separately. It enrolled the full population, but its exact-text gate incorrectly
classified Requirement fields rendered as `Text: Requirement 0` as missing.
Those SVGs contain the authored text. Protocol2 accepts whole phrases in text
runs/HTML label rows while rejecting numeric-prefix matches (`Requirement 1`
inside `Requirement 10`) and metadata-only occurrences. Every arm/input is
rerun; first-campaign coverage and timings are not pooled into the corrected
result. This repairs the evaluator and does not change renderer output.

[Complete raw results](layout-community-results.json) retain all 300 observations.

Environment: Node v24.19.0, Bun 1.4.2, INTEL(R) XEON(R) PLATINUM 8573C, 5 logical CPUs, Linux x64. All 30 workers complete with no restarts. All 285 successful captured SVG hashes validate, with 0 changing-output calls; all 285 captures are byte-identical to the initial campaign. No build/test ran concurrently with either timing campaign.

Warm public SVG milliseconds per call, median across three rounds; lower is faster. Local arms use normal caches. These values do not time extra receipt serialization or browser painting.

| Input | Our native | Our ELK | ELK A/A | Zombie ELK | Zombie simple* | Pele | Ondine | Merman | Rust/WASM |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| flow5 | 7.72 | 6.55 | 6.71 | 7.25 | 0.367 | 0.183 | 0.0637 | 2.45 | 48 |
| tree50 | 20.8 | 21.3 | 21.6 | 32.3 | 2.28 | 0.936 | 0.469 | 6.4 | 755 |
| mesh50 | 30.9 | 34.6 | 32.9 | 57.8 | 5 | 2.73 | 1.31 | 15.3 | 1.51e+03 |
| seq20 | 11.8 | 12.1 | 14.3 | 0.404 | 0.379 | 0.165 | 0.0804 | 2.64 | 6.96 |
| c4 | 10.2 | 10.2 | 9.56 | 0.165 | 0.169 | 0.0412 | 0.026 | 1.34 | 0.14 |
| class80 | 77 | 84.9 | 86.2 | 39.8 | 46.7 | 1.57 | 0.82 | 21.4 | 130 |
| er40 | 52.3 | 53.8 | 62.3 | 25.4 | 28 | 1.37 | 0.622 | 25.2 | 89.7 |
| state80 | 53.7 | 55.6 | 68.3 | 59 | 6.01 | 2 | 0.836 | 12.3 | 249 |
| requirement100 | 88.2 | 96.1 | 118 | unsupported | unsupported | 4.04 | 1.9 | 38.7 | 271 |
| architecture3 | 6.18 | 6.44 | 7.89 | 5.21 | 4.93 | 0.0678 | 0.0324 | 1.11 | 0.136 |

*Zombie simple also takes its simple path for the marker-free State80; Class/ER/Architecture use discovered ELK. Sequence/C4 are unchanged controls in our three arms. Full per-round samples and MADs, Beautiful results, and all errors are in the raw report.

| Public artifact | Text-accepted inputs /10 | Retained failure |
| --- | --- | --- |
| agentic | 10/10 | none |
| agentic-aa | 10/10 | none |
| agentic-native | 10/10 | none |
| ondine | 10/10 | none |
| beautiful | 7/10 | c4, requirement100, architecture3 |
| zombie-current | 9/10 | requirement100 |
| zombie-simple | 9/10 | requirement100 |
| pele | 10/10 | none |
| merman | 10/10 | none |
| mermaid-rs | 10/10 | none |

Local A/A median paired ratios fall outside reciprocal 1.1 on **5/10 inputs** (seq20, er40, state80, requirement100, architecture3). The per-input A/A range is 0.958–1.372. Native/ELK ratios and A/A are retained separately in the [evidence summary](layout-community-summary.json). Flow5 is an adverse observation: native/ELK is **1.177×**, with A/A **1.024×** (native sample MAD/median 14%). This SVG-only cohort does not qualify an all-case timing improvement; the independent full 27-input qualification remains the stronger within-pipeline result.

Pele, Ondine and Merman are materially faster than our public SVG calls on these inputs. Zombie simple is materially faster on the Flowcharts and marker-free State input, while using a narrower graph contract. Our native calls are faster than this Rust/WASM binding on the tested Flowcharts, Class, ER, State and Requirement, but that binding wins on Architecture and unchanged controls. Neither implementation language nor removing ELK determines whole-workflow performance. The large Sequence/C4 gaps remain even though our graph solver is unused; shared-pipeline profiling is still necessary.

A concrete authored-constraint witness shows why text acceptance alone cannot
qualify equivalent work. The Architecture input declares `disk:T -- B:server`.
Our native and ELK SVGs attach to Storage's top and Server's bottom. Both Zombie
5.8.2 arms instead paint a horizontal Storage-right → Server-left segment,
`(148.76,109.45)` to `(196.76,109.45)`. The named endpoints remain, but the
authored sides do not. This [measured witness](layout-community-port-witness.json)
records exact node boxes, polylines, source/artifact hashes and the 0.05px side
tolerance. It is one edge on one input, not a general peer quality ranking.
Pele/Ondine/Merman are not declared port failures from their timings.

The text gate is necessary but insufficient; it does not resolve CSS visibility or certify glyph ink: a renderer can keep all labels
while changing edges, cardinalities, nesting, style or authored meaning. We
have not extracted a common six-family positioned model from every peer or run
a blinded readability study. Accordingly there is **no peer-wide geometry
winner** in this report. V8 allocation omits WASM linear memory/native heap;
resident process memory is after the workload sequence, not a retained-memory
or leak comparison. These counters also omit external Buffer backing storage. Large timing differences describe these public calls and
these defaults; small differences require healthy controls before interpretation.

## What the controlled ELK comparison establishes

The following table retains the historical runtime22/e9/b473 qualification. Its
ratios and limits do not qualify accepted678. These results use the
same parsers, text measurement, family adapters and receipt/paint pipeline.
They isolate backend choice more closely than cross-product SVG timings do.
Source metrics cover 246 occurrences / 231 distinct strings. Generated metrics
retain all 640 cases, including six ELK failures; quality pairs use the 634
shared generated successes.

| Aspect | Owned backend result against ELK | Has the full ELK target been matched or beaten? |
| --- | --- | --- |
| Admission | Source 246/246 for both; generated 640 native / 634 ELK. | Better on this generated population; bounded eligibility still incomplete. |
| Crossings | Source 879→533; no extra crossings on shared generated cases. | Better aggregate, not every case: Architecture 0 and 5 each add a crossing. |
| Labels | Source conflicts 40→16; no extra conflicts on shared generated cases. | Better aggregate, not every case: ER40 adds 16 label/route conflicts. |
| Parallel / opposing spans | Source 18/9→0/0; no generated regression. | Matched or beaten on measured spans. |
| Bends, length, area | Lower aggregate source length/area; bends rise 2673→3190. | No. More bends in 25 source /268 generated cases; more area in 34 /191. |
| Paint proof | Source certificates 219 pass versus 217. | No. All 634 shared generated certificates remain unverified; native has more issues in 48 cases. |
| Edit stability | All 36 undo SVG checks pass; six-family edit sequences recorded. | No. Four comparable transitions displace unaffected subjects more, and hints can change eligibility/backend. |
| Native constraints | Frame terminals, empty scopes, grouped Architecture and supported local directions. | No. Active hints and ancestor-container terminals still decline; port/symmetry preference scoring is incomplete. |
| Fully consumed normal-cache time | Historical full27-input run(e9/b473): corpus native 0.974425× /A/A 0.973128×; agent edit 1.002526× /A/A 0.999490×. | Approximately tied. This consumes complete receipts/workflows, unlike the peer SVG-only experiment. |
| Cache-off cost | Historical full run completed with healthy A/A: corpus native 0.579697× /A/A 0.991710×; agent edit 0.613027× /A/A 0.982787×. | Better aggregates; not all cases. Cyclic15/18-cuts still take 1.519808× /1.587379× ELK. Earlier incomplete runs remain retained. |
| Memory | Historical corpus RSS 0.773295× off /0.787892× normal; peak heap about 0.601× in both. | Partial. Six uncached cyclic cases allocate 1.485–2.096× ELK; retained growth does not always improve. |
| Browser delivery | Flowchart native 286669 gzip bytes versus ELK 711870; all six native closures smaller. | Yes on measured transfer bytes. Class/Requirement add one request; synchronous bundle keeps both engines. Architecture has only 7 Brotli bytes of budget headroom. |

The complete [16-aspect qualification](layout-qualification.md) retains adverse
case IDs, visual inspections, study limits, source pins and both failed and
successful cost campaigns. All required CI passes at `b4734ec7`; passing required
CI is separate from passing advisory quality and cost qualification.

The [historical full cost artifact](https://github.com/adewale/agentic-mermaid/actions/runs/39695626480/artifacts/12391357430)
and [per-case/memory summary](layout-cost-b473-results.json) use b4734ec7,
with renderer/build files unchanged from the e9 freeze. Both cache policies now
complete on the recorded EPYC 9V74 runner; the earlier EPYC 7763 incomplete run
remains separate. The new complete measurements close an evidence gap, while
the cyclic cost regressions keep the full target open. They are not a new
implementation speedup or a pooled best-of result.

## What the research suggests doing next

These are the peer campaign's runtime22 hypotheses. ER40 label reservations are
subsequently repaired in23; bounded26 cleanup fixes the duplicate Architecture0/5
witnesses, while fresh Architecture still exposes placement/routing and edit-motion
losses. The current [unfinished inventory](../../../TODO.md#owned-graph-backend-qualification-owner-request-pr-449)
and [experiment decisions](layout-followup-results.md) distinguish those repairs,
rejected mechanisms and remaining work. Lane indexing, proof reuse, lazy orders
and the four later prototypes are not untouched recommendations.

The algorithmic family itself is established work. ELK, Pele, Zombie simple and
our solver all use layered-drawing ideas. [Gansner et al.](https://graphviz.org/documentation/TSE93.pdf)
separate ranking, crossing reduction, coordinates and routing; the useful
comparison is the completed artifact and the workload contract.

1. Jointly score Architecture's final side-constrained routes and placement,
   retaining authored endpoints, to remove the two extra crossings. Pele's
   completed-route priorities and [orthogonal connector routing](https://users.monash.edu/~mwybrow/papers/wybrow-gd-2009.pdf)
   are useful leads; port constraints cannot be optimized away.
2. Retain and validate ER label reservations through adapter repairs, and
   clear labels against unrelated shafts. Fixing ER40 must retain every
   relationship/cardinality and not silently relax the conflict metric.
3. Improve bends and footprint together. Sparse long-edge normalization
   ([Eiglsperger et al.](https://jgaa.info/index.php/jgaa/article/view/paper111))
   is a future representation experiment, not an implemented speedup. Any
   coordinate-assignment replacement must account for the
   [Brandes–Köpf erratum](https://arxiv.org/abs/2008.01252).
4. Extend supported constraints and incremental stability. The
   [mental-map literature](https://www.st.uni-trier.de/diehl/pubs/VisSym01.pdf)
   motivates measuring unaffected subjects, not merely successful redraws.
5. Profile the complete workflow and remove the cyclic cache-off time/allocation regressions. Smaller layout
   code does not remove Scene, text, rendering or verification work. Compare
   time/heap/transfer separately, with controls and the full failed population.
6. Add common geometry adapters for peers before claiming a community quality
   lead; include authored endpoint/edge identity, containment, labels, markers,
   routing, ports, symmetry and edits. Human readability remains a separate
   study: [Purchase's experiments](https://eprints.gla.ac.uk/35804/) support
   keeping aesthetic dimensions visible rather than declaring a weighted-score
   winner for every task.

## Reproduction and evidence

Build the pinned renderer and use its lockfile. The comparison intentionally
uses published peer artifacts rather than treating inspected source as a build.
Peer installation disables scripts; transitive npm dependencies resolve at
install time. Retain the installed lock/integrity evidence when reproducing.
Do not run builds or tests concurrently with the timing campaign.

```sh
bun install --frozen-lockfile
bun run build
mkdir -p /tmp/layout-community
bun run eval/benchmark/peer-bench.ts \
  --peers agentic,agentic-aa,agentic-native,beautiful,zombie-current,zombie-simple,pele,ondine,merman,mermaid-rs \
  --workloads flow5,tree50,mesh50,class80,er40,state80,requirement100,architecture3,seq20,c4 \
  --outputs svg --consume-svg --rounds 3 \
  --json /tmp/layout-community/results.json \
  --markdown /tmp/layout-community/results.md \
  --svg-dir /tmp/layout-community/svg
bun run eval/benchmark/peer-gallery.ts \
  --report /tmp/layout-community/results.json \
  --svg-dir /tmp/layout-community/svg \
  --out /tmp/layout-community/gallery.html
```

The legacy timing protocol remains available without `--consume-svg`; it is
labelled separately and cannot be pooled with this one. Eight worker integration
checks exercise strict selection, full consumption, changing artifacts, later
invalid outputs, lost labels, decorated field phrases, numeric boundaries and metadata exclusion. Core/repository types and changed-file lint
pass. This continuation changes evaluation/reporting, not solver geometry; the
remaining quality blockers above are not claimed as repaired. The portable
SVG gallery preserves failed cards and original output links. Five Chromium
input selections verify its controls and all available image decodes; previews
are inspection aids, not a browser-paint timing or a readability study.
