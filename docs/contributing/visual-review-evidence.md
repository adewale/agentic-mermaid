# Visual review evidence

Agentic Mermaid layout changes need evidence that is reproducible from source,
not hand-edited screenshots. Use the smallest artifact that matches the change.

## Required evidence by change type

| Change type | Required evidence |
|---|---|
| Route contracts, ports, shape anchors, or contact geometry | `bun test src/__tests__/route-contracts.test.ts src/__tests__/contact-sheet.test.ts`; regenerate/review `docs/pr-assets/contact-sheet.png` when scenarios or geometry intentionally change. |
| Duplicate / parallel edges (a multigraph — the same directed pair written more than once) | `bun test src/__tests__/route-contracts.test.ts`; review the duplicate/parallel cases on the contact sheet (`AP`–`AR`) and the crossing ratchet in `layout-rubric.test.ts`. A duplicate-specific before/after lives at `docs/pr-assets/issue-62-duplicate-edge-lanes-before-after.png` (regenerate with `bun run scripts/pr-assets/issue-62-evidence.ts`). |
| ASCII/Unicode routing or region metadata | Exact goldens/tests: `bun run goldens:ascii:check` plus relevant `src/__tests__/ascii*.test.ts` / `agent-ascii-meta.test.ts`. |
| Family renderer/layout changes | Family parser/layout/renderer tests, SVG snapshot where available, and `agent-family-layouts.test.ts`. |
| Broad layout heuristics | `bun run rubric:visual` and/or `eval/layout-compare` before/after output attached to the PR. Commit only living, receipt-gated assets; attach one-shot renders and large HTML reports (see “Committed artifacts vs. attached evidence”). |
| Website/editor visual changes | `bun test e2e/browser.test.ts`; inspect captured screenshots when baselines or UI structure change. |
| Region/action metadata only | Prefer JSON/SVG metadata assertions over raster screenshots; include one representative fixture proving stable `data-region`/sidecar IDs. |

## Artifact meanings

- `docs/pr-assets/contact-sheet.png` is the committed reviewer contact sheet for route/port geometry. The byte-match test ensures it reflects the current renderer. Scenarios `AP`–`AR` cover duplicate/parallel edges: duplicates must render as evenly-separated, nested (non-crossing) parallel lanes — never a collapsed single line or a crossed pair.
- The duplicate-edge crossing ratchet (`layout-rubric.test.ts`) counts duplicate-pair crossings over the random-flowchart generator and holds the count at or below its pinned baseline. Duplicate edges share both endpoints, so a crossing between them is never logically required; the baseline is a regression ceiling whose target is zero — lower it when the count drops.
- `eval/visual-rubric` produces deterministic scored galleries. Its scores are a gate for obvious regressions, not a replacement for human review.
- `eval/layout-compare` compares before/after layout faithfulness and quality over a corpus. “0 regressions” means no configured metric/faithfulness regression, not a claim of pixel parity with Mermaid.js.
- Browser screenshots prove the shipped site/editor still renders and remains usable. Pixel-diff is only active when dependencies are available, so reviewer inspection still matters.

## Committed artifacts vs. attached evidence (`gh --attach`)

Evidence artifacts have two lifecycles, and the split decides where the pixels
go:

- **Living artifacts** are regression surfaces: a test, receipt, or baseline
  references them and fails when they drift — `docs/pr-assets/contact-sheet.png`
  and its byte-match test, the `gallery:*:check` receipt scripts, members of
  `eval/test-portfolio/baseline.json`, any path named in an
  `evidence-receipt.json`. These stay committed; the gate is what keeps them
  current.
- **One-shot PR evidence** is a before/after or annotated render that argues
  for a single PR and is never checked again after merge. Historically these
  were committed too (88 files / ~15 MB under `docs/pr-assets/` when this
  policy changed) because there was no CLI path to put an image on a PR.

GitHub CLI now uploads attachments directly ([cli/cli#13256]): a repeatable
`--attach` flag on `gh issue create|comment|edit` and `gh pr create|comment|edit`
uploads a local image or video to an immutable
`https://github.com/user-attachments/assets/<uuid>` URL — the same hosting the
web UI's drag-drop uses, valid regardless of later force-pushes or branch
deletion.

**Policy: attach one-shot evidence; commit only living artifacts.** The
reproducibility bar does not move — the generator script
(`scripts/pr-assets/<topic>-evidence.ts`) is committed either way; “attached,
not committed” applies to the pixels only. Point one-shot renders at
`docs/pr-assets/attached/` (gitignored) so they cannot ride along in a commit —
e.g. pass `--out docs/pr-assets/attached/before-after.png` to
`eval/visual-rubric/before-after.ts`, or write there from a new
`scripts/pr-assets/<topic>-evidence.ts`.

Mechanics that matter here:

- Placement: a body reference to an attached local path, e.g.
  `![Hub recenters over the peer group](docs/pr-assets/attached/hub-centering.png)`
  with `--attach docs/pr-assets/attached/hub-centering.png`, is rewritten to the
  uploaded URL (matching is on the resolved absolute path). Any attached file
  the body does not reference is appended at the end.
- Captions — good-pr dimension 2 requires them: alt text follows `#` in the
  flag value, as in `--attach './before-after.png#Hub recentering, 2x zoom'`;
  a reference already in the body keeps the alt text written there.
- Limits: at most 50 files per command; images ≤ 10 MB (`.png .jpg .jpeg .gif
  .webp .svg`), video ≤ 100 MB (`.mp4 .mov .webm`); incompatible with `--web`.

**Availability and the fallback path.** As of 2026-08-29 `--attach` ships in
`gh` preview builds only — stable releases through v2.98.0 lack it. Run
`bun run evidence:probe` to learn which path this session supports (it checks
`gh pr comment --help` for `--attach`). Without it (a stable
`gh`, or an agent session that reaches GitHub only through an API surface with
no attachment upload), the previous flow stays correct: commit the composite
under `docs/pr-assets/` and pin PR-body image URLs to the immutable final head,
re-pointing them after any post-evidence push (the “generator and URL are
current” lesson in `docs/contributing/lessons-learned.md`). Attached URLs make
that re-pointing failure mode structurally impossible, which is the main reason
to prefer them.

Existing committed assets stay put: receipts, baselines, and merged PR bodies
reference them by path or pinned URL, and deleting them from HEAD buys back no
history. The policy governs new one-shot evidence.

[cli/cli#13256]: https://github.com/cli/cli/issues/13256

## Committed-evidence gate (`[approve-committed-evidence]`)

The policy above is CI-enforced, not advisory. The `quality` job — and
`bun run quality:check` locally, the same aggregate — runs
`scripts/ci/evidence-policy.ts`, which fails the build when a commit in the
PR/push range **adds or modifies** media under `docs/pr-assets/` that nothing
in the repository names by **full repository path**. That is the mechanical
definition of a living artifact: every sanctioned consumer (evidence receipts,
`eval/test-portfolio/baseline.json`, the citizenship matrix, tests, these
docs) names assets exactly that way. A generator assembling the path from
`join(...)` fragments is not a consumer and does not count.

When the gate fires, one of three things is true:

1. It is one-shot evidence → don't commit it. Render into
   `docs/pr-assets/attached/` and attach it (`gh pr create|comment --attach`).
2. It is a living artifact → wire the consumer that keeps it current (receipt,
   baseline, doc, or test naming the full path) in the same PR. References are
   judged at the range head, so the consumer may land in a later commit than
   the asset.
3. This session genuinely cannot attach (`bun run evidence:probe` says so:
   no `gh`, or a `gh` without `--attach`) → keep the file committed and
   **start a commit-message line** with `[approve-committed-evidence]`,
   optionally followed by the reason.

Token rules mirror `[approve-goldens]`: it counts only at the start of a line,
a mid-sentence mention (as in this doc) is not approval, and a standalone token
on a commit that adds no unreferenced evidence fails as a stray. Deleting
committed evidence never needs the token — removal is the direction the policy
encourages. The gate logic lives in `scripts/ci/evidence-policy.ts` and is
unit-tested; the PR template restates it as a checklist item.

## Golden-snapshot drift gate (`[approve-goldens]`)

Committed goldens under `src/__tests__/testdata/` are a **hard CI gate**, not an
ignorable warning. The `ci.yml` "Golden snapshot drift" step fails the build if:

- running the suite leaves **uncommitted** changes under `testdata/` (regenerate
  and commit them), or
- any commit in the PR/push range **modifies** committed goldens **without its
  own** approval line starting with `[approve-goldens]`.

So when a renderer change legitimately moves goldens: regenerate them, **review
the diff** (this is the human decision the gate enforces), commit the result,
and **start a commit-message line** with `[approve-goldens]`. The token only
counts at the start of a line — merely mentioning it mid-sentence (as this doc
does) is not approval, so prose about the gate can't trip it. A standalone
`[approve-goldens]` line on a commit that changes no goldens also fails, to keep
the token meaningful. The gate logic lives in `scripts/ci/golden-drift.ts` and is
unit-tested; the PR template restates it as a checklist item.

## Reviewer checklist

1. Does the PR say which visual command was run?
2. Are generated artifacts reproducible from committed source/fixtures?
3. If a committed PNG/snapshot changed, is the change explained in the PR body?
4. If a visual check is skipped, is there a reason and an alternate structural test?
5. Are one-shot before/afters and large generated reports attached rather than committed? (Committed artifacts are for living, receipt-gated evidence.)
6. For peer fan-in/fan-out screenshots, is the hub centered over the peer group?
7. Does the review wrapper match the rendered diagram background, or use a neutral surface, so it does not create false label/background contrast?
