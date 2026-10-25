import { publicDatabaseView } from './upstream-test-assertions.mjs'

const entries = value => value instanceof Map ? [...value] : Array.isArray(value) ? value.map(item => [String(item.id ?? item.name), item]) : value && typeof value === 'object' ? Object.entries(value) : []
const clone = (value, seen = new Map()) => {
  if (!value || typeof value !== 'object') return value
  if (seen.has(value)) return seen.get(value)
  if (value instanceof Date) return new Date(value)
  const out = value instanceof Map ? new Map() : value instanceof Set ? new Set() : Array.isArray(value) ? [] : Object.create(Object.getPrototypeOf(value))
  seen.set(value, out)
  if (value instanceof Map) for (const [key, item] of value) out.set(clone(key, seen), clone(item, seen))
  else if (value instanceof Set) for (const item of value) out.add(clone(item, seen))
  else for (const [key, item] of Object.entries(value)) out[key] = clone(item, seen)
  return out
}

/** Snapshot real getter returns immediately: several Mermaid diagram DBs are
 * shared singletons, and preparing a second source must not overwrite the first.
 * Mutation/internal helpers are never synthesized from original expectations. */
/** @returns {Record<string, (...args: any[]) => any>} */
export function snapshotMermaidDatabase(db) {
  const getters = {}, names = new Set()
  for (let object = db; object && object !== Object.prototype; object = Object.getPrototypeOf(object)) for (const name of Object.getOwnPropertyNames(object)) names.add(name)
  for (const name of names) {
    if (!/^get[A-Z]/.test(name) || typeof db[name] !== 'function' || db[name].length) continue
    try { const observed = clone(db[name]()); getters[name] = () => clone(observed) } catch { /* Not a zero-argument public observation. */ }
  }
  if (getters.getClasses) getters.getClass = id => { const values = getters.getClasses(); return values instanceof Map ? values.get(id) : values[id] }
  return getters
}

/** Translate actual observed public field names, retaining representation gaps.
 * These projections do not promise Mermaid's private renderer/database API. */
export function projectPublicDatabase(tool, family, raw) {
  if (tool === 'mermaid') return snapshotMermaidDatabase(raw)
  if (family === 'mindmap' || family === 'gitgraph') return publicDatabaseView(tool, raw, family)
  const view = { ...clone(raw) }, field = (name, property, object = raw) => { if (object && property in object) view[name] = () => clone(object[property]) }
  field('getDiagramTitle', 'title'); field('getAccTitle', 'accessibilityTitle'); field('getAccDescription', 'accessibilityDescription'); field('getDirection', 'direction')
  if (family === 'flowchart') {
    const graph = tool === 'agentic' ? raw.graph : raw
    const shapes = { rect: 'square', rounded: 'round', asymmetric: 'odd' }
    if (graph?.nodes) view.getVertices = () => new Map(entries(graph.nodes).map(([id, node]) => [id, { ...clone(node), text: node.label ?? node.text, type: shapes[node.shape] ?? node.type ?? node.shape, ...(graph.nodeStyles instanceof Map ? { styles: Object.entries(graph.nodeStyles.get(id) ?? {}).map(([key, value]) => `${key}:${value}`) } : {}) }]))
    if (graph?.edges) view.getEdges = () => graph.edges.map(edge => ({ ...clone(edge), start: edge.source ?? edge.start, end: edge.target ?? edge.end, ...(edge.label !== undefined ? { text: edge.label } : {}) }))
    field('getDirection', 'direction', graph); field('getSubGraphs', 'subgraphs', graph); field('getClasses', 'classDefs', graph)
  } else if (family === 'class') {
    if (raw.classes) view.getClasses = () => new Map(entries(raw.classes).map(([id, item]) => [id, { ...clone(item), ...(item.namespace !== undefined ? { parent: item.namespace } : {}) }]))
    if (view.getClasses) view.getClass = id => view.getClasses().get(id)
    field('getRelations', 'relations'); field('getNotes', 'notes'); field('getNamespaces', 'namespaces')
  } else if (family === 'er') {
    if (raw.entities) view.getEntities = () => new Map(entries(raw.entities).map(([id, item]) => [id, { ...clone(item), ...(tool === 'agentic' ? { alias: item.label ?? '' } : {}) }]))
    if (raw.relationships) field('getRelationships', 'relationships')
    else if (raw.relations) view.getRelationships = () => raw.relations.map(item => ({ ...clone(item), entityA: item.from, entityB: item.to, roleA: item.label }))
  } else if (family === 'sequence') {
    const actors = raw.participants ?? raw.actors
    if (actors) view.getActors = () => new Map(entries(actors).map(([id, item]) => [id, { ...clone(item), description: item.label ?? item.description }]))
    if (actors) view.getActorKeys = () => entries(actors).map(([id]) => id)
    field('getMessages', 'messages'); field('getNotes', 'notes'); field('getBoxes', 'boxes')
  } else if (family === 'pie') {
    if (raw.sections ?? raw.slices) view.getSections = () => new Map(entries(raw.sections ?? raw.slices).map(([key, item]) => [item.label ?? key, item.value ?? item]))
    field('getShowData', 'showData')
  } else if (family === 'journey') {
    field('getTasks', 'tasks'); field('getSections', 'sections'); field('getActors', 'actors')
  } else if (family === 'gantt') {
    field('getTasks', 'tasks'); field('getSections', 'sections'); field('getDateFormat', 'dateFormat'); field('getAxisFormat', 'axisFormat'); field('getDisplayMode', 'displayMode')
  } else if (family === 'timeline') {
    field('getTasks', 'periods'); field('getSections', 'sections')
  } else if (family === 'requirement') {
    field('getRequirements', 'requirements'); field('getElements', 'elements'); field('getRelationships', 'relations')
  }
  return view
}
