# Mermaid fidelity campaigns

These local-only campaigns preserve the Dave docs benchmark and earlier speed,
startup, delivery and memory measurements. They add stronger functional evidence;
they do not create a new overall tool score or silently retime unchanged tools.

| Lane | Observable boundary | Main limits |
| --- | --- | --- |
| `mermaid-fidelity` | Actual public Node models and browser SVG for pinned Mermaid, Agentic and Pele; 70 authored cases plus 21 edits, across 25 families | Finite feature combinations; ambiguous native/paint projections stay unavailable. |
| `community-fidelity` | The same authored cases and actual Chromium paint checks on frozen prepared community SVG artifacts | No acquisition, old timing reruns or inferred native-model passes. Terminal/parser/editor tools retain their separate boundaries. |
| `upstream-original` | Genuine Mermaid 12.2.0 source core Vite/Vitest project, unchanged expectations and read-only snapshots | Excludes the docs-site and browser/e2e workspaces. Expanded callbacks are not individual assertions. |
| `upstream-fidelity` | Original source callbacks/expectations through reviewed actual public parser/models | Private helpers, imports, state and matchers are unavailable; diagnostic/representation mismatches do not automatically establish a drawing defect. |
| `fidelity/report.ts` | Read-only composition of recorded criteria, versions, shared authored/observer Git objects and actual browser identity | No new renderer calls or performance claims. Different case/observer contracts cannot compose. |

All policy-stable families are required. Event Modeling and ZenUML remain
conservatively required pending maturity-policy review; issues
[#501](https://github.com/adewale/agentic-mermaid/issues/501) and
[#502](https://github.com/adewale/agentic-mermaid/issues/502) retain missing-product
evidence. Optional/beta supplements retain their explicit required flags. The
first-party ZenUML reference addon is separately pinned to 1.0.1 and explicitly
registered in the browser; it does not make core Mermaid's Node parser expose
ZenUML models. Pele is uniformly 1.9.0. A set rejects mixed tool versions.

## Run and update

Install the private benchmark package as described in [the package guide](../README.md).
Provide real built artifacts, Chromium, matching pinned Mermaid source/reference,
and the genuine upstream test runner dependencies. Nothing is installed by the
fidelity collectors. Start by inspecting available suites:

```sh
bun run bench --list --profile full
```

Collect core functional evidence with the selected native Node runtime:

```sh
bun run bench --profile full --suites mermaid-fidelity --out /tmp/fidelity-core \
  --package-root /path/to/built-agentic \
  --portable-artifact-root /path/to/pele-1.9.0 \
  --reference-dir /path/to/mermaid-reference --mermaid-dir /path/to/pinned-mermaid \
  --zenuml-root /path/to/mermaid-zenuml-1.0.1 \
  --node-executable /path/to/node --executable /path/to/chromium \
  --benchmark-records /path/to/records
```

Collect the community SVG boundary on existing prepared artifacts, without
repeating old clocks or acquiring tools:

```sh
bun run bench --profile full --suites community-fidelity --out /tmp/fidelity-community \
  --community-browser-prepared /path/to/community-browser-prepared.json \
  --executable /path/to/chromium --benchmark-records /path/to/records
```

Add `--projects obsidianmd/pele` to update only Pele. Selection occurs before
loading unselected engines. Exact artifact, dependency and protocol identities
reuse immutable records and original measurement dates. A changed qualification
protocol legitimately requires new affected functional evidence; changing a
report does not. `--benchmark-force` explicitly bypasses reuse. Collection
failures retain incomplete attempts rather than publishing false passing records.

Run original tests separately:

```sh
bun run bench --profile full --suites upstream-original,upstream-fidelity \
  --out /tmp/fidelity-upstream --mermaid-dir /path/to/pinned-mermaid \
  --reference-dir /path/to/mermaid-reference \
  --upstream-runner-root /path/to/genuine-vitest-kit \
  --package-root /path/to/built-agentic --portable-artifact-root /path/to/pele-1.9.0 \
  --node-executable /path/to/node --benchmark-records /path/to/records
```

A selected peer without a core adapter does not start the core reference worker.
The native Mermaid source run still accounts for declarations outside core
discovery and unmapped locations. It never edits snapshots or source tests.

Compose matching functional reports into a searchable HTML dashboard, per-family
paint heatmap, scoped Markdown table and complete JSON ledger:

```sh
bun run eval/benchmark/fidelity/report.ts \
  --core /tmp/fidelity-core/mermaid-fidelity/fidelity-report.json \
  --community /tmp/fidelity-community/community-fidelity/community-fidelity-report.json \
  --out /tmp/fidelity-report
```

Export standalone charts using standard Matplotlib plotting:

```sh
python3 eval/benchmark/fidelity/charts.py --report /tmp/fidelity-report/comparison.json \
  --out /tmp/fidelity-report/charts
```

The separate-dimension bars, full family heatmap and reference-qualification
chart retain unavailable evidence. A radar score would hide missing axes and
unjustified weighting, so it is not used for these bounded fidelity counts.

Font-option reviews preserve raw computed-size statuses and available values but withhold configuration
credit when an adapter's public API has no reviewed all-label mapping. Beautiful
base APIs lack the global option; Vercel separates node and edge sizes. Merely
finding a render export cannot establish option support. The report's capability
review ledger records the original status, any actually recorded values and why comparison credit is withheld.
This requalification does not rerender unchanged tools.

## Read the evidence

A criterion plan is created before rendering. It includes every authored
identity, relationship, value and paint requirement. Missing results remain
blocked or unsupported. Reports reconstruct that plan even if producers omit
rows for every tool, and retain wholly missing admitted projects. They show
three dimensions separately: public SVG/API behavior, actual owned paint and
native models. Serializer-specific operations remain unranked capabilities.

The raw denominator and baseline-unqualified criteria are always visible.
Reference-qualified comparisons admit criteria pinned Mermaid actually passes;
reference failures require source/observer/product review. Their exclusion from
that scoped comparison does not erase them or establish that peers are correct.
A complete case requires every declared criterion, including unavailable ones.

Labels alone earn no topology/value credit. Independent model checks compare
identities, direction, multiplicity, parents, ordering and values. Actual SVG
checks observe owned shapes/routes/markers, relationship-label correspondence,
visibility, clipping, font-size changes, decoded images and supported chart
value geometry. Styles/gradients/masks without a reviewed projection remain
unavailable. PNGs and lossless community SVGs belong to retained attempts;
identical artifact aliases reference their real source experiment rather than
adding independent votes.

Public docs and tests are external workloads, not a hidden holdout. Dave's
full occurrence acceptance and common-success time remain valuable separate
measures. Security/configuration rejection, unavailable backend and drawing
fidelity need different columns. A generic runtime exception cannot earn a
negative-syntax pass. Original assertion wording and private DB shapes are
strict compatibility results, not automatic independent correctness findings.

Remaining scopes include full feature combinations, private upstream APIs,
browser/e2e source tests, complete custom paint/ownership, accessibility and
perceptual/typographic review. Memory/startup belong to the existing separate
resource protocols: document V8 heap is not whole-browser/native/GPU memory;
leak slopes, concurrency and deployed/provider dollar costs remain incomplete.
