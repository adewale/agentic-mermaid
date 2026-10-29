import { projectNativeEventModelingOperations, projectReferenceEventModelingOperations } from './grammar-native-eventmodeling.ts'
import { normalizeBrTags } from '../../src/multiline-utils.ts'
import type { ParserObservation } from '../../src/shared/parser-observation.ts'
import { projectNativeC4Operations, projectReferenceC4Operations } from './grammar-native-c4.ts'
import { projectNativeStableOperations, projectReferenceStableOperations } from './grammar-native-stable.ts'
import { REFERENCE_SEQUENCE_SIGNALS as SIGNALS } from './grammar-sequence-kinds.ts'
import type { GrammarReferenceReply } from './grammar-types.ts'
import type { Json } from './reference.ts'

export interface NativeOperationProjection {
  scope: readonly string[]
  operations: Json[]
  sourceEvents: number
  selectedSourceEvents: number
  unmapped: Record<string, number>
  unmappedOperands: Record<string, number>
}

const SCOPES: Readonly<Record<string, readonly string[]>> = {
  flowchart: ['ordered links: endpoints, authored ID, labels, shaft and both markers', 'ordered individual class appends; node/group construction omitted'],
  state: ['ordered group open/close and transitions: scoped pseudostates, endpoints and labels; batch document operands expanded'],
  sequence: ['ordered messages: endpoints, labels, shaft, both markers, central connections', 'ordered explicit/inline activations; apply batch operands expanded; participants/notes/blocks omitted'],
  class: ['ordered relationships: endpoints, both markers, shaft, cardinalities and labels; class/member construction omitted'],
  er: ['ordered relationships: logical endpoints, cardinalities, labels and identifying status; entity construction omitted'],
  architecture: ['ordered group/service/junction declarations including parents', 'ordered edges including logical endpoints, boundaries, sides, labels and both markers'],
  gantt: ['ordered named sections and task labels; schedule expressions, generated IDs and derived dates omitted'],
  gitgraph: ['ordered normal commits with authored IDs/message/type/tags, branch and checkout writes; merges/cherry-picks omitted'],
  journey: ['ordered named sections and tasks including scores and actor lists; generated IDs omitted'],
  timeline: ['ordered event writes including text; period construction order is not homologous and is omitted'],
  mindmap: ['ordered attached node declarations: IDs, labels, shapes and parents', 'ordered icon/class decorations; reference parent derived from recorded indent operands'],
  pie: ['ordered section insertions: label and value; duplicate handling remains diagnostic'],
  quadrant: ['ordered point insertions: label, class, coordinates; axes/theme/point styles omitted'],
  radar: ['ordered axis and resolved curve writes; reference setAxes/setCurves batch operands expanded; options omitted'],
  sankey: ['ordered links: logical endpoints and value; implicit node construction omitted'],
  xychart: ['ordered series writes: kind, values and authored point labels; axes/options omitted'],
}
const row = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {})
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const text = (value: unknown): string => (typeof value === 'string' ? value : '')
const label = (value: unknown): string => normalizeBrTags(typeof value === 'string' ? value : text(row(value).text))
const number = (value: unknown): Json => (Number.isFinite(Number(value)) ? Number(value) : { $number: String(value) })
const marker = (kind: unknown): string => (kind === 'inheritance' || kind === 'realization' ? 'triangle' : kind === 'composition' ? 'diamond-filled' : kind === 'aggregation' ? 'diamond-open' : kind === 'lollipop' ? 'lollipop' : kind === 'link-solid' || kind === 'link-dashed' ? 'none' : 'arrow')
const referenceMarker = (value: unknown): string => (({ 0: 'diamond-open', 1: 'triangle', 2: 'diamond-filled', 3: 'arrow', 4: 'lollipop' }) as Record<string, string>)[String(value)] ?? 'none'
const classLine = (kind: unknown): string => (['dependency', 'realization', 'link-dashed'].includes(text(kind)) ? 'dashed' : 'solid')
const MINDMAP_SHAPES: Readonly<Record<number, string>> = { 0: 'default', 1: 'rounded', 2: 'rect', 3: 'circle', 4: 'cloud', 5: 'bang', 6: 'hexagon' }
function projection(family: string, size: number): NativeOperationProjection | undefined {
  const scope = SCOPES[family]
  return scope ? { scope, operations: [], sourceEvents: size, selectedSourceEvents: 0, unmapped: {}, unmappedOperands: {} } : undefined
}
function account(result: NativeOperationProjection, kind: string, selected: boolean): void {
  if (selected) result.selectedSourceEvents++
  else result.unmapped[kind] = (result.unmapped[kind] ?? 0) + 1
}

/** Reads only actual mutation events, never returned IR or serialized source.
 * Some operations require earlier recorded operands (e.g. Mindmap attachment).
 * Operations are never sorted; ignored implementation-specific work is counted.
 */
export function projectNativeOperations(family: string, events: readonly ParserObservation[]): NativeOperationProjection | undefined {
  if (family === 'eventmodeling') return projectNativeEventModelingOperations(family, events)
  if (family === 'c4') return projectNativeC4Operations(events)
  const stable = projectNativeStableOperations(family, events)
  if (stable) return stable
  const result = projection(family, events.length)
  if (!result) return undefined
  const add = (...operation: Json[]): void => {
    result.operations.push(operation)
  }
  const nodes = new Map<string, Record<string, unknown>>(),
    pseudo = new Map<string, string>(),
    groups: string[] = []
  const commits = new Map<string, Record<string, unknown>>()
  let commitIndex = 0
  for (const event of events) {
    const kind = event.kind,
      value = event.value,
      item = row(value)
    let selected = true
    switch (family) {
      case 'flowchart':
        if (kind === 'add-edge') add('link', text(item.source), text(item.target), text(item.id), label(item.label), text(item.style), item.hasArrowStart ? text(item.startMarker) || 'arrow' : 'none', item.hasArrowEnd ? text(item.endMarker) || 'arrow' : 'none')
        else if (kind === 'append-class') add('class', text(item.id), text(item.name))
        else selected = false
        break
      case 'state':
        if (kind === 'open-group') {
          add('open-group', text(item.id), groups.at(-1) ?? '')
          groups.push(text(item.id))
        } else if (kind === 'close-group') {
          add('close-group', text(item.id))
          groups.pop()
        } else if (kind === 'add-node' && (item.shape === 'state-start' || item.shape === 'state-end')) pseudo.set(text(item.id), `${item.shape}:${groups.at(-1) ?? '$root'}`)
        else if (kind === 'add-edge') add('transition', pseudo.get(text(item.source)) ?? text(item.source), pseudo.get(text(item.target)) ?? text(item.target), label(item.label))
        else selected = false
        break
      case 'sequence':
        if (kind === 'add-message') {
          add('message', text(item.from), text(item.to), label(item.label), text(item.lineStyle), text(item.startHead) || 'none', text(item.endHead) || 'none', item.centralStart === true, item.centralEnd === true)
          if (item.activate && !item.centralEnd) add('activation', text(item.to), 'activate')
          if (item.deactivate) add('activation', text(item.from), 'deactivate')
        } else if (kind === 'activation') add('activation', text(item.actorId), text(item.kind))
        else selected = false
        break
      case 'class':
        // Resolve generated interface occurrences only from actual preceding
        // declaration observations, never from a returned/reparsed model.
        if (kind === 'add-class' && item.isInterface === true) {
          nodes.set(text(item.id), item)
          selected = false
        } else if (kind === 'add-relationship')
          add(
            'relationship',
            nodes.has(text(item.from)) ? text(nodes.get(text(item.from))!.label) : text(item.from),
            nodes.has(text(item.to)) ? text(nodes.get(text(item.to))!.label) : text(item.to),
            label(item.label),
            text(item.fromCardinality),
            text(item.toCardinality),
            item.lineStyle === 'solid' || item.lineStyle === 'dashed' ? item.lineStyle : [item.type, item.fromType, item.toType].some(value => classLine(value) === 'dashed') ? 'dashed' : 'solid',
            item.markerAt === 'from' || item.markerAt === 'both' ? marker(item.fromType ?? item.type) : 'none',
            item.markerAt === 'to' || item.markerAt === 'both' ? marker(item.toType ?? item.type) : 'none',
          )
        else selected = false
        break
      case 'er':
        if (kind === 'addRelationship') add('relationship', text(item.entity1), text(item.entity2), label(item.label), text(item.cardinality1), text(item.cardinality2), item.identifying === true)
        else selected = false
        break
      case 'architecture':
        if (kind === 'addGroup' || kind === 'addService' || kind === 'addJunction') add(kind, text(item.id), kind === 'addJunction' ? '' : label(item.label), text(item.icon), text(item.parentId))
        else if (kind === 'addEdge') {
          const from = row(item.source),
            to = row(item.target)
          add('edge', text(from.id), text(from.side), from.boundary === 'group', text(to.id), text(to.side), to.boundary === 'group', item.hasArrowStart === true, item.hasArrowEnd === true, label(item.label))
        } else selected = false
        break
      case 'gantt':
        if (kind === 'addSection') add('section', label(item.label).trim())
        else if (kind === 'addTask') add('task', label(item.label).trim())
        else selected = false
        break
      case 'gitgraph':
        if (kind === 'addCommit') {
          commits.set(text(item.id), { ...item, normalizedId: item.customId === true ? { authored: text(item.id) } : { generated: commitIndex } })
          commitIndex++
        } else if (kind === 'appendStatement' && item.kind === 'commit') {
          const commit = commits.get(text(item.ref)) ?? {}
          add('commit', commit.normalizedId as Json, label(commit.message), text(commit.type), list(commit.tags).map(text))
        } else if (kind === 'appendStatement' && item.kind === 'branch') add('branch', text(item.name), item.order === undefined ? null : number(item.order))
        else if (kind === 'appendStatement' && item.kind === 'checkout') add('checkout', text(item.branch))
        else selected = false
        break
      case 'journey':
        if (kind === 'addSection') add('section', label(item.label).trim())
        else if (kind === 'addTask') add('task', label(item.text).trim(), number(item.score), list(item.actors).map(text))
        else selected = false
        break
      case 'timeline':
        if (kind === 'addEvent') add('event', label(item.text).trim())
        else selected = false
        break
      case 'mindmap':
        if (kind === 'createNode') nodes.set(text(item.id), item)
        else if (kind === 'setRoot' || kind === 'attachChild') {
          const node = nodes.get(text(item.id)) ?? {}
          add('node', text(item.id), label(node.label), text(node.shape), text(item.parentId))
        } else if (kind === 'setIcon') add('icon', text(item.id), text(item.icon).trim())
        else if (kind === 'setClass') add('class', text(item.id), text(item.className).trim().replace(/\s+/g, ' '))
        else selected = false
        break
      case 'pie':
        if (kind === 'appendEntry') add('section', label(item.label), number(item.value))
        else selected = false
        break
      case 'quadrant':
        if (kind === 'appendPoint') add('point', label(item.label), text(item.className), number(item.x), number(item.y))
        else selected = false
        break
      case 'radar':
        if (kind === 'appendAxis') add('axis', text(item.id), label(item.label))
        else if (kind === 'resolveCurve') add('curve', text(item.id), label(item.label), list(item.values).map(number))
        else selected = false
        break
      case 'sankey':
        if (kind === 'appendLink') add('link', text(item.source), text(item.target), number(item.value))
        else selected = false
        break
      case 'xychart':
        if (kind === 'appendSeries')
          add(
            'series',
            text(item.type),
            list(item.data).map(number),
            list(item.data).map((_, index) => text(list(item.pointLabels)[index])),
          )
        else selected = false
        break
      default:
        selected = false
    }
    account(result, kind === 'appendStatement' ? `${kind}:${text(item.kind)}` : kind, selected)
  }
  return result
}

/** Reads only recorded calls and their call-time arguments. Expansion of a
 * batch operand preserves its declared operand order, not hypothetical yy
 * calls. Getter snapshots, returned IR and canonical serialization are unused.
 */
export function projectReferenceOperations(family: string, reply: GrammarReferenceReply): NativeOperationProjection | undefined {
  if (family === 'eventmodeling') return projectReferenceEventModelingOperations(family, reply)
  if (family === 'c4') return projectReferenceC4Operations(reply)
  const stable = projectReferenceStableOperations(family, reply)
  if (stable) return stable
  if (reply.actions.status !== 'available') return undefined
  const result = projection(family, reply.actions.value.length)
  if (!result) return undefined
  const add = (...operation: Json[]): void => {
    result.operations.push(operation)
  }
  const omitOperand = (kind: string): void => {
    result.unmappedOperands[kind] = (result.unmappedOperands[kind] ?? 0) + 1
  }
  let commitIndex = 0,
    lastMindmapNode = ''
  const mindmapStack: Array<{ indent: number; id: string }> = [],
    radarAxes: string[] = []
  const expandSequence = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const child of value) expandSequence(child)
      return
    }
    const item = row(value),
      signal = SIGNALS[Number(item.signalType)]
    if (item.type === 'addMessage' && signal) add('message', text(item.from), text(item.to), label(item.msg), ...signal, item.centralConnection === 60 || item.centralConnection === 61, item.centralConnection === 59 || item.centralConnection === 61)
    else if (item.type === 'activeStart' || item.type === 'activeEnd') add('activation', text(item.actor), item.type === 'activeStart' ? 'activate' : 'deactivate')
    else omitOperand(`apply.${text(item.type) || '<unknown>'}`)
  }
  const expandState = (value: unknown, parent = ''): void => {
    for (const child of list(value)) {
      const item = row(child)
      if (item.stmt === 'relation') {
        const from = row(item.state1),
          to = row(item.state2)
        add('transition', from.id === '[*]' ? `state-start:${parent || '$root'}` : text(from.id), to.id === '[*]' ? `state-end:${parent || '$root'}` : text(to.id), label(item.description))
      } else if (item.stmt === 'state' && Array.isArray(item.doc)) {
        add('open-group', text(item.id), parent)
        expandState(item.doc, text(item.id))
        add('close-group', text(item.id))
      } else omitOperand(`setRootDoc.${text(item.stmt) || '<unknown>'}`)
    }
  }
  for (const action of reply.actions.value) {
    const kind = text(action[0]),
      item = row(action[1])
    let selected = true
    switch (family) {
      case 'flowchart':
        if (kind === 'addLink') {
          const link = row(action[3]),
            type = text(link.type),
            end = type.endsWith('_point') ? 'arrow' : type.endsWith('_circle') ? 'circle' : type.endsWith('_cross') ? 'cross' : 'none'
          for (const from of list(action[1])) for (const to of list(action[2])) add('link', text(from), text(to), text(link.id).replace(/@$/, ''), label(link.text), link.stroke === 'normal' ? 'solid' : text(link.stroke), type.startsWith('double_') ? end : 'none', end)
        } else if (kind === 'setClass') for (const id of text(action[1]).split(',')) for (const name of text(action[2]).split(',')) add('class', id.trim(), name.trim())
        else selected = false
        break
      case 'state':
        if (kind === 'setRootDoc' || kind === 'setRootDocV2') expandState(action[1])
        else selected = false
        break
      case 'sequence':
        if (kind === 'apply') expandSequence(action[1])
        else selected = false
        break
      case 'class':
        if (kind === 'addRelation') {
          const relation = row(item.relation)
          add(
            'relationship',
            text(item.id1),
            text(item.id2),
            label(item.title),
            item.relationTitle1 === 'none' ? '' : text(item.relationTitle1),
            item.relationTitle2 === 'none' ? '' : text(item.relationTitle2),
            relation.lineType === 1 ? 'dashed' : 'solid',
            referenceMarker(relation.type1),
            referenceMarker(relation.type2),
          )
        } else selected = false
        break
      case 'er':
        if (kind === 'addRelationship') {
          const relation = row(action[4]),
            cardinality = (value: unknown): string => (({ ONLY_ONE: 'one', ZERO_OR_ONE: 'zero-one', ZERO_OR_MORE: 'zero-many', ONE_OR_MORE: 'many' }) as Record<string, string>)[text(value)] ?? text(value)
          add('relationship', text(action[1]), text(action[3]), label(action[2]), cardinality(relation.cardB), cardinality(relation.cardA), relation.relType === 'IDENTIFYING')
        } else selected = false
        break
      case 'architecture':
        if (kind === 'addGroup' || kind === 'addService' || kind === 'addJunction') add(kind, text(item.id), kind === 'addJunction' ? '' : label(item.title ?? item.id), text(item.icon), text(item.in))
        else if (kind === 'addEdge') add('edge', text(item.lhsId), text(item.lhsDir), item.lhsGroup === true, text(item.rhsId), text(item.rhsDir), item.rhsGroup === true, item.lhsInto === true, item.rhsInto === true, label(item.title))
        else selected = false
        break
      case 'gantt':
        if (kind === 'addSection') add('section', label(action[1]).trim())
        else if (kind === 'addTask') add('task', label(action[1]).trim())
        else selected = false
        break
      case 'gitgraph':
        if (kind === 'commit') {
          add('commit', typeof item.id === 'string' ? { authored: item.id } : { generated: commitIndex }, label(item.msg), ({ 0: 'NORMAL', 1: 'REVERSE', 2: 'HIGHLIGHT' } as Record<string, string>)[String(item.type ?? 0)] ?? String(item.type), list(item.tags).map(text))
          commitIndex++
        } else if (kind === 'branch') add('branch', text(item.name), Number(item.order) > 0 ? number(item.order) : null)
        else if (kind === 'checkout') add('checkout', text(action[1]))
        else {
          if (kind === 'merge' || kind === 'cherryPick') commitIndex++
          selected = false
        }
        break
      case 'journey':
        if (kind === 'addSection') add('section', label(action[1]).trim())
        else if (kind === 'addTask') {
          const values = text(action[2]).replace(/^\s*:/, '').split(':')
          add(
            'task',
            label(action[1]).trim(),
            number(values[0]?.trim()),
            (values[1] ?? '')
              .split(',')
              .map(value => value.trim())
              .filter(Boolean),
          )
        } else selected = false
        break
      case 'timeline':
        if (kind === 'addEvent') add('event', label(action[1]).trim())
        else selected = false
        break
      case 'mindmap':
        if (kind === 'addNode') {
          const indent = Number(action[1]),
            id = text(action[2])
          while (mindmapStack.length && mindmapStack.at(-1)!.indent >= indent) mindmapStack.pop()
          add('node', id, label(action[3]), MINDMAP_SHAPES[Number(action[4])] ?? `unknown:${action[4]}`, mindmapStack.at(-1)?.id ?? '')
          mindmapStack.push({ indent, id })
          lastMindmapNode = id
        } else if (kind === 'decorateNode' && item.icon !== undefined) add('icon', lastMindmapNode, text(item.icon).trim())
        else if (kind === 'decorateNode' && item.class !== undefined) add('class', lastMindmapNode, text(item.class).trim().replace(/\s+/g, ' '))
        else selected = false
        break
      case 'pie':
        if (kind === 'addSection') add('section', label(item.label), number(item.value))
        else selected = false
        break
      case 'quadrant':
        if (kind === 'addPoint') add('point', label(action[1]), text(action[2]), number(action[3]), number(action[4]))
        else selected = false
        break
      case 'radar':
        if (kind === 'setAxes')
          for (const axis of list(action[1]).map(row)) {
            radarAxes.push(text(axis.name))
            add('axis', text(axis.name), label(axis.label ?? axis.name))
          }
        else if (kind === 'setCurves')
          for (const curve of list(action[1]).map(row)) {
            const entries = list(curve.entries).map(row),
              keyed = entries[0]?.axis !== undefined
            const values = keyed ? radarAxes.map(axis => entries.find(entry => row(entry.axis).$refText === axis)?.value) : entries.map(entry => entry.value)
            add('curve', text(curve.name), label(curve.label ?? curve.name), values.map(number))
          }
        else selected = false
        break
      case 'sankey':
        if (kind === 'addLink') add('link', text(item.ID), text(row(action[2]).ID), number(action[3]))
        else selected = false
        break
      case 'xychart':
        if (kind === 'setBarData' || kind === 'setLineData') {
          const points = list(action[2]).map(row)
          add(
            'series',
            kind === 'setBarData' ? 'bar' : 'line',
            points.map(point => number(point.value)),
            points.map(point => text(point.label)),
          )
        } else selected = false
        break
      default:
        selected = false
    }
    account(result, kind, selected)
  }
  return result
}
