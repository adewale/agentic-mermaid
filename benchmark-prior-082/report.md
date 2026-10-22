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
| Corpus allocation ≤ 1.25× baseline | pass | 1.00× |
| Corpus peak RSS ≤ 1.25× baseline | pass | 0.98× |
| Retained heap growth per corpus pass ≤ 16.0 MiB | pass | 4.4 MiB across 402 successful candidate inputs |

## Matched successful SVG renders

All time, allocation and RSS comparisons use the same stable, parseable SVG inputs in both engines. Rejections are excluded. Counts of rendered SVGs include every measured input; newly supported inputs are reported without a speed comparison.

| Family / case | Measured | SVG renders (base → cand) | Changed SVGs | Compared | Time (base → cand) | Speed-up | Allocated (base → cand) |
|---|---|---|---|---|---|---|---|
| agentflow | 12/12 | 0 → 0 | 0 | 0 | — → — | — | — → — |
| architecture | 6/6 | 6 → 6 | 1 | 6 | 90 ms → 90 ms | 1.02× | 40.7 MiB → 40.8 MiB |
| block | 30/30 | 30 → 30 | 0 | 30 | 105 ms → 103 ms | 1.02× | 52.3 MiB → 52.2 MiB |
| c4 | 5/5 | 5 → 5 | 0 | 5 | 149 ms → 144 ms | 1.01× | 130.9 MiB → 131.1 MiB |
| class | 38/38 | 38 → 38 | 0 | 38 | 322 ms → 322 ms | 0.99× | 130.7 MiB → 130.7 MiB |
| cynefin | 3/3 | 0 → 0 | 0 | 0 | — → — | — | — → — |
| er | 25/25 | 25 → 25 | 0 | 25 | 231 ms → 231 ms | 0.99× | 94.3 MiB → 94.3 MiB |
| eventmodeling | 12/12 | 0 → 0 | 0 | 0 | — → — | — | — → — |
| flowchart | 114/114 | 114 → 114 | 0 | 114 | 651 ms → 657 ms | 0.99× | 286.6 MiB → 286.5 MiB |
| gantt | 11/11 | 10 → 10 | 0 | 10 | 39 ms → 38 ms | 1.02× | 19.2 MiB → 19.3 MiB |
| gitgraph | 35/35 | 35 → 35 | 0 | 35 | 294 ms → 296 ms | 0.98× | 161.9 MiB → 161.8 MiB |
| ishikawa | 1/1 | 1 → 1 | 0 | 1 | 6.44 ms → 6.76 ms | 0.95× | 3.5 MiB → 3.5 MiB |
| journey | 1/1 | 1 → 1 | 0 | 1 | 9.49 ms → 9.27 ms | 1.00× | 4.6 MiB → 4.6 MiB |
| kanban | 3/3 | 3 → 3 | 0 | 3 | 12 ms → 16 ms | 0.74× | 5.9 MiB → 5.9 MiB |
| mindmap | 15/15 | 15 → 15 | 0 | 15 | 52 ms → 52 ms | 1.03× | 25.5 MiB → 25.5 MiB |
| packet | 4/4 | 4 → 4 | 0 | 4 | 18 ms → 18 ms | 0.97× | 8.4 MiB → 8.4 MiB |
| pie | 2/2 | 2 → 2 | 0 | 2 | 7.21 ms → 7.07 ms | 1.02× | 3.4 MiB → 3.4 MiB |
| quadrant | 3/3 | 3 → 3 | 0 | 3 | 13 ms → 13 ms | 1.01× | 6.6 MiB → 6.6 MiB |
| radar | 3/3 | 3 → 3 | 0 | 3 | 16 ms → 15 ms | 0.97× | 7.3 MiB → 7.3 MiB |
| railroad | 14/14 | 0 → 0 | 0 | 0 | — → — | — | — → — |
| requirement | 9/9 | 9 → 9 | 0 | 9 | 72 ms → 69 ms | 1.04× | 28.1 MiB → 28.1 MiB |
| sankey | 8/8 | 8 → 8 | 0 | 8 | 64 ms → 59 ms | 1.08× | 36.8 MiB → 36.8 MiB |
| sequence | 38/38 | 38 → 38 | 0 | 38 | 193 ms → 195 ms | 1.01× | 89.0 MiB → 89.1 MiB |
| state | 22/22 | 22 → 22 | 0 | 22 | 284 ms → 273 ms | 1.03× | 123.5 MiB → 123.4 MiB |
| swimlane | 13/13 | 0 → 0 | 0 | 0 | — → — | — | — → — |
| timeline | 14/14 | 14 → 14 | 0 | 14 | 104 ms → 103 ms | 1.01× | 47.6 MiB → 47.6 MiB |
| treemap | 8/8 | 8 → 8 | 0 | 8 | 43 ms → 43 ms | 0.99× | 21.3 MiB → 21.4 MiB |
| treeview | 13/13 | 0 → 0 | 0 | 0 | — → — | — | — → — |
| usecase | 24/24 | 0 → 0 | 0 | 0 | — → — | — | — → — |
| venn | 8/8 | 0 → 0 | 0 | 0 | — → — | — | — → — |
| wardley | 19/19 | 0 → 0 | 0 | 0 | — → — | — | — → — |
| xychart | 8/8 | 8 → 8 | 0 | 8 | 62 ms → 64 ms | 0.95× | 31.8 MiB → 31.8 MiB |
| zenuml | 16/16 | 0 → 0 | 0 | 0 | — → — | — | — → — |
| **all corpus** | 537/537 | 402 → 402 | 1 | 402 | 2833 ms → 2817 ms | 1.00× | 1359.8 MiB → 1360.3 MiB |
| packet:240-fields | 1/1 | 1 → 1 | 0 | 1 | 114 ms → 116 ms | 1.01× | 67.5 MiB → 67.5 MiB |
| kanban:12-columns-240-cards | 1/1 | 1 → 1 | 0 | 1 | 102 ms → 105 ms | 0.98× | 61.1 MiB → 62.3 MiB |
| requirement:100-requirements-99-relations | 1/1 | 1 → 1 | 0 | 1 | 147 ms → 146 ms | 1.02× | 78.8 MiB → 78.8 MiB |
| treemap:20-groups-240-leaves | 1/1 | 1 → 1 | 0 | 1 | 71 ms → 71 ms | 1.01× | 55.0 MiB → 54.9 MiB |
| ishikawa:12-categories-120-causes | 1/1 | 1 → 1 | 0 | 1 | 31 ms → 34 ms | 0.89× | 18.3 MiB → 18.0 MiB |
| block:120-grid-blocks | 1/1 | 1 → 1 | 0 | 1 | 49 ms → 47 ms | 1.04× | 32.5 MiB → 32.5 MiB |
| flowchart:tree-300 | 1/1 | 1 → 1 | 0 | 1 | 214 ms → 213 ms | 1.01× | 215.6 MiB → 224.1 MiB |
| flowchart:mesh-120-labelled-40 | 1/1 | 1 → 1 | 0 | 1 | 703 ms → 695 ms | 1.01× | 510.5 MiB → 514.9 MiB |
| flowchart:subgraphs-12x8 | 1/1 | 1 → 1 | 0 | 1 | 158 ms → 155 ms | 1.00× | 86.2 MiB → 87.3 MiB |
| sequence:20-participants-300-messages | 1/1 | 1 → 1 | 0 | 1 | 104 ms → 107 ms | 0.98× | 61.1 MiB → 61.0 MiB |
| class:80-classes | 1/1 | 1 → 1 | 0 | 1 | 128 ms → 140 ms | 0.96× | 63.0 MiB → 63.1 MiB |
| state:80-states | 1/1 | 1 → 1 | 0 | 1 | 188 ms → 201 ms | 0.96× | 120.0 MiB → 120.8 MiB |
| er:40-entities | 1/1 | 1 → 1 | 0 | 1 | 96 ms → 98 ms | 0.96× | 43.2 MiB → 43.3 MiB |
| gantt:150-tasks | 1/1 | 1 → 1 | 0 | 1 | 39 ms → 39 ms | 1.00× | 41.2 MiB → 41.0 MiB |
| gitgraph:200-commits | 1/1 | 1 → 1 | 0 | 1 | 90 ms → 89 ms | 1.03× | 68.3 MiB → 68.3 MiB |
| mindmap:200-nodes | 1/1 | 1 → 1 | 0 | 1 | 67 ms → 67 ms | 1.00× | 46.2 MiB → 46.2 MiB |
| timeline:100-events | 1/1 | 1 → 1 | 0 | 1 | 89 ms → 92 ms | 0.97× | 53.2 MiB → 53.2 MiB |
| sankey:120-links | 1/1 | 1 → 1 | 0 | 1 | 46 ms → 46 ms | 1.00× | 29.8 MiB → 29.9 MiB |
| journey:120-tasks | 1/1 | 1 → 1 | 0 | 1 | 94 ms → 93 ms | 1.02× | 57.9 MiB → 56.8 MiB |
| architecture:40-services | 1/1 | 1 → 1 | 0 | 1 | 75 ms → 73 ms | 1.01× | 39.7 MiB → 39.9 MiB |
| architecture:16-junctions | 1/1 | 1 → 1 | 1 | 1 | 31 ms → 32 ms | 1.02× | 13.9 MiB → 14.0 MiB |
| architecture:32-junctions | 1/1 | 1 → 1 | 1 | 1 | 55 ms → 53 ms | 1.02× | 25.2 MiB → 25.6 MiB |
| architecture:32-large-junctions | 1/1 | 1 → 1 | 1 | 1 | 54 ms → 55 ms | 0.99× | 25.7 MiB → 25.4 MiB |
| xychart:12-series-80-points | 1/1 | 1 → 1 | 0 | 1 | 46 ms → 42 ms | 1.09× | 18.7 MiB → 18.7 MiB |
| pie:80-slices | 1/1 | 1 → 1 | 0 | 1 | 26 ms → 25 ms | 1.02× | 14.2 MiB → 14.0 MiB |
| quadrant:150-points | 1/1 | 1 → 1 | 0 | 1 | 42 ms → 43 ms | 0.98× | 29.7 MiB → 29.7 MiB |
| radar:12-series-24-axes | 1/1 | 1 → 1 | 0 | 1 | 33 ms → 30 ms | 1.01× | 19.0 MiB → 18.7 MiB |
| c4:40-services | 1/1 | 1 → 1 | 0 | 1 | 78 ms → 79 ms | 0.98× | 67.6 MiB → 67.1 MiB |
| agent:edit-flowchart | 1/1 | 1 → 1 | 0 | 1 | 38 ms → 38 ms | 1.00× | 12.2 MiB → 12.2 MiB |

## Paired corpus rounds

| Round | Baseline | Candidate | Candidate / baseline |
|---|---:|---:|---:|
| 1 | 2641 ms | 2680 ms | 1.01× |
| 2 | 2895 ms | 2889 ms | 1.00× |
| 3 | 2833 ms | 2817 ms | 0.99× |

Matched-corpus call latency (same input population; distribution across examples/repeats, not a confidence interval):

| Engine | Samples | p50 | p95 | Max |
|---|---:|---:|---:|---:|
| baseline | 6030 | 5.08 ms | 17 ms | 48 ms |
| candidate | 6030 | 5.03 ms | 17 ms | 45 ms |

## Largest candidate time contributors

| Input | Candidate median | Baseline median |
|---|---:|---:|
| c4:official-syntax/c4.md#1 | 38 ms | 37 ms |
| c4:official-syntax/c4.md#2 | 37 ms | 37 ms |
| flowchart:official-syntax/flowchart.md#7 | 37 ms | 40 ms |
| flowchart:official-syntax/flowchart.md#6 | 37 ms | 38 ms |
| flowchart:official-syntax/flowchart.md#98 | 36 ms | 34 ms |
| c4:official-syntax/c4.md#4 | 31 ms | 30 ms |
| sankey:official-syntax/sankey.md#0 | 30 ms | 32 ms |
| c4:official-syntax/c4.md#0 | 28 ms | 30 ms |
| state:official-syntax/stateDiagram.md#16 | 26 ms | 27 ms |
| class:official-syntax/classDiagram.md#12 | 25 ms | 22 ms |

## Fresh processes and memory

| Metric | baseline 0.4.2 | candidate 0.4.2 |
|---|---|---|
| Import (median) | 193 ms | 192 ms |
| First SVG render after import (median) | 89 ms | 89 ms |
| corpus: measured inputs | 402 | 402 |
| corpus: allocated / pass | 1256.8 MiB | 1257.1 MiB |
| corpus: peak heap during pass | 155.0 MiB | 153.9 MiB |
| corpus: retained heap / pass | 4.4 MiB | 4.4 MiB |
| corpus: whole worker peak RSS | 357.6 MiB | 349.2 MiB |
| packet:240-fields: measured inputs | 1 | 1 |
| packet:240-fields: allocated / pass | 66.9 MiB | 66.3 MiB |
| packet:240-fields: peak heap during pass | 54.8 MiB | 54.8 MiB |
| packet:240-fields: retained heap / pass | 0.2 MiB | 0.4 MiB |
| packet:240-fields: whole worker peak RSS | 191.8 MiB | 191.3 MiB |
| kanban:12-columns-240-cards: measured inputs | 1 | 1 |
| kanban:12-columns-240-cards: allocated / pass | 61.8 MiB | 61.8 MiB |
| kanban:12-columns-240-cards: peak heap during pass | 53.6 MiB | 53.5 MiB |
| kanban:12-columns-240-cards: retained heap / pass | 0.3 MiB | 0.3 MiB |
| kanban:12-columns-240-cards: whole worker peak RSS | 188.7 MiB | 188.7 MiB |
| requirement:100-requirements-99-relations: measured inputs | 1 | 1 |
| requirement:100-requirements-99-relations: allocated / pass | 79.1 MiB | 79.1 MiB |
| requirement:100-requirements-99-relations: peak heap during pass | 71.8 MiB | 71.6 MiB |
| requirement:100-requirements-99-relations: retained heap / pass | 0.4 MiB | 0.4 MiB |
| requirement:100-requirements-99-relations: whole worker peak RSS | 220.8 MiB | 218.7 MiB |
| treemap:20-groups-240-leaves: measured inputs | 1 | 1 |
| treemap:20-groups-240-leaves: allocated / pass | 52.3 MiB | 52.3 MiB |
| treemap:20-groups-240-leaves: peak heap during pass | 39.1 MiB | 38.9 MiB |
| treemap:20-groups-240-leaves: retained heap / pass | 0.2 MiB | 0.2 MiB |
| treemap:20-groups-240-leaves: whole worker peak RSS | 188.7 MiB | 188.7 MiB |
| ishikawa:12-categories-120-causes: measured inputs | 1 | 1 |
| ishikawa:12-categories-120-causes: allocated / pass | 18.0 MiB | 17.9 MiB |
| ishikawa:12-categories-120-causes: peak heap during pass | 35.3 MiB | 35.3 MiB |
| ishikawa:12-categories-120-causes: retained heap / pass | 0.2 MiB | 0.2 MiB |
| ishikawa:12-categories-120-causes: whole worker peak RSS | 188.7 MiB | 188.7 MiB |
| block:120-grid-blocks: measured inputs | 1 | 1 |
| block:120-grid-blocks: allocated / pass | 31.7 MiB | 31.7 MiB |
| block:120-grid-blocks: peak heap during pass | 35.9 MiB | 35.9 MiB |
| block:120-grid-blocks: retained heap / pass | 0.3 MiB | 0.3 MiB |
| block:120-grid-blocks: whole worker peak RSS | 188.7 MiB | 188.7 MiB |
| flowchart:tree-300: measured inputs | 1 | 1 |
| flowchart:tree-300: allocated / pass | 181.4 MiB | 180.7 MiB |
| flowchart:tree-300: peak heap during pass | 61.4 MiB | 61.3 MiB |
| flowchart:tree-300: retained heap / pass | 0.5 MiB | 0.5 MiB |
| flowchart:tree-300: whole worker peak RSS | 211.4 MiB | 214.8 MiB |
| flowchart:mesh-120-labelled-40: measured inputs | 1 | 1 |
| flowchart:mesh-120-labelled-40: allocated / pass | 496.1 MiB | 495.6 MiB |
| flowchart:mesh-120-labelled-40: peak heap during pass | 118.1 MiB | 118.1 MiB |
| flowchart:mesh-120-labelled-40: retained heap / pass | 0.5 MiB | 0.6 MiB |
| flowchart:mesh-120-labelled-40: whole worker peak RSS | 300.9 MiB | 299.7 MiB |
| flowchart:subgraphs-12x8: measured inputs | 1 | 1 |
| flowchart:subgraphs-12x8: allocated / pass | 88.2 MiB | 85.4 MiB |
| flowchart:subgraphs-12x8: peak heap during pass | 72.4 MiB | 72.0 MiB |
| flowchart:subgraphs-12x8: retained heap / pass | 0.0 MiB | 0.0 MiB |
| flowchart:subgraphs-12x8: whole worker peak RSS | 240.8 MiB | 226.9 MiB |
| sequence:20-participants-300-messages: measured inputs | 1 | 1 |
| sequence:20-participants-300-messages: allocated / pass | 60.3 MiB | 60.3 MiB |
| sequence:20-participants-300-messages: peak heap during pass | 53.6 MiB | 53.5 MiB |
| sequence:20-participants-300-messages: retained heap / pass | 0.5 MiB | 0.5 MiB |
| sequence:20-participants-300-messages: whole worker peak RSS | 200.2 MiB | 197.3 MiB |
| class:80-classes: measured inputs | 1 | 1 |
| class:80-classes: allocated / pass | 62.8 MiB | 62.8 MiB |
| class:80-classes: peak heap during pass | 66.7 MiB | 66.5 MiB |
| class:80-classes: retained heap / pass | 0.3 MiB | 0.3 MiB |
| class:80-classes: whole worker peak RSS | 213.4 MiB | 212.1 MiB |
| state:80-states: measured inputs | 1 | 1 |
| state:80-states: allocated / pass | 111.6 MiB | 112.2 MiB |
| state:80-states: peak heap during pass | 76.4 MiB | 76.2 MiB |
| state:80-states: retained heap / pass | 0.5 MiB | 0.6 MiB |
| state:80-states: whole worker peak RSS | 222.6 MiB | 223.7 MiB |
| er:40-entities: measured inputs | 1 | 1 |
| er:40-entities: allocated / pass | 43.0 MiB | 43.0 MiB |
| er:40-entities: peak heap during pass | 50.3 MiB | 50.1 MiB |
| er:40-entities: retained heap / pass | 0.3 MiB | 0.3 MiB |
| er:40-entities: whole worker peak RSS | 188.7 MiB | 188.7 MiB |
| gantt:150-tasks: measured inputs | 1 | 1 |
| gantt:150-tasks: allocated / pass | 30.2 MiB | 30.2 MiB |
| gantt:150-tasks: peak heap during pass | 35.4 MiB | 35.4 MiB |
| gantt:150-tasks: retained heap / pass | 0.2 MiB | 0.2 MiB |
| gantt:150-tasks: whole worker peak RSS | 188.7 MiB | 188.7 MiB |
| gitgraph:200-commits: measured inputs | 1 | 1 |
| gitgraph:200-commits: allocated / pass | 68.4 MiB | 68.4 MiB |
| gitgraph:200-commits: peak heap during pass | 45.1 MiB | 45.2 MiB |
| gitgraph:200-commits: retained heap / pass | 0.4 MiB | 0.4 MiB |
| gitgraph:200-commits: whole worker peak RSS | 188.7 MiB | 188.7 MiB |
| mindmap:200-nodes: measured inputs | 1 | 1 |
| mindmap:200-nodes: allocated / pass | 45.5 MiB | 45.5 MiB |
| mindmap:200-nodes: peak heap during pass | 37.9 MiB | 37.9 MiB |
| mindmap:200-nodes: retained heap / pass | 0.3 MiB | 0.3 MiB |
| mindmap:200-nodes: whole worker peak RSS | 188.7 MiB | 188.7 MiB |
| timeline:100-events: measured inputs | 1 | 1 |
| timeline:100-events: allocated / pass | 52.8 MiB | 52.7 MiB |
| timeline:100-events: peak heap during pass | 47.5 MiB | 47.4 MiB |
| timeline:100-events: retained heap / pass | 0.4 MiB | 0.3 MiB |
| timeline:100-events: whole worker peak RSS | 188.7 MiB | 188.7 MiB |
| sankey:120-links: measured inputs | 1 | 1 |
| sankey:120-links: allocated / pass | 29.7 MiB | 29.7 MiB |
| sankey:120-links: peak heap during pass | 35.4 MiB | 35.4 MiB |
| sankey:120-links: retained heap / pass | 0.3 MiB | 0.2 MiB |
| sankey:120-links: whole worker peak RSS | 188.7 MiB | 188.7 MiB |
| journey:120-tasks: measured inputs | 1 | 1 |
| journey:120-tasks: allocated / pass | 56.2 MiB | 55.9 MiB |
| journey:120-tasks: peak heap during pass | 48.7 MiB | 48.3 MiB |
| journey:120-tasks: retained heap / pass | 0.1 MiB | 0.2 MiB |
| journey:120-tasks: whole worker peak RSS | 188.7 MiB | 188.7 MiB |
| architecture:40-services: measured inputs | 1 | 1 |
| architecture:40-services: allocated / pass | 38.5 MiB | 39.0 MiB |
| architecture:40-services: peak heap during pass | 50.8 MiB | 50.7 MiB |
| architecture:40-services: retained heap / pass | 0.5 MiB | 0.5 MiB |
| architecture:40-services: whole worker peak RSS | 188.7 MiB | 188.7 MiB |
| architecture:16-junctions: measured inputs | 1 | 1 |
| architecture:16-junctions: allocated / pass | 13.7 MiB | 13.6 MiB |
| architecture:16-junctions: peak heap during pass | 45.7 MiB | 45.7 MiB |
| architecture:16-junctions: retained heap / pass | 0.4 MiB | 0.3 MiB |
| architecture:16-junctions: whole worker peak RSS | 188.7 MiB | 188.7 MiB |
| architecture:32-junctions: measured inputs | 1 | 1 |
| architecture:32-junctions: allocated / pass | 26.4 MiB | 26.4 MiB |
| architecture:32-junctions: peak heap during pass | 49.6 MiB | 49.5 MiB |
| architecture:32-junctions: retained heap / pass | 0.4 MiB | 0.3 MiB |
| architecture:32-junctions: whole worker peak RSS | 188.7 MiB | 188.7 MiB |
| architecture:32-large-junctions: measured inputs | 1 | 1 |
| architecture:32-large-junctions: allocated / pass | 26.8 MiB | 25.0 MiB |
| architecture:32-large-junctions: peak heap during pass | 50.0 MiB | 49.9 MiB |
| architecture:32-large-junctions: retained heap / pass | 0.4 MiB | 0.6 MiB |
| architecture:32-large-junctions: whole worker peak RSS | 188.7 MiB | 188.7 MiB |
| xychart:12-series-80-points: measured inputs | 1 | 1 |
| xychart:12-series-80-points: allocated / pass | 18.4 MiB | 18.5 MiB |
| xychart:12-series-80-points: peak heap during pass | 27.9 MiB | 30.9 MiB |
| xychart:12-series-80-points: retained heap / pass | 0.2 MiB | 0.2 MiB |
| xychart:12-series-80-points: whole worker peak RSS | 188.7 MiB | 188.7 MiB |
| pie:80-slices: measured inputs | 1 | 1 |
| pie:80-slices: allocated / pass | 14.2 MiB | 14.2 MiB |
| pie:80-slices: peak heap during pass | 27.3 MiB | 27.3 MiB |
| pie:80-slices: retained heap / pass | 0.2 MiB | 0.2 MiB |
| pie:80-slices: whole worker peak RSS | 188.7 MiB | 188.7 MiB |
| quadrant:150-points: measured inputs | 1 | 1 |
| quadrant:150-points: allocated / pass | 29.2 MiB | 29.2 MiB |
| quadrant:150-points: peak heap during pass | 35.6 MiB | 35.6 MiB |
| quadrant:150-points: retained heap / pass | 0.2 MiB | 0.2 MiB |
| quadrant:150-points: whole worker peak RSS | 188.7 MiB | 188.7 MiB |
| radar:12-series-24-axes: measured inputs | 1 | 1 |
| radar:12-series-24-axes: allocated / pass | 18.9 MiB | 18.7 MiB |
| radar:12-series-24-axes: peak heap during pass | 27.5 MiB | 27.3 MiB |
| radar:12-series-24-axes: retained heap / pass | 0.2 MiB | 0.3 MiB |
| radar:12-series-24-axes: whole worker peak RSS | 188.7 MiB | 188.7 MiB |
| c4:40-services: measured inputs | 1 | 1 |
| c4:40-services: allocated / pass | 57.9 MiB | 57.9 MiB |
| c4:40-services: peak heap during pass | 37.5 MiB | 37.5 MiB |
| c4:40-services: retained heap / pass | 0.2 MiB | 0.2 MiB |
| c4:40-services: whole worker peak RSS | 188.7 MiB | 188.7 MiB |
| agent:edit-flowchart: measured inputs | 1 | 1 |
| agent:edit-flowchart: allocated / pass | 11.8 MiB | 11.8 MiB |
| agent:edit-flowchart: peak heap during pass | 45.5 MiB | 45.4 MiB |
| agent:edit-flowchart: retained heap / pass | 0.8 MiB | 0.8 MiB |
| agent:edit-flowchart: whole worker peak RSS | 188.7 MiB | 188.7 MiB |

Times aggregate each observed rep over the matched inputs, take its within-process median, and report the median across interleaved rounds. Ratios pair the same round before taking their median. All SVG/ASCII correctness passes precede warm timings. Cold measurements include import and first render separately, without process launch or a cold filesystem. Memory comparisons use separate fresh processes restricted to the matched inputs; an additional candidate corpus pass includes newly supported inputs for the absolute retained-heap gate. Allocation and peak heap are V8 estimates sampled at GC boundaries. Retained heap covers one settled pass. Whole-worker RSS includes import, warm-up and measurement. ASCII is checked for correctness, not timed. The agent workload measures parse, mutate, verify, serialize, re-parse, fact checks and SVG render together. Full samples, output fingerprints, package identities and machine metadata accompany this report.
