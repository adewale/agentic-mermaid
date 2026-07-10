# mermaid-gantt-bench — upstream test-suite harvest

A compatibility corpus harvested from the **actual test suites** of upstream
Gantt implementations, run against our parser/scheduler by
`src/__tests__/gantt-upstream-bench.test.ts`. This answers "how do we know we
are compatible?" with measured parity instead of a claim: every portable
upstream case must pass, and every non-portable case is enumerated in
`exclusions.json` with a reason code — an executable divergence ledger.

## Provenance (all MIT; vendored 2026-06-12 from default branches)

| Source | Files | What we took |
|---|---|---|
| `mermaid-js/mermaid` | `packages/mermaid/src/diagrams/gantt/parser/gantt.spec.js`, `…/gantt/ganttDb.spec.ts` | Every gantt source string plus the asserted semantics (titles, sections, tags, clicks, resolved task instants), with local-time `Date(y, m, d)` expectations normalized to UTC ISO. |
| `pgavlin/mermaid-ascii` | `pkg/gantt/gantt_test.go` | Parse/schedule inputs and render-smoke expectations (their byte-level ASCII assertions are theirs, not ours). |
| `kais-radwan/ascii-mermaid` | `ts/test/gantt.test.js` | Representative render inputs (same byte-level caveat). |

Mermaid's cypress rendering specs assert THEIR svg dom and are not vendored;
their diagram inputs are already covered by the mermaid-docs corpus
(`eval/mermaid-docs-corpus`, `family: "gantt"` entries).

## Case schema (`cases.json`)

`expect.kind`:
- `parse` — `parseGanttModel` succeeds; asserted fields (title, dateFormat,
  excludes tokens, weekStart, todayMarker, acc*, sectionLabels, taskTags as
  sets, clicks) match.
- `schedule` — `resolveGanttSchedule` succeeds; tasks matched **by index**
  (upstream auto-ids like `task1` are not reproduced); `start`/`end` are UTC
  (date-only shorthand = midnight UTC). `render: true` adds an ASCII
  render smoke; `renderContains` asserts label presence.
- `error` — parse/schedule throws a `GanttError` with `errorCode`.

Every case additionally proves the agent-layer round-trip law on its source
(serialize-idempotent structured bodies / byte-verbatim opaque bodies).

## Exclusion reason codes (`exclusions.json`)

- `wall-clock-fallback` — upstream substitutes `new Date()` (today) for
  missing/unknown/unparseable inputs; our spec mandates named `GANTT_*`
  errors instead. Where `oursErrorCode` is present the ledger entry is
  EXECUTED by the bench test, so the divergence is pinned, not assumed.
- `local-tz` — depends on the runner's timezone/DST (upstream itself skips
  the case unless `TZ=America/Los_Angeles`). Our scheduler is UTC-only.
- `silent-ignore-vs-named-error` — upstream tolerates a token its own docs
  call unsupported; we error by name per the spec.

Retired reason codes:

- `exclude-boundary-model` (retired 2026-07) — upstream's exclude-walk counts
  days in `(start, end]`; ours used to count `[start, end)`. The divergence
  was RESOLVED by adopting upstream's boundary (family-elevation-plan §Gantt
  item 6): `src/gantt/schedule.ts` now mirrors mermaid's `fixTaskDates` walk,
  including the `endTime`/`renderEndTime` split (`ScheduledGanttTask.end` vs
  `.renderEnd`). The former e3/e4 entries moved into `cases.json`
  (`db-weekends-mega`, `db-exclude-all-but-friday`) as executed parity pins.

## Not portable by construction

Upstream cases that test their internal API rather than gantt source are not
representable here: `clear()` state resets, `parseDuration()` unit calls,
getter defaults, and renderer DOM assertions.

## Refresh

Re-fetch the two mermaid spec files from `develop`, diff against the vendored
sources here, and add new cases / exclusions as upstream's suite grows. The
spec's watchlist (docs/design/families/gantt.md §Not supported) flags the syntax areas
most likely to change.
