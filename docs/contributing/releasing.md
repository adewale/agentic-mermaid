# Releasing `agentic-mermaid`

Release from `main` after canonical CI passes for the exact commit. Publication
uses [the release workflow](../../.github/workflows/publish.yml); production
promotion uses [the deployment workflow](../../.github/workflows/deploy-cloudflare.yml).
Source preparation, npm availability, MCP Registry publication and production
identity are separate facts. The [release record](../project/archive/releases.md)
links their proofs for completed releases.

## Release checklist

1. **Prepare the source version.** Choose `release_version`, then run
   `bun run release:prepare "$release_version"`. This updates the package, runtime
   and MCP versions together and runs the existing browser-family, doc-block
   and agent-document generators. Without `--date`, notes stay under Unreleased.
   The command prints changed paths. It performs no Git writes, network requests,
   publication or issue creation; a generation failure restores the original files.
2. **Reconcile current docs.** Follow [doc consistency](doc-consistency.md).
   Check current README/user/agent guidance, website facts, tool inventories,
   limits, commands, links and the active backlog against their owning code.
   Generate facts with `bun run doc-blocks`; retain dated research measurements
   as historical evidence. Inspect affected renders for visual releases.
3. **Finalize the notes.** For example, run
   `bun run release:prepare "$release_version" --date "$release_date"` with
   the intended version and date (`YYYY-MM-DD`). This rolls Unreleased into a dated section, opens a fresh Unreleased,
   and refreshes the generated API version paragraph. Review the resulting diff.
4. **Land the reviewed change and finish CI.** Use the authorized repository
   workflow. Require full canonical `ci.yml` qualification on the final main SHA;
   a green documentation-only run is insufficient. If scope routing skipped runtime
   checks, dispatch `ci.yml` on `main` to qualify that exact commit. Recheck main
   before tagging. Semantic, browser, packed-consumer, type and quality gates remain
   required. Benchmarks run separately and do not authorize publication.
5. **Publish the GitHub Release.** Use tag `v<version>` on that exact validated
   commit. This explicitly starts the publication workflow. It runs macOS Intel
   and Windows rendering contracts, builds and verifies one tarball, publishes
   those exact bytes to npm, then publishes its `server.json` to the MCP Registry.
6. **Confirm publication.** Follow the publication workflow to completion. It
   waits for public npm metadata matching the retained tarball's exact version
   and SHA-512 integrity before registering with MCP. Temporary absence or network
   failures retry within a bounded window; conflicting or malformed metadata fails
   immediately. If availability never converges, retry only the failed MCP job
   using the retained artifact. Install the public version into a scratch consumer
   and run the bins and documented examples.
7. **Verify production.** Require actual upload, candidate probes, promotion
   and both production checks in the deployment run; a green skipped run is
   insufficient. Confirm the expected commit/package identity and a live MCP
   operation. The workflow compares shipped browser artifacts with npm before
   upload, tests the candidate at zero traffic, and verifies 100% traffic after
   promotion. Failure after attachment reaches verification or rollback.
8. **Record completion once.** Add the release SHA and CI, npm/MCP publication,
   consumer and production proof links to [the release record](../project/archive/releases.md).
   Retire completed backlog tasks in [TODO.md](../../TODO.md), linking to that record.
   Directory records keep submission and ownership facts; they reference the release
   record for publication status rather than repeating versions and workflow links.
   These operational records stay outside the npm package.

Documentation-only CI success does not deploy. For a website-only update at an
already published version, dispatch full `ci.yml` on current main, wait for its
success, then dispatch `deploy-cloudflare.yml`; this does not publish a release.
The deployment gate checks full qualification before using production credentials.

A documentation change inside the npm package still needs a new version.
Documentation-only CI checks the same npm package identity with
`published-version.ts --docs-only`, reusing the published runtime instead of
building it. This mode requires `dist` to be absent and composes package trees
inside isolated scratch; it never writes or removes a working build. Run it
before documentation checks that build website assets.
Published versions are immutable; keep the package-content guard intact.

## Publication and recovery boundary

The workflow requires the release tag, checked-out SHA, main ancestry,
`package.json`, `src/version.ts` and both `server.json` versions to agree.
Only the final minimal npm and MCP jobs can mint OIDC credentials. Repository
code, dependency installation, platform smoke and artifact construction run
without that permission. npm uses trusted publishing, not `NPM_TOKEN`, and
adds provenance automatically.

The package job builds once with the pinned publishing npm and verifies the
reviewed file manifest. Its artifact contains exactly `package.tgz`,
`package.sha256` and `package-manifest.json`. Credentialed jobs validate those
bytes and publish with lifecycle scripts disabled. Artifacts are retained for
30 days so a failed registry job can reuse the reviewed input.

An existing npm version is accepted only when its SHA-512 integrity matches
the retained tarball. An existing MCP version is accepted only when its
publisher-owned `.server` equals the extracted `server.json` structurally and
its official status is `active`. A mismatch, inactive or malformed record fails
closed. Unreachable preflight requests retry over a bounded window. After an
ambiguous publication failure, exact-identity checks can recover a remote success.

The MCP publisher remains pinned to v1.7.9 and its reviewed checksum. Its CLI
has no verify-if-present or idempotency mode; the workflow owns that check.
Retry the failed job rather than rebuilding successful upstream jobs.

## Between preparation and publication

An unpublished source version causes deployment to skip with a warning and
Actions summary. It does not create issues or comments. Production keeps its
previous published build. After verified promotion, cleanup can still close
existing release-to-do issues; cleanup errors are warnings.

For an independent freshness check after a release:

```bash
git fetch origin main
bun run scripts/ci/production-freshness.ts --deployable-sha "$(git rev-parse origin/main)" --max-drift-days 3
```

This read-only check compares the live `capabilities.json` build stamp with
main history. It never deploys or publishes. A missing npm version explains a
pending deployment; if the version exists, inspect the deploy steps and logs.

## One-time publishing setup

- Configure npm's GitHub trusted publisher for owner `adewale`, repository
  `agentic-mermaid`, workflow `publish.yml`, with no environment name.
- Keep that repository identity consistent with `package.json#repository.url`.
  The public repository supports npm provenance's transparency record.
- Enable account 2FA. After the first publish, select npm's “Require two-factor
  authentication and disallow tokens”; trusted publishing continues to work.
- The initial npm-install copy is already in place. `SITE_NPM_STATUS=source`
  or `SITE_NPM_PUBLISHED=0` is only for a source-install preview. A recurring
  release does not need to repeat the 0.1.0 “published copy” migration.

The workflow owns tool versions and immutable action pins. macOS smoke covers
Intel x64; it does not claim a fresh ARM64 result. Consumer and browser tests
own the supported package/runtime contracts.

## Local release benchmarks

Benchmarks run only in an explicit local measurement session. They are excluded
from pull-request CI, scheduled workflows, release publication and hosted manual
Actions. Publication still requires the exact release commit's canonical CI,
platform smoke tests and verified publication artifact. A benchmark result does
not block or authorize registry publication.

After building and packing the candidate, retain its verified tarball and the
resolved baseline identity, then run the relevant local commands:

```bash
bun run bench:release --baseline-npm 0.4.1 --out /tmp/release-comparison
bun run bench:release:browser --candidate-tarball release-artifact/package.tgz --candidate-sha256 VERIFIED_HEX --baseline-lock /tmp/release-comparison/baseline.json --out /tmp/release-browser
```

The Node comparison covers distinct official syntax examples, generated scaling
inputs and an agent edit workflow. It preserves per-round observations, render
failures, determinism, label checks and its configured time/memory budgets. The
browser comparison retains every reviewed fence occurrence, paired successful
SVG timings, actual complete/lazy payloads and pinned competitor identities.
Neither SVG acceptance nor visible-label checks prove arbitrary visual fidelity.
Inspect raw failures and measurement scope before interpreting a ratio.

Both local runners verify packed candidate bytes and persist the selected npm
baseline version/integrity. A reused output directory retains that baseline;
use a new directory when intentionally advancing it. The previous hosted
benchmark workflow has been removed, including its publication dependency.

For the full suite catalog, project-level incremental updates, invocation
coverage and report generation, see the
[Trident runner](https://github.com/adewale/trident/blob/main/unified/README.md). The
[Trident README](https://github.com/adewale/trident/blob/main/README.md) documents local checks and the Agentic Mermaid
adapters, and [`eval/trident`](../../eval/trident/README.md) documents the pinned launcher.
