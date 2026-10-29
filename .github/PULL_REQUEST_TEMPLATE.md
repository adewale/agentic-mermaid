<!--
Thanks for the PR. Keep the description focused on what changed and why.
The checklist below covers changes that need a human decision.
-->

## What & why



## Contracts and evidence

<!-- For a small change, a sentence is enough. For a cross-surface change,
     use one row per independently falsifiable contract. Name the producer,
     consumer and relevant transition; link the owning test/probe and explain
     its limit. Derive the expectation before reading existing assertions.

     Contract / owning boundary | Evidence and revision | Remaining gap

     For audit fixes, identify the failed assumption, whether the fix introduced
     a regression, and how adjacent paths were checked. See
     docs/testing-strategy.md#contract-review-and-completion.
-->



## Checklist

- [ ] Local typecheck, lint and affected tests pass. The full suite and quality
      workflow pass in CI for the exact final head; the description links the
      run and records that head. Pending checks mean verification is unfinished.
- [ ] Confirmed in-scope findings are resolved, evidence covers the affected
      contracts, and remaining gaps are stated. A new audit has a named open
      question; repeated clean audits are not a release requirement.
- [ ] **Golden snapshots:** the description lists each changed golden under
      `src/__tests__/testdata/` and why it changed (see
      [docs/contributing/visual-review-evidence.md](../docs/contributing/visual-review-evidence.md)).
- [ ] **Red → green:** at least one changed test fails without the production
      change (CI's `red-green` job runs them against the base branch) **— OR —**
      this is a pure refactor and the PR is labelled `no-red-green` (applied
      after the latest push; CI removes it when new commits arrive).
- [ ] **Payload growth:** no website route or lazy family grows by more than
      2% and 1 KiB gzip against the base branch **— OR —** the growth is
      intended and the PR is labelled `payload-growth-approved` (applied after
      the latest push; CI removes it when new commits arrive).
- [ ] If I added a diagram family, it is wired into the central registries
      (`BUILTIN_FAMILY_METADATA`, metamorphic generators, baselines) per the
      citizenship checklist.
