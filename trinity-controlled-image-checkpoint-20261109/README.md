# Sized inline PNG delivery through the shared drawing path

Baseline c0099d8cebe2d88b31199ec8d67210b349ae558a, current source e387064d03db1b3e909d9e114aa8aae8dd040d01 (also recorded in ARCHIVE.json and campaign-state.json). Owner cutoff: 9 November, 20:00 UTC; old automations remain off. Existing draft PR602 only.

The existing frozen controlled-image fixture carries a valid opaque red 1×1 PNG, explicit 32×32 viewport, caption Icon and Art→Target. Before: ELK/Native return vector placeholders and proofP (actual-image criterion fails); Trinity refuses. The parser drops viewport semantics from its graph while the opaque serializer preserves the original source. This was a shared parser/measurement/emission defect, not a routing optimization.

Retain positive w/h and constraint in the typed model/serializer. A shared family content box reserves picture, caption and frame; retain its captionoffset in public label bounds. Emit a distinct typed `ImageMark`, never vector geometry or rawSVG. Actual values are revalidated on write; mutable/getter/CSS/definitions/occurrence isolation remain. Default/rough/hybrid keep raster bytes crisp. Admit only the explicitly sized rectangular inlinePNG contact to Trinity. Remote/unsupported media stays inert, no fetch/decoder/cache/cap/default/version change. Signature/Base64 admission does not prove decoded pixels. Imagepaint is explicitly unmeasured/U, viewport only supplies document containment. Strictreference policy permits only exact PNG href on unprefixed image; other references, handlers, namespaces and unsafe siblings retain rejection. Existing host backends without image claims retain ordinary rendering, and reject actual image use.

## Correctness

- Frozen 90:84 returns =81 byte-exact prior whole SVG/entire receipts +3 changed image/U products; same 6 invalid-option errors. Each solver returns 28/30: 27 proof-passed and 1 unverified. This is not broad workload equivalence or permission to open Replacement24.
- Public owner:all 3 solvers × 4 directions × 3 drawing looks(default,rough,hybrid), actual href, 32×48 viewport and contain fit, caption below picture, matching public label bounds, retained UTF16 labels, identities and endpoints, more than 900 actual opaque red pixels, deterministic wholeproducts. The different 32×48 viewport protects aspect-fit behavior; frozen literal remains 32×32.
- Before canonical Inter rasters have0 red pixels. After 3× actual frozen rasters have9025–9216red pixels LR and9025–9120TB, visible caption, Target and contact. Fonts manifest SHA verified, systemfonts off. Actual PNG files were inspected; these pixels do not become a raster proof certificate.
- Typed model and strict security owners reproduce red before fixes. Review found/fixed icon precedence and a global-essential custom backend compatibility regression. Actual-use host rejection separately red→green. Original failed logs retained.
-221 owning tests across 10 files, core/repository types and lint pass; one independent scope/security/authority review found no remaining supported blocker. Full suite runs in CI; preceding c009 exact-head CI completed/failure. No readiness claim.

## Equal-consumer costs

Existing profiler runner, fresh Node24, complete SVG + entire receipt serialized, imports/GC/compression separate.60 current image calls/unverified,2 replicas/cell, layout cache 0/1 separate.40 old/current ELK LR control calls/proof-passed,4 replicas/arm; exact before overrides from c009 for all changed runtime files. All 100 whole products exact within cases/across controls; 8 unique actual gzip9/Brotli11 streams decode exactly and match timed bytes. No timing ratio against old placeholder/refusal, no general, p95 or memory winner.

Current image LR ELK/Native/Trinity: area44804.08/44804.08/45485.79; written wire48/48/48.75; 0 bends/crossings. Actualimagebox increases ELK/Nativearea32393.93→44804.08; old placeholder did less work. Trinity area+1.52% andwire+1.56% vsELK are retained.

| Metric | ELK | Native | Trinity |
|---|---:|---:|---:|
| First target cache0 wall ms (import separate) |394.54|281.16|187.66|
| Uncached repeat2 wall / CPU ms |52.75/93.19|41.78/58.52|28.60/53.65|
| Original edit cache0 wall ms |40.57|34.97|21.92|
| Repeated edit cache0 wall ms |40.11|35.05|44.18|
| Cached repeat2 wall ms |11.02|6.29|5.13|
| Original edit cache1 wall ms |57.99|33.45|30.10|
| Repeated edit cache1 wall ms |28.74|16.84|19.54|
| API-return heap cache0 repeat2 MiB |47.09–47.31|36.90–36.91|36.26–36.30|
| Lifetime peak RSS cache0 repeat2 MiB |182.00–188.93|172.17–177.63|169.61–183.19|
| Full response gzip9 / Brotli11 bytes |2442/2105|2443/2107|2455/2118|

Ranges/samples remain in `COST-QUALIFICATION.json`; memory includes imports/harness/retained products, not isolated peak or settled retention. Cache0/1 only switches the existing layout cache; other derived caches remain. The unchanged LR control's edit CPU114.77→116.52ms and edit2 wall68.14→68.44ms are adverse; overlapping ranges, no general ratio.

Actual original 13-input lazy-browser product union, E/N/T: gzip860644/488886/482171; Brotli690694/419125/413060; requests44/50/51including binding. All lanes pass, +2288/+2353/+2351gzip,+1936/+1991/+1993Br,+1 request each vs c009. Separate controlled PNG actual-browser lanes: 3 pass. Compressed actual fetched bytes offline, not wire/startup; original portfolio and image supplement kept separate. Build first EPERM retained, exact esbuild retry passed. Existing distribution budgets remain failed and unraised; no giant standalone build.

## Remaining / next

Raster paint/alpha coverage stays unknown; remote images, intrinsic dimensions and nonrectangular media remainunsupported/inert. No general visual readability or retirement claim. Prior 613-criterion ledger remains dated, not silently rewritten. Sparse32 emitted proof, Native compound/halo losses, Trinity compound crossings and adverse costs remain. Stopped single-source permutation, full-halo and ER shortcuts are not replayed. Original 2dad baseline/equivalent Pele runtime unavailable; Replacement24 sealed.

Next: preserve the source/evidence on existing branches, then choose a sufficient demonstrated deficit. Do not spend another cycle replaying the same delivery roster as new progress.

Raw scripts, logs, final products, built assets and failed probes are retained in evidence.tar.gz. FILES.json records verified archive members and SHA256; ARCHIVE.json binds the runtime and archive. No local evidence was deleted.
