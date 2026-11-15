import type { RailroadNode } from '../../src/railroad/types.ts'
import type { NativeDb } from './runtime.ts'
import { unavailable } from './runtime.ts'

/** The pinned database's display IR, projected from the richer native grammar.
 * Native bodies retain predicates/ordering and JSON-safe unbounded repeats. */
function railroadDefinition(node: RailroadNode): any {
  switch (node.type) {
    case 'terminal': return { type: 'terminal', value: node.value }
    case 'any': return { type: 'special', text: '.' }
    case 'predicate': {
      const operand = railroadDefinition(node.element)
      const text = operand.type === 'terminal' ? `"${operand.value}"` : operand.type === 'nonterminal' ? operand.name : operand.type === 'special' ? operand.text : undefined
      if (text === undefined) return unavailable('Railroad compound predicate: the pinned display IR collapses its grammar to an ellipsis')
      return { type: 'special', text: node.operator + text }
    }
    case 'sequence': return { type: 'sequence', elements: node.elements.map(railroadDefinition) }
    case 'choice': return { type: 'choice', alternatives: node.alternatives.map(railroadDefinition) }
    case 'optional': return { type: 'optional', element: railroadDefinition(node.element) }
    case 'repetition': return { type: 'repetition', element: railroadDefinition(node.element), min: node.min, max: node.max ?? Infinity }
    default: return node
  }
}

/** Public database schemas over the actual family models. Builder calls and
 * renderer measurements remain unavailable; these views never parse test data. */
export function roadmapGetter(db: NativeDb, key: string): any {
  const family = db.context.family,
    model = db.model
  if (family === 'treeview') {
    if (key === 'getCount') return () => (model?.nodes.length ?? 0) + 1
    if (key === 'getRoot')
      return () => {
        const root: any = { id: 0, level: -1, name: '/', nodeType: 'directory', children: [] }
        const parents = new Map<string, any>(),
          consumed = db.events.filter(event => event.unit === 'statement' && event.kind === 'node')
        for (const [index, node] of (model?.nodes ?? []).entries()) {
          const raw = consumed[index]?.text
          if (raw === undefined) return unavailable('TreeView authored indentation was not observed')
          const view = { id: index + 1, level: raw.length - raw.trimStart().length, name: node.label, nodeType: node.nodeType, icon: node.icon, cssClass: node.className, description: node.description, children: [] }
          ;(parents.get(node.parentId) ?? root).children.push(view)
          parents.set(node.id, view)
        }
        return root
      }
  }
  if (family === 'usecase') {
    const collections: Record<string, () => any[]> = {
      Actors: () => (model?.nodes ?? []).filter((node: any) => node.kind === 'actor').map(({ kind: _kind, ...node }: any) => node),
      UseCases: () => (model?.nodes ?? []).filter((node: any) => node.kind === 'usecase').map(({ kind: _kind, ...node }: any) => node),
      SystemBoundaries: () => model?.boundaries ?? [],
      Notes: () => model?.notes ?? [],
      ClassDefs: () => model?.classDefs ?? [],
      JsonNodes: () => (model?.jsonNodes ?? []).map((node: any) => ({ ...node, propertyOrder: new Map(node.propertyOrder) })),
    }
    const singular: Record<string, string> = { Actor: 'Actors', UseCase: 'UseCases', SystemBoundary: 'SystemBoundaries', Note: 'Notes', ClassDef: 'ClassDefs', JsonNode: 'JsonNodes' }
    for (const [name, values] of Object.entries(collections)) if (key === `get${name}`) return () => new Map(values().map(node => [node.id, node]))
    if (singular[key.slice(3)]) return (id: string) => collections[singular[key.slice(3)]!]!().find(node => node.id === id)
    if (key === 'getRelationships') return () => model?.relationships ?? []
    if (key === 'getDirection') return () => model?.direction ?? 'LR'
  }
  if (family === 'cynefin') {
    if (key === 'getDomains') return () => new Map((model?.domains ?? []).map((domain: any) => [domain.name, domain]))
    if (key === 'getTransitions') return () => model?.transitions ?? []
  }
  if (family === 'wardley') {
    if (key === 'getNode') return (id: string) => model?.nodes.find((node: any) => node.id === id)
    if (key === 'getWardleyData')
      return () => {
        if (!model) return unavailable('Wardley has no parsed model')
        const { kind: _kind, title: _title, accessibilityTitle: _at, accessibilityDescription: _ad, ...data } = model
        return data
      }
  }
  if (family === 'venn') {
    if (key === 'getSubsetData') return () => model?.subsets ?? []
    if (key === 'getTextData') return () => (model?.textNodes ?? []).map((node: any) => ({ ...node, label: node.label }))
    if (key === 'getStyleData') return () => model?.styles ?? []
  }
  if (family === 'railroad') {
    if (key === 'getRules') return () => (model?.rules ?? []).map((rule: any) => ({ ...rule, definition: railroadDefinition(rule.definition) }))
    if (key === 'getRule') return (name: string) => {
      const rule = [...(model?.rules ?? [])].reverse().find((rule: any) => rule.name === name)
      return rule && { ...rule, definition: railroadDefinition(rule.definition) }
    }
    if (key === 'getTitle') return () => model?.title ?? ''
  }
  if (family === 'swimlane' || family === 'agentflow') {
    // Both production families explicitly compose Flowchart topology.
    const graph = model?.graph
    if (key === 'getDirection') return () => graph?.direction ?? 'TB'
    if (key === 'getElementMappings' && family === 'agentflow')
      return () => (model?.mappings ?? []).map((mapping: any) => ({ id: mapping.id, type: mapping.type === 'flow' ? 'subgraph' : mapping.type, position: { startLine: mapping.line, startColumn: mapping.col - 1, endLine: mapping.endLine, endColumn: mapping.endCol - 1 } }))
  }
  return undefined
}
