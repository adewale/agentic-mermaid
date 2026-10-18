// Generated large diagrams for the release benchmark. The official-fence corpus
// covers syntax breadth with small inputs; these exercise how each layout
// family scales. Sizes are chosen so the slowest released version still
// finishes each case in seconds. Every generator is deterministic.

import type { DiagramKind } from '../../src/agent/types.ts'

export interface BenchCase {
  id: string
  family: DiagramKind
  source: string
}

function lcg(seed: number): () => number {
  let state = seed >>> 0
  return () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296
}

function lines(header: string, count: number, line: (i: number) => string | string[]): string {
  const out = [header]
  for (let i = 0; i < count; i++) out.push(...[line(i)].flat())
  return out.join('\n')
}

function flowchartTree(nodes: number): string {
  return lines('flowchart TD', nodes - 1, i => `  n${Math.floor(i / 3)}[Node ${Math.floor(i / 3)}] --> n${i + 1}[Node ${i + 1}]`)
}

function flowchartMesh(nodes: number, labelled: number): string {
  const rnd = lcg(7)
  const edges = lines('flowchart TD', nodes - 1, i => `  n${Math.floor(rnd() * (i + 1))} --> n${i + 1}`)
  return edges + '\n' + Array.from({ length: labelled }, (_, i) => `  n${Math.floor(rnd() * nodes)} -->|label ${i}| n${Math.floor(rnd() * nodes)}`).join('\n')
}

function flowchartSubgraphs(groups: number, perGroup: number): string {
  const out = ['flowchart LR']
  for (let g = 0; g < groups; g++) {
    out.push(`  subgraph g${g}[Group ${g}]`)
    for (let i = 0; i < perGroup; i++) out.push(`    g${g}n${i}[Step ${i}]${i > 0 ? ` --> g${g}n${i - 1}` : ''}`)
    out.push('  end')
    if (g > 0) out.push(`  g${g - 1}n${perGroup - 1} --> g${g}n0`)
  }
  return out.join('\n')
}

// A new native family must supply a real scaling workload at this owning
// boundary. The type closes enrollment without a second family inventory.
const WORKLOADS = {
  flowchart: [
    { id: 'tree-300', source: flowchartTree(300) },
    { id: 'mesh-120-labelled-40', source: flowchartMesh(120, 40) },
    { id: 'subgraphs-12x8', source: flowchartSubgraphs(12, 8) },
  ],
  sequence: [{ id: '20-participants-300-messages', source: lines('sequenceDiagram', 300, i => `  P${i % 20}->>P${(i * 7 + 1) % 20}: message ${i}`) }],
  class: [{ id: '80-classes', source: lines('classDiagram', 80, i => [`  class C${i} {`, `    +int field${i}`, `    +method${i}()`, '  }', ...(i > 0 ? [`  C${Math.floor((i - 1) / 2)} <|-- C${i}`] : [])]) }],
  state: [{ id: '80-states', source: lines('stateDiagram-v2', 80, i => [`  S${i} --> S${i + 1}: e${i}`, ...(i % 5 === 0 ? [`  S${i + 1} --> S${Math.max(0, i - 3)}`] : [])]) }],
  er: [{ id: '40-entities', source: lines('erDiagram', 40, i => [`  E${i} {`, '    int id PK', `    string name${i}`, '  }', ...(i > 0 ? [`  E${Math.floor((i - 1) / 2)} ||--o{ E${i} : has`] : [])]) }],
  gantt: [{ id: '150-tasks', source: lines('gantt\n  dateFormat YYYY-MM-DD', 150, i => [...(i % 15 === 0 ? [`  section Phase ${i / 15}`] : []), i === 0 ? '  Task 0 :t0, 2024-01-01, 3d' : `  Task ${i} :t${i}, after t${i - 1}, ${1 + (i % 4)}d`]) }],
  gitgraph: [{ id: '200-commits', source: lines('gitGraph', 40, i => [`  commit id: "m${i}a"`, `  branch b${i}`, `  commit id: "b${i}a"`, `  commit id: "b${i}b"`, '  checkout main', `  merge b${i}`]) }],
  mindmap: [{ id: '200-nodes', source: lines('mindmap\n  root((Root))', 20, i => [`    Topic ${i}`, ...Array.from({ length: 9 }, (_, j) => `      Idea ${i}.${j}`)]) }],
  timeline: [{ id: '100-events', source: lines('timeline\n  title History', 100, i => [...(i % 10 === 0 ? [`  section Decade ${i / 10}`] : []), `    ${1900 + i} : Event ${i} : Detail ${i}`]) }],
  sankey: [{ id: '120-links', source: lines('sankey-beta', 120, i => `Source ${i % 12},Target ${(i * 5) % 30},${1 + (i % 9)}`) }],
  journey: [{ id: '120-tasks', source: lines('journey\n  title Product delivery', 120, i => [...(i % 12 === 0 ? [`  section Stage ${i / 12}`] : []), `    Task ${i}: ${1 + (i % 5)}: Alice, Bob`]) }],
  architecture: [{ id: '40-services', source: lines('architecture-beta', 40, i => [`  service s${i}(server)[Service ${i}]`, ...(i > 0 ? [`  s${i - 1}:R --> L:s${i}`] : [])]) }],
  xychart: [
    {
      id: '12-series-80-points',
      source: ['xychart-beta', '  title "Load over time"', `  x-axis [${Array.from({ length: 80 }, (_, i) => `"Day ${i}"`).join(', ')}]`, '  y-axis "Load" 0 --> 100', ...Array.from({ length: 12 }, (_, i) => `  line [${Array.from({ length: 80 }, (_, j) => 10 + ((j * 7 + i * 3) % 80)).join(', ')}]`)].join('\n'),
    },
  ],
  pie: [{ id: '80-slices', source: lines('pie title Segment distribution', 80, i => `  "Segment ${i}" : ${1 + (i % 12)}`) }],
  quadrant: [{ id: '150-points', source: lines('quadrantChart\n  title Portfolio\n  x-axis Low --> High\n  y-axis Low --> High', 150, i => `  Item ${i}: [${(0.05 + ((i * 7) % 90) / 100).toFixed(2)}, ${(0.05 + ((i * 13) % 90) / 100).toFixed(2)}]`) }],
  radar: [
    {
      id: '12-series-24-axes',
      source: ['radar-beta', '  title "Capability profile"', ...Array.from({ length: 24 }, (_, i) => `  axis a${i}["Axis ${i}"]`), ...Array.from({ length: 12 }, (_, i) => `  curve c${i}["Series ${i}"]{${Array.from({ length: 24 }, (_, j) => 1 + ((i * 7 + j * 3) % 9)).join(', ')}}`), '  max 10'].join('\n'),
    },
  ],
  c4: [{ id: '40-services', source: ['C4Container', ...Array.from({ length: 40 }, (_, i) => [`  Container(s${i}, "Service ${i}", "Node", "Capability ${i}")`, ...(i > 0 ? [`  Rel(s${i - 1}, s${i}, "Calls ${i}")`] : [])]).flat()].join('\n') }],
} satisfies Record<DiagramKind, readonly { id: string; source: string }[]>

export function releaseBenchCases(): readonly BenchCase[] {
  return Object.entries(WORKLOADS).flatMap(([family, cases]) => cases.map(input => ({ ...input, id: `${family}:${input.id}`, family: family as DiagramKind })))
}
