# Agent editing: follow-up class audit

PR #456's initial audited production revision was
`7ee54ddee06e6890996aed67fbf3ccb77907ab91`. The follow-up examined related
failures rather than treating its first regression examples as isolated bugs.
It found more failures, including mistakes in the follow-up implementation.
The checks below establish bounded contracts; they do not establish that the
broader bug classes are absent.

## Source and evidence

Generated checks cover all 23 built-in family builders, repeated comments,
randomized placement, wrappers and JSON transport. Flowchart/State edit
sequences rename endpoints, remove parallel edges and delete/recreate IDs.
State witnesses include notes, quoted percent signs, composites and regions.
Parser-owned comment rules prevent literal text from becoming invented
comments. Header-relative readers now preserve Block, Treemap and Ishikawa
bodies when wrapper comments precede their headers.

The 40 preservation tests passed; against the initial audited production,
27 failed and 13 already passed. Finder seed `20261021` with 100 generated
cases per property passed 16,483 assertions. This is evidence about those
grammars and sequences, not every possible source edit.

Flowchart/State comments retain stable semantic anchors when available. Other
structured families retain detected comments at the body end. Inline placement
and whitespace can normalize. Opaque fallback preserves unsupported source
and refuses structured edits; segment-preserving editing is a separate policy.

Verification captures known source-loss evidence before config, layout or
render dispatch. Tests span every registered built-in plus empty/preserved
bodies, diagnostic suppression, structural loss and injected failures in
family verification, layout, projection and SVG hooks. A diagnosed loss cannot
be cleared by these returned failures or suppression. Structural tallies do
not establish label equality or task correctness.

Selectors now share exact occurrence parsing and authored-ID precedence across
mutation and hints. Generated interleaved/reciprocal graphs and diagnostic
read-back catch global-index mistakes, malformed suffixes and duplicate
authored IDs. Unsupported arbitrary encodings are not a universal identity
scheme.

## Rendered categories and numeric boundaries

BUILD-34's paint census is implemented: 1,258 corpus/style combinations and
288 count/background/backend combinations. The registry identifies families
using hue for peer identity. Actual backends and a separate rasterizer measure
category ink and semantic key/mark correspondence. The checks exposed Journey
identity/visibility failures, GitGraph opacity compression and stale Pie,
Radar and XY keys after role overrides. A final fresh reviewer found that
XY labeled/interactive dots still used their original palette. Point paint
now inherits effective series paint, with explicit point overrides and authored
palette precedence covered through actual SVG and raster observations.

The atlas removes overlap and layout geometry to isolate paint. It does not
certify occlusion, clipping, thin antialiasing, an unknown host backdrop or
intentional author overrides. Those limits remain explicit in
`docs/design/system/chart-honesty.md`.

Numeric checks now include sub-cent display values, large safe integers,
subnormal numbers, JavaScript exponent transitions and finite huge domains.
Generated positive finite binary64 values pass through typed Pie/Radar edits,
decimal source serialization and structured reparse without value changes.
Radar ring values retain scale data instead of coordinate rounding; range
interpolation avoids overflowing an intermediate product. Pie rejects a total
outside the finite numeric range, or a positive share that underflows to zero,
instead of verifying a zero-share drawing. Mixed-magnitude pair checks exercise
that admission in both outputs and declaration orders.
Normal display rounding remains a presentation policy.

The adversarial review caught a large-integer regression in the new display
formatter; its integer fast path and public-output regression now cover it.
Seven new numeric tests failed against the initial audited production. Separate
boundary checks compare radial geometry, terminal scales and diagnostic ranges
with independent arithmetic over generated domains.

## Labels and execution

The independent Mermaid reference census enrolls documentation, official
fences, the upstream bench and authored witnesses. Reports retain raw values,
unavailable surfaces and paired baseline/head changes. Regression assertions
cover every built-in family's selected labels and generated Sequence controls,
aliases, boxes, metadata and properties. This found discarded flat Class
namespace context and order-sensitive Sequence metadata during relabeling.
Visual review exposed Class shafts crossing restored namespace headers. The
header detour initially refused an official fanout because nominally vertical
coordinates differed by floating-point roundoff. The full census found that
regression; tolerance-based axis classification fixes it. Owning checks span
short/wrapped headers, four directions and 40 further fanout/fanin layouts.
The 1,154-input census then showed no regression in selected label presence
against the pre-merge report. This does not prove arbitrary route feasibility.
Read-back now includes recognized Sequence messages/titles inside preserved
segments and sparse XY point labels. GitGraph retains an authored merge ID
instead of hiding it behind a synthetic message. Exact-fact consumers need
the additive inventory migration described in `docs/api.md`. The final
adversarial review widened metadata aliases to braces and quotes, found a
first-closing-brace lexer loss, and checked its repair against Mermaid. An
entity-based repair exposed a second interaction with style preprocessing;
JSON scalar Unicode escapes preserve both metadata structure and exact aliases.

The census is existential text-presence evidence. It does not prove label
identity or multiplicity. Class/ER members, accessibility and Sequence
note/control text need broader projections. Opaque source, intentionally
hidden labels and documented display differences are separate dispositions,
not successful equality checks. TEST-8/TEST-9 retain those narrower gaps.

Code Mode now defines strict function-body semantics in both runtimes.
Generated statements and explicit expected values cover final expressions,
empty statements, comments, nested functions, arguments, constructors,
`new.target`, automatic semicolon insertion and strict syntax. Differential
agreement alone is not the oracle. Security and host budget tests remain
separate from language behavior.

TEST-10's finder modes now explicitly shuffle file arguments and launch a
fresh OS process per file. Logs record exact files and replay seeds. Focused
local runs passed; scheduled full-suite results require the updated workflow
to run. New finder modes retain artifacts without filing issues. TEST-11 is also
complete: every CI unit shard installs the real CJK coverage font fixture.

## Live-agent evidence and remaining external work

Four fresh subagents ran two identical editing tasks with and without the
workflow skill. Both conditions produced correct diagrams, 2/2 each. The
skill-guided agents used the public hosted mutation and verification tools;
the no-docs agents returned diagrams directly. The model inherited the session
default; the harness did not report a model ID or token counters. This sample
does not establish a success-rate improvement or lower cost.

The API runner now records actual provider usage, including Anthropic cached
input, elapsed time and the first successful parse/create in execution. Missing
usage stays unavailable. Paired requests alternate condition order and retain
task correctness separately from trace/cost. This measures one-shot generation
followed by execution, not an autonomous discovery/retry loop.

No provider credential/model was configured for a measured API comparison.
An existing ChatGPT CLI login was tried, but its in-process client could not
initialize on a read-only state directory. Larger instrumented trials remain
EVAL-3. A controlled evaluation is not an independent external consumer, so
DEC-1 remains open. No new issues were filed and nothing was deployed or
published by this audit.

## Reproduce

Use Bun 1.4.2 with installed dependencies. The owning tests are
`property-source-preservation`, `verify-evidence-propagation`,
`edge-selector-contract`, `category-paint`, `chart-small-values`, `agent-radar`,
`hosted-execute-differential` and `agent-usage-live` under `src/__tests__`.
Run with `bun test --timeout 30000` and the selected paths. Run
`bun run test:mermaid-modern` with the pinned independent reference installed.
The label census command and paired-report options are documented in
`eval/mermaid-modern-compat/README.md`.

Run `bun run typecheck`, `bun run lint`, `bun run build:browser:lazy` and
`bun run check:browser-lazy` for integration. At revision `155ded4`, the merged browser graph audit found no accidental capabilities in the lazy
closures. Real hint, preservation and layout code crosses seven encoding
ceilings, so this follow-up uses main’s existing 500-byte measured ratchet:
Flowchart gzip 711,350 / ceiling 711,500 and Brotli 576,200 / 576,500; State
gzip 711,299 / 711,500 and Brotli 576,103 / 576,500; Architecture Brotli
572,548 / 573,000; Kanban raw 591,155 / 591,500; Treemap raw 602,175 /
602,500. Request limits stay unchanged. Initial transfer is 5,492 bytes gzip.
These are measured costs of the combined changes, not a size reduction claim. The follow-up integrates main `e951d22`, including its conditional rendering
dependencies and authored-line grammar handling. Full final-revision CI and
its retained same-input render artifacts are the PR's integration evidence.

## Rebase onto native crisp drawing

The rebase onto main `bd0ccbe` retains its native crisp drawing path alongside
the authored paint, numeric and preservation fixes. Local typecheck, lint and
116 independent reference checks pass on the combined candidate. The changed
crisp/Scene paths are also exercised by the owning drawing and paint tests.
The old `155ded4` size measurements above are historical. On the rebased build,
13 encoding ceilings cross main’s limits; the same measured 500-byte ratchet
applies. The largest increase is Flowchart gzip, 712,000 to 713,000 bytes,
against an actual 712,535. Request limits stay unchanged; initial transfer is
5,493 bytes gzip. These costs do not establish layout continuity or a complete
portable-export verdict. Final rebased CI is linked from PR #456.

The rebased website payload lane measures the default demo at 787,643 raw /
302,191 gzip bytes, crossing the inherited ceilings by 643 / 91 bytes. Its
ceilings become 788,000 / 302,500; request and per-PR growth gates remain. A
separate Chromium launch crashed before executing application tests; rerun
results, rather than that failed process, determine browser readiness.
