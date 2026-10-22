# Performance evidence and reproduction

PR #433's private recipe interpreter has been removed in favor of current
main's native typed drawing path; see the [disposition](../../docs/project/0.5-svg-pipeline.md).
The completed pre-removal campaign at `7035cdf0ea68725fc9958f455ebfb5ae3b0ce6c3`
failed: Node corpus time was 1.305× current main and browser time 1.223× current
main; fixed-a9 cache-off time was 1.116×. These measurements belong to that
revision. The requested historical baseline remains
**`a9d1551da27ddab542a1ae96329464ad65725448`**. Removing the interpreter restores
public compatibility and removes its code cost; exact-candidate runtime results
must be measured separately. The original performance objective remains unproven.

The routing and allocation observations retained below belong to the older
`67d47989` versus `30f0af5d` campaign. They keep their original SHA bindings and
are not new gains from the typed SVG pipeline. In particular, existing #431
admission, freezing, hashing, color-resolution and cache work is baseline work.

## Current campaign reproduction

Use Node 24.19.0, Bun 1.4.2 and npm 11.18.0. Start from a clean checkout, record
the exact candidate commit before building, and retain both source locks,
verified package manifests and installed runtime locks. HEAD below selects a
candidate for a new run; it does not make that moving ref a historical measured
candidate. Finish all builds and installs before the serialized measurement
window. Never combine absolute timings from different hosts or CI jobs.

~~~bash
set -euo pipefail
git diff --quiet
git diff --cached --quiet
test -z "$(git status --porcelain --untracked-files=all)"
fixed_sha=a9d1551da27ddab542a1ae96329464ad65725448
candidate_source="$(git rev-parse HEAD)"
candidate_out="$PWD/bench-report/$candidate_source"
mkdir -p "$candidate_out"
printf '%s\n' "$candidate_source" > "$candidate_out/candidate-source.txt"
node --version > "$candidate_out/node-version.txt"
bun --version > "$candidate_out/bun-version.txt"
npm --version > "$candidate_out/npm-version.txt"
bun install --frozen-lockfile
cp bun.lock "$candidate_out/candidate-source.bun.lock"
bun run build
bun run scripts/ci/verify-publish-package.ts --pack-destination "$candidate_out/candidate-artifact"
candidate_sha="$(jq -er '.sha256' "$candidate_out/candidate-artifact/package-manifest.json")"

fixed_workspace="$(mktemp -d /tmp/am-fixed-a9.XXXXXX)"
fixed_tree="$fixed_workspace/source"
fixed_pack="$fixed_workspace/package"
fixed_consumer="$fixed_workspace/consumer"
git fetch --no-tags origin "$fixed_sha"
git worktree add --detach "$fixed_tree" "$fixed_sha"
(
  cd "$fixed_tree"
  test "$(git rev-parse HEAD)" = "$fixed_sha"
  bun install --frozen-lockfile
  bun run build
  bun run scripts/ci/verify-publish-package.ts --pack-destination "$fixed_pack"
  git diff --exit-code
)
cp "$fixed_tree/bun.lock" "$candidate_out/baseline-source.bun.lock"
cp "$fixed_pack/package-manifest.json" "$candidate_out/baseline-package-manifest.json"
npm install --prefix "$fixed_consumer" --ignore-scripts --no-audit --no-fund "$fixed_pack/package.tgz"
cp "$fixed_consumer/package-lock.json" "$candidate_out/baseline-runtime.package-lock.json"
cp "$fixed_consumer/node_modules/.package-lock.json" "$candidate_out/baseline-runtime.installed-package-lock.json"
fixed_package="$fixed_consumer/node_modules/agentic-mermaid"

# Continue through requested populations while retaining every command status.
# A zero return from this recording helper is not a benchmark gate pass.
record_measurement() {
  local log="$1" status=0
  shift
  "$@" > "$log" 2>&1 || status=$?
  printf '%s\n' "$status" > "$log.exit-code"
  printf '%s: exit %s\n' "$log" "$status"
}

# Same installed baseline package and dependency tree on both sides.
record_measurement "$candidate_out/aa-command.log" \
  bun run bench:release --baseline "$fixed_package" --candidate "$fixed_package" \
  --elk-cache off --rounds 5 --reps 3 --budget-ms 1200000 --out "$candidate_out/aa"
for cache in off on; do
  record_measurement "$candidate_out/fixed-$cache-command.log" \
    bun run bench:release --baseline "$fixed_package" \
    --candidate-tarball "$candidate_out/candidate-artifact/package.tgz" --candidate-sha256 "$candidate_sha" \
    --elk-cache "$cache" --rounds 5 --reps 3 --budget-ms 1200000 \
    --out "$candidate_out/fixed-$cache"
  record_measurement "$candidate_out/peers-$cache-command.log" \
    bun run bench:peers --peers agentic,beautiful,zombie,pele \
    --candidate-tarball "$candidate_out/candidate-artifact/package.tgz" --candidate-sha256 "$candidate_sha" \
    --elk-cache "$cache" --rounds 5 --json "$candidate_out/peers-$cache.json" \
    --markdown "$candidate_out/peers-$cache.md"
done

# Source preservation is separate from packed timings, in both actual modes.
for assertions in 0 1; do
  record_measurement "$candidate_out/output-identity-assertions-$assertions.log" \
    env AGENTIC_MERMAID_ELK_CACHE=0 AGENTIC_MERMAID_SCENE_ASSERTIONS="$assertions" \
    bun run check:output-identity --baseline "$fixed_sha" --jobs 2 --show 8
done
~~~

Keep nonzero exit codes, unsupported inputs, timeouts and incomplete reports;
inspect each command's retained output and exit-code file. The recording helper
runs the requested populations without discarding earlier failures. The
fixed a9 package does not support every later enrolled family, so its A/A can
fail the unchanged scaling-success gate while still retaining its timing
observations. That failure is not a gate pass or permission to remove inputs.
Record any differences in source and resolved runtime dependencies. Preserve the
fixed worktree, tarballs and locks alongside the evidence until it is archived.

The benchmark harness sets Scene assertions off before starting production
workers. Source identity commands above run via "bun run", without the unit-test
preload. Canonical "bun test" deliberately loads fc-seed.preload.ts, which
forces assertions on; a shell variable alone does not prove an assertions-off
unit run. Such a run needs a separate preload/configuration and an executable
qualifier checking the live assertion mode and shared pinned fast-check seed.
Assertions-on and cache-on results remain separate populations.

Final all-ten-mode identity against a9, fixed-tool visual/decoded-pixel evidence,
packed Node/Bun/browser/CLI/MCP/PNG qualification and complete final CI remain
candidate-bound requirements. Upstream intentional output and family changes
must be separated from refactor differences, never hidden by updating a golden
or shrinking the corpus. Final packed startup/time/allocation/heap/RSS,
peer ratios and payload claims require fresh exact-artifact receipts. No current
performance win follows from the historical observations below.

For CI, run **Release benchmark** at the reviewed exact candidate ref with
fixed-baseline-sha set to the full a9 SHA above. Link the actual
release-fixed-benchmark candidate-SHA/attempt artifact and separately retain
the normal-release/browser job's artifact. A workflow recipe is not evidence
that the job ran or passed. Neither benchmark invocation publishes or deploys.

## Historical identities and decision rules: 19 October campaign

Everything from this table through the historical reproduction section retains
the older `67d47989`/`30f0af5d` scope. Its acceptance thresholds and observations
do not replace the current typed-pipeline campaign contract.

| Item | Historical campaign policy |
| --- | --- |
| Fixed post-#431 source baseline | `30f0af5d63e460c8bd3de88358414f2c7857a2c6`; never advance it to make a comparison pass. |
| Frozen production candidate | `67d47989ddb5ba7e391054d19378b7a0e7d946ef`; later documentation changes do not change this production scope. Bind actual pack SHA-256/SHA-512 integrity separately. |
| Runtime / machine | Node 24.19.0 workers, Bun 1.4.2 orchestrator; controlled local Linux x64, Intel Xeon Platinum 8573C, 5 logical CPUs with a 4-CPU quota. CI records its own machine; do not ratio absolute times across hosts/jobs. |
| Dependencies / artifacts | Source `bun.lock` git blob `1f4630d1149b9b62ee81cc980dbb8fa74e7625df` (unchanged); `bun run build` / `tsup.config.ts`, `tsup.browser.config.ts`, `tsup.browser-lazy.config.ts`; exact verified tarball manifest/checksum; installed npm root/hidden dependency locks beside raw receipts. CI pins npm 11.18.0; earlier local baseline used 11.9.0. Peer package pins do not pin floating transitive dependencies without retained locks. |
| Render policy | Scene assertions off for ordinary production timing; all `APL_*` unset in this campaign. Assertion-enabled unit validation is separate. Explicit `--elk-cache off` and `on` runs; default is off. Workers record effective flags. Browser APL environment is empty. |
| Peers | Beautiful Mermaid 1.1.3 and Pele 1.6.0; package integrity, dependency locks and adapter work in each report. [Population/provenance](../fork-graph/population.json), [functional scope](../../docs/comparison.md). |

Acceptance rules were declared before optimization: a latency claim requires a
paired median ratio below **0.90**, outside observed A/A variation, and a
separately launched confirmation; allocation requires **at least 5%**, reproduced.
A regression above 10% outside A/A variation needs review per family/large case.
Passing the unchanged release regression budgets does not establish a speed win.

Five-round identical-source A/A on twelve representative render/stage cases gave
median paired case ratios **0.953–1.040**; individual rounds ranged
**0.703–1.410**. Use complete paired rounds, not one favorable round. Exact-packed
A/A also observed about **2% RSS variation** and retained growth of **3,948,528 / 3,882,992 bytes**
(baseline/candidate, about 3.7 MiB each). Their difference was **65,536 bytes**;
one pair establishes no retained-heap noise floor, and no retained-memory win is claimed. These are this campaign's
noise observations, not universal tolerances. Older raw release metadata used
Bun's Node compatibility version; its real Node worker receipts record 24.19.0.

## Historical bounded findings, 19 October 2026

| Change / evidence scope | Reproduced observation | Limit |
| --- | --- | --- |
| Boolean route queries: preserve full certificate collection, stop existence queries at the first actual blocker | Two five-round source runs put mesh SVG paired latency ratios at 0.888 and 0.885; the latter compares directly with the pre-route predecessor. | Dense mesh witness, not every family or final packed throughput. Geometry predicates, order and evidence mode remain unchanged; no new cache. |
| First-party freeze: build diagnostic paths only when an existing error needs one | Five-round confirmation against the fixed baseline reduced allocation for sequence/class/ER SVG by **8.1% / 6.0% / 5.2%**. Exact diagnostics, limits, object identity and partial freezing remain. | Latency ratios about 0.97–1.02 are inconclusive. GC-boundary allocation is an estimate; the combined candidate includes the other accepted changes. Hostile external descriptor snapshots are untouched. |
| Node artifact compaction without identifier renaming | Syntax/whitespace compaction preserves callable export names; actual built/installed PNG checks supplement source identity. | Isolated compaction bytes/import probes are not final package/startup measurements. Report exact final tarball/entrypoint bytes and import plus first use in the PR. |
| Benchmark evidence | Packed candidate SHA/SRI verification, every peer output checked outside timing, durable incomplete/raw receipts and dependency locks; browser ratios require unique complete input/round cells. | Stronger measurement evidence is not renderer speed improvement. |

All **5,620** output-identity observations matched the fixed source baseline.
Focused first-party/hostile admission siblings passed **48 tests**; an independent
old/new graph/limit differential matched **160** outcomes, including error classes,
messages, reference topology and frozen state. These are bounded preservation
proofs, not all-source or all-viewer certification. Final combined package and
canonical gate receipts remain separate from the isolated experiments. An older
built-compaction probe toggled assertion variables after import and therefore
did not prove separate assertion modes; the final packed probe needs fresh
processes per mode. Existing source subprocess fidelity proof remains separate.

The fixed baseline peer run already showed substantial gaps: cache-off warm SVG
geometric mean peer/Agentic ratios were **0.165** for Beautiful (7 shared inputs)
and **0.00699** for Pele (8), roughly 6× and 143× faster respectively on that
small matched population. These are historical baseline observations, not final candidate
ratios. Absolute peer memory fields require both sides rerun through the same
enhanced final harness; the older raw reports remain intact. Beautiful rejected
C4 and lost labels in the terminal mesh; failures
remain in coverage counts and receive no successful speed ratio. Pele has no
native terminal API. Different output/edit/security contracts are disclosed,
not normalized into an invented equal-work benchmark.

## Historical reproduction with the existing tools

These commands reproduce the older comparison only when the candidate checkout
is exactly `67d47989ddb5ba7e391054d19378b7a0e7d946ef` and its original harness is
used. They are retained to explain the historical observations, not as current
HEAD/a9 qualification instructions. Use the current recipe above for new runs.

Finish builds/installs before a serialized measurement window. Use Node 24.19.0,
Bun 1.4.2 and the pinned publishing npm; retain source locks and install receipts.
The [release guide](../../docs/contributing/releasing.md#the-release-benchmark)
owns normal publication rules and the optional fixed-evidence CI setup.

```bash
bun install --frozen-lockfile
bun run build
bun run scripts/ci/verify-publish-package.ts --pack-destination "$PWD/release-artifact"
candidate_sha="$(jq -er '.sha256' release-artifact/package-manifest.json)"
# fixed_package: clean installed package from a verified pack built at exactly
# 30f0af5d63e460c8bd3de88358414f2c7857a2c6, using its frozen source lock.
for cache in off on; do
  bun run bench:release --baseline "$fixed_package" \
    --candidate-tarball release-artifact/package.tgz --candidate-sha256 "$candidate_sha" \
    --elk-cache "$cache" --rounds 5 --reps 3 --budget-ms 1200000 \
    --out "bench-report/fixed-$cache"
  bun run bench:peers --peers agentic,beautiful,pele \
    --candidate-tarball release-artifact/package.tgz --candidate-sha256 "$candidate_sha" \
    --elk-cache "$cache" --rounds 5 --json "bench-report/peers-$cache.json" \
    --markdown "bench-report/peers-$cache.md"
done
# Same installed baseline directory on both sides, fresh measurement workers.
bun run bench:release --baseline "$fixed_package" --candidate "$fixed_package" \
  --elk-cache off --rounds 3 --reps 3 --budget-ms 1200000 --out bench-report/aa
# Source-stage diagnostics; cache/assertions off, distinct from packed timings.
bun run bench:micro --runtime node --baseline 30f0af5d63e460c8bd3de88358414f2c7857a2c6 \
  --rounds 5 --json bench-report/micro.json
bun run check:output-identity --baseline 30f0af5d63e460c8bd3de88358414f2c7857a2c6
```

Run the existing **Release benchmark** workflow at the reviewed candidate ref
with optional `fixed-baseline-sha` set to the full fixed SHA. It keeps normal
release gates and adds a separate same-runner fixed/peer/profile evidence job.
The job summary links the actual `release-fixed-benchmark-<sha>-<attempt>` raw
artifact: reports, incremental worker samples, source/runtime locks, config,
verified package manifests and CPU profiles. Link that actual URL from the PR;
a recipe or a local directory is not proof that CI ran. Normal
`release-benchmark-<sha>` artifacts separately retain the advisory browser
scorecard. Neither workflow invocation publishes a package by itself.

Profiles run sequentially for installed fixed baseline and exact packed candidate
under a two-minute overall budget, using the existing release worker and eight
`MICRO_WORKLOADS`. Retained jobs/results describe import, first-render,
correctness/ASCII checks and eight SVG repetitions; they are **worker-wide** CPU
samples, distinct from SVG-only warm profiles. Never mix their attribution.

## Measurement limits and next opportunities

Peer validation captures batches of at most 64 returns, targeting about 1 MiB
at the first output size, and retains at most 1 Mi code units of validation
reuse. Output stores and per-batch clocks add measured overhead; native resvg
loads after first render. Validation/profiler boundaries are separate, but
whole-worker RSS includes this instrumentation and cannot be called pure
renderer retained memory. SVG parseability/labels do not prove arbitrary
connectivity, visual quality or semantic equivalence.

Absolute heap and peak RSS fields are required evidence: missing values fail
completion; production rendering APIs are untouched. Keep unsupported, lost-label,
render-error and missing counts. A missing or
failed requested measurement is incomplete evidence; an honestly completed
competitor refusal is a visible advisory outcome. Micro raw rounds expose
partial/missing evidence, but its existing partial-round ratio limitations make
it diagnostic rather than a release completeness oracle. Browser measurements
exclude paint, real-network latency and PNG throughput; JS gzip excludes
fonts/HTML/maps. No Beautiful browser distribution or missing peer output is
invented to fill a table.

Ordered opportunities remain hypotheses until their owner supplies complete
end-to-end evidence; `TODO.md` remains the only work queue:

| Order | Cost / owner | Required boundary |
| --- | --- | --- |
| 1 | Dense layout/routing: `elk-instance.ts`, `route-contracts.ts` | Preserve connectivity, obstacle/label clearance and certificates; distinguish ELK cost, our repairs and cache hits/misses/saturation. New algorithms require separate geometric/visual review. |
| 2 | Remaining Scene/string allocation: `scene/serialization.ts`, `graphical-render.ts` | Profile complete renders before combining representations or SVG passes; preserve final security and external admission. Tiny shell/font/CSS costs have limited total upside. |
| 3 | Startup/package/browser closure: build config and browser entry owners | Exact raw/gzip/Brotli and loaded request graph, installed consumers, callable names, import plus first use; shifted lazy work is not removed work. |
| 4 | Reuse/retention: resolved request, text measurement and ELK cache owners | Complete keys include host metrics and `APL_*`; freezing/shared identity changes matter. No speculative layout memo. A long-lived heap diff is still needed to diagnose historical growth; growth alone is not a leak. |

A weighted fixed-baseline profile attributed about 40% inclusive CPU to ELK,
12% to route contracts and 14% to lower/admit, with import/first use included.
These overlapping shares guide profiling, not warm-only per-family budgets.
Look-alike clamps/escapers have different edge contracts and should not be
merged merely by name. History also records lazy-ELK startup/first-render
tradeoffs and a rejected layout memo with incomplete process-state keys.

Test audit used OpenClaw revision
`16f1ef80f9d5a8322eec6e1e17652bd3f77d5068`
([skill](https://github.com/openclaw/openclaw/blob/16f1ef80f9d5a8322eec6e1e17652bd3f77d5068/.agents/skills/test-audit/SKILL.md),
[campaign](https://github.com/openclaw/openclaw/blob/16f1ef80f9d5a8322eec6e1e17652bd3f77d5068/.agents/skills/test-audit/CAMPAIGN.md),
[audit reference](https://github.com/openclaw/openclaw/blob/16f1ef80f9d5a8322eec6e1e17652bd3f77d5068/.agents/skills/test-audit/references/audit.md))
and was scoped to named high-risk owners/keepers, not all 503 baseline test files.
One String.replace-only font pseudo-proof was removed after the surviving real
Chromium computed-style test failed a production fixed-font mutation and passed
after restoration; all 14 static import/raster contracts remain. The integrated
benchmark keeper passed 19 tests / 139 assertions, including
correct-first/empty-later
and malformed-output controls; 18 first-party freeze cases also pass the old
owner and are preservation guards, not claimed bug fixes. Security, resource,
Unicode/style, serialization/mutation and public consumer keepers remain. CLI
registry/nonempty smoke is transport evidence, not native semantic
fidelity; local workerd probes cannot prove production CPU-limit enforcement.

Missing evidence must stay explicit: final packed candidate/peer results and
CI artifact URLs, cache saturation/miss workloads, any claimed final payload or
startup benefit, real-browser paint/network and PNG performance, arbitrary
semantic/visual fidelity, long-running retention, unrun platforms and real
production/workerd enforcement. Final validation receipts determine which gaps
close; source identity and isolated experiments do not close them automatically.

Historical records retain their original environment and conclusions:
[consumed 0.5 investigation](https://github.com/adewale/agentic-mermaid/blob/30f0af5d63e460c8bd3de88358414f2c7857a2c6/docs/project/0.5-performance-investigation.md),
[18 October peer/C4 observations](https://github.com/adewale/agentic-mermaid/blob/30f0af5d63e460c8bd3de88358414f2c7857a2c6/docs/comparison.md#fresh-performance-observations),
and [older macOS/Bun results](https://github.com/adewale/agentic-mermaid/blob/30f0af5d63e460c8bd3de88358414f2c7857a2c6/eval/benchmark/RESULTS.md).
