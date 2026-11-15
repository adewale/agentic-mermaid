import { projectEntityMarkers } from '../../src/shared/mermaid-entity-display.ts'
import { projectNativeGraphs, projectReferenceGraphs } from './grammar-native-graphs.ts'
import type { GrammarReferenceReply, NativeSemanticProjection } from './grammar-types.ts'
import type { Json } from './reference.ts'

type Row = Record<string, any>
const row = (value: unknown): Row => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : {})
const list = (value: unknown): any[] => (Array.isArray(value) ? value : [])
const text = (value: unknown): string => (typeof value === 'string' ? value : '')
const values = (value: unknown): Row[] => list(value).map(pair => row(pair[1]))
const byId = (nodes: Row[]): Row[] => [...nodes].sort((a, b) => text(a.id).localeCompare(text(b.id)))
const projection = (value: Row): NativeSemanticProjection => ({ fields: Object.keys(value), value: JSON.parse(JSON.stringify(value)) as Json })
const nativeCommon = (body: Row): Row => ({ title: body.title ?? '', accTitle: body.accessibilityTitle ?? '', accDescription: body.accessibilityDescription ?? '' })
const referenceCommon = (data: Row): Row => ({ title: data.getDiagramTitle ?? '', accTitle: data.getAccTitle ?? '', accDescription: data.getAccDescription ?? '' })
const decoded = (value: unknown): string => projectEntityMarkers(text(value))
function treeNodes(nodes: Row[]): Row[] {
  const ids = new Map(nodes.map((node, index) => [node.id, index]))
  return nodes.map(node => ({ label: node.label, parent: ids.get(node.parentId) ?? null, type: node.nodeType, className: node.className ?? '', icon: node.icon ?? '', description: node.description ?? '' }))
}
function referenceTree(root: Row): Row[] {
  const result: Row[] = []
  const visit = (node: Row, parent: number | null): void => {
    const index = result.length
    result.push({ label: decoded(node.name), parent, type: node.nodeType, className: node.cssClass ?? '', icon: node.icon ?? '', description: decoded(node.description) })
    for (const child of list(node.children)) visit(child, index)
  }
  for (const child of list(root.children)) visit(child, null)
  return result
}
const usecaseNode = (node: Row): Row => {
  const { kind: _kind, ...value } = node
  return { ...value, label: decoded(value.label) }
}
const usecaseJson = (node: Row): Row => ({ ...node, propertyOrder: list(node.propertyOrder).sort((a, b) => text(a[0]).localeCompare(text(b[0]))) })
const wardleyFields = ['nodes', 'links', 'trends', 'pipelines', 'annotations', 'notes', 'accelerators', 'deaccelerators', 'annotationsBox', 'axes', 'size']
const wardley = (body: Row): Row => Object.fromEntries(wardleyFields.filter(key => body[key] !== undefined).map(key => [key, body[key]]))
// Role is the semantic shape vocabulary. Raw shape aliases are already
// retained by the production model, but Mermaid rewrites them in its DB.
const agentflowTopology = (value: unknown): Row => {
  const graph = row(value)
  return { ...graph, nodes: list(graph.nodes).map(({ shape: _shape, ...node }) => node) }
}
const agentflowMetadata = (entries: any[]): any[] =>
  entries
    .map(([id, value]) => {
      const { shape: _shape, ...metadata } = value
      return [id, metadata]
    })
    .filter(([, metadata]) => Object.keys(metadata).length)
    .sort(([a], [b]) => a.localeCompare(b))
const domains = (items: Row[]): Row[] => [...items].sort((a, b) => text(a.name).localeCompare(text(b.name)))

/** Independent returned-model scopes. No parser events or expected specimens
 * are invented here; unsupported upstream getters leave comparison unavailable. */
export function projectNativeRoadmap(family: string, model: unknown): NativeSemanticProjection | undefined {
  const body = row(model),
    common = nativeCommon(body)
  switch (family) {
    case 'treeview':
      return projection({ ...common, nodes: treeNodes(body.nodes) })
    case 'usecase':
      return projection({
        ...common,
        direction: body.direction,
        actors: byId(body.nodes.filter((node: Row) => node.kind === 'actor').map(usecaseNode)),
        useCases: byId(body.nodes.filter((node: Row) => node.kind === 'usecase').map(usecaseNode)),
        boundaries: byId(body.boundaries),
        relationships: body.relationships,
        notes: byId(body.notes),
        jsonNodes: byId(body.jsonNodes.map(usecaseJson)),
        classDefs: byId(body.classDefs),
      })
    case 'wardley':
      return projection({ ...common, ...wardley(body) })
    case 'cynefin':
      return projection({ ...common, domains: domains(body.domains), transitions: body.transitions })
    case 'venn':
      return projection({ ...common, subsets: body.subsets, textNodes: body.textNodes, styles: body.styles })
    case 'railroad':
      return projection({ ...common, rules: body.rules })
    case 'swimlane':
      return projectNativeGraphs('flowchart', body.graph)
    case 'agentflow': {
      const graph = projectNativeGraphs('flowchart', body.graph)
      if (!graph) return undefined
      return projection({ ...agentflowTopology(graph.value), roles: [...body.roles].sort(([a]: string[], [b]: string[]) => a!.localeCompare(b!)), metadata: agentflowMetadata([...body.metadata]), connectors: [...body.connectors].sort() })
    }
    default:
      return undefined
  }
}
export function projectReferenceRoadmap(family: string, reply: GrammarReferenceReply): NativeSemanticProjection | undefined {
  const data = row(reply.snapshot?.data),
    common = referenceCommon(data)
  switch (family) {
    case 'treeview':
      return data.getRoot ? projection({ ...common, nodes: referenceTree(data.getRoot) }) : undefined
    case 'usecase':
      return Array.isArray(data.getActors) && Array.isArray(data.getUseCases)
        ? projection({
            ...common,
            direction: data.getDirection,
            actors: byId(values(data.getActors).map(usecaseNode)),
            useCases: byId(values(data.getUseCases).map(usecaseNode)),
            boundaries: byId(values(data.getSystemBoundaries)),
            relationships: data.getRelationships,
            notes: byId(values(data.getNotes)),
            jsonNodes: byId(values(data.getJsonNodes).map(usecaseJson)),
            classDefs: byId(values(data.getClassDefs)),
          })
        : undefined
    case 'wardley':
      return data.getWardleyData ? projection({ ...common, ...wardley(data.getWardleyData) }) : undefined
    case 'cynefin':
      return Array.isArray(data.getDomains) ? projection({ ...common, domains: domains(values(data.getDomains)), transitions: data.getTransitions }) : undefined
    case 'venn':
      return Array.isArray(data.getSubsetData) ? projection({ ...common, subsets: data.getSubsetData, textNodes: data.getTextData, styles: data.getStyleData }) : undefined
    case 'railroad':
      return Array.isArray(data.getRules) ? projection({ ...common, rules: data.getRules }) : undefined
    case 'swimlane':
      return projectReferenceGraphs('flowchart', reply)
    // The public semantic model is the independent role/metadata oracle;
    // FlowDB getters also expose raw metadata including authored shape aliases.
    case 'agentflow': {
      const graph = projectReferenceGraphs('flowchart', reply),
        semantic = row(data.getSemanticModel)
      if (!graph || !Array.isArray(semantic.vertices) || !Array.isArray(data.getVertices)) return undefined
      const vertices = values(data.getVertices)
      const metadataOwners = [...vertices, ...list(data.getEdges).map(row), ...list(data.getSubGraphs).map(row)]
      const roles = [...semantic.vertices.map((node: Row) => [node.id, node.vertexKind]), ...list(semantic.connectors).map((node: Row) => [node.id, 'connector'])].sort(([a]: string[], [b]: string[]) => a!.localeCompare(b!))
      return projection({
        ...agentflowTopology(graph.value),
        roles,
        metadata: agentflowMetadata(metadataOwners.filter(node => node.metadata).map(node => [node.id, node.metadata])),
        connectors: list(semantic.connectors)
          .map((node: Row) => node.id)
          .sort(),
      })
    }
    default:
      return undefined
  }
}
