/** Bridge native family/header names to the pinned detector's config scope.
 * Legacy init.config remaps only flowchart-v2 to flowchart; other detector
 * names must remain distinct from the current per-family config section. */
export function pinnedMermaidDiagramType(familyOrHeader: string): string {
  const name = familyOrHeader.split(/[;:\s]/, 1)[0]!.replace(/-(?:v2|beta)$/i, '').toLowerCase()
  if (/^c4(?:context|container|component|dynamic|deployment)?$/.test(name)) return 'c4'
  return ({
    graph: 'flowchart-v2', flowchart: 'flowchart-v2',
    class: 'classDiagram', classdiagram: 'classDiagram',
    state: 'stateDiagram', statediagram: 'stateDiagram',
    sequencediagram: 'sequence',
    erdiagram: 'er', requirementdiagram: 'requirement',
    quadrant: 'quadrantChart', quadrantchart: 'quadrantChart',
    gitgraph: 'gitGraph',
  } as Record<string, string>)[name] ?? name
}
