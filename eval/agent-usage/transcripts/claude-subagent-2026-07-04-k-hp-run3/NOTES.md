# Run notes

Arm: `--surface homepage` (right-altitude prompt), knowledge-proof
cases, k-hp-run3 of 3. Result: 2/2, safePathRate 1.0 — agents ran the real
loop (typed mutations, canonical serializeMermaid output confirmed as a
fixed point; opaque input correctly declared `source-level fallback`
after asSequence returned null). Together with the k-none-* arms this
is the first measured taskOk delta between surfaces: none 3/6 vs
homepage 6/6 across three paired runs.
