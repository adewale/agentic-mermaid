# Gantt research appendix

Status: evidence appendix for [`gantt.md`](./gantt.md). Snapshot date: 2026-06-11.

This appendix records the wider research requested after the initial Gantt spec: a broad academic search, a commercial/product UX survey, and the changes those sources imply for Agentic Mermaid. The implementation contract remains Mermaid-compatible; this appendix identifies internal hooks and future UI features that should not leak into Mermaid syntax.

## Method

Search channels:

- GitHub issue/PR searches across `mermaid-js/mermaid`, `lukilabs/beautiful-mermaid`, `adewale/agentic-mermaid`, and Mermaid ASCII forks.
- Crossref DOI search for Gantt, task schedules, project scheduling, timeline visualization, critical path, uncertainty, and resource-constrained scheduling.
- Official product docs and feature pages for commercial Gantt/timeline tools.
- Local source inspection of `upstream/phase1-charts`, `pgavlin/mermaid-ascii`, `kais-radwan/ascii-mermaid`, `razor-ai/ascii-mermaid`, and `mermaid-ast`.

Representative academic queries:

- `Gantt chart project management visualization`
- `Gantt chart limitations project scheduling visualization`
- `Gantt charts dependencies resource leveling visualization`
- `A Literature-based Visualization Task Taxonomy for Gantt Charts`
- `Comparing Static Gantt and Mosaic Charts for Visualization of Task Schedules`
- `Visualization of Task Time Schedule Uncertainty in Project Management`
- `Project management under uncertainty resource flexibility visualization in the schedule`
- `timeline visualization survey temporal data`
- `visualizing temporal data survey time-oriented data`
- `critical path method project scheduling Gantt chart`
- `resource constrained project scheduling survey visualization`

Exclusions:

- SEO tutorials that explain what a Gantt chart is but do not add syntax, layout, or testing requirements.
- Tools that only call Mermaid or Mermaid CLI and return an SVG screenshot.
- Vendor pages without enough detail to infer an interaction or scheduling feature.

Limit: this is Google-Scholar-style breadth using Crossref and web-accessible metadata, not a formal systematic review with database-specific inclusion scoring. The implementation decisions below rely only on stable, cited claims.

## Academic literature

### Gantt-specific visualization and schedule displays

| Source | Finding | Spec implication |
|---|---|---|
| Sakin and Isaacs, [“A Literature-based Visualization Task Taxonomy for Gantt Charts”](https://doi.org/10.1109/VIS55277.2024.00055), IEEE VIS 2024 | Gantt charts have enough distinct visualization tasks to merit their own task taxonomy. | Add Gantt-specific `describe` and quality checks instead of treating Gantt as generic bars. Test tasks such as locate task, compare durations, find dependencies, find critical tasks, inspect schedule range, and detect overlap/crowding. |
| Luz and Masoodian, [“Comparing Static Gantt and Mosaic Charts for Visualization of Task Schedules”](https://doi.org/10.1109/IV.2011.53), IV 2011 | Static Gantt is not always the best representation for dense task schedules; alternatives can make different comparisons easier. | Keep first release to Mermaid Gantt, but separate schedule model from renderer so future ASCII/SVG modes can add condensed or grouped views without changing parser semantics. |
| Maravas and Pantouvakis, [“Schedula Anima: Dynamic Visualization of Gantt Charts and Resource Usage Graphs in Project Scheduling”](https://doi.org/10.3390/buildings15030393), Buildings 2025 | The paper animates schedule states between early and late dates and pairs Gantt bars with resource graphs; the abstract notes earlier delays have larger downstream effects. | The resolver should compute earliest/latest dates and slack internally when dependencies are available. Do not draw the critical path in v1 unless the computation is explicit and tested. |
| Lu, Mao, and Chai, [“Visualization of Task Time Schedule Uncertainty in Project Management”](https://doi.org/10.3724/SP.J.1089.2018.16718), Journal of CAD & Computer Graphics 2018 | Schedule uncertainty is a first-class visualization problem, not a styling detail. | Do not invent uncertainty syntax. Leave room in the model for optional intervals or confidence bands if Mermaid or a future Agentic extension adds them. |
| Lima, Tereso, and Faria, [“Project management under uncertainty: resource flexibility visualization in the schedule”](https://doi.org/10.1016/j.procs.2019.12.197), Procedia Computer Science 2019 | Resource flexibility and schedule uncertainty interact; useful displays combine schedule and resource information. | Resource capacity belongs in a future analysis/UI layer unless Mermaid standardizes resource fields. The v1 parser should not infer resources from labels or assignees. |
| Ong, Wang, and Zainon, [“Integrated Earned Value Gantt Chart (EV-Gantt) Tool for Project Portfolio Planning and Monitoring Optimization”](https://doi.org/10.1080/10429247.2015.1135033), Engineering Management Journal 2016 | Portfolio monitoring benefits from planned-vs-actual and earned-value information layered onto schedules. | Baselines and planned-vs-actual are common product features, but Mermaid Gantt lacks native baseline syntax. Keep them out of syntax; possible future: `describe` can report plan/actual only if the source model gains explicit fields. |
| Scully-Allison and Isaacs, [“Evaluating Communication Pattern Representations in Execution Trace Gantt Charts”](https://doi.org/10.1109/VISSOFT64034.2024.00011), VISSOFT 2024 | Gantt-like timelines appear outside project management, including execution traces where communication patterns matter. | Keep renderer primitives generic enough for intervals, lanes, markers, and links. Do not bake project-management-only assumptions into layout code. |

### Timeline and temporal-data visualization

| Source | Finding | Spec implication |
|---|---|---|
| Shneiderman, [“The Eyes Have It: A Task by Data Type Taxonomy for Information Visualizations”](https://doi.org/10.1109/VL.1996.545307), IEEE VL 1996 | The useful interaction sequence is “overview first, zoom and filter, then details-on-demand.” | The live editor should eventually add zoom/filter/details for large Gantts. ASCII should preserve overview by keeping labels and dates visible outside bars. |
| Brehmer et al., [“Timelines Revisited: A Design Space and Considerations for Expressive Storytelling”](https://doi.org/10.1109/TVCG.2016.2614803), TVCG 2017 | Timeline design separates scale, layout, representation, and annotation choices. | Keep parser, scheduler, layout, and renderer as separate modules. `vert` markers are annotations; they should never be parsed as tasks. |
| Plaisant et al., [“LifeLines: Visualizing Personal Histories”](https://doi.org/10.1145/238386.238493), CHI 1996 | Temporal records benefit from overview plus drill-down and from aligning events across categories. | Section grouping and row alignment are not cosmetic. They should be part of layout tests and AX-tree output. |
| Aigner et al., [“Visualization of Time-Oriented Data”](https://doi.org/10.1007/978-0-85729-079-3), 2011 | Time-oriented data visualization has recurring design decisions: time primitives, scale, calendar, granularity, and interaction. | Model date-only and date-time diagrams explicitly. Avoid raw JavaScript `Date` arithmetic at renderer call sites. |
| Heer and Shneiderman, [“Interactive Dynamics for Visual Analysis”](https://doi.org/10.1145/2133806.2133821), CACM 2012 | Interaction primitives include selection, filtering, navigation, coordination, and history. | Renderer v1 should emit stable task IDs and regions so future UI selection and details panels do not require SVG scraping. |
| Munzner, [“A Nested Model for Visualization Design and Validation”](https://doi.org/10.1109/TVCG.2009.111), TVCG 2009 | Visualization work should validate domain problem, data/task abstraction, visual encoding, and algorithms separately. | Testing should mirror the model: parser fixtures, scheduler properties, layout assertions, SVG/ASCII goldens, and E2E editor checks. |

### Scheduling theory and project-management analysis

| Source | Finding | Spec implication |
|---|---|---|
| Kelley and Walker, [“Critical-Path Planning and Scheduling”](https://doi.org/10.1145/1460299.1460318), 1959 | CPM derives project duration from dependency paths. | Critical path is computable from dependencies/durations; it should be an analysis output, not a syntax extension. |
| Kelley, [“Critical-Path Planning and Scheduling: Mathematical Basis”](https://doi.org/10.1287/opre.9.3.296), Operations Research 1961 | CPM uses earliest/latest times and slack. | If Gantt `describe` adds critical-path evidence, it should report slack and the assumptions used. |
| Hartmann and Briskorn, [“A survey of variants and extensions of the resource-constrained project scheduling problem”](https://doi.org/10.1016/j.ejor.2009.11.005), EJOR 2010; updated survey [doi:10.1016/j.ejor.2021.05.004](https://doi.org/10.1016/j.ejor.2021.05.004) | Resource-constrained scheduling has many variants and constraints. | Do not implement resource leveling by inference. The parser should reject or preserve non-Mermaid resource syntax rather than pretending to schedule resources. |

## Commercial and library UX survey

Commercial tools converge on a small set of Gantt affordances. These are useful product references, but they should not change the Mermaid parser unless Mermaid core adds syntax.

| Tool / source | Observed features | What Agentic Mermaid should do |
|---|---|---|
| Microsoft Project, [critical path support](https://support.microsoft.com/en-us/office/show-the-critical-path-of-your-project-in-project-desktop-ad6e3b08-7748-4231-afc4-a2046207fd86) | Critical path, slack, dependencies, milestones, baselines, progress, resource concepts. | Compute critical path/slack only as optional analysis once the scheduler is reliable. Do not expose Microsoft-specific concepts in syntax. |
| Smartsheet, [Gantt/project settings](https://help.smartsheet.com/articles/765755-working-with-gantt-charts) and [dependencies/predecessors](https://help.smartsheet.com/articles/765727-enabling-dependencies-using-predecessors) | Grid + Gantt pairing, predecessors, dependencies, duration, milestones, critical path. | Agentic editor should keep source and rendered view side-by-side. CLI should keep source as the edit format, not introduce a grid file format. |
| Asana, [Gantt chart basics](https://asana.com/resources/gantt-chart-basics) | Dependencies, milestones, owners, critical path, progress, drag-style planning concepts. | Owner/resource metadata is outside Mermaid Gantt. The AX tree can still make dependencies and milestones explicit. |
| TeamGantt, [features](https://www.teamgantt.com/features) and [Gantt chart software](https://www.teamgantt.com/gantt-chart-software) | Lead/lag dependencies, planned-vs-actual baselines, critical path, workload, exports, sharing. | Lead/lag belongs on the watchlist because Mermaid users request delay syntax in [#818](https://github.com/mermaid-js/mermaid/issues/818). Baselines/workload stay future UI-only unless syntax emerges. |
| ClickUp, [Gantt view](https://help.clickup.com/hc/en-us/articles/6310249474967-Gantt-view) | Dependencies, resources, progress, delays, critical path, baselines, milestones, zoom, drag, filters, exports. | Live editor follow-up: zoom/filter/details controls. Spec v1 should only guarantee deterministic static output. |
| monday.com, [Gantt](https://monday.com/features/gantt) | Drag timelines, baselines, task dependencies, critical paths, milestones, bottleneck spotting. | “Bottleneck” can map to future warnings once critical path/slack exists. It is not a parse requirement. |
| Instagantt, [product page](https://instagantt.com/) | Drag-and-drop scheduling, dependencies, milestones, workload, baselines, dashboards, exports, read-only sharing. | Sharing/export maps to existing SVG/PNG/MCP artifacts. Workload/baseline remain out of syntax. |
| Zoho Projects, [Gantt charts](https://www.zoho.com/projects/gantt-charts.html) | Dependencies, drag rescheduling, critical path, baselines, milestones, progress, bottlenecks. | Reinforces critical-path/slack as useful analysis. No syntax change. |
| OpenProject, [Gantt docs](https://www.openproject.org/docs/user-guide/gantt-chart/) | Add predecessors/successors in Gantt, drag dates, dependencies, baseline comparison, filters, exports, collapse/expand, progress. | Future editor UX could let users inspect dependency references, but source remains authoritative. Collapse/expand is a UI concern unless Mermaid adds syntax. |
| DHTMLX Gantt, [library page](https://dhtmlx.com/docs/products/dhtmlxGantt/) | Auto-scheduling, critical path, resources, baselines, deadlines, calendars, exports, split tasks, live updates. | JS Gantt libraries separate a scheduling engine from rendering. Agentic Mermaid should do the same: `schedule.ts` should be tested independently. |
| Bryntum Gantt, [library page](https://bryntum.com/products/gantt/) | Scheduling engine, dependencies, constraints, scheduling modes, baselines, progress, critical paths, resource calendars, server-side engine. | Keep the Gantt resolver DOM-free and pure so it can run in CLI/MCP without browser APIs. |
| Highcharts Gantt, [docs](https://www.highcharts.com/docs/gantt/getting-started-gantt) | Tasks/events/resources along a timeline, dependencies, drag, zoom, tooltips, exporting. | Task regions should be stable so future browser layers can attach tooltips without changing SVG structure. |
| Google Charts Gantt, [docs](https://developers.google.com/chart/interactive/docs/gallery/ganttchart) | Start/end/duration, dependencies, resources, tooltip, critical path colored red by default, dependency arrow styling. | Critical path should be opt-in or theme-aware, not a hard-coded red default. Strict security must still hold. |
| Frappe Gantt, [repository](https://github.com/frappe/gantt) | Open-source JS Gantt with dependencies, progress, drag interactions, view modes, popup/details, holidays/weekend handling. | View modes and popups are good editor ideas. Parser syntax remains Mermaid. |
| Airtable Timeline, [docs](https://support.airtable.com/docs/timeline-view) | Timeline grouping/filtering/sharing, more database timeline than scheduling engine. | Useful contrast: not every timeline is a Gantt scheduler. Agentic Mermaid should not degrade Gantt into a generic timeline. |

## Requirements added by the wider research

These requirements refine the base spec.

1. **Keep scheduling pure.** `src/gantt/schedule.ts` should have no SVG, no canvas, no DOM, and no wall-clock calls. This matches scheduling-engine practice in commercial Gantt libraries and makes property tests possible.
2. **Expose analysis without inventing syntax.** Critical path, slack, schedule range, entry tasks, terminal tasks, and dependency cycles can be computed from standard Mermaid source. They belong in `describe`, `verify`, optional overlays, or future editor UI.
3. **Leave resource and baseline features out of v1 syntax.** Commercial tools rely heavily on baselines, workload, and resource calendars, but Mermaid Gantt does not define portable source syntax for them. Preserve unknown syntax if Mermaid accepts it; otherwise error clearly.
4. **Design for large schedules.** Labels, zoom/filter affordances, bounded tick generation, compact layout, and top-axis support are not polish. They address known Mermaid issues and commercial-product expectations.
5. **Make uncertainty future-safe.** The model should not preclude optional intervals or planned-vs-actual bands, but first release must render one deterministic interval per task.
6. **Test by task, not by file only.** Gantt-specific tasks from the VIS taxonomy and commercial survey should become named fixtures: locate milestone, compare durations, inspect dependency chain, find critical path, detect crowded compact layout, inspect excluded weekend, verify top axis.
7. **Keep accessibility semantic.** The AX tree should expose section/task/dependency/date-range information even when SVG bars are visually dense.

## Proposed spec amendments

The base [`gantt.md`](./gantt.md) should keep its syntax matrix unchanged, but implementation planning should add these follow-up hooks:

- `GanttScheduleAnalysis`: `{ criticalPathTaskIds, slackByTaskId, projectStart, projectEnd, entryTaskIds, sinkTaskIds }`, computed only when the dependency graph is valid.
- `GanttRenderedRegion`: stable regions for sections, task bars, milestones, vertical markers, axis ticks, and dependency references. This supports future TUI/editor click mapping.
- `GanttRenderMode`: an internal option, not syntax, for `standard | compact | overview`. First release implements `standard` and Mermaid `displayMode: compact`; future overview mode may serve large schedules.
- `GanttClock`: explicit `today`, never implicit wall-clock.
- `GanttCompatibilityReport`: optional debug output listing parsed-but-ignored directives and unsupported proposals.

## Research-backed non-goals

- Do not add baselines, resources, owners, or workload syntax unless Mermaid core standardizes it.
- Do not infer critical path when dependencies are missing or cyclic.
- Do not render dependency arrows in v1 unless they are separately tested for label/tick overlap.
- Do not use a browser Gantt library as the implementation; it would violate Agentic Mermaid’s synchronous, DOM-free core.
- Do not optimize for interactive drag editing in v1. Source remains the edit format.

## Search artifacts to repeat before implementation

Before coding Gantt, repeat these checks because Mermaid Gantt is active:

```bash
gh search issues "gantt repo:mermaid-js/mermaid" --limit 100
gh search prs "gantt" --repo mermaid-js/mermaid --limit 100
gh search code "gantt mermaid-ascii fork:true" --limit 100
```

Also re-check Mermaid docs and grammar:

- <https://mermaid.js.org/syntax/gantt.html>
- <https://github.com/mermaid-js/mermaid/blob/develop/packages/mermaid/src/docs/syntax/gantt.md>
- <https://github.com/mermaid-js/mermaid/blob/develop/packages/mermaid/src/diagrams/gantt/parser/gantt.jison>
