import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { assertBenchmarkExecutionAllowed } from '../ci-policy.ts'
import { assertBenchmarkToolVersion } from '../tool-versions.ts'
import type { MeaningEdge, MeaningGroup, MeaningJson, MeaningNode, NormalizedMeaning } from './meaning.ts'

export type MeaningTool = 'agentic' | 'pele' | 'mermaid'
export interface MeaningAcquisition { status: 'accepted' | 'rejected' | 'unsupported' | 'unavailable'; publicAccepted: boolean | null; family?: string; raw?: any; meaning?: NormalizedMeaning; error?: string; errorName?: string; errorCode?: string; scope: string }
export interface MeaningAdapter { tool: MeaningTool; version: string; entry: string; acquireRaw: (source: string, family: string) => Promise<MeaningAcquisition>; parse: (source: string, family: string) => Promise<MeaningAcquisition>; serialize?: (source: string) => Promise<string> }
const entries = (value: any): [string, any][] => value instanceof Map ? [...value.entries()] : Array.isArray(value) ? value.map((item, i) => [String(item.id ?? item.name ?? i), item]) : value && typeof value === 'object' ? Object.entries(value) : []
const array = (value: any): any[] => Array.isArray(value) ? value : entries(value).map(([, item]) => item)
const text = (value: any): string => String(value?.text ?? value ?? '').normalize('NFC').replace(/\s+/g, ' ').trim()
const node = (id: any, label: any = id): MeaningNode => ({ id: String(id), label: text(label) })
const edge = (source: any, target: any, directed: boolean, label: any = ''): MeaningEdge => ({ source: String(source), target: String(target), directed, label: text(label) })
const sortById = <T extends { id: string }>(values: T[]) => [...values].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
const sorted = (values: any[]) => [...values].sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0)
const json = (value: any): MeaningJson => JSON.parse(JSON.stringify(value, (_key, item) => item instanceof Map ? Object.fromEntries(item) : item instanceof Set ? [...item] : item))
function value(db: any, name: string): any { if (typeof db?.[name] !== 'function') throw Error(`Public returned database has no ${name} getter`); return db[name]() }

/** Read only actual public parser returns or a DB returned by public getDiagramFromText. */
function publicModel(tool: MeaningTool, family: string, raw: any): any {
  if (tool !== 'mermaid') return raw
  const common = () => ({ title: typeof raw.getDiagramTitle === 'function' ? raw.getDiagramTitle() : typeof raw.getCommonDb === 'function' ? raw.getCommonDb().getDiagramTitle() : '' })
  switch (family) {
    case 'flowchart': return { ...common(), nodes: value(raw, 'getVertices'), edges: value(raw, 'getEdges'), subgraphs: value(raw, 'getSubGraphs'), direction: value(raw, 'getDirection') }
    case 'sequence': return { ...common(), actors: value(raw, 'getActors'), messages: value(raw, 'getMessages'), boxes: value(raw, 'getBoxes') }
    case 'class': return { ...common(), classes: value(raw, 'getClasses'), relations: value(raw, 'getRelations'), notes: value(raw, 'getNotes'), namespaces: value(raw, 'getNamespaces') }
    case 'state': return { ...common(), graph: value(raw, 'getData') }
    case 'er': return { ...common(), entities: value(raw, 'getEntities'), relationships: value(raw, 'getRelationships'), subgraphs: value(raw, 'getSubGraphs') }
    case 'journey': return { ...common(), tasks: value(raw, 'getTasks'), sections: value(raw, 'getSections') }
    case 'gantt': return { ...common(), tasks: value(raw, 'getTasks'), sections: value(raw, 'getSections'), dateFormat: value(raw, 'getDateFormat'), excludes: value(raw, 'getExcludes') }
    case 'pie': return { ...common(), sections: value(raw, 'getSections'), showData: value(raw, 'getShowData') }
    case 'quadrant': return { ...common(), draw: value(raw, 'getQuadrantData') }
    case 'requirement': return { ...common(), requirements: value(raw, 'getRequirements'), elements: value(raw, 'getElements'), relations: value(raw, 'getRelationships') }
    case 'gitgraph': return { ...common(), commits: value(raw, 'getCommits'), branches: value(raw, 'getBranches'), direction: value(raw, 'getDirection') }
    case 'mindmap': return { ...common(), root: value(raw, 'getMindmap') }
    case 'timeline': return { ...common(), periods: value(raw, 'getTasks'), sections: value(raw, 'getSections') }
    case 'sankey': return { ...common(), ...value(raw, 'getGraph') }
    case 'xychart': return { ...value(raw, 'getXYChartData'), ...common() }
    case 'block': return { ...common(), root: array(value(raw, 'getBlocksFlat')).find(item => item.id === 'root'), edges: value(raw, 'getEdges') }
    case 'packet': return { ...common(), rows: value(raw, 'getPacket') }
    case 'kanban': return { ...common(), layout: value(raw, 'getData') }
    case 'architecture': return { ...common(), nodes: value(raw, 'getServices'), junctions: value(raw, 'getJunctions'), groups: value(raw, 'getGroups'), edges: value(raw, 'getEdges') }
    case 'radar': return { ...common(), axes: value(raw, 'getAxes'), curves: value(raw, 'getCurves'), options: value(raw, 'getOptions') }
    case 'treemap': return { ...common(), roots: value(raw, 'getRoot').children }
    case 'ishikawa': return { ...common(), root: value(raw, 'getRoot') }
    case 'c4': return { title: value(raw, 'getTitle'), shapes: value(raw, 'getC4ShapeArray'), boundaries: value(raw, 'getBoundaries'), rels: value(raw, 'getRels') }
    case 'eventmodeling': return { ...common(), ...value(raw, 'getState') }
    default: throw Error(`No reviewed public-model projection for ${family}`)
  }
}

function hierarchy(root: any, children: (node: any) => any[], identify: (node: any, parent: string) => MeaningNode, includeRoot = true) {
  const nodes: MeaningNode[] = [], edges: MeaningEdge[] = [], groups: MeaningGroup[] = []
  const visit = (item: any, parent: string, seen: Set<any>) => {
    if (!item || seen.has(item)) throw Error('Public hierarchy contains a cycle or a missing node')
    const next = new Set(seen); next.add(item)
    const current = identify(item, parent); nodes.push(current)
    const descendants = children(item)
    if (descendants.length) groups.push({ id: current.id, label: current.label, members: descendants.map(child => identify(child, current.id).id) })
    if (parent) edges.push(edge(parent, current.id, true))
    for (const child of descendants) visit(child, current.id, next)
  }
  if (includeRoot) visit(root, '', new Set())
  else for (const item of children(root)) visit(item, '', new Set())
  return { nodes, edges, groups }
}
const arrow = (type: any) => !['none', 'arrow_open', 'open', undefined, null, ''].includes(type)
const card: Record<string, string> = { ONLY_ONE: 'one-only', ZERO_OR_ONE: 'zero-or-one', ONE_OR_MORE: 'one-or-many', ZERO_OR_MORE: 'zero-or-many', MD_PARENT: 'md-parent' }
const familyName = (name: string) => ({ 'flowchart-v2': 'flowchart', 'flowchart-elk': 'flowchart', classDiagram: 'class', stateDiagram: 'state', 'stateDiagram-v2': 'state', quadrantChart: 'quadrant', gitGraph: 'gitgraph', 'block-beta': 'block', 'architecture-beta': 'architecture', 'sankey-beta': 'sankey', 'xychart-beta': 'xychart', 'radar-beta': 'radar' } as Record<string, string>)[name] ?? name
export function classifyMeaningFailure(tool: MeaningTool, error: any, PeleError?: any): MeaningAcquisition {
  const receipt = { publicAccepted: null, error: String(error), errorName: String(error?.name ?? 'Error'), ...(typeof error?.code === 'string' ? { errorCode: error.code } : {}) }
  if (error instanceof TypeError || error instanceof ReferenceError || error instanceof RangeError || /^(?:AbortError|TimeoutError)$/.test(receipt.errorName)) return { ...receipt, status: 'unavailable', scope: 'Infrastructure/public API exception is not a source-rejection verdict' }
  if (tool === 'pele' && typeof PeleError === 'function' && error instanceof PeleError) {
    if (['syntax', 'semantic'].includes(error.code)) return { ...receipt, publicAccepted: false, status: 'rejected', scope: 'Actual public typed syntax/semantic rejection' }
    if (error.code === 'unsupported-diagram') return { ...receipt, publicAccepted: false, status: 'unsupported', scope: 'Actual public unsupported-diagram verdict, not a grammar pass' }
  }
  if (tool === 'mermaid') {
    if (receipt.errorName === 'UnknownDiagramError' && /^No diagram type detected matching given configuration for text:/.test(error?.message ?? '')) return { ...receipt, publicAccepted: false, status: 'unsupported', scope: 'Actual public unknown-diagram detection, not a grammar pass' }
    if (/^(?:Parse error on line|Lexical error on line|Parsing failed:)/.test(error?.message ?? '')) return { ...receipt, publicAccepted: false, status: 'rejected', scope: 'Reviewed public grammar rejection signature' }
    if (/^"[^"\n]+" has invalid value: -\d+(?:\.\d+)?\. Negative values are not allowed in pie charts\. All slice values must be >= 0\.$/.test(error?.message ?? '')) return { ...receipt, publicAccepted: false, status: 'rejected', scope: 'Pinned pieDb negative-slice domain validator, not a generic backend exception' }
  }
  return { ...receipt, status: 'unavailable', scope: 'Unclassified backend/driver/domain exception; source rejection is not established' }
}

export function normalizeMeaning(tool: MeaningTool, family: string, raw: any): NormalizedMeaning {
  const out: NormalizedMeaning = { family, facts: {}, unavailable: {} }
  const m = publicModel(tool, family, raw), am = tool === 'agentic'
  const fact = (key: string, observed: any) => { if (observed === undefined) out.unavailable['fact:' + key] = 'Public model does not expose this reviewed field'; else out.facts[key] = json(observed) }
  if (m.title !== undefined) fact('title', text(m.title))
  switch (family) {
    case 'flowchart': {
      const graph = am ? m.graph : m
      out.nodes = entries(graph.nodes).map(([id, item]) => node(id, item.label ?? item.text ?? id))
      out.edges = array(graph.edges).map(item => ({ ...edge(item.source ?? item.start, item.target ?? item.end, am ? !!item.hasArrowEnd : item.type !== 'arrow_open', item.label ?? item.text), startMarker: am ? item.hasArrowStart ? item.startMarker ?? 'arrow' : 'none' : item.type?.startsWith('double_') ? 'arrow' : 'none', endMarker: am ? item.hasArrowEnd ? item.endMarker ?? 'arrow' : 'none' : item.type === 'arrow_open' ? 'none' : 'arrow' }))
      out.groups = []
      const visitGroup = (group: any) => { const children = am ? array(group.children) : []; out.groups!.push({ id: group.id, label: text(group.label ?? group.title ?? group.id), members: am ? [...array(group.nodeIds ?? group.nodes), ...children.map(child => child.id)].map(String) : array(group.nodes).map(String) }); children.forEach(visitGroup) }
      array(graph.subgraphs).forEach(visitGroup)
      fact('direction', graph.direction)
      fact('image-requests', entries(graph.nodes).filter(([, item]) => item.image ?? item.img ?? item.props?.img).map(([id, item]) => ({ id, href: item.image ?? item.img ?? item.props?.img })))
      break
    }
    case 'sequence': {
      out.nodes = am ? array(m.participants).map(item => node(item.id, item.label)) : entries(m.actors).map(([id, item]) => node(id, item.description ?? item.name))
      const messages = am ? array(m.statements).length ? array(m.statements).flatMap(statement => statement.kind === 'message' ? [m.messages[statement.ref]] : statement.kind === 'fragment' ? array(statement.fragment.branches).flatMap(branch => array(branch.messages)) : []) : array(m.messages) : array(m.messages).filter(item => item.from !== undefined && item.to !== undefined && [0, 1, 3, 4, 5, 6, 24, 25, 26, 33, 34, 35, 36, 37, 38].includes(item.type))
      out.edges = messages.map(item => edge(item.from, item.to, true, item.text ?? item.message))
      fact('message-order', messages.map(item => ({ from: item.from, to: item.to, text: text(item.text ?? item.message) })))
      fact('message-style', messages.map(item => am ? String(item.arrow ?? (item.style === 'reply' ? '-->>' : '->>')) : ({ 0: '->>', 1: '-->>', 3: '->', 4: '-->', 5: '-x', 6: '--x' } as Record<number, string>)[item.type] ?? `type:${item.type}`))
      if (am) {
        if (array(m.statements).some(item => item.kind === 'opaque-block' && array(item.lines).some(line => /^\s*note\s/i.test(line)))) out.unavailable['fact:notes'] = 'Notes remain source-preserved rather than native note objects; paint correspondence must supply their actor ownership evidence'
        else fact('notes', array(m.statements).filter(item => item.kind === 'note').map(item => ({ text: text(item.text), actors: array(item.actors) })))
        fact('fragments', array(m.statements).filter(item => item.kind === 'fragment').map(item => ({ kind: item.fragment.fragmentKind, label: text(item.fragment.label) })))
      } else {
        fact('notes', array(m.messages).filter(item => item.type === 2).map(item => ({ text: text(item.message), actors: [...new Set([item.from, item.to].flat().filter(Boolean))] })))
        fact('fragments', array(m.messages).filter(item => [10, 12, 14, 16, 19, 22, 28, 31].includes(item.type)).map(item => ({ kind: ({ 10: 'loop', 12: 'opt', 14: 'alt', 16: 'par', 19: 'rect', 22: 'critical', 28: 'break', 31: 'parallel' } as Record<number, string>)[item.type], label: text(item.message) })))
      }
      break
    }
    case 'class': {
      out.nodes = entries(m.classes).map(([id, item]) => node(id, item.label || id))
      const markerKind = (kind: string) => ({ inheritance: 'triangle', realization: 'triangle', composition: 'diamond', aggregation: 'open-diamond', association: 'arrow', dependency: 'arrow', lollipop: 'circle' } as Record<string, string>)[kind] ?? 'none'
      const markerType = (kind: any) => ({ 0: 'open-diamond', 1: 'triangle', 2: 'diamond', 3: 'arrow', 4: 'circle' } as Record<string, string>)[kind] ?? 'none'
      out.edges = array(m.relations).map(item => {
        const startMarker = am ? ['from', 'both'].includes(item.markerAt ?? 'to') ? markerKind(item.fromKind ?? item.kind) : 'none' : markerType(item.relation?.type1)
        const endMarker = am ? ['to', 'both'].includes(item.markerAt ?? 'to') ? markerKind(item.toKind ?? item.kind) : 'none' : markerType(item.relation?.type2)
        return { ...edge(item.from ?? item.id1, item.to ?? item.id2, [startMarker, endMarker].some(marker => ['arrow', 'triangle'].includes(marker)), item.label ?? item.title), startMarker, endMarker }
      })
      const memberText = (member: any) => text(member.displayText ?? member.getDisplayDetails?.()?.displayText ?? member.text ?? member).replace(/\)\s*:\s*/, ') ')
      fact('members', sortById(entries(m.classes).map(([id, item]) => ({ id, values: am ? array(item.members).map(text) : [...array(item.members), ...array(item.methods)].map(memberText) }))))
      fact('notes', sorted(entries(m.notes).map(([, item]) => ({ target: String(item.classId ?? item.class ?? item.for ?? ''), text: text(item.text) }))))
      fact('cardinalities', array(m.relations).map(item => ({ from: item.from ?? item.id1, to: item.to ?? item.id2, left: text(item.fromCardinality ?? (item.relationTitle1 === 'none' ? '' : item.relationTitle1)), right: text(item.toCardinality ?? (item.relationTitle2 === 'none' ? '' : item.relationTitle2)) })))
      if (am) out.groups = [...new Set(array(m.classes).map(item => item.namespace).filter(Boolean))].map(id => ({ id, label: id, members: array(m.classes).filter(item => item.namespace === id).map(item => item.id) }))
      else out.groups = entries(m.namespaces).map(([id, item]) => ({ id, label: text(item.name ?? id), members: array(item.classes).map(member => typeof member === 'string' ? member : member.id) }))
      break
    }
    case 'state': {
      if (am) {
        const pseudos: any[] = []
        out.nodes = []; out.groups = []; out.edges = []
        const endpoint = (id: string, kind: 'start' | 'end', scope: string) => { if (id !== '[*]') return id; const canonical = `[${kind}:${scope}]`; if (!pseudos.some(item => item.id === canonical)) { pseudos.push({ id: canonical, kind, scope }); out.nodes!.push(node(canonical, '')) } return canonical }
        const transitions = (items: any[], scope: string) => out.edges!.push(...items.map(item => edge(endpoint(item.from, 'start', scope), endpoint(item.to, 'end', scope), true, item.label)))
        const walk = (states: any[]) => { for (const item of states) { out.nodes!.push(node(item.id, item.label ?? item.id)); const children = array(item.states); if (children.length) { out.groups!.push({ id: item.id, label: text(item.label ?? item.id), members: children.map(child => child.id) }); walk(children) } transitions(array(item.transitions), item.id) } }
        transitions(array(m.transitions), 'root'); walk(array(m.states)); fact('pseudostates', sorted(pseudos))
      } else {
        const graph = m.graph
        const aliases = new Map(array(graph.nodes).map(item => [item.id, item.shape === 'stateStart' ? `[start:${item.parentId ?? 'root'}]` : item.shape === 'stateEnd' ? `[end:${item.parentId ?? 'root'}]` : item.id]))
        out.nodes = array(graph.nodes).map(item => node(aliases.get(item.id), ['stateStart', 'stateEnd'].includes(item.shape) ? '' : item.label || item.id))
        out.edges = array(graph.edges).map(item => edge(aliases.get(item.start), aliases.get(item.end), true, item.label))
        out.groups = array(graph.nodes).filter(item => item.isGroup).map(item => ({ id: item.id, label: text(item.label || item.id), members: array(graph.nodes).filter(child => child.parentId === item.id).map(child => child.id) }))
        fact('pseudostates', sorted(array(graph.nodes).filter(item => ['stateStart', 'stateEnd'].includes(item.shape)).map(item => ({ id: aliases.get(item.id), kind: item.shape === 'stateStart' ? 'start' : 'end', scope: item.parentId ?? 'root' }))))
      }
      break
    }
    case 'er': {
      const entities = entries(m.entities), ids = new Map(entities.map(([id, item]) => [item.id, id]))
      out.nodes = entities.map(([id, item]) => node(id, item.alias || item.label || id))
      const relations = am ? array(m.relations) : array(m.relationships)
      out.edges = relations.map(item => edge(item.from ?? ids.get(item.entityA), item.to ?? ids.get(item.entityB), false, item.label ?? item.roleA))
      fact('attributes', sortById(entities.map(([id, item]) => ({ id, values: array(item.attributes).map(attribute => {
        if (am) { const match = /^(\S+)\s+(\S+)(?:\s+(PK|FK|UK)(?:\s*,\s*(PK|FK|UK))*)?(?:\s+"[^"]*")?$/.exec(text(attribute.text)); if (!match) throw Error('Public ER attribute text is outside the reviewed field projection'); return { name: match[2], type: match[1], keys: match.slice(3).filter(Boolean) } }
        return { name: attribute.name ?? attribute.attributeName, type: attribute.type ?? attribute.attributeType, keys: array(attribute.keys ?? attribute.attributeKey) }
      }) }))))
      fact('cardinalities', relations.map(item => ({ from: item.from ?? ids.get(item.entityA), to: item.to ?? ids.get(item.entityB), left: item.leftCard ?? card[item.relSpec?.cardB], right: item.rightCard ?? card[item.relSpec?.cardA], identifying: am ? !item.dashed : item.relSpec?.relType === 'IDENTIFYING' })))
      break
    }
    case 'journey': {
      const tasks = am ? array(m.sections).flatMap(section => array(section.tasks).map(task => ({ section: text(section.label), label: text(task.text), score: task.score, actors: task.actors }))) : array(m.tasks).map(task => ({ section: text(task.section), label: text(task.task), score: task.score, actors: task.people }))
      fact('tasks', tasks); out.nodes = tasks.map((task, index) => node(`task:${index}`, task.label)); break
    }
    case 'gantt': {
      const tasks = am ? array(m.sections).flatMap(section => array(section.tasks).map(task => ({ id: task.taskId ?? task.id, label: text(task.label), section: text(section.label), start: text(task.start), end: text(task.end), tags: [...array(task.tags)].sort() }))) : array(m.tasks).map(task => ({ id: task.id, label: text(task.task), section: text(task.section), start: text(task.raw?.start ?? task.raw?.startTime?.startData), end: text(task.raw?.end ?? task.raw?.endTime?.data), tags: ['active', 'crit', 'done', 'milestone'].filter(tag => task[tag]).sort() }))
      fact('tasks', tasks); out.nodes = tasks.map(task => node(task.id, task.label)); break
    }
    case 'pie': {
      const slices = am ? array(m.slices).map(item => ({ label: text(item.label), value: item.value })) : entries(m.sections).map(([label, amount]) => ({ label: text(label), value: amount }))
      fact('slices', slices); fact('show-data', !!m.showData); out.nodes = slices.map(item => node(item.label)); break
    }
    case 'quadrant': {
      if (tool === 'mermaid') {
        const boxes = array(m.draw.quadrants), left = Math.min(...boxes.map(box => box.x)), top = Math.min(...boxes.map(box => box.y)), right = Math.max(...boxes.map(box => box.x + box.width)), bottom = Math.max(...boxes.map(box => box.y + box.height))
        fact('points', sorted(array(m.draw.points).map(item => ({ label: text(item.text?.text), x: Number(((item.x - left) / (right - left)).toFixed(10)), y: Number((1 - (item.y - top) / (bottom - top)).toFixed(10)) }))))
        fact('axis-labels', array(m.draw.axisLabels).map(item => text(item.text)))
      } else { fact('points', sorted(array(m.points).map(item => ({ label: text(item.label ?? item.text), x: item.x, y: item.y })))); fact('axis-labels', am ? [m.xAxis?.near, m.xAxis?.far, m.yAxis?.near, m.yAxis?.far].map(text) : [m.xAxisLeft, m.xAxisRight, m.yAxisBottom, m.yAxisTop].map(text)) }
      out.nodes = array(out.facts.points).map(item => node(item.label)); break
    }
    case 'requirement': {
      const requirements = entries(m.requirements), elements = entries(m.elements)
      out.nodes = [...requirements, ...elements].map(([id, item]) => node(item.name ?? id))
      out.edges = array(m.relations).map(item => edge(item.src, item.dst, true, item.type))
      fact('requirements', sorted(requirements.map(([id, item]) => ({ name: item.name ?? id, type: text(item.type).replace(/\s/g, '').toLowerCase(), id: item.requirementId, text: text(item.text), risk: String(item.risk).toLowerCase(), verify: String(item.verifyMethod).toLowerCase() }))))
      fact('elements', sorted(elements.map(([id, item]) => ({ name: item.name ?? id, type: text(item.type), docRef: text(item.docRef) })))); break
    }
    case 'gitgraph': {
      const commits = entries(m.commits).map(([id, item]) => ({ id: item.id ?? id, parents: array(item.parents), branch: item.branch, tags: array(item.tags), sequence: item.sequence ?? item.seq }))
      out.nodes = commits.map(item => node(item.id)); out.edges = commits.flatMap(item => item.parents.map(parent => edge(parent, item.id, true)))
      fact('commits', commits.sort((a, b) => a.sequence - b.sequence).map(({ sequence: _sequence, ...item }) => item)); fact('branches', (am ? array(m.branches).map(item => item.name) : entries(m.branches).map(([id]) => id)).sort()); break
    }
    case 'mindmap': {
      const root = am ? m.root : tool === 'pele' ? array(m.nodes)[0] : m.root
      Object.assign(out, hierarchy(root, item => array(item.children), item => node(item.nodeId ?? item.id, item.label ?? item.descr))); fact('tree-order', out.nodes!.map(item => item.id)); break
    }
    case 'timeline': {
      const periods = am ? array(m.sections).flatMap(section => array(section.periods).map(item => ({ section: text(section.label), label: text(item.label), events: array(item.events).map(event => text(event.text)) }))) : array(m.periods).map(item => ({ section: text(item.section), label: text(item.task ?? item.text), events: array(item.events).map(text) }))
      fact('periods', periods); out.nodes = periods.map((item, i) => node(`period:${i}`, item.label)); break
    }
    case 'sankey': {
      const links = array(m.links).map(item => ({ source: typeof item.source === 'string' ? item.source : item.source.id ?? item.source.ID, target: typeof item.target === 'string' ? item.target : item.target.id ?? item.target.ID, value: item.value }))
      out.nodes = [...new Set(links.flatMap(item => [item.source, item.target]))].map(id => node(id)); out.edges = links.map(item => edge(item.source, item.target, true)); fact('links', links); break
    }
    case 'xychart': {
      const series = am ? array(m.series).map(item => ({ kind: item.kind, values: item.values })) : array(m.plots).map(item => ({ kind: item.type, values: array(item.data).map(point => point[1]) }))
      fact('series', series); fact('x-categories', m.xAxis?.categories); fact('y-range', am ? [m.yAxis?.range?.min, m.yAxis?.range?.max] : [m.yAxis?.min, m.yAxis?.max]); out.nodes = array(m.xAxis?.categories).map(label => node(label)); break
    }
    case 'block': {
      const root = Array.isArray(m.root) ? m.root[0] : m.root
      const tree = hierarchy(root, item => array(item.children), item => node(item.id, item.label ?? item.id), false)
      out.nodes = tree.nodes; out.groups = tree.groups; out.edges = array(m.edges).map(item => edge(item.start, item.end, arrow(item.arrowTypeEnd), item.label)); fact('columns', root?.columns)
      const spans: any[] = []; const collect = (item: any) => { if (item.id !== 'root') spans.push({ id: item.id, columns: item.widthInColumns }); array(item.children).forEach(collect) }; collect(root); fact('spans', sortById(spans)); break
    }
    case 'packet': {
      const fields = am ? array(m.fields) : array(m.rows).flat()
      fact('fields', fields.map(item => ({ label: text(item.label), start: item.start, end: item.end }))); out.nodes = fields.map(item => node(`field:${item.start}:${item.end}`, item.label)); break
    }
    case 'kanban': {
      if (tool === 'mermaid') {
        const nodes = array(m.layout.nodes); out.nodes = nodes.filter(item => !item.isGroup).map(item => node(item.id, item.label)); out.groups = nodes.filter(item => item.isGroup).map(item => ({ id: item.id, label: text(item.label), members: nodes.filter(child => child.parentId === item.id).map(child => child.id) }));
        fact('metadata', nodes.filter(item => !item.isGroup).map(item => ({ id: item.id, assigned: text(item.assigned), priority: text(item.priority), ticket: text(item.ticket) })))
      } else {
        const columns = am ? array(m.columns) : array(m.sections)
        out.nodes = columns.flatMap(column => array(column.tasks ?? column.items).map(item => node(item.sourceId ?? item.id, item.label))); out.groups = columns.map(column => ({ id: column.sourceId ?? column.id, label: text(column.label), members: array(column.tasks ?? column.items).map(item => item.sourceId ?? item.id) }))
        fact('metadata', columns.flatMap(column => array(column.tasks ?? column.items).map(item => ({ id: item.sourceId ?? item.id, assigned: text(item.metadata?.assigned ?? item.assigned), priority: text(item.metadata?.priority ?? item.priority), ticket: text(item.metadata?.ticket ?? item.ticket) }))))
      }
      break
    }
    case 'architecture': {
      const services = am ? array(m.services) : array(m.nodes)
      out.nodes = [...services, ...array(m.junctions)].map(item => node(item.id, item.label ?? item.title ?? item.id))
      out.edges = array(m.edges).map(item => edge(am ? item.source.id : item.lhsId, am ? item.target.id : item.rhsId, am ? !!item.hasArrowEnd : !!item.rhsInto))
      out.groups = entries(m.groups).map(([id, group]) => ({ id: group.id ?? id, label: text(group.label ?? group.title), members: services.filter(item => (item.parentId ?? item.in) === (group.id ?? id)).map(item => item.id) }))
      fact('icons', sortById(services.map(item => ({ id: item.id, icon: item.icon }))))
      fact('ports', array(m.edges).map(item => ({ from: am ? item.source.id : item.lhsId, to: am ? item.target.id : item.rhsId, fromSide: am ? item.source.side : item.lhsDir, toSide: am ? item.target.side : item.rhsDir }))); break
    }
    case 'radar': {
      fact('axes', array(m.axes).map(item => ({ id: item.id ?? item.name, label: text(item.label) }))); fact('curves', array(m.curves).map(item => ({ id: item.id ?? item.name, label: text(item.label), values: item.values ?? item.entries }))); fact('range', am ? [m.min, m.max] : [m.options.min, m.options.max]); out.nodes = array(m.axes).map(item => node(item.id ?? item.name, item.label)); break
    }
    case 'treemap':
    case 'ishikawa': {
      if (am) {
        const all = array(m.nodes), byId = new Map(all.map(item => [item.id, item]))
        const identify = (item: any): string => item.parentId ? identify(byId.get(item.parentId)) + '/' + text(item.label) : text(item.label)
        out.nodes = all.map(item => node(identify(item), item.label)); out.edges = all.filter(item => item.parentId).map(item => edge(identify(byId.get(item.parentId)), identify(item), true)); out.groups = all.filter(item => all.some(child => child.parentId === item.id)).map(item => ({ id: identify(item), label: text(item.label), members: all.filter(child => child.parentId === item.id).map(identify) })); if (family === 'treemap') fact('values', sorted(all.filter(item => item.value !== undefined).map(item => ({ id: identify(item), value: item.value }))))
      } else {
        const roots = family === 'treemap' ? array(m.roots) : [m.root], nodes: MeaningNode[] = [], edges: MeaningEdge[] = [], groups: MeaningGroup[] = [], values: any[] = []
        for (const root of roots) {
          const tree = hierarchy(root, item => array(item.children), (item, parent) => node((parent ? parent + '/' : '') + text(item.name ?? item.text), item.name ?? item.text)); nodes.push(...tree.nodes); edges.push(...tree.edges); groups.push(...tree.groups)
          const walk = (item: any, parent: string) => { const id = (parent ? parent + '/' : '') + text(item.name ?? item.text); if (item.value !== undefined) values.push({ id, value: item.value }); array(item.children).forEach(child => walk(child, id)) }; walk(root, '')
        }
        out.nodes = nodes; out.edges = edges; out.groups = groups; if (family === 'treemap') fact('values', sorted(values))
      }
      break
    }
    case 'c4': {
      const elements = am ? array(m.elements) : array(m.shapes)
      out.nodes = elements.map(item => node(item.id ?? item.alias, item.label)); out.edges = (am ? array(m.relationships) : array(m.rels)).map(item => edge(item.from, item.to, true, item.label)); fact('descriptions', elements.map(item => ({ id: item.id ?? item.alias, text: text(item.description ?? item.descr) }))); break
    }
    case 'eventmodeling': {
      const boxes = array(m.boxes)
      const frameId = (item: any) => item.frame?.name ?? item.id
      const frameLabel = (item: any) => item.frame?.entityIdentifier?.split('.').at(-1) ?? item.name ?? item.entity
      out.nodes = boxes.map(item => node(frameId(item), frameLabel(item)))
      out.edges = array(m.relations).map(item => edge(item.sourceBox ? frameId(item.sourceBox) : item.source?.id ?? item.source, item.targetBox ? frameId(item.targetBox) : item.target?.id ?? item.target, true))
      fact('frame-order', boxes.map(item => text(frameLabel(item))))
      break
    }
    default: out.unavailable.identities = `No reviewed public projection for ${family}`
  }
  return out
}

export async function createMeaningAdapter(options: { tool: MeaningTool; packageRoot: string; referenceRoot?: string }): Promise<MeaningAdapter> {
  assertBenchmarkExecutionAllowed()
  const tool = options.tool, root = resolve(options.packageRoot), require = createRequire(join(options.referenceRoot ?? root, 'package.json'))
  const entry = tool === 'mermaid' ? require.resolve('mermaid') : resolve(root, tool === 'agentic' ? 'dist/agent-core.js' : 'dist/pele.js')
  const manifest = JSON.parse(readFileSync(tool === 'mermaid' ? require.resolve('mermaid/package.json') : join(root, 'package.json'), 'utf8'))
  const expectedName = tool === 'agentic' ? 'agentic-mermaid' : tool === 'pele' ? 'pele' : 'mermaid'
  if (manifest.name !== expectedName) throw Error(`Public semantic adapter expected ${expectedName}, found ${manifest.name}`)
  const project = tool === 'agentic' ? 'adewale/agentic-mermaid' : tool === 'pele' ? 'obsidianmd/pele' : 'mermaid-js/mermaid'
  assertBenchmarkToolVersion(project, manifest.version, entry)
  if (tool === 'mermaid') {
    const { JSDOM } = require('jsdom'), dom = new JSDOM('<!doctype html><html><body></body></html>')
    for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'SVGElement', 'Element', 'Node', 'Option']) Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] })
  }
  const imported: any = await import(pathToFileURL(entry).href), api = tool === 'mermaid' ? imported.default : imported
  if (tool === 'mermaid') api.initialize({ startOnLoad: false, securityLevel: 'strict', logLevel: 'fatal' })
  const acquireRaw = async (source: string, _family: string): Promise<MeaningAcquisition> => {
    let raw: any, actualFamily: string
    try {
      if (tool === 'mermaid') { const diagram = await api.mermaidAPI.getDiagramFromText(source); raw = diagram.db; actualFamily = familyName(diagram.type) }
      else if (tool === 'agentic') {
        const result = await api.parseRegisteredMermaid(source)
        if (!result.ok) {
          const errors = array(result.error), grammar = errors.length > 0 && errors.every(item => /(?:PARSE_ERROR|PARSE_FAILED|SYNTAX_ERROR|INVALID_FRONTMATTER)$/.test(item.code ?? ''))
          return { status: grammar ? 'rejected' : 'unavailable', publicAccepted: grammar ? false : null, error: JSON.stringify(result.error), errorName: 'PublicParseErrorResult', errorCode: errors.map(item => item.code).join(','), scope: grammar ? 'Actual reviewed public grammar error result; no positive semantic credit' : 'Public policy/resource/unknown error result does not establish grammar rejection' }
        }
        if (['preserved', 'opaque'].includes(result.value.body.kind)) return { status: 'unsupported', publicAccepted: true, raw: result.value.body, scope: 'Opaque source preservation is not native semantic support or public rejection' }
        raw = result.value.body
        actualFamily = familyName(raw.kind)
      } else { raw = await api.parse(source); actualFamily = familyName(raw.mermaidType ?? raw.type) }
    } catch (error: any) { return classifyMeaningFailure(tool, error, api.PeleError) }
    return { status: 'accepted', publicAccepted: true, raw, family: actualFamily, scope: 'Actual public parser return/getDiagramFromText DB; no projection getter or normalization has executed' }
  }
  const parse = async (source: string, family: string): Promise<MeaningAcquisition> => {
    const acquired = await acquireRaw(source, family)
    if (acquired.status !== 'accepted') return acquired
    const actualFamily = acquired.family!
    try { return { ...acquired, meaning: normalizeMeaning(tool, actualFamily, acquired.raw), scope: 'Canonical projection of actual public parser return/getDiagramFromText DB; authored expectations are independent' } }
    catch (error) { return { ...acquired, meaning: { family: actualFamily, facts: {}, unavailable: { projection: String(error) } }, error: String(error), scope: 'Public parse accepted; reviewed semantic projection unavailable, no semantic pass' } }
  }
  const adapter: MeaningAdapter = { tool, version: manifest.version, entry, acquireRaw, parse }
  if (tool === 'agentic' && typeof api.serializeMermaid === 'function') adapter.serialize = async source => { const parsed = await api.parseRegisteredMermaid(source); if (!parsed.ok) throw Error('Cannot serialize a rejected source'); const result = await api.serializeMermaid(parsed.value); if (typeof result !== 'string') throw Error('Public serializer did not return Mermaid text'); return result }
  return adapter
}
