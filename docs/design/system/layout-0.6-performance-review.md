# Performance review at the integrated PR602 checkpoint

Source: `99ed1d23853661966448ee9ee47c560cab910e63`, after integrating main
`f9ec8c115de14020d3c182d5d7f2e7e70bfcdefb`. This is a report before any performance
rewrite. The private-point sealing repair was a reproduced correctness fix.

## Measurement scope

The existing Node24.19.0 collector ran six fresh processes: Class128 TB with
Native/ELK and cache 0/1, plus the enrolled nonlinear forest with both backends
and cache 0. Each process performed one complete unprofiled warmup, then two
profiled repeats and a caption/text edit: **six warmups and 18 profiled calls**.
Every call returned with passed certification. Repeats matched the warmup's whole
SVG and entire receipt; edits changed the product. This does not qualify Sparse32.

Timed calls consume the complete SVG and receipt. Imports, artifact writes,
compression and explicit GC are outside those windows. Warmup/import/cold latency
was not timed by this collector. These are instrumented source-runtime samples,
not package-consumer benchmarks; inspector, observers and JIT/GC affect them.

## Five largest sampled Native source spots

The ranking below uses six Class128 Native calls, spanning both cache settings.
Self is sampled leaf presence; inclusive includes descendant stack presence and
overlaps other rows. Values are **elapsed sample-delta weights per call, not
exclusive CPU durations or removable time**. The existing analyzer selects active
`consume` intervals and reports 1/2/5ms sensitivity; these are diagnostics, not
acceptance gates. All five retain their order across those views. Fifth place
nearly ties marker-polygon preparation at 5ms (8.867 vs 8.866ms).

| Spot and source location | Self / inclusive ms per call | Matching case and next causal question | Expected speedup |
| --- | ---: | --- | --- |
| `visit`, `src/scene/scene-data-snapshot.ts:98` | 147.9 / 170.8 | None/data-oriented: reflective capture, alias/cycle handling, limits and publication. Investigate whether the producer can provide already-owned immutable admission data. The earlier descriptor-Map attribution remains withdrawn. | Unmeasured; no sufficient subtraction demonstrated. |
| `validateNode`, `src/scene/scene-validation-core.ts:724` | 23.3 / 85.1 | None/data-oriented: semantic admission reads identities, ownership, resources and diagnostics. First establish a redundant traversal of the same owned data before changing the representation. | Unmeasured; the validation obligations remain necessary. |
| `certifyNativePaint`, `src/scene/paint-certification.ts:1432` | 16.3 / 86.5 | None/data-oriented: the broad frame already contains spatial indexes and immutable batches. Identify the expensive primitive/interaction before proposing SoA or subtracting geometry work. | Unmeasured; this frame does not isolate an avoidable numeric loop. |
| Marker `include`, `src/scene/bounds.ts:358` (encoding at 373) | 12.6 / 18.6 | None/data-oriented: resource data is serialized with each occurrence's pose. A narrow candidate is producer-owned resource encoding while keeping pose, transform and live-caller behavior per occurrence. | Unmeasured; test the encoding's contribution first. |
| `boundedUtf8ByteLength`, `src/shared/utf8.ts:4` | 8.9 / 8.9 | None/data-oriented: length rejection and an ASCII fast path already exist. Establish whether the same authoritative bytes are rescanned before considering producer byte accounting. Preserve ceilings and surrogate semantics. | Unmeasured; no duplicate scan has been established. |

There is no measured hot hash lookup that justifies replacing the alias/descriptor
tables with flat arrays, no demonstrated one-field pass that justifies SoA, and no
independent sequential awaits in these synchronous rendering frames. A Map inside
a hot function does not identify which work consumed the time. Packed indices
would need their own bounded-domain evidence. No cache is added by this review.

## Existing caches and what they can hide

This inventory covers the reviewed rendering paths, not every hosted service,
transport, font loader or PNG surface.

| Cache group | Existing caches / owning files | Evidence and flag |
| --- | --- | --- |
| Layout and completed products | Positioned layouts and Native drawings (`experimental/position-cache.ts`); Native measured solver and strategy choices (`layout/agentic-producer-core.ts`); ELK results (`elk-instance.ts`); positioned Scene/native drawing/certificate associations (`scene/positioned.ts`). | Class cache-1 repeats hit the positioned-layout cache in both backends, hiding layout production from those repeat samples. That does not prove the miss path has a slow design. Completed-drawing/solver/strategy caches can mask their miss work; no full-drawing hit occurred in these Class calls. |
| Text and numeric derivations | Display plans (`shared/display-text.ts`), pixel blocks (`shared/prepared-text.ts`), host measurements (`text-measurement-profile.ts`), label blocks (`scene/bounds.ts`), Native text copy plans (`scene/native-paint-emission.ts`), numeric/attribute spellings (`shared/svg-number.ts`). | Derived-data reuse; no measured cache defect or justified replacement follows from the five frames. |
| Appearance and route derivations | Resolved palettes (`theme.ts`), fill ink (`color-resolver.ts`), routing profiles (`shape-outline.ts`), deferred terminal projections (`scene/deferred-terminal-projection.ts`). | No causal slow-design finding in this run. |
| Admission, writing and inspection | Capability decisions (`render-contract.ts`, `scene/backend.ts`), SVG inspections (`svg-inspection-cache.ts`), immutable serialization (`scene/serialization.ts`), XML validation/projected facts (`scene/svg-writer.ts`), resolved SVG styles (`scene/resolve-svg.ts`). | Preserve ownership and mutable-input isolation. Scene paint certification missed in all Class phases, so its measured work was not hidden by a certificate hit. |

Call-local alias maps, spatial indexes and provenance WeakMaps also exist. They
are not interchangeable with cross-request render-result caches. The observed
positioned-layout hits skip production work; the snapshot/validation/certification
spots above remain active. A redesign needs an uncached causal comparison.

## Fully consumed observations and adverse costs

Each triplet is repeat 1 / repeat 2 / edit. Process CPU includes all process threads
and may exceed wall time. These single samples support no performance ratio.

| Workload / backend / cache | Wall ms | Process CPU ms | Peak RSS KiB |
| --- | --- | --- | ---: |
| Class128 / Native / 0 | 807 / 573 / 660 | 1,368 / 1,033 / 1,337 | 308,180 |
| Class128 / Native / 1 | 612 / 596 / **2,393** | 961 / 1,001 / **3,871** | 307,632 |
| Class128 / ELK / 0 | 854 / 909 / 1,039 | 1,506 / 2,191 / 1,786 | 330,060 |
| Class128 / ELK / 1 | 516 / 570 / 796 | 830 / 851 / 1,338 | 325,584 |
| Forest / Native / 0 | 80 / 97 / 85 | 119 / 150 / 120 | 201,472 |
| Forest / ELK / 0 | 120 / 95 / 161 | 172 / 161 / 214 | 222,820 |

The adverse Native cache-1 edit has 1,477.80ms in long active-sample gaps excluded
by the 2ms view, including a 623.38ms gap. Those intervals cannot be assigned to a
Map, cache, wait or source frame from this evidence. Raw heap counters are retained
per phase; that edit's heapUsed was 64,137,424→90,982,216 bytes. Retained products,
source maps and profiler data make this an unsuitable leak experiment.

Offline compression uses Node24 `node:zlib`, gzip level 9 and Brotli quality 11:

| Original-source SVG | Raw / gzip9 / Brotli11 bytes |
| --- | ---: |
| Class128 Native and ELK | 189,921 / 13,063 / 7,555 |
| Forest Native | 8,027 / 1,462 / 1,233 |
| Forest ELK | 8,069 / 1,482 / 1,229 |

These are SVG payloads. The integrated shipped JS/module payloads and cold/cache/
edit costs without profiling still need separate qualification. CI already reports
real bundle/website budget failures; existing ceilings are unchanged.

Both fresh forest SVGs are byte-identical to their retained reference products,
binding the existing meaning/ink observations after integration. Native area
165,355.6575 and wire 463.4375 remain versus ELK 176,727.21 and 396.469666666:
area −6.43%, wire +16.89%, both eight bends. This is validation, not a new gain.

Evidence is retained under `performance-review-main-integration` in the campaign
week directory and the resumed GitHub evidence checkpoint. No performance rewrite
has been applied. The next causal work remains forest placement/terminal seating;
the profile's narrow resource-encoding hypothesis can be tested separately.
