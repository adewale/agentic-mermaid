import { fromEntityMarkers } from '../../src/shared/mermaid-entities.ts'
import type { ParserObservation } from '../../src/shared/parser-observation.ts'
import type { NativeOperationProjection } from './grammar-native-operations.ts'
import type { GrammarReferenceReply, NativeSemanticProjection } from './grammar-types.ts'
import type { Json } from './reference.ts'

type Row = Record<string, unknown>
const row = (value: unknown): Row => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : {})
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const rows = (value: unknown): Row[] => list(value).map(row)
const text = (value: unknown): string => (typeof value === 'string' ? value : '')
const strings = (value: unknown): string[] => list(value).map(text)
const pairs = (value: unknown): Row[] => list(value).map(pair => row(list(pair)[1]))
const projection = (value: Record<string, Json>): NativeSemanticProjection => ({ fields: Object.keys(value), value })
const commonNative = (model: Row) => ({ title: text(model.title), accTitle: text(model.accessibilityTitle), accDescription: text(model.accessibilityDescription) })
const commonReference = (data: Row) => ({ title: text(data.getDiagramTitle), accTitle: text(data.getAccTitle), accDescription: text(data.getAccDescription) })
// Requirement DB maps are keyed collections; snapshot serialization sorts the
// reference keys. Compare their final values by identity. Actual author order
// remains independently asserted by the ordered builder-operation projection.
const byName = (nodes: Row[]): Row[] => nodes.sort((a, b) => text(a.name) < text(b.name) ? -1 : text(a.name) > text(b.name) ? 1 : 0)
const classes = (value: unknown): string[] => strings(value).filter(name => name !== 'default')
const requirement = (node: Row): Json => ({ name: text(node.name), type: text(node.type), id: text(node.requirementId), text: text(node.text), risk: text(node.risk), verifyMethod: text(node.verifyMethod), classes: classes(node.classes) })
const element = (node: Row): Json => ({ name: text(node.name), type: text(node.type), docRef: text(node.docRef), classes: classes(node.classes) })
const relation = (edge: Row): Json => ({ type: text(edge.type), from: text(edge.src), to: text(edge.dst) })
const blockText = (value: unknown): string => fromEntityMarkers(text(value))
const blockEdge = (edge: Row): Json => ({ from: blockText(edge.start), to: blockText(edge.end), label: blockText(edge.label), startMarker: text(edge.arrowTypeStart), endMarker: text(edge.arrowTypeEnd), thickness: text(edge.thickness), pattern: text(edge.pattern) })

/** Inclusive bit assignments are the common semantic unit. Mermaid cuts a
 * field into words while Agentic retains the authored field as a whole. This
 * scope retains every bit and label, and deliberately omits split identities. */
function bits(fields: readonly Row[]): Json[] {
  const out: Json[] = []
  for (const field of fields) for (let bit = Number(field.start); bit <= Number(field.end); bit++) out.push([bit, text(field.label)])
  return out
}
function hierarchy(nodes: readonly Row[]): Json[] {
  const ids = new Map(nodes.map((node, index) => [text(node.id), index]))
  return nodes.map(node => ({ label: text(node.label), parent: ids.get(text(node.parentId)) ?? null, value: node.value === undefined ? null : Number(node.value), className: text(node.className) }))
}
function referenceHierarchy(root: unknown, labelKey: string, syntheticRoot: boolean): Json[] {
  const out: Json[] = []
  const visit = (node: Row, parent: number | null): void => {
    const index = out.length
    out.push({ label: text(node[labelKey]), parent, value: node.value === undefined ? null : Number(node.value), className: text(node.classSelector) })
    for (const child of rows(node.children)) visit(child, index)
  }
  if (syntheticRoot) for (const child of rows(row(root).children)) visit(child, null)
  else if (root) visit(row(root), null)
  return out
}
function kanbanNode(node: Row, parent: string | null, column: boolean, metadata: Row): Json {
  return { id: text(node.sourceId ?? node.id), label: text(node.label), parent, column, assigned: text(metadata.assigned), ticket: text(metadata.ticket), priority: text(metadata.priority), icon: text(node.icon ?? metadata.icon), className: text(node.className ?? node.cssClasses ?? metadata.cssClasses) }
}
/** Identity spellings are implementation details only when allocation evidence
 * proves they were generated. Authored generated-looking IDs remain semantic. */
function blockSemantic(root: Row, edges: readonly Row[], generated: (node: Row) => boolean): NativeSemanticProjection {
  const nodes: Json[] = [],
    ids = new Map<string, string>()
  const visit = (node: Row, parent: string, path: string): void => {
    const rawId = text(node.id),
      space = node.type === 'space'
    const id = space ? `@space:${path}` : generated(node) ? `@group:${path}` : blockText(rawId)
    ids.set(rawId, id)
    nodes.push({ id, parent, type: text(node.type), label: space ? '' : blockText(node.label), width: Number(node.widthInColumns ?? 1), columns: Number(node.columns ?? -1), directions: strings(node.directions) })
    rows(node.children).forEach((child, index) => visit(child, id, `${path}.${index}`))
  }
  rows(root.children).forEach((node, index) => visit(node, '', String(index)))
  return projection({ columns: Number(root.columns ?? -1), nodes, edges: edges.map(edge => ({ ...row(blockEdge(edge)), from: ids.get(text(edge.start)) ?? blockText(edge.start), to: ids.get(text(edge.end)) ?? blockText(edge.end) }) as Json) })
}

/** The operation scope omits composite ID spellings but retains their order,
 * membership and endpoint bindings. Read only the recorded write operands. */
function normalizeBlockOperations(operations: readonly Json[]): Json[] {
  const groups = new Map<string, string>()
  for (const value of operations) {
    const op = list(value)
    if (op[0] === 'block' && op[3] === 'composite' && !groups.has(text(op[1]))) groups.set(text(op[1]), `@group:${groups.size}`)
  }
  const id = (value: unknown): string => groups.get(blockText(value)) ?? blockText(value)
  return operations.map(value => {
    const op = list(value)
    if (op[0] === 'block') return ['block', id(op[1]), id(op[2]), text(op[3]), blockText(op[4]), Number(op[5]), op[6] as Json]
    if (op[0] === 'columns') return ['columns', id(op[1]), Number(op[2])]
    if (op[0] === 'edge') {
      const edge = row(op[1])
      return ['edge', { ...edge, from: id(edge.from), to: id(edge.to) } as Json]
    }
    return value
  })
}

/** setHierarchy operands contain both objects and nested node/edge/node
 * arrays. Flatten those actual arrays before expanding child membership. */
function blockOperandRows(items: unknown): Row[] {
  const out: Row[] = [],
    pending = [...list(items)].reverse()
  while (pending.length) {
    const value = pending.pop()
    if (Array.isArray(value)) for (let i = value.length - 1; i >= 0; i--) pending.push(value[i])
    else if (value !== null && typeof value === 'object') out.push(row(value))
  }
  return out
}

/** Independent returned-model projections, never used as write observations. */
export function projectNativeStable(family: string, model: unknown, events: readonly ParserObservation[] = []): NativeSemanticProjection | undefined {
  const body = row(model)
  switch (family) {
    case 'packet':
      return projection({ ...commonNative(body), bits: bits(rows(body.fields)) })
    case 'kanban':
      return projection({ nodes: rows(body.columns).flatMap(column => [kanbanNode(column, null, true, row(column.metadata)), ...rows(column.tasks).map(task => kanbanNode(task, text(column.sourceId), false, row(task.metadata)))]) })
    case 'requirement':
      return projection({ ...commonNative(body), direction: text(body.direction), requirements: byName(rows(body.requirements)).map(requirement), elements: byName(rows(body.elements)).map(element), relationships: rows(body.relations).map(relation) })
    case 'treemap':
      return projection({ ...commonNative(body), nodes: hierarchy(rows(body.nodes)) })
    case 'ishikawa':
      return projection({ nodes: hierarchy(rows(body.nodes)) })
    case 'block': {
      const generated = new Set(events.filter(event => event.unit === 'mutation' && event.kind === 'generate-id' && typeof event.value === 'string').map(event => String(event.value)))
      return blockSemantic(row(body.root), rows(body.edges), node => node.type === 'composite' && generated.has(text(node.id)))
    }
    default:
      return undefined
  }
}
export function projectReferenceStable(family: string, reply: GrammarReferenceReply): NativeSemanticProjection | undefined {
  const data = reply.snapshot?.data
  if (!data) return undefined
  switch (family) {
    case 'packet':
      return projection({ ...commonReference(data), bits: bits(list(data.getPacket).flatMap(word => rows(word))) })
    case 'kanban': {
      const sections = rows(data.getSections)
      let sectionIndex = 0
      // getData intentionally omits a card's cssClasses, while the real
      // decorateNode call stores it on the original node. Retain that authored
      // semantic field from its actual call operands, indexed by declaration
      // occurrence so duplicate source IDs cannot overwrite one another.
      const decorations: Row[] = []
      if (reply.actions.status === 'available')
        for (const action of reply.actions.value) {
          if (action[0] === 'addNode') decorations.push({})
          else if (action[0] === 'decorateNode' && decorations.length) {
            const decoration = row(action[1]),
              target = decorations.at(-1)!
            if (decoration.class) target.className = decoration.class
            if (decoration.icon) target.icon = decoration.icon
          }
        }
      return projection({ nodes: rows(row(data.getData).nodes).map((node, index) => kanbanNode({ ...node, ...decorations[index] }, node.isGroup === true ? null : text(node.parentId), node.isGroup === true, node.isGroup === true ? (sections[sectionIndex++] ?? {}) : node)) })
    }
    case 'requirement':
      return projection({ ...commonReference(data), direction: text(data.getDirection), requirements: byName(pairs(data.getRequirements)).map(requirement), elements: byName(pairs(data.getElements)).map(element), relationships: rows(data.getRelationships).map(relation) })
    case 'treemap':
      return projection({ ...commonReference(data), nodes: referenceHierarchy(data.getRoot, 'name', true) })
    case 'ishikawa':
      return projection({ nodes: referenceHierarchy(data.getRoot, 'text', false) })
    case 'block': {
      const root = rows(data.getBlocksFlat).find(node => node.id === 'root') ?? { children: list(data.getBlocks) }
      const authored = new Set(reply.tokens.status === 'available' ? reply.tokens.value.filter(token => token[0] === 'NODE_ID').map(token => token[1]) : [])
      return blockSemantic(root, rows(data.getEdges), node => node.type === 'composite' && !authored.has(text(node.id)))
    }
    default:
      return undefined
  }
}

const SCOPES: Record<string, readonly string[]> = {
  packet: ['ordered inclusive bit-label writes; reference word-batch operands expanded, authored field boundaries and generated segment IDs omitted'],
  kanban: ['ordered node declarations: authored ID, declared label and column parent derived from recorded indent; later metadata/decorations omitted'],
  requirement: ['ordered staged semantic field writes, requirement/element commits and directed relationships; classes/styles/accessibility omitted'],
  treemap: ['ordered node inserts: label, value, class and parent; reference addNode call depth establishes parent, generated IDs omitted'],
  ishikawa: ['ordered effect and cause inserts: label and parent derived from recorded indent operands; generated IDs omitted'],
  block: ['ordered column writes, first non-space child attachments and directed edges; actual nested setHierarchy operand arrays expanded in declaration order; composite ID spellings normalized by attachment order with parent/endpoint bindings retained; styles and generated spaces omitted'],
}
function operationProjection(family: string, size: number): NativeOperationProjection | undefined {
  const scope = SCOPES[family]
  return scope ? { scope, operations: [], sourceEvents: size, selectedSourceEvents: 0, unmapped: {}, unmappedOperands: {} } : undefined
}
function account(out: NativeOperationProjection, kind: string, selected: boolean): void {
  if (selected) out.selectedSourceEvents++
  else out.unmapped[kind] = (out.unmapped[kind] ?? 0) + 1
}
function nodeWrite(value: Row, parent: Json): Json {
  return ['node', text(value.label), parent, value.value === undefined ? null : Number(value.value), text(value.className)]
}
const blockAttachment = (node: Row, parent: unknown): Json => ['block', blockText(node.id), parent === 'root' ? '' : blockText(parent), text(node.type), blockText(node.label), Number(node.widthInColumns ?? 1), strings(node.directions)]
const FIELD_WRITES = new Set(['setNewReqId', 'setNewReqText', 'setNewReqRisk', 'setNewReqVerifyMethod', 'setNewElementType', 'setNewElementDocRef', 'setDirection'])

/** Only actual emitted native mutation events enter this adapter. */
export function projectNativeStableOperations(family: string, events: readonly ParserObservation[]): NativeOperationProjection | undefined {
  const out = operationProjection(family, events.length)
  if (!out) return undefined
  const ids = new Map<string, number>()
  for (const event of events) {
    const value = row(event.value),
      kind = event.kind
    let selected = true
    switch (family) {
      case 'packet':
        if (kind === 'add-field') for (const [bit, label] of bits([value]) as [number, string][]) out.operations.push(['bit', bit, label])
        else selected = false
        break
      case 'kanban':
        if (kind === 'add-column' || kind === 'add-task') out.operations.push(['node', text(value.sourceId), text(value.declaredLabel), text(value.parentId)])
        else selected = false
        break
      case 'requirement':
        if (FIELD_WRITES.has(kind)) out.operations.push([kind, text(event.value)])
        else if (kind === 'addRequirement') out.operations.push([kind, text(value.name), text(value.type)])
        else if (kind === 'addElement') out.operations.push([kind, text(value.name)])
        else if (kind === 'addRelationship') out.operations.push(['relationship', text(value.type), text(value.src), text(value.dst)])
        else selected = false
        break
      case 'treemap':
      case 'ishikawa':
        if (kind === 'add-node') {
          const index = ids.size
          out.operations.push(nodeWrite(value, ids.get(text(value.parentId)) ?? null))
          ids.set(text(value.id), index)
        } else selected = false
        break
      case 'block':
        if (kind === 'set-columns') out.operations.push(['columns', value.id === 'root' ? '' : text(value.id), Number(value.columns)])
        else if (kind === 'attach-child') out.operations.push(blockAttachment(row(value.block), value.parentId))
        else if (kind === 'add-edge') out.operations.push(['edge', blockEdge(value)])
        else selected = false
        break
    }
    account(out, kind, selected)
  }
  if (family === 'block') out.operations = normalizeBlockOperations(out.operations)
  return out
}

/** Only call-time reference operands enter this adapter. Batch expansion does
 * not use the returned DB or fabricate hypothetical upstream method calls. */
export function projectReferenceStableOperations(family: string, reply: GrammarReferenceReply): NativeOperationProjection | undefined {
  if (reply.actions.status !== 'available') return undefined
  const out = operationProjection(family, reply.actions.value.length)
  if (!out) return undefined
  const stack: { depth: number; index: number }[] = [],
    seenBlocks = new Set<string>()
  let nodeIndex = 0,
    baseIndent: number | undefined,
    column = ''
  const blockBatch = (items: unknown, parent: string): void => {
    for (const node of blockOperandRows(items)) {
      if (node.type === 'column-setting') out.operations.push(['columns', parent === 'root' ? '' : parent, Number(node.columns)])
      else if (node.type === 'edge') out.operations.push(['edge', blockEdge(node)])
      else if (['classDef', 'applyClass', 'applyStyles', 'space'].includes(text(node.type))) out.unmappedOperands[`setHierarchy:${text(node.type)}`] = (out.unmappedOperands[`setHierarchy:${text(node.type)}`] ?? 0) + 1
      else {
        const id = text(node.id)
        if (!seenBlocks.has(id)) {
          seenBlocks.add(id)
          out.operations.push(blockAttachment({ ...node, label: node.label || (node.type === 'composite' ? '' : id) }, parent))
        }
        blockBatch(node.children, id)
      }
    }
  }
  for (const action of reply.actions.value) {
    const kind = text(action[0]),
      value = row(action[1])
    let selected = true
    switch (family) {
      case 'packet':
        if (kind === 'pushWord') for (const [bit, label] of bits(rows(action[1])) as [number, string][]) out.operations.push(['bit', bit, label])
        else selected = false
        break
      case 'kanban':
        if (kind === 'addNode') {
          const indent = Number(action[1])
          baseIndent ??= indent
          const parent = indent === baseIndent ? '' : column
          out.operations.push(['node', text(action[2]), text(action[3]), parent])
          if (indent === baseIndent) column = text(action[2])
        } else selected = false
        break
      case 'requirement':
        if (FIELD_WRITES.has(kind)) out.operations.push([kind, text(action[1])])
        else if (kind === 'addRequirement') out.operations.push([kind, text(action[1]), text(action[2])])
        else if (kind === 'addElement') out.operations.push([kind, text(action[1])])
        else if (kind === 'addRelationship') out.operations.push(['relationship', text(action[1]), text(action[2]), text(action[3])])
        else selected = false
        break
      case 'treemap':
        if (kind === 'addNode') {
          const depth = Number(action[2])
          while (stack.length && stack.at(-1)!.depth >= depth) stack.pop()
          out.operations.push(nodeWrite({ label: value.name, value: value.value, className: value.classSelector }, stack.at(-1)?.index ?? null))
          stack.push({ depth, index: nodeIndex++ })
        } else selected = false
        break
      case 'ishikawa':
        if (kind === 'addNode') {
          const indent = Number(action[1])
          if (!nodeIndex) {
            out.operations.push(nodeWrite({ label: action[2] }, null))
            nodeIndex++
          } else {
            baseIndent ??= indent
            const level = Math.max(1, indent - baseIndent + 1)
            while (stack.length && stack.at(-1)!.depth >= level) stack.pop()
            out.operations.push(nodeWrite({ label: action[2] }, stack.at(-1)?.index ?? 0))
            stack.push({ depth: level, index: nodeIndex++ })
          }
        } else selected = false
        break
      case 'block':
        if (kind === 'setHierarchy') blockBatch(action[1], 'root')
        else selected = false
        break
    }
    account(out, kind, selected)
  }
  if (family === 'block') out.operations = normalizeBlockOperations(out.operations)
  return out
}
