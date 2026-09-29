# CLAUDE.md

Guidance for AI agents working in this repository.

## Project

**Agentic Mermaid** (`agentic-mermaid` on npm) — a fork of `lukilabs/beautiful-mermaid`
that renders Mermaid diagrams to SVG/PNG/ASCII/Unicode with a typed, agent-native
editing surface. Source lives in `src/`; the layout pipeline is in
`src/layout-engine.ts`, the deterministic layout-quality rubric in `src/layout-rubric.ts`.

## Commands

- `bun install` — install dependencies. Requires Bun 1.4.0 or later (CI pins 1.4.2);
  older Bun mishandles `node:vm` timeouts and the MCP server refuses to start. In
  cloud sessions the SessionStart hook (`scripts/ci/session-start.sh`) upgrades an
  older Bun and runs `bun install` for you, in the background: if `bun --version`
  is still below 1.4.0 right after a session starts, wait a few seconds.
- `bun run test` — run the full covered unit suite with the canonical timeout (the CI gate). fast-check
  seeds are pinned by a preload; `AM_FC_SEED=<int>` reproduces a roll,
  `AM_FC_SEED=random` is finder mode (see `docs/testing-strategy.md` §4).
- `bun run typecheck` — canonical typecheck across core and repository surfaces.
- `bun run track` — heuristic layout-quality tracker (improvements/regressions vs baseline).
- `bun run bin/am.ts render <file> --format png --output out.png` — render a diagram.
- `bun run website` — build the Cloudflare Workers site into `website/public/`, a
  **gitignored build artifact** (rebuilt at deploy by `deploy-cloudflare.yml`, and
  on-demand by explicit imports of `src/__tests__/website-public-fixture.ts`). You do
  not commit it. `website/src/generated/` is also ephemeral. `website:check`
  performs an in-memory clean regeneration and contract comparison for both trees;
  run `bun run website` only when local serving, deployment, or an explicit fixture
  consumer needs materialized outputs.

Layout is **deterministic**: identical input must produce identical geometry.

## How we work (read before changing code or tests)

These rules exist because the repo once fell into a loop where every small
behaviour change had to regenerate a dozen committed derived files, satisfy
gates that tested other tests, and match Mermaid quirk-for-quirk. Work split
into tiny near-identical steps, each paying the full integration cost.

### Mermaid is our input language, not our spec

Write strictly, read generously, warn.

1. What we **write** (serializers, `createMermaid`) must be valid Mermaid 11.16.
2. What we **read** may be more generous than Mermaid. If the author's meaning
   is clear, parse and draw it, and have `verify` report `UNSUPPORTED_SYNTAX`
   saying Mermaid rejects it (see `journeySemicolonExtensionWarnings`). Reject
   only when we cannot tell what was meant.
3. For source Mermaid accepts, keep the author's meaning. Where Mermaid's
   behaviour is a quirk (it drops information, or orders things by accident),
   choose the sensible behaviour and record it in `docs/project/divergences.md`.
4. Rendering, layout, styling and text display are ours. Never test them
   against Mermaid.
5. A difference from Mermaid is a bug only when it shows up without mentioning
   Mermaid: lost or garbled content, a crash, a wrong drawing, our own surfaces
   (renderer, typed body, serializer, ASCII) disagreeing, or output Mermaid
   cannot read. Otherwise it is a divergence, not a backlog item.

### Tests protect behaviour, not other tests

Before adding a test, answer: what behaviour or public contract does it
protect; what credible regression makes it fail; why existing coverage does not
already catch it. Then:

- Test at the owning boundary, once. Extend a table-driven case instead of
  adding a near-duplicate test or file.
- No tests of tests: no "has teeth" examples for lint tables, no allow-list
  staleness checks, no tests of test helpers.
- No copied inventories, manifests or export lists, no source greps, and no
  expected values produced by the code under test.

### Don't commit derived artifacts

If a file can be generated from the repo, generate it in the build or in CI and
gitignore it (as `website/public/` is). Don't commit it and don't add a test
that compares a committed copy with a fresh one. Don't hash our own inputs for
provenance or change detection. Hashes belong only on bytes we ship or fetch.
Committed exceptions: reviewed rendering goldens under `src/__tests__/testdata/`
and files production code imports at runtime.

### Change shape

- One coherent change per commit, at the owning boundary: all the sites of one
  rule together, not one commit per bug.
- Locally run typecheck, lint and the tests that exercise what you changed. The
  full suite runs in CI (3 shards, about 4 minutes); don't run it locally per
  commit.
- Parallel agents only on disjoint files, at most 2–3 at a time.

## Pull requests — use the `good-pr` skill

Before opening or updating a PR, use the **good-pr** skill
(<https://github.com/adewale/good-pr>; install with `npx skills add adewale/good-pr`).
It evaluates a PR across seven dimensions and ships a readiness script and a
description template. Apply it to every PR in this repo.

The seven dimensions:

1. **Reproduction steps** — reference the issue; give the exact steps/probe a
   maintainer can run to reproduce the bug and confirm the fix.
2. **Visual evidence** — for visual/UI changes include captioned before/after
   renders (generated artifacts preferred). If a geometry change is below visual
   perceptibility, say so honestly and let the quantitative metric stand as the
   evidence — do not pad the PR with near-identical screenshots. Attach renders
   to the PR (uploaded images or a CI artifact) rather than committing new files
   under `docs/pr-assets/`, and never make a test read PR evidence: the
   regression protection belongs in a semantic test of the current render.
3. **Code that fits** — match existing patterns, naming, and comment density; no
   unrelated refactoring smuggled in.
4. **Tests that prove the fix** — tests must fail when the fix is reverted.
   Verify red→green and state the result (e.g. "N tests fail without the fix").
   CI's `red-green` job checks this: at least one changed test must fail against
   the base branch's production code. It skips itself when no `src/`/`bin/`
   production file or no test changed; label `no-red-green` only a pure
   refactor that changes both.
5. **Scoped and safe** — one concern, minimal diff, full test suite run, risks flagged.
6. **Standalone description** — what / why / how / testing / risk, understandable
   without reading the diff.
7. **Trust** — be honest about readiness, limitations, and any test that is a
   regression guard rather than a bug-discriminating test.

Quick automated hygiene check (diff size, tests touched, secrets, debug
statements, UI files):

```bash
bash scripts/ci/check-pr-readiness.sh main
```

Do not create a PR unless explicitly asked.
