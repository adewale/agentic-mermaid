interface SelectableEdge {
  source: string
  target: string
  id?: string
}

/** Endpoint occurrences are counted per ordered pair, never by graph index. */
export function edgeEndpointSelectors(edges: readonly SelectableEdge[]): string[] {
  const occurrences = new Map<string, number>()
  return edges.map(edge => {
    const pair = `${edge.source}->${edge.target}`
    const occurrence = occurrences.get(pair) ?? 0
    occurrences.set(pair, occurrence + 1)
    return `${pair}#${occurrence}`
  })
}

/** Authored identities take precedence over generated endpoint aliases. */
export function edgeSelectorIndices(edges: readonly SelectableEdge[]): Map<string, number> {
  const indices = new Map<string, number>()
  edgeEndpointSelectors(edges).forEach((selector, index) => {
    indices.set(selector, index)
    if (selector.endsWith('#0')) indices.set(selector.slice(0, -2), index)
  })
  // Match the first authored identity, as mutation historically does, even
  // when another edge's generated alias has the same spelling.
  for (let index = edges.length - 1; index >= 0; index--) {
    const id = edges[index]!.id
    if (id) indices.set(id, index)
  }
  return indices
}
