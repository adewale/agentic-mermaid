# Release benchmark: pass

Engines: baseline 0.4.2 vs candidate 0.4.2. Inputs: 537 distinct official examples and 29 scaling/agent workloads. Full upstream fence accounting is in corpus.json; browser/competitor results are advisory in browser-report.md.

| Gate | Result | Detail |
|---|---|---|
| Every candidate measurement completes | pass | 566/566 inputs completed 3 rounds |
| Cold SVG render succeeds | pass | flowchart rendered |
| Deterministic SVG and ASCII output | pass | all repeats and fresh processes agree |
| No newly invalid SVGs (resvg) | pass | none; existing baseline parse failures are excluded from comparisons |
| Expected SVG labels survive rendering | pass | all enrolled label assertions pass |
| Every scaling and agent workflow succeeds | pass | 29 workloads passed |
| Every required baseline measurement completes | pass | 566/566 inputs completed 3 rounds |
| Baseline has comparable successful SVG measurements | pass | 431/566 total; 402/537 corpus inputs compared |
| No lost SVG renders | pass | none |
| No lost ASCII renders | pass | none |
| Corpus render time ≤ 1.25× baseline | pass | 1.00× |
| Each compared family ≤ 1.5× baseline | pass | no family regression on shared successes |
| Each large case ≤ 1.5× baseline | pass | 29/29 compared |
| Required matched corpus memory measurements complete | pass | 402 shared inputs |
| Corpus allocation ≤ 1.25× baseline | pass | 0.99× |
| Corpus peak RSS ≤ 1.25× baseline | pass | 0.99× |
| Retained heap growth per corpus pass ≤ 16.0 MiB | pass | 3.9 MiB across 402 successful candidate inputs |

## Matched successful SVG renders

All time, allocation and RSS comparisons use the same stable, parseable SVG inputs in both engines. Rejections are excluded. Counts of rendered SVGs include every measured input; newly supported inputs are reported without a speed comparison.

| Family / case | Measured | SVG renders (base → cand) | Changed SVGs | Compared | Time (base → cand) | Speed-up | Allocated (base → cand) |
|---|---|---|---|---|---|---|---|
| agentflow | 12/12 | 0 → 0 | 0 | 0 | — → — | — | — → — |
| architecture | 6/6 | 6 → 6 | 1 | 6 | 53 ms → 55 ms | 1.01× | 40.6 MiB → 40.6 MiB |
| block | 30/30 | 30 → 30 | 0 | 30 | 51 ms → 52 ms | 1.00× | 52.0 MiB → 52.1 MiB |
| c4 | 5/5 | 5 → 5 | 0 | 5 | 79 ms → 81 ms | 1.01× | 131.1 MiB → 128.1 MiB |
| class | 38/38 | 38 → 38 | 0 | 38 | 166 ms → 171 ms | 1.06× | 130.7 MiB → 131.0 MiB |
| cynefin | 3/3 | 0 → 0 | 0 | 0 | — → — | — | — → — |
| er | 25/25 | 25 → 25 | 0 | 25 | 120 ms → 125 ms | 0.99× | 94.3 MiB → 94.4 MiB |
| eventmodeling | 12/12 | 0 → 0 | 0 | 0 | — → — | — | — → — |
| flowchart | 114/114 | 114 → 114 | 0 | 114 | 338 ms → 353 ms | 0.98× | 286.5 MiB → 286.1 MiB |
| gantt | 11/11 | 10 → 10 | 0 | 10 | 19 ms → 21 ms | 1.01× | 19.3 MiB → 19.2 MiB |
| gitgraph | 35/35 | 35 → 35 | 0 | 35 | 147 ms → 155 ms | 0.99× | 161.9 MiB → 162.3 MiB |
| ishikawa | 1/1 | 1 → 1 | 0 | 1 | 3.32 ms → 3.42 ms | 0.98× | 3.5 MiB → 3.5 MiB |
| journey | 1/1 | 1 → 1 | 0 | 1 | 4.89 ms → 4.99 ms | 1.00× | 4.6 MiB → 4.6 MiB |
| kanban | 3/3 | 3 → 3 | 0 | 3 | 6.09 ms → 6.47 ms | 0.95× | 5.9 MiB → 5.9 MiB |
| mindmap | 15/15 | 15 → 15 | 0 | 15 | 28 ms → 28 ms | 1.00× | 25.5 MiB → 25.5 MiB |
| packet | 4/4 | 4 → 4 | 0 | 4 | 10 ms → 9.25 ms | 1.07× | 8.4 MiB → 8.4 MiB |
| pie | 2/2 | 2 → 2 | 0 | 2 | 3.73 ms → 3.68 ms | 1.04× | 3.4 MiB → 3.4 MiB |
| quadrant | 3/3 | 3 → 3 | 0 | 3 | 6.67 ms → 6.50 ms | 1.04× | 6.5 MiB → 6.6 MiB |
| radar | 3/3 | 3 → 3 | 0 | 3 | 7.85 ms → 8.11 ms | 1.01× | 7.3 MiB → 7.3 MiB |
| railroad | 14/14 | 0 → 0 | 0 | 0 | — → — | — | — → — |
| requirement | 9/9 | 9 → 9 | 0 | 9 | 37 ms → 38 ms | 1.04× | 28.1 MiB → 28.1 MiB |
| sankey | 8/8 | 8 → 8 | 0 | 8 | 32 ms → 35 ms | 0.93× | 36.8 MiB → 36.9 MiB |
| sequence | 38/38 | 38 → 38 | 0 | 38 | 99 ms → 98 ms | 1.04× | 88.9 MiB → 89.0 MiB |
| state | 22/22 | 22 → 22 | 0 | 22 | 149 ms → 162 ms | 1.00× | 123.5 MiB → 123.3 MiB |
| swimlane | 13/13 | 0 → 0 | 0 | 0 | — → — | — | — → — |
| timeline | 14/14 | 14 → 14 | 0 | 14 | 49 ms → 52 ms | 0.96× | 47.6 MiB → 47.7 MiB |
| treemap | 8/8 | 8 → 8 | 0 | 8 | 23 ms → 24 ms | 0.97× | 21.4 MiB → 21.4 MiB |
| treeview | 13/13 | 0 → 0 | 0 | 0 | — → — | — | — → — |
| usecase | 24/24 | 0 → 0 | 0 | 0 | — → — | — | — → — |
| venn | 8/8 | 0 → 0 | 0 | 0 | — → — | — | — → — |
| wardley | 19/19 | 0 → 0 | 0 | 0 | — → — | — | — → — |
| xychart | 8/8 | 8 → 8 | 0 | 8 | 33 ms → 34 ms | 0.97× | 31.8 MiB → 31.8 MiB |
| zenuml | 16/16 | 0 → 0 | 0 | 0 | — → — | — | — → — |
| **all corpus** | 537/537 | 402 → 402 | 1 | 402 | 1460 ms → 1522 ms | 1.00× | 1359.8 MiB → 1357.2 MiB |
| packet:240-fields | 1/1 | 1 → 1 | 0 | 1 | 67 ms → 66 ms | 1.01× | 65.8 MiB → 67.5 MiB |
| kanban:12-columns-240-cards | 1/1 | 1 → 1 | 0 | 1 | 59 ms → 58 ms | 0.99× | 61.0 MiB → 62.2 MiB |
| requirement:100-requirements-99-relations | 1/1 | 1 → 1 | 0 | 1 | 89 ms → 80 ms | 1.15× | 78.8 MiB → 78.8 MiB |
| treemap:20-groups-240-leaves | 1/1 | 1 → 1 | 0 | 1 | 41 ms → 41 ms | 0.98× | 54.9 MiB → 55.0 MiB |
| ishikawa:12-categories-120-causes | 1/1 | 1 → 1 | 0 | 1 | 21 ms → 22 ms | 0.95× | 18.0 MiB → 18.3 MiB |
| block:120-grid-blocks | 1/1 | 1 → 1 | 0 | 1 | 28 ms → 29 ms | 0.97× | 32.4 MiB → 32.5 MiB |
| flowchart:tree-300 | 1/1 | 1 → 1 | 0 | 1 | 114 ms → 117 ms | 1.01× | 212.0 MiB → 225.3 MiB |
| flowchart:mesh-120-labelled-40 | 1/1 | 1 → 1 | 0 | 1 | 390 ms → 399 ms | 0.98× | 511.6 MiB → 512.9 MiB |
| flowchart:subgraphs-12x8 | 1/1 | 1 → 1 | 0 | 1 | 98 ms → 98 ms | 0.98× | 87.9 MiB → 86.9 MiB |
| sequence:20-participants-300-messages | 1/1 | 1 → 1 | 0 | 1 | 59 ms → 57 ms | 1.03× | 62.4 MiB → 61.3 MiB |
| class:80-classes | 1/1 | 1 → 1 | 0 | 1 | 74 ms → 68 ms | 1.08× | 63.1 MiB → 63.0 MiB |
| state:80-states | 1/1 | 1 → 1 | 0 | 1 | 108 ms → 109 ms | 0.99× | 121.5 MiB → 121.3 MiB |
| er:40-entities | 1/1 | 1 → 1 | 0 | 1 | 56 ms → 56 ms | 1.00× | 43.2 MiB → 43.2 MiB |
| gantt:150-tasks | 1/1 | 1 → 1 | 0 | 1 | 23 ms → 23 ms | 1.00× | 41.3 MiB → 42.3 MiB |
| gitgraph:200-commits | 1/1 | 1 → 1 | 0 | 1 | 50 ms → 48 ms | 1.04× | 68.3 MiB → 68.3 MiB |
| mindmap:200-nodes | 1/1 | 1 → 1 | 0 | 1 | 38 ms → 36 ms | 1.05× | 46.2 MiB → 46.2 MiB |
| timeline:100-events | 1/1 | 1 → 1 | 0 | 1 | 46 ms → 49 ms | 1.03× | 53.3 MiB → 53.4 MiB |
| sankey:120-links | 1/1 | 1 → 1 | 0 | 1 | 25 ms → 25 ms | 1.01× | 29.9 MiB → 29.9 MiB |
| journey:120-tasks | 1/1 | 1 → 1 | 0 | 1 | 51 ms → 52 ms | 0.98× | 56.8 MiB → 56.7 MiB |
| architecture:40-services | 1/1 | 1 → 1 | 0 | 1 | 41 ms → 42 ms | 1.05× | 39.5 MiB → 39.5 MiB |
| architecture:16-junctions | 1/1 | 1 → 1 | 1 | 1 | 19 ms → 19 ms | 1.02× | 13.9 MiB → 14.0 MiB |
| architecture:32-junctions | 1/1 | 1 → 1 | 1 | 1 | 33 ms → 32 ms | 1.04× | 25.4 MiB → 25.4 MiB |
| architecture:32-large-junctions | 1/1 | 1 → 1 | 1 | 1 | 33 ms → 35 ms | 0.98× | 26.1 MiB → 25.9 MiB |
| xychart:12-series-80-points | 1/1 | 1 → 1 | 0 | 1 | 26 ms → 24 ms | 1.07× | 18.6 MiB → 18.7 MiB |
| pie:80-slices | 1/1 | 1 → 1 | 0 | 1 | 15 ms → 15 ms | 1.01× | 14.2 MiB → 14.2 MiB |
| quadrant:150-points | 1/1 | 1 → 1 | 0 | 1 | 24 ms → 24 ms | 1.00× | 30.1 MiB → 29.8 MiB |
| radar:12-series-24-axes | 1/1 | 1 → 1 | 0 | 1 | 18 ms → 18 ms | 1.03× | 18.7 MiB → 19.1 MiB |
| c4:40-services | 1/1 | 1 → 1 | 0 | 1 | 43 ms → 43 ms | 1.00× | 67.5 MiB → 67.5 MiB |
| agent:edit-flowchart | 1/1 | 1 → 1 | 0 | 1 | 26 ms → 23 ms | 1.08× | 12.2 MiB → 12.2 MiB |

## Paired corpus rounds

| Round | Baseline | Candidate | Candidate / baseline |
|---|---:|---:|---:|
| 1 | 1792 ms | 1656 ms | 0.92× |
| 2 | 1424 ms | 1522 ms | 1.07× |
| 3 | 1460 ms | 1466 ms | 1.00× |

Matched-corpus call latency (same input population; distribution across examples/repeats, not a confidence interval):

| Engine | Samples | p50 | p95 | Max |
|---|---:|---:|---:|---:|
| baseline | 6030 | 2.69 ms | 10 ms | 57 ms |
| candidate | 6030 | 2.66 ms | 10 ms | 52 ms |

## Largest candidate time contributors

| Input | Candidate median | Baseline median |
|---|---:|---:|
| flowchart:official-syntax/flowchart.md#7 | 23 ms | 22 ms |
| flowchart:official-syntax/flowchart.md#6 | 22 ms | 22 ms |
| flowchart:official-syntax/flowchart.md#98 | 22 ms | 18 ms |
| c4:official-syntax/c4.md#1 | 22 ms | 20 ms |
| c4:official-syntax/c4.md#2 | 21 ms | 20 ms |
| sankey:official-syntax/sankey.md#0 | 19 ms | 17 ms |
| c4:official-syntax/c4.md#4 | 17 ms | 16 ms |
| c4:official-syntax/c4.md#0 | 16 ms | 16 ms |
| state:official-syntax/stateDiagram.md#16 | 15 ms | 14 ms |
| class:official-syntax/classDiagram.md#12 | 14 ms | 13 ms |

## Fresh processes and memory

| Metric | baseline 0.4.2 | candidate 0.4.2 |
|---|---|---|
| Import (median) | 118 ms | 117 ms |
| First SVG render after import (median) | 52 ms | 52 ms |
| corpus: measured inputs | 402 | 402 |
| corpus: allocated / pass | 1258.1 MiB | 1248.9 MiB |
| corpus: peak heap during pass | 154.9 MiB | 153.8 MiB |
| corpus: retained heap / pass | 4.7 MiB | 3.9 MiB |
| corpus: whole worker peak RSS | 354.2 MiB | 351.9 MiB |
| packet:240-fields: measured inputs | 1 | 1 |
| packet:240-fields: allocated / pass | 66.3 MiB | 66.4 MiB |
| packet:240-fields: peak heap during pass | 54.8 MiB | 54.8 MiB |
| packet:240-fields: retained heap / pass | 0.3 MiB | 0.3 MiB |
| packet:240-fields: whole worker peak RSS | 188.6 MiB | 189.2 MiB |
| kanban:12-columns-240-cards: measured inputs | 1 | 1 |
| kanban:12-columns-240-cards: allocated / pass | 61.8 MiB | 61.8 MiB |
| kanban:12-columns-240-cards: peak heap during pass | 41.6 MiB | 41.6 MiB |
| kanban:12-columns-240-cards: retained heap / pass | 0.3 MiB | 0.3 MiB |
| kanban:12-columns-240-cards: whole worker peak RSS | 179.1 MiB | 179.1 MiB |
| requirement:100-requirements-99-relations: measured inputs | 1 | 1 |
| requirement:100-requirements-99-relations: allocated / pass | 79.0 MiB | 79.1 MiB |
| requirement:100-requirements-99-relations: peak heap during pass | 72.0 MiB | 71.8 MiB |
| requirement:100-requirements-99-relations: retained heap / pass | 0.4 MiB | 0.4 MiB |
| requirement:100-requirements-99-relations: whole worker peak RSS | 215.9 MiB | 217.4 MiB |
| treemap:20-groups-240-leaves: measured inputs | 1 | 1 |
| treemap:20-groups-240-leaves: allocated / pass | 52.3 MiB | 52.3 MiB |
| treemap:20-groups-240-leaves: peak heap during pass | 39.2 MiB | 39.2 MiB |
| treemap:20-groups-240-leaves: retained heap / pass | 0.2 MiB | 0.2 MiB |
| treemap:20-groups-240-leaves: whole worker peak RSS | 179.1 MiB | 179.1 MiB |
| ishikawa:12-categories-120-causes: measured inputs | 1 | 1 |
| ishikawa:12-categories-120-causes: allocated / pass | 18.0 MiB | 18.0 MiB |
| ishikawa:12-categories-120-causes: peak heap during pass | 35.4 MiB | 35.3 MiB |
| ishikawa:12-categories-120-causes: retained heap / pass | 0.2 MiB | 0.2 MiB |
| ishikawa:12-categories-120-causes: whole worker peak RSS | 179.1 MiB | 179.1 MiB |
| block:120-grid-blocks: measured inputs | 1 | 1 |
| block:120-grid-blocks: allocated / pass | 32.1 MiB | 32.1 MiB |
| block:120-grid-blocks: peak heap during pass | 36.0 MiB | 36.0 MiB |
| block:120-grid-blocks: retained heap / pass | 0.3 MiB | 0.3 MiB |
| block:120-grid-blocks: whole worker peak RSS | 179.1 MiB | 179.1 MiB |
| flowchart:tree-300: measured inputs | 1 | 1 |
| flowchart:tree-300: allocated / pass | 217.1 MiB | 184.7 MiB |
| flowchart:tree-300: peak heap during pass | 60.5 MiB | 60.3 MiB |
| flowchart:tree-300: retained heap / pass | 0.5 MiB | 0.5 MiB |
| flowchart:tree-300: whole worker peak RSS | 211.1 MiB | 210.2 MiB |
| flowchart:mesh-120-labelled-40: measured inputs | 1 | 1 |
| flowchart:mesh-120-labelled-40: allocated / pass | 497.6 MiB | 496.0 MiB |
| flowchart:mesh-120-labelled-40: peak heap during pass | 118.2 MiB | 118.1 MiB |
| flowchart:mesh-120-labelled-40: retained heap / pass | 0.5 MiB | 0.6 MiB |
| flowchart:mesh-120-labelled-40: whole worker peak RSS | 298.5 MiB | 299.9 MiB |
| flowchart:subgraphs-12x8: measured inputs | 1 | 1 |
| flowchart:subgraphs-12x8: allocated / pass | 86.0 MiB | 88.1 MiB |
| flowchart:subgraphs-12x8: peak heap during pass | 72.2 MiB | 72.2 MiB |
| flowchart:subgraphs-12x8: retained heap / pass | 0.0 MiB | 0.0 MiB |
| flowchart:subgraphs-12x8: whole worker peak RSS | 223.3 MiB | 240.1 MiB |
| sequence:20-participants-300-messages: measured inputs | 1 | 1 |
| sequence:20-participants-300-messages: allocated / pass | 60.3 MiB | 60.1 MiB |
| sequence:20-participants-300-messages: peak heap during pass | 53.6 MiB | 53.6 MiB |
| sequence:20-participants-300-messages: retained heap / pass | 0.5 MiB | 0.5 MiB |
| sequence:20-participants-300-messages: whole worker peak RSS | 197.1 MiB | 196.7 MiB |
| class:80-classes: measured inputs | 1 | 1 |
| class:80-classes: allocated / pass | 62.8 MiB | 62.8 MiB |
| class:80-classes: peak heap during pass | 66.8 MiB | 66.6 MiB |
| class:80-classes: retained heap / pass | 0.3 MiB | 0.3 MiB |
| class:80-classes: whole worker peak RSS | 206.9 MiB | 208.6 MiB |
| state:80-states: measured inputs | 1 | 1 |
| state:80-states: allocated / pass | 112.4 MiB | 112.1 MiB |
| state:80-states: peak heap during pass | 76.4 MiB | 76.6 MiB |
| state:80-states: retained heap / pass | 0.5 MiB | 0.6 MiB |
| state:80-states: whole worker peak RSS | 218.6 MiB | 228.6 MiB |
| er:40-entities: measured inputs | 1 | 1 |
| er:40-entities: allocated / pass | 43.1 MiB | 43.1 MiB |
| er:40-entities: peak heap during pass | 50.4 MiB | 50.3 MiB |
| er:40-entities: retained heap / pass | 0.4 MiB | 0.3 MiB |
| er:40-entities: whole worker peak RSS | 179.1 MiB | 179.1 MiB |
| gantt:150-tasks: measured inputs | 1 | 1 |
| gantt:150-tasks: allocated / pass | 30.2 MiB | 30.1 MiB |
| gantt:150-tasks: peak heap during pass | 35.5 MiB | 28.0 MiB |
| gantt:150-tasks: retained heap / pass | 0.2 MiB | 0.2 MiB |
| gantt:150-tasks: whole worker peak RSS | 179.1 MiB | 179.1 MiB |
| gitgraph:200-commits: measured inputs | 1 | 1 |
| gitgraph:200-commits: allocated / pass | 68.4 MiB | 68.5 MiB |
| gitgraph:200-commits: peak heap during pass | 45.3 MiB | 45.4 MiB |
| gitgraph:200-commits: retained heap / pass | 0.4 MiB | 0.4 MiB |
| gitgraph:200-commits: whole worker peak RSS | 179.1 MiB | 179.1 MiB |
| mindmap:200-nodes: measured inputs | 1 | 1 |
| mindmap:200-nodes: allocated / pass | 45.6 MiB | 45.5 MiB |
| mindmap:200-nodes: peak heap during pass | 38.1 MiB | 37.9 MiB |
| mindmap:200-nodes: retained heap / pass | 0.3 MiB | 0.3 MiB |
| mindmap:200-nodes: whole worker peak RSS | 179.1 MiB | 179.1 MiB |
| timeline:100-events: measured inputs | 1 | 1 |
| timeline:100-events: allocated / pass | 52.7 MiB | 52.7 MiB |
| timeline:100-events: peak heap during pass | 47.6 MiB | 47.6 MiB |
| timeline:100-events: retained heap / pass | 0.3 MiB | 0.3 MiB |
| timeline:100-events: whole worker peak RSS | 179.1 MiB | 179.1 MiB |
| sankey:120-links: measured inputs | 1 | 1 |
| sankey:120-links: allocated / pass | 29.6 MiB | 29.7 MiB |
| sankey:120-links: peak heap during pass | 35.5 MiB | 35.5 MiB |
| sankey:120-links: retained heap / pass | 0.2 MiB | 0.2 MiB |
| sankey:120-links: whole worker peak RSS | 179.1 MiB | 179.1 MiB |
| journey:120-tasks: measured inputs | 1 | 1 |
| journey:120-tasks: allocated / pass | 56.0 MiB | 56.1 MiB |
| journey:120-tasks: peak heap during pass | 48.5 MiB | 48.5 MiB |
| journey:120-tasks: retained heap / pass | 0.2 MiB | 0.2 MiB |
| journey:120-tasks: whole worker peak RSS | 179.1 MiB | 179.1 MiB |
| architecture:40-services: measured inputs | 1 | 1 |
| architecture:40-services: allocated / pass | 38.5 MiB | 38.4 MiB |
| architecture:40-services: peak heap during pass | 50.9 MiB | 50.7 MiB |
| architecture:40-services: retained heap / pass | 0.5 MiB | 0.4 MiB |
| architecture:40-services: whole worker peak RSS | 179.1 MiB | 179.1 MiB |
| architecture:16-junctions: measured inputs | 1 | 1 |
| architecture:16-junctions: allocated / pass | 13.7 MiB | 13.7 MiB |
| architecture:16-junctions: peak heap during pass | 45.8 MiB | 45.8 MiB |
| architecture:16-junctions: retained heap / pass | 0.4 MiB | 0.4 MiB |
| architecture:16-junctions: whole worker peak RSS | 179.1 MiB | 179.1 MiB |
| architecture:32-junctions: measured inputs | 1 | 1 |
| architecture:32-junctions: allocated / pass | 24.7 MiB | 26.5 MiB |
| architecture:32-junctions: peak heap during pass | 49.7 MiB | 49.6 MiB |
| architecture:32-junctions: retained heap / pass | 0.4 MiB | 0.4 MiB |
| architecture:32-junctions: whole worker peak RSS | 179.1 MiB | 179.1 MiB |
| architecture:32-large-junctions: measured inputs | 1 | 1 |
| architecture:32-large-junctions: allocated / pass | 26.8 MiB | 25.0 MiB |
| architecture:32-large-junctions: peak heap during pass | 50.1 MiB | 50.0 MiB |
| architecture:32-large-junctions: retained heap / pass | 0.4 MiB | 0.5 MiB |
| architecture:32-large-junctions: whole worker peak RSS | 179.1 MiB | 179.1 MiB |
| xychart:12-series-80-points: measured inputs | 1 | 1 |
| xychart:12-series-80-points: allocated / pass | 18.5 MiB | 18.4 MiB |
| xychart:12-series-80-points: peak heap during pass | 31.0 MiB | 27.9 MiB |
| xychart:12-series-80-points: retained heap / pass | 0.2 MiB | 0.2 MiB |
| xychart:12-series-80-points: whole worker peak RSS | 179.1 MiB | 179.1 MiB |
| pie:80-slices: measured inputs | 1 | 1 |
| pie:80-slices: allocated / pass | 14.2 MiB | 14.2 MiB |
| pie:80-slices: peak heap during pass | 27.4 MiB | 27.4 MiB |
| pie:80-slices: retained heap / pass | 0.2 MiB | 0.2 MiB |
| pie:80-slices: whole worker peak RSS | 179.1 MiB | 179.1 MiB |
| quadrant:150-points: measured inputs | 1 | 1 |
| quadrant:150-points: allocated / pass | 29.5 MiB | 29.2 MiB |
| quadrant:150-points: peak heap during pass | 35.7 MiB | 35.7 MiB |
| quadrant:150-points: retained heap / pass | 0.2 MiB | 0.2 MiB |
| quadrant:150-points: whole worker peak RSS | 179.1 MiB | 179.1 MiB |
| radar:12-series-24-axes: measured inputs | 1 | 1 |
| radar:12-series-24-axes: allocated / pass | 18.9 MiB | 18.7 MiB |
| radar:12-series-24-axes: peak heap during pass | 27.5 MiB | 27.4 MiB |
| radar:12-series-24-axes: retained heap / pass | 0.3 MiB | 0.3 MiB |
| radar:12-series-24-axes: whole worker peak RSS | 179.1 MiB | 179.1 MiB |
| c4:40-services: measured inputs | 1 | 1 |
| c4:40-services: allocated / pass | 58.1 MiB | 58.1 MiB |
| c4:40-services: peak heap during pass | 37.6 MiB | 37.6 MiB |
| c4:40-services: retained heap / pass | 0.2 MiB | 0.2 MiB |
| c4:40-services: whole worker peak RSS | 179.1 MiB | 179.1 MiB |
| agent:edit-flowchart: measured inputs | 1 | 1 |
| agent:edit-flowchart: allocated / pass | 11.8 MiB | 11.8 MiB |
| agent:edit-flowchart: peak heap during pass | 45.6 MiB | 45.5 MiB |
| agent:edit-flowchart: retained heap / pass | 0.8 MiB | 0.8 MiB |
| agent:edit-flowchart: whole worker peak RSS | 179.1 MiB | 179.1 MiB |

Times aggregate each observed rep over the matched inputs, take its within-process median, and report the median across interleaved rounds. Ratios pair the same round before taking their median. All SVG/ASCII correctness passes precede warm timings. Cold measurements include import and first render separately, without process launch or a cold filesystem. Memory comparisons use separate fresh processes restricted to the matched inputs; an additional candidate corpus pass includes newly supported inputs for the absolute retained-heap gate. Allocation and peak heap are V8 estimates sampled at GC boundaries. Retained heap covers one settled pass. Whole-worker RSS includes import, warm-up and measurement. ASCII is checked for correctness, not timed. The agent workload measures parse, mutate, verify, serialize, re-parse, fact checks and SVG render together. Full samples, output fingerprints, package identities and machine metadata accompany this report.
