CHANGES_REQUIRED

ADV-2FBB-001 — High — Exact mutation membership can pass without exercising the advertised mutation operation. `docs/project/issue-248-fidelity-delivery-plan.md:474-481` indexes mutation evidence only by `(case ID, construct ID, source ID)` and lets that membership pass merely because the construct survives an unrelated mutation. Closure repeats this operation-free requirement at lines 1069-1074. This does not prove the direct mutation paths: `src/agent/mutation-ops.ts:9-25` advertises many distinct operations per family, with materially different schemas and semantics such as `rename_node`, `set_label`, and `set_shape` at `src/agent/op-schema.ts:116-130`. A suite could exercise one harmless unrelated operation, preserve every construct, and pass while every operation intended to mutate those constructs is broken.

Smallest correction: define exact mutation membership as `(case ID, construct ID, source ID, applicable mutation-operation ID)` and require each applicable advertised operation to execute through the canonical real route with a discriminating direct-result oracle. Keep survival under unrelated mutation as an additional preservation obligation, not an alternative discharge. Require typed per-operation `not-applicable` authority and repeat this invariant in closure.

ADV-2FBB-002 — High — This correction round does not satisfy its own pre-dispatch detached-envelope protocol and cannot count as an approval round. `docs/project/issue-248-fidelity-delivery-plan.md:308-314` requires a detached envelope binding the manifest payload hash, sessions, prompt/scope hashes, tuple and digests, timestamp, and anchor object/URL, with a PR comment pointing to the anchor. The protected anchor commit `72d6360412e9962a4f6007d3481697bd11539a1f` adds only the manifest and three prompts. Live remote discovery returns only `refs/heads/audit/pr-249-final-2fbb338`, with no correction-round envelope artifact, and the live PR comments contain no pointer for this round after its `2026-08-07T00:29:51Z` registration. The dispatch message’s expected hashes are not a published detached envelope containing the required fields and immutable URL.

Smallest correction: retain this report as a failed round; create the independently controlled detached envelope and PR pointer before dispatch, then register and run a complete replacement three-role round. A retroactively created envelope cannot validate the already-dispatched round.

ADV-2FBB-003 — Medium — The registered manifest omits the repository object format explicitly required by the plan. `docs/project/issue-248-fidelity-delivery-plan.md:169-183` requires it to be recorded. `.audit/pr-249/final-2fbb338/manifest.json:4-27` records repository identity and the raw-tree algorithm/command but has no object-format field; `git rev-parse --show-object-format` returns `sha1`.

Smallest correction: record and validate `objectFormat: "sha1"` in the replacement manifest and detached envelope, including compatibility with the canonical object-ID encoding.

Residual risks and tested non-findings:

- The prompt and manifest hashes match their registered values. The live repository ID, target tip, merge base, head, tree, changed-path set, semantic-description digest, and canonical NUL-delimited raw-tree SHA-256 all match the registered tuple.
- The live PR remains open, draft, cleanly mergeable, and unchanged. The correction commit `d7595bd8…` and empty check-trigger commit `2fbb338b…` have the same tree, supporting the PR body’s correction claim.
- CI `31133525250` and Ruff `31133525257` are successful exact-head pull-request runs created after the frozen body’s `lastEditedAt`; no newer superseding failure was found.
- `git diff --check` passes; the worktree remains clean. The stated focused checks reproduce exactly: documentation contracts pass 12/12 and contract lint passes 78/78.
- External issue #248 and PR #192 match the manifest. The protected audit ref is locked with administrators enforced and force pushes/deletions disabled.
- The corrections for repository-versioned 16-family scope, route-transform/refinement joins, absent-state migration, config/theme effects, build-operation membership, Sankey dependency factorization, freshness chronology, and standardized `APPROVED` vocabulary are materially present.
- The independent maintainer witness remains outstanding, and the governance remains prose until A0 implements its enforcement.
