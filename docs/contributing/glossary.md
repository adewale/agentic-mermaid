# Glossary

Terms this repository uses with a narrower meaning than their everyday one.
Each entry names where the idea lives in code, so a reader can check the
definition against the implementation.

| Term | Meaning here | Where |
| --- | --- | --- |
| **Admission** | Turning caller-supplied data (render options, family config, extension payloads) into an immutable snapshot after checking it against fixed budgets: node and character counts, depth, JSON validity. Anything later in the pipeline reads the admitted snapshot, never the caller's object. "Admitted" means it passed. | `src/render-contract.ts` (`admitRenderOptionsInput`, `captureFamilyData`) |
| **Receipt** | The structured record a `…WithReceipt` render returns beside its output: the resolved request, capability decisions, request digests, layout certification and diagnostics. It describes what was rendered and why; it is not a log. | `RenderRequestReceipt` in `src/render-contract.ts` |
| **Digest** | A hash of an admitted request (`requestDigest`, `sharedRequestDigest`) that identifies it across outputs and caches. | `src/render-contract.ts` |
| **Certification** | A bounded check of the drawn geometry (overlaps, label occlusion, routes through group headers) with an explicit coverage report. "Passed" means no issue was found within the stated limits, not that the drawing looks good. | `src/layout/certification.ts`, [layout certification](../layout-certification.md) |
| **Custody** | Which code owns a mutable value at a given moment. A custody walk copies or freezes data at an ownership boundary, so a caller mutating its own object cannot change a cached or shared one. | `src/experimental/position-cache.ts`, `src/scene/` |
| **Witness** | An executable example that demonstrates a claimed capability. Capability discovery reports `native` only when that capability's witness passed. | `src/scene/backend-conformance.ts`, family conformance tests |
| **Structured or opaque** | A parsed diagram body is either typed (structured: it can be described and edited by operations) or preserved verbatim (opaque: rendered and round-tripped, but not editable by operation). Some families mix the two by **segment**. | `src/agent/types.ts`, [mutation policy](../agent-mutation-policy.md) |
| **Segment** | A contiguous run of a body that is typed or kept verbatim on its own, so one unmodelled construct does not make the whole diagram opaque. | sequence, ER and Gantt parsers |
| **Owned family** | A built-in family whose parser and layout producer live in this repository, as opposed to an extension registered at runtime. Several caches apply only to owned families, because their producers are known not to retain or mutate shared data. | `src/experimental/owned-family.ts` |
| **Routing revision** / **style-registry revision** | Counters bumped whenever the family registry or the style registry changes. Memos key on them, so a registration invalidates every result computed under the previous registry. | `src/agent/family-router.ts`, `src/scene/style-registry.ts` |
| **Probation** | A small tier of the layout cache where a new layout waits while the cache is full, so a long rotation of new diagrams cannot evict every entry before it is reused. | `src/experimental/position-cache.ts` |
| **Divergence** | A deliberate difference from Mermaid's behaviour, recorded with its reason. A divergence is not a backlog item. | [Divergences](../project/divergences.md) |
| **Portable** | Output that external Mermaid 12.2.0 reads with the same meaning. Typed edits only write portable source. | `CLAUDE.md` ("Write strictly, read generously") |
