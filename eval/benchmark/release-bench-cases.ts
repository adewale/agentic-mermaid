// Generated large diagrams for the release benchmark. The official-fence corpus
// covers syntax breadth with small inputs; these exercise how each layout
// family scales. Sizes are chosen so the slowest released version still
// finishes each case in seconds. Every generator is deterministic.

export interface BenchCase {
  id: string
  family: string
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
  return edges + '\n' + Array.from({ length: labelled }, (_, i) =>
    `  n${Math.floor(rnd() * nodes)} -->|label ${i}| n${Math.floor(rnd() * nodes)}`).join('\n')
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

const CASES: readonly BenchCase[] = [
  { id: 'flowchart:tree-300', family: 'flowchart', source: flowchartTree(300) },
  { id: 'flowchart:mesh-120-labelled-40', family: 'flowchart', source: flowchartMesh(120, 40) },
  { id: 'flowchart:subgraphs-12x8', family: 'flowchart', source: flowchartSubgraphs(12, 8) },
  {
    id: 'sequence:20-participants-300-messages',
    family: 'sequence',
    source: lines('sequenceDiagram', 300, i => `  P${i % 20}->>P${(i * 7 + 1) % 20}: message ${i}`),
  },
  {
    id: 'class:80-classes',
    family: 'class',
    source: lines('classDiagram', 80, i => [
      `  class C${i} {`, `    +int field${i}`, `    +method${i}()`, '  }',
      ...(i > 0 ? [`  C${Math.floor((i - 1) / 2)} <|-- C${i}`] : []),
    ]),
  },
  {
    id: 'state:80-states',
    family: 'state',
    source: lines('stateDiagram-v2', 80, i => [`  S${i} --> S${i + 1}: e${i}`, ...(i % 5 === 0 ? [`  S${i + 1} --> S${Math.max(0, i - 3)}`] : [])]),
  },
  {
    id: 'er:40-entities',
    family: 'er',
    source: lines('erDiagram', 40, i => [
      `  E${i} {`, '    int id PK', `    string name${i}`, '  }',
      ...(i > 0 ? [`  E${Math.floor((i - 1) / 2)} ||--o{ E${i} : has`] : []),
    ]),
  },
  {
    id: 'gantt:150-tasks',
    family: 'gantt',
    source: lines('gantt\n  dateFormat YYYY-MM-DD', 150, i => [
      ...(i % 15 === 0 ? [`  section Phase ${i / 15}`] : []),
      i === 0 ? '  Task 0 :t0, 2024-01-01, 3d' : `  Task ${i} :t${i}, after t${i - 1}, ${1 + (i % 4)}d`,
    ]),
  },
  {
    id: 'gitgraph:200-commits',
    family: 'gitgraph',
    source: lines('gitGraph', 40, i => [
      `  commit id: "m${i}a"`, `  branch b${i}`, `  commit id: "b${i}a"`, `  commit id: "b${i}b"`,
      '  checkout main', `  merge b${i}`,
    ]),
  },
  {
    id: 'mindmap:200-nodes',
    family: 'mindmap',
    source: lines('mindmap\n  root((Root))', 20, i => [`    Topic ${i}`, ...Array.from({ length: 9 }, (_, j) => `      Idea ${i}.${j}`)]),
  },
  {
    id: 'timeline:100-events',
    family: 'timeline',
    source: lines('timeline\n  title History', 100, i => [
      ...(i % 10 === 0 ? [`  section Decade ${i / 10}`] : []),
      `    ${1900 + i} : Event ${i} : Detail ${i}`,
    ]),
  },
  {
    id: 'sankey:120-links',
    family: 'sankey',
    source: lines('sankey-beta', 120, i => `Source ${i % 12},Target ${(i * 5) % 30},${1 + (i % 9)}`),
  },
]

export function releaseBenchCases(): readonly BenchCase[] {
  return CASES
}
