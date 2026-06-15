# Gantt support specification

Status: design spec. Target implementation branch: after [PR #22](https://github.com/adewale/beautiful-mermaid/pull/22) or any equivalent merge of the family-plugin/quality-adapter work. This document is a contract for the first Gantt implementation and for follow-up work. It is not a backlog.

## Scope

Agentic Mermaid should render Mermaid-compatible `gantt` diagrams to SVG, PNG, ASCII, Unicode text, and layout JSON without breaking the agent safety contract:

- existing Mermaid Gantt source should parse or fail with a named, structured error;
- source that parses but uses syntax outside the first render subset should round-trip byte-for-byte through the agent API;
- renderers must be deterministic unless the caller explicitly supplies a clock value;
- unsupported Mermaid proposals must be called out rather than approximated.

The first implementation ships **typed mutation via `asGantt`**, using the segment-preserving structured body pattern established for sequence diagrams (`src/agent/sequence-body.ts`): typed ops cover the modeled statements (title, sections, tasks), while calendar directives, comments, click/link statements, and markers ride along verbatim as opaque segments — never dropped, never requiring a full-fidelity IR. Typed mutation is the enforced default for every registered family (`every registered renderable family ships typed mutation (default-by-default enforcement)` in `src/__tests__/agent-doc-sync.test.ts`; see `docs/contributing/adding-diagram-types.md` §7), so a source-level-only registration does not pass CI.

## Evidence base

### Mermaid core discussions

Mermaid core has the syntax authority. The current docs and grammar define the accepted language:

- [Mermaid Gantt syntax docs](https://mermaid.js.org/syntax/gantt.html)
- [`gantt.md` docs source](https://github.com/mermaid-js/mermaid/blob/develop/packages/mermaid/src/docs/syntax/gantt.md)
- [`gantt.jison` grammar](https://github.com/mermaid-js/mermaid/blob/develop/packages/mermaid/src/diagrams/gantt/parser/gantt.jison)
- Gantt implementation directory: [`packages/mermaid/src/diagrams/gantt`](https://github.com/mermaid-js/mermaid/tree/develop/packages/mermaid/src/diagrams/gantt)

Recurring user pressure in Mermaid core:

| Theme | Discussions | Requirement pulled into this spec |
|---|---|---|
| Task dependency math | [#818](https://github.com/mermaid-js/mermaid/issues/818), [#7407](https://github.com/mermaid-js/mermaid/issues/7407), [#7714](https://github.com/mermaid-js/mermaid/issues/7714), [PR #5224](https://github.com/mermaid-js/mermaid/pull/5224), [PR #6376](https://github.com/mermaid-js/mermaid/pull/6376), [PR #7409](https://github.com/mermaid-js/mermaid/pull/7409) | Parse `after` and `until` as first-class dependency expressions. Resolve them in a scheduler layer, not inside the renderer. |
| Calendars, weekends, excludes | [#2424](https://github.com/mermaid-js/mermaid/issues/2424), [#5867](https://github.com/mermaid-js/mermaid/issues/5867), [#6884](https://github.com/mermaid-js/mermaid/issues/6884), [#7062](https://github.com/mermaid-js/mermaid/issues/7062), [#6421](https://github.com/mermaid-js/mermaid/issues/6421), [PR #5358](https://github.com/mermaid-js/mermaid/pull/5358), [PR #6734](https://github.com/mermaid-js/mermaid/pull/6734), [PR #7038](https://github.com/mermaid-js/mermaid/pull/7038), [PR #7772](https://github.com/mermaid-js/mermaid/pull/7772) | Calendar rules are semantic input. Multiple `excludes`/`includes`, `weekend`, and `weekday` must be parsed before durations are resolved. |
| Working-day hours | [#4060](https://github.com/mermaid-js/mermaid/issues/4060), [PR #7733](https://github.com/mermaid-js/mermaid/pull/7733), closed attempts [PR #5403](https://github.com/mermaid-js/mermaid/pull/5403) and [PR #6149](https://github.com/mermaid-js/mermaid/pull/6149) | Do not invent work-hour syntax. Support only after Mermaid core stabilizes it. Keep the calendar engine injectable enough to add it later. |
| Layout/readability | [#3794](https://github.com/mermaid-js/mermaid/issues/3794), [#5140](https://github.com/mermaid-js/mermaid/issues/5140), [#7602](https://github.com/mermaid-js/mermaid/issues/7602), [#7603](https://github.com/mermaid-js/mermaid/issues/7603), [#6260](https://github.com/mermaid-js/mermaid/issues/6260), [PR #7284](https://github.com/mermaid-js/mermaid/pull/7284) | Labels, ticks, compact rows, top axis, and `vert` markers need explicit layout tests. `vert` markers must not allocate a task row. |
| Styling and theme scaling | [#3020](https://github.com/mermaid-js/mermaid/issues/3020), [#5915](https://github.com/mermaid-js/mermaid/issues/5915), [#7471](https://github.com/mermaid-js/mermaid/issues/7471), [#5710](https://github.com/mermaid-js/mermaid/issues/5710), [PR #7432](https://github.com/mermaid-js/mermaid/pull/7432), [PR #7456](https://github.com/mermaid-js/mermaid/pull/7456), [PR #7498](https://github.com/mermaid-js/mermaid/pull/7498), [PR #7537](https://github.com/mermaid-js/mermaid/pull/7537) | Bar colors, task text contrast, and font-size scaling are part of renderer behavior. Role-style options must resize rows and bars, not only text. |
| Syntax/documentation drift | [#2848](https://github.com/mermaid-js/mermaid/issues/2848), [#5655](https://github.com/mermaid-js/mermaid/issues/5655), [PR #5194](https://github.com/mermaid-js/mermaid/pull/5194), [PR #5192](https://github.com/mermaid-js/mermaid/pull/5192), [PR #7443](https://github.com/mermaid-js/mermaid/pull/7443), [PR #5095](https://github.com/mermaid-js/mermaid/pull/5095) | Treat docs examples as fixtures. Document duration tokens. Allow `#` and `;` where Mermaid now allows them. |
| Interactivity and security | [#771](https://github.com/mermaid-js/mermaid/issues/771), [#2152](https://github.com/mermaid-js/mermaid/issues/2152), [#2077](https://github.com/mermaid-js/mermaid/issues/2077) | Parse click/link lines. Never execute callbacks. Sanitize links under the existing strict-security model. |

### Beautiful Mermaid and Agentic Mermaid forks

- [`lukilabs/beautiful-mermaid#59`](https://github.com/lukilabs/beautiful-mermaid/issues/59) requests “All Mermaid v11 diagrams” and includes a concrete Gantt sample with `interactive: true`.
- [`lukilabs/beautiful-mermaid` `phase1-charts`](https://github.com/lukilabs/beautiful-mermaid/tree/phase1-charts) contains branch-only Gantt code: `src/gantt/parser.ts`, `src/gantt/layout.ts`, `src/gantt/renderer.ts`, `src/ascii/gantt.ts`, and `src/__tests__/gantt.test.ts`. It is useful prior art, but it predates Agentic Mermaid’s current source normalization, strict-security pass, agent surface, golden fixtures, and deterministic-output requirements.
- Agentic Mermaid’s current [`TODO.md`](../../TODO.md) lists Gantt under BUILD-5 alongside pie, mindmap, and gitgraph. [PR #22](https://github.com/adewale/beautiful-mermaid/pull/22) adds the family-plugin consolidation, opaque fallback pattern, layout-quality adapters, and family-usage counter that Gantt should build on.

### Mermaid ASCII and terminal-renderer forks

- `AlexanderGrooff/mermaid-ascii` has no native Gantt support found in upstream issues, PRs, or code.
- [`pgavlin/mermaid-ascii`](https://github.com/pgavlin/mermaid-ascii) adds Gantt in Go under `pkg/gantt/`. Its README claims support for 22 diagram types and lists `gantt`; the implementation renders fixed-width horizontal bars, section headers, date markers, status glyphs, `after`, and durations.
- [`Chronostasys/mermaid-ascii`](https://github.com/Chronostasys/mermaid-ascii) inherits the pgavlin Gantt code and layers CJK/Unicode alignment fixes elsewhere.
- [`kais-radwan/ascii-mermaid`](https://github.com/kais-radwan/ascii-mermaid) and [`razor-ai/ascii-mermaid`](https://github.com/razor-ai/ascii-mermaid) implement a TypeScript Gantt ASCII renderer for Neovim virtual text. They support sections, bars, `after`, `done`/`active`/`crit`/`milestone`, and tests. They parse `excludes` but do not apply it to date arithmetic.

These terminal renderers converge on the same useful display shape: a left label column, section rows, a fixed-width timeline plot, and status-specific glyphs. Agentic Mermaid should keep that shape but use the current ASCII infrastructure: Unicode-width handling, `useAscii`, color modes, golden fixtures, and deterministic wrapping.

### Libraries already in this repo

`mermaid-ast@0.8.2` exposes `parseGantt`, `GanttAST`, and `renderGantt`. It models title, `dateFormat`, `axisFormat`, `tickInterval`, `inclusiveEndDates`, `topAxis`, `excludes`, `includes`, `todayMarker`, `weekday`, `weekend`, sections, tasks, click events, and accessibility. It is not a layout engine and keeps task data shallow, but it is a useful compatibility oracle and source-preservation aid.

## Compatibility target

Target Mermaid Gantt syntax as documented on Mermaid `develop` on 2026-06-11. Host renderers such as GitHub, GitLab, Obsidian, and Markdown plugins pin different Mermaid versions; Agentic Mermaid should not claim host parity. It should claim a pinned Mermaid-core syntax target and expose syntax support in `am capabilities --json` once Gantt lands.

The renderer must accept Mermaid source wrappers already supported by Agentic Mermaid:

- YAML frontmatter;
- `%%{init: ...}%%` and `%%{initialize: ...}%%` directives;
- Mermaid comments before the header;
- `accTitle:` and `accDescr:` inline or block directives.

## First-release syntax matrix

Legend: “parse” means recognized and preserved by the family parser. “render” means it affects SVG/ASCII output in the first Gantt release. “preserve” means source-level round-trip keeps the text even when the renderer ignores the semantic effect.

| Syntax / behavior | First release | Notes |
|---|---|---|
| `gantt` header | parse + render | Add `gantt` to `RoutedDiagramType`, loose detection, CLI/MCP capabilities, docs, gallery, and editor examples. |
| `title ...` | parse + render | Also included in label extraction and accessibility summary. |
| `accTitle`, `accDescr` | parse + render | Use existing SVG accessibility injection. Do not duplicate family-owned ARIA. |
| `dateFormat ...` | parse + render | Required for date parsing. Default is `YYYY-MM-DD`; test the docs claim behind [#5655](https://github.com/mermaid-js/mermaid/issues/5655). |
| `axisFormat ...` | parse + render | SVG and ASCII may format differently when terminal space is constrained; both must use the same resolved tick instants. |
| `tickInterval ...` | parse + render, bounded | Must validate interval count before generating ticks. Regression source: [PR #7197](https://github.com/mermaid-js/mermaid/pull/7197). |
| `inclusiveEndDates` | parse + render | Apply at scheduling boundary, not by stretching bars in renderer code. |
| `topAxis` | parse + render in SVG; parse + preserve in ASCII | SVG should draw top axis. ASCII may choose a single top/bottom axis according to width, but must document the choice. |
| `excludes ...` | parse + render | Support multiple lines per [PR #7772](https://github.com/mermaid-js/mermaid/pull/7772). Accept weekdays, `weekends`, and explicit dates. Do not support date ranges until Mermaid core does. |
| `includes ...` | parse + render | Multiple lines. Includes override excludes for explicitly listed dates. |
| `weekend friday|saturday` | parse + render | Mirrors [PR #5358](https://github.com/mermaid-js/mermaid/pull/5358). |
| `weekday <day>` | parse + render for weekly tick alignment | Do not let tick alignment affect task duration. |
| `todayMarker ...` / `todayMarker off` | parse + render only with supplied clock | Agentic Mermaid must not read wall-clock time by default. Draw the marker only when the caller passes `options.gantt.today` or equivalent; `off` always disables it. |
| `section ...` | parse + render | Section labels get their own row/band. Multiline HTML section labels are preserved; first release may render them as plain text with `<br>` normalized to a line break only if the renderer can size the row. See [#7602](https://github.com/mermaid-js/mermaid/issues/7602). |
| Task row: `Label : metadata` | parse + render | Preserve label text exactly enough for round-trip; render plain text after sanitization. |
| Task ids | parse + render | IDs are used by `after`, `until`, and `click`. Duplicate IDs are a structured parse error. |
| Status tags `done`, `active`, `crit` | parse + render | SVG classes and ASCII glyphs must distinguish states. Text contrast is tested in light/dark themes. |
| `milestone` | parse + render | Render as diamond/marker, zero-width task. |
| `vert` marker | parse + render | Render vertical marker without consuming a task row, per [PR #7284](https://github.com/mermaid-js/mermaid/pull/7284). |
| `after <id...>` | parse + render | Multiple IDs resolve to the latest referenced end date, matching Mermaid docs. Unknown IDs are structured errors, not silent fallbacks. |
| `until <date|id...>` | parse + render | Match Mermaid’s current semantics with differential fixtures. Duration + `until` backward scheduling is accepted only after Mermaid core merges stable syntax; track [#7407](https://github.com/mermaid-js/mermaid/issues/7407), [#7714](https://github.com/mermaid-js/mermaid/issues/7714), [PR #7409](https://github.com/mermaid-js/mermaid/pull/7409). |
| Duration tokens | parse + render | Support the documented Mermaid token set from [PR #7443](https://github.com/mermaid-js/mermaid/pull/7443): `ms`, `s`, `m`, `h`, `d`, `w`, `M`, `y`, including decimals where Mermaid accepts them. Invalid duration tokens are parse errors; see [#6586](https://github.com/mermaid-js/mermaid/issues/6586). |
| `click <id> href ...` | parse + sanitized render | Strict mode strips unsafe external refs as today. Loose mode may emit safe links if the existing renderer policy allows it. |
| `click <id> call ...` | parse + preserve only | Never execute JavaScript callbacks in Agentic Mermaid. No callback output in strict mode. |
| Frontmatter `config.gantt` / top-level Gantt config | parse + render where supported | `displayMode`, `barHeight`, padding, `topAxis`, `axisFormat`, `tickInterval`, and `todayMarker` should flow through the same normalized config path as xychart/timeline. |
| `displayMode: compact` | parse + SVG render; ASCII best effort | Compact layout uses deterministic interval packing inside each section. It must not overlap labels, bars, or ticks. See [#7603](https://github.com/mermaid-js/mermaid/issues/7603). |
| Comments and `#`/`;` in titles/task text | parse + preserve + render text | Mermaid changed parser behavior in [PR #5095](https://github.com/mermaid-js/mermaid/pull/5095). Fixtures must cover this. |

## Not supported in the first release

These are deliberate boundaries, not hidden gaps:

- **No typed ops for directives, click events, markers, or comments.** `asGantt` exposes ops on sections and tasks only (`set_title`, `add_section`/`rename_section`/`remove_section`, `add_task`/`remove_task`/`rename_task`, `set_task_status`, `set_task_dates`; exact list finalized against the other families' conventions). `dateFormat`, `excludes`/`includes`, `weekend`/`weekday`, `todayMarker`, `click`, and comment lines are preserved verbatim as opaque segments and are edited at the source level. Promoting any of them to typed ops is future work gated on the scheduler being able to re-resolve them.
- **No JavaScript callback execution.** `click id call fn(args)` is parsed and preserved; it is not executed or emitted as executable script.
- **No non-Mermaid proposed syntax.** This excludes date ranges in `excludes` ([#2424](https://github.com/mermaid-js/mermaid/issues/2424)), custom task states ([#3539](https://github.com/mermaid-js/mermaid/issues/3539)), relative symbolic dates such as `m1` ([#2850](https://github.com/mermaid-js/mermaid/issues/2850)), dynamic `now` / `getdate` task values ([#3532](https://github.com/mermaid-js/mermaid/issues/3532)), and vertical Gantt charts ([#6773](https://github.com/mermaid-js/mermaid/issues/6773)).
- **No dependency arrows beyond Mermaid syntax.** Users have asked for arrows in [#7300](https://github.com/mermaid-js/mermaid/issues/7300) and vertical dependency lines in [#3290](https://github.com/mermaid-js/mermaid/issues/3290). First release may compute dependency data for scheduling and accessibility, but the visual arrows are future work.
- **No WBS/subtask syntax.** Subtasks and work-breakdown hierarchies are requested in [#3295](https://github.com/mermaid-js/mermaid/issues/3295) and [#6449](https://github.com/mermaid-js/mermaid/issues/6449). Do not invent syntax.
- **No work-hour calendar syntax until Mermaid stabilizes it.** Track [#4060](https://github.com/mermaid-js/mermaid/issues/4060) and [PR #7733](https://github.com/mermaid-js/mermaid/pull/7733).
- **No BC/inverted time axis in first release.** Track [#4437](https://github.com/mermaid-js/mermaid/issues/4437).
- **No host-specific fallback behavior.** If GitHub’s pinned Mermaid version lacks a feature, Agentic Mermaid may still support it if the pinned syntax target does.

## Architecture

Build Gantt as a five-stage family pipeline.

### 1. Routing and family registration

Files to touch after PR #22:

- `src/mermaid-source.ts`: add `gantt` to strict and loose detection.
- `src/index.ts`: route SVG rendering to `src/gantt/*`.
- `src/ascii/index.ts`: route ASCII/Unicode rendering to `src/ascii/gantt.ts`.
- `src/agent/types.ts`: add `DiagramKind = 'gantt'`.
- `src/agent/families-builtin.ts`: register `id: 'gantt'`, detect `gantt`, and implement `extractGanttLabels`.
- `src/agent/family-layouts.ts`: add `ganttToRendered` so `measureQuality`, `checkQuality`, `verify.layout`, and layout-compare see Gantt geometry.
- `src/mcp/sdk-decl.ts`, `src/mcp/server.ts`, `src/cli/index.ts`, `Instructions_for_agents.md`, `llms.txt`, and skills: sync capability docs through the existing doc-sync tests.

The `FamilyPlugin` registers with `mutate` and `serialize` hooks from the start (the enforcement test fails CI otherwise): detect, label extraction, and a segment-preserving structured body whose serialization re-emits opaque segments verbatim. Unmodeled or unparseable bodies fall back whole-opaque, preserving source byte-for-byte.

### 2. Syntax parser

Create `src/gantt/parser.ts` and `src/gantt/types.ts`.

The parser should produce two related values:

- `GanttAst`: source-faithful syntax representation with raw text spans for directives, sections, tasks, markers, click events, and unknown-but-preserved lines where Mermaid accepts them.
- `GanttSemanticModel`: normalized values needed for scheduling and rendering: task IDs, status tags, dependency expressions, date/duration expressions, calendar directives, display options, accessibility text.

Use `mermaid-ast` as an oracle, not as the only implementation boundary. It can help detect syntax drift and preserve source, but Agentic Mermaid still needs its own resolver, validation, layout, SVG, ASCII, and security behavior.

Parser rules:

- never silently drop a line;
- duplicate task IDs are errors;
- references to unknown task IDs are errors in render mode;
- invalid dates/durations are errors with line/column where possible;
- labels are text, not HTML execution targets;
- task labels may contain words such as `gantt`, `section`, `title`, `#`, and `;` when Mermaid grammar allows them.

### 3. Calendar and dependency resolver

Create `src/gantt/schedule.ts`.

Do not let renderers compute dates. Renderers receive resolved task intervals and markers.

Core types:

```ts
interface GanttCalendar {
  dateFormat: string
  inclusiveEndDates: boolean
  excludes: CalendarExclusion[]
  includes: CalendarInclusion[]
  weekendStart: 'friday' | 'saturday'
  weekStart: 'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday'
}

interface GanttClock {
  today?: PlainDateLike
}
```

The resolver should avoid JavaScript wall-clock APIs. Use date-only values for date-only diagrams and explicit time values for time-bearing diagrams. This avoids DST and timezone bugs like [#7026](https://github.com/mermaid-js/mermaid/issues/7026). If a future implementation uses `Date`, the zone must be fixed and tested.

Scheduling rules:

- source order remains the tie-breaker;
- `after id1 id2` starts after the latest resolved end among references;
- `until id` ends at the referenced task’s start;
- fixed end dates are respected unless a calendar directive says working-duration tasks should extend over excluded dates;
- `includes` overrides `excludes` for explicit dates;
- the resolver enforces a bounded tick count and bounded scheduling iteration count;
- any cycle in dependency expressions returns a structured error naming the cycle.

### 4. SVG layout and renderer

Create:

- `src/gantt/layout.ts`
- `src/gantt/renderer.ts`
- `src/gantt/colors.ts` if status colors need family-local helpers

The `phase1-charts` branch is a starting point for the visual shape: left section/task columns, plot area, row lines, grid lines, bars, milestones, and optional hover overlays. Port the idea, not the code wholesale.

SVG requirements:

- deterministic output for the same source/options;
- no default wall-clock `todayMarker`;
- stable IDs namespaced through the existing `idPrefix` pass;
- strict security removes executable callbacks, unsafe hrefs, scripts, images, and external refs;
- role styling uses existing semantic roles:
  - `style.text` for axis/task/date labels;
  - `style.node` for bars and milestones;
  - `style.edge` for grid lines, today/vert markers, dependency-adjacent marks;
  - `style.group` for section bands;
- status classes: `gantt-bar`, `gantt-bar-done`, `gantt-bar-active`, `gantt-bar-crit`, `gantt-milestone`, `gantt-vert-marker`;
- text contrast tests for status bars in light and dark themes;
- `displayMode: compact` uses deterministic interval packing and has a fixture where dense rows would overlap under naive spacing.

### 5. ASCII and Unicode renderer

Create `src/ascii/gantt.ts` using current Agentic Mermaid ASCII infrastructure.

The terminal shape should combine the pgavlin and kais-radwan patterns:

```text
                    Project Plan
  Planning
    Requirements  ███████──────────────  01-01 → 01-14
    Design        ───────████████──────  01-15 → 02-04
  Development
    Backend       ─────────────████████  02-05 → 03-06
              ─────────────────────────
              Jan 1      Jan 15     Feb 1
```

ASCII/Unicode requirements:

- respect `useAscii`;
- preserve CJK/emoji display width when sizing the label column;
- use deterministic axis ticks from the same layout model as SVG;
- distinguish `done`, `active`, `crit`, `milestone`, and `vert` with glyphs that degrade in 7-bit ASCII;
- keep labels outside bars by default; terminal bars should not hide task names;
- support `maxWidth` by shrinking plot width before truncating labels;
- produce golden files under `src/__tests__/testdata/{ascii,unicode}/`.

## Verification and accessibility

Gantt verification should start source-level and structural:

- `EMPTY_DIAGRAM`: no renderable tasks or markers;
- `LABEL_OVERFLOW`: title, section names, task labels, axis labels, marker labels;
- `EDGE_MISANCHORED`: dependency/click reference points at an unknown task ID;
- `OFF_CANVAS`: resolved bars or markers outside plot bounds;
- `GROUP_BREACH`: section-owned rows outside the section band;
- `DUPLICATE_EDGE` is not relevant unless visual dependency edges are added later;
- `UNREACHABLE_NODE` is not relevant to Gantt.

`describeMermaid(..., {format:'json'})` should expose an AX tree with:

- chart title and date range;
- sections as groups;
- tasks with label, status, start, end, duration, dependencies;
- milestones and vertical markers;
- entry tasks with no dependencies;
- sinks/tasks that no later task depends on.

This AX tree is the non-visual fallback for terminal users and agent review.

## Testing strategy

Use the `testing-best-practices` approach: public contracts first, real parser/layout objects over mocks, golden fixtures for complex text/SVG output, property tests for scheduler invariants, and targeted mutation runs for the date resolver.

### Test tiers

| Tier | Files | Required coverage |
|---|---|---|
| Parser unit tests | `src/__tests__/gantt-parser.test.ts` | Mermaid docs examples; malformed headers; duplicate IDs; task labels with `#`, `;`, `gantt`; click/href/call; multiple excludes/includes; unsupported proposed syntax errors. |
| Scheduler property tests | `src/__tests__/property-gantt-schedule.test.ts` | No crashes for generated valid task DAGs; `after` starts after refs; cycle detection; excludes extend working-duration tasks but never shrink them; includes override excludes; tick generation bounded. |
| Layout tests | `src/__tests__/gantt-layout.test.ts` | Bars stay in plot area; labels stay in label column; compact rows do not overlap; `vert` consumes no row; `topAxis` geometry. |
| SVG integration/snapshots | `src/__tests__/gantt-svg-snapshot.test.ts` | Deterministic SVG; accessibility IDs; strict security; status classes; theme contrast; supplied-clock today marker. |
| ASCII/Unicode golden tests | existing `ascii.test.ts` fixture flow | Basic project, sections, dependencies, excludes, milestone, vert marker, compact dense chart, CJK labels, 7-bit ASCII. |
| Agent surface tests | `src/__tests__/agent-gantt.test.ts` | `parseMermaid` detects `kind:'gantt'`; serialize preserves opaque segments verbatim and is serialize-idempotent for structured bodies; `capabilities` reports structured mutation with the `asGantt` op list; each op round-trips through `am mutate`; fast-check round-trip property; label overflow works. |
| Corpus/differential tests | Mermaid docs corpus + `mermaid-ast`/Mermaid-core oracle | Docs examples parse; supported examples render; parse/render decisions match the pinned compatibility target. |
| E2E/editor tests | browser/editor suite | Gallery/editor can load a Gantt example, export SVG/PNG, and show ASCII. |

### Golden fixture policy

Use the existing promote/check workflow from `scripts/update-ascii-goldens.ts`:

- add the Mermaid source and expected output in the same fixture file;
- regenerate with `bun run goldens:ascii`;
- review the diff before commit;
- gate with `bun run goldens:ascii:check`.

Snapshot/golden files must not contain wall-clock dates. Fixtures that test `todayMarker` pass an explicit date through render options.

### Property invariants

Scheduler properties should use finite generated DAGs, not arbitrary line strings only:

- every resolved task has finite start/end;
- non-milestone tasks have positive visual width after layout;
- a task with `after refs` starts at or after the latest referenced end;
- a task with fixed duration has the same working-duration count after excludes/includes are applied;
- adding an excluded non-working day inside a working-duration task cannot make the task end earlier;
- changing `axisFormat` cannot change task geometry;
- increasing font size changes row metrics but not resolved dates;
- generated tick count stays under a fixed cap.

### Mutation testing

Add a targeted Stryker config once Gantt lands:

- include `src/gantt/parser.ts`, `src/gantt/schedule.ts`, `src/gantt/layout.ts`, `src/ascii/gantt.ts`;
- run manually or on a scheduled workflow, not in normal PR CI;
- treat surviving mutants in `schedule.ts` dependency resolution, exclusions, and duration parsing as release blockers.

## Rollout plan

1. **Gantt detection and agent surface.** Add `gantt` kind, plugin registration with mutate/serialize hooks, label extractor, docs, and tests. The body parser lands here with its segmentation (typed ops on sections/tasks, opaque segments for everything else), since the parser is where segmentation lives anyway. `am render` may still error until the renderer lands, but parse/mutate/serialize work from this step.
2. **Parser + scheduler with docs fixtures.** Implement syntax parser and deterministic resolver for supported Mermaid syntax. Differential-check against `mermaid-ast` and Mermaid docs examples.
3. **ASCII renderer + goldens.** Land terminal output first because it makes date/layout regressions easy to review in diffs.
4. **SVG renderer + PNG path.** Add role styling, accessibility, strict-security handling, status classes, and snapshots.
5. **Quality/layout adapter.** Add `ganttToRendered` through PR #22’s `family-layouts.ts` and include Gantt in layout-compare fixtures.
6. **Editor/showcase/docs.** Add one minimal example, one dense/compact example, and one milestone/vert example.
7. **Release notes and capability sync.** Update `README`, `docs/features.md`, `docs/diagram-families.md`, `CHANGELOG.md`, `llms.txt`, skills, and MCP SDK declarations. Let doc-sync tests catch drift.

## Research-driven improvements beyond parity

The wider literature and commercial-product survey lives in [`gantt-research.md`](./gantt-research.md). It adds four implementation requirements without changing the first-release syntax target:

- Keep scheduling pure: `src/gantt/schedule.ts` should own date, dependency, calendar, critical-path, and slack computation, with no DOM/SVG/canvas or wall-clock calls.
- Expose analysis without inventing syntax: critical path, slack, schedule range, dependency cycles, and entry/sink tasks belong in `describe`, `verify`, optional overlays, or future editor UI.
- Leave resource, baseline, owner, workload, and uncertainty syntax out of v1: commercial Gantt tools use those features heavily, but Mermaid does not define portable source syntax for them.
- Design for large schedules: overview/detail, zoom/filter, top axis, compact layout, bounded tick generation, and stable task regions should be planned from the first implementation even when only static SVG/ASCII is shipped.

The strongest improvement is not more syntax. It is a clean internal dependency/calendar model that can later power `describe`, critical-path overlays, row compaction, and editor details without changing Mermaid source.
