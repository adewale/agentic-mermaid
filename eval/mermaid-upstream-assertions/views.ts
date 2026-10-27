import { eventRelations, eventType } from '../../src/eventmodeling/parser.ts'
import type { EventModelingBody } from '../../src/eventmodeling/types.ts'
import type { NativeDb } from './runtime.ts'
import { normalizeMermaidSource, parseForAst, unavailable } from './runtime.ts'
import { readSequenceStatements } from '../../src/sequence/parser.ts'
import { readSequenceText } from '../../src/sequence/text.ts'
import { normalizeBrTags } from '../../src/multiline-utils.ts'
import { REFERENCE_SEQUENCE_SIGNALS } from '../mermaid-modern-compat/grammar-sequence-kinds.ts'
import { withParserObservation, type ParserObservation } from '../../src/shared/parser-observation.ts'
import { layoutPacketDiagram } from '../../src/packet/layout.ts'

// Protocol names from pinned Mermaid's database types. These are model-view
// conversions, not expected test values or an alternate parser.
const ER_CARD = { one: 'ONLY_ONE', 'zero-one': 'ZERO_OR_ONE', many: 'ONE_OR_MORE', 'zero-many': 'ZERO_OR_MORE', parent: 'MD_PARENT' } as const
const ER_ENUM = Object.fromEntries(Object.values(ER_CARD).map(name => [name, name]))
const SEQUENCE_LINES = { SOLID: 0, DOTTED: 1, NOTE: 2, SOLID_CROSS: 3, DOTTED_CROSS: 4, SOLID_OPEN: 5, DOTTED_OPEN: 6, LOOP_START: 10, LOOP_END: 11, ALT_START: 12, ALT_ELSE: 13, ALT_END: 14, OPT_START: 15, OPT_END: 16, ACTIVE_START: 17, ACTIVE_END: 18, PAR_START: 19, PAR_AND: 20, PAR_END: 21, RECT_START: 22, RECT_END: 23, SOLID_POINT: 24, DOTTED_POINT: 25, AUTONUMBER: 26, CRITICAL_START: 27, CRITICAL_OPTION: 28, CRITICAL_END: 29, BREAK_START: 30, BREAK_END: 31, PAR_OVER_START: 32, BIDIRECTIONAL_SOLID: 33, BIDIRECTIONAL_DOTTED: 34 }
const OPEN: Record<string, number> = { loop: 10, alt: 12, opt: 15, par: 19, rect: 22, critical: 27, break: 30, par_over: 32 }
const CLOSE: Record<string, number> = { loop: 11, alt: 14, opt: 16, par: 21, rect: 23, critical: 29, break: 31, par_over: 21 }
const sequenceViews = new WeakMap<object, any[]>()
const sequenceMessageOffsets = new WeakMap<object, number[]>()

/** Restore a source spelling only when it expresses the actual native value.
 * This bridges `<br/>` versus a decoded newline without hiding text loss. */
function sequenceText(value: string, authored?: string): string {
  if (authored !== undefined) {
    const text = readSequenceText(authored).value
    if (normalizeBrTags(text) === value) return text
  }
  return value
}

export function nativeSequenceMessages(db: NativeDb): any[] {
  const model = db.model
  if (!model) return []
  const cached = sequenceViews.get(model)
  if (cached) return cached
  const syntax = readSequenceStatements(normalizeMermaidSource(db.source).familyLines.slice(1)).statements
  const messages = syntax.flatMap(entry => entry.syntax?.kind === 'message' ? [entry.syntax.message] : [])
  const notes = syntax.flatMap(entry => entry.syntax?.kind === 'note' ? [entry.syntax.note] : [])
  const out: any[] = []
  const offsets: number[] = []
  const blockTypes = new Map<number, string>()
  const openers = syntax.flatMap(entry => entry.syntax?.kind === 'block' ? [entry.syntax.opener] : [])
  const dividers = syntax.flatMap(entry => entry.syntax?.kind === 'continuation' ? [entry.syntax.continuation] : [])
  let messageIndex = 0, noteIndex = 0, blockIndex = 0, dividerIndex = 0
  // sequenceDb.addSignal's protocol defaults. Every semantic field below
  // comes from native mutation events; no upstream test expectation is read.
  const signal = (fields: any) => out.push({ id: String(out.length), from: undefined, to: undefined, message: '', wrap: false, activate: false, centralConnection: 0, ...fields })
  for (const event of db.events) {
    if (event.unit !== 'mutation') continue
    const value = event.value as any
    if (event.kind === 'add-message') {
      const type = Object.entries(REFERENCE_SEQUENCE_SIGNALS).find(([, meaning]) => meaning[0] === value.lineStyle && meaning[1] === value.startHead && meaning[2] === value.endHead)?.[0]
      if (type === undefined) return unavailable('Sequence arrow has no pinned signal protocol equivalent')
      offsets.push(out.length)
      signal({ from: value.from, to: value.to, message: sequenceText(value.label, messages[messageIndex++]?.label), wrap: value.wrap ?? false, type: Number(type),
        activate: Boolean(value.activate || value.centralEnd), centralConnection: value.centralStart && value.centralEnd ? 61 : value.centralStart ? 60 : value.centralEnd ? 59 : 0 })
      if (value.activate) signal({ from: value.to, type: 17 })
      if (value.deactivate) signal({ from: value.from, type: 18 })
      if (value.centralEnd) signal({ from: value.to, type: 59 })
      if (value.centralStart) signal({ from: value.from, type: 60 })
    } else if (event.kind === 'add-note') {
      const note = value.note
      out.push({ id: String(out.length), from: note.actorIds[0], to: note.actorIds.at(-1), message: sequenceText(note.text, notes[noteIndex++]?.text), wrap: note.wrap ?? false, type: 2, placement: ({ left: 0, right: 1, over: 2 } as any)[note.position] })
    } else if (event.kind === 'open-block') {
      blockTypes.set(value.id, value.block.type)
      const authored = openers[blockIndex++]?.label
      signal({ message: value.block.type === 'rect' ? value.block.color ?? '' : sequenceText(value.block.label, authored), wrap: value.block.wrap ?? false, type: OPEN[value.block.type] })
    } else if (event.kind === 'divide-block') {
      signal({ message: sequenceText(value.divider.label, dividers[dividerIndex++]?.label), wrap: value.divider.wrap ?? false, type: ({ alt: 13, par: 20, par_over: 20, critical: 28 } as any)[blockTypes.get(value.parent)!] })
    } else if (event.kind === 'close-block') {
      const type = blockTypes.get(value.id)
      if (type) signal({ type: CLOSE[type] })
    } else if (event.kind === 'activation') {
      signal({ from: value.actorId, type: value.kind === 'activate' ? 17 : 18 })
    }
  }
  sequenceMessageOffsets.set(model, offsets)
  sequenceViews.set(model, out)
  return out
}

function groups(items: any[]): any[] {
  return items.flatMap(group => [{ id: group.id, title: group.label, nodes: [...group.nodeIds, ...group.children.map((child: any) => child.id)], dir: group.direction }, ...groups(group.children)])
}
function flattenTree(root: any): any[] { return root ? [root, ...(root.children ?? []).flatMap(flattenTree)] : [] }

export function nativeGetters(db: NativeDb, key: string): any {
  const family = db.context.family, model = db.model
  // A semantic relation projection of native state. No DOM boxes, positions,
  // text metrics or missing payloads are synthesized to imitate Mermaid.
  if (family === 'eventmodeling' && key === 'getState') return () => {
    if (!model) throw Error('No data for EventModel')
    return { relations: eventRelations(model).map(edge => ({ sourceBox: { frame: { name: edge.from } }, targetBox: { frame: { name: edge.to } } })) }
  }

  if (key === 'Cardinality') return ER_ENUM
  if (key === 'Identification') return { IDENTIFYING: 'IDENTIFYING', NON_IDENTIFYING: 'NON_IDENTIFYING' }
  if (key === 'LINETYPE') return SEQUENCE_LINES
  if (key === 'ARROWTYPE') return { FILLED: 0, OPEN: 1 }
  if (key === 'PLACEMENT') return { LEFTOF: 0, RIGHTOF: 1, OVER: 2 }
  if (key === 'getConfig') return () => db.context.config[family] ?? {}
  if (key === 'getAccTitle') return () => model?.accessibilityTitle ?? normalizeMermaidSource(db.source).accessibility.title ?? ''
  if (key === 'getAccDescription') return () => model?.accessibilityDescription ?? normalizeMermaidSource(db.source).accessibility.descr ?? ''
  if (key === 'getDiagramTitle' || key === 'getChartTitle') return () => model?.title ?? ''
  if (key === 'getDirection') return () => model?.direction ?? (family === 'er' ? 'LR' : 'TB')
  if (key === 'getData') return () => {
    if (family === 'kanban') return { nodes: kanbanNodes(model), sections: model?.columns ?? [], config: db.context.config.kanban ?? {} }
    return unavailable(`${family}.getData: renderer-specific node/edge schema has no adapter`)
  }
  if (key === 'setGen') return () => {} // FlowDB's renderer-version selector has no input-language effect.

  if (family === 'er') {
    const entities = () => new Map((model?.entities ?? []).map((entity: any) => [entity.id, { ...entity, alias: entity.label === entity.id ? '' : entity.label, cssClasses: ['default', entity.className].filter(Boolean).join(' '), cssStyles: Object.entries(entity.inlineStyle ?? {}).map(([k, v]) => `${k}:${v}`), attributes: entity.attributes.map((attribute: any) => ({ ...attribute, comment: attribute.comment ?? '' })) }]))
    if (key === 'getEntities') return entities
    if (key === 'getEntity') return (id: string) => entities().get(id)
    if (key === 'getRelationships') return () => (model?.relationships ?? []).map((relation: any) => ({ entityA: relation.entity1, entityB: relation.entity2, roleA: relation.label, relSpec: { cardA: ER_CARD[relation.cardinality2 as keyof typeof ER_CARD], cardB: ER_CARD[relation.cardinality1 as keyof typeof ER_CARD], relType: relation.identifying ? 'IDENTIFYING' : 'NON_IDENTIFYING' } }))
    if (key === 'getSubGraphs') return () => (model?.groups ?? []).map((group: any) => ({ id: group.id, title: group.label, nodes: [...group.entityIds, ...model.groups.filter((child: any) => child.parentId === group.id).map((child: any) => child.id)], dir: group.direction, classes: [] }))
    if (key === 'getClasses') return () => new Map([...(model?.classDefs ?? [])].map(([id, style]: any) => [id, { id, styles: Object.entries(style).map(([k, v]) => `${k}:${v}`), textStyles: [] }]))
  }
  if (family === 'sequence') {
    const actors = () => {
      const labels = new Map<string, string>()
      for (const event of db.events) {
        if (event.unit === 'mutation' && event.kind === 'participant.apply') {
          const value = event.value as any
          if (value.kind === 'declare' && value.label !== undefined) labels.set(value.id, value.label)
        }
      }
      return new Map((model?.actors ?? []).map((actor: any, index: number) => [actor.id, {
        name: actor.id, description: sequenceText(actor.label, labels.get(actor.id)), type: actor.type, wrap: actor.wrap ?? false, links: actor.links ?? {},
        get properties() { return unavailable('sequence.actor.properties: preserved source has no native semantic properties model') },
        prevActor: model.actors[index - 1]?.id, nextActor: model.actors[index + 1]?.id,
      }]))
    }
    if (key === 'getActors') return actors
    if (key === 'getActor') return (id: string) => actors().get(id)
    if (key === 'getActorKeys') return () => (model?.actors ?? []).map((actor: any) => actor.id)
    if (key === 'getMessages') return () => nativeSequenceMessages(db)
    if (key === 'getBoxes') return () => (model?.boxes ?? []).map((box: any) => ({ name: box.label, fill: box.color ?? 'transparent', wrap: box.wrap ?? false, actorKeys: box.actorIds }))
    if (key === 'getCreatedActors' || key === 'getDestroyedActors') return () => {
      nativeSequenceMessages(db)
      const field = key === 'getCreatedActors' ? 'createMessageIndex' : 'destroyMessageIndex'
      return new Map((model?.actors ?? []).filter((actor: any) => actor[field] !== undefined).map((actor: any) => [actor.id, sequenceMessageOffsets.get(model)?.[actor[field]]]))
    }
    if (key === 'showSequenceNumbers') return () => (model?.messages ?? []).some((message: any) => message.number !== undefined)
  }
  if (family === 'pie') {
    if (key === 'getSections') return () => new Map((model?.entries ?? []).map((entry: any) => [entry.label, entry.value]))
    if (key === 'getShowData') return () => model?.showData ?? false
  }
  if (family === 'flowchart') {
    if (key === 'getVertices') return () => new Map([...(model?.nodes?.values() ?? [])].map((node: any) => [node.id, { id: node.id, text: node.label, type: ({ rectangle: 'square', rounded: 'round', 'trapezoid-alt': 'inv_trapezoid', asymmetric: 'odd' } as any)[node.shape] ?? node.shape, classes: (model.classAssignments.get(node.id) ?? '').split(/\s+/).filter(Boolean), styles: Object.entries(model.nodeStyles.get(node.id) ?? {}).map(([k, v]) => `${k}:${v}`), props: {} }]))
    if (key === 'getEdges') return () => (model?.edges ?? []).map((edge: any) => ({ start: edge.source, end: edge.target, text: edge.label ?? '', type: edge.hasArrowEnd ? `arrow_${edge.endMarker === 'arrow' ? 'point' : edge.endMarker}` : 'arrow_open', stroke: edge.style === 'dotted' ? 'dotted' : edge.style === 'thick' ? 'thick' : 'normal', length: edge.minLength ?? 1 }))
    if (key === 'getSubGraphs') return () => groups(model?.subgraphs ?? [])
    if (key === 'getClasses') return () => model?.classDefs ?? new Map()
  }
  if (family === 'state') {
    if (key === 'getStates') return () => new Map([...(model?.nodes?.values() ?? [])].map((node: any) => [node.id, { id: node.id, type: node.shape === 'state-start' ? 'start' : node.shape === 'state-end' ? 'end' : 'default', descriptions: node.label ? [node.label] : [] }]))
    if (key === 'getRelations') return () => (model?.edges ?? []).map((edge: any) => ({ id1: edge.source, id2: edge.target, relationTitle: edge.label ?? '' }))
    if (key === 'getClasses') return () => model?.classDefs ?? new Map()
    if (key === 'getLinks') return () => new Map()
  }
  if (family === 'class') {
    const parents = new Map<string, string>()
    const visit = (namespaces: any[], parent = ''): void => {
      for (const namespace of namespaces) {
        const path = parent ? `${parent}.${namespace.name}` : namespace.name
        for (const id of namespace.classIds) parents.set(id, path)
        visit(namespace.children, path)
      }
    }
    visit(model?.namespaces ?? [])
    const member = (value: any) => ({ ...value, id: value.name, classifier: value.isStatic ? '$' : value.isAbstract ? '*' : '', getDisplayDetails() {
      return { displayText: value.sourceText ?? `${value.visibility}${value.name}${value.isMethod ? `(${value.params ?? ''})` : ''}${value.type ? ` ${value.type}` : ''}`, cssStyle: value.isStatic ? 'text-decoration:underline;' : value.isAbstract ? 'font-style:italic;' : '' }
    } })
    const classes = () => new Map((model?.classes ?? []).map((node: any) => [node.id, { id: node.id, label: node.label ?? node.id, parent: parents.get(node.id), type: node.generic ?? '', members: node.attributes.map(member), methods: node.methods.map(member), annotations: node.annotation ? [node.annotation] : [], cssClasses: node.className ?? '' }]))
    if (key === 'getClasses') return classes
    if (key === 'getClass') return (id: string) => classes().get(id)
    if (key === 'getRelations') return () => model?.relationships ?? []
    if (key === 'getNotes') return () => new Map((model?.notes ?? []).map((note: any, index: number) => [`note${index}`, note]))
    if (key === 'getNote') return (id: string | number) => model?.notes[typeof id === 'number' ? id : Number(id.replace(/^note/, ''))]
    if (key === 'getNamespaces') return () => new Map((model?.namespaces ?? []).map((namespace: any) => [namespace.name, namespace]))
  }
  if (family === 'c4') {
    if (key === 'getC4ShapeArray') return () => (model?.elements ?? []).map((element: any) => ({ ...element, alias: element.id, type: element.kind, label: { text: element.label }, descr: { text: element.description ?? '' }, techn: { text: element.technology ?? '' }, parentBoundary: element.parentId }))
    if (key === 'getBoundaries') return () => (model?.boundaries ?? []).map((boundary: any) => ({ ...boundary, alias: boundary.id, label: { text: boundary.label } }))
    if (key === 'getRels') return () => (model?.relationships ?? []).map((relation: any) => ({ ...relation, from: relation.from, to: relation.to, label: { text: relation.label } }))
  }
  if (family === 'packet' && key === 'getPacket') return () => {
    if (!model) return []
    const result: any[][] = []
    for (const field of layoutPacketDiagram(model).fields) {
      ;(result[field.row] ??= []).push({ start: field.start, end: field.end, bits: field.end - field.start + 1, label: field.label })
    }
    return result
  }
  if (family === 'mindmap' && key === 'getMindmap') return () => model?.root
  if (family === 'sankey' && key === 'getGraph') return () => ({ nodes: model?.nodes ?? [], links: model?.links ?? [] })
  if (family === 'gitgraph') {
    if (key === 'getCommits') return () => Object.fromEntries((model?.commits ?? []).map((commit: any) => [commit.id, commit]))
    if (key === 'getBranches') return () => model?.branches ?? []
    if (key === 'getCommitsArray') return () => model?.commits ?? []
  }
  if (family === 'gantt' && key === 'getTasks') return () => model?.tasks ?? []
  if ((family === 'journey' || family === 'timeline') && key === 'getTasks') return () => (model?.sections ?? []).flatMap((section: any) => section.tasks ?? section.periods ?? [])
  if (key === 'getSections' && (family === 'gantt' || family === 'journey' || family === 'timeline')) return () => (model?.sections ?? []).map((section: any) => typeof section === 'string' ? section : section.name ?? section.label)
  if (family === 'kanban' && key === 'getNodes') return () => kanbanNodes(model)
  if (family === 'kanban' && key === 'getSections') return () => model?.columns ?? []
  if (family === 'block' && key === 'getBlocksFlat') return () => Object.fromEntries(flattenTree(model?.root).map(node => [node.id, node]))
  if (family === 'block' && key === 'getBlocks') return () => model?.root
  if (family === 'block' && key === 'getBlock') return (id: string) => model?.byId.get(id)
  if (family === 'block' && key === 'getColumns') return (id = 'root') => model?.byId.get(id)?.columns
  if (family === 'requirement') {
    if (key === 'RequirementType') return { REQUIREMENT: 'Requirement', FUNCTIONAL_REQUIREMENT: 'Functional Requirement', INTERFACE_REQUIREMENT: 'Interface Requirement', PERFORMANCE_REQUIREMENT: 'Performance Requirement', PHYSICAL_REQUIREMENT: 'Physical Requirement', DESIGN_CONSTRAINT: 'Design Constraint' }
    if (key === 'RiskLevel') return { LOW_RISK: 'Low', MED_RISK: 'Medium', HIGH_RISK: 'High' }
    if (key === 'VerifyType') return { VERIFY_ANALYSIS: 'Analysis', VERIFY_DEMONSTRATION: 'Demonstration', VERIFY_INSPECTION: 'Inspection', VERIFY_TEST: 'Test' }
    if (key === 'Relationships') return Object.fromEntries(['contains', 'copies', 'derives', 'satisfies', 'verifies', 'refines', 'traces'].map(value => [value.toUpperCase(), value]))
    if (key === 'getRequirements') return () => model?.requirements ?? new Map()
    if (key === 'getElements') return () => model?.elements ?? new Map()
    if (key === 'getRelationships') return () => model?.relations ?? []
  }
  if (family === 'radar') {
    if (key === 'getAxes') return () => (model?.axes ?? []).map((axis: any) => ({ name: axis.id, label: axis.label }))
    if (key === 'getCurves') return () => (model?.curves ?? []).map((curve: any) => ({ name: curve.id, label: curve.label, entries: curve.values }))
    if (key === 'getOptions') return () => model ? { min: model.min, max: model.max ?? null, ticks: model.ticks, graticule: model.graticule, showLegend: model.showLegend } : {}
  }
  // Same-named public semantic fields need no schema conversion.
  if (/^get[A-Z]/.test(key)) {
    const property = key[3]!.toLowerCase() + key.slice(4)
    if (model && Object.hasOwn(model, property)) return () => model[property]
  }
  return undefined
}

const AST_NAMES: Record<string, string> = { pie: 'Pie', packet: 'Packet', radar: 'Radar', architecture: 'Architecture', gitgraph: 'GitGraph', treemap: 'Treemap', eventmodeling: 'EventModel' }
function kanbanNodes(model: any): any[] { return (model?.columns ?? []).flatMap((column: any) => [{ ...column, level: 0 }, ...column.tasks.map((task: any) => ({ ...task, level: 1, parentId: column.id }))]) }
export function nativeAst(name: string, source: string): any {
  const family = name.toLowerCase()
  try {
    const events: ParserObservation[] = []
    const model = withParserObservation(family, event => events.push(event), () => parseForAst(family, source))
    const envelope = normalizeMermaidSource(source)
    const common = { $type: AST_NAMES[family] ?? name, title: model.title, accTitle: model.accessibilityTitle ?? envelope.accessibility.title, accDescr: model.accessibilityDescription ?? envelope.accessibility.descr }
    let value: any
    if (family === 'pie') value = { ...common, showData: model.showData, sections: model.entries.map((entry: any) => ({ $type: 'PieSection', label: entry.label, value: entry.value })) }
    else if (family === 'packet') {
      const consumed = events.filter(event => event.unit === 'statement' && event.kind === 'field')
      value = { ...common, blocks: model.fields.map((field: any, index: number) => ({ $type: 'PacketBlock', label: field.label,
        ...(consumed[index]?.text?.trimStart().startsWith('+') ? { bits: field.end - field.start + 1 } : { start: field.start, ...(/^\d+\s*-/.test(consumed[index]?.text?.trimStart() ?? '') ? { end: field.end } : {}) }) })) }
    } else if (family === 'eventmodeling') {
      const body = model as EventModelingBody
      const authoredTypes = new Map<string, string>()
      for (const event of events) {
        if (event.unit !== 'statement') continue
        const frame = event.text?.match(/^(?:tf|timeframe|rf|resetframe)\s+(\d{1,3})\s+(\w+)/)
        if (frame) authoredTypes.set(frame[1]!, frame[2]!)
      }
      const frames = body.frames.map(frame => {
        const authored = authoredTypes.get(frame.id)
        return { $type: frame.reset ? 'EmResetFrame' : 'EmTimeFrame', name: frame.id, entityIdentifier: frame.entity,
          // Preserve a grammar spelling only when it denotes the actual native
          // value. No upstream expectation or reconstructed geometry is read.
          modelEntityType: authored && eventType(authored) === frame.type ? authored : frame.type,
          sourceFrames: frame.sources.map(id => ({ $refText: id })),
        }
      })
      value = { ...common, frames, modelEntities: body.entities.map(name => ({ name })),
        dataEntities: Object.entries(body.data).map(([name, data]) => ({ name, ...data })),
        noteEntities: body.notes.map(note => ({ sourceFrame: { $refText: note.frame }, ...note.data })),
        gwtEntities: body.specifications.map(spec => ({ sourceFrame: { $refText: spec.frame }, givenStatements: spec.given, whenStatements: spec.when, thenStatements: spec.then })),
      }
    } else if (family === 'architecture') {
      const item = (type: string, entity: any) => ({ $type: type, id: entity.id, title: entity.label === entity.id ? undefined : entity.label, icon: entity.icon, iconText: entity.iconText, in: entity.parentId })
      value = { ...common, groups: model.groups.map((entity: any) => item('Group', entity)), services: model.services.map((entity: any) => item('Service', entity)), junctions: model.junctions.map((entity: any) => item('Junction', entity)),
        edges: model.edges.map((edge: any) => ({ $type: 'Edge', lhsId: edge.source.id, rhsId: edge.target.id, lhsDir: edge.source.side, rhsDir: edge.target.side, lhsGroup: edge.source.boundary === 'group', rhsGroup: edge.target.boundary === 'group', lhsInto: edge.hasArrowStart, rhsInto: edge.hasArrowEnd, title: edge.label })),
        alignments: model.alignments.map((alignment: any) => ({ $type: 'Alignment', ...alignment })) }
    }
    else return unavailable(`${name}: lossless grammar AST schema is not yet adapted`)
    return { value, lexerErrors: [], parserErrors: [] }
  } catch (error) {
    return { value: { $type: AST_NAMES[family] ?? name }, lexerErrors: [], parserErrors: [{ message: String(error) }] }
  }
}
