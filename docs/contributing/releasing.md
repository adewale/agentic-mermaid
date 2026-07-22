# Releasing `agentic-mermaid` to npm

The package is published by [`.github/workflows/publish.yml`](../../.github/workflows/publish.yml),
which triggers on a **published GitHub Release**. The workflow requires a
successful canonical `ci.yml` run for the exact release commit. CI owns tests,
dependency/palette/sketch/whole-corpus quality, TypeScript and Biome checks,
browser contracts, route sabotage, `hero:check`, `website:check`, golden drift,
mutation, and packed-consumer fuzzing under Node 24 and the minimum supported
Node 22. The release workflow retains the registry-derived macOS/Windows smoke,
then owns only the publish boundary: an unprivileged job builds once, creates a
real tarball with the pinned publishing npm, compares its contents with the
reviewed fail-closed manifest, records its integrity and SHA-256 digest, and
uploads that immutable artifact under a fixed filename. A minimal OIDC job
requires the closed three-file artifact set, binds the manifest to the checksum
and tarball bytes, then publishes that exact `.tgz` with lifecycle scripts disabled.
There is no manual `npm publish` step. After npm succeeds, a separate minimal
OIDC job extracts [`server.json`](../../server.json) from the same verified
tarball and publishes it to the official MCP Registry. Keeping that step
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
package version, or MCP server versions disagree, and fails before building if
that immutable npm version already exists.

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
   publication fires `publish.yml`, which gates, builds, publishes to npm, and
   then publishes the matching server metadata to the MCP Registry.
6. **Verify:** `npm view agentic-mermaid version` shows the new version;
   if npm committed the immutable version before the workflow recorded success,
   rerun it—the publish job recovers only after the registry's SHA-512 integrity
   matches the retained verified tarball exactly. Then
   `npm install agentic-mermaid` into a scratch project resolves and its bins
   run; and
   `curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.adewale/agentic-mermaid"`
   returns the matching server and version. The official registry is still in
   preview, so verify its record after every release.
7. **After the first publish,** set the package on npmjs.com to
   "Require two-factor authentication and disallow tokens" — trusted publishing
   keeps working, and token-based publishing is locked out.

### Optional visual review

For releases with visual changes, generate the citizenship sheet with
`bun run contact:sheet:test-portfolio --kind citizenship --output-dir eval/test-portfolio/contact-sheets`
and inspect affected/high-risk cells at native size. The structured
`citizenship-review.json` record and `bun run contact:sheet:test-portfolio:review`
remain available when a reviewer wants hash-bound evidence, but they are advisory
and do not block package publication. Never invent reviewer identity, duration,
row IDs, or findings.

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
