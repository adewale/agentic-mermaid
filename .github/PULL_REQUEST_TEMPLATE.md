<!--
Thanks for the PR. Keep the description focused on what changed and why.
The checklist below covers the two CI gates that need a human decision.
-->

## What & why



## Checklist

- [ ] Tests pass locally (`bun run test`) and the CI-parity quality suite passes (`bun run quality:check`).
- [ ] **Golden snapshots:** I did **not** change committed goldens under
      `src/__tests__/testdata/` **— OR —** I reviewed the golden diff, it is
      intended, and **a commit-message line starts with `[approve-goldens]`**.
      (CI hard-fails on unreviewed golden drift — see
      [docs/contributing/visual-review-evidence.md](../docs/contributing/visual-review-evidence.md).)
- [ ] **Visual evidence:** one-shot before/after renders are **attached** to
      the PR (`gh … --attach`, rendered into `docs/pr-assets/attached/`) — OR
      each commit adding evidence media under `docs/pr-assets/` (a new living
      artifact, or this session cannot attach — `bun run evidence:probe` says
      which) **starts a commit-message line with
      `[approve-committed-evidence]`**. (CI hard-fails otherwise — see
      [docs/contributing/visual-review-evidence.md](../docs/contributing/visual-review-evidence.md).)
- [ ] If I added a diagram family, it is wired into the central registries
      (`BUILTIN_FAMILY_METADATA`, metamorphic generators, baselines) per the
      citizenship checklist.
