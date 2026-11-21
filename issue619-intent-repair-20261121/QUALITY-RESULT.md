# Readable transfer ownership and crossing/label tradeoffs

Current source: `6d8d7fbc835b2767b83a3bbdfca5e7b7d9f8e19b` (runtime change `e459cd7c70d37bfd4afe9667fe91bf5827a5aa89`; final commit strengthens a test only). Before: `32b025bff14e3020fd709a08d84f8543f57cb0cd`. Existing draft PR621, issue619 remains open.

The wallet investigator in [Beautiful Mermaid #52](https://github.com/lukilabs/beautiful-mermaid/issues/52) wanted to distinguish three upper-destination transfers and the lower destination's exclusive payer. AM previously retained the correct relationships but merged the upper arrivals. This repair gives all three arrivals distinguishable shafts and arrowheads, at least 13.45 px apart, with zero crossings and passing scoped paint. It does not repair a demonstrated false connection: the old output already preserved the exclusive lower payer.

The first responsible stages were generic bundling and, independently in the selected unbundled candidate, route-contract straightening. The bounded arrival rule now applies to forward fan-ins whose nearby peer senders have different visible destination sets. It shares the existing sameFlowLayer predicate and its 28 px peer tolerance. Source fan-out construction also preserves protected arrivals. Mixed labelled/unlabelled convergence declines its optional reconstruction when a nonrectangular target would collapse the spread into one vertex. Invisible constraints, self-loops, uniform joins and state terminators keep their respective owners. Different-rank arrivals are outside this local rule.

Ordinary selection now minimizes **4×proper crossings + 5×padded label-conflict pairs**, after unchanged hard feasibility and title readability. Equal weighted costs retain crossing-first ties. A one-conflict repair can spend one crossing, not two. Raw counts remain in receipts; a joint change is named `readabilityCost`. These coefficients are a documented product policy, not a calibrated user-study result. The optional balanced candidate retains its separate all-axis Pareto requirement. No solver code, backend, cache, version, proof cap, recovery ladder or payload budget changed.

## Observed final outputs

| Same input and balanced options | Before | After | Cost/limit |
|---|---|---|---|
| Wallet, 10 nodes/11 edges | 1 shared upper arrival, 0 crossings | 3 distinct arrivals, 0 crossings | Wire 857.90→999.61 px (+16.52%); bends 12→11; identical canvas |
| Generated seed135, 13 nodes/28 edges | 10 crossings, 63 geometric bends | 8 crossings, 60 bends | Wire 13,710.83→13,729.04 px (+0.13%); identical canvas; paint passes |
| Generated seed139, 17 nodes/40 edges | 24 crossings | Exact same SVG | Paint remains unverified at two n16 endpoint markers |
| Cyclic19, 19 nodes/44 edges/11 captions | 37 crossings | Exact same SVG | ZM still has31; no claim of closure |
| Approval workflow, 34 nodes/44 edges/18 captions | 0 crossings | Exact same SVG | Main flow and11 returns retained |

Eleven of the fourteen original/title-free, default/balanced SVG comparisons are byte-identical. The changed SVGs are wallet default/balanced and seed135 balanced. Scope, hashes and exact pairs: [Astra audit](astra/final-svg-audit.json). See [wallet contact sheet](wallet-comparison.png), [seed135 before/after](seed135-before-after.png), and [full five-product gallery](gallery.html). Focus crops change shaft colors and fade unrelated content; original geometry, marker scaling and peer CSS theme variables are retained.

## Regression cases and provenance

Four checked-in inputs match the saved public reporter examples byte-for-byte:

- [BM #52](https://github.com/lukilabs/beautiful-mermaid/issues/52): exact wallet source plus all four directions, complete occurrence counts, exclusive lower payer and distinct upper arrivals more than5px apart.
- [BM #83](https://github.com/lukilabs/beautiful-mermaid/issues/83): exact approval workflow,34nodes/44edges/18captions,33 downward main links and11 upward returns.
- [BM #111](https://github.com/lukilabs/beautiful-mermaid/issues/111): exact labelled fan source, named source/target/caption triples. Its original complaint was terminal trunk geometry; the existing ASCII test remains the geometry owner.
- [ZM #629](https://github.com/dfadler/zombie-mermaid/issues/629): exact request/response source, retained directions and separately associated captions. The original historical failure was ASCII; the new SVG guard does not claim AM had that failure.

Owning tests: src/__tests__/aesthetic-issue-regressions.test.ts, layout-certification.test.ts, layout-pass.test.ts. New short controls cover both senders having private branches and a mixed-label diamond in four directions. Restoring baseline production code makes nine expanded tests fail. The subsequent mixed-label diamond was independently traced and verified red on the old owner before the fallback veto. Hard certification and the pre-existing uniform fan, bundle, marker, label, property and budget checks remain active. The obsolete invisible-edge assertion was replaced with actual visible hard/crossing/conflict checks rather than a fixed invisible point count.

## Mermaid, Pele and ZM

Mermaid12.3.0 uses its installed default Dagre renderer, Pele1.13.0 its installed public npm API, and ZM5.18.0 the previously pinned public API/elkjs0.12.1. Every product receives the same authored source. No peer geometry hooks or font normalization were used.

All five new Mermaid and five new Pele attempts returned SVG. On the wallet, Mermaid, local Pele and ZM all have zero crossings and three distinct upper arrivals; AM now preserves that distinction too. The approval workflow has zero crossings in AM, Mermaid, local Pele and ZM. Generated seed135 has AM8/ZM4/Pele10; seed139 AM24/ZM17/Pele21; cyclic19 AM37/ZM31/Pele38. The independent exact polynomial observer cannot count Mermaid's elliptical `A` segments on those three generated cases, so its totals remain **unknown**, not zero. Metadata correspondence and caption-text multisets were checked; common peer paint and per-caption ink ownership remain unassessed. These are emitted-SVG observations, not full Trident scores.

Automatic approval review rejected sending sources to the hosted pele.run playground. No retry or indirect upload occurred. The Pele results here are local npm1.13.0; hosted parity is unknown. Different default fonts and scales are retained in the gallery and prevent treating canvas differences as isolated algorithm effects.

The linked reports support testing a reader's tracing question alongside crossings. They do not prove that4:5 is optimal, that every shared trunk is confusing, or that all aesthetic and execution metrics improve. Remaining crossing losses, the two unverified marker cases and longer wire are retained.

The fully consumed benchmark also covers dense24, outside the14-output visual sample. Both default and balanced saved outputs change: crossings124, geometric bends175,18captions,75occurrences and1773.916×1301.525canvas stay unchanged; wire48,411.415→48,390.739px (−20.676px), scoped paint passes. The inherited byte comparator retains72 default-exact flags for this intentional dense default geometry change; the new ordinary selection/arrival policy does not promise default byte identity. See benchmark/dense-qualification/quality.json and the unchanged raw flags.
