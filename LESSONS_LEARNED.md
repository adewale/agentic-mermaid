# Lessons Learned — Loops 1 through 7

This document replaces the Loop 1 retrospective. It is the cumulative
narrative across seven loops of work on the agentic-mermaid fork. Each
section reflects what a critic or implementer wished they had known when
they started.

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
rejects the call statically. The user experience is "you can edit
canonicalSource as a string," not "your diagram broke."

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

The LLM-judge harness (also Loop 5) ships but is intentionally
periodic-not-per-PR. Running it on every PR would dominate the wallclock
budget and produce a grade that is statistically noisy across runs. Once
a week is enough to detect drift; an explicit `bun run eval:llm-judge`
target lets a maintainer trigger it on demand. Net: cheap, high-signal,
not always-on.

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
