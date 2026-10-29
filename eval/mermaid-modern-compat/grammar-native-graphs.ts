import type { ClassDiagram, ClassMember, ClassNamespace, RelationshipType } from '../../src/class/types.ts'
import type { MindmapDiagram, MindmapNode } from '../../src/mindmap/types.ts'
import { normalizeBrTags } from '../../src/multiline-utils.ts'
import { projectEntityMarkers } from '../../src/shared/mermaid-entity-display.ts'
import type { MermaidGraph, MermaidSubgraph } from '../../src/types.ts'
import type { GrammarReferenceReply, NativeSemanticProjection } from './grammar-types.ts'
import type { Json } from './reference.ts'

const row = (value: unknown): Record<string, unknown> => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {})
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const text = (value: unknown): string => (typeof value === 'string' ? value : '')
const label = (value: unknown): string => normalizeBrTags(Array.isArray(value) ? value.map(text).join('\n') : text(value))
const keyed = (value: unknown): Array<[string, Record<string, unknown>]> =>
  list(value)
    .filter(Array.isArray)
    .map(entry => [text(entry[0]), row(entry[1])])
const byId = <T extends { id: string }>(items: T[]): T[] => items.sort((a, b) => a.id.localeCompare(b.id))
const projection = (value: Record<string, Json>): NativeSemanticProjection => ({ fields: Object.keys(value), value })
const direction = (value: unknown): string => (value === 'TD' ? 'TB' : text(value) || 'TB')
const classes = (value: unknown): string[] => (Array.isArray(value) ? value.map(text) : text(value).split(/\s+/)).filter(name => name && name !== 'default')

/** Legacy spellings from flow.jison/FlowDB. Unknown modern shape aliases stay
 * distinct diagnostics; this does not use Agentic's own alias table as oracle.
 */
const shape = (value: unknown): string =>
  (
    ({
      square: 'rectangle',
      rect: 'rectangle',
      round: 'rounded',
      diam: 'diamond',
      subroutine: 'subroutine',
      stadium: 'stadium',
      cylinder: 'cylinder',
      circle: 'circle',
      doublecircle: 'doublecircle',
      hexagon: 'hexagon',
      odd: 'asymmetric',
      trapezoid: 'trapezoid',
      inv_trapezoid: 'trapezoid-alt',
      lean_right: 'lean-r',
      lean_left: 'lean-l',
    }) as Record<string, string>
  )[text(value)] ??
  (text(value) || 'rectangle')

function nativeGroups(groups: MermaidSubgraph[], parent = ''): Json[] {
  return groups.flatMap(group => [{ id: group.id, parent, label: group.label, members: [...group.nodeIds].sort(), direction: group.direction ? direction(group.direction) : '' }, ...nativeGroups(group.children, group.id)])
}

function nativeNamespaces(namespaces: ClassNamespace[], parent = ''): Json[] {
  return namespaces.flatMap(namespace => {
    const id = parent ? `${parent}.${namespace.name}` : namespace.name
    return [{ id, parent, label: namespace.label ?? '', members: [...namespace.classIds].sort() }, ...nativeNamespaces(namespace.children, id)]
  })
}

const marker = (kind: RelationshipType): string => (kind === 'inheritance' || kind === 'realization' ? 'triangle' : kind === 'composition' ? 'diamond-filled' : kind === 'aggregation' ? 'diamond-open' : kind === 'lollipop' ? 'lollipop' : kind === 'link-solid' || kind === 'link-dashed' ? 'none' : 'arrow')
const referenceMarker = (value: unknown): string => (({ 0: 'diamond-open', 1: 'triangle', 2: 'diamond-filled', 3: 'arrow', 4: 'lollipop' }) as Record<string, string>)[String(value)] ?? 'none'
const attributeText = (member: ClassMember): string => {
  const value = (member.sourceText ?? member.name).replace(/^[+\-#~]/, '').trim()
  return member.isStatic || member.isAbstract ? value.replace(/[$*]$/, '') : value
}
const nativeMember = (member: ClassMember, method: boolean): Json => ({
  visibility: member.visibility,
  static: member.isStatic === true,
  abstract: member.isAbstract === true,
  ...(method ? { name: member.name, parameters: member.params ?? '', returnType: member.type ?? '' } : { text: attributeText(member) }),
})
const referenceMember = (member: unknown, method: boolean): Json => {
  const value = row(member)
  return { visibility: text(value.visibility), static: value.classifier === '$', abstract: value.classifier === '*', ...(method ? { name: text(value.id), parameters: text(value.parameters), returnType: text(value.returnType) } : { text: text(value.id) }) }
}

function nativeState(graph: MermaidGraph): NativeSemanticProjection {
  const parents = new Map<string, string>()
  const visit = (groups: MermaidSubgraph[]): void => {
    for (const group of groups) {
      for (const id of group.nodeIds) parents.set(id, group.id)
      visit(group.children)
    }
  }
  visit(graph.subgraphs)
  const identities = new Map<string, string>(),
    ordinals = new Map<string, number>()
  for (const node of graph.nodes.values()) {
    if (node.shape !== 'state-start' && node.shape !== 'state-end') {
      identities.set(node.id, node.id)
      continue
    }
    const stem = `${node.shape}:${parents.get(node.id) ?? '$root'}`
    const index = ordinals.get(stem) ?? 0
    ordinals.set(stem, index + 1)
    identities.set(node.id, `${stem}:${index}`)
  }
  const groups = (items: MermaidSubgraph[], parent = '', inherited = direction(graph.direction)): Json[] =>
    items.flatMap(group => {
      const effective = group.direction ? direction(group.direction) : inherited
      return [{ id: group.id, parent, label: group.label, members: group.nodeIds.map(id => identities.get(id) ?? id).sort(), direction: effective }, ...groups(group.children, group.id, effective)]
    })
  return projection({
    direction: direction(graph.direction),
    states: byId(
      [...graph.nodes.values()].map(node => ({ id: identities.get(node.id)!, parent: parents.get(node.id) ?? '', label: node.shape === 'state-start' || node.shape === 'state-end' ? '' : node.label, kind: node.shape.startsWith('state-') ? node.shape : 'state', classes: classes(graph.classAssignments.get(node.id)) })),
    ),
    groups: groups(graph.subgraphs).sort((a, b) => text(row(a).id).localeCompare(text(row(b).id))),
    transitions: graph.edges.map(edge => ({ from: identities.get(edge.source) ?? edge.source, to: identities.get(edge.target) ?? edge.target, label: edge.label ?? '' })),
  })
}

/** State text as it displays: upstream keeps entity codes as markers
 * (`ﬂ°°35¶ß`), which State's native reading has already decoded. */
const stateLabel = (value: unknown): string => {
  const raw = label(value)
  try {
    return projectEntityMarkers(raw)
  } catch {
    return raw
  }
}

function referenceState(reply: GrammarReferenceReply): NativeSemanticProjection | undefined {
  const data = row(reply.snapshot?.data.getData)
  if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) return undefined
  const nodes = list(data.nodes).map(row),
    identities = new Map<string, string>(),
    ordinals = new Map<string, number>()
  const parentOf = (node: Record<string, unknown>): string => text(node.parentId ?? node.parent)
  const stateKind = (node: Record<string, unknown>): string =>
    (({ stateStart: 'state-start', stateEnd: 'state-end', fork: 'state-fork', join: 'state-join', choice: 'state-choice', stateFork: 'state-fork', stateJoin: 'state-join', stateChoice: 'state-choice', stateHistory: 'state-history' }) as Record<string, string>)[text(node.shape)] ?? 'state'
  for (const node of nodes) {
    // Notes and their attachment links are rendering auxiliaries, outside
    // this projection's declared authored-state/transition scope.
    if (node.shape === 'note') continue
    const id = text(node.id),
      kind = stateKind(node)
    if (kind !== 'state-start' && kind !== 'state-end') {
      identities.set(id, id)
      continue
    }
    const stem = `${kind}:${parentOf(node) || '$root'}`,
      index = ordinals.get(stem) ?? 0
    ordinals.set(stem, index + 1)
    identities.set(id, `${stem}:${index}`)
  }
  const groups = nodes.filter(node => node.isGroup === true)
  const groupIds = new Set(groups.map(node => text(node.id)))
  return projection({
    direction: direction(data.direction ?? reply.snapshot?.data.getDirection),
    states: byId(
      nodes
        .filter(node => node.isGroup !== true && node.shape !== 'note')
        .map(node => ({
          id: identities.get(text(node.id))!,
          parent: parentOf(node),
          label: ['state-start', 'state-end'].includes(stateKind(node)) ? '' : stateLabel(node.label),
          kind: stateKind(node),
          classes: classes(
            text(node.cssClasses)
              .split(/\s+/)
              .filter(name => name !== 'statediagram-state'),
          ),
        })),
    ),
    groups: byId(
      groups.map(group => ({
        id: text(group.id),
        parent: parentOf(group),
        label: stateLabel(group.label),
        members: nodes
          .filter(node => parentOf(node) === group.id && !groupIds.has(text(node.id)) && node.shape !== 'note')
          .map(node => identities.get(text(node.id))!)
          .sort(),
        direction: direction(group.dir),
      })),
    ),
    transitions: list(data.edges)
      .map(row)
      .filter(edge => identities.has(text(edge.start)) && identities.has(text(edge.end)))
      .map(edge => ({ from: identities.get(text(edge.start))!, to: identities.get(text(edge.end))!, label: stateLabel(edge.label) })),
  })
}

/** RESULT projections, not action traces. Map/group dictionaries are sorted;
 * relationship and transition order is retained. Defaults, empty optional text
 * and legacy aliases normalize explicitly. State notes/paint and default theme
 * metadata are outside the declared scope; native events still retain them.
 */
export function projectNativeGraphs(family: string, model: unknown): NativeSemanticProjection | undefined {
  if (family === 'state') return nativeState(model as MermaidGraph)
  if (family === 'flowchart') {
    const graph = model as MermaidGraph
    return projection({
      direction: direction(graph.direction),
      nodes: byId([...graph.nodes.values()].map(node => ({ id: node.id, label: node.label, shape: shape(node.semanticShape ?? node.shape), classes: classes(graph.classAssignments.get(node.id)) }))),
      groups: nativeGroups(graph.subgraphs).sort((a, b) => text(row(a).id).localeCompare(text(row(b).id))),
      edges: graph.edges.map(edge => ({ from: edge.source, to: edge.target, id: edge.id ?? '', label: edge.label ?? '', stroke: edge.style, startMarker: edge.hasArrowStart ? (edge.startMarker ?? 'arrow') : 'none', endMarker: edge.hasArrowEnd ? (edge.endMarker ?? 'arrow') : 'none', length: edge.length ?? 1 })),
    })
  }
  if (family === 'class') {
    const diagram = model as ClassDiagram
    return projection({
      direction: direction(diagram.direction),
      title: diagram.title ?? '',
      classes: byId(
        diagram.classes.map(node => ({
          id: node.id,
          label: node.label,
          annotations: node.annotation ? [node.annotation] : [],
          attributes: node.attributes.map(member => nativeMember(member, false)),
          methods: node.methods.map(member => nativeMember(member, true)),
          classes: classes(node.className),
          href: node.href ?? '',
          tooltip: node.tooltip ?? '',
        })),
      ),
      namespaces: nativeNamespaces(diagram.namespaces).sort((a, b) => text(row(a).id).localeCompare(text(row(b).id))),
      relationships: diagram.relationships.map(relation => ({
        from: relation.from,
        to: relation.to,
        label: relation.label ?? '',
        fromCardinality: relation.fromCardinality ?? '',
        toCardinality: relation.toCardinality ?? '',
        line: relation.lineStyle ?? ([relation.type, relation.fromType, relation.toType].some(kind => kind === 'dependency' || kind === 'realization' || kind === 'link-dashed') ? 'dashed' : 'solid'),
        startMarker: relation.markerAt === 'from' || relation.markerAt === 'both' ? marker(relation.fromType ?? relation.type) : 'none',
        endMarker: relation.markerAt === 'to' || relation.markerAt === 'both' ? marker(relation.toType ?? relation.type) : 'none',
      })),
      notes: diagram.notes.map(note => ({ for: note.for ?? '', text: note.text })),
    })
  }
  if (family === 'mindmap') {
    const diagram = model as MindmapDiagram
    const visit = (node: MindmapNode, parent = ''): Json => ({
      id: node.id,
      parent,
      label: node.label.replace(/<b>([\s\S]*?)<\/b>/gi, '**$1**').replace(/<i>([\s\S]*?)<\/i>/gi, '*$1*'),
      shape: node.shape,
      icon: node.icon ?? '',
      classes: classes(node.className),
      children: node.children.map(child => visit(child, node.id)),
    })
    return projection({ root: visit(diagram.root) })
  }
  return undefined
}

export function projectReferenceGraphs(family: string, reply: GrammarReferenceReply): NativeSemanticProjection | undefined {
  if (!reply.accepted || !reply.snapshot) return undefined
  const data = reply.snapshot.data
  if (family === 'state') return referenceState(reply)
  if (family === 'flowchart') {
    if (!Array.isArray(data.getVertices) || !Array.isArray(data.getEdges) || !Array.isArray(data.getSubGraphs)) return undefined
    const groups = list(data.getSubGraphs).map(row)
    return projection({
      direction: direction(data.getDirection),
      nodes: byId(keyed(data.getVertices).map(([id, node]) => ({ id, label: label(node.text), shape: shape(node.type), classes: classes(node.classes) }))),
      groups: byId(
        groups.map(group => ({
          id: text(group.id),
          parent: text(group.parent) || text(groups.find(candidate => list(candidate.nodes).includes(group.id))?.id),
          label: label(group.title),
          members: list(group.nodes)
            .map(text)
            .filter(id => !groups.some(candidate => candidate.id === id))
            .sort(),
          direction: group.dir ? direction(group.dir) : '',
        })),
      ),
      edges: list(data.getEdges)
        .map(row)
        .map(edge => {
          const type = text(edge.type),
            parts = type.replace(/^double_/, '').split('_'),
            double = type.startsWith('double_')
          const end = parts[1] === 'point' ? 'arrow' : parts[1] === 'circle' ? 'circle' : parts[1] === 'cross' ? 'cross' : 'none'
          const start = double ? end : parts.length > 2 ? (parts[0] ?? 'none') : 'none'
          return { from: text(edge.start), to: text(edge.end), id: edge.isUserDefinedId === true ? text(edge.id) : '', label: label(edge.text), stroke: edge.stroke === 'normal' ? 'solid' : text(edge.stroke) || 'solid', startMarker: start, endMarker: end, length: typeof edge.length === 'number' ? edge.length : 1 }
        }),
    })
  }
  if (family === 'class') {
    if (!Array.isArray(data.getClasses) || !Array.isArray(data.getRelations)) return undefined
    return projection({
      direction: direction(data.getDirection),
      title: text(data.getDiagramTitle),
      classes: byId(
        keyed(data.getClasses).map(([id, node]) => ({
          id,
          label: label(node.label),
          annotations: list(node.annotations).map(text),
          attributes: list(node.members).map(member => referenceMember(member, false)),
          methods: list(node.methods).map(member => referenceMember(member, true)),
          classes: classes(node.cssClasses),
          href: text(node.link),
          tooltip: text(node.tooltip),
        })),
      ),
      namespaces: byId(
        keyed(data.getNamespaces).map(([id, namespace]) => ({
          id,
          parent: text(namespace.parent),
          label: text(namespace.label) === id.split('.').at(-1) ? '' : text(namespace.label),
          members: keyed(namespace.classes)
            .map(([key]) => key)
            .sort(),
        })),
      ),
      relationships: list(data.getRelations)
        .map(row)
        .map(relation => ({
          from: text(relation.id1),
          to: text(relation.id2),
          label: label(relation.title),
          fromCardinality: relation.relationTitle1 === 'none' ? '' : text(relation.relationTitle1),
          toCardinality: relation.relationTitle2 === 'none' ? '' : text(relation.relationTitle2),
          line: row(relation.relation).lineType === 1 ? 'dashed' : 'solid',
          startMarker: referenceMarker(row(relation.relation).type1),
          endMarker: referenceMarker(row(relation.relation).type2),
        })),
      notes: list(data.getNotes)
        .map(row)
        .map(note => ({ for: text(note.class), text: label(note.text) })),
    })
  }
  if (family === 'mindmap') {
    const root = row(data.getMindmap)
    if (!root.nodeId) return undefined
    const visit = (node: Record<string, unknown>, parent = ''): Json => ({
      id: text(node.nodeId),
      parent,
      label: label(node.descr),
      shape: ({ 0: 'default', 1: 'rounded', 2: 'rect', 3: 'circle', 4: 'cloud', 5: 'bang', 6: 'hexagon' } as Record<string, string>)[String(node.type)] ?? `unknown:${node.type}`,
      icon: text(node.icon),
      classes: classes(node.class),
      children: list(node.children).map(child => visit(row(child), text(node.nodeId))),
    })
    return projection({ root: visit(root) })
  }
  return undefined
}
