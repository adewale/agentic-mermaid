# Independent current/Main measurement review

This fills a measurement gap; no source change or optimization was made.
The reviewed grid compares pristine Main
`a2e5ddc927e7432affbc293b7996a74b5fe59003` with published
`4cddae30548df1adf0ea1908c88454fae3bcb36d`, using their already qualified SDKs,
the same four retained inputs and edits, both graph backends, and three fresh
Node 24.19 processes per cell. SDK entry/package, worker, driver and input hashes
match the declared plan. All four whole case objects match the retained inputs.

The exclusive run completed 48 workers and 432 calls with no lifecycle or
render refusal. Import is separate. Each render clock includes the public
receipt API, serialization of the entire returned object and UTF8 byte counting.
Artifact encoding/compression and explicit GC are outside those clocks. Cold,
repeat1–4, first edit and repeat-edit2–4 remain distinct. Cache0 denotes the ELK
cache setting, not all internal caches disabled. `SCENE_ASSERTIONS=0` matches the
unset production default and the existing protocol; mandatory capture, emitted
output checks and certification caps remain active. Sampling and timed observers
are disabled. No build, browser, stock timing or new profile ran.

Full repeated-response milliseconds, median of three process medians:

| Input | Native Main → current | ELK Main → current |
|---|---:|---:|
| Chain100 | 77.22 → 117.68 | 167.02 → 212.74 |
| Fan-in100 | 121.42 → 171.96 | 345.35 → 380.54 |
| Chain300 | 192.90 → 266.11 | 411.57 → 521.24 |
| LR compound identity | 33.04 → 27.12 | 44.63 → 53.09 |

The independent reduction agrees with all 960 shared summary fields in the
primary reduction. All phase medians/minima/maxima, CPU, import, response bytes,
RSS and heap observations remain in the retained JSON. The exact current ELK
fan median is 380.54468899999995 ms; 380.54 is the correct two-decimal display.
These are exploratory three-process observations, not formal calibration or an
attribution of cost to one patch.

Current Native Chain100 process medians are 113.15–123.26 ms versus Main's
74.15–77.88 ms; this run does not meet the 100 ms full-response target. All eight
cold-render medians and repeated-response RSS medians increase. First-edit and
repeat-edit medians increase in seven cells; Native LR identity is the exception.
That input has changed geometry and lower repeated cost, but its cold median
increases 126.92→140.20 ms, repeated at-return RSS 106.36→110.42 MiB and heap
19.50→25.91 MiB. At-return heap is not retained-after-GC memory, and process RSS
includes the harness/import/artifact work. Native Chain300's repeated at-return
heap is the sole lower heap cell; that does not remove its other adverse costs.
Import variability, including the first Main Chain100 process's 328.19 ms, is
retained rather than discarded.

All 432 saved SVG/entire-receipt products reconstruct to the exact UTF8 length
counted inside the clock. Among 216 Main/current pairs, 189 SVGs and 189 receipts
with only certification removed are exact; all 27 SVG differences belong to
Native LR identity. No entire receipt is equal across versions. All 336
within-worker repeat products and 288 same-phase cross-process products are
exact. The primary response-compression procedure was inspected: it compresses
32 unique measured full responses outside timing. Those bytes are not browser
application-download payloads or transport measurements.

Main has 216 passed receipts. Current has 162 passed and 54 unverified receipts,
the latter all Chain300 on both backends. The Chain300 SVGs remain exact, while
Main completes its proof at 344168/343986 operations and current exhausts the
unchanged 400000-operation cap. Both retain 899 measured regions, 300 prepared
texts and 902 primitives; current reports 586/525 conditional primitives and
does not reach marker/occlusion-pair checks. This is a proof-availability loss,
not a demonstrated changed drawing. Equal-output timing is still actual request
cost, but unequal completed proof and changed identity geometry preclude an
equal-work or behavior-preserving causal speedup claim.

Review disposition: accept the fresh measurement/reporting evidence with these
adverse cells and limits. Source remains unchanged; all timing workers closed,
with no rerun. This fresh note contains no old blocked profile or audit content.
