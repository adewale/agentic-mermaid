# Independent cumulative cost review

Reviewed the retained 689-versus69d5 tables and the existing worker/reducer after the isolated clock window closed. This review ran no renderer, profile or timing repeat. The implementation owner reports 240 stock workers and60 full-response workers/540 consumed calls, with no lifecycle failures and all processes closed. The reduced tables contain20 cells per surface (five inputs × two builds × two backends); their recorded failure lists are empty.

The full-response worker calls the actual built public `renderMermaidSVGWithReceipt` and serializes the complete product once inside the clock. Import, artifact compression/writes, explicit GC and the extra retained receipt encoding are outside it. A cold-render value is the first render after import, not import plus render. Repeat summaries are the median of three process medians over four repeated calls. These are exploratory matched observations, not a formal calibration or a universal speedup.

| Full consumed response, ms | Native689 | Native69d5 | ELK689 | ELK69d5 |
| --- | ---: | ---: | ---: | ---: |
| Chain100 |109.6414|107.9704|179.3445|192.5883|
| Fan-in100 |157.0884|145.8842|346.6664|348.8008|
| Chain300 |279.1509|280.3777|477.7246|474.9960|
| Compound identity LR |38.9001|25.3615|49.9292|50.4063|
| Compound permutation TB |87.6176|77.3122|97.5229|101.5979|

The identity result agrees with the causal route simplification: three process repeat medians span38.7753–43.6046ms before and23.5073–26.1427ms after; median repeat CPU falls69.5035→38.8900ms. Its actual final paths already independently improved to560wire/0bends/0crossings at unchanged area. This supports an improvement for this named input. It does not establish a general flat-graph speedup: Chain100's ranges overlap (102.8700–115.9636 versus105.3714–111.6010ms), its repeat CPU rises170.4330→173.8390ms, and all three candidate process medians exceed100ms. Fan-in100 also remains above the owner's100ms full-consumption target.

Adverse observations remain part of the result:

- Native Chain100 full cold render rises251.8633→313.3621ms; first edit135.6563→147.1405ms. Its stock comment variant and alternating edit also rise70.5649→72.7944ms and63.2599→64.5694ms.
- Native Chain300 full repeat rises279.1509→280.3777ms; first edit284.5059→287.9540ms; post-repeat heap48.2737→51.1223MiB and RSS191.6250→195.7441MiB. Both backends still return an **unverified** scoped proof on this input; this is not a newly observed visible failure.
- Native identity LR full-call post-repeat heap rises23.1675→26.3421MiB even though stock API-return heap falls25.1812→21.3793MiB. These are different phases; neither may replace the other. The full-call measurement is not a retained-after-GC heap result.
- Native TB permutation stock warm response rises45.5201→46.7673ms while the full consumed response falls87.6176→77.3122ms. Its stock API-return heap rises22.7537→25.0444MiB and process peak RSS120.3281→121.9961MiB. The independent geometry tradeoffs—crossings24→29 and area253224.4→261286.025—remain explicit.
- Several ELK cells also worsen, including Chain100 full repeat179.3445→192.5883ms and cold503.7582→577.7539ms. Unchanged product bytes do not make these observed cost cells disappear or prove their cause.

Browser delivery contains132/132 passed family/build/backend observations with zero observer errors. In this **matched current build pair**, plain Flowchart Native gzip9 is380171→381932bytes (+1761), Brotli11 is323637→325146 (+1509), raw is1139328→1145348 (+6020), and requests remain32. ELK is741296→741293gzip and586259→586293Brotli with27requests. Thus the fix does not close the request-count disadvantage and adds Native payload. The historical379237/740366gzip pair belongs to a different archived build and must not be substituted for this matched baseline. The761500 figure remains a budget ceiling, not an ELK comparator. All33 families' deltas remain in the underlying delivery records; Class/Usecase/Swimlane/Requirement shared-module costs are not zeroed out.

The198 exact product-reuse rows compare the current build to the previously observed e1cf products for the same original99 input/options and both backends. Their scope explicitly retains equal error rows as errors. They are not independently a claim that the corrected99 compatibility overlay or every meaning observer passed; the corrected font/Eventmodeling enrollment remains separately owned by the root qualification report.

Sources: [full-response metrics](../identity-qualified/cost/RECEIPT-METRICS.json), [stock metrics](../identity-qualified/cost/SVG-METRICS.json), [full worker](../identity-qualified/cost/receipt-worker.mjs), [reducer](../identity-qualified/cost/reduce-costs.py), [browser observations](../identity-qualified/browser/RESULTS.json), and [product reuse scope](../identity-qualified/product-reuse/SUMMARY.json). The [actual16 review](FINAL-CUMULATIVE-REVIEW.md) supplies the independent ink and geometry qualification. The [Main source review](MAIN-INTEGRATION-REVIEW.md) explains why these clocks do not predict the future merged result.

This milestone supports retaining the demonstrated compound delivery/ink repair and named identity improvement with all adverse cells disclosed. No universal performance, memory, payload,100ms, proof-completeness or PR-readiness claim follows.
