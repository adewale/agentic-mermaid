# Standalone editor: remove duplicated complete notice texts

Source **3f2c26bd860eadcfb48746eabb45801ab8e07c7a**; baseline **7834513e894fadf61da913c699b3a94ed6f104d4**. Renderer/runtime implementation remains **4db8570d389246bb5f1eede8c5b1899fe6cd687e**. Existing draft PR602 only. Deadline9 November2026 at20:00UTC; bounded run, old automations off, no continuous execution claim.

## Demonstrated deficit and causal ceiling

The retained actual standalone HTML is1,342,694gzip bytes against the original1,334,500 ceiling:8,194bytes over. Existing artifact/metafile inspection finds complete Apache-2.0 (11,358bytes) and Brotli-MIT (1,337bytes) texts repeated across codec and worker notice producers. No removable required renderer/decoder/config/conformance payload is demonstrated; live duplicate realm consumers are not deleted.

Before changing production, `notice-ceiling.ts` removes only the second exact complete text copies from a distinct retained HTML candidate. Matching Bun1.4.4 gzip9/Brotli11 reproduces baseline sizes and shows a partial ceiling:12,695raw/4,240gzip/798Brotli bytes saved, leaving3,954gzip bytes over. The original is unchanged; this diagnostic is not a shipping legal presentation or a budget pass.

## Implementation and retained contracts

One formatter deduplicates exact complete text strings across both current producers. The editor supplies one fresh Set for one synchronously assembled HTML notice block; independent helper calls still start fresh. Collection, actual-comment parsing, input/file/package/ancestry limits and the worker notice byte budget remain in their original owners before formatting. No fuzzy/substring/license-clause normalization. Script-closing escaping still happens on emitted strings. This is an emission accumulator, not a cross-request render cache.

All distinct package/version/copyright/modification attribution and one complete copy of every distinct license remain. The existing owner test now checks combined producers, retained comments without promoting inert string content, script escaping, exact full license occurrences, attribution and fresh output. Reverting only the old producer yields1failed owner; candidate scoped codec/notice owners13pass/0fail. Core/repository types, lint and actual editor build pass. Independent read-only review found no blocker. Default/version/cap and renderer behavior remain unchanged.

## Actual complete-file bytes

| Matched Bun1.4.4 | Raw HTML | Gzip9 | Brotli11 |
| --- | ---: | ---: | ---: |
| Before |2,124,144|1,342,694|1,282,743|
| Actual rebuilt candidate |2,111,445|1,338,451|1,281,956|
| Saving |12,699|4,243|787|

**Original gzip cap still fails3,951bytes.** Actual output differs slightly from the offline body-only ceiling because formatting also removes separators. The full before/after canonical gzip/Brotli byte files, hashes and runtime/zlib identity are retained in `editor-build/CANONICAL-FILES.json`; this is actual compression of shipped bytes, not compressed network transfer or startup latency.

## Artifact ownership and equivalence

`ACTUAL-BYTE-QUALIFICATION.json` verifies:

- Every byte of the actual HTML outside the inert notice contents is identical.
- The facade script (296,058bytes including surrounding newlines) and packed worker carrier (1,574,202bytes) are byte-exact, with recorded SHA256 values.
- All637 distinct nonblank original notice lines remain.
- Every previously emitted complete maintained license/notice file remains intact; Apache/Brotli-MIT full text each changes2copies→1.

The unchanged executable payload includes the same renderer, decoder, checksums, budgets, UI, fallback and backend selection. No new diagram/ink correctness or runtime speed/memory improvement is claimed. Existing three-layout delivery/quality/cold/cache/edit/RSS/heap/lazy metrics remain bound to their recorded runtime. Replaying them would be validation, not progress. No screenshot is needed for an inert text-block change; current Class and fan-in images remain separate evidence for their runtime revisions.

Build status/wall/RSS counters are retained but not compared as a build-speed result; typing/lint work overlapped this acquisition. Peak memory, DOM retention and application startup were not measured here. No giant full package build or manual CI dispatch was used.

## Remaining losses and decision

Retain ELK and draft status. Trinity27/30 frozen returns versus Native/ELK28 are delivery/proof counts, not universal correctness: the controlled-image row remains unsupported for Trinity and fails actual-image emission in both returned controls. Broader capacity/quality, adverse fan-in crossings, Sparse32, lazy/website/editor budgets and current-head CI readiness remain. Replacement24 stays sealed. Original2dad and equivalent pinned Pele runtime remain unavailable.

The current measured4,243-byte reduction is partial and does not justify deleting live validators, required features, attribution or safety limits to make the remaining budget zero. The next demonstrated geometry candidate is the measured-header/padding mismatch identified from actual TB fan-in output; it needs its own causal trial before any implementation.

## Reproduction and recovery

Existing owning test: `bun test --timeout 30000 src/__tests__/verified-preview.test.ts -t 'standalone|codec'`. `editor-build/build.py` runs the existing production editor build with matching environment; `compress.ts` and `retain-canonical.ts` use the existing canonical Bun compression settings. `verify-notice-bytes.py` compares actual before/after artifacts and retained attribution. Expected complete license data comes from maintained input files; measurements are not source-tree fingerprints.

Raw artifacts, offline ceiling, actual output, byte checks, source candidate, red/green logs, review, type/lint/build logs and scripts remain in the verified archive. Source and meaningful recovery checkpoints are pushed to the existing branches. No retained evidence deletion, new PR/issues, external messages/comments or release/publication.

Raw scripts, logs, final products, built assets and failed probes are retained in evidence.tar.gz. FILES.json records verified archive members and SHA256; ARCHIVE.json binds the runtime and archive. No local evidence was deleted.
