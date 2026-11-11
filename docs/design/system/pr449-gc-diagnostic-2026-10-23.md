# PR449: locating memory growth without inventing a memory win

The four fresh instrumented first-pass sessions completed all 300 original public SVG/full-receipt calls. The owning readback passes 2,602 offline checks; an independent audit passes 34,495. All 600 clock-anchor endpoints and 608 memory snapshots are retained. This diagnostic locates windows for closer profiling. It does not qualify performance, memory savings, an allocating owner, a leak or the cause of the earlier failed controls.

| Observation | Follow-up question | Limit |
|---|---|---|
| Requirement100 raises the sampled cumulative highwater in all four sessions | Which layout, certificate or SVG/receipt objects dominate this operation? | A window is not an allocating function; whole-process history affects the increment |
| Native cyclic11 and cyclic19 show large highwater increments | Can route contexts, candidate geometry or validation objects be reused or omitted? | Correlation does not establish which object caused the peak |
| Later DAG inputs have large positive and negative heap deltas | How do temporary route structures interact with natural collection? | Bookend differences are not allocated bytes or settled retention |
| All 317 recognized Minor/Major GC pairs retain heap-before/after fields | Which source-level owners warrant a separate bounded allocation profile? | Selected trace spans are not removable CPU or a complete background-GC history |

For example, native/OFF DAG seed2076 records a 24.625 MiB highwater increase while current heapUsed falls 69.286 MiB. Its separate API envelope overlaps 18,159 microseconds of selected main-thread GC. This illustrates why a process highwater and an end-of-window used-heap counter answer different questions; it does not explain an allocation owner or repair an older A/A failure.

Each of native OFF, ELK OFF, ELK NORMAL and native NORMAL runs the original ordered 75 inputs once. There is no forced GC, keepalive, prewarm, retry or A/A replication. Tracing, snapshots, console calls, checksums and ledgers have unmeasured observer overhead. Memory queries run sequentially, not atomically. Buffer/object liveness is engine-dependent; arrayBuffers is already included in external. Neither signed counter differences nor GC heap fields measure allocated traffic. Final sampled SELF is not necessarily the process-exit lifetime peak.

Clock admission uses the source-defined console async anchors and hrtime brackets with the frozen one-microsecond allowance. No stdout-order, UserTiming or older-clock fallback is used. An independent endpoint sweep reproduces all 300 GC-window unions exactly. Twenty-seven recognized pairs lie outside the API windows; no pair overlaps multiple windows. No background intervals occur in the selected categories, which does not prove the absence of background collection. All unsupported/unknown arrays and signed negative deltas remain explicit.

## Portable selected evidence

- [Archive](https://raw.githubusercontent.com/adewale/agentic-mermaid/a6b9b14161bd281804d5f2c9149320dfd882eb0f/docs/design/system/pr449-gc-diagnostic-2026-10-23-evidence.json.gz), **1,435,837 bytes**, SHA-256 `cdbc4039be11245549e9fb20ca8432b02a106e520a9e2419b2386179937fcba7`.
- [Exact evidence index](https://github.com/adewale/agentic-mermaid/blob/a6b9b14161bd281804d5f2c9149320dfd882eb0f/docs/design/system/pr449-gc-diagnostic-2026-10-23-evidence-index.json), [whole-object exclusions](https://github.com/adewale/agentic-mermaid/blob/a6b9b14161bd281804d5f2c9149320dfd882eb0f/docs/design/system/pr449-gc-diagnostic-2026-10-23-exclusions.json), [verifier](pr449-gc-diagnostic-2026-10-23-verify.py) and [root verification](https://github.com/adewale/agentic-mermaid/blob/a6b9b14161bd281804d5f2c9149320dfd882eb0f/docs/design/system/pr449-gc-diagnostic-2026-10-23-archive-verification.json).

The first assembly fits its 16 MiB compressed / 64 MiB unique-content limits: 232 complete original paths, 164 unique objects, 68 duplicate paths and 10,933,382 unique decoded bytes. All 34 actual raw files are included, with four complete traces, complete calls/journals/results, frozen methods, reader, controller, owning/independent reviews and preserved preparation/reviewer failures. The full 737-file/13-link/89-directory runtime is excluded whole with an exact cross-reference to the [forest baseline inventory](https://github.com/adewale/agentic-mermaid/blob/a6b9b14161bd281804d5f2c9149320dfd882eb0f/docs/design/system/pr449-forest-boundary-2026-10-23-evidence.md); pinned Node/Python binaries are separately inventoried. This is not a standalone live replay environment.

From this directory, run the archive-only verifier with a fresh output destination:

[Replay commands and raw data are retained in the original snapshot.](https://github.com/adewale/agentic-mermaid/blob/a6b9b14161bd281804d5f2c9149320dfd882eb0f/docs/design/system/pr449-gc-diagnostic-2026-10-23.md)

It checks every retained hash/length, all four complete journals, 300 calls, 600 actual anchor endpoints and 608 snapshots. It does not execute the original reader or recalculate clock associations/GC unions, import product code, or run a renderer, controller, browser or measurement. The earlier [RSS and hosted timing controls](pr449-controls-2026-10-23.md) remain failed and separate.
