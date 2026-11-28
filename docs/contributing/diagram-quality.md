# Diagram quality: how we judge, detect and improve it

This is the hub for layout quality work. It records what we have learned about
which diagrams decide quality, what defects mislead a reader, which tools
detect them, and how to tell whether a change helps. The detailed contracts it
points to stay where they are:

- [quality.md](../quality.md): the user-facing definition (warning tiers,
  `QualityBounds`, layout priorities).
- [layout-certification.md](../layout-certification.md): the hard geometry the
  engine certifies before it returns a layout.
- [ugly-layouts.md](../design/system/ugly-layouts.md): the rendered-output defects
  `audit:ugly` detects.
- [route-contracts.md](../design/system/route-contracts.md): the `ROUTE_*`
  tripwires.
- [issue-derived-test-cases.md](../issue-derived-test-cases.md) and
  [mermaid-layout-complaints.md](../mermaid-layout-complaints.md): what users
  report.

## 1. Real diagrams decide; synthetic inputs guard

A **real diagram** is one a person drew: the docs corpus, or a gate fixture
copied from a user's issue (its text names the issue's github.com URL). There
are 369 today: 271 from the docs corpus and 98 from issues in the Mermaid and
Beautiful Mermaid fork graph. `eval/quality/real-diagrams.ts` is the single
definition the tools below share.

A **robustness input** is generated, a stress sample, or hand-built geometry.
It proves we do not crash, lose content or draw a hard defect. It does not
decide what "better" means.

Why this split: during PR #623 several rules were built for synthetic shapes
(parallel lanes through a caption, loops on tightly nested Swimlane groups, a
crowded-gap rescue, C4 diagrams with hundreds of relationships). Searching
103 issues across the fork graph found no real diagram in those categories.
Meanwhile real diagrams (mermaid#7822, #5952, #8568, #5094, #4790, #5876)
regressed or stayed broken. Those rules were removed. The fixes that mattered
came from real input.

**Before building a layout rule**, find a real diagram that needs it:

1. Search the issues of the Mermaid and Beautiful Mermaid fork graph for the shape.
2. Add each match with `bun run quality:add-real` (section 5).
3. Run `bun run quality:report` and confirm the defect shows up.
4. If no real diagram shows the defect, write a robustness test that it does
   not crash or lose content, and stop there.

## 2. The order of judgement

A layout is judged in this order. A later criterion never buys back an
earlier one.

1. **Hard: content and certification.** Every node, edge and label survives;
   geometry is finite and inside the canvas; routes avoid unrelated nodes and
   end on their endpoint's outline; labels stay with their route. The engine
   certifies this before returning (`LAYOUT_UNCERTIFIED` /
   `LAYOUT_CERTIFICATION_FAILED`). On rendered output `audit:ugly` must report
   **0 hard findings** (diagonals, routes through nodes, floating endpoints,
   node overlap, hitches, labels off their route).
2. **Misleading routes.** A crossing is clutter; a **contact** lies. Two
   unrelated routes that touch draw a junction that does not exist, and two
   that share a run hide which edge owns it. Placement selection prefers fewer
   contacts before it reads the objective (mermaid#7822: 32 fewer crossings
   were not worth 11 shared runs). See section 3 for the full list.
3. **The declared objective**, `compareLayoutPreference` in
   `src/layout/certification.ts`: unreadable titles, then crossings, label
   conflicts, bends, non-canonical endpoint rate, peer balance, area. Candidate
   selection and the paired gate both read this one ordering.

## 3. What we detect

Each class below is a defect a reader sees on a real diagram. `measureQuality`
reports it, and `eval/quality/score.ts` names it for the tools.

| Finding | What the reader sees | Detector |
|---|---|---|
| `touches` | two unrelated routes meet at a corner or T, suggesting a junction | `measureRouteContacts` |
| `sharedRuns` | two unrelated routes overlap along a run; you cannot tell which edge continues | `measureRouteContacts` |
| `borderRuns` | a route runs along a node's or group's border and reads as part of the outline | `routeClearanceFindings` |
| `shortShafts` | the last segment is too short for its arrowhead, so the arrow points the wrong way | `routeClearanceFindings` |
| `cornerEnds` | an arrow ends at a node's corner, ambiguous between two sides | `routeClearanceFindings` |
| `captionConflicts` | an edge caption overlaps another caption, a node, another route, or a group's title band or frame | `labelConflicts` |
| hitch | a short perpendicular jog on a run whose lane is clear | `audit:ugly` (hard) |
| self-loop occupancy | another route leaves through a self-loop's seat | `ROUTE_SELF_LOOP_OCCUPANCY` |

Crossings and bends are reported beside these. They matter, but they mislead
less than a contact.

## 4. Tools

| Command | Question it answers | When |
|---|---|---|
| `bun run quality:report [--all] [--json f]` | Which real diagrams have a reader-visible defect today? | Start of any quality work: pick targets from this list, not from generated graphs. |
| `bun run quality:impact --base <rev>` / `--revert <commit>` | Which real diagrams does this change touch, and are they better or worse? | Before keeping a layout rule. A rule that changes no real diagram serves only synthetic inputs and is a candidate to drop. |
| `bun run quality:add-real <file.mmd> --url <issue>` | — | Adding a user's diagram as a real fixture. Keeps front matter first, refuses duplicates and diagrams that do not lay out. |
| `bun run audit:ugly` | Does any rendered output (SVG, PNG, ASCII, Unicode) have a hard defect? | Before pushing; CI gate. Must report 0 hard. |
| `bun run layout:gate --base <rev> --balanced` | Did the objective improve or regress, per input, against the base, with timing? | Per PR, in CI. Real inputs are judged; robustness inputs break only on hard losses, and their objective moves are listed for information. |
| `bun run track` | Soft-metric deltas against the committed baseline while tuning. | Iterating on a rule. |

`quality:impact` ranks a changed diagram by misleading findings, then crossings,
then bends, the same order as section 2. Both sides are scored by this
checkout's scorer, so a scorer change does not masquerade as a layout change.

## 5. Adding a real diagram

```sh
bun run quality:add-real issue.mmd --url https://github.com/mermaid-js/mermaid/issues/1234
bun run audit:ugly                       # must stay at 0 hard findings
UPDATE_LAYOUT_BASELINE=1 bun test --timeout 180000 src/__tests__/layout-equivalence.test.ts
```

Copy the author's diagram verbatim: a reduced example is a synthetic input.
When a real diagram regresses, keep the whole diagram as the gate fixture and
put the minimal reproduction in a unit test at the owning boundary.

## 6. What a quality change costs

Report all three; a quality gain does not excuse an unmeasured cost.

- **Time.** The gate reports the median slowdown and per-sample outliers
  (`--max-slowdown 1.25`). Small diagrams can show large ratios on a few
  milliseconds; state the absolute time.
- **Download.** `check:browser-lazy` holds Brotli ceilings per family in
  `scripts/build/browser-lazy-budgets.json`. A PR that crosses one resets it by
  the rule in [website-payload-plan.md](../project/website-payload-plan.md)
  (measured + 5%, rounded up to 1,000) and carries the
  `payload-growth-approved` label.
- **Trade-offs.** A deliberate objective regression on a real input carries the
  `layout-tradeoff-approved` label and is named in the PR.
