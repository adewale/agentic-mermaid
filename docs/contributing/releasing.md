# Releasing `agentic-mermaid` to npm

The package is published by [`.github/workflows/publish.yml`](../../.github/workflows/publish.yml),
which triggers on a **published GitHub Release**. The workflow reproduces CI's
deterministic gate (tests, `tsc`, `hero:check`, `website:check`, golden-drift,
incremental mutation), builds with `tsup`, and runs
`npm publish --provenance --access public`. There is no manual `npm publish` step.

## Preconditions (verify once, before the first release)

- **`NPM_TOKEN` secret** is set on the repo (an npm automation / granular
  publish token with rights to the `agentic-mermaid` name). The publish step
  reads it as `NODE_AUTH_TOKEN`.
- **The GitHub repo is public.** npm `--provenance` writes to a public
  transparency log and fails on a private repo. If the repo must stay private,
  drop `--provenance` from `publish.yml` and `publishConfig` first.
- `npm view agentic-mermaid version` — confirm the version you're cutting is not
  already published (first release: expect a 404).

## Cutting a release

1. **Land everything on `main` green.** Releases are cut from `main`, whose CI
   has already run; `publish.yml` re-runs the deterministic gate as a backstop.
2. **Bump `version`** in `package.json` (first release is `0.1.0`). Keep
   `llms.txt`/`am capabilities` in sync — they derive the version from
   `package.json`, so no manual edit is needed.
3. **Roll the changelog.** Retitle `## Unreleased` in
   [`CHANGELOG.md`](../../CHANGELOG.md) to `## <version> — <YYYY-MM-DD>` and open a
   fresh empty `## Unreleased` above it.
4. **Flip the "published" copy** (see below), commit via PR, and merge to `main`.
5. **Create the GitHub Release** on the merge commit (tag `v<version>`). Its
   publication fires `publish.yml`, which gates, builds, and publishes.
6. **Verify:** `npm view agentic-mermaid version` shows the new version;
   `npm install agentic-mermaid` into a scratch project resolves and its bins run.

## The "published" flip

Until the package is on npm, the repo deliberately says *"not yet published;
install from source"* in three places. At release time, flip them to the
published copy:

- **Website** — the site build reads `SITE_NPM_STATUS`; build/deploy with
  `SITE_NPM_STATUS=published` (in [`pages.yml`](../../.github/workflows/pages.yml))
  so the install card shows `npm i agentic-mermaid`. The guard in
  `src/__tests__/website-build.test.ts` ("unverified npm publication does not
  produce npm install copy") asserts the *committed* public bundle stays on the
  source-install copy; once published, relax or update that guard.
- **README** — restore the npm-install-first [Installation](../../README.md#installation)
  copy and the `Published as agentic-mermaid` status line.
- **`docs/getting-started.md`** — restore the `npm install agentic-mermaid`
  Install block.
