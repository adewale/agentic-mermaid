# Focused Class128 supplement: independent review

Read-only inspection of README, OBSERVATIONS, both official SUMMARY files and
collector source. No tests, builds, profiles, timings or source edits performed.
**No parity, causal speedup or stable-effect overclaim found.**

The README accurately distinguishes its two estimators:233.80/225.45ms are
medians across15process medians;241.84/221.08ms are the official replica-B sample
aggregates. It retains the Native298.90ms process median, overlapping ranges,
adverse central observation and exact saved-output/artifact bindings. It does
not turn those facts into either parity or an optimization gain.

All four warm rows are calibrated under the existing *per-lane* rules. Missing
first-use workers keep each full summary uncalibrated; no cold/memory
qualification is supplied. A/A control bands diagnose each backend/options lane
and are correctly not presented as a Native-versus-ELK effect test. These results
do not establish that the initial fixed11%difference is a stable effect, nor do
they establish that no difference exists.

One summary-field caveat is worth preserving when citing machine results:
`cases[0].acceptanceMatches:false` follows Trident's `timingComplete` condition,
which includes the missing cold identities. It is not evidence that these warm
calls rejected input. The raw warm workers have no failed/blocked statuses and
remain partial semantic qualification. Do not silently rewrite the official
field; explain its whole-protocol scope if quoted.

The ten saved SVGs match the original timed product, and all hashes shown in
OBSERVATIONS coincide across these two backends. That binds the observed output;
it does not identify a solver-specific cause or prove complete paint fidelity.
The public SVG-only boundary, cache1 setting and explicitly selected adverse
case remain appropriately scoped. No new implementation work is justified by
this supplement alone; a future causal investigation can retain these timings
as bounded evidence without requiring an all-green Trident score.
