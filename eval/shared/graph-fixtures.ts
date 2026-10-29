// Deterministic authored input shared by the route-quality contract and scaling diagnostics.
export function lcg(seed: number): () => number {
  let state = seed >>> 0
  return () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296
}

function lines(header: string, count: number, line: (i: number) => string | string[]): string {
  const out = [header]
  for (let i = 0; i < count; i++) out.push(...[line(i)].flat())
  return out.join('\n')
}

export function flowchartMesh(nodes: number, labelled: number): string {
  const rnd = lcg(7)
  const edges = lines('flowchart TD', nodes - 1, i => `  n${Math.floor(rnd() * (i + 1))} --> n${i + 1}`)
  return edges + '\n' + Array.from({ length: labelled }, (_, i) => `  n${Math.floor(rnd() * nodes)} -->|label ${i}| n${Math.floor(rnd() * nodes)}`).join('\n')
}

export function flowchartTree(nodes: number): string {
  return lines('flowchart TD', nodes - 1, i => `  n${Math.floor(i / 3)}[Node ${Math.floor(i / 3)}] --> n${i + 1}[Node ${i + 1}]`)
}

export function flowchartMultigraph(nodes: number): string {
  const rnd = lcg(29)
  return lines('flowchart TD', nodes, i => `n${i}[Node ${i}]`)
    + '\n' + Array.from({ length: 3 * nodes }, (_, index) => {
      const source = Math.floor(rnd() * nodes)
      const target = index % 8 === 0 ? source : Math.floor(rnd() * nodes)
      return `n${source} -->${index % 4 === 0 ? `|transition ${index}|` : ''} n${target}`
    }).join('\n')
    + '\nn0 --> n1\nn0 --> n1\nn1 --> n0'
}

export function flowchartSubgraphs(groups: number, perGroup: number): string {
  const out = ['flowchart LR']
  for (let g = 0; g < groups; g++) {
    out.push(`  subgraph g${g}[Group ${g}]`)
    for (let i = 0; i < perGroup; i++) out.push(`    g${g}n${i}[Step ${i}]${i > 0 ? ` --> g${g}n${i - 1}` : ''}`)
    out.push('  end')
    if (g > 0) out.push(`  g${g - 1}n${perGroup - 1} --> g${g}n0`)
  }
  return out.join('\n')
}
