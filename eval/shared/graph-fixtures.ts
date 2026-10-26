// Deterministic authored input shared by the route-quality contract and scaling diagnostics.
function lcg(seed: number): () => number {
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
