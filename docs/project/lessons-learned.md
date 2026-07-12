# Lessons Learned — Fork Narrative and PR Retrospectives

This document replaces the Loop 1 retrospective. It is the long-form
cumulative narrative across the fork's first 22 loops and subsequent major
PRs. Each section reflects what a critic or implementer wished they had known
when they started.

> **Scope.** This is the long-form fork narrative. For dated, incident-tagged
> contributor process lessons ("add new at the top"), see
> [`../contributing/lessons-learned.md`](../contributing/lessons-learned.md).

## Loop index and status

“Loop” was the name for the fork's early numbered implementation/review cycles;
it is not a current release phase or an open-work status. Loops 1–22 are
historical and complete. After Loop 22, major work is recorded by PR/issue
retrospectives rather than inventing Loop 23+ numbers.

| Loop(s) | Historical focus | Status |
|---|---|---|
| 1–7 | Parser/mutation foundation, structured-or-opaque fidelity, determinism experiments, corpus/eval setup, ecosystem survey, and the first agent verbs (`capabilities`, `batch`). The surviving record is cumulative rather than a reliable milestone-by-milestone ledger. | Complete; lessons consolidated in sections (a)–(e). |
| 8–9 | PNG export and backlog completion under recoverable, commit-per-milestone execution. | Complete. |
| 10 | Replace grep-based gap claims with executed behavioral probes. | Complete. |
| 11 | Apply observation-first verification and localized SVG post-passes. | Complete. |
| 12 | Benchmark honestly, including competitor wins. | Complete. |
| 13 | Treat the closed agent loop and real-consumer workflow as the product risk. | Complete. |
| 14 | Make consistency and generated-surface synchronization explicit contracts. | Complete. |
| 15 | Start from the agent contract when replaying or extending a feature. | Complete. |
| 16 | Replace visual “vibes” with executable layout heuristics. | Complete. |
| 17 | Measure heuristic blast radius before accepting layout changes. | Complete. |
| 18 | Prefer evidence from actual agent behavior over imagined ergonomics. | Complete. |
| 19 | Distinguish CI-green from adversarial audit-clean. | Complete. |
| 20 | Treat hidden family registries and synchronized surfaces as product APIs. | Complete. |
| 21 | Treat tracked exceptions as gap maps, not permanent permission slips. | Complete. |
| 22 / issue #71 | Treat abstractions as product contracts, with migration and naming consequences. | Complete. |
| Post-22 | PR #54, #64, #79, #94, the agent-edit boundary, and PR #142 carry subsequent retrospectives. | Ongoing chronology; no numbered Loop 23 exists. |

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

- **Structured-or-opaque rule.** Every built-in renderable family has a
  structured body for its modeled syntax, and opaque/source-preserved
  fallback when a construct is unmodeled. We never silently drop a construct.
- **Tiered verification.** Tier 1 (structural — reliable, universal),
  Tier 2 (geometric — flowchart-shaped), and Tier 3 (lint — family-specific
  common agent mistakes). Tier 1 is gated; Tier 2 and Tier 3 are advisory.
- **Determinism, cross-process and cross-runtime.** Three separate bun
  processes produce byte-identical layout JSON; bun and node produce
  byte-identical layout JSON on the same source. Both tests run on every
  PR.
- **Corpus gates.** The 271-entry mermaid-js docs corpus and the
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

The mermaid-js docs corpus (now 271 entries) has paid for itself twice. In Loop 5 a
state-diagram round-trip regression slipped past the unit tests because
our hand-written fixtures didn't cover the exact `note left of` /
`note right of` pattern; the corpus caught it within seconds. In Loop 7
the corpus catches every layout / serialize change that affects more
than a single fixture.

The live-model eval stance (from Loop 5 onward) is intentionally
periodic-not-per-PR. Running it on every PR would dominate the wallclock
budget and produce a grade that is statistically noisy across runs. The
current deterministic harness is `bun run eval/agent-usage/run.ts`; committed
subagent-backed transcript sets replay in CI, while direct API-backed captures
remain a pre-release/on-demand task when credentials are available. Net: cheap,
high-signal, not always-on.

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
  `docs/project/divergences.md` with concrete reasons (context budget; mermaid-ast
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
self-generated.** Our tests, our docs corpus, our MermaidSeqBench wiring,
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
- **The TODO.md backlog (M1)** finally names the non-code blockers
  (publish-name decision and real external consumer) as first-class items
  instead of leaving them implicit.

The recommendation that's now written into TODO.md: stop adding features;
finish the naming/publish decision and get one real consumer. The next loop
that adds a feature instead of pursuing those is probably the wrong loop.

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
- `docs/features.md` and generated `llms.txt` claimed MCP `query`/`xref` tools
  that do not exist. The real surface is primary `execute` plus narrow
  `render_png` and `describe` helpers.
- `am capabilities` under-reported output formats (`svg`, `ascii`, `png`)
  even though the CLI also supports `unicode` and `json`.
- The capability envelope was reporting plugin-internal hooks rather than
  the public agent surface, so it implied most families could not parse,
  serialize, or verify even though `parseMermaid` / `serializeMermaid` /
  `verifyMermaid` support all registered families.
- Tier 3 docs once described an opt-in lint layer before one shipped. The
  honest state then was "reserved"; the current shipped lint catalogue is
  explicit and small (`DUPLICATE_EDGE`, `UNREACHABLE_NODE`) so capabilities,
  docs, and emitted warning codes stay in lockstep.

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
   from a previous branch. `bun run editor && bun run test:browser` is
   the safe sequence. A generated file outside git can still poison local
   verification.

The deeper lesson: once a branch is large, consistency work is no longer
"polish." It is how you make the branch reviewable and trustworthy enough
to merge. Stop feature work, align the contract, then ship.

## Loop 15 lesson — if we replayed PR #11, start with the agent contract

If we could do this branch again from scratch, the biggest change would be
sequence. We built a lot of correct pieces, but too many of the governing
rules emerged after the implementation already existed. The better order
would have been:

1. **Write the agent contract first.** Define the public surface before
   adding features: docs, schemas, CLI help, MCP declarations,
   `llms.txt`, package exports, and examples. For an agent-native library,
   those are not downstream documentation; they are the API that agents
   actually consume.
2. **Decide structured-vs-source-level policy up front.** We eventually
   landed on structured mutation for every built-in renderable family, with
   source-level-only editing reserved for opaque fallback bodies where
   unmodeled syntax was preserved losslessly. That policy should have existed
   before mutation ops were exposed. Render support is not mutation support,
   and an unsafe typed edit is worse than no typed edit.
3. **Separate greenfield creation from existing-diagram edits earlier.**
   We over-corrected toward "always mutate" before recognizing the useful
   distinction: new diagrams can often be authored directly as Mermaid
   source, then parsed/verified/rendered; existing structured diagrams
   should go parse → narrow → mutate → verify → serialize. This also led
   to the right eval metric split: `safePathRate` is not the same thing as
   `structuredPathRate`.
4. **Build the canonical examples at the beginning.** The MCP-vs-CLI
   parity example and the agent-improvement loop should have been seed
   fixtures, not late validation. A runnable example that creates a
   complicated diagram through MCP and CLI, plus another that creates →
   assesses → mutates → reassesses → renders, would have clarified the
   intended product shape and prevented doc drift.
5. **Treat `verify.ok` as structural, not visual.** The Auth Flow episode
   made this concrete: the diagram verified while the layout was visually
   poor. Geometry assertions, source-order assertions, and screenshot/PNG
   regressions should have been part of the layout work from the start.
6. **Pin the Code Mode security model before marketing the feature.** We
   eventually enforced read-only SDK results, trusted diagram lineage,
   synchronous execution, no host constructors/functions, and explicit
   `node:vm` caveats. Those rules should have been written before the MCP
   story shipped. We also should have avoided any wording that implied a
   current Cloudflare Codemode or Worker integration.
7. **Keep the branch smaller and merge earlier.** PR #11 accumulated
   agent APIs, CLI affordances, MCP design, docs, security hardening,
   visual/layout fixes, evals, examples, and repository cleanup. Most of
   those are valuable, but their combination made review harder and made
   the closed-loop risk worse. A better path would have been: ship the
   minimal honest agent contract, get one external consumer, then add the
   next layer.

The high-order lesson is that agent-native work is contract-first work.
The implementation can be correct and still be hard to trust if the public
surface, examples, evals, and docs are not aligned from day one. If we
replayed this branch, we would start with a small runnable contract,
exercise it through MCP and CLI immediately, and let that contract decide
which implementation work belongs in the branch.

## Loop 16 lesson — layout quality needs executable heuristics, not vibes

The bad-layout work only became tractable once the complaint was converted
into geometric oracles. "Looks wrong" turned into concrete assertions:
acyclic edges should progress in the declared direction, unrelated edge
segments should not cross node boxes, feedback-heavy processes should keep
clean routes, self-loops need visible clearance, and `verify.ok` still does
not mean the diagram is visually good. Those checks are cheaper and more
reviewable than screenshot-only debugging, and they explain failures in
terms a layout algorithm can act on.

The red phase mattered. The new fan-in/fan-out heuristic caught real
backward `TD` edges (`A2 -> A`, `B2 -> B`) before the fix. The green phase
was not a broad renderer rewrite; it was a source-aware, cycle-tolerant
model order that adds source-before-target constraints unless they would
turn a feedback edge into a forward edge. That preserved the Auth Flow
lesson from Loop 15: feedback loops should route backward, but acyclic
edges should not accidentally point backward because parser insertion order
was target-biased.

The refactor lesson: layout defaults are shared infrastructure, so every
fix needs a blast-radius check. The first implementation improved
flowcharts but perturbed architecture snapshots and group-boundary routing.
The durable version made the exception explicit: architecture, as a
projected family, preserves direct child order inside groups while still
letting root-level group/service siblings use source-aware ordering. The
iconless-service regression exists because shape-based inference was too
implicit; when preserving semantics matters, pass the intent explicitly.

Finally, Cloudflare CodeMode belongs in the backlog only as an honest
future deployment path, not as accidental marketing copy. A Worker-hosted
Agentic Mermaid app may make sense, but it needs a scoped security model,
auth/rate limits, persistence, and parity with the current CLI/MCP/library
contract. Naming it in `TODO.md` is useful; implying the local `node:vm`
MCP is already Cloudflare CodeMode would be a contract bug.

## Loop 17 lesson — measure blast radius before believing a layout heuristic

The audit loop (PR #17) ported two upstream layout ideas and rejected a
third, and the difference between the three outcomes was instrumentation.
The before/after comparison harness (`eval/layout-compare/run.ts`) was
built first, as a prerequisite, and immediately earned its keep: the first
fan-in grouping implementation used blanket in-degree and silently wrecked
three state-machine corpus samples — Off ⇄ On toggle pairs were treated as
fan-in joins and dragged sideways into label collisions. No unit test
caught it; the corpus-wide diff did. The refined heuristic (exclude
self-loops and 2-cycle back-edges) shipped with evidence: one sample
improved, zero regressed. The drift sentinel forces you to *acknowledge*
layout changes; only a before/after instrument lets you *judge* them.

Second lesson: upstream evidence beats upstream rules. Upstream PR #127
proposed a strict per-side ER cardinality grammar, but the mermaid-docs
corpus — scraped from Mermaid's own documentation — uses `o{` on the left
(`o{--||`), which that rule would reject. The right token set was the
side-agnostic Mermaid lexer set that `er-body.ts` already used. When an
upstream fix and the upstream corpus disagree, the corpus wins.

Third: layout fixes that ship upstream as coordinated sets must be ported
as sets. A minimal cherry-pick of PR #113's preferred-direction A* change
visibly broke our trunk post-processing (stray corners, a diagonal
arrowhead) because the upstream fix only works together with its FIFO heap
tie-breaking and branch-point re-routing. Probe, observe, revert fast,
and scope the full port honestly (BUILD-10) instead of pushing through.

Third, resolved (BUILD-10) — and the resolution sharpens the lesson:
"port the whole set" does NOT mean "every upstream hunk lands." It means
port the *coordinated intent*, then let this fork's own architecture decide
which hunks are load-bearing. Of PR #113's four parts, only two were needed
here: (1a) deterministic FIFO tie-breaking in the pathfinder MinHeap and
(3b) label placement preferring the per-sibling vertical drop in TD. Those
two alone reproduced the upstream golden byte-for-byte AND kept the LR
box-start repro byte-identical. The other two — (1b) `preferredDir` A*
neighbour reordering and (2) explicit branch-point re-routing — REGRESSED
trunk rendering exactly as the minimal probe had (stray `+`, `◢`, broken LR),
because this fork already carries trunk machinery upstream lacked
(edge-bundling for unlabelled siblings) plus the new FIFO determinism; the
reorder/re-route then fought routing that was already correct. The general
rule: when a fork has diverged, an upstream fix is a hypothesis about *intent*,
not a patch to apply verbatim. Bisect the set against the fork (here: an
env-var gate per part + the corpus diff isolated the two that mattered in
minutes), ship the minimal load-bearing subset, and sabotage-test it
(reversing the FIFO tie-break alone re-introduces the `─center*─` detour,
proving it is the actual lever). Dead upstream scaffolding (the `preferredDir`
param) is kept only when it is a real, separately-tested capability.

Fourth: a documentation gap on an agent surface *is* an API gap. An audit
subagent reading our own docs concluded state diagrams were not mutable,
because every narrower list omitted the actual path (`asFlowchart` narrows
state bodies). The code was right and the consumer still failed. The fix
was a sentence on every agent surface plus a doc-sync guard that fails if
any surface claims state mutation without documenting the narrowing path.

Fifth: "100% parse success" is not faithfulness. The ER `}o` bug lived
inside a fully gated corpus for the same reason it shipped: the gate
asserted parsing, while the renderer silently dropped the relationship and
its entities. Faithfulness needs node/edge-count oracles — the harness now
treats any count change as a regression by default.

## Loop 18 lesson — evidence-backed agent work beats imagined ergonomics

The release-model transcript work and the failure corpus changed the quality
of the backlog. Before EVAL-1/EVAL-2, the agent loop mostly measured our own
scripted ideal path. Capturing pi-subagent-backed transcripts and preserving
known-bad raw responses made the next feature decisions less speculative:
Tier 3 lint should start with observed agent mistakes (`DUPLICATE_EDGE`,
`UNREACHABLE_NODE`), not a grand style-guide catalogue.

The same rule applied to BUILD-7. **MCP reachability was not just "start an
HTTP server."** The durable shape was transport-neutral behavior (stdio and
HTTP/SSE call the same `handleRequest` core), session lifecycle correctness,
safe artifact storage, and URL/file outputs that do not become an arbitrary
file-write primitive. The useful contract is `{path,url,mimeType,bytes,sha256}`
for large or binary outputs, with loopback defaults, authenticated remote
binding, content-type/Origin gates, size limits, TTL/cleanup, and tests that
fetch the artifact back and verify its bytes.

**BUILD-2 is not "rename verify and format."** `process --mode
validate|canonicalize` only deserves to exist if it reduces agent routing
errors relative to today's explicit verbs (`verify`, `format`, `parse`,
`serialize`, `mutate`, `batch`). The right next step is a triage artifact: write
the exact JSON envelope and exit-code contract, run it against docs/evals, and
then either implement a thin schema-tested wrapper or deliberately park it. A
wrapper that only adds another synonym would make the contract larger without
making agents safer.

## Loop 19 lesson — CI-green is not the same as audit-clean

PR #30 was GitHub-green before it was ready. The browser e2e failure was fixed
first, but the remaining non-CI audit found real route defects: text-embedded
long links lost their rank length, non-incident nodes could be moved onto a
certified route without a `ROUTE_STALE_AFTER_NODE_MOVE`, and nested subgraph
edges were extracted in the wrong coordinate frame. The lesson is not "make CI
run everything"; it is "know which proof each gate provides." CI proved the
standard package and browser path. `audit:ugly`, route-contract properties, and
focused nested-subgraph tests proved layout-contract claims the normal CI did
not yet cover.

The route-contract work also exposed a metadata bug: a fixed-point retry can
first straighten an edge and later downgrade it to an explained detour. The
geometry was acceptable, but the certificate still carried a stale
`straightened` bit until the finalization pass recomputed bend counts and
cleared impossible flags. For proof-carrying layout, certificates are part of
the artifact, not logging. If later passes can mutate geometry, final facts must
be recomputed after all retries, and property tests should assert the certificate
matches the final route.

Nested subgraphs taught a coordinate-frame rule: `INCLUDE_CHILDREN` and
`SEPARATE` hierarchy modes have different edge-hosting semantics, and both need
regressions. Edges such as `outer/A -> inner/B` must be hosted at their lowest
common compound so extraction adds the right absolute offset. Edges to a
subgraph id such as `X --> Pipeline` target the container box, not a phantom
root node and not an internal child. Direction overrides are exactly where this
becomes dangerous, because an empty or mis-hosted external segment can pass unit
shape checks and then crash a later straightener.

Finally, grammar support and route support have to move together. Mermaid's
text-embedded label syntax splits the operator around the label (`-- No ---->`,
`-. Maybe ..->`, `== Sure ====>`). Treating that as just label parsing silently
collapsed authored link length during canonical serialization. The pinned tests
now parse, serialize, and re-parse the length. The general rule: when a syntax
feature affects layout rank, preserve it in the parser even if the renderer's
visual output looks acceptable.

Process note: reviewer subagents are useful, but only as another signal. The
reviewer caught the stale `straightened` counterexample after the main fixes;
local focused tests then reproduced it, a pinned regression locked it, and a
second reviewer pass returned no blockers. Mutation testing remains a gap map,
not a PR gate: the route run was attempted and timed out after partial progress,
so it is evidence to schedule, not evidence to block the merge.
## Wrapper-fidelity lesson — official examples are a free conformance corpus, and laws need named constructs

Three sessions of research work (the layout-complaint catalog, the `@{ shape }`
silent-loss bug, and the wrapper-fidelity batch) converged on one method and
one contract lesson.

**The method: probe official documentation examples through the round-trip,
not just our own fixtures.** The `@{ shape: ... }` silent-loss bug (BUILD-23,
issue #29) was found by taking the Mermaid docs' own typed-shape syntax and
running it through `parseMermaid → serializeMermaid`; the wrapper-fidelity
gaps (BUILD-21) were found the same way with the syntax-reference's
frontmatter examples. Both were violations of guarantees we believed we had:
the `@{}` case fabricated phantom nodes from metadata keys with
`verify.ok: true`; the frontmatter case flattened `config:`-nested keys into
top-level YAML Mermaid silently ignores — so an edit loop *kept the bytes*
that expressed the author's `config.layout` request while *killing their
meaning* on interop. Neither was caught by 2,200+ tests, the 258-entry
corpus, or the round-trip floors, because every fixture we owned was written
by people who already knew what the parser modeled. Upstream documentation
examples are adversarial in exactly the right way: they encode what real
sources will contain, not what our parser expects. The standing rule:
whenever Mermaid documents a syntax surface, its examples belong in our
round-trip/verify corpus before we claim compatibility — secondary-source
blog posts are leads, but the probe against the live code is the evidence.

**The contract lesson: a preservation law that doesn't name construct classes
hides loss in the gaps between its clauses.** The structured-or-opaque law
said "any line your parser does not model must be preserved verbatim" and
"structured bodies serialize to canonical source." Wrappers and comments fell
between those clauses: frontmatter was *re-synthesized* (neither preserved
nor canonical-to-Mermaid), directives were duplicated, and comments were
dropped — each defensible under one clause, all violations of the law's
intent. The fix wasn't more cleverness; it was naming the constructs and
their policies explicitly (owner decisions 1C/2C): wrappers round-trip
byte-verbatim with canonical synthesis opt-in; in-body comments are
canonicalized away but *announced* (`COMMENT_DROPPED`), never silent, with
segment preservation as the stated destination. The general form: for every
construct class a parser can encounter — body statements, wrappers,
directives, comments, future `@{}` metadata — the contract must state one of
*modeled*, *preserved-verbatim*, or *dropped-with-warning*. "Canonical" is
not a policy; it's where unstated policies hide.

A smaller process note, same spirit as Loop 17's evidence rule: the
`COMMENT_DROPPED` detector diffs the parsed comments against the actual
serialized output rather than asking each family parser to report what it
kept. Families that preserve comments in opaque segments (sequence) are
correct by construction, and a future family that starts preserving them
stops warning without anyone updating a list. Detect by observing the
output, not by trusting per-family bookkeeping.

## Loop 20 lesson — hidden family registries are product surface

The Gantt good-citizen audit exposed a different failure mode than a parser
bug: a diagram family can be correctly implemented and still be only partly
present in the product. The first pass wired parser, renderer, mutation,
capabilities, docs, and PR evidence, but it still missed places that consume
"the list of families" indirectly: the live editor example picker, eval
fixture tags, generated `llms.txt`, `am init-agent`, MCP initialize guidance,
SDK declarations, stale policy language, and even the issue checklist that was
supposed to guide the work.

The root cause was twofold. First, there was no typed built-in-family registry
that all outward-facing projections were forced to agree with. Second, some
surfaces were treated as collateral documentation even though agents and users
consume them as runtime affordances. The durable fix is not a longer memory
checklist; it is a checked source of truth (`BUILTIN_FAMILY_METADATA`) plus
projection tests that prove every registered family appears in editor examples,
glyphs, eval fixtures, generated agent docs, CLI capabilities, MCP guidance,
and sandbox-callable narrowers.

The audit prompt that found the misses is worth preserving: ask "who consumes
this family list?" and then grep for the old nouns, not just the new feature.
Search for family names, narrowers, `source-level`, `examples`, `capabilities`,
`llms.txt`, `init-agent`, `initialize`, `tools/list`, SDK declarations, eval
manifests, sample galleries, generated site assets, package exports, and
private/holdback prompt manifests. Anything that teaches a human or model what
families exist is a product surface.

This also changes the good-citizen checklist. It must distinguish family
correctness from system citizenship. Correctness asks whether the parser,
serializer, verifier, renderer, and properties preserve the family semantics.
Citizenship asks whether every registry projection, generated artifact,
distribution bundle, editor sample, skill/eval prompt, CLI/MCP declaration,
and release artifact either derives from the registry or has a test proving it
is synchronized. A new family is not done when it renders; it is done when an
agent discovering the system through any supported entry point reaches the same
typed path.

## Loop 21 lesson — tracked exceptions are gap maps, not permission slips

Issue #41 made the good-citizen standard executable, and it also made one
thing impossible to hide: **there were historical family gaps.** That was not a
failure of the ratchet; it was the reason the ratchet existed. The BUILD-22
backfill closed the visible citizenship exceptions, but the process lesson
remains: older families do not need to instantly match a new evidence bar in
one PR, but any difference from that bar must be named, checked, and tied to a
live backlog item instead of living in a comment or reviewer memory.

The important distinction is between a **supported-family blocker** and a
**citizenship backfill gap**. A blocker means a public surface lies, data is
lost silently, or an agent is sent down an unsafe path. A backfill gap means
the family is usable through the current public contract, but lacks one of the
higher-confidence evidence lanes Gantt now has. The matrix in
`docs/contributing/diagram-family-citizenship.matrix.json` records those cells
as `exception` only when they point at `TODO.md`/issues; CI fails if an
exception is untracked or appears on a core surface.

The gaps #41 surfaced were concrete, and BUILD-22 closed the current matrix
exceptions:

- **Stable region assertions** now cover every registered family through
  `src/ascii/meta.ts` and `src/__tests__/agent-ascii-meta.test.ts`.
- **Targeted mutation or sabotage lanes** now exist for state, sequence,
  timeline, class, ER, journey, pie, and quadrant, alongside the pre-existing
  flowchart/link-routing, architecture+xychart, and Gantt lanes.
- **Executable upstream-docs harvest and divergence evidence** now covers all
  registered families via the regenerated 271-example Mermaid docs corpus plus
  `eval/mermaid-docs-corpus/divergences.json`. The cross-family parser/DB
  bench in `eval/mermaid-upstream-suite-bench/` now accounts for every current
  renderable-family BUILD-20 upstream block, while Gantt's deeper
  family-specific pilot remains in `eval/mermaid-gantt-bench/`.
- **Generated-site drift was real.** Pie, Quadrant, and Gantt were supported
  families but the sample gallery still lacked explicit color/prefix handling;
  #41 fixed that instance and added tests so future family categories cannot
  fall back silently.

The lesson: an exception ledger should make maintainers slightly
uncomfortable. If it reads as "we're allowed to ignore this," it has failed.
It should read as "this is the exact remaining work, this is why it is not a
merge blocker today, and this is the test/backlog hook that will fail if we
forget it." Good citizenship is therefore both a contract and a gap map: Gantt
sets the destination, the matrix records current state, and the upstream
ratchets keep the deeper-compatibility path executable beyond the now-closed
BUILD-22 matrix gaps.

## PR #54 audit lesson — closure PRs need adversarial self-review, not just green checks

The final #26/#38 closure pass exposed three classes of mistakes that ordinary
green tests did not make obvious enough:

- **Debug metadata can lie even when rendering looks fine.** Sequence self-message
  SVG drew a loop, but the layout JSON adapter initially flattened it to a
  two-point zero-bend line and certified that false geometry. Certificate tests
  must check the rendered family geometry, not just that a certificate object
  exists.
- **Generated-site inputs are docs too.** Updating `docs/features.md` and
  `docs/api.md` was not enough; pages such as `/differences` are generated from
  `scripts/site/*` copy and need the same capability audit as Markdown docs.
- **Seed ratchets are useful only when named honestly.** The first BUILD-20
  seed bench was valuable as a cross-family parser/DB smoke ratchet, but it
  had to be named as partial until the full accounted harvest replaced it. The
  current bench records imported blocks, excluded blocks, and zero deferred
  blocks so future readers do not mistake curated smoke coverage for
  comprehensive accounting.

The practice change: before merging a broad closure PR, run a fresh-context
review explicitly asking "what claims would become false if a consumer trusted
our debug metadata, generated site copy, or issue labels?" Then either fix the
claim or carve out a named follow-up.

## PR #64 lesson — "below perceptibility" is a reason to annotate, not to skip visual evidence

The issue #61 mixed-hub fix recenters a hub by a few pixels (worst
`peerBarycenterDelta` 8.0px → ~4.0px; the representative case 6.13px → 3.07px).
I rendered a raw before/after, saw the shift was invisible at full scale, and
cited good-pr's "don't pad a PR with near-identical screenshots" to justify
shipping *no* visual at all — only a numeric table. That inverted the rule. The
guidance forbids padding with screenshots that show nothing; it does not bless
omitting evidence for a genuinely visual change. For a small-magnitude geometry
change the correct move is to **make the change legible**: overlay the reference
geometry the metric is computed from — here, the incoming/outgoing barycenter
and hub-center guide lines, parsed from the rendered node rects rather than hand
placed — and/or zoom. "Too small to see raw" is an argument for an annotated or
zoomed artifact, not for its absence. A layout library whose own reviewer
checklist asks "is the hub centered over the peer group?"
(`docs/contributing/visual-review-evidence.md`) treats the picture as part of
the contract, complementary to the table and the tests, not replaceable by them.

Second, the artifact pattern already existed; I should have read it before
inventing a justification for skipping it. Git history and the contributing doc
already prescribe per-issue evidence scripts (`scripts/pr-assets/issue-NN-evidence.ts`)
that render BEFORE via a worktree at a base SHA and AFTER from the tree, writing
a committed composite to `docs/pr-assets/`, reproducible from source. The right
first step for any "should this PR have screenshots?" question is to grep the
history for how the repo did it last time, not to reason from first principles.

Third, a red→green check can be honest about magnitude *and* about which tests
discriminate the bug. This fix was probe-driven, with the ratchet tests written
after it worked; reverting only the implementation proved 18 tests genuinely
fail without the fix. But the same revert showed the small-fan-out `≤0.75px`
tests pass on the original code too — they are regression guards, not
bug-discriminating tests. A green suite where only a subset is load-bearing
should say so in the PR; claiming "N tests prove the fix" without separating the
discriminating tests from the guards overstates the evidence. Naming the
difference is the trust dimension, not a footnote.

## Loop 22 / issue #71 lesson — abstractions are product contracts, not cleanup

The commit history since the fork from Beautiful Mermaid has a pattern that is
easy to miss when looking at any one PR: the durable improvements were the
ones that turned a claim into an executable waist. The first fork commits made
rendering parity and fork positioning visible. The agent-native loop turned
"agents can edit diagrams" into typed parse/mutate/verify surfaces. The route
work turned "layout quality" into certificates, mutation scores, contact
sheets, and tripwires. Gantt and the family-citizenship work turned "we support
this family" into registry projections, generated docs, SDK declarations, eval
fixtures, and CI checks. Issue #71 is the same lesson at the architecture
level: an abstraction is not done when the code compiles; it is done when every
consumer reaches the same checked contract.

The original issue #71 spec was mostly right, but this session showed why old
specs need a second audit after the codebase has taught us more. The best
solution was not a body-only `FamilyPlugin.layout` hook; that would have made
opaque bodies, frontmatter, `%%init%%`, and accessibility directives second
class. The implemented solution made layout hooks source-context hooks. The
best solution was also not "iterate the registry map and trust insertion
order"; the history from family citizenship and generated-doc drift says
family order is a product surface, so built-ins now follow
`BUILTIN_FAMILY_METADATA` and external registrations sort after them.
Re-reading the spec against the academic literature, competitive examples, and
the repo's own failure history improved the design more than simply executing
the old checklist would have.

The docs audit after implementation was not administrative polish. It found
that current-facing docs still carried old nouns: `buildColors`,
`FamilyRouteCertificate`, and vague "route/family certificates." Those names
are part of the API an agent or maintainer learns from. Leaving them in public
docs would create a second abstraction in prose after the code had unified the
real one. Historical docs are allowed to keep old names, but they must label
their era; current docs must use current contracts. This is the same lesson as
the generated-site and `llms.txt` fixes: docs, skills, PR descriptions, and
generated assets are not collateral. They are discovery surfaces.

The practice change is concrete:

- Reappraise old specs before implementing them wholesale. Ask which claims
  are still true after the last 20 commits, not just whether the requested
  task is clear.
- Prefer thin waist contracts over universal models. `RenderContext`,
  `resolveDiagramColors`, `FamilyPlugin` hooks, and the certificate split each
  remove duplicated decisions without pretending SVG, ASCII, agent layout, and
  family-specific geometry are one IR.
- When a refactor renames an abstraction, grep the docs and skills for the old
  nouns before calling the PR done. Either update the reference or mark it
  explicitly as audit-time history.
- Use the fork's own history as evidence. If a prior lesson says generated
  docs drift, family lists drift, or visual claims need artifacts, treat that
  as a design constraint in the next abstraction PR, not as trivia from an old
  retrospective.

## PR #79 lesson — a certifying "freeze" is only as strong as its repair set, and contextual metrics couple edges

The pass-manifest work (PR #79, continuing #71/#26) shipped a certifying
straightener, `applyRouteContracts`, that classifies → straightens → certifies →
**freezes** node geometry. The intent was a principled contract: after the freeze,
routes are correct and carry a proof. What the four-round bug hunt actually taught
us is that **the freeze is not a fixpoint**, and the certificate is only as strong
as the set of repairs the certifier can perform.

**Post-freeze repair passes are a leak indicator, not a feature.** This PR added a
fourth pass that runs *after* the freeze to fix what an upstream pass produced:
`repairLabelsOnSharedTrunks`, `repairLabelsOffOwnRoute`, `reanchorOffOutlineEndpoints`,
and now `rerouteEdgesThroughNodes`. Each exists because a node-mover
(`equalizePeerNodeDimensions`, `honorLinkRankDistance`, `alignPortLanes`) mutates
geometry without re-establishing the contract's invariants, and the certifier
cannot always repair the result. Two concrete blind spots in the certifier's own
escape logic were the proximate cause of round 4: `tryZRoute` has no in-span escape
lane when the obstacle is exactly as tall as the endpoints, and `tryEscapeDetour`'s
first stub is rejected as a channel conflict when a sibling edge shares the source
exit lane (there was a shared-*target* fan-in exemption but no shared-*source* one).
So "we have a certifying straightener" was never the same as "routes are correct
after the freeze." The durable lesson: when you find yourself adding the *n*th
downstream net, that is evidence the upstream contract is leaking — the honest fix
is to give the movers their own clearance checks, or to adopt real ELK ports (#38)
so an edge cannot dangle or cut a node after a move. The downstream-net route is
defensible (one class-agnostic net catches any mover, present or future, and is
provably no-op on the clean corpus), but it is a *tradeoff to name in the PR*, not a
win to bank silently. An independent design workflow reached the same recommendation
*and* flagged the same caveat, which is the tell that it is a real fork in the road.

**Gate on the rubric's EXACT predicate for a mechanically-provable no-op.** The
safety property that made every one of these fixes shippable is "no-op on the
HARD-clean corpus": gate the new behaviour on a HARD-violation condition the clean
corpus never exhibits, then let the byte-exact layout-equivalence gate and
`bun run track` zero-drift *mechanically prove* the no-op instead of asserting it.
The subtlety worth keeping: a *proxy* predicate (e.g. `routeClearOfNodes` with a
clearance margin) is a superset of the violation, only *empirically* 0-firing;
keying detection on the rubric's own predicate (we exported `segmentThroughShape`
so the trigger set is *exactly* the rubric's `edgeThroughNode` set — "touch ⇔
already-HARD") closes the gap between "provably no-op" and "no-op so far." When a
pass is meant to be invisible on good inputs, tie its trigger to the exact oracle
that defines "bad," not to a convenient approximation.

**Contextual metrics couple edges: fixing one can reclassify another that you never
touched.** The most surprising finding. Rerouting a through-node edge *vacated a
lane*, which flipped a *sibling* edge's pre-existing jog from "explained" (its
straight alternative was blocked) to a `hitch` (the alternative is now clear) — even
though the sibling's geometry is byte-identical before and after. The `hitch`/`sym`
family of metrics is contextual: they ask "is there a clearer lane?", so a change
*elsewhere* can alter a verdict *here*. Consequences: (1) a "never-worse per-edge"
guarantee is *not* "never-worse per-layout"; (2) a naive global HARD-*count* guard
is actively counterproductive — here it would preserve the more-severe
`edgeThroughNode` rather than accept the lesser `hitch`, because count does not
encode severity. We accepted the reclassification (a through-node becoming a small
jog is an improvement) and *documented* it, and curated the standing-gate generator
to the aligned family that isolates the through-node class — the same "isolate the
class, don't drag in the adjacent swamp" discipline round 3's `conedFanin` used.
A broad feedback fuzz here surfaced 74 off-outline-endpoint + 31 through-node cases
from a *separate* pre-existing class; a zero-tolerance gate generator must be a
targeted instrument, and the broad sweep belongs in a separate advisory harness.

**CI-green under a moving `main`: new gates land retroactively.** A process echo of
Loops 14 and 19, with a new twist. The `test` job went red not on any test but on a
`website:check` step that did not exist at the branch's base — `main` had added a
content-hashed editor bundle + a sync gate, and GitHub CI checks out the PR *merged
into main*, so it ran a gate the branch had never seen. Because the bundle is hashed
over `src/`, *any* source change flips its hash and staleness the committed output.
The generated website bundle is now runtime surface a src-touching PR must
regenerate (Loop 14's "generated artifacts are product surface," now CI-enforced).
The lesson for long-lived branches: re-merge `main` periodically not just for code
but because new *gates* land on `main` and apply retroactively to your merge — and
after the merge, re-run the equivalence gate and tracker to prove the merge did not
perturb your own subsystem (it didn't: byte-exact, zero drift) before trusting green.

## PR #94 lesson — a public compute endpoint is a security *and* a cost surface, and the boundary must be named honestly

Shipping the hosted MCP endpoint (`https://agentic-mermaid.dev/mcp`) turned a
static site into public, unauthenticated compute: agent JavaScript runs in a
per-request Dynamic Worker isolate. That changed the failure modes from "wrong
pixels" to "wrong containment claim" and "unbounded bill," and five rounds of
external audit taught lessons that generalize beyond this endpoint.

**Name the real boundary; everything else is defense in depth, and saying so is
the honest move.** The temptation was to describe the harness's global-shadowing
and wrapper tricks as "the sandbox." They are not. The guaranteed boundary is the
isolate configuration — `globalOutbound: null`, empty env, no bindings, `cpuMs` —
enforced by workerd, not by our code. A round-5 finding proved it: a
comma+IIFE breakout still *runs* at eval time; the parenthesized wrap only makes
`import`/statement injection a `SyntaxError`, and `hardenIsolateGlobals()` only
strips capability globals *best-effort*. The right response was not to claim the
layers close the hole but to document that they are DiD on top of the isolate,
which remains the thing an attacker cannot defeat. A security note that overstates
containment is worse than none: it invites reliance the code cannot honor.

**CORS is not an access-control boundary for a public credential-less endpoint —
and knowing that is what makes the "fix" correct.** An auditor flagged wildcard
`Access-Control-Allow-Origin: *` as exposing the endpoint. But CORS gates only
*browser* cross-origin reads; agents, servers, and curl ignore it entirely, so it
never gated the primary threat (an attacker calling from their own machines —
bounded by the WAF, not CORS). The one real vector `*` enables is a malicious site
driving its *visitors'* browsers against the endpoint. So the correct fix is
narrow: reflective CORS with Origin validation that keeps `*` for no-Origin
(non-browser) clients and 403s disallowed browser Origins — closing the browser
vector without breaking the actual consumers. Applying a finding literally
("lock down CORS") would have broken every agent client for no security gain;
applying it *understood* fixed the real thing.

**Distinguish a CI gate from a manual probe, out loud.** `website/e2e-mcp.sh`
exercises the real isolate (breakout rejected, globals stripped, SDK still
renders) but needs a live `wrangler dev` with the Worker Loader, so it is **not**
in CI — the CI gate is `bun test src/__tests__/`. Comments that said "covered by
e2e" read as "covered by CI" and were quietly corrected. When a claim of coverage
is load-bearing for trust, state exactly *which* harness proves it and whether
that harness runs automatically.

**Cache correctness on a deploy is a versioning problem, not a TTL problem.** Two
audit rounds converged on the same class of bug: a warm isolate or a cached
response can serve *stale code* after a deploy that doesn't bump the package
version. The fix is to key both the isolate ID and the response cache on a
content hash of what actually executes — the harness bundle for isolates, and a
full-deploy hash (bundled worker JS + harness + wasm + fonts + `compatibility_date`)
for responses — so any change to any hosted surface invalidates without a manual
version bump. Time-based expiry does not fix a correctness bug; identity does.

**Committed build artifacts make every rebase commit a conflict.** Rebasing this
branch onto a moved `main` conflicted on the generated harness bundle and
deploy-hash at *multiple* commits, because both sides regenerate them. Hand-merging
a minified bundle is pointless. The reliable technique: resolve generated-file
conflicts mechanically (take either side to get past the commit), let the rebase
finish, then run one authoritative `bun run website` at the tip and fold the fresh
artifacts into the final commit so `website:check` is green. Only the tip's
artifacts have to be correct; intermediate commits' generated files are throwaway.
The counterpart source lesson: keep the deterministic *source* in the diff and
treat committed build outputs as regenerable, never as things to merge by hand.

**Cost is a first-class design axis, and pure tools are the lever.** Hosted
`execute` spins a billable isolate; the direct `render_svg`/`render_ascii`/
`render_png`/`verify`/`describe` tools cost one ordinary Worker invocation and are
edge-cacheable. Splitting the surface so the common render/verify paths never touch
an isolate — plus a batch fan-out cap so one request cannot spawn N isolates — is
what keeps a public endpoint affordable. On a metered platform, "which calls are
free" is part of the API design, not an afterthought.

## Agent-edit boundary lesson — a compile-time guarantee is only as strong as the runtime boundary that re-checks it

The typed `mutate` surface is correctness-by-construction — *for callers the
compiler checks*. But agents reach it through untyped JSON (MCP, CLI, Code Mode),
where there is no compiler, so the guarantee silently degrades to unchecked: an op
like `{ kind:"add_class", name:"Duck" }` (using `name` where `id` is expected)
slipped past and the mutator produced `class undefined`. A live eval with a weak
model is what surfaced it; the fix and the way we validated it generalize.

**Validate at the choke point where types are lost, not everywhere and not
nowhere.** The naive options were both wrong: folding shape validation into the
low-level `mutate()` makes every compiler-checked internal caller pay for (and risk
false-rejection from) a check it doesn't need; leaving it out entirely is the bug.
The right placement is a single `mutateChecked` at the *trust boundary* — the one
function every untyped path (declarative `applyOps`/`build`, the Code Mode facade,
the CLI `--ops`) funnels through — so a bad op is rejected identically no matter how
it arrives, and the typed path stays untouched. "Where do the guarantees stop being
free?" is the question that locates the check.

**Ground "buy vs build" in the actual code, not the abstract capability.** The MCP
TS SDK + Zod were the obvious "buy" for validation/discovery — until we read the
code they'd land in: the hosted server is hand-rolled JSON-RPC precisely so it runs
runtime-neutral on workerd and stays edge-cacheable, and the ~90 op types are
hand-written unions. Both the SDK transport and a Zod rewrite fight that
architecture, while the *capabilities* they promised (input validation, in-band
`isError` self-correction, `tools/list` discovery, declarative tools) were
deliverable natively in a day. The decision flipped only once the plan was grounded
in the files it would touch.

**Marshal at the boundary you own, and build the shared DTO first.** Code Mode
`return diagram` failed `non-serializable` because the SDK object is a hardened
provenance proxy over Maps. Building the canonical `{ ok, family, source, verify }`
envelope *first* made the marshalling fix fall out for free — the host-side
marshaller just reuses that envelope, so `return d` and the declarative tool now
emit the identical shape. That also settled a build-vs-buy: a bespoke one-way
serializer beat adopting Cap'n Web / Cloudflare Code Mode, which invert the sync
model, are Workers-only, and rebuild IP (the provenance set, the determinism) we
already own. Reach for the RPC framework only when you actually need bidirectional
stubs; a single return-marshal is not that.

**A grader drifts as the product grows; a correct-but-new path reads as failure.**
Re-running the eval after adding the declarative tools, a *correct* Haiku answer
scored `traceOk:false` — the grader credited only `am verify`, not the now-endorsed
`am mutate`/MCP `mutate`/`applyOps` path, which verify internally. A second case
false-failed on an oracle that exact-matched `+speak()` and rejected a valid
`+speak() void`. Fixing false-negatives is not gaming the metric — it is what keeps
the metric measuring capability — but the discipline is to *separate* them from
genuine model misses (a dropped `done` label, an absolute date where `after core`
was asked) and leave those failing. Confirm the split by running a stronger model:
Opus passed exactly the cases Haiku missed, proving they were capability, not
tooling.

**A claim guarded by one test silently drifts; guard the invariant.** Adding the
tools updated `start.md` (which a doc-sync test pins) but left the canonical agent
guide saying "six tools" — untested, so it rotted. The fix was not just to correct
the number but to add a test asserting the guide names *every* `HOSTED_TOOLS` entry,
so the next tool can't drift it. Pin the property, not the instance.

**Fuzz the untyped boundary — that is precisely what fuzzing is for, and the
discriminating invariant is "success implies validity."** Example tests proved the
fix on the cases we imagined; only property fuzz (arbitrary malformed ops across all
12 families) proved the two things that actually matter at a hostile boundary: it
never throws, and *a successful apply implies the op passed shape validation* — the
machine statement of "no silent mangle." That invariant is what goes red when the
validator is removed, which is how you know the fuzz is discriminating and not a
tautology.

## PR #142 lesson — parity requires causal evidence and end-to-end semantics

PR #142 elevated all twelve built-in families at once. The breadth made three
failure modes unusually visible: visual changes without an adjacent reason look
arbitrary, accepting syntax can masquerade as implementing it, and exact-output
goldens can faithfully preserve incorrect geometry.

**A visual diff needs a causal caption.** The original evidence table told reviewers
what changed, but not why it should have changed. The Timeline pair was the clearest
example: horizontal became vertical, with no explanation that the fixture explicitly
uses `timeline TD`, Mermaid's top-to-bottom orientation, and that the old renderer
ignored the token. The corrected table separates **Why** (the authored syntax,
configuration, or semantic contract) from **What to inspect** (the visible proof).
A before/after image establishes difference; it does not establish correctness until
the intended cause is stated beside it. This applies equally to generated artifacts:
reproducibility answers “did the renderer make this?” while the caption answers “was
this the renderer's right decision?”

**Parse support is not feature support.** An audit of every open repository issue
found that three issues overlapped the PR but were only partly complete. Architecture
`align` directives parsed and round-tripped but did not constrain geometry (#101).
Flowchart markdown strings parsed, but bold and italic markers were flattened (#102).
Namespaces and State constructs had landed for #118, but Class generics had not.
Those are useful intermediate states when they are explicitly warned and ledgered;
they are not honest issue closure. The durable completion check is the entire chain:
parse → model → measure/layout → render → serialize → verify → typed mutation, with
source-preserved opaque fallback where a typed stage remains intentionally absent.

**Normalize semantic identity before adding syntax to mutation.** `Box~T~` initially
risked becoming one class at declaration time and a second class when used as a
relationship endpoint. Modeling it as stable identity `Box` plus generic metadata
`T` let declarations, notes, members, relationships, rendering (`Box<T>`), canonical
serialization, facts, and `set_class_generic` converge on one object. Surface syntax
is not a safe identifier when decorations carry type parameters, aliases, or display
labels; normalize once and make every consumer use the normalized identity.

The final parser audit found the same defect family in three more spellings:
`A:::class` became visible `::class` text in State/Class or a distinct ER entity,
`CUSTOMER["Customer Account"]` made the alias part of identity, and comma punctuation
made `PK, FK` lose `PK`. The fix was not four regex patches: Unicode-aware Mermaid
identifier/class-suffix primitives, one quote-aware Flowchart shape scanner, and
shared ER entity-reference/relationship/attribute grammars now feed renderer and
agent parsing. Typed ER identity is `id` plus optional `label`, with
`set_entity_label`; shared structured paint now remains separate from identity, while
truly unmodeled segments stay preserved and warned rather than being discarded. Correctness-by-construction means every decorated reference
passes through the same normalization boundary before layout, render, facts, or
mutation can observe it.

**Goldens are necessary pins, not correctness proofs.** The final geometry audit
found eight dense self-loops sharing only six label centers, Architecture routes
anchored to stale pre-alignment bounds, and an aligned lane overlapping an
unconstrained sibling. Every output was deterministic and therefore perfectly able
to produce a stable wrong golden. The fixes were justified by discriminating
properties—unique route/label occupancy, anchors derived from post-move geometry,
non-overlap, containment, and source-order invariance—then the intentional goldens
were regenerated. The order matters: prove the invariant first; use the golden to
pin the proven result second.

**Cross-family claims require a cross-family matrix.** Shared text measurement,
wrapping, route contracts, palette resolution, and style transforms can improve one
family while regressing another. Rendering every elevated feature under multiple
Style + Palette stacks, checking one generated all-family sheet byte-for-byte, and
running the ordinary family corpus caught integration drift that family-local tests
could not. When a PR's claim says “all families,” at least one executable gate must
quantify over all families rather than infer coverage from fourteen separate anecdotes.

**Registration is not reachability.** The follow-up audit found a deeper reason explicit State config was byte-inert: `stateDiagram-v2` still routed through the Flowchart family even though a State hook was registered. The resolver worked in isolation and could still be unreachable in production. The repair gave State its own routed family ID and preserved default bytes before wiring ten faithful fields. This is a reusable integration lesson: a feature is wired only when the public detector selects the registry entry, the registry invokes its hook, and a field-specific output invariant changes.

**Serializer conformance must cross the renderer boundary.** Canonical discovery fixtures were enrollment, not the property P3 promised. The completed gate generates thirty structured diagrams per family, serializes and reparses them through both agent and real renderer layout paths, compares agent facts plus renderer node/edge/group inventories, asserts idempotence, and renders SVG. It deliberately compares semantic inventories rather than coordinates: Architecture's canonical declaration ordering may move equivalent elements, while geometry determinism remains a separate per-input invariant. This distinction made the property strong without forbidding legitimate canonicalization.

**A prose ledger cannot prove its own completeness.** The first post-audit phase
summary said config honesty covered the family set, while the hard-coded unknown-key
matrix contained eleven entries and silently omitted State. A direct probe confirmed
that both documented `state.nodeSpacing` and misspelled `state.madeUpKey` disappeared
without a warning. The repair was partly behavioral—add a typed State config section
and classify every currently unwired key—and partly structural: the config and opaque
warning matrices now assert exact equality with `BUILTIN_FAMILY_METADATA`. The plan
itself assigns stable IDs to all 72 original items and 18 completion packages, and a
doc test rejects missing, duplicate, status-less, or evidence-less rows. “Everything
is tracked” is now a checked set equality, not confidence based on a long document.

**A phase needs an exit condition, not an adjective.** “Substantially complete” hid
whether broad `<family>_opaque` warnings blocked Phase 0 forever. Re-reading the
original honesty contract resolved the boundary: Phase 0 requires lossless preservation
plus an actionable warning; construct-specific modeling is later parity work. Its exit
is therefore executable and finite: all-family canonical conformance, corpus
faithfulness, all-family opaque diagnostics, all-family config wire-or-warn, unknown
CLI flag rejection, and Scene-IR text geometry fidelity. Naming that boundary lets the
phase become honestly complete while the mechanical backlog continues to show the
remaining rendering and mutation work.

## PR #149 Closing The Gap — visual-family semantics are part of compatibility

The post-completion Mermaid 11.16 audit changed the question from “does every
family render?” to three separate questions: does official syntax become typed
semantics, does that meaning survive every output surface, and does the result
still look like the diagram family an author selected? That distinction exposed
Mindmap as the clearest miss. Its parser, serializer, mutation surface, SVG, and
terminal output were all present, but the default one-sided tree did not preserve
a mind map’s central, radiating structure. The correction made a deterministic
bilateral center the default and retained `tidy-tree` as an explicit alternate.
Compatibility includes the family’s characteristic spatial metaphor, not only
its graph topology.

The same audit showed why native promotion is a whole-pipeline operation.
Flowchart icon/image and animation metadata already affected rendering, but the
agent surface intentionally remained opaque because its serializer could not
reproduce those keys. Closing the gap required closed fields, canonical emission,
and parse→serialize→parse tests before removing that fallback. Metadata still
outside the type—dimensions and placement—remains opaque. This is the safe
promotion sequence: model, serialize, verify closure, then claim native support.

Geometry verification also had to converge with rendered pixels. ER relationship
labels were collision-separated in SVG while `RenderedLayout` continued to expose
raw midpoints, making the public readability audit both stricter and less truthful
than the renderer. Sharing final label positions, reserving cardinality-marker
zones, and translating nested group geometry into canvas bounds removed the final
readability findings. The global corpus-plus-fuzz ratchet could then move from 12
to zero. A quality projection is useful only when it describes final presentation,
not an earlier layout stage.

Finally, pinned upstream tests needed semantic reclassification rather than blind
preservation. Several expectations encoded former fallbacks—XY point labels were
opaque, Sequence aliases displayed IDs, ER subgraphs flattened, and Flowchart
metadata forced an opaque body. Their provenance remained pinned to official test
titles and source, while expected structure changed to the newly implemented
meaning. An old independent parser remains valuable as a differential oracle, but
its lack of current v11 metadata support is a documented oracle boundary, not a
reason to keep the product behind Mermaid.

## 2026-07 — contracts at output boundaries

**Cross-surface primitives only count when every writer adopts them.** The
repository already had correct grapheme segmentation and display-width math,
but Class/ER relationship labels, Sequence block text, Pie/Quadrant/XYChart,
subgraph headers, validation, and TUI metadata still performed code-unit
arithmetic. The completion move was an inventory of every sizing *and writing*
site, followed by equal-display-width metamorphic pairs. Measuring correctly
while writing UTF-16 units is still corrupt geometry.

**DOM semantics belong in the Scene waist, not twelve renderer conventions.**
Adding typed Scene identity and accessibility once let every existing family
emit deterministic `data-id`/`data-role` and relation ARIA, including chart
marks that had no source ID. A separate reference-hygiene matrix then found a
real integration gap: XYChart and Gantt emitted CSS `url(#bm-shadow)` without
the filter definition. Generic rewriting was correct; family enrollment was
not. Shared machinery plus an all-family consumer test is the durable pair.

**Accessibility palettes need executable thresholds, not names.** Several
well-known themes called their low-contrast color “muted” and then used it for
normal-size informational labels at roughly 2:1. Concrete palette resolution
now preserves passing colors and deterministically lifts failing text to 4.5:1
and relation graphics to 3:1. The key distinction is between a palette's authored
intent and the rendered role's contrast obligation; a theme name is not a WCAG
certificate.

## 2026-07 — completing fourteen-family citizenship

**Placement validity and route validity are separate facts.** Architecture can
contain legal authored side constraints that contradict each other. Rejecting
them loses source semantics; pretending they were satisfied lies. The durable
model records `placement: satisfied|conflicted` independently from facing and
obstacle-free route certificates. A conflicted layout can still produce a
side-anchored, orthogonal, obstacle-free route, and review can see exactly which
promise could not be met.

**Indentation-sensitive syntax must enter before canonical trimming.** Mindmap
failed when it was parsed from the same trimmed body used by line-oriented
families: indentation *is* the tree. Its family hook now receives the untrimmed
normalized body and produces one recursive model consumed by agent layout,
SVG, and terminal rendering. Normalization is not universally safe; every
family must declare which whitespace is syntax.

**Statement families need replay, not token inventories.** GitGraph meaning is
the evolving branch-head state, not a list of keywords. Replaying statements
made invalid checkout/merge/cherry-pick states unrepresentable, exposed real
parent relations to layout/accessibility, and separated semantic merge type from
an authored visual override. Deterministic generated ids (`c<N>`) deliberately
trade upstream randomness for reproducible artifacts.

**Segment preservation is the middle path between full typing and whole-body
opacity.** ER's tolerated subgraph syntax originally forced the entire family
opaque. Ordered typed/opaque statements keep editable relationships and paint in
place while preserving unsupported delimiters exactly; identity mutations are
refused only when they would stale opaque text. The important boundary is not
“typed or opaque diagram,” but whether each source segment has a safe owner.

**A citizenship matrix prevents a new family from being only a renderer.** The
Mindmap/GitGraph work was complete only after the library, CLI, Code Mode,
hosted MCP, editor, website, documentation, eval, package, config, terminal,
accessibility, security, properties, characterization, and mutation surfaces all
agreed. Exact registry equality turned fourteen-family support from prose into a
zero-exception contract.

**Source success does not prove the package recipients run.** The installed
artifact is a separate product surface: pack, install into a clean project,
then exercise valid new-family inputs through bare library imports, the Node
CLI, and the stdio MCP, requiring structured kinds and source/package output
equality. The same consumer-path test now proves the Apache-2.0 license and
third-party notice actually arrive beside the curated Architecture icon paths;
package metadata alone could not prove either fact.

**Final review must attack successful mutations, not only rejected inputs.** The
post-green parser audit found values that passed typed operations but changed
the model after canonical serialization: Mindmap delimiters/comments created
children or lost class suffixes, and multiline paint created State/Class/ER
entities. The fix was not more snapshots; it was grammar closure at the mutation
boundary plus real-source revert probes. Completion review now includes the
question: “Can any successful string-valued op become a second statement when
the serializer adds its prefix?”

**Evidence claims should name every field they prove.** Endpoint equality did
not prove relation identity, and hashing a test file did not prove manually
expanded loop variants. Tightening those claims required exact
`(id, role, from, to)` multisets and AST-expanded source lists. When a plan says
“exact,” the acceptance test must compare the exact object, not a count or a
projection that happens to be sufficient for today’s fixture.

**Registry drift is a defect family, not three unrelated stale lists.** The editor still rejected Mindmap/GitGraph, characterization still enrolled twelve families, and a byte-fresh architecture SVG still said twelve. The systemic repair was registry-derived editor data plus exact registry-equality tests for characterization and semantic documentation claims. Generated freshness remains a second, separate gate.

**Reachability and injective identity must be tested adversarially.** GitGraph branch provenance was too weak for cherry-pick validation, and `${from}->${to}` was too weak for authored relation IDs. An ancestry walk and tuple-safe semantic identity only became necessary when tests constructed inherited commits and delimiter-bearing IDs that collide under the old shortcuts.

**Exact ledger titles turn review prose into executable coordinates.** Requiring every done row to resolve an exact title in a cited file found three claims with no defensible test. Closing them exposed a real dropped ER syntax, a PNG background bug, and missing Quadrant axis budgets. File existence and green neighboring tests had hidden all three.
