# Releasing `agentic-mermaid` to npm

The package is published by [`.github/workflows/publish.yml`](../../.github/workflows/publish.yml),
which triggers on a **published GitHub Release**. The workflow requires a
successful canonical `ci.yml` run for the exact release commit. Its required
independent semantic lane checks the pinned Mermaid parser/DB; failure, cancellation
or non-execution blocks `CI complete` and publication. CI owns tests,
dependency/palette/sketch/whole-corpus quality, TypeScript and Biome checks,
browser contracts, `hero:check`, `website:check`, golden drift,
and packed-consumer fuzzing under Node 24 and the minimum supported
Node 22. `bun run lint:package` runs publint and attw on the packed tarball, so
every export resolves and carries types for Node ESM and bundlers. attw uses its
`esm-only` profile because the package ships ESM only, and it skips `./browser`
because that is the classic `<script>` bundle that sets a global, not an import.
The release workflow retains the registry-derived macOS/Windows smoke and
owns the publish boundary: an unprivileged job builds once, creates a real
tarball with the pinned publishing npm, compares its contents with the
reviewed fail-closed manifest, records its integrity and SHA-256 digest, and
uploads that immutable artifact under a fixed filename. The
[release benchmark](#the-release-benchmark) installs and measures that exact
tarball against the previous npm release before publication. A minimal OIDC job
requires the closed three-file artifact set, binds the manifest to the checksum
and tarball bytes, then publishes that exact `.tgz` with lifecycle scripts disabled.
There is no manual `npm publish` step. After npm succeeds, a separate minimal
OIDC job extracts [`server.json`](../../server.json) from the same verified
tarball and publishes it to the official MCP Registry. Before publishing, and
after any ambiguous publish failure, that job queries the registry's exact
name-and-version endpoint. It accepts an existing immutable version only when
the publisher-owned `.server` object is structurally identical to the extracted
`server.json` and the Registry's mutable official status is `active`; other
registry-owned `_meta` fields do not participate in the server comparison.
Absence means publish, while a mismatch, inactive record, or malformed response fails closed
immediately — those are answers about the record, so retrying them only delays
the same verdict. An unreachable or unexpectedly-responding Registry carries no
verdict, so preflight retries it over the same bounded backoff before failing
closed, and a transient outage no longer blocks an otherwise-publishable
release. All of this happens before credentials are requested. Keeping that step
separate, with the verified artifact retained for 30 days, lets a failed
registry publication be retried without attempting to republish an immutable
npm version.

Publishing uses **npm OIDC trusted publishing** — no `NPM_TOKEN` secret. The
workflow grants `permissions: id-token: write` only to the two final registry
jobs. Validation, checked-out release code, platform smoke, dependency
installation, build, and package inspection cannot mint a token. npm verifies
the final job token against the trusted-publisher config, and **provenance is
generated automatically** (no `--provenance` flag).

## Preconditions (one-time, before the first release)

- **Register the trusted publisher on npmjs.com.** On the (first-time: create the
  placeholder package, or use the org's package settings) package's
  Settings → Publishing access → "Add trusted publisher" → GitHub Actions, set:
  organization/user `adewale`, repository `agentic-mermaid`, workflow filename
  `publish.yml` (leave environment blank). This must be done before the first
  `npm publish` or it fails with an auth error.
- **The GitHub repo must be public.** Provenance writes to a public transparency
  log and is **not** generated for private repos. If the repo must stay private,
  publishing works but without provenance.
- **Three-way repository match.** The OIDC token's repo, the npmjs.com
  trusted-publisher config, and `package.json#repository.url`
  (`git+https://github.com/adewale/agentic-mermaid.git`) must all agree — they do.
- **Account 2FA** on the publishing account (WebAuthn/FIDO; TOTP is being
  deprecated).
- `npm view agentic-mermaid version` — confirm the version isn't already
  published (first release: expect a 404).

The workflow pins Node 24, npm 11.18.0, and every action that executes in an
OIDC-capable job to immutable commits (trusted publishing needs npm ≥ 11.5.1 /
Node ≥ 22.14). npm 11.18.0 already bundles its Sigstore dependency tree; the
workflow installs no mutable provenance helper. The unprivileged release gate
also rejects a release whose tag, checked-out commit, `origin/main` ancestry,
package version, or MCP server versions disagree. After artifact construction,
the minimal npm job accepts an existing immutable version only when its registry
integrity is byte-identical to the verified tarball; a mismatch fails closed.
The MCP job applies the same immutable-publication rule to metadata through the
exact `/v0.1/servers/{name}/versions/{version}` identity endpoint and exact
structural equality with the verified `server.json`.

The MCP publisher stays pinned to v1.7.9 and its reviewed checksum. During the
recovery implementation, the digest-verified v1.7.9 binary and then-latest
v1.8.0 binary were measured separately: both expose only
`mcp-publisher publish [server.json]`, with no idempotency key, verify-if-present
mode, or recovery flag. v1.8.0's release notes contain no publication-recovery
change, so an unrelated binary upgrade would add risk without removing the
client-side exact-identity check.

## Cutting a release

1. **Land everything on `main` green.** Releases are cut from `main`.
   `publish.yml` refuses to publish unless canonical CI succeeded for that exact
   immutable SHA; it does not duplicate the same source gates under a second
   event with different setup and drift risk.
2. **Bump the package and MCP server versions together.** Update `version` in
   `package.json`, `PACKAGE_VERSION` in `src/version.ts`, the top-level `version` in `server.json`, and
   `packages[0].version` in `server.json`. The readiness tests require an exact
   match. Generated surfaces such as `llms.txt` and `am capabilities` read the
   runtime-safe `PACKAGE_VERSION`, so no additional generated-file edit is needed.
3. **Roll the changelog.** Retitle `## Unreleased` in
   [`CHANGELOG.md`](../../CHANGELOG.md) to `## <version> — <YYYY-MM-DD>` and open a
   fresh empty `## Unreleased` above it.
4. **Flip the "published" copy** (see below), commit via PR, and merge to `main`.
5. **Create the GitHub Release** on the merge commit (tag `v<version>`). Its
   publication fires `publish.yml`, which gates, builds, benchmarks, publishes
   to npm, and then publishes the matching server metadata to the MCP Registry.
   The benchmark job has a 105-minute limit and a 70-minute measurement budget;
   npm publication waits for it. You do not
   need to remember this step: once the merge's CI passes, the deploy finds the
   version missing from npm and opens a **release to-do** issue that
   @mentions you, labelled `release-todo`, titled
   `Publish v<version>: production still serves v<previous>`. Its link opens
   the new-release form with the tag, the target commit and the title
   `Agentic Mermaid v<version>` filled in, plus the version's `CHANGELOG.md`
   section as notes when that fits in a URL. Check the notes and publish. If
   `main` has moved on since the issue opened, set the target to the current
   `main` commit once its CI is green, because the deploy ships only the
   current `main` commit.
6. **Verify:** `npm view agentic-mermaid version` shows the new version;
   if npm committed the immutable version before the workflow recorded success,
   rerun it—the publish job recovers only after the registry's SHA-512 integrity
   matches the retained verified tarball exactly. Then
   `npm install agentic-mermaid` into a scratch project resolves and its bins
   run. The MCP job likewise recovers a response-lost publish only when the
   exact-version record's `.server` object equals the extracted `server.json`.
   Finally,
   `curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.adewale/agentic-mermaid"`
   returns the matching server and version. The official registry is still in
   preview, so verify its record after every release.
7. **After the first publish,** set the package on npmjs.com to
   "Require two-factor authentication and disallow tokens" — trusted publishing
   keeps working, and token-based publishing is locked out.

### Between the version bump and the publish

The site deploys only published bytes:
[`deploy-cloudflare.yml`](../../.github/workflows/deploy-cloudflare.yml) builds
from the exact npm package, so while `package.json` names a version that is not
on npm, every deploy run skips with a warning and ends green, and production
keeps serving its previous build. That gap is expected between steps 4 and 5.
(0.4.2 was bumped on 2026-08-03 and not published, and production stayed on
0.4.1 for eight weeks while every deploy run was green.)

The deploy job turns that gap into a release to-do
([`scripts/ci/release-todo.ts`](../../scripts/ci/release-todo.ts)), so it
notifies you once instead of failing pushes or nagging daily:

- **When a version is first found missing from npm,** the skip opens one
  `release-todo` issue for it (step 5). That is the only notification for that
  version.
- **Later skips for the same version write nothing:** no comment, no edit and
  no new issue, even if you closed the issue by hand. A newer unpublished
  version gets its own issue.
- **When a deploy of that version or a later one is promoted and verified,**
  the deploy closes the issue with a one-line comment.
- **The run's outcome never changes.** A skip stays green, and a GitHub API
  error while opening or closing the issue is a warning. The steps run inside
  the existing deploy job with `issues: write`; there is no schedule and no
  extra job.

To check what production actually serves, run the freshness check by hand,
for example after a release or whenever deploys look stale. It makes one
read-only GET to `https://agentic-mermaid.dev/capabilities.json` and reads
local git history:

```bash
git fetch origin main
bun run scripts/ci/production-freshness.ts --deployable-sha "$(git rev-parse origin/main)" --max-drift-days 3
```

It compares the build production reports (`generatedFrom.gitSha`) with the
given `main` commit, and fails once `main` has held undeployed commits for more
than three days. If the pending version is not on npm, publish it (steps 5 and
6); the publish run triggers the deploy. If that version is already on npm, the
deploy itself is failing: read the latest "Deploy website to Cloudflare" run.
The check never deploys or publishes.

### The release benchmark

[`release-benchmark.yml`](../../.github/workflows/release-benchmark.yml) runs
after packaging and before publication. It verifies the downloaded artifact's
SHA-256 and integrity, then installs the publication tarball in an isolated
directory with lifecycle scripts disabled. The baseline is installed separately
from npm's `latest` tag, normally the previous release. That selector is resolved
once to an exact version and integrity in `baseline.json`, persisted as a
workflow-run artifact **before** measurement. Retries restore that identity;
they do not resolve `latest` again. If the artifact has expired, start an
on-demand run naming the previous version explicitly. Reports record the
candidate tarball digest and the baseline's resolved version and integrity so
the comparison identifies the bytes measured.

The Node benchmark renders distinct examples from the policy's reviewed official
syntax pages and generated large diagrams in alternating fresh processes on one
runner. Existing example IDs remain stable. `corpus.json` separately inventories
every fence occurrence across all vendored syntax pages, including duplicates
and the mixed `examples.md` page: upstream version/commit, fetched document
hashes, source lines, occurrence-to-release-example IDs, distinct and occurrence
counts, and why a page is outside the Node release population. The browser
scorecard uses the full occurrence inventory without exclusions. Every native family
has an explicit scaling workload; the family type makes new enrollment mandatory. SVG rendering owns
the timing and memory measurements; SVG and ASCII both receive correctness
checks. It fails the run on:

- a lost SVG or ASCII render, output that does not repeat byte for byte, or a
  newly invalid SVG that resvg cannot parse;
- a candidate that does not finish an input within its time budget, an exhausted
  overall measurement budget, or missing required baseline/candidate observations;
- a failed scaling or agent workload, including one the baseline cannot render;
- missing expected visible SVG labels on enrolled scaling/agent workloads;
- corpus render time above 1.25× the baseline, or any compared family or large
  case above 1.5×;
- corpus allocation or peak RSS above 1.25×, or retained heap growth above
  16 MB per pass.

Changed SVGs are counted per family but never fail a release: releases are
allowed to change output. Determinism compares repeated renders within each
process and across measurement rounds. Relative timing and memory comparisons
use the same stable, parseable SVG inputs in both engines; rejections and newly
supported inputs do not enter the ratios. Their process RSS includes import,
warm-up and measurement in a worker restricted to that matched population. The
absolute retained-heap gate covers the candidate's full successful corpus,
including newly supported inputs. Heap peaks are estimates sampled at GC
boundaries, and retained growth covers one settled pass. A comparison with no
matched successful SVG observations fails; when the corpus is selected, it must
contribute matched observations too.

Timing sums each matched rep before taking its within-process median; ratios
pair the same round before taking their median. Reports retain per-round totals,
p50/p95/max call latencies for the matched population, and the ten largest
candidate time contributors. Percentiles describe examples/repeats, not confidence
intervals. Correctness passes warm the complete selected corpus before timing.
The agent workload performs parse → typed edit → verify → serialize → re-parse
→ fact checks → SVG render, checking the requested change and preserved original
facts. Visible-label checks inspect emitted text outside the timer; neither
those checks nor resvg prove arbitrary diagram fidelity.

Production measurements explicitly disable Scene assertions. The default
`--elk-cache off` measures rendering work; repeat separately with `--elk-cache on`
for default production behavior, including key generation, clones, misses and
bounded retention. Repeated-input cache hits do not establish distinct-input
speed. Reports record the effective policy and `APL_*` flags; assertion-enabled
correctness checks run separately. Use built or verified packed artifacts for
startup, package and consumer claims.

#### Advisory browser and competitor scorecard

After the Node gate, the workflow independently installs the same verified
candidate tarball, the persisted baseline, **Pele 1.6.0**, and **Mermaid 12.2.0**.
It records package integrity, candidate tarball SHA-256, Chromium version and
measurement policy. No competitor dependency is added to the runtime package.

In one Chromium tab, with engine order reversed on alternate rounds, each engine
warms the complete selected corpus before timed public SVG calls. Coverage keeps
all fence occurrences; speed ratios use only inputs that return SVG in every
round in both engines. Failures retain their messages and are grouped as
unsupported, remote-asset/environment, or other render errors. Remote requests
are blocked; asset failures remain in the denominator. SVG acceptance does not
claim semantic or visual fidelity, and the timing excludes browser paint.

`browser-report.md` and `.json` show absolute acceptance, paired competitor and
baseline ratios, complete monolithic gzip bytes, and actual JS requests/bytes
through the lazy loader and the first flowchart for candidate and baseline.
These use the installed package, complementing the existing build/PR payload
budgets. Cold lazy timings include localhost module fetches; they are not a
network-transfer benchmark. Raw calls are in `browser-samples.jsonl`. This
scorecard has a 12-minute workflow budget and is advisory: a competitor gap or
scorecard setup failure does not block publication.

The job summary and the `release-benchmark-<sha>` artifact hold `report.md`,
`report.json`, `corpus.json`, `browser-report.*`, and incremental raw measurements
in `samples.jsonl` and `browser-samples.jsonl`. Child time
budgets are capped by the remaining overall budget, leaving time to write and
upload the report on failure. To see a comparison locally after `bun run build`:

```bash
bun run bench:release --baseline-npm latest            # about 20-30 minutes
bun run bench:release --baseline-npm latest --rounds 1 --reps 1   # quick look
```

It can also be run on demand from the Actions tab (**Release benchmark**,
with any npm version or tag as the baseline). An on-demand run builds and
verifies its own tarball before benchmarking it. To measure a local tarball
instead of the repository build:

```bash
candidate_sha="$(jq -r .sha256 release-artifact/package-manifest.json)"
bun run bench:release --candidate-tarball release-artifact/package.tgz --candidate-sha256 "$candidate_sha" --baseline-npm latest
```

Local npm comparisons also reuse `<out>/baseline.json`; use a new output directory
or remove that lock intentionally to resolve a selector again. An explicit
`--baseline-lock path/to/baseline.json` shares the workflow's persisted identity.
To run the browser scorecard after packing, install Chromium once with
`bunx playwright install chromium`, then:

```bash
candidate_sha="$(jq -r .sha256 release-artifact/package-manifest.json)"
bun run bench:release:browser --candidate-tarball release-artifact/package.tgz --candidate-sha256 "$candidate_sha" --baseline-lock bench-report/baseline.json
```

Browser probes support `--rounds 1`, `--case <occurrence-id,...>` from
`corpus.json`, and `--executable /path/to/chromium` for a system installation.
Selected probes report their subset denominator explicitly.

For a bounded local probe, select a case and cap the measurement budget:

```bash
bun run bench:release --baseline-npm latest --case sequence:20-participants-300-messages --rounds 1 --reps 1 --budget-ms 60000
```

For a refactor campaign, the optional `fixed-baseline-sha` workflow input adds a
separate runner that rebuilds one full immutable source SHA and verifies its
packed installation. It compares that baseline with the **same candidate tarball**
using cache off and on, runs exact-package A/A, pinned Beautiful Mermaid/Pele
comparisons, and sequential CPU profiles. All comparisons within that job share
one runner; never combine absolute timings from the normal and fixed jobs.
The `release-fixed-benchmark-<sha>-<attempt>` artifact retains commands, package
identities, exact dependency locks, profiles, fingerprints and raw observations.
Incomplete requested evidence fails after artifact upload. Peer performance is
advisory; missing peer measurements are incomplete evidence. Neither job publishes
or deploys. Current findings and noise thresholds live in
[`eval/benchmark/RESULTS.md`](../../eval/benchmark/RESULTS.md).

#### When the benchmark fails

A failure stops npm and MCP Registry publication; the GitHub Release and its
tag already exist. Read the failing gate in the job summary first.

- **Runner noise:** a timing ratio just past its limit with no change that
  could explain it. Re-run the failed jobs once; publication uses the retained
  package artifact after the benchmark passes.
- **A real regression:** fix it on `main` through a PR. The version is not on
  npm yet, so you do not need a new version: delete the GitHub Release and the
  `v<version>` tag, then create the release again on the fixed `main` commit
  once its CI is green. The release gate requires the tag to point at the
  released commit.
- **An intended trade-off** (for example, a correctness fix that costs time):
  change the threshold in `GATES` in
  [`eval/benchmark/release-bench.ts`](../../eval/benchmark/release-bench.ts)
  through a PR that says why, then re-release as above.

Re-running `publish.yml` restores the original baseline artifact. A matching
version number alone still does not prove identical bytes: both consumers check
the persisted integrity. Use an explicit previous npm version in a new on-demand
run when that comparison is needed.

### Optional visual review

For releases with visual changes, inspect the affected renders at native size.
This review is advisory and does not block package publication. Never invent
reviewer identity, duration, or findings.

## The "published" flip

Before the first npm publish, the repo deliberately said *"not yet published;
install from source"*. The 0.1.0 release-prep PR flips these surfaces to the
published copy:

- **Website** — the install card is generated by [`website/build.ts`](../../website/build.ts)
  (run via `bun run website`, deployed to Cloudflare Workers with `wrangler` via
  [`.github/workflows/deploy-cloudflare.yml`](../../.github/workflows/deploy-cloudflare.yml)).
  The default release build shows `npm i agentic-mermaid`; use
  `SITE_NPM_STATUS=source` or `SITE_NPM_PUBLISHED=0` only for pre-publish source
  install previews.
- **README** — npm-install-first [Installation](../../README.md#installation)
  copy and the `Published on npm as agentic-mermaid` status line.
- **`docs/getting-started.md`** — `npm install agentic-mermaid` is the primary
  Install block.
