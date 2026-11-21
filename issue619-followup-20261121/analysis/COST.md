# Dense first-edit cost review

The retained 48-process measurement found a first-edit regression on the dense multigraph with caching enabled. The control’s three fresh processes took 569, 516 and 499 ms. The candidate’s took 854, 799 and 578 ms. The median rose from **515.53 to 798.53 ms**. The edit changes one node label from “Node 0” to “Edited node”. The call consumes the whole public SVG and receipt. All 288 corresponding products matched between arms. [Matched phase summary](../benchmark/summary.json)

| Dense workload | Control | Candidate |
| --- | ---: | ---: |
| Cache disabled, cold | 699.21 ms | 840.19 ms |
| Cache disabled, seven original repeats | 506.31 ms | 507.81 ms |
| Cache disabled, first edited input | 489.72 ms | 454.23 ms |
| Cache disabled, repeated edited input | 548.79 ms | 504.86 ms |
| Cache disabled, original warm heap | 73.21 MiB | 82.67 MiB |
| Cache enabled, seven original repeats | 6.29 ms | 6.76 ms |
| Cache enabled, first edited input | 515.53 ms | 798.53 ms |
| Cache enabled, repeated edited input | 10.69 ms | 10.82 ms |
| Cache enabled, original warm heap | 24.48 MiB | 24.52 MiB |

Every cache-enabled first edit began with about 22 MiB of used heap. The candidate’s three post-edit heap readings were 63.42, 67.02 and 65.37 MiB, below the corresponding control readings of 68.01, 70.20 and 67.40 MiB. Process CPU time rose from 1,083, 1,048 and 946 ms to 1,567, 1,527 and 1,090 ms. The cache-disabled original warm heap rise and the cache-enabled first-edit slowdown come from different requests and phases. Running full layouts before the edited input produced a different direction from seven cache hits before the same edit. [Raw phase observations](../benchmark/results)

## Recorded profiles

One additional paired first-edit profile took **607.59 ms for the control and 586.86 ms for the candidate**. The original three adverse first-edit replicas remain in the published comparison. This pair used the same seven original warm repeats and the real edit. Each compiled script used for source attribution matched the script accompanying its source map byte for byte. [Profile data and source bindings](dense-edit-profile.json)

| Sampled first-edit work | Control | Candidate |
| --- | ---: | ---: |
| V8 garbage collection | 17.299 ms | 17.383 ms |
| Any graph protected-paint owner in stack | 20.216 ms | 16.973 ms |
| Label settlement with protected-paint owner in stack | 7.540 ms | 5.922 ms |
| Final excursion closure with protected-paint owner in stack | 1.918 ms | 0.585 ms |
| Complete final excursion closure | 4.115 ms | 2.861 ms |
| Other graph layout, exclusive category | 365.643 ms | 346.277 ms |
| ELK, exclusive category | 71.162 ms | 71.911 ms |
| Scene/emission plus final scene proof, exclusive categories | 27.200 ms | 33.638 ms |

Inclusive paint and closure rows overlap. Inspector work accounted for about 35 and 33 ms in the wider profile windows. The source sampler covers the main JavaScript thread. Previously unprofiled GC, background compilation and system scheduling are possible contributors to the adverse measurement, with their individual contributions unresolved. [Profile grouping](dense-edit-profile.cjs)

## Allocation and lifetime in the measured candidate

The measured implementation retained a prepared entry for each admitted orthogonal route. Closing compared a newly allocated route signature and coordinates with the stored signature. Its prior map stayed reachable through the route refresh function while the final stage checked proposals and ran the full hitch audit. A rejected proposal could reuse the stored row again on restoration. The earlier version reused 276 initial rows and eight later restoration rows. The revised source consumes the carryover only during initialization and preserves 271 of those 284 initial row reuses. Five additional dense rows changed after their initial snapshot and are correctly recomputed. All 21 later proposal and restoration refreshes use the new phase’s own cache and payment, including immediately repeating a known point array. The three full SVGs and receipt objects match their originals. [Earlier implementation](paint-counts.json) · [Revised implementation](paint-counts-v2.json)

Two implementation reductions follow from that source. Compare live route coordinates with saved coordinates without allocating another temporary coordinate list. Record node signature fields after the node’s ordinary body reservation. These changes and earlier metadata release have distinct effects on allocation and custody. The earlier profiles do not establish the performance of a subsequent revision. [Existing coordinate comparison](/workspace/elk-layered-port/src/layout/route-marker-clearance.ts:177)

The original dense case had three preparations and only two final paint consumers. Its unconsumed projection still had 12 six-point excursion nominations before other guards rejected them. A cheap nomination check therefore cannot avoid that preparation. Repeating full crossing, marker and blocker proofs during label placement would introduce additional work. The one-million-unit phase allowance and the 128-edge cap bound a successful prepared roster to fewer than 3,710 route-signature elements and 768 node-signature elements, before array capacity and object overhead. Live ink contains other objects, and the harness retains other data. These element counts alone do not explain the observed 9.46 MiB warm heap change. [Dense structural trace](/tmp/issue619-kink-20261120/astra-history/profiling/counts-flowchart-multigraph24.json)
