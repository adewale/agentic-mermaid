# Lessons Learned — Loops 1 through 14

This document replaces the Loop 1 retrospective. It is the cumulative
narrative across the agentic-mermaid fork. Each section reflects what a
critic or implementer wished they had known when they started.

## (a) What we wish we'd known

When we started this fork we built a class diagram parser, then an ER
parser, then a class-body mutation surface, then an ER-body mutation
surface. Loop 6 finally did the ecosystem survey we should have done in
Loop 1 and discovered that `mermaid-ast` already existed — a community
package that parses a much larger surface than ours and would have made
the structured-uplift path much shorter. The same survey turned up
`nereid`, `mermaid-skill`, `mermaid-fixer`, and a half-dozen smaller
projects. None of them is a strict superset of what we built; several
overlap. The right move at Loop 1 would have been: survey first, then
build.

We also wish we'd known the determinism property of ELK was a property of
its configuration, not its API. We invested in a `withSeededRandom` /
`LayoutContext.rng` wrapper that did nothing — seed 1 and seed 999999
produced byte-identical output because ELK never read `Math.random` on
our path. That apparatus shipped in v3 and was deleted in v4 once we
realized. A short empirical probe in Loop 1 would have saved a Loop 3.

## (b) Our differentiators vs the ecosystem

After the survey, the position we hold that no other package holds is
the *combination* of:

- **Structured-or-opaque rule.** Every diagram family either has a full
  structured body (six families: flowchart, state, sequence, timeline,
  class, ER) or stays opaque with byte-fidelity round-trip (journey,
  xychart, architecture). We never silently drop a construct.
- **Tiered verification.** Tier 1 (structural — reliable, universal),
  Tier 2 (geometric — flowchart-shaped), and as of Loop 7 a Tier 3 plugin
  hook via `FamilyPlugin.verify`. Tier 1 is gated; Tier 2 is advisory.
- **Determinism, cross-process and cross-runtime.** Three separate bun
  processes produce byte-identical layout JSON; bun and node produce
  byte-identical layout JSON on the same source. Both tests run on every
  PR.
- **Corpus gates.** The 247-sample mermaid-js docs corpus and the
  132-case MermaidSeqBench both run as PR gates; regressions break the
  build with a named diff.
- **Agent-contract verbs.** `am capabilities --json` (Loop 7) lets an
  agent introspect what the SDK can do without trial-and-error; `am batch
  --jsonl` (Loop 7) bulk-runs ops without the per-call subprocess overhead.
- **Code Mode MCP.** One `execute` tool, typed `mermaid.*` SDK in scope,
  sandboxed via `node:vm`. The agent writes the algorithm; we don't grow
  the verb set.

Mermaid-ast ships structured parsing for more families than we do; it
does not ship verify, mutate, capabilities, batch, or Code Mode. Nereid
ships a renderer; it doesn't ship parse-and-mutate. The
structured-or-opaque rule + cross-runtime determinism + agent verbs is
the differentiator stack.

## (c) What structured-or-opaque taught us

The rule "never silently drop a construct" has been load-bearing in ways
we didn't anticipate. When a sequence diagram has `alt`/`loop`/`opt`
blocks that the structured sequence body doesn't model, we fall back to
opaque. The agent can still verify, render, and round-trip — it just
can't call structured mutation ops on that diagram. The type system
rejects the call statically. The user experience is "you can intentionally
edit the preserved opaque body.source and re-parse/verify," not "your diagram broke."

The opposite rule (parse what you can, throw away the rest) would have
been simpler to implement and would have been catastrophic in practice.
A repo with N sequence diagrams, of which 30% use `alt` blocks, would
have silently lost those blocks on every round-trip. We learned in Loop
2 that byte-fidelity round-trip is not a "nice to have" — it is the
contract that makes structured editing safe for agents.

A second learning: a narrower IR enables more confident mutation. We
intentionally kept `FlowchartGraph` and `StateGraph` small. The mutation
surface (`add_node`, `remove_node`, `add_edge`, etc.) is short because
the IR is short. When the IR is short, every op has a clear preimage and
postcondition, and `verify` can check both. Wide IRs grow ops that
nobody can reason about end-to-end.

## (d) Cost / value of the corpus + LLM-judge

The 247-sample mermaid-js corpus has paid for itself twice. In Loop 5 a
state-diagram round-trip regression slipped past the unit tests because
our hand-written fixtures didn't cover the exact `note left of` /
`note right of` pattern; the corpus caught it within seconds. In Loop 7
the corpus catches every layout / serialize change that affects more
than a single fixture.

The live-model eval stance (from Loop 5 onward) is intentionally
periodic-not-per-PR. Running it on every PR would dominate the wallclock
budget and produce a grade that is statistically noisy across runs. The
current deterministic harness is `bun run eval/agent-usage/run.ts`; live
model transcripts remain a pre-release/on-demand task tracked in `TODO.md`.
Net: cheap, high-signal, not always-on.

## (e) Process changes for Loop 8 and later

- **Survey first, build second.** Before adding a new family parser or
  serializer, search the npm registry and GitHub for prior art. Spend
  half a day before spending two weeks.
- **Commit per milestone.** Loop 6 stalled silently because the
  implementer agent batched everything and ran out of budget without
  pushing. Loop 7 made each milestone its own commit + push and the
  result is visible progress that the next implementer can verify.
- **Use the Workflow tool for end-to-end cycles.** When the plan calls
  for "do X, run tests, commit, push, do Y, run tests, commit, push,"
  the autopilot / workflow harness handles the bookkeeping correctly.
  Manually orchestrating commits inside one agent thread is what stalled
  Loop 6.
- **Document scope cuts honestly.** Loop 7 cut the Loop 6 mermaid-ast
  structured uplift, the SVG `--compact` mode, the CSS-variable font
  override, the TTY guard, and `renderAsciiWithMeta()`. Those cuts live
  in the PR description so the next loop doesn't have to rediscover
  what's missing.
- **Probe before fixing.** Loop 7's pathfinder-determinism fix was
  *not* a fix — a 10-run probe showed the code was already deterministic.
  The "fix" became a regression guard. Cheaper to probe than to ship a
  speculative change.

## Loop 8 + 9 lessons (PNG export + finish-the-backlog)

- **Implementer stalls happen — design for recovery.** Loop 8's
  implementer hit a content-filter at minute ~19 mid-M5. Loop 9's
  implementer hit a 500 server error at minute ~27 mid-B11. Both
  were recoverable because **commit-per-milestone was treated as
  load-bearing** in the hardened plan. The 8 Loop 9 milestones
  (A1-A10) landed cleanly before the stall; B11 was a clean
  pickup. The plan structure IS the recovery scaffold.
- **Skip the planner/critic phase when the prompt already encodes
  prior critic feedback.** Loop 8 took critics from prior loops as
  given (embedded in the user's prompt) and went straight to
  implementer. Worked. Loop 9 spent budget on planner + 5 critics
  for a hardened plan that was 90% pre-decided by the user — the
  remaining 10% was incremental.
- **Honest scope cuts beat over-promising.** Loop 9 shipped 13 of
  16 milestones. The 3 cuts (B14 pathfinder, C15 mermaid-ast
  journey/xychart, C16 plugin consolidation) are documented in
  DIVERGENCES.md with concrete reasons (context budget; mermaid-ast
  transitive deps broken; refactor too large for remaining budget).
  Loop 10 picks them up with no mystery.
- **Probe dep availability before committing to a dep-based plan.**
  Loop 9's C15 cut wasn't a budget call — it was a dep-availability
  call. `mermaid-ast` is installed but its transitive `langium` →
  `vscode-jsonrpc` → `@chevrotain/regexp-to-ast` chain is broken in
  the sandbox. A 30-second `bun -e "require('mermaid-ast')"` probe
  at plan time would have surfaced this. Lesson: validate the
  dependency you're building on actually loads before spec'ing the
  work around it.
- **Direct execution beats subagent-spawn when stalls compound.**
  Loop 9's recovery used direct execution (no subagent spawn for the
  remaining B11/B12/B13 milestones). Past two implementer stalls in
  consecutive loops made the spawn-cost no longer worth it. The
  workflow-orchestration value of subagents is real (parallel
  critics, isolated context windows), but a third consecutive stall
  would have been wasted minutes. Direct execution + per-milestone
  commit is the fallback recovery mode.

## Loop 10 lesson — verification passes must observe behavior, not grep

Loop 10's pre-flight verification claimed 5 ecosystem gaps were open.
THREE were already implemented:
- #116 auto-contrast: I grepped `theme.ts` (found only shadow-luminance)
  and missed `renderer.ts`'s `contrastTextColor`. The feature worked.
- #113 fanout trunk-sharing: I never checked `edge-bundling.ts`, which
  already does fan-out bundles with shared trunks.
- #67 root detection: already in `grid.ts`; I under-counted coverage.

Only #81 (CSS classes) and #66 (A* OOM guard) were genuine gaps.

The mistake: a verification pass that greps ONE plausibly-related file
and concludes "not done." The fix: **render the actual feature and
observe the output** before declaring a gap. For #116 that's one
`renderMermaidSVG('...style A fill:#000') → check text fill` — 10
seconds, definitive. Grepping the wrong file is worse than not checking,
because it produces false confidence.

Cost this time was low — I added regression tests for already-working
features (net positive: they were untested). But the same false-negative
on a "build it from scratch" item would have meant rebuilding what
exists, or worse, a second parallel implementation. When the verification
says "gap," the bar to act on it is: reproduce the absence by running the
code, not by reading one file.

The flip side worked well: committing per milestone with honest commit
messages ("already implemented; added coverage") kept the record
truthful. The PR history shows exactly which items were built vs
already-present vs documented-cut — no inflation.

## Loop 11 lesson — observation-first verification worked

Loop 10's failure was grep-based verification (3 of 5 "gaps" were already
built). Loop 11 applied the corrected method: before scoping the work, I
RAN the code and inspected output — rendered two diagrams and diffed their
ids (#7540 confirmed real), rendered with accTitle and checked for <title>
(#7254 confirmed absent), scanned output for external-fetch vectors (#7645
confirmed @import-only). All 5 targeted items were genuine. Zero false
negatives, zero rebuilt-what-existed waste.

The cost of observation-first is ~5 minutes of running snippets up front;
the cost of getting it wrong (Loop 10) was rebuilding-risk + a misleading
scorecard. Observation-first is now the default for any "are we missing X?"
question.

A second Loop 11 note: the localized-post-pass pattern (namespaceSvgIds,
injectAccessibility) keeps paying off. Both #7540 and #7254 could have been
threaded through the 8 family renderers; instead a single post-render
string rewrite in the resolve() funnel handled every family at once, with
no blast radius into renderer signatures. When a feature is expressible as
"rewrite the finished SVG," prefer that over threading state through the
render tree — it's testable in isolation and family-agnostic by default.

## Loop 12 lesson — benchmark honesty, even when it stings

The benchmark milestone was the one most at risk of motivated reasoning:
we'd been claiming "compete on correctness" for several loops with zero
numbers. The temptation is to measure only the axes we win.

What actually happened when I ran it: **termaid cold-starts in ~102ms;
our Bun CLI takes ~870ms.** termaid beats us on the exact thing (ASCII to
terminal) we'd positioned as our turf. The honest move — recorded in
RESULTS.md and the commit — was to say so plainly, and to relocate our
actual differentiator: not ASCII speed, but the agent surface (AST,
verify, mutate, SVG/PNG, MCP, determinism, structured errors) that
termaid doesn't have. Against mmdc the story IS decisive (browserless,
3x faster cold, 5x smaller), and that's measured too.

Two process notes:
1. Attempting the competitor installs for real was worth it. mmdc's
   "headless Chrome refuses to run as root" failure isn't a number I
   could have honestly asserted from docs — running it turned a claimed
   weakness into a demonstrated one. And termaid actually running turned
   an assumed win into an honest loss-on-one-axis. Observation beat
   assumption in both directions.
2. The benchmark exposed a concrete roadmap item (single-binary, #1018)
   that would close the cold-start gap. A benchmark that only flattered
   us would not have produced that.

Also Loop 12: a fixed bug (M4 rgb-comma-split) had been deferred twice
(found Loop 10, deferred Loop 11). The fix was ~15 lines. Lesson: small
real bugs accumulate interest when deferred; a "found it, here's the one
-liner repro" item should usually be fixed in the loop it's found, not
filed.

## Loop 13 lesson — the closed loop is the real risk now

The single most important realization of this whole arc: **13 loops of
work sit in one unmerged PR (#11), and every quality signal is
self-generated.** Our tests, our 247-corpus, our MermaidSeqBench wiring,
our benchmark, our LLM-judge, our agent-usage harness — all authored by
the same effort that authored the code. That's not worthless (it caught
real bugs: the state round-trip regression, the marker-id collision, the
A* OOM, the rgb-comma split), but it has a ceiling. A closed build→
self-review→build loop produces breadth and internal consistency and
*cannot* produce the one thing that matters most: evidence that a real
external consumer is served.

We should have sought a merge + a real consumer around Loop 5-6, not
Loop 13. The pattern to avoid in future efforts: treating "more features,
all green" as progress when the artifact has never left the lab. Shipping
surface is not the same as shipping value.

What Loop 13 itself added that points the right way:
- **The agent-usage harness (M6)** is the closest we've come to measuring
  the thing that matters — but even it has a scripted agent, not a real
  one. The real validation (Layer 3) needs a live model and, ideally,
  real tasks from a real consumer.
- **The benchmark + single-binary (M3)** were both honesty wins: the
  binary halves cold-start but doesn't beat termaid/Go, and we said so.
- **The TODO.md backlog (M1)** finally names the three non-code blockers
  (rename, merge, consumer) as first-class items instead of leaving them
  implicit.

The recommendation that's now written into TODO.md: stop adding features;
merge, name, publish, and get one real consumer. The next loop that adds
a feature instead of pursuing those is probably the wrong loop.

Smaller Loop 13 notes:
- bun-compiled binaries embed the runtime (112MB) and the resvg native
  addon embeds cleanly — PNG works from the single binary. Good surprise.
- Extracting `renderFileOnce` made --watch testable without fighting
  fs.watch timing — same "pure core + thin imperative shell" move that
  made the post-pass features (namespaceSvgIds etc.) testable.

## Loop 14 lesson — consistency is a feature, not cleanup

Rebasing PR #11 onto `main` was mechanically easy; the dangerous part was
not the code merge, it was the contract drift hiding in docs and capability
metadata. The branch had accumulated several small inconsistencies:

- PR title still described Loop 7 even though the branch had become Loops
  7-13.
- `FEATURES.md` and generated `llms.txt` claimed MCP `query`/`xref` tools
  that do not exist. The real surface is primary `execute` plus narrow
  `render_png` and `describe` helpers.
- `am capabilities` under-reported output formats (`svg`, `ascii`, `png`)
  even though the CLI also supports `unicode` and `json`.
- The capability envelope was reporting plugin-internal hooks rather than
  the public agent surface, so it implied most families could not parse,
  serialize, or verify even though `parseMermaid` / `serializeMermaid` /
  `verifyMermaid` support all registered families.
- Tier 3 docs described an opt-in lint layer as if it shipped today. The
  honest state is: plugin verify hooks are wired, built-ins use them for
  Tier 1 structural checks, and Tier 3 lint codes are reserved.

These are not cosmetic mismatches. Agent-facing software is consumed by
machines that rely on the manifest. A stale `capabilities` response sends
agents down the wrong path; a doc-only MCP tool wastes a tool call and
teaches distrust; a stale PR title causes reviewers to review the wrong
change. For agent-native products, **the docs, schemas, generated digests,
CLI help, and PR title are part of the runtime surface**.

Two practical rules came out of the rebase:

1. **After every scope-changing loop, run a contract-drift audit.** Grep
   for old tool names, output formats, package names, and roadmap statuses;
   then compare the results to live CLI/MCP output. In this loop, the
   decisive command was `am capabilities --json`, not reading the docs.
2. **Regenerate ignored artifacts before browser/e2e tests.** The first
   post-rebase browser run failed because ignored `editor.html` was stale
   from a previous branch. `bun run editor.ts && bun run test:browser` is
   the safe sequence. A generated file outside git can still poison local
   verification.

The deeper lesson: once a branch is large, consistency work is no longer
"polish." It is how you make the branch reviewable and trustworthy enough
to merge. Stop feature work, align the contract, then ship.
