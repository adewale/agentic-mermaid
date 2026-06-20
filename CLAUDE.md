# CLAUDE.md

Guidance for AI agents working in this repository.

## Project

**Agentic Mermaid** (`agentic-mermaid` on npm) — a fork of `lukilabs/beautiful-mermaid`
that renders Mermaid diagrams to SVG/PNG/ASCII/Unicode with a typed, agent-native
editing surface. Source lives in `src/`; the layout pipeline is in
`src/layout-engine.ts`, the deterministic layout-quality rubric in `src/layout-rubric.ts`.

## Commands

- `bun install` — install dependencies.
- `bun test src/__tests__/` — run the full unit suite (the CI gate).
- `bunx tsc --noEmit` — typecheck.
- `bun run track` — heuristic layout-quality tracker (improvements/regressions vs baseline).
- `bun run bin/am.ts render <file> --format png --output out.png` — render a diagram.

Layout is **deterministic**: identical input must produce identical geometry.

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
   evidence — do not pad the PR with near-identical screenshots.
3. **Code that fits** — match existing patterns, naming, and comment density; no
   unrelated refactoring smuggled in.
4. **Tests that prove the fix** — tests must fail when the fix is reverted.
   Verify red→green and state the result (e.g. "N tests fail without the fix").
5. **Scoped and safe** — one concern, minimal diff, full test suite run, risks flagged.
6. **Standalone description** — what / why / how / testing / risk, understandable
   without reading the diff.
7. **Trust** — be honest about readiness, limitations, and any test that is a
   regression guard rather than a bug-discriminating test.

Quick automated hygiene check (diff size, tests touched, secrets, debug
statements, UI files):

```bash
bash skills/good-pr/scripts/check-pr-readiness.sh main   # if installed locally
```

Do not create a PR unless explicitly asked.
