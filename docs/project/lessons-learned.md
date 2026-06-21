# Lessons Learned — Loops 1 through 22

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
