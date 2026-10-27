import { createHash } from 'node:crypto'
import { flowchartMesh, flowchartMultigraph, flowchartSubgraphs, flowchartTree } from '../shared/graph-fixtures.ts'

export interface GeneratedFlowchartRange { start: number; count: number }

/** Bounded, replayable mixed-shape multigraphs for backend quality exploration.
 * Seeds used to choose a refinement become development data, not a new holdout. */
export type GeneratedFlowchartKind = 'lcg-v1' | 'sha256-counter-v1'

export function generatedFlowchartSamples({ start, count }: GeneratedFlowchartRange, kind: GeneratedFlowchartKind = 'lcg-v1'): { id: string; family: string; source: string }[] {
  if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(count) || count < 1 || count > 256 || start + count > 0x1_0000_0000) {
    throw new RangeError('Generated comparison requires 1–256 cases in a nonnegative 32-bit seed range')
  }
  if (kind !== 'lcg-v1' && kind !== 'sha256-counter-v1') throw new RangeError('Unknown generated comparison kind')
  const shapes = [['[', ']'], ['{', '}'], ['(', ')'], ['((', '))'], ['[[', ']]'], ['[(', ')]']]
  return Array.from({ length: count }, (_, offset) => {
    const seed = start + offset
    let state = seed + 1, counter = 0
    // Each endpoint consumes a separate counter digest. Unlike the retained
    // LCG's alternating low bits, even-sized graphs admit either source parity.
    // This generates inputs only; hashing is not a provenance check or solver.
    const random = kind === 'lcg-v1'
      ? (bound: number): number => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % bound }
      : (bound: number): number => createHash('sha256').update(`agentic-mermaid-qualification-v1:${seed}:${counter++}`).digest().readUInt32BE(0) % bound
    const nodes = 8 + seed % 13
    const lines = [`flowchart ${['TD', 'LR', 'BT', 'RL'][seed % 4]}`]
    for (let index = 0; index < nodes; index++) {
      const shape = shapes[(seed + index) % shapes.length]!
      lines.push(`n${index}${shape[0]}Node ${seed}-${index}${shape[1]}`)
    }
    for (let index = 0; index < 2 * nodes + seed % 7; index++) {
      const source = random(nodes), target = (source + 1 + random(nodes - 1)) % nodes
      const label = index % 4 === 0 ? `|edge ${index} ${'x'.repeat(3 + index % 17)}|` : ''
      lines.push(`n${source} -->${label} n${target}`)
    }
    return { id: `${kind === 'lcg-v1' ? 'generated-cyclic' : 'generated-sha256-counter-v1'}:${seed}`, family: 'flowchart', source: lines.join('\n') }
  })
}

/** Product geometry stress inputs; release benchmark enrollment stays in Trident. */
export function graphStressSamples(): { id: string; family: string; source: string }[] {
  const lines = (header: string, count: number, row: (index: number) => string[]): string =>
    [header, ...Array.from({ length: count }, (_, index) => row(index)).flat()].join('\n')
  const junctions = (count: number): string => lines('architecture-beta', count,
    index => [`junction j${index}`, ...(index ? [`j${index - 1}:R<-->L:j${index}`] : [])])
  return [
    { id: 'architecture-16-junctions', family: 'architecture', source: junctions(16) },
    { id: 'architecture-32-junctions', family: 'architecture', source: junctions(32) },
    { id: 'architecture-32-large-junctions', family: 'architecture', source: `---\nconfig:\n  architecture:\n    iconSize: 40\n---\n${junctions(32)}` },
    { id: 'architecture-40-services', family: 'architecture', source: lines('architecture-beta', 40,
      index => [`  service s${index}(server)[Service ${index}]`, ...(index ? [`  s${index - 1}:R --> L:s${index}`] : [])]) },
    { id: 'class-80-classes', family: 'class', source: lines('classDiagram', 80,
      index => [`  class C${index} {`, `    +int field${index}`, `    +method${index}()`, '  }', ...(index ? [`  C${Math.floor((index - 1) / 2)} <|-- C${index}`] : [])]) },
    { id: 'er-40-entities', family: 'er', source: lines('erDiagram', 40,
      index => [`  E${index} {`, '    int id PK', `    string name${index}`, '  }', ...(index ? [`  E${Math.floor((index - 1) / 2)} ||--o{ E${index} : has`] : [])]) },
    { id: 'flowchart-mesh-120-labelled-40', family: 'flowchart', source: flowchartMesh(120, 40) },
    { id: 'flowchart-multigraph-24-loops', family: 'flowchart', source: flowchartMultigraph(24) },
    { id: 'flowchart-subgraphs-12x8', family: 'flowchart', source: flowchartSubgraphs(12, 8) },
    { id: 'flowchart-tree-300', family: 'flowchart', source: flowchartTree(300) },
    { id: 'requirement-100-requirements-99-relations', family: 'requirement', source: lines('requirementDiagram', 100,
      index => [`  requirement r${index} {`, `    id: R${index}`, `    text: "Requirement ${index}"`, '    risk: medium', '    verifymethod: test', '  }', ...(index ? [`  r${index - 1} - traces -> r${index}`] : [])]) },
    { id: 'state-80-states', family: 'state', source: lines('stateDiagram-v2', 80,
      index => [`  S${index} --> S${index + 1}: e${index}`, ...(index % 5 === 0 ? [`  S${index + 1} --> S${Math.max(0, index - 3)}`] : [])]) },
  ].map(sample => ({ ...sample, id: `fixture/stress/${sample.id}.mmd` }))
}
