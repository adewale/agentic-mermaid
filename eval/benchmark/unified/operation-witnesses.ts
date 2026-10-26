import type { BenchmarkStatus } from './types.ts'

type Diagram = { kind: string; body: Record<string, any>; meta?: Record<string, any> }
type Result<T> = { ok: true; value: T } | { ok: false; error: unknown }
type Operation = Record<string, any> & { kind: string }
type Field = { name: string; required: boolean; type: string }
export interface OperationWitnessApi {
  describeOps(family: string): Record<string, Field[]>
  validateOp(family: string, operation: unknown): unknown
  mutate(diagram: any, operation: any): Result<any>
  mutateChecked?(diagram: any, operation: unknown): Result<any>
  parseRegisteredMermaid(source: string): Result<any>
  serializeMermaid(diagram: any): string
}
export interface OperationWitnessResult {
  kind: string
  positive: { status: BenchmarkStatus; findings: string[]; detail: string; source?: string; inputSource?: string; requestedOperation?: Operation }
  rejection: { status: BenchmarkStatus; findings: string[]; detail: string; error?: unknown; requestedOperation?: Operation; inputSource?: string }
}
interface Recipe {
  operation: Operation
  setup?: Operation[]
  expected(diagram: Diagram): boolean
  detail: string
}
const ADDED = 'witness_added'
const CHANGED = 'witness_changed'
const CLASS = 'BenchmarkWitnessStyle'
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))
const snapshot = (value: unknown): string => JSON.stringify(value, (_key, item) => (item instanceof Map ? [...item] : item instanceof Set ? [...item] : item))
const rows = (value: any): any[] => (value instanceof Map ? [...value.values()] : Array.isArray(value) ? value : [])
const flatten = (value: any, child = 'children'): any[] => rows(value).flatMap(item => [item, ...flatten(item?.[child], child)])
export function typedBodyContains(body: unknown, witness: string): boolean {
  if (!body || typeof body !== 'object' || ['opaque', 'preserved'].includes((body as { kind?: string }).kind ?? '')) return false
  const seen = new Set<unknown>()
  const visit = (value: any): boolean => {
    if (value === witness) return true
    if (!value || typeof value !== 'object' || seen.has(value)) return false
    seen.add(value)
    if (value instanceof Map) return [...value.values()].some(visit)
    if (Array.isArray(value)) return value.some(visit)
    return Object.entries(value).some(([key, entry]) => !['canonicalSource', 'originalSource', 'raw', 'signature', 'statements', 'sourceText', 'lines'].includes(key) && visit(entry))
  }
  return visit(body)
}
function collection(diagram: Diagram, noun: string): any[] {
  const body = diagram.body
  switch (noun) {
    case 'node':
      if (body.graph) return rows(body.graph.nodes)
      if (body.root) return body.kind === 'block' ? flatten(body.root.children) : flatten([body.root])
      return body.kind === 'requirement' ? [...rows(body.requirements), ...rows(body.elements)] : flatten(body.nodes)
    case 'subgraph':
      return flatten(body.graph?.subgraphs)
    case 'fragment':
      return rows(body.statements)
        .filter(statement => statement.kind === 'fragment')
        .map(statement => statement.fragment)
    case 'fragment_branch':
      return collection(diagram, 'fragment')[0]?.branches ?? []
    case 'fragment_message':
      return collection(diagram, 'fragment_branch')[0]?.messages ?? []
    case 'state':
      return rows(body.states)
    case 'participant':
      return rows(body.participants)
    case 'message':
      return rows(body.messages)
    case 'section':
      return rows(body.sections)
    case 'period':
      return rows(body.sections?.[0]?.periods)
    case 'event':
      return rows(body.sections?.[0]?.periods?.[0]?.events)
    case 'task':
      return rows(body.sections?.[0]?.tasks ?? body.columns?.[0]?.tasks)
    case 'class':
      return rows(body.classes)
    case 'entity':
      return rows(body.entities)
    case 'service':
      return rows(body.services)
    case 'group':
      return rows(body.groups)
    case 'junction':
      return rows(body.junctions)
    case 'axis':
      return rows(body.axes)
    case 'curve':
      return rows(body.curves)
    case 'series':
      return rows(body.series)
    case 'point':
      return rows(body.points)
    case 'slice':
      return rows(body.slices)
    case 'field':
      return rows(body.fields)
    case 'column':
      return rows(body.columns)
    case 'commit':
      return rows(body.commits)
    case 'transition':
      return rows(body.transitions)
    case 'note':
      return rows(body.notes)
    case 'floating_note':
      return rows(body.floatingNotes)
    case 'element':
      return rows(body.elements)
    case 'boundary':
      return rows(body.boundaries)
    case 'requirement':
      return rows(body.requirements)
    case 'relation':
      return rows(body.relations)
    case 'relationship':
      return rows(body.relationships)
    case 'directive':
      return rows(body.directives)
    case 'block':
      return flatten(body.root?.children)
    case 'cause':
      return rows(body.nodes).filter(node => node.parentId)
    case 'link':
      return rows(body.links)
    case 'edge':
      return rows(body.graph?.edges ?? body.edges)
    default:
      return []
  }
}
function idOf(row: any): string | undefined {
  return row?.id ?? row?.name ?? row?.label
}
function fieldEquals(value: unknown, expected: unknown) {
  return snapshot(value) === snapshot(expected)
}
function itemMeaning(noun: string, item: any): unknown {
  const nullable = (value: unknown) => value ?? null
  switch (noun) {
    case 'axis':
      return { id: item.id, label: nullable(item.label) }
    case 'curve':
      return { id: item.id, label: nullable(item.label), values: item.values }
    case 'series':
      return { kind: item.kind, name: nullable(item.name), values: item.values }
    case 'slice':
      return { label: item.label, value: item.value }
    case 'field':
      return { label: item.label, bits: item.end - item.start + 1 }
    case 'message':
      return { from: item.from, to: item.to, text: item.text, style: item.style, wrap: nullable(item.wrap) }
    case 'event':
      return { text: item.text }
    case 'period':
      return { label: item.label, events: rows(item.events).map(event => itemMeaning('event', event)) }
    case 'task':
      return { label: nullable(item.label), text: nullable(item.text), score: nullable(item.score), actors: nullable(item.actors), start: nullable(item.start), end: nullable(item.end), tags: nullable(item.tags), metadata: nullable(item.metadata) }
    case 'section':
      return { label: nullable(item.label), tasks: rows(item.tasks).map(task => itemMeaning('task', task)), periods: rows(item.periods).map(period => itemMeaning('period', period)) }
    case 'column':
      return { id: item.id, label: item.label, metadata: item.metadata, tasks: rows(item.tasks).map(task => ({ id: task.id, ...(itemMeaning('task', task) as object) })) }
    default:
      return { id: nullable(item.id), label: nullable(item.label), text: nullable(item.text), name: nullable(item.name) }
  }
}
function radarAxisValues(diagram: Diagram): unknown {
  const axes = collection(diagram, 'axis')
  return collection(diagram, 'curve')
    .map(curve => ({ id: curve.id, valuesByAxis: axes.map((axis, index) => [axis.id, curve.values[index]]).sort(([left], [right]) => String(left).localeCompare(String(right))) }))
    .sort((left, right) => left.id.localeCompare(right.id))
}
function endpoints(edge: any): [string | undefined, string | undefined] {
  const from = edge.from ?? edge.source ?? edge.start ?? edge.src,
    to = edge.to ?? edge.target ?? edge.end ?? edge.dst
  return [typeof from === 'object' ? from.id : from, typeof to === 'object' ? to.id : to]
}
function endpointPairs(diagram: Diagram): [string | undefined, string | undefined][] {
  const body = diagram.body
  const stateTransitions = (states: any[]): any[] => states.flatMap(state => [...rows(state.transitions), ...stateTransitions(rows(state.states))])
  const fragmentMessages = (fragment: any): any[] => rows(fragment.branches).flatMap(branch => [...rows(branch.messages), ...rows(branch.fragments).flatMap(fragmentMessages)])
  return [...rows(body.graph?.edges ?? body.edges), ...rows(body.relations), ...rows(body.transitions), ...rows(body.messages), ...rows(body.links), ...rows(body.relationships), ...stateTransitions(rows(body.states)), ...collection(diagram, 'fragment').flatMap(fragmentMessages)].map(endpoints)
}
function endpointPreservation(before: Diagram, after: Diagram, operation: Operation): string[] {
  let expected = endpointPairs(before)
  const pairKey = (pairs: [string | undefined, string | undefined][]) => snapshot(pairs.map(pair => snapshot(pair)).sort())
  if (operation.kind.startsWith('rename_') && typeof operation.from === 'string' && typeof operation.to === 'string') {
    expected = expected.map(pair => pair.map(id => (id === operation.from ? operation.to : id)) as [string, string])
  } else if (!/^(?:set_|move_|reparent_|reorder_|update_)/.test(operation.kind) && !(operation.kind.startsWith('add_') && !['add_edge', 'add_transition', 'add_message', 'add_relation', 'add_relationship', 'add_fragment_message', 'add_interface', 'add_link'].includes(operation.kind))) return []
  return pairKey(endpointPairs(after)) === pairKey(expected) ? [] : ['Operation changed unrelated endpoint identities or relation multiplicity']
}
function selectors(row: any): Record<string, unknown> {
  const id = idOf(row)
  return { id, target: id, class: id, entity: id, curve: id, index: 0, sectionIndex: 0, taskIndex: 0, periodIndex: 0, eventIndex: 0, seriesIndex: 0, fragmentIndex: 0, branchIndex: 0 }
}

/** The menu only admits operands. Expected values below are authored literals,
 * and predicates inspect typed body fields rather than source/description echoes. */
export function operationRecipe(api: Pick<OperationWitnessApi, 'validateOp' | 'describeOps'>, family: string, kind: string, fields: Field[], diagram: Diagram): Recipe | undefined {
  const fieldNames = new Set(['kind', ...fields.map(field => field.name)])
  const admit = (payload: Record<string, unknown>, expected: Recipe['expected'], detail: string): Recipe | undefined => {
    const operation = Object.fromEntries(Object.entries({ kind, ...payload }).filter(([name, value]) => fieldNames.has(name) && value !== undefined)) as Operation
    return api.validateOp(family, operation) === null ? { operation, expected, detail } : undefined
  }
  const property = (key: string, value: unknown, payload: Record<string, unknown> = { [key]: value }) => admit(payload, after => fieldEquals(after.body[key], value), `Independent authored ${key} value in the typed body`)
  if (kind === 'set_title') return property('title', CHANGED)
  if (kind === 'set_accessibility_title') return property('accessibilityTitle', CHANGED, { title: CHANGED })
  if (kind === 'set_accessibility_description') return property('accessibilityDescription', CHANGED, { description: CHANGED })
  if (kind === 'set_direction') return admit({ direction: 'LR' }, after => (after.body.graph?.direction ?? after.body.direction) === 'LR', 'Authored LR orientation in the typed graph')
  if (kind === 'set_orientation') return property('horizontal', true)
  if (kind === 'set_show_data') return property('showData', true)
  if (kind === 'set_columns') return admit({ columns: 3 }, after => after.body.root?.columns === 3, 'Authored three-column block grid')
  if (kind === 'set_effect') return admit({ label: CHANGED }, after => after.body.nodes?.[0]?.label === CHANGED, 'The Ishikawa effect receives the requested label')
  if (kind === 'set_config') return admit({ ticks: 7 }, after => after.body.ticks === 7, 'Authored radar tick count')
  if (kind === 'set_x_axis') return admit({ axis: { categories: [CHANGED, 'Second'] } }, after => fieldEquals(after.body.xAxis?.categories, [CHANGED, 'Second']), 'Authored categorical x-axis labels')
  if (kind === 'set_y_axis') return admit({ axis: { range: { min: 0, max: 137 } } }, after => after.body.yAxis?.range?.min === 0 && after.body.yAxis?.range?.max === 137, 'Authored numeric y-axis bounds')
  if (kind === 'set_variant') return property('variant', 'C4Container')
  if (kind === 'set_data_point') return admit({ seriesIndex: 0, index: 0, value: 73 }, after => after.body.series?.[0]?.values?.[0] === 73, 'Authored first data point')
  if (kind === 'set_curve_value') {
    const curve = collection(diagram, 'curve')[0],
      axis = collection(diagram, 'axis')[0]
    if (!curve || !axis) return
    return admit({ curve: idOf(curve), axis: idOf(axis), value: 73 }, after => collection(after, 'curve')[0]?.values?.[0] === 73, 'Authored first-axis value for the selected curve')
  }
  if (kind === 'set_transition_style') return admit({ index: 0, style: 'stroke:#123456' }, after => collection(after, 'transition')[0]?.style?.stroke === '#123456', 'Requested transition style at its owned index')
  if (kind === 'update_edge') return admit({ index: 0, label: CHANGED }, after => collection(after, 'edge')[0]?.label === CHANGED, 'Requested edge label on its selected index')
  if (['rename_section', 'rename_task', 'rename_slice', 'rename_point'].includes(kind)) {
    const noun = kind.slice(7),
      before = collection(diagram, noun)[0]
    if (!before) return
    return admit({ index: 0, sectionIndex: 0, taskIndex: 0, label: CHANGED, from: before.label, to: CHANGED }, after => collection(after, noun)[0]?.label === CHANGED, 'Requested label is attached to the same typed collection position')
  }
  if (kind === 'set_slice_value') {
    const slice = collection(diagram, 'slice')[0]
    if (!slice) return
    return admit({ label: slice.label, value: 73 }, after => collection(after, 'slice')[0]?.label === slice.label && collection(after, 'slice')[0]?.value === 73, 'The requested slice keeps its label and receives its authored value')
  }
  if (kind === 'move_point') {
    const point = collection(diagram, 'point')[0]
    if (!point) return
    return admit({ label: point.label, x: 0.17, y: 0.83 }, after => collection(after, 'point')[0]?.label === point.label && collection(after, 'point')[0]?.x === 0.17 && collection(after, 'point')[0]?.y === 0.83, 'The selected point receives its requested coordinates')
  }
  if (kind === 'set_value') {
    const target = collection(diagram, 'node').find(node => typeof node.value === 'number')
    if (!target) return
    return admit({ id: idOf(target), value: 73 }, after => collection(after, 'node').some(node => node.label === target.label && node.value === 73), 'Requested numeric node value survives source round-trip')
  }
  if (kind === 'rename_actor') {
    const actor = collection(diagram, 'task')[0]?.actors?.[0]
    if (!actor) return
    return admit({ from: actor, to: CHANGED }, after => collection(after, 'task').some(task => task.actors.includes(CHANGED)) && !collection(after, 'task').some(task => task.actors.includes(actor)), 'Requested actor identity replaces the prior actor in task ownership')
  }
  if (kind === 'set_task_status') return admit({ sectionIndex: 0, taskIndex: 0, status: 'done' }, after => collection(after, 'task')[0]?.tags.includes('done'), 'Authored completed status is present')
  if (kind === 'set_task_dates') return admit({ sectionIndex: 0, taskIndex: 0, start: '2026-02-01', end: '4d' }, after => collection(after, 'task')[0]?.start === '2026-02-01' && collection(after, 'task')[0]?.end === '4d', 'Authored task start and duration')
  if (kind === 'set_task_flags') return admit({ sectionIndex: 0, taskIndex: 0, vert: true }, after => collection(after, 'task')[0]?.tags.includes('vert'), 'Authored vertical-marker task flag')
  if (kind === 'set_task_id') {
    const before = collection(diagram, 'task'),
      oldId = before[0]?.taskId
    return admit(
      { sectionIndex: 0, taskIndex: 0, taskId: CHANGED },
      after => collection(after, 'task')[0]?.taskId === CHANGED && before.every((task, index) => task.start !== `after ${oldId}` || collection(after, 'task')[index]?.start === `after ${CHANGED}`),
      'Requested task identity and any single predecessor reference in this fixture remain coherent',
    )
  }
  if (kind === 'set_task_metadata') {
    const task = collection(diagram, 'task')[0]
    if (!task) return
    return admit({ id: task.id, metadata: { priority: CHANGED } }, after => collection(after, 'task')[0]?.metadata?.priority === CHANGED, 'Requested card metadata is owned by its typed task')
  }
  if (family === 'kanban' && ['set_icon', 'set_class'].includes(kind)) {
    const task = collection(diagram, 'task')[0]
    if (!task) return
    return admit({ id: task.id, icon: 'fa:fa-star', className: CLASS }, after => (kind === 'set_icon' ? collection(after, 'task')[0]?.metadata?.icon === 'fa:fa-star' : collection(after, 'task')[0]?.className === CLASS), 'Requested card decoration is stored in owned metadata')
  }
  const reorder = /^(?:reorder|move)_(message|field|column|section|series|axis|curve|slice)$/.exec(kind)
  if (reorder) {
    const noun = reorder[1]!,
      before = collection(diagram, noun)
    if (before.length < 2) return
    const expected = [itemMeaning(noun, before[1]), itemMeaning(noun, before[0]), ...before.slice(2).map(row => itemMeaning(noun, row))]
    return admit(
      { from: 0, to: 1, id: idOf(before[0]), index: 1 },
      after =>
        fieldEquals(
          collection(after, noun).map(row => itemMeaning(noun, row)),
          expected,
        ) &&
        (noun !== 'axis' || fieldEquals(radarAxisValues(after), radarAxisValues(diagram))),
      'Exact item order and owned values survive the move; radar axis-to-curve associations remain unchanged',
    )
  }
  if (['move_period', 'move_event', 'move_task'].includes(kind)) {
    const noun = kind.slice(5),
      before = collection(diagram, noun)
    if (kind === 'move_task' && fieldNames.has('column')) {
      const columns = collection(diagram, 'column'),
        task = before[0]
      if (columns.length < 2 || !task) return
      return admit({ id: task.id, column: columns[1].id, index: 0 }, after => after.body.columns[1]?.tasks?.[0]?.label === task.label && !after.body.columns[0]?.tasks.some((item: any) => item.label === task.label), 'The selected card moves between columns with its label preserved')
    }
    if (kind === 'move_task' && before.length === 1 && diagram.body.sections?.length >= 2) {
      const task = before[0],
        key = task.label === undefined ? 'text' : 'label'
      return admit({ fromSection: 0, fromIndex: 0, toSection: 1, toIndex: 0 }, after => after.body.sections[0].tasks.length === 0 && after.body.sections[1].tasks[0]?.[key] === task[key], 'The exact task moves into the next section without changing its authored text')
    }
    if (before.length < 2) return
    return admit(
      { fromSection: 0, fromPeriod: 0, fromIndex: 0, toSection: 0, toPeriod: 0, toIndex: 1 },
      after =>
        fieldEquals(
          collection(after, noun).map(row => itemMeaning(noun, row)),
          [itemMeaning(noun, before[1]), itemMeaning(noun, before[0]), ...before.slice(2).map(row => itemMeaning(noun, row))],
        ),
      'Scoped movement preserves each sibling and every moved item’s owned text, values and metadata',
    )
  }
  if (kind === 'add_event') return admit({ sectionIndex: 0, periodIndex: 0, text: ADDED }, after => collection(after, 'event').some(event => event.text === ADDED), 'Authored timeline event is owned by the selected period')
  if (kind === 'set_event_text') return admit({ sectionIndex: 0, periodIndex: 0, eventIndex: 0, text: CHANGED }, after => collection(after, 'event')[0]?.text === CHANGED, 'Authored text at the selected event position')
  if (kind === 'remove_event') {
    const before = collection(diagram, 'event')
    if (!before.length) return
    return admit(
      { sectionIndex: 0, periodIndex: 0, eventIndex: 0 },
      after =>
        fieldEquals(
          collection(after, 'event').map(event => event.text),
          before.slice(1).map(event => event.text),
        ),
      'Exact event removal preserves the remaining authored event order',
    )
  }
  if (['update_requirement', 'update_element', 'update_boundary', 'update_relationship', 'update_block'].includes(kind)) {
    const noun = kind.slice(7),
      existing = collection(diagram, noun)[0]
    if (!existing) return
    const property = noun === 'requirement' ? 'text' : noun === 'element' && family === 'requirement' ? 'type' : 'label'
    return admit({ id: idOf(existing), changes: { [property]: CHANGED } }, after => collection(after, noun)[0]?.[property] === CHANGED, 'Requested nested update is attached to the selected typed object')
  }
  if (kind === 'add_relation' && family === 'requirement') {
    const from = collection(diagram, 'element')[0]?.name,
      to = collection(diagram, 'requirement')[0]?.name
    if (!from || !to) return
    return admit({ relation: { id: ADDED, type: 'satisfies', src: from, dst: to } }, after => collection(after, 'relation').some(relation => relation.src === from && relation.dst === to && relation.type === 'satisfies'), 'Authored Requirement relationship endpoints and kind')
  }
  if (kind === 'add_fragment') return admit({ fragmentKind: 'alt', label: ADDED }, after => collection(after, 'fragment').some(fragment => fragment.fragmentKind === 'alt' && fragment.label === ADDED), 'Authored alt fragment and its label')
  if (kind === 'add_fragment_branch') return admit({ fragmentIndex: 0, label: ADDED }, after => collection(after, 'fragment_branch').some(branch => branch.label === ADDED), 'Authored branch label in the selected fragment')
  if (kind === 'add_fragment_message') {
    const participants = collection(diagram, 'participant'),
      from = idOf(participants[0]),
      to = idOf(participants[1])
    if (!from || !to) return
    return admit({ fragmentIndex: 0, branchIndex: 0, from, to, text: ADDED }, after => collection(after, 'fragment_message').some(message => message.from === from && message.to === to && message.text === ADDED), 'The authored message belongs to the requested fragment branch and endpoint pair')
  }
  if (kind === 'make_composite') {
    const first = collection(diagram, 'state')[0]
    if (!first) return
    return admit({ id: ADDED, members: [first.id] }, after => after.body.states.some((state: any) => state.id === ADDED && state.states?.some((child: any) => child.id === first.id)), 'The requested existing state becomes a member of the new composite')
  }
  if (kind === 'dissolve_composite') {
    const composite = collection(diagram, 'state').find(state => state.id === 'prepared_composite')
    if (!composite) return
    const members = composite.states.map((state: any) => state.id)
    return admit({ id: composite.id }, after => !collection(after, 'state').some(state => state.id === composite.id) && members.every((id: string) => collection(after, 'state').some(state => state.id === id)), 'Composite removal hoists its exact authored members')
  }
  if (kind === 'move_state') {
    const target = collection(diagram, 'state').find(state => state.id !== 'prepared_composite')
    if (!target) return
    return admit({ id: target.id, parent: 'prepared_composite' }, after => after.body.states.find((state: any) => state.id === 'prepared_composite')?.states?.some((state: any) => state.id === target.id), 'Requested state ownership moves into the prepared composite')
  }
  if (kind === 'move_node' && diagram.body.graph) {
    const target = collection(diagram, 'node')[0]
    if (!target) return
    return admit({ id: target.id, subgraph: 'prepared_group' }, after => collection(after, 'subgraph').some(group => group.id === 'prepared_group' && group.nodeIds?.includes(target.id)), 'Requested graph node membership belongs to the prepared group')
  }
  if (kind === 'move_node' && diagram.body.root) {
    const target = collection(diagram, 'node').find(node => node.children?.length && node.id !== diagram.body.root.id)?.children?.[0]
    if (!target) return
    return admit({ id: target.id, parent: diagram.body.root.id }, after => after.body.root.children.some((node: any) => node.id === target.id), 'A nested authored node moves to the requested root parent')
  }
  if (kind === 'move_node' || kind === 'move_cause') {
    const target = collection(diagram, kind === 'move_cause' ? 'cause' : 'node').find(node => node.parentId && (kind !== 'move_cause' || node.parentId !== diagram.body.nodes[0]?.id))
    if (!target) return
    const parent = kind === 'move_cause' ? diagram.body.nodes[0].id : undefined
    return admit({ id: target.id, parentId: parent }, after => collection(after, kind === 'move_cause' ? 'cause' : 'node').some(node => node.label === target.label && node.parentId === parent), 'The exact authored item is reparented to the requested ownership scope')
  }
  if (kind === 'move_block') {
    const before = collection(diagram, 'block')
    if (before.length < 2) return
    return admit({ id: before[0].id, index: 1 }, after => after.body.root.children[1]?.id === before[0].id, 'Exact root block ordering after the requested move')
  }
  if (kind === 'move_service' || kind === 'move_junction') {
    const noun = kind.slice(5),
      target = collection(diagram, noun)[0]
    if (!target) return
    const group = target.parentId ? null : collection(diagram, 'group')[0]?.id
    if (group === undefined) return
    return admit({ id: target.id, group }, after => collection(after, noun)[0]?.parentId === (group ?? undefined), 'The selected architecture item moves to its requested group or root')
  }
  if (kind === 'rename_node' && family === 'sankey') {
    const before = collection(diagram, 'link'),
      from = before[0]?.source
    if (!from) return
    return admit(
      { from, to: CHANGED },
      after =>
        fieldEquals(
          collection(after, 'link'),
          before.map(link => ({ ...link, source: link.source === from ? CHANGED : link.source, target: link.target === from ? CHANGED : link.target })),
        ),
      'Sankey rename rewrites all and only matching endpoints, preserving values and multiplicity',
    )
  }
  if (kind === 'reparent_element' || kind === 'reparent_boundary') {
    const noun = kind.slice(9),
      target = collection(diagram, noun)[0]
    if (!target) return
    return admit({ id: target.id, parentId: 'prepared_target' }, after => collection(after, noun).some(row => row.id === target.id && row.parentId === 'prepared_target'), 'Selected C4 declaration receives its requested parent boundary')
  }
  if (kind === 'add_directive') return admit({ name: 'UpdateLayoutConfig', args: [{ name: 'c4ShapeInRow', value: '3' }] }, after => collection(after, 'directive').some(directive => directive.name === 'UpdateLayoutConfig' && after.body.layout?.shapesPerRow === 3), 'Authored C4 layout parameter and value are retained')
  if (kind === 'update_directive') {
    const directive = collection(diagram, 'directive')[0]
    if (!directive) return
    return admit({ id: directive.id, args: [{ name: 'c4ShapeInRow', value: '4' }] }, after => collection(after, 'directive').some(directive => directive.name === 'UpdateLayoutConfig') && after.body.layout?.shapesPerRow === 4, 'The selected directive receives its requested parameter value')
  }
  if (kind === 'create_branch') return admit({ name: ADDED }, after => after.body.branches.some((branch: any) => branch.name === ADDED), 'Authored branch name exists in the typed branch list')
  if (kind === 'checkout_branch') return admit({ name: 'prepared_branch' }, after => after.body.statements.at(-1)?.kind === 'checkout' && after.body.statements.at(-1)?.branch === 'prepared_branch', 'Explicit final checkout targets the requested branch')
  if (kind === 'rename_branch') return admit({ from: 'prepared_branch', to: CHANGED }, after => after.body.branches.some((branch: any) => branch.name === CHANGED) && !after.body.branches.some((branch: any) => branch.name === 'prepared_branch'), 'The authored branch identity replaces its prior name')
  if (kind === 'merge_branch') return admit({ name: 'prepared_branch', id: ADDED }, after => after.body.commits.some((commit: any) => commit.id === ADDED && commit.parents?.includes('prepared_commit')), 'Requested merge commit includes the prepared branch head as a parent')
  if (kind === 'cherry_pick') return admit({ id: 'prepared_commit', tags: [ADDED] }, after => after.body.commits.some((commit: any) => commit.source === 'cherry-pick' && commit.tags?.includes(ADDED)), 'Cherry-pick records its authored tag and semantic source kind')
  if (kind === 'set_axis_labels') return admit({ axis: 'x', near: CHANGED }, after => after.body.xAxis?.[0] === CHANGED || after.body.xAxis?.near === CHANGED, 'Authored near x-axis label')
  if (kind === 'set_quadrant_label') return admit({ quadrant: 1, label: CHANGED }, after => after.body.quadrants?.[0] === CHANGED, 'Authored first quadrant label')
  if (kind === 'define_class')
    return admit(
      { name: CLASS, style: 'fill:#123456' },
      after => {
        const definitions = after.body.graph?.classDefs ?? after.body.classDefs
        return definitions instanceof Map ? definitions.has(CLASS) : Array.isArray(definitions) ? definitions.some(entry => entry.name === CLASS || entry.id === CLASS) : !!definitions?.[CLASS]
      },
      'Authored style definition exists under its requested name',
    )
  if (kind === 'add_subgraph') return admit({ id: ADDED, label: ADDED }, after => collection(after, 'subgraph').some(row => row.id === ADDED && row.label === ADDED), 'An independently named empty group exists')
  if (kind === 'add_link') return admit({ source: ADDED, target: 'witness_sink', value: 7 }, after => collection(after, 'link').some(row => row.source === ADDED && row.target === 'witness_sink' && row.value === 7), 'Authored Sankey endpoints and value exist together')
  if (kind === 'set_link_value') {
    const link = collection(diagram, 'link')[0]
    if (!link) return
    return admit({ source: link.source, target: link.target, value: 73 }, after => collection(after, 'link').some(row => row.source === link.source && row.target === link.target && row.value === 73), 'Only the selected endpoint pair receives its requested value')
  }
  if (['add_edge', 'add_transition', 'add_message', 'add_relation', 'add_relationship'].includes(kind)) {
    const noun = kind.slice(4),
      entities = ['node', 'state', 'participant', 'class', 'entity', 'service', 'element', 'block'].map(name => collection(diagram, name)).find(items => items.length >= 2)
    if (!entities) return
    const from = idOf(entities[0]),
      to = idOf(entities[1]),
      existing = collection(diagram, noun)
    const payload = { from, to, fromSide: 'R', toSide: 'L', text: ADDED, label: ADDED, relKind: 'association', leftCard: 'one-only', rightCard: 'zero-or-many', relationship: { from, to, label: ADDED } }
    return admit(
      payload,
      after => {
        const actual = collection(after, noun),
          matching = actual.filter(row => fieldEquals(endpoints(row), [from, to]) && (row.label === ADDED || row.text === ADDED))
        return actual.length === existing.length + 1 && matching.length === 1 && existing.every(edge => actual.filter(row => fieldEquals(endpoints(row), endpoints(edge))).length >= existing.filter(row => fieldEquals(endpoints(row), endpoints(edge))).length)
      },
      'One authored labeled relation is added without losing prior endpoint multiplicities',
    )
  }
  if (kind === 'remove_edge') {
    const before = collection(diagram, 'edge'),
      edge = before[0]
    if (!edge) return
    const pair = endpoints(edge),
      count = before.filter(row => fieldEquals(endpoints(row), pair)).length
    return admit({ id: edge.id ?? `${pair[0]}->${pair[1]}`, index: 0 }, after => collection(after, 'edge').length === before.length - 1 && collection(after, 'edge').filter(row => fieldEquals(endpoints(row), pair)).length === count - 1, 'Exactly one selected endpoint occurrence is removed')
  }
  if (kind === 'add_note' || kind === 'add_floating_note') {
    const target = idOf(collection(diagram, 'state')[0] ?? collection(diagram, 'class')[0])
    return admit({ id: ADDED, target, for: target, text: ADDED }, after => collection(after, kind === 'add_note' ? 'note' : 'floating_note').some(note => note.text === ADDED), 'Requested note text is owned by the typed note collection')
  }
  if (kind === 'set_service_icon_text') {
    const service = collection(diagram, 'service')[0]
    if (!service) return
    return admit({ id: idOf(service), text: CHANGED }, after => collection(after, 'service')[0]?.iconText === CHANGED, 'Requested service icon text')
  }
  if (kind === 'add_member' || kind === 'add_attribute' || kind === 'add_interface') {
    const noun = kind === 'add_attribute' ? 'entity' : 'class',
      owner = collection(diagram, noun)[0]
    if (!owner) return
    return admit(
      { class: idOf(owner), entity: idOf(owner), text: kind === 'add_attribute' ? `string ${ADDED}` : `+${ADDED}()`, label: ADDED },
      after => {
        const actual = collection(after, noun)[0]
        return kind === 'add_interface'
          ? collection(after, 'class').some(node => node.label === ADDED && node.isInterface === true && collection(after, 'relation').some(relation => relation.from === idOf(owner) && relation.to === node.id && relation.kind === 'lollipop'))
          : kind === 'add_member'
            ? rows(actual.members).includes(`+${ADDED}()`)
            : rows(actual.attributes).some(attribute => attribute.text === `string ${ADDED}`)
      },
      'Requested authored class member, interface or ER attribute exists in its owning typed collection',
    )
  }
  if (kind === 'remove_member' || kind === 'remove_attribute') {
    const noun = kind === 'remove_member' ? 'class' : 'entity',
      listName = kind === 'remove_member' ? 'members' : 'attributes',
      owners = collection(diagram, noun),
      index = owners.findIndex(owner => rows(owner[listName]).length)
    if (index < 0) return
    const owner = owners[index],
      before = rows(owner[listName])
    return admit({ class: idOf(owner), entity: idOf(owner), index: 0 }, after => fieldEquals(rows(collection(after, noun)[index]?.[listName]), before.slice(1)), 'The exact selected member/attribute is removed and the remaining order is preserved')
  }
  const style = /^set_(node|state|class|entity|css)_(style|class)$/.exec(kind)
  if (style) {
    const noun = style[1] === 'css' ? 'class' : style[1]!,
      existing = collection(diagram, noun)[0]
    if (!existing) return
    const id = idOf(existing),
      assignment = style[2] === 'class',
      recipe = admit(
        { ...selectors(existing), className: CLASS, style: 'fill:#123456' },
        after => {
          const actual = collection(after, noun)[0]
          return assignment
            ? after.body.graph?.classAssignments?.get(id) === CLASS || actual?.className === CLASS || rows(actual?.classes).includes(CLASS) || actual?.cssClass === CLASS
            : after.body.graph?.nodeStyles?.get(id)?.fill === '#123456' || actual?.style?.fill === '#123456' || rows(actual?.styles ?? actual?.cssStyles).includes('fill:#123456')
        },
        'Requested style/class assignment is read from its owned typed field',
      )
    if (recipe && assignment && api.describeOps?.(family)?.define_class) recipe.setup = [{ kind: 'define_class', name: CLASS, style: 'fill:#123456' }]
    return recipe
  }
  const additions: Record<string, Record<string, unknown>> = {
    add_node: { id: ADDED, label: ADDED, value: 7, parent: fields.some(field => field.name === 'parent' && field.required) ? diagram.body.root?.id : undefined },
    add_state: { id: ADDED, label: ADDED },
    add_participant: { id: ADDED, label: ADDED },
    add_class: { id: ADDED, label: ADDED },
    add_entity: { id: ADDED, label: ADDED },
    add_service: { id: ADDED, label: ADDED, icon: 'server' },
    add_group: { id: ADDED, label: ADDED },
    add_junction: { id: ADDED },
    add_section: { label: ADDED },
    add_period: { sectionIndex: 0, label: ADDED, events: ['Benchmark event'] },
    add_column: { id: ADDED, label: ADDED },
    add_task: { sectionIndex: 0, column: idOf(collection(diagram, 'column')[0]), id: ADDED, label: ADDED, text: ADDED, score: 4, actors: ['Benchmark actor'], taskId: ADDED, start: '2026-01-01', end: '3d' },
    add_field: { label: ADDED, bits: 8 },
    add_cause: { label: ADDED },
    add_block: { block: { id: ADDED, label: ADDED } },
    add_element: { element: family === 'requirement' ? { name: ADDED, type: 'test', docRef: '' } : { id: ADDED, label: ADDED, kind: 'system' } },
    add_requirement: { requirement: { name: ADDED, text: ADDED } },
    add_boundary: { boundary: { id: ADDED, label: ADDED, kind: 'system' } },
    add_axis: { id: ADDED, label: ADDED },
    add_curve: { id: ADDED, label: ADDED, values: collection(diagram, 'axis').map(() => 3) },
    add_series: { kind2: 'bar', name: ADDED, values: [3, 7] },
    add_slice: { label: ADDED, value: 7 },
    add_point: { label: ADDED, x: 0.4, y: 0.6 },
    append_commit: { id: ADDED, message: ADDED },
  }
  const addedNoun = kind === 'append_commit' ? 'commit' : kind.slice(4)
  if (additions[kind])
    return admit(
      additions[kind]!,
      after => {
        const added = collection(after, addedNoun)
        return added.length === collection(diagram, addedNoun).length + 1 && added.some(row => idOf(row) === ADDED || row.label === ADDED || row.text === ADDED || row.name === ADDED)
      },
      'One new authored entity is present in its typed collection',
    )
  const setter = /^set_(.+)_(label|text|name|value|values|score|actors|bits|shape|icon|generic|namespace|message|type|tags|wrap)$/.exec(kind)
  if (setter || kind === 'set_label' || kind === 'set_shape' || kind === 'set_icon') {
    const noun = setter?.[1] ?? 'node',
      propertyName = setter?.[2] ?? kind.slice(4),
      existing = collection(diagram, noun)[0]
    if (!existing) return
    const values: Record<string, unknown> = {
      label: CHANGED,
      text: CHANGED,
      name: CHANGED,
      value: 73,
      values: noun === 'curve' ? collection(diagram, 'axis').map(() => 7) : [7, 9],
      score: 5,
      actors: [CHANGED],
      bits: 24,
      shape: existing.shape === 'circle' ? (family === 'mindmap' ? 'rect' : 'rectangle') : 'circle',
      icon: 'fa:fa-star',
      generic: CHANGED,
      namespace: CHANGED,
      message: CHANGED,
      type: 'HIGHLIGHT',
      tags: [CHANGED],
      wrap: true,
    }
    const value = values[propertyName!]
    return admit(
      { ...selectors(existing), [propertyName!]: value },
      after => {
        const actual = noun === 'fragment_branch' && propertyName === 'label' ? collection(after, 'fragment')[0] : collection(after, noun)[0]
        return propertyName === 'bits' ? actual?.end - actual?.start + 1 === value : fieldEquals(actual?.[propertyName!], value)
      },
      `Requested ${propertyName} is read from the selected typed ${noun}; raw source is excluded`,
    )
  }
  const renamer = /^rename_(.+)$/.exec(kind)
  if (renamer && !['actor', 'section', 'task', 'slice', 'point'].includes(renamer[1]!)) {
    const noun = renamer[1]!,
      existing = collection(diagram, noun)[0],
      before = idOf(existing)
    if (!before) return
    return admit({ from: before, to: CHANGED }, after => collection(after, noun).some(row => idOf(row) === CHANGED) && !collection(after, noun).some(row => idOf(row) === before), 'Requested new identity exists and its prior identity is absent')
  }
  const remover = /^remove_(.+)$/.exec(kind)
  if (remover) {
    const noun = remover[1]!,
      prior = collection(diagram, noun)
    let existing = prior[0]
    if (noun === 'node' && diagram.body.root) existing = prior.find(row => row.id !== diagram.body.root.id && !row.children?.length)
    if (noun === 'group') existing = prior.find(row => !collection(diagram, 'service').some(service => service.parentId === row.id) && !prior.some(other => other.parentId === row.id))
    if (!existing) return
    const identityField = ['label', 'text', 'name', 'id'].find(key => typeof existing[key] === 'string' && prior.filter(row => row[key] === existing[key]).length === 1)
    const identity = identityField ? existing[identityField] : undefined
    const index = prior.indexOf(existing)
    return admit(
      { ...selectors(existing), index, cascade: true, recursive: true, removeMembers: true, removeTasks: true, label: existing.label, name: existing.name, source: existing.source, target: existing.target, from: existing.from, to: existing.to },
      after => {
        const actual = collection(after, noun)
        return actual.length < prior.length && (identityField === undefined || !actual.some(row => row[identityField] === identity))
      },
      'The selected typed entity is removed; auto-generated IDs may be renumbered, while its unique authored label/text must disappear',
    )
  }
  return undefined
}

/** Preconditions are authored actions over the existing small fixture. They
 * are not credited as positive witnesses for the operation being prepared. */
function prepareOperation(api: OperationWitnessApi, family: string, kind: string, original: Diagram): Diagram {
  let diagram = original
  const menu = api.describeOps(family)
  const apply = (operation: Operation): void => {
    const fields = new Set(['kind', ...(menu[operation.kind] ?? []).map(field => field.name)])
    const admitted = Object.fromEntries(Object.entries(operation).filter(([key]) => fields.has(key))) as Operation
    const next = api.mutate(diagram, admitted)
    if (!next.ok) throw Error(`Positive fixture precondition ${operation.kind} failed: ${JSON.stringify(next.error)}`)
    diagram = next.value
  }
  if (kind.includes('fragment') && kind !== 'add_fragment' && !collection(diagram, 'fragment').length) apply({ kind: 'add_fragment', fragmentKind: 'alt', label: 'prepared_fragment' })
  if (kind.includes('fragment_message') && kind !== 'add_fragment_message' && !collection(diagram, 'fragment_message').length) {
    const participants = collection(diagram, 'participant')
    apply({ kind: 'add_fragment_message', fragmentIndex: 0, branchIndex: 0, from: participants[0].id, to: participants[1].id, text: 'prepared_message' })
  }
  if (['remove_note', 'set_note_text'].includes(kind) && !collection(diagram, 'note').length) {
    const target = idOf(collection(diagram, 'state')[0] ?? collection(diagram, 'class')[0])
    apply({ kind: 'add_note', target, for: target, text: 'prepared_note' })
  }
  if (['remove_floating_note', 'set_floating_note_text'].includes(kind) && !collection(diagram, 'floating_note').length) apply({ kind: 'add_floating_note', id: 'prepared_note', text: 'prepared_note' })
  if (['remove_subgraph', 'move_node'].includes(kind) && menu.add_subgraph && !collection(diagram, 'subgraph').length) apply({ kind: 'add_subgraph', id: 'prepared_group', label: 'prepared_group' })
  if (['move_state', 'dissolve_composite'].includes(kind)) {
    const first = collection(diagram, 'state')[0]
    apply({ kind: 'make_composite', id: 'prepared_composite', members: [first.id] })
  }
  if (kind === 'move_section') {
    if (diagram.body.kind === 'timeline' && !collection(diagram, 'section')[0]?.label) apply({ kind: 'set_section_label', index: 0, label: 'prepared_original_section' })
    if (collection(diagram, 'section').length < 2) apply({ kind: 'add_section', label: 'prepared_section' })
  }
  if (kind === 'reorder_series' && collection(diagram, 'series').length < 2) apply({ kind: 'add_series', kind2: 'line', name: 'prepared_series', values: collection(diagram, 'series')[0].values.map(() => 9) })
  if (['remove_junction', 'rename_junction', 'move_junction'].includes(kind) && !collection(diagram, 'junction').length) apply({ kind: 'add_junction', id: 'prepared_junction' })
  if (kind === 'remove_group' && menu.add_group) apply({ kind: 'add_group', id: 'prepared_group', label: 'prepared_group' })
  if (['update_boundary', 'rename_boundary', 'remove_boundary', 'reparent_boundary', 'reparent_element'].includes(kind)) {
    apply({ kind: 'add_boundary', boundary: { id: 'prepared_boundary', label: 'prepared_boundary', kind: 'system' } })
    if (kind.startsWith('reparent_')) apply({ kind: 'add_boundary', boundary: { id: 'prepared_target', label: 'prepared_target', kind: 'system' } })
  }
  if (['update_directive', 'remove_directive'].includes(kind) && !collection(diagram, 'directive').length) apply({ kind: 'add_directive', name: 'UpdateLayoutConfig', args: [{ name: 'c4ShapeInRow', value: '3' }] })
  if (['checkout_branch', 'rename_branch', 'merge_branch', 'cherry_pick'].includes(kind)) {
    apply({ kind: 'create_branch', name: 'prepared_branch' })
    apply({ kind: 'append_commit', id: 'prepared_commit' })
    apply({ kind: 'checkout_branch', name: diagram.body.mainBranchName })
  }
  return diagram
}

/** Every advertised kind receives a positive cell and a checked negative cell.
 * Missing authored preconditions stay blocked, not converted to coverage. */
export function runOperationWitnesses(api: OperationWitnessApi, family: string, diagram: Diagram): OperationWitnessResult[] {
  const menu = api.describeOps(family)
  const before = snapshot(diagram.body),
    beforeSource = api.serializeMermaid(diagram)
  return Object.entries(menu).map(([kind, fields]) => {
    let prepared = diagram,
      recipe: Recipe | undefined,
      preparationError: unknown
    try {
      prepared = prepareOperation(api, family, kind, diagram)
      recipe = operationRecipe(api, family, kind, fields, prepared)
      for (const operation of recipe?.setup ?? []) {
        const next = api.mutate(prepared, operation)
        if (!next.ok) throw Error(`Authored setup was rejected: ${JSON.stringify(next.error)}`)
        prepared = next.value
      }
    } catch (error) {
      preparationError = error
    }
    const preparedBefore = snapshot(prepared.body),
      preparedSource = api.serializeMermaid(prepared)
    let rejection: OperationWitnessResult['rejection']
    if (!api.mutateChecked || !recipe || preparationError) rejection = { status: 'blocked', findings: [], detail: 'No public checked edit or valid otherwise-admitted positive payload for this negative control' }
    else
      try {
        const requestedOperation = { ...recipe.operation, __benchmarkUnknownField: true }
        const rejected = api.mutateChecked(prepared, requestedOperation)
        const findings = [
          ...(rejected.ok ? ['Checked mutation accepted an unknown field'] : []),
          ...(!rejected.ok && (!rejected.error || typeof rejected.error !== 'object' || !('code' in rejected.error) || rejected.error.code !== 'INVALID_OP') ? ['Malformed shape did not return its declared INVALID_OP error'] : []),
          ...(snapshot(prepared.body) !== preparedBefore || api.serializeMermaid(prepared) !== preparedSource || snapshot(diagram.body) !== before || api.serializeMermaid(diagram) !== beforeSource ? ['Rejected mutation changed its input diagram'] : []),
        ]
        rejection = {
          status: findings.length ? 'failed' : 'passed',
          findings,
          detail: 'Otherwise admitted positive operands with one independently unknown field must reject atomically; rejection cannot be credited to omitted required operands',
          error: rejected.ok ? null : rejected.error,
          requestedOperation,
          inputSource: preparedSource,
        }
      } catch (error) {
        rejection = { status: 'failed', findings: [errorText(error)], detail: 'Checked rejection threw rather than returning a public error result' }
      }
    let positive: OperationWitnessResult['positive']
    try {
      if (preparationError) throw preparationError
      if (!recipe) positive = { status: 'blocked', findings: [], detail: 'No independently authored positive recipe/preconditions for this advertised operation' }
      else if (recipe.expected(prepared)) positive = { status: 'blocked', findings: [], detail: 'The fixture already has the requested state; a no-op cannot demonstrate this operation' }
      else {
        const changed = api.mutate(prepared, recipe.operation)
        if (!changed.ok) positive = { status: 'failed', findings: [`Admitted positive mutation rejected: ${JSON.stringify(changed.error)}`], detail: recipe.detail }
        else {
          const source = api.serializeMermaid(changed.value),
            reparsed = api.parseRegisteredMermaid(source)
          const findings = [
            ...(changed.value.kind !== family || changed.value.body.kind !== prepared.body.kind ? ['Mutation changed its routed family or typed representation'] : []),
            ...(!recipe.expected(changed.value) ? ['Typed mutation result does not contain the independently requested effect'] : []),
            ...endpointPreservation(prepared, changed.value, recipe.operation),
            ...(!reparsed.ok
              ? ['Mutated source failed to parse']
              : [
                  ...(reparsed.value.kind !== family || reparsed.value.body.kind !== prepared.body.kind ? ['Mutated source reparsed as another family or representation'] : []),
                  ...(!recipe.expected(reparsed.value) ? ['Requested semantic effect was lost on serialize/reparse'] : []),
                  ...endpointPreservation(prepared, reparsed.value, recipe.operation),
                ]),
            ...(snapshot(prepared.body) !== preparedBefore || api.serializeMermaid(prepared) !== preparedSource || snapshot(diagram.body) !== before || api.serializeMermaid(diagram) !== beforeSource ? ['Mutation changed its input diagram'] : []),
          ]
          positive = { status: findings.length ? 'failed' : 'passed', findings, detail: recipe.detail, source, inputSource: preparedSource, requestedOperation: recipe.operation }
        }
      }
    } catch (error) {
      positive = { status: 'failed', findings: [errorText(error)], detail: 'Positive operation witness threw' }
    }
    return { kind, positive, rejection }
  })
}

/** This unrepresentable ordering was exposed while extending the positive
 * matrix. Retain it as independent semantic-rejection evidence even though the
 * positive move witness uses two explicitly named sections. */
export function runOperationDiagnostics(api: OperationWitnessApi, family: string) {
  if (family !== 'timeline' && family !== 'journey') return []
  const source = family === 'timeline' ? 'timeline\n2025 : Alpha\n' : 'journey\nTask : 3 : Actor\n'
  return ['move_section', 'add_section'].map(kind => {
    const operation: Operation = kind === 'move_section' ? { kind, from: 0, to: 1 } : { kind, label: 'Named section', index: 0 }
    let inputSource = source,
      outputSource: string | undefined
    try {
      const parsed = api.parseRegisteredMermaid(source)
      if (!parsed.ok) return { kind, status: 'blocked' as const, findings: ['Diagnostic input did not parse'], inputSource, requestedOperation: operation }
      let diagram = parsed.value
      if (kind === 'move_section') {
        const setup = api.mutate(diagram, { kind: 'add_section', label: 'Named section' })
        if (!setup.ok) return { kind, status: 'blocked' as const, findings: ['Diagnostic setup did not accept an appended named section'], inputSource, requestedOperation: operation }
        diagram = setup.value
      }
      inputSource = api.serializeMermaid(diagram)
      const original = snapshot(diagram.body),
        changed = api.mutate(diagram, operation),
        findings: string[] = []
      if (snapshot(diagram.body) !== original) findings.push('Rejected or accepted section edit changed its input')
      if (changed.ok) {
        outputSource = api.serializeMermaid(changed.value)
        const again = api.parseRegisteredMermaid(outputSource)
        const meaning = (diagram: Diagram) =>
          rows(diagram.body.sections).map(section => ({
            label: section.label ?? null,
            periods: rows(section.periods).map(period => ({ label: period.label, events: rows(period.events).map(event => event.text) })),
            tasks: rows(section.tasks).map(task => ({ text: task.text, score: task.score, actors: task.actors })),
          }))
        if (!again.ok || !fieldEquals(meaning(changed.value), meaning(again.value))) findings.push('Accepted implicit-section edit lost section ownership/order on serialize/reparse; an unrepresentable edit must reject atomically')
      }
      return { kind, status: findings.length ? ('failed' as const) : ('passed' as const), findings, inputSource, requestedOperation: operation, outputSource, rejection: changed.ok ? null : changed.error }
    } catch (error) {
      return { kind, status: 'failed' as const, findings: [errorText(error)], inputSource, requestedOperation: operation, outputSource }
    }
  })
}
