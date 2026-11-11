# Reproduce the frozen comparison

This is a reporting/collection packet, not production code. All inputs, provider
versions, artifact hashes and options are frozen in IDENTITY.json, CASES.json,
MEASUREMENT-CASES.json, FIDELITY-CASES.json and PLAN.json. Do not substitute a new
Main head into the existing results.

Sources: Main4260292397d4bca7624a30c34649eb943a5f8e0c and
PR599bee58db7cb54293866cc8aa86c887ef93e9a4. Trident is
f080278e31e4202ca89d524e4ee9e4cf3cbff038. Node24.19.0, Bun1.4.4.
The existing pinned Mermaid12.2 parser/reference dependency is used by Trident;
this is not a Mermaid12.2 renderer benchmark. Native's API backend name is agentic.

The retained worktrees are /tmp/pr449-bench-main-4260-20261110 and
/tmp/pr449-bench-pr-599b-20261110. They share the installed dependency directory
but retain each source package's configuration and actual public bundles. No
renderer is imported from TypeScript source in measured calls. Scoped owning
tsup configurations build only the needed public Node entries and browser-lazy;
these are not full npm-package artifacts. The first unsuccessful build attempt
and its corrected final builds remain in their named logs.

Build from each owning worktree with Bun:

```sh
bun /tmp/pr449-week-comparison-20261101/trident-main-20261110/build-node.ts /tmp/pr449-bench-main-4260-20261110
bun /tmp/pr449-week-comparison-20261101/trident-main-20261110/build-browser.ts /tmp/pr449-bench-main-4260-20261110
bun /tmp/pr449-week-comparison-20261101/trident-main-20261110/build-node.ts /tmp/pr449-bench-pr-599b-20261110
bun /tmp/pr449-week-comparison-20261101/trident-main-20261110/build-browser.ts /tmp/pr449-bench-pr-599b-20261110
```

Finish builds before recapturing final identity, and run browser qualification
before Node clocks. The browser/fidelity collectors and their exact commands,
products, closure manifests, fonts and closed-browser markers are retained.
The kit directory is the existing Trident portable execution kit, not a new
benchmark or conformance implementation. Source and kit hashes are recorded.

For a new replay, use a new evidence output directory; do not overwrite this
packet or append another invocation to its results.jsonl. If recovering on a
different machine, map the absolute source/tool/dependency roots in collector
files to the recovered checkout paths and record that change separately. Each
job JSON names its exact source, options, artifact, phase and replica.

Run with no concurrent build, browser, profiler or other benchmark. Node public
SVG observations use unchanged Trident runSerialJob and runFirstUseBatch.
Cold imports prepare behind its existing idle barrier; API calls serialize.
Both backends have fallback:none; cache0 and cache1 are separate runs. The
controller sets the required reference path and layout-cache environment.

```sh
MERMAID_REFERENCE_DIR=/tmp/pr449-main-integration-20261029-762 bun performance.ts
bun receipt-performance.ts
bun calibrate-results.ts
python reduce.py
```

Run these commands from the recovered packet directory. The receipt controller
requires the completed Trident marker, so its clocks never overlap Trident.
The receipt worker uses plain Node with --expose-gc and the built public index.
It serializes the full response once inside the measured clock and retains
receipt evidence afterward. Compression, explicit GC and artifact writes are
outside API clocks. It creates no sampling session for this benchmark. Process
RSS still includes import, harness, GC and retained evidence/compression.

The failed missing-reference-path setup is preserved separately; it produced
no valid renderer measurements. The two receipt smoke directories validate the
collector and are excluded from comparative observations. The earlier smoke
used extra receipt serialization and enabled an inspector session; the final
measurement worker does neither. Do not combine them into timing medians.

CALIBRATION.json uses the pinned Trident statistics without rendering again.
This bounded run is below full5round/31warm/20cold calibration. Report observed
medians and process spread; pooled warm p95 is a percentile of adaptive batch
means, not a single-call latency tail. Warm alternating edits revisit two
sources. In the full-receipt collector, edit1 is first edited input; edit2–4
repeat it. Some edits change identities as well as displayed labels.

Do not combine strict owned linear wire/crossings with browser approximate
curve lengths, turn unavailable contacts into zeros, or infer deeper meaning
from the eight family/labels-only supplements. Whole-SVG equality, receipt proof
availability, independent authored meaning and actual browser ink are separate
observations. The lost original12 grouped fixtures are not in this packet.
