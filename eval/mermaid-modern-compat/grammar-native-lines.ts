import type { ArchitectureDiagram } from '../../src/architecture/types.ts'
import type { ErDiagram } from '../../src/er/types.ts'
import type { GanttCalendarToken, GanttModel } from '../../src/gantt/types.ts'
import type { GitGraphDiagram } from '../../src/gitgraph/types.ts'
import type { JourneyDiagram } from '../../src/journey/types.ts'
import type { TimelineDiagram } from '../../src/timeline/types.ts'
import type { GrammarReferenceReply, NativeSemanticProjection } from './grammar-types.ts'
import type { Json } from './reference.ts'

type Row = Record<string, unknown>
const row = (value: unknown): Row => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : {})
const rows = (value: unknown): Row[] => (Array.isArray(value) ? value.map(row) : [])
const text = (value: unknown): string => (typeof value === 'string' ? value : '')
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.map(text) : [])
const pairs = (value: unknown): Array<[string, unknown]> => (value instanceof Map ? [...value].map(([key, item]) => [String(key), item]) : Array.isArray(value) ? value.filter((entry): entry is [string, unknown] => Array.isArray(entry) && typeof entry[0] === 'string') : [])
const projection = (value: Record<string, Json>): NativeSemanticProjection => ({ fields: Object.keys(value), value })
const classes = (value: string | undefined): string[] => (value ?? '').split(/\s+/).filter(name => name && name !== 'default')
const commonNative = (value: { title?: string; accessibilityTitle?: string; accessibilityDescription?: string }) => ({ title: value.title ?? '', accTitle: value.accessibilityTitle ?? '', accDescription: value.accessibilityDescription ?? '' })
const commonReference = (data: Record<string, Json>) => ({ title: text(data.getDiagramTitle ?? data['getCommonDb.getDiagramTitle']), accTitle: text(data.getAccTitle ?? data['getCommonDb.getAccTitle']), accDescription: text(data.getAccDescription ?? data['getCommonDb.getAccDescription']) })
const calendarToken = (token: GanttCalendarToken): string => (token.kind === 'date' ? token.raw : token.kind === 'weekday' ? token.day : 'weekends')
const calendarName = (value: unknown): string => {
  const name = text(value).toLowerCase()
  return /^(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)s$/.test(name) ? name.slice(0, -1) : name
}
const expression = (value: string): string => (/^(?:after|until)\s/.test(value.trim()) ? value.trim().split(/\s+/).join(' ') : value.trim())

/** Result projections only: the actual parser emits its own lexical/build
 * events. These independent adapters preserve the named semantic fields and
 * ordered collections; they never manufacture an upstream yy trace. Generated
 * IDs normalize only where the reference grammar proves they were not authored.
 */
export function projectNativeLines(family: string, model: unknown): NativeSemanticProjection | undefined {
  if (!model || typeof model !== 'object') return undefined
  switch (family) {
    case 'architecture': {
      const diagram = model as ArchitectureDiagram
      if (!Array.isArray(diagram.services) || !Array.isArray(diagram.groups)) return undefined
      return projection({
        ...commonNative(diagram),
        groups: diagram.groups.map(group => ({ id: group.id, label: group.label, icon: group.icon ?? '', parent: group.parentId ?? null })),
        services: diagram.services.map(service => ({ id: service.id, label: service.label, icon: service.icon ?? '', parent: service.parentId ?? null })),
        junctions: diagram.junctions.map(junction => ({ id: junction.id, parent: junction.parentId ?? null })),
        edges: diagram.edges.map(edge => ({ from: edge.source.id, fromSide: edge.source.side, fromGroup: edge.source.boundary === 'group', to: edge.target.id, toSide: edge.target.side, toGroup: edge.target.boundary === 'group', markerStart: edge.hasArrowStart, markerEnd: edge.hasArrowEnd, label: edge.label ?? '' })),
      })
    }
    case 'er': {
      const diagram = model as ErDiagram
      if (!Array.isArray(diagram.entities) || !Array.isArray(diagram.relationships)) return undefined
      return projection({
        ...commonNative(diagram),
        entities: diagram.entities.map(entity => ({ id: entity.id, label: entity.label, parent: entity.groupId ?? null, classes: classes(entity.className), attributes: entity.attributes.map(attribute => ({ type: attribute.type, name: attribute.name, keys: attribute.keys, comment: attribute.comment ?? '' })) })),
        groups: diagram.groups.map(group => ({ id: group.id, label: group.label, parent: group.parentId ?? null, members: group.entityIds })),
        relationships: diagram.relationships.map(relation => ({ from: relation.entity1, to: relation.entity2, markerStart: relation.cardinality1, markerEnd: relation.cardinality2, label: relation.label, identifying: relation.identifying })),
      })
    }
    case 'gantt': {
      const diagram = model as GanttModel
      if (!Array.isArray(diagram.tasks) || !Array.isArray(diagram.sections)) return undefined
      let automatic = 0
      return projection({
        title: diagram.title ?? '',
        accTitle: diagram.accTitle ?? '',
        accDescription: diagram.accDescr ?? '',
        dateFormat: diagram.dateFormat,
        axisFormat: diagram.axisFormat ?? '',
        topAxis: diagram.topAxis,
        excludes: diagram.excludes.map(calendarToken),
        includes: diagram.includes.map(calendarToken),
        sections: diagram.sections.filter(section => section.label !== undefined).map(section => section.label!),
        tasks: diagram.tasks.map(task => ({
          id: task.id ?? `task${++automatic}`,
          label: task.label.trim(),
          section: diagram.sections[task.sectionIndex]?.label ?? '',
          tags: [...task.tags].sort(),
          start: task.start ? expression(task.start.kind === 'after' ? `after ${task.start.refs.join(' ')}` : task.start.raw) : null,
          end: expression(task.end.kind === 'until' ? `until ${task.end.refs.join(' ')}` : task.end.raw),
        })),
      })
    }
    case 'gitgraph':
      return nativeGit(model as GitGraphDiagram)
    case 'journey': {
      const diagram = model as JourneyDiagram
      if (!Array.isArray(diagram.sections)) return undefined
      return projection({ ...commonNative(diagram), sections: diagram.sections.filter(section => section.label !== undefined || section.tasks.length).map(section => ({ label: section.label ?? '', tasks: section.tasks.map(task => ({ label: task.text, score: task.score, actors: task.actors })) })) })
    }
    case 'timeline': {
      const diagram = model as TimelineDiagram
      if (!Array.isArray(diagram.sections)) return undefined
      return projection({
        ...commonNative(diagram),
        direction: diagram.direction ?? 'LR',
        sections: diagram.sections.filter(section => section.label !== undefined || section.periods.length).map(section => ({ label: section.label ?? '', periods: section.periods.map(period => ({ label: period.label.trim(), events: period.events.map(event => event.text.trim()) })) })),
      })
    }
    default:
      return undefined
  }
}

export function projectReferenceLines(family: string, reply: GrammarReferenceReply): NativeSemanticProjection | undefined {
  const data = reply.snapshot?.data
  if (!reply.accepted || !data) return undefined
  switch (family) {
    case 'architecture': {
      if (!Array.isArray(data.getServices) || !Array.isArray(data.getGroups) || !Array.isArray(data.getEdges)) return undefined
      return projection({
        ...commonReference(data),
        groups: rows(data.getGroups).map(group => ({ id: text(group.id), label: text(group.title ?? group.id), icon: text(group.icon), parent: typeof group.in === 'string' ? group.in : null })),
        services: rows(data.getServices).map(service => ({ id: text(service.id), label: text(service.title ?? service.id), icon: text(service.icon), parent: typeof service.in === 'string' ? service.in : null })),
        junctions: rows(data.getJunctions).map(junction => ({ id: text(junction.id), parent: typeof junction.in === 'string' ? junction.in : null })),
        edges: rows(data.getEdges).map(edge => ({ from: text(edge.lhsId), fromSide: text(edge.lhsDir), fromGroup: Boolean(edge.lhsGroup), to: text(edge.rhsId), toSide: text(edge.rhsDir), toGroup: Boolean(edge.rhsGroup), markerStart: Boolean(edge.lhsInto), markerEnd: Boolean(edge.rhsInto), label: text(edge.title) })),
      })
    }
    case 'er':
      return referenceEr(reply)
    case 'gantt': {
      if (!Array.isArray(data.getTasks) || !Array.isArray(data.getSections)) return undefined
      return projection({
        ...commonReference(data),
        dateFormat: text(data.getDateFormat),
        axisFormat: text(data.getAxisFormat),
        topAxis: Boolean(data.topAxisEnabled),
        excludes: Array.isArray(data.getExcludes) ? data.getExcludes.map(calendarName) : [],
        includes: Array.isArray(data.getIncludes) ? data.getIncludes.map(calendarName) : [],
        sections: strings(data.getSections),
        tasks: rows(data.getTasks).map(task => {
          const raw = row(task.raw),
            start = row(raw.startTime),
            end = row(raw.endTime)
          return { id: text(task.id), label: text(task.task).trim(), section: text(task.section), tags: ['active', 'done', 'crit', 'milestone', 'vert'].filter(tag => task[tag] === true).sort(), start: start.type === 'prevTaskEnd' ? null : expression(text(start.startData)), end: expression(text(end.data)) }
        }),
      })
    }
    case 'gitgraph':
      return referenceGit(reply)
    case 'journey': {
      if (!Array.isArray(data.getTasks) || reply.actions.status !== 'available') return undefined
      const tasks = rows(data.getTasks)
      const sections = referenceSections(reply, 'tasks', index => {
        const task = tasks[index]
        return task ? { label: text(task.task), score: Number(task.score), actors: strings(task.people) } : null
      })
      return sections ? projection({ ...commonReference(data), sections }) : undefined
    }
    case 'timeline': {
      if (!Array.isArray(data.getTasks) || reply.actions.status !== 'available') return undefined
      const tasks = rows(data.getTasks)
      const sections = referenceSections(reply, 'periods', index => {
        const task = tasks[index]
        return task ? { label: text(task.task).trim(), events: strings(task.events).map(value => value.trim()) } : null
      })
      return sections ? projection({ ...commonReference(data), direction: text(data.getDirection) || 'LR', sections }) : undefined
    }
    default:
      return undefined
  }
}

function referenceEr(reply: GrammarReferenceReply): NativeSemanticProjection | undefined {
  const data = reply.snapshot!.data
  if (!Array.isArray(data.getEntities) || !Array.isArray(data.getRelationships)) return undefined
  const entities = pairs(data.getEntities)
    .map(([id, value]) => ({ id, value: row(value) }))
    .sort((a, b) => Number(a.value.colorIndex) - Number(b.value.colorIndex))
  const logicalId = new Map(entities.map(entity => [text(entity.value.id), entity.id]))
  const nodes = rows(row(data.getData).nodes),
    groupNodes = nodes.filter(node => node.isGroup === true)
  const parentOf = new Map(nodes.map(node => [text(node.id), typeof node.parentId === 'string' ? node.parentId : null]))
  const groupIds = new Set(groupNodes.map(group => text(group.id)))
  const subgraphs = rows(data.getSubGraphs)
  const cardinality: Record<string, string> = { ONLY_ONE: 'one', ZERO_OR_ONE: 'zero-one', ONE_OR_MORE: 'many', ZERO_OR_MORE: 'zero-many' }
  return projection({
    ...commonReference(data),
    entities: entities.map(({ id, value }) => ({
      id,
      label: text(value.alias) || text(value.label) || id,
      parent: parentOf.get(text(value.id)) ?? null,
      classes: classes(text(value.cssClasses)),
      attributes: rows(value.attributes).map(attribute => ({ type: text(attribute.type), name: text(attribute.name), keys: strings(attribute.keys), comment: text(attribute.comment) })),
    })),
    groups: groupNodes.map(group => ({
      id: text(group.id),
      label: text(group.label),
      parent: parentOf.get(text(group.id)) ?? null,
      members: strings(subgraphs.find(subgraph => subgraph.id === group.id)?.nodes)
        .filter(id => !groupIds.has(id))
        .map(id => logicalId.get(id) ?? id),
    })),
    relationships: rows(data.getRelationships).map(relation => {
      const spec = row(relation.relSpec)
      return {
        from: logicalId.get(text(relation.entityA)) ?? text(relation.entityA),
        to: logicalId.get(text(relation.entityB)) ?? text(relation.entityB),
        markerStart: cardinality[text(spec.cardB)] ?? text(spec.cardB),
        markerEnd: cardinality[text(spec.cardA)] ?? text(spec.cardA),
        label: text(relation.roleA),
        identifying: spec.relType === 'IDENTIFYING',
      }
    }),
  })
}

/** Sections with the same name remain separate identities. Read their ordered
 * actual addSection/addTask calls rather than guessing membership from labels. */
function referenceSections(reply: GrammarReferenceReply, collection: 'tasks' | 'periods', item: (index: number) => Json | null): Json[] | undefined {
  if (reply.actions.status !== 'available') return undefined
  const sections: Array<{ label: string; items: Json[] }> = []
  let current: { label: string; items: Json[] } | undefined,
    index = 0
  for (const call of reply.actions.value) {
    if (call[0] === 'addSection') {
      current = { label: text(call[1]), items: [] }
      sections.push(current)
    } else if (call[0] === 'addTask') {
      if (!current) {
        current = { label: '', items: [] }
        sections.push(current)
      }
      const value = item(index++)
      if (value === null) return undefined
      current.items.push(value)
    }
  }
  return sections.map(section => ({ label: section.label, [collection]: section.items }))
}

function nativeGit(diagram: GitGraphDiagram): NativeSemanticProjection | undefined {
  if (!Array.isArray(diagram.commits) || !Array.isArray(diagram.statements)) return undefined
  // Generated identities occupy a disjoint JSON domain. A legal authored ID
  // such as "@commit:0" must never collide with a normalization placeholder.
  const ids = new Map<string, Json>(diagram.commits.map((commit, index): [string, Json] => [commit.id, commit.customId ? { authored: commit.id } : { generated: index }]))
  const id = (value: string | undefined): Json => (value === undefined ? null : (ids.get(value) ?? { authored: value }))
  return projection({
    ...commonNative(diagram),
    direction: diagram.direction,
    commits: diagram.commits.map(commit => ({ id: id(commit.id), branch: commit.branch, parents: commit.parents.map(parent => id(parent)), type: commit.customType ?? commit.type, label: commit.message ?? '', tags: commit.tags })),
    branches: diagram.branches.map(branch => ({ name: branch.name, head: id(branch.head) })),
    operations: diagram.statements.map((statement): Json => {
      switch (statement.kind) {
        case 'commit':
          return { kind: 'commit', ref: id(statement.ref) }
        case 'branch':
          return { kind: 'branch', name: statement.name, order: statement.order ?? null }
        case 'checkout':
          return { kind: 'checkout', branch: statement.branch }
        case 'merge':
          return { kind: 'merge', ref: id(statement.ref), branch: statement.branch }
        case 'cherry-pick':
          return { kind: 'cherry-pick', ref: id(statement.ref), source: id(statement.source), parent: id(statement.parent) }
      }
    }),
  })
}

function referenceGit(reply: GrammarReferenceReply): NativeSemanticProjection | undefined {
  const data = reply.snapshot!.data
  if (!Array.isArray(data.getCommitsArray) || !Array.isArray(data.getBranches) || reply.ast.status !== 'available') return undefined
  const statements = rows(row(reply.ast.value).statements),
    commits = rows(data.getCommitsArray)
  const builders = statements.filter(statement => ['Commit', 'Merge', 'CherryPicking'].includes(text(statement.$type)))
  if (builders.length !== commits.length) return undefined
  const ids = new Map<string, Json>(commits.map((commit, index): [string, Json] => [text(commit.id), builders[index]!.$type !== 'CherryPicking' && typeof builders[index]!.id === 'string' && builders[index]!.id !== '' ? { authored: text(commit.id) } : { generated: index }]))
  const id = (value: unknown): Json => (typeof value === 'string' ? (ids.get(value) ?? { authored: value }) : null)
  const branchHeads = new Map(pairs(data.getBranches)),
    branchStatements = statements.filter(statement => statement.$type === 'Branch')
  const declared = new Set(branchStatements.map(branch => text(branch.name)))
  const main = [...branchHeads.keys()].find(name => !declared.has(name))
  const branches = [...(main ? [main] : []), ...branchStatements.map(branch => text(branch.name))]
  const types = ['NORMAL', 'REVERSE', 'HIGHLIGHT', 'MERGE', 'CHERRY_PICK']
  let index = 0
  const operations: Json[] = []
  for (const statement of statements) {
    const kind = text(statement.$type)
    if (kind === 'Commit') operations.push({ kind: 'commit', ref: id(commits[index++]!.id) })
    else if (kind === 'Merge') operations.push({ kind: 'merge', ref: id(commits[index++]!.id), branch: text(statement.branch) })
    else if (kind === 'CherryPicking') operations.push({ kind: 'cherry-pick', ref: id(commits[index++]!.id), source: id(statement.id), parent: id(statement.parent) })
    else if (kind === 'Branch') operations.push({ kind: 'branch', name: text(statement.name), order: typeof statement.order === 'number' ? statement.order : null })
    else if (kind === 'Checkout') operations.push({ kind: 'checkout', branch: text(statement.branch) })
  }
  return projection({
    ...commonReference(data),
    direction: text(data.getDirection) || 'LR',
    commits: commits.map(commit => ({ id: id(commit.id), branch: text(commit.branch), parents: Array.isArray(commit.parents) ? commit.parents.map(parent => id(parent)) : [], type: types[Number(commit.customType ?? commit.type)] ?? String(commit.type), label: text(commit.message), tags: strings(commit.tags) })),
    branches: branches.map(name => ({ name, head: id(branchHeads.get(name)) })),
    operations,
  })
}
