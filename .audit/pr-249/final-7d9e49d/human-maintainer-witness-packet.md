# Independent human maintainer witness packet for PR #249

This file prepares the bootstrap witness. It is **not** a witness statement, an
approval by a human, permission to mark the PR ready, or permission to merge.
The witness must be completed by an independent human maintainer using live
GitHub state and the original Codex collaboration transcripts.

## Frozen candidate to witness

- Repository: `adewale/agentic-mermaid` (database ID `1181667327`)
- Git object format: `sha1`
- Pull request: `249`, still expected to be open and draft
- Target branch: `main`
- Target tip and merge base: `f203ab6a3faf09a4c2dd4057523f2cf651ca540a`
- Head: `7d9e49d739b690db9c03b8962b7b72e2249bdb0d`
- Head tree: `cbd6402c7a7aa249122cfb4f356c85f74d382d9a`
- Governance-policy blob: `67123663107354c258d6c23d4dd1a0bd197f8f05`
- Canonical delta algorithm: `git-raw-tree-delta-v1`
- Canonical delta SHA-256: `4d4e9f2caa6d1d5fb5318bc5e034540b2f4151e245208c76d226d7ad41be0972`
- Semantic title/body SHA-256: `98a68b6a68a3c2a8db5421023552466dfdfb0d0b2da3298d9a90d08359030e34`
- Body SHA-256: `9e6b4f05020dbd6a444dc53c67d639f8f571ce86d25286217120e92c279a1f5b`
- Body `lastEditedAt`: `2026-08-07T00:51:10Z`
- Intended merge strategy: squash

Any difference in target tip, merge base, head, tree, semantic description, or
required-check identity invalidates this packet. Stop and require a fresh
candidate/check/audit round; do not bless a near match.

## Evidence anchors

1. Manifest ref `audit/pr-249-final-7d9e49d`, locked at commit
   `a6927f48a23da55b34870bd564bbba79ca7362ff`. Manifest payload SHA-256:
   `f9ee5d543aa0973605907f364e8157afc9469cbc3b1ee2a518498e19980f4038`.
2. Separately protected detached-envelope ref
   `audit/pr-249-final-7d9e49d-envelope`, locked at commit
   `3c2768a93e43b689bda404a13341e1d15eb444f6`. Envelope payload SHA-256:
   `6b60a9e6c76aa71120c503036d248c4439a14e7b107448d83167b8ed9a55ae72`.
3. Stable PR pointer comment
   `https://github.com/adewale/agentic-mermaid/pull/249#issuecomment-5210752091`,
   created at `2026-08-07T01:08:44Z` before auditor dispatch.
4. Report/reconciliation ref `audit/pr-249-final-7d9e49d-reports`. Resolve its
   tip and require the same locked/admin-enforced/no-force-push/no-delete
   protection before using the files in this packet.
5. Final round-bundle ref `audit/pr-249-final-7d9e49d-bundle`. Resolve its tip,
   verify its payload hashes and stable-comment timestamps, and require the same
   protection before attesting.

## Provider evidence

- CI run `31136099908`, attempt 1, `pull_request`, exact head, created
  `2026-08-07T00:51:47Z`, completed `2026-08-07T01:02:16Z`, success.
- Ruff run `31136099791`, attempt 1, `pull_request`, exact head, created
  `2026-08-07T00:51:47Z`, completed `2026-08-07T00:51:56Z`, success.

Both qualifying runs were created after the frozen body timestamp. The earlier
cancelled CI run `31136039786` and earlier Ruff run `31136039716` predate the
freeze and are superseded; they are not witness evidence.

## Preserved first reports

- Architecture/integration/security — session
  `/root/pr249_architecture_cf0ad90`, registration
  `pr249-final-7d9e49d-architecture-3`, report SHA-256
  `9a7e5339c64812d0dc59590975b0dd8b955a60ff2e3a350eaada020035f41a63`,
  verdict `APPROVED`.
- Upstream/scope/semantic fidelity — session
  `/root/pr249_upstream_cf0ad90`, registration
  `pr249-final-7d9e49d-upstream-3`, report SHA-256
  `67f5c5f2ca2321a09b701f9794a25d397eb6353f29b76415c1ff02587cfe0581`,
  verdict `APPROVED`.
- Adversarial test/evidence/governance — session
  `/root/pr249_adversarial_cf0ad90`, registration
  `pr249-final-7d9e49d-adversarial-3`, report SHA-256
  `cd6fe71618ec8a2a25e494c4914093833a85392efcf87963232fa119e5884c64`,
  verdict `APPROVED`.

The human must compare each preserved report byte-for-byte with its original,
server-issued Codex collaboration first-report transcript. If those origin
transcripts are unavailable to the witness, the witness fails closed.

## Required witness procedure

1. Establish that you are a human maintainer independent of the implementing
   agent and the three audit roles. Record your GitHub identity and UTC time.
2. Resolve all four protected refs above. Verify exact commits/payload hashes and
   that administrators are enforced, the branches are locked, and force-pushes
   and deletion are disabled.
3. Compare every preserved first-report byte with its original Codex session
   transcript. Confirm three registered sessions, three received first reports,
   no failed/timed-out/cancelled/reused run, and all verdicts exactly `APPROVED`.
4. Read `reconciliation.json`. Confirm it contains no finding, closes every
   superseded-round correction, retains all residual risks, and does not claim
   the human witness is complete.
5. Re-read the live PR title/body and `lastEditedAt`. Recompute the body and
   semantic-description hashes; require the frozen values above.
6. Fetch `main` and the PR head. Require target tip, merge base, head, head tree,
   policy blob, changed-path set, object format, and canonical raw-tree delta to
   match exactly. Require the diff to contain only
   `docs/project/issue-248-fidelity-delivery-plan.md`, and run `git diff --check`.
7. Query all exact-head pull-request workflow runs. Require CI `31136099908` and
   Ruff `31136099791` to remain the newest required identities, complete and
   successful, with no newer failure or superseding run. Require both to have
   been created after `2026-08-07T00:51:10Z`.
8. Confirm the PR is still open, draft, and cleanly mergeable. Do not merge as
   part of this witness. After attesting, a maintainer may separately decide
   whether to mark it ready.

Useful exact local checks from a clean clone are:

```text
git rev-parse --show-object-format
git rev-parse 7d9e49d739b690db9c03b8962b7b72e2249bdb0d^{tree}
git merge-base f203ab6a3faf09a4c2dd4057523f2cf651ca540a 7d9e49d739b690db9c03b8962b7b72e2249bdb0d
git diff --name-only f203ab6a3faf09a4c2dd4057523f2cf651ca540a...7d9e49d739b690db9c03b8962b7b72e2249bdb0d
git diff --check f203ab6a3faf09a4c2dd4057523f2cf651ca540a...7d9e49d739b690db9c03b8962b7b72e2249bdb0d
git -c core.abbrev=40 -c color.ui=false diff-tree --no-commit-id -r --raw -z --abbrev=40 --no-renames f203ab6a3faf09a4c2dd4057523f2cf651ca540a 7d9e49d739b690db9c03b8962b7b72e2249bdb0d | shasum -a 256
```

## Maintainer-authored attestation template

Post this only after every step passes, replacing the bracketed fields with real
human-authored values:

```text
Independent maintainer witness for PR #249

I, [GitHub identity], am a human maintainer independent of the implementing
agent and the three registered audit roles. At [UTC timestamp], I verified the
frozen candidate tuple, semantic-description hashes and lastEditedAt, newest
exact-head CI/Ruff evidence, manifest and detached-envelope anchors, branch
protections, stable round-bundle pointer, preserved report bytes against all
three original Codex collaboration transcripts, and reconciliation. All exact
values match the protected round-3 bundle; all three first reports are APPROVED;
there are no unresolved findings; the documented residual risks remain.

This completes the bootstrap human witness and final tuple/check comparison for
the exact registered state. It does not merge the PR. Any later change to the
target tip, merge base, head, tree, semantic description, or required checks
invalidates this witness.
```
