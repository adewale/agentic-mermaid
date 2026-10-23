# Reachability evidence runners

These runners compare the public output of two **built, packed** revisions. The
Node screen includes complete SVG encoding and receipt serialization. The browser
comparison reuses the maintained release owners and checks complete SVG/receipt
identity separately from timing. Neither replaces the maintained release,
consumer, payload or security gates.

Run from the repository root. Keep all generated packages, receipts and results
under ignored `bench-report/` or outside the repository. Do not commit them.
Timing and allocation workers run serially; finish builds, tests and other
benchmarks before starting them.

## Prepare the artifacts

The recorded reproduction toolchain is Node **24.20.0**, Bun **1.4.2** and npm
**11.18.0**. Put those executables first in PATH and verify their versions.
Chromium is the browser installed for this checkout's locked Playwright version;
install it with `bunx playwright install chromium` if needed. Other platforms or
runtimes produce separately identified evidence, not a replay of these numbers.
The acquisition inspector currently uses OS/CPU applicability for optional
packages; Linux libc-specific optional dependencies require separate inspection.

Replace `BASE_REF` with the desired existing base ref. The candidate is the clean
checkout's HEAD. Build outputs must come from those exact revisions; source SHAs
are supplied by the caller and are not inferred from the tarball.

```sh
baseline_revision=$(git rev-parse BASE_REF)
candidate_revision=$(git rev-parse HEAD)
repo_root=$PWD
evidence_root="$repo_root/bench-report/reachability"
mkdir -p "$evidence_root/artifacts/baseline" "$evidence_root/artifacts/candidate"
git worktree add --detach "$evidence_root/base" "$baseline_revision"
bun install --frozen-lockfile
ln -s "$repo_root/node_modules" "$evidence_root/base/node_modules"
(cd "$evidence_root/base" && bun run build)
bun run build
(cd "$evidence_root/base" && npm pack --ignore-scripts --json --pack-destination "$evidence_root/artifacts/baseline") > "$evidence_root/artifacts/baseline/pack.json"
npm pack --ignore-scripts --json --pack-destination "$evidence_root/artifacts/candidate" > "$evidence_root/artifacts/candidate/pack.json"
```

Both revisions use one installed dependency tree. Stop if their production
requirements or lock graphs differ; this protocol does not attribute dependency
changes to the helper. Keep that installation unchanged during the measurements.
This setup uses native resvg dependencies already installed by Bun; it does not
claim two independent fresh registry installations.

Normalize the pack filenames, extract them, and point both extracted packages at
the frozen dependency installation:

```sh
node --input-type=module - "$evidence_root" "$repo_root/node_modules" <<'JS'
import { readFileSync, renameSync, symlinkSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
const [root, dependencies] = process.argv.slice(2)
for (const role of ['baseline', 'candidate']) {
  const directory = join(root, 'artifacts', role)
  const [packed] = JSON.parse(readFileSync(join(directory, 'pack.json'), 'utf8'))
  renameSync(join(directory, packed.filename), join(directory, 'package.tgz'))
  execFileSync('tar', ['-xzf', join(directory, 'package.tgz'), '-C', directory])
  symlinkSync(dependencies, join(directory, 'package', 'node_modules'), 'dir')
}
JS
node eval/benchmark/reachability/acquisition.mjs \
  --baseline "$evidence_root/artifacts/baseline" --baseline-sha "$baseline_revision" \
  --candidate "$evidence_root/artifacts/candidate" --candidate-sha "$candidate_revision" \
  --lock "$repo_root/bun.lock" --out "$evidence_root/acquisition.json"
```

Acquisition requires all six arguments. Each artifact directory must contain
`package.tgz` and its extracted `package/`. It compares every extracted file with
an independent extraction and compares the complete host-active installed
production dependency closure. It records archive SHA-256/SHA-512 and installed
dependency file inventories. Dependency integrity strings come from the frozen
lock; dependency registry archives are not downloaded again.

## Packed Node measurements

Create a configuration outside tracked source, for example
`bench-report/reachability/screen-config.json`:

```json
{
  "acquisitionPath": "bench-report/reachability/acquisition.json",
  "featurePolicy": "default",
  "settings": {
    "rounds": 7,
    "aaRounds": 3,
    "samples": 5,
    "allocationSamples": 1,
    "warmupCalls": 2,
    "warmupMs": 80,
    "regimes": ["repeat", "new-source"],
    "workerTimeoutMs": 1200000
  }
}
```

Paths resolve from the invocation's working directory. `node` optionally selects
an explicit Node executable; otherwise the runner uses its current executable.
Artifact/source identities default to the acquisition receipt. Optional
`baseline`/`candidate` overrides must match that receipt exactly.

```sh
node eval/benchmark/reachability/run.mjs \
  --config bench-report/reachability/screen-config.json \
  --out bench-report/reachability/public-screen
```

The default minimum-duration warmup can execute different numbers of calls in
the two arms. Preserve those counts and the original screen. To confirm small
controls under matched populations, create a **new** configuration/output with
`warmupCalls: 20`, `warmupMs: 0`, and this top-level selection:

```json
{
  "caseIds": [
    "empty", "zero-edge-one-node", "sparse8", "branch-feedback50",
    "nested", "sequence20-negative-control"
  ]
}
```

Add those fields to a copy of the complete screen configuration. The selection
uses the original fixture definitions and produces 22 rows per worker; both
configurations use 80 serial workers. No second runner or copied fixture table is
needed. Freeze each configuration before execution, identify confirmations
separately, and never pool their samples or replace adverse original results.
The large-chain screen remains separate; equal per-row warmup counts do not rule
out carryover from earlier rows.

Read [protocol.md](protocol.md) for cache policies, matched tokens, A/A pairing,
allocation limits and preregistered diagnostics. New-source tokens change visible
labels rather than comments. Output/receipt hashes cover every measured sample.
Allocation is a GC-boundary V8 estimate, excluding external typed-array backing
stores, native/WASM allocation, peak memory and retained memory.

## Browser integration

Run cache policies separately, after Node workers finish:

```sh
bun eval/benchmark/reachability/browser-compare.ts \
  --acquisition bench-report/reachability/acquisition.json \
  --out bench-report/reachability/browser-cache-off --elk-cache off
bun eval/benchmark/reachability/browser-compare.ts \
  --acquisition bench-report/reachability/acquisition.json \
  --out bench-report/reachability/browser-cache-on --elk-cache on
```

`--repo` optionally selects the checkout providing the maintained browser owners;
it defaults to this runner's repository. `--executable` optionally selects
Chromium; otherwise Playwright's installed executable is used. Three paired
rounds warm and render the full maintained official corpus in fresh documents,
with alternating engine order. The separate untimed oracle compares full SVG
bytes and complete serialized receipts for shared successful inputs. Optional
`--memory-passes N` enables the maintained browser memory diagnostics, defaulting
to zero. Browser timing covers SVG return only and is advisory; the packed Node
screen supplies consumed-receipt timing. Unsupported cases and failures remain
visible, and lost baseline successes fail the comparison.

## Public analysis supplement

The public `agentic-mermaid/agent` surface also exposes analysis without ELK or
SVG rendering. This separate bounded supplement calls `analyzeMermaidSource`
(including source parsing and its Result wrapper) and `analyzeMermaid` on one
publicly parsed object. Complete returned JSON and its UTF-8 encoding are inside
timing. It makes no SVG or allocation claim and cannot erase adverse rendering
observations. Sources come from the same `fixtures.mjs` definitions.

Create `bench-report/reachability/analysis-config.json`:

```json
{
  "acquisitionPath": "bench-report/reachability/acquisition.json",
  "runtimes": { "node": "node", "bun": "bun" },
  "cases": [
    { "id": "empty", "batch": 1000 },
    { "id": "sparse8", "batch": 200 },
    { "id": "branch-feedback50", "batch": 50 },
    { "id": "chain-feedback150", "batch": 20 },
    { "id": "chain-feedback400", "batch": 10 }
  ],
  "warmupCalls": 20,
  "samples": 5
}
```

```sh
node eval/benchmark/reachability/analysis-probe.mjs \
  bench-report/reachability/analysis-config.json \
  bench-report/reachability/public-analysis
```

The runner requires those exact five cases, batch counts, twenty warmups, five
samples and both pinned runtimes. Seven paired rounds and three interleaved A/A
pairs per runtime produce forty serial workers. Read
[analysis-protocol.md](analysis-protocol.md): complete before/after and final-batch
hashes are checked outside clocks; interior calls are consumed but not individually
hashed. Keep this output separate from the rendering screens.

## Qualification and reporting

Archive generated outputs with their exact revisions and tarball identities.
The runners copy configuration, acquisition receipts and runner sources into the
output; they hash shipped/fetched bytes rather than their own source files or
fixture definitions. Keep adverse observations and refusals. A timing diagnostic
is not an automatic merge decision.

Run the maintained `bench:release`, browser release/peer checks, consumer checks
and unchanged payload gates according to their owners. A focused screen cannot
stand in for these. Record which complete artifact passed, which failed, and any
remaining qualification or evidence-distribution limits in the PR description.
