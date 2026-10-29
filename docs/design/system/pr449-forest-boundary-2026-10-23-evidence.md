# Forest boundary evidence

[Scorecard](pr449-forest-boundary-2026-10-23.md) · [Archive](pr449-forest-boundary-2026-10-23-evidence.json.gz) · [Verifier](pr449-forest-boundary-2026-10-23-verify.mjs) · [Index](pr449-forest-boundary-2026-10-23-evidence-index.json) · [Exclusions](pr449-forest-boundary-2026-10-23-exclusions.json) · [Independent archive readback](pr449-forest-boundary-2026-10-23-archive-verification.json)

The first archive assembly is 9,556,773 bytes, SHA256 43b248973232ba74ee1c16b5373daf626121b60e3e9f08760ef0a64e5c45a4cf. Its 2,163 original path entries reference 1,096 SHA-addressed objects: 66,253,488 unique decoded bytes, representing 113,653,537 original path bytes and 1,067 duplicate paths. UTF8 and binary objects retain exact original bytes; binary V8 payloads use base64. Gzip metadata is deterministic.

The archive includes all 1,101 retained actual proof files and the original baseline comparison closure: 300 ordinary rows and 1,500 full-value/four-UTF8 descriptors, plus 60 complete host packets. It also includes browser packets and request records, source/protocol/preparation/owning/independent evidence, build and delivery logs, and the first failed browser attempt. Original paths inside JSON are identifiers for the archive's path index; the verifier does not open those filesystem paths.

With the pinned Node24.19 runtime, from this directory:

    node pr449-forest-boundary-2026-10-23-verify.mjs pr449-forest-boundary-2026-10-23-evidence.json.gz

The verifier imports only Node builtins. It checks every object/path hash, all raw inventory entries and all referenced original/candidate payloads. It reproduces 300 ordinary full-value comparisons, 1,200 UTF8 pairs, 60 host comparisons, 120 browser full-value pairs, 232 browser UTF8 pairs and two fresh-context fault restorations. It also checks that the original browser assessment failed and the corrected one passed. A separate parent invocation reproduced that result using only the archive, with zero original filesystem payload reads and zero renderer/browser imports.

Six whole opaque runtime/tool objects are excluded, with complete inventories in the exclusions companion and archive. Compiled distributions, dependencies, Node/Chromium and their runtime acquisition are not silently represented by sampled bytes. The 136 first-built files are retained as complete hash inventories, not embedded binaries. This packet reproduces captured evidence; rebuilding source on another path is not a claim of identical generated distribution bytes.

The forest evidence does not qualify CPU, memory, raster paint, Firefox/WebKit, internal deferred-event counts or the unobserved implicit forest→ELK fallback. See the scorecard for those limits and for the separately failed timing/RSS studies. Their failures are not changed by this successful payload archive verification.
