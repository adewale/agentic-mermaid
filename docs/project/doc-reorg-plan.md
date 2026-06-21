# Documentation reorganization plan — separating per-family from system docs

Status: **executed.** Phase 0 and Phase 1 are complete — all per-family notes now live in
`docs/design/families/` and all cross-cutting/system docs in `docs/design/system/`, with every
code/test/config/doc reference swept. Drafted and executed 2026-06-20.
Follows from [`design/abstraction-audit.md`](../design/system/abstraction-audit.md) §5 and the
documentation-taxonomy diagnosis: `docs/design/` mixes per-diagram-type notes with whole-system
design, the dominant index axis is *audience* (not type-vs-system), and there is no single
system-architecture entry point. This plan fixes that with the **smallest safe change first**.

## The diagnosis, in one paragraph

`docs/design/` is an undifferentiated bag. It holds **per-type** notes (`architecture.md`,
`gantt.md`, `gantt-research.md`, `journey.md`, `xychart.md`, `flowchart-parser-conformance.md`)
next to **system/cross-cutting** docs (`route-contracts.md`, `layout-rubric.md`,
`source-preservation-ladder.md`, `ugly-layouts.md`, `issue-26-*.md`, `abstraction-audit.md`,
`abstraction-recommendations.md`). Nothing distinguishes the two. The clearest symptom is the
**`design/architecture.md` naming collision** — it reads like "system architecture" but documents
the `architecture-beta` *diagram type*. Per-family design coverage is also ad hoc: only 4 of 12
families (architecture, gantt, journey, xychart) have a design note at all.

## Goal: two named tiers under `docs/design/`

| Tier | Question it answers | Audience |
|---|---|---|
| `docs/design/system/` | "How does the engine work?" | maintainers, architecture review |
| `docs/design/families/` | "How is diagram type X parsed/laid out/rendered?" | family implementers |

## Target taxonomy (end state)

```
docs/design/
  system/
    README.md                       (NEW — the system-architecture entry point; anchored by the audit)
    abstraction-audit.md            (move)
    abstraction-recommendations.md  (move)
    route-contracts.md              (move)
    layout-rubric.md                (move)
    source-preservation-ladder.md   (move)
    ugly-layouts.md                 (move)
    issue-26-audit.md               (move — historical flowchart-layout ledger)
    issue-26-38-closure.md          (move — historical flowchart-layout ledger)
  families/
    README.md                       (NEW — per-family hub; links each family to its scattered docs)
    architecture-beta.md            (move + RENAME from architecture.md)
    flowchart-parser-conformance.md (move)
    gantt.md                        (move)
    gantt-research.md               (move — sibling of gantt.md; ./gantt.md link stays valid)
    journey.md                      (move)
    xychart.md                      (move)
```

Placement rationale for the non-obvious ones:
- **`source-preservation-ladder.md` → system/**: it is the L0–L4 *contract every family obeys*, a
  framework, not one family's note.
- **`issue-26-*.md` → system/**: they document the flowchart **layout engine** work (the core path),
  not a single non-flowchart family. They are historical ledgers; keep them but in the system tier.
- **`flowchart-parser-conformance.md` → families/**: it is flowchart-specific (a syntax-coverage
  catalogue), so it belongs with the per-type docs even though flowchart is also "the core."

## The link-rot surface (why this is not a simple `git mv`)

These docs are referenced from **code comments, tests, eval scripts, stryker configs, and a
citizenship matrix** — not just other docs. Moving a file means updating every one of these or the
references rot (and several are read by tests). Inventory gathered for this plan:

| Doc | Referenced from (must update on move) | Move risk |
|---|---|---|
| `architecture.md` | **`docs/README.md` only** | **Low — safe rename** |
| `route-contracts.md` | code: `src/types.ts`(×2), `src/route-contracts.ts`, `src/layout-engine.ts`(×2), `src/cli/agent-instructions.ts`, `src/agent/verify.ts`; docs: `Instructions_for_agents.md`, `CHANGELOG.md`, `docs/quality.md`, `docs/mutation-testing.md`, `docs/design/system/layout-rubric.md`; config: `stryker.routes.config.json` | High |
| `gantt.md` | ~20 refs: `src/gantt/*`(5), `src/agent/*`(4), `src/ascii/gantt.ts`, 7 tests, `AGENT_NATIVE.md`(×2), `TODO.md`, `eval/mermaid-gantt-bench/*`, `CHANGELOG.md`, `docs/contributing/*`, `…citizenship.matrix.json` | High |
| `layout-rubric.md` | `src/layout-rubric.ts`, `src/__tests__/layout-rubric.test.ts`, `eval/visual-rubric/*`(2), `CHANGELOG.md` | Med |
| `source-preservation-ladder.md` | **`src/__tests__/agent-doc-sync.test.ts:195`** (a doc-sync test — may assert the path), `docs/design/system/issue-26-audit.md`, the two abstraction docs | Med — **test caveat** |
| `ugly-layouts.md` | `eval/ugly-detector/*`(2), `src/__tests__/ugly-detector.test.ts` | Med |
| `issue-26-audit.md` | `src/__tests__/link-grammar.test.ts`, `src/__tests__/heuristic-coverage.test.ts` | Med |
| `xychart.md` | `docs/contributing/adding-diagram-types.md` | Low |
| `flowchart-parser-conformance.md` | `…/diagram-family-citizenship.matrix.json` | Low |
| `abstraction-audit.md` / `-recommendations.md` | each other, `docs/README.md` | Low (just added) |

Takeaway: **`architecture.md` is the only zero-cost move; the heavily-referenced docs
(`route-contracts.md`, `gantt.md`, `layout-rubric.md`) are load-bearing references in source and
tests.** That argues for phasing, not a big-bang move.

## Phased rollout

### Phase 0 — clarity wins, (almost) zero move  ·  recommended, low risk
Delivers ~80% of the benefit without relocating the load-bearing docs.
1. **Rename the colliding file:** `docs/design/architecture.md` → `docs/design/families/architecture-beta.md`
   (or, if we defer the `families/` folder, `docs/design/architecture-beta.md`). Update the **single**
   inbound link in `docs/README.md`. This kills the collision the audit flagged.
2. **Regroup the index, not the files.** In `docs/README.md`, split today's flat design list into two
   labeled subsections — **"System design (how the engine works)"** and **"Per-family design notes"** —
   pointing at the *current* paths. A reader can now tell the tiers apart immediately; nothing moves.
3. **Add the system entry point:** create `docs/design/system/README.md` ("System architecture — start
   here") linking the audit (overview + I1–I9), recommendations, route-contracts, layout-rubric, and
   the source-preservation ladder. Link it prominently from `docs/README.md`. The audit anchors it.
4. **Adopt a going-forward convention** (write it into `docs/contributing/adding-diagram-types.md`):
   new per-family docs land in `design/families/`, new system docs in `design/system/`. The split then
   grows in cleanly without a risky mass-move.

### Phase 1 — physical relocation  ·  optional, higher cost, do per-doc
Only if Phase 0 proves insufficient. For each doc, in its own commit:
1. `git mv` into `system/` or `families/` per the taxonomy table.
2. Update **every** reference from the link-rot table (code comments, tests, eval, stryker, matrix, docs).
3. Run the touching tests (e.g. `agent-doc-sync`, `ugly-detector`, `layout-rubric`, `heuristic-coverage`,
   `link-grammar`, the gantt suite) to prove the path update is complete.
4. Fix sibling relative links (`gantt-research.md`→`./gantt.md` stays valid since both move together;
   `layout-rubric.md`→`route-contracts.md` needs a `../system/` rewrite if only one moves — move system
   docs as a batch to keep intra-tier links relative).

Sequence Phase 1 **low-risk docs first** (`xychart.md`, `flowchart-parser-conformance.md`,
`issue-26-*`, `ugly-layouts.md`), then the high-fan-in ones (`route-contracts.md`, `gantt.md`,
`layout-rubric.md`) last, each behind its test run.

## Link-rot mitigation

- **Internal references (code/tests/docs/configs):** update them directly — do **not** rely on stubs,
  because tests read these paths and a stub would either break the test or mislead the comment.
- **External / bookmarked GitHub URLs:** optionally leave a one-line stub at the old path
  (`Moved to ../system/route-contracts.md`) for the two docs most likely to be cited externally
  (`route-contracts.md`, `gantt.md`). Stubs are clutter; add only if external links matter.
- **Doc-sync test caveat:** `agent-doc-sync.test.ts` references `source-preservation-ladder.md`. Before
  moving it, read that test — if it asserts the literal path or hashes the file, update the test in the
  same commit; if it only checks content sync, the path constant is the only change.

## Scope boundaries (what this plan does *not* do)

- **It does not consolidate the fragmented per-family story.** A family's docs still live in ~7 places
  (design note, citizenship row, ladder level, `AGENT_NATIVE.md` op table, user catalog, syntax ref).
  The new `families/README.md` *links* those together as a hub but does not merge them — that is a
  larger follow-up, deliberately out of scope.
- **It does not rename `gantt.md`/`journey.md`/`xychart.md`** or touch their content; only the
  `architecture.md` → `architecture-beta.md` rename is proposed, because only that name collides.
- **It does not change the audience-based top-level split** (User / Agent / Contributor) in
  `docs/README.md`, which is sound; it only subdivides the design block by tier.

## Determinism / CI note

No source behavior changes; this is docs + comments + test-path constants. The only CI surface is the
doc-referencing tests listed above — Phase 1 must run them per move. Phase 0 touches only `docs/README.md`
links and adds two new `README.md` files, so its CI risk is effectively nil.

## Recommendation

Do **Phase 0 now** (it resolves the collision, gives the index two named tiers, and stands up the system
entry point for the cost of editing one index file plus the safe `architecture.md` rename). Treat
**Phase 1 as optional**, executed per-doc behind tests, and only if the in-place index grouping proves
not enough.
