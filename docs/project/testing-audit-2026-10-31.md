# CI and test audit — 31 October 2026

This change addresses the owner's eight ceremony findings. It prepares source
0.5.6 without publishing or deploying it. Release 0.5.5 remains the public
version. The audit is a review of selected boundaries, not an exhaustive review
of every test or a claim of faster rendering.

## Eight changes

| Previous cost or weak assurance | Change and retained contract |
| --- | --- |
| Full runtime CI for every documentation edit | Recognized Markdown changes run package-immutability, generated facts, CLI/API examples, offline-guide checks and website regeneration. Unknown paths, missing history and manual dispatch run full qualification. Real Git merge/rename fixtures protect the decision. |
| Independent rebuilds in compatible consumers | One producer builds portable bundles, site/Worker inputs and a verified tarball. Unit, browser and installed Node 22/24 consumers reuse those bytes; each consumer still installs independently. Native binary and release platform builds remain independent. Published-site shell examples reuse the shared site in CI. |
| Extended layout campaigns on unrelated PRs | Relevant rendering changes select advisory images and generated layouts; a manual dispatch can request them. Required runtime regressions and all 25 layout passes remain. |
| Documentation tests pinning sentences and CSS names | Removed those assertions and the unused prompt-checklist helper. Retained real executable examples, SDK/sandbox behavior, distinct semantic-readback prompt variants and served-link checks. |
| Hero freshness inferred from an SVG fingerprint | Removed the blanket gate and fingerprint. The authored Mermaid, style, direct PNG command and reviewed image remain. Refresh deliberately when the illustration needs it. |
| Mandatory failing-base gate and opt-out label | Kept the base-production diagnostic as an explicit tool. Removed its required CI job and label. Bug fixes still need intended red→green evidence; refactors need no failing-base assertion. Payload growth approval remains bound to its head. |
| Manual npm propagation recovery and duplicate release facts | MCP registration waits for public exact-version npm metadata and matching SHA-512 within bounded retries. Conflicts fail closed. One release record owns completed delivery facts; other records link to it. |
| Overlapping agent operating rules | One maintained operating guide feeds CLI and offline installation; the hosted start and skill are short routers. Generated MCP config pins the installed package version. Exact channel references remain available. |

For a published version, the docs path temporarily reuses its published runtime
bundle and compares the same canonical npm package trees. Shipped documentation
changes still require a version bump; repository-only records need no rebuild.
The runtime is composed only in isolated package trees; a workspace build is
never created, overwritten or removed by this mode.

A successful docs-only run cannot authorize release or deployment. Both
privileged boundaries require actual successful portable-artifact and
canonical-completion jobs on the exact main commit. Automatic docs-only
success skips deployment before credentials or production state are used;
a manual deployment without full qualification fails closed. The artifact producer distinguishes full qualification; the
completion job owns strict success/skip accounting for every selected runtime
lane. This avoids copying the runtime-job roster into the publisher and tests.

## Audit methods and boundaries

Applied upstream [OpenClaw test-audit](https://github.com/openclaw/openclaw/blob/7f345d644b976af9d43264e6617aaacd4ed5f9a2/.agents/skills/test-audit/SKILL.md),
its retention/proof guidance, and [Hegel](https://github.com/hegeldev/hegel-skill/blob/6fd049a4a1912588c8a6be238d3654ed66a80646/skills/hegel/SKILL.md)
plus [hegel-review](https://github.com/hegeldev/hegel-skill/blob/6fd049a4a1912588c8a6be238d3654ed66a80646/skills/hegel-review/SKILL.md).
We retain fast-check. OpenClaw-specific pnpm commands, infrastructure and line
ratchets are not transplanted into this repository.

The test-aware review read the CI selection, release shell, agent-document,
SVG well-formedness, Unicode-label and installed-consumer owners and their
history. A separate Hegel reviewer read implementation and public contracts
without seeing tests. Its surface inventory covered CI selection/accounting,
release identity/readiness, artifact tampering, onboarding lifecycle, portable
package entry points and label approvals. Existing public API families outside
these boundaries were inventoried for follow-up, not exhaustively tested.

Retained independent contracts include XML parsing, package export/resource and
Node/Bun parity, real PNG delivery, exact release bytes, bounded readiness and
atomic publication refusal. Cross-runtime equality is a packaging oracle; it
is not independent evidence that common rendering semantics are correct.

## Additional honesty repairs

- Code Mode recipes must return usable source that parses and verifies. A normal
  `{ phase: 'parse', error: ... }` return no longer passes merely because the
  sandbox executed successfully. Cross-family examples retain explicit skips.
- Removed an obsolete four-attempt helper retry for arbitrary crashed processes.
  A genuine crash now fails once; timeout termination and pipe draining remain.
- Installed JSON-RPC IDs are compared as exact lexical tokens. The old substring
  check accepted an integer with an added decimal suffix and a changed exponent.
- Installed batch proof now rejects malformed records with the expected code and
  requires valid requests after those failures to succeed, retaining ASCII parity.
- Quickstart commands remove their expected output before execution. A PNG command
  returning success without writing cannot inherit the earlier JS example's file.
- Restored a SHA-512 negative case hidden behind an obsolete benchmark condition.
  Both privileged artifact consumers now enforce SHA-512 as well as SHA-256.
- CI selection checks the real Actions output file, current merge parents,
  runtime-to-docs renames and missing-history/manual full qualification. Workflow
  shells are executed with external responses controlled at their real boundaries.

Controls use isolated scratch copies, not another permanent test framework:
old release attestation accepts docs-only success; old MCP digest checking
accepts a wrong SHA-512 manifest; removed npm readiness checking accepts a
conflicting identity; the old recipe guard accepts an early-error envelope;
the old process helper runs a crashing child four times; and the old PNG
checker accepts a no-op CLI command. Fixed controls reject those failures.

## Remaining work suggested by the audit

1. **Exact accepted-value conservation.** The blind review found a concrete
   Packet defect: a successful typed mutation changes a lone UTF-16 surrogate
   label into ordinary text. The input is `String.fromCharCode(0xd800)`;
   `mutate(createMermaid('packet'), { kind: 'add_field', bits: 1, label })`
   succeeds but the resulting field label is `ud800`. A standalone exact-value
   assertion was executed and fails. Preserve the accepted value or refuse the
   edit atomically. This is a product follow-up, not fixed by this cleanup;
   do not hide it by narrowing a future generator. No issue was filed.
2. **Cheap semantic models before expensive materialization.** Use independent
   label/identity/endpoint and BigInt range models for typed edits and Packet
   arithmetic. Cover accepted and near-valid rejection paths separately. Bound
   expensive rendering while retaining targeted scale probes; do not replace
   thousands of cheap properties with validity-only assertions.
3. **Shrinking for per-input failures.** Where a sampled corpus is really testing
   individual invariants, use `fc.assert(fc.property(...))` and report the reduced
   counterexample. Keep sampling for aggregate/distribution observations. Preserve
   hostile Unicode, escapes, controls and relevant configuration choices.
4. **Typed SDK examples instead of substring membership.** Mutation names
   appearing anywhere in declaration text can satisfy a substring assertion.
   Extend existing typed consumer proof with family-specific accepted/refused
   operations, preserving separate runtime discovery propagation coverage.
5. **Profile the remaining browser critical path.** Full qualification still
   retains Chromium comparisons and real UI behavior. Measure phase costs before
   proposing consolidation; a slow check is not automatically redundant.

## Evidence, costs and limits

The preceding 0.5.5 prose-only main run
[41212294422](https://github.com/adewale/agentic-mermaid/actions/runs/41212294422)
took 16 minutes and 59.8 summed job-minutes; its browser job took 15.1 minutes.
Those are observed job durations, not billing or a controlled performance baseline.
The actual focused docs sequence passed from a clean candidate checkout in
73.27 seconds with the locked dependency installation reused. That excludes
installation and hosted queues; it is not a controlled comparison with CI.
The new scheduling and reuse remove repeated work; no general CI speedup is
claimed until comparable hosted runs exist.

Operating-guide bytes changed from 21,063 to 11,136; the starter from 9,039 to
968; the workflow skill from 11,119 to 1,602. A fresh agent used the installed
offline guide and one portable library channel for two synthetic tasks: creating
API→Queue→Worker, and changing only one existing node label. Exact semantic
facts, verification, serialization/reparse and SVG delivery passed. This does
not establish general agent reliability or task-time improvement.

Observed failures were retained and classified: an initial website fixture run
reached zero assertions because concurrent edits invalidated three builds;
a stable rerun passed. A strengthened test initially used a Bun asymmetric
matcher that mutated the inspected source value; capturing its primitive before
assertion corrected the test. Readonly-table and nullable-fixture type errors were corrected without
changing expectations. Preservation review caught a concurrent-replacement cleanup
race in an initial runtime-borrowing approach; isolated package-tree composition
removed all workspace writes, and real npm-pack races preserve the other build. The Packet value failure remains a product finding.
The first hosted run also caught a stale assertion requiring short onboarding
routers to repeat every family narrower; the complete reference assertion stays
in `llms.txt`, while installed-guide delivery remains with its filesystem owner.
A suspected empty-documentation test gap was rejected after the actual compiler
command failed with no inputs; it is not reported as a defect.

Full-suite and hosted matrix evidence belongs to CI. Local checks are focused;
real npm/OIDC publication, macOS and Windows release execution are not rerun by
this maintenance task. Platform smoke, exact publication bytes and production
rollback remain required when the owner authorizes a future release.
