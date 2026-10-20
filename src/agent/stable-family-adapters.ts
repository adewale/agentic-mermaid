import { tokenize as tokenizeBlock } from '../block/lexer.ts'
import { parseBlockDiagram } from '../block/parser.ts'
import { T as BlockToken } from '../block/tokens.ts'
import { tokenize as tokenizeRequirement } from '../requirement/lexer.ts'
import { T as RequirementToken, TOKEN_NAMES as requirementTokenNames } from '../requirement/tokens.ts'
import { type ParserObservation, withParserObservation } from '../shared/parser-observation.ts'
import { blockEntries, mutateBlock, parseBlockBody, renderBlock, verifyBlock } from './block-body.ts'
import type { ExtractedLabel, FamilyOperations } from './families.ts'
import { mutateIshikawa, parseIshikawaBody, renderIshikawa, verifyIshikawa } from './ishikawa-body.ts'
import { mutateKanban, parseKanbanBody, renderKanban, verifyKanban } from './kanban-body.ts'
import { mutatePacket, parsePacketBody, renderPacket, verifyPacket } from './packet-body.ts'
import { mutateRequirement, parseRequirementBody, renderRequirement, verifyRequirement } from './requirement-body.ts'
import { mutateTreemap, parseTreemapBody, renderTreemap, verifyTreemap } from './treemap-body.ts'
import type { DiagramBody, FamilyParsedBody, LayoutWarning, MutationError, Result, SourceLocation, SourceMap, VerifyOptions } from './types.ts'
import { err, ok } from './types.ts'

export type StableBody = Extract<DiagramBody, { kind: 'packet' | 'kanban' | 'requirement' | 'block' | 'treemap' | 'ishikawa' }>

export function isStableFamilyBody(body: FamilyParsedBody): body is StableBody {
  return body.kind === 'packet' || body.kind === 'kanban' || body.kind === 'requirement' || body.kind === 'block' || body.kind === 'treemap' || body.kind === 'ishikawa'
}

export function stableFamilyTree(body: StableBody): { nodes: { id: string; label: string; parentId?: string; value?: number }[]; edges: { from: string; to: string; label?: string }[] } {
  switch (body.kind) {
    case 'packet':
      return { nodes: body.fields.map(field => ({ id: field.id, label: field.label, value: field.end - field.start + 1 })), edges: [] }
    case 'kanban':
      return { nodes: body.columns.flatMap(column => [{ id: column.id, label: column.label }, ...column.tasks.map(task => ({ id: task.id, label: task.label, parentId: column.id }))]), edges: [] }
    case 'requirement':
      return { nodes: [...body.requirements.map(node => ({ id: node.name, label: node.name })), ...body.elements.map(node => ({ id: node.name, label: node.name }))], edges: body.relations.map(edge => ({ from: edge.src, to: edge.dst, label: edge.type })) }
    case 'block':
      return {
        nodes: blockEntries(body)
          .filter(entry => entry.node.type !== 'space')
          .map(entry => ({ id: entry.node.id, label: entry.node.label ?? entry.node.id, ...(entry.parentId ? { parentId: entry.parentId } : {}) })),
        edges: body.edges.map(edge => ({ from: edge.start!, to: edge.end!, ...(edge.label ? { label: edge.label } : {}) })),
      }
    case 'treemap':
      return { nodes: body.nodes.map(node => ({ ...node })), edges: [] }
    case 'ishikawa':
      return { nodes: body.nodes.map(node => ({ ...node })), edges: body.nodes.filter(node => node.parentId).map(node => ({ from: node.id, to: node.parentId! })) }
  }
}

export function stableFamilyCount(body: StableBody): { nodes: number; edges: number; groups: number } {
  switch (body.kind) {
    case 'packet':
      return { nodes: body.fields.length, edges: 0, groups: 0 }
    case 'kanban':
      return { nodes: body.columns.reduce((sum, column) => sum + column.tasks.length, 0), edges: 0, groups: body.columns.length }
    case 'requirement':
      return { nodes: body.requirements.length + body.elements.length, edges: body.relations.length, groups: 0 }
    case 'block': {
      const entries = blockEntries(body)
      return { nodes: entries.filter(entry => !['space', 'composite'].includes(entry.node.type ?? '')).length, edges: body.edges.length, groups: entries.filter(entry => entry.node.type === 'composite').length }
    }
    case 'treemap':
      return { nodes: body.nodes.filter(node => node.value !== undefined).length, edges: 0, groups: body.nodes.filter(node => node.value === undefined).length }
    case 'ishikawa':
      return { nodes: body.nodes.length, edges: Math.max(0, body.nodes.length - 1), groups: 0 }
  }
}

/** Domain read-back retains quantities, membership and ordered records. */
export function stableFamilyFacts(body: StableBody): string[] {
  const facts: string[] = []
  const text = (value: unknown) => JSON.stringify(value)
  if ('title' in body && body.title !== undefined) facts.push(`title ${text(body.title)}`)
  switch (body.kind) {
    case 'packet':
      body.fields.forEach((field, index) => facts.push(`field#${index} ${field.start}-${field.end} : ${text(field.label)}`))
      break
    case 'kanban':
      body.columns.forEach((column, index) => {
        facts.push(`column#${index} ${text(column.sourceId)} : ${text(column.label)}`)
        column.tasks.forEach((task, order) => {
          facts.push(`task#${index}.${order} ${text(task.sourceId)} : ${text(task.label)}`)
          for (const [key, value] of Object.entries(task.metadata)) facts.push(`task#${index}.${order} metadata ${text(key)} ${text(value)}`)
          if (task.icon) facts.push(`task#${index}.${order} icon ${text(task.icon)}`)
          if (task.className) facts.push(`task#${index}.${order} class ${text(task.className)}`)
        })
      })
      break
    case 'requirement':
      facts.push(`direction ${body.direction}`)
      body.requirements.forEach(node => facts.push(`requirement ${text(node.name)} ${text(node.type)} id ${text(node.requirementId)} text ${text(node.text)} risk ${text(node.risk)} verify ${text(node.verifyMethod)}`))
      body.elements.forEach(node => facts.push(`element ${text(node.name)} type ${text(node.type)} docref ${text(node.docRef)}`))
      body.relations.forEach((edge, index) => facts.push(`relation#${index} ${text(edge.src)} ${edge.type} ${text(edge.dst)}`))
      break
    case 'block':
      facts.push(`columns root ${body.root.columns ?? -1}`)
      for (const { node, parentId } of blockEntries(body)) facts.push(`block ${text(node.id)} parent ${text(parentId ?? null)} type ${node.type === 'na' ? 'square' : node.type ?? 'square'} span ${node.widthInColumns ?? 1} columns ${node.columns ?? -1} label ${text(node.label ?? '')}${node.directions ? ` directions ${text(node.directions)}` : ''}`)
      body.edges.forEach((edge, index) => facts.push(`edge#${index} ${text(edge.start)} -> ${text(edge.end)} label ${text(edge.label ?? '')} markers ${edge.arrowTypeStart ?? 'none'} ${edge.arrowTypeEnd ?? 'none'}`))
      break
    case 'treemap':
      body.nodes.forEach((node, index) => facts.push(`node#${index} ${node.id} parent ${node.parentId ?? 'root'} : ${text(node.label)}${node.value === undefined ? ' section' : ` value ${node.value}`}${node.className ? ` class ${node.className}` : ''}`))
      break
    case 'ishikawa':
      body.nodes.forEach((node, index) => facts.push(`${node.parentId ? 'cause' : 'effect'}#${index} ${node.id}${node.parentId ? ` parent ${node.parentId}` : ''} : ${text(node.label)}`))
      break
  }
  return facts
}

export function stableFamilyLabels(body: StableBody): ExtractedLabel[] {
  const out: ExtractedLabel[] = []
  if ('title' in body && body.title !== undefined) out.push({ text: body.title, target: 'title' })
  switch (body.kind) {
    case 'packet':
      return [...out, ...body.fields.map(field => ({ text: field.label, target: field.id }))]
    case 'kanban':
      return [
        ...out,
        ...body.columns.flatMap(column =>
          [column, ...column.tasks].flatMap(item => [
            { text: item.label, target: item.id },
            ...Object.entries(item.metadata)
              .filter(([key]) => ['ticket', 'assigned', 'priority'].includes(key))
              .map(([, value]) => ({ text: String(value), target: item.id })),
          ]),
        ),
      ]
    case 'requirement':
      return [
        ...out,
        ...body.requirements.flatMap(node => [node.name, node.requirementId, node.text, node.risk, node.verifyMethod].filter(Boolean).map(text => ({ text, target: node.name }))),
        ...body.elements.flatMap(node => [node.name, node.type, node.docRef].filter(Boolean).map(text => ({ text, target: node.name }))),
        ...body.relations.map(edge => ({ text: edge.type, target: edge.id })),
      ]
    case 'block':
      return [
        ...out,
        ...blockEntries(body)
          .filter(entry => entry.node.type !== 'space')
          .map(entry => ({ text: entry.node.label ?? entry.node.id, target: entry.node.id })),
        ...body.edges.filter(edge => edge.label).map(edge => ({ text: edge.label!, target: edge.id })),
      ]
    case 'treemap':
    case 'ishikawa':
      return [...out, ...body.nodes.map(node => ({ text: node.label, target: node.id }))]
  }
}

/** Locate native declarations and mutations, rather than searching every line
 * for display labels (which need not be unique or appear verbatim in source). */
function sourceMap(body: StableBody, source: string): SourceMap {
  const map: SourceMap = { nodes: new Map(), edges: new Map(), groups: new Map(), labels: new Map() }
  const lines = source.split(/\r?\n/)
  const lineStarts = (text: string): number[] => {
    const out = [0]
    for (let i = 0; i < text.length; i++) if (text[i] === '\n') out.push(i + 1)
    return out
  }
  const starts = lineStarts(source)
  const at = (offset: number, offsets = starts): SourceLocation => {
    let lo = 0,
      hi = offsets.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (offsets[mid]! <= offset) lo = mid + 1
      else hi = mid
    }
    const line = Math.max(0, lo - 1)
    return { line: line + 1, col: offset - offsets[line]! + 1 }
  }
  const lineAt = (line: number, col = 0): SourceLocation => ({ line, col: col + 1 })
  const label = (key: string, location: SourceLocation): void => {
    if (!map.labels.has(key)) map.labels.set(key, location)
  }

  if (body.kind === 'requirement') {
    // The same lexer that owns the parser supplies declaration/field/relation
    // boundaries. Its quoted-string tokens already start inside the quotes.
    const lexerSource = ['requirementDiagram', ...lines.slice(1)].join('\n')
    const positions = lineStarts(lexerSource),
      tokens = tokenizeRequirement(lexerSource)
    const location = (index: number): SourceLocation => at(tokens.starts[index]!, positions)
    let owner: string | undefined,
      edgeIndex = 0
    const ids = new Set([...body.requirements.map(n => n.name), ...body.elements.map(n => n.name)])
    for (let i = 0; i < tokens.types.length; i++) {
      const type = tokens.types[i]!
      if (((type >= RequirementToken.REQUIREMENT && type <= RequirementToken.DESIGN_CONSTRAINT) || type === RequirementToken.ELEMENT) && ids.has(tokens.texts[i + 1]!)) {
        owner = tokens.texts[i + 1]!
        if (!map.nodes.has(owner)) map.nodes.set(owner, location(i + 1))
        label(`node:${owner}`, location(i + 1))
      } else if (type === RequirementToken.STRUCT_STOP) owner = undefined
      else if ((owner && type >= RequirementToken.ID && type <= RequirementToken.VERIFYMTHD) || (owner && (type === RequirementToken.TYPE || type === RequirementToken.DOCREF))) {
        if (tokens.types[i + 1] === RequirementToken.COLONSEP) label(`node:${owner}:${requirementTokenNames[type]!.toLowerCase()}`, location(i + 2))
      } else if (type >= RequirementToken.CONTAINS && type <= RequirementToken.TRACES) {
        const edge = body.relations[edgeIndex]
        if (!edge) continue
        map.edges.set(edge.id, location(i - 2))
        label(`edge#${edgeIndex}:${edge.src}->${edge.dst}`, location(i))
        edgeIndex++
      }
    }
    return map
  }

  if (body.kind === 'block') {
    const entries = new Map(blockEntries(body).map(entry => [entry.node.id, entry.node]))
    const tokens = tokenizeBlock(source)
    let previousNode = -1,
      edgeIndex = 0,
      pendingLabel = -1
    const declared = new Set<string>()
    for (let i = 0; i < tokens.types.length; i++) {
      const type = tokens.types[i]!
      if (type === BlockToken.NODE_ID) {
        previousNode = i
        const node = entries.get(tokens.texts[i]!)
        if (!node || node.type === 'space') continue
        const group = node.type === 'composite',
          destination = group ? map.groups : map.nodes
        const explicit = tokens.types[i - 1] === BlockToken.ID_BLOCK || tokens.types[i + 1] === BlockToken.NODE_DSTART || tokens.types[i + 1] === BlockToken.BLOCK_ARROW_START
        if (!destination.has(node.id) || (explicit && !declared.has(node.id))) {
          destination.set(node.id, at(tokens.starts[i]!))
          const textIndex = tokens.types[i + 1] === BlockToken.NODE_DSTART || tokens.types[i + 1] === BlockToken.BLOCK_ARROW_START ? i + 2 : i
          if (explicit || !map.labels.has(`${group ? 'group' : 'node'}:${node.id}`)) map.labels.set(`${group ? 'group' : 'node'}:${node.id}`, at(tokens.starts[textIndex]!))
        }
        if (explicit) declared.add(node.id)
      } else if (type === BlockToken.LINK_LABEL) pendingLabel = i + 1
      else if (type === BlockToken.LINK) {
        const edge = body.edges[edgeIndex]
        if (edge && previousNode >= 0) {
          map.edges.set(edge.id, at(tokens.starts[previousNode]!))
          if (pendingLabel >= 0) label(`edge#${edgeIndex}:${edge.start}->${edge.end}`, at(tokens.starts[pendingLabel]!))
        }
        edgeIndex++
        pendingLabel = -1
      }
    }
    // Anonymous composites have parser-generated identities. Capture their
    // actual allocation at the closing statement, paired with its consumed
    // opening statement; do not infer an id from its label or child list.
    const open: number[] = []
    let statement: ParserObservation | undefined, closed: number | undefined
    withParserObservation(
      'block',
      event => {
        if (event.unit === 'statement') {
          statement = event
          if (event.kind === 'BLOCK_DIAGRAM_KEY' || event.kind === 'id-block') open.push(event.source?.offset ?? 0)
          else if (event.kind === 'end') closed = open.pop()
        } else if (event.unit === 'mutation' && event.kind === 'generate-id' && statement?.kind === 'end' && closed !== undefined && typeof event.value === 'string' && entries.get(event.value)?.type === 'composite') {
          map.groups.set(event.value, at(closed))
        }
      },
      () => parseBlockDiagram(source),
      { mutations: ['generate-id'] },
    )
    return map
  }

  // These native parsers expose the exact consumed statement before each
  // record is appended. Repeated labels and repeated Kanban source IDs are
  // disambiguated by the identity in that actual append event.
  let statement: ParserObservation | undefined
  const columns = body.kind === 'kanban' ? new Set(body.columns.map(column => column.id)) : undefined
  withParserObservation(
    body.kind,
    event => {
      if (event.unit === 'statement') {
        statement = event
        return
      }
      if (event.unit !== 'mutation' || !statement?.source?.line || !event.value || typeof event.value !== 'object' || Array.isArray(event.value)) return
      const value = event.value as Record<string, unknown>
      if (typeof value.id !== 'string') return
      const id = value.id,
        line = event.source?.line ?? statement.source.line
      const raw = lines[line - 1] ?? '',
        indent = raw.length - raw.trimStart().length
      if (body.kind === 'kanban' && (event.kind === 'add-column' || event.kind === 'add-task')) {
        const group = columns!.has(id)
        ;(group ? map.groups : map.nodes).set(id, lineAt(line, indent))
        // declaredLabel is the native lexical payload, before entity and
        // metadata-label interpretation. Search only its consumed declaration.
        const declaredLabel = typeof value.declaredLabel === 'string' ? value.declaredLabel : ''
        const local = statement.text ?? raw
        const firstLine = local.split('\n')[0]!
        const metadata = firstLine.indexOf('@{')
        const declaration = metadata >= 0 ? firstLine.slice(0, metadata) : firstLine
        const start = declaration.lastIndexOf(declaredLabel)
        if (declaredLabel && start >= 0) label(`${group ? 'group' : 'node'}:${id}`, lineAt(line, start))
      } else if (body.kind === 'packet' && event.kind === 'add-field') {
        map.nodes.set(id, lineAt(line, indent))
        const colon = raw.indexOf(':', indent),
          quote = raw.slice(colon + 1).search(/["']/)
        if (colon >= 0 && quote >= 0) label(`node:${id}`, lineAt(line, colon + quote + 2))
      } else if ((body.kind === 'treemap' || body.kind === 'ishikawa') && event.kind === 'add-node') {
        const group = body.kind === 'treemap' && value.value === undefined
        const column = event.source?.column === undefined ? indent : event.source.column - 1
        ;(group ? map.groups : map.nodes).set(id, lineAt(line, column))
        label(`${group ? 'group' : 'node'}:${id}`, lineAt(line, column + (body.kind === 'treemap' ? 1 : 0)))
        if (body.kind === 'ishikawa' && typeof value.parentId === 'string') map.edges.set(`branch:${id}`, lineAt(line, indent))
      }
    },
    () => {
      switch (body.kind) {
        case 'packet':
          return parsePacketBody(lines)
        case 'kanban':
          return parseKanbanBody(lines)
        case 'treemap':
          return parseTreemapBody(lines.slice(1))
        case 'ishikawa':
          return parseIshikawaBody(lines.slice(1))
      }
    },
  )
  return map
}

function hooks<K extends StableBody['kind']>(
  kind: K,
  parse: (lines: string[]) => Extract<StableBody, { kind: K }> | null,
  serialize: (body: Extract<StableBody, { kind: K }>) => string,
  mutate: (body: Extract<StableBody, { kind: K }>, op: never) => Result<Extract<StableBody, { kind: K }>, MutationError>,
  verify: (body: Extract<StableBody, { kind: K }>, opts: VerifyOptions) => LayoutWarning[],
): FamilyOperations {
  return {
    parse: ctx => ok(parse(ctx.source.familyBody.split(/\r?\n/)) ?? { kind: 'opaque', family: kind, source: ctx.opaqueSource }),
    serialize: body => {
      if (body.kind !== kind) throw new Error(`Expected ${kind} body`)
      return serialize(body as Extract<StableBody, { kind: K }>)
    },
    mutate: (body, op) => {
      if (body.kind !== kind) return err({ code: 'UNSUPPORTED_FAMILY', message: `${kind} contains unmodeled syntax and remains preserved verbatim` })
      const changed = mutate(body as Extract<StableBody, { kind: K }>, op as never)
      if (!changed.ok) return changed
      // Generated occurrence IDs belong to the resulting source artifact.
      // Publish the same identities/order that its renderer and source map see.
      const normalized = parse(serialize(changed.value).split(/\r?\n/))
      return normalized ? ok(normalized) : err({ code: 'INVALID_OP', message: `${kind} edit could not preserve its structured representation` })
    },
    verify: (body, opts) => (body.kind === kind ? verify(body as Extract<StableBody, { kind: K }>, opts) : []),
    renderSource: body => (body.kind === 'opaque' ? 'canonical' : 'serialized'),
    extractLabels: source => {
      const body = parse(source.split(/\r?\n/))
      return body ? stableFamilyLabels(body) : []
    },
    buildSourceMap: (body, source) => (body.kind === kind ? sourceMap(body as StableBody, source) : { nodes: new Map(), edges: new Map(), groups: new Map(), labels: new Map() }),
  }
}

export const STABLE_FAMILY_AGENT_HOOKS = {
  packet: hooks('packet', parsePacketBody, renderPacket, mutatePacket, verifyPacket),
  kanban: hooks('kanban', parseKanbanBody, renderKanban, mutateKanban, verifyKanban),
  requirement: hooks('requirement', lines => parseRequirementBody(lines.slice(1)), renderRequirement, mutateRequirement, verifyRequirement),
  block: hooks('block', lines => parseBlockBody(lines.slice(1)), renderBlock, mutateBlock, verifyBlock),
  treemap: hooks('treemap', lines => parseTreemapBody(lines.slice(1)), renderTreemap, mutateTreemap, verifyTreemap),
  ishikawa: hooks('ishikawa', lines => parseIshikawaBody(lines.slice(1)), renderIshikawa, mutateIshikawa, verifyIshikawa),
}
