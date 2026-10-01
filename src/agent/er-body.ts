// ============================================================================
// ER diagram structured body: parse, serialize, mutate, verify.
//
// Supported:
//   CUSTOMER ||--o{ ORDER : places
//   CUSTOMER ||..o{ ORDER : "places (dashed)"
//   CUSTOMER {
//     string name PK
//     string email
//     int    age "comment"
//   }
//
// Unmodeled outer statements ride along as opaque segments. Invalid grammar
// and preserved lines inside attribute blocks force lossless whole-body opaque.
// ============================================================================

import { unknownOpMessage } from './mutation-ops.ts'
import type {
  ErBody, ErEntity, ErRelation, ErCardinality, ErAttribute, ErStatement, ErGroup,
  ErMutationOp, MutationError, Result, LayoutWarning, VerifyOptions,
} from './types.ts'
import { ok, err } from './types.ts'
import { labelOverflowCollector } from './body-utils.ts'
import {
  parseErAttribute,
  parseErEntityId,
  parseErEntityReference,
  recordErClassNames,
  parseErCardinality,
  hasErTrailingComment,
  readErStatements,
} from '../er/parser.ts'
import { createErCreationFold, type ErCreationFold } from '../er/creation.ts'
import { decodeErText, writeErName, writeErRelationLabel, writeErTitle } from '../er/text.ts'
import { parseAccessibilityDirective } from '../shared/accessibility-directives.ts'
import { parseMutableStyleProps, serializeStyleProps, unsafeStylePaintError } from '../shared/style-props.ts'

/** ER source ours reads where Mermaid 11.16 rejects it, each on its canonical
 * line: a trailing `%%` comment after a statement is a comment, and quoted
 * text Mermaid's lexer refuses is read generously (src/er/text.ts). */
export function erUnsupportedSyntaxWarnings(canonicalSource: string): LayoutWarning[] {
  const lines = canonicalSource.split(/\r?\n/)
  const header = lines.findIndex(line => /^erDiagram\b/i.test(line.trim()))
  if (header < 0) return []
  const warnings: LayoutWarning[] = []
  const warn = (index: number, syntax: string, what: string, portable: string): void => {
    warnings.push({ code: 'UNSUPPORTED_SYNTAX', syntax, line: index + 1, message: `${what}. Mermaid 11.16 rejects this; ${portable}.` })
  }
  const grammar = lines.slice(header + 1)
  for (let index = header + 1; index < lines.length; index++) {
    const directive = parseAccessibilityDirective(lines, index)
    if (directive === undefined) break
    if (directive !== null) {
      for (let at = index; at <= directive.endIndex; at++) grammar[at - header - 1] = ''
      if (directive.suffixLine) grammar[directive.endIndex - header - 1] = directive.suffixLine
      index = directive.endIndex
      continue
    }
    const line = lines[index]!.trim()
    if (!line || line.startsWith('%%')) continue
    if (hasErTrailingComment(line)) warn(index, 'er_trailing_comment', 'A trailing %% comment after an ER statement is read as a comment', 'put the comment on a line of its own')
  }
  try {
    const source = readErStatements(grammar, (what, portable, index) => warn(header + index + 1, 'er_quoted_text', what, portable))
    for (const entry of source.statements) if (entry.syntax.kind === 'unknown') warnings.push({
      code: 'UNSUPPORTED_SYNTAX', syntax: 'er_statement', line: header + entry.line + 2,
      message: `ER statement is preserved in source but not drawn: ${entry.raw.trim()}`,
    })
  } catch {
    // A statement ours cannot read fails the render; verify reports that.
  }
  return warnings
}

/** Whether the serializer can write `id` as a Mermaid ER name: bare, or one
 * quoted name without `"`, `%` or `\`. Ours reads others (verify reports
 * them), and the typed body leaves such a diagram opaque, as written: an id is
 * identity, so it is not re-spelled with entity codes as text is. */
function writableErId(id: string): boolean {
  return parseErEntityId(id) !== null || (id !== '' && !/["%\\\r\n]/.test(id))
}

// ---- Parser ---------------------------------------------------------------

const AGENT_CARDINALITY: Record<NonNullable<ReturnType<typeof parseErCardinality>>, ErCardinality> = {
  one: 'one-only', 'zero-one': 'zero-or-one', many: 'one-or-many', 'zero-many': 'zero-or-many',
}

/** Project the shared ER stream into the editable model. Unknown outer lines
 * remain ordered source; syntax that cannot be safely segmented stays opaque. */
export function parseErBody(lines: string[], rawLines?: string[]): ErBody | null {
  try {
    return readErBody(rawLines ?? lines)
  } catch {
    return null
  }
}

function readErBody(lines: string[]): ErBody | null {
  const statements: ErStatement[] = []
  const body: ErBody = { kind: 'er', entities: [], relations: [], groups: [], statements }
  const entityMap = new Map<string, ErEntity>()
  const classNamesByEntity = new Map<string, string[]>()
  const upsert = (id: string, className?: string): ErEntity => {
    let e = entityMap.get(id)
    if (!e) {
      if (!writableErId(id)) throw new Error(`ER entity id ${JSON.stringify(id)} has no Mermaid spelling`)
      e = { id, attributes: [] }
      entityMap.set(id, e)
    }
    if (className) recordErClassNames(classNamesByEntity, id, className.split(' '))
    return e
  }
  const declaredEntities = new Set<string>()
  const declareEntityStatement = (id: string): void => {
    if (!declaredEntities.has(id)) { declaredEntities.add(id); statements.push({ kind: 'entity', id }) }
  }

  // Which statement creates each entity, and which subgraph keeps it.
  const source = readErStatements(lines)
  const groupById = new Map<string, ErGroup>()
  for (const entry of source.statements) {
    const statement = entry.syntax
    switch (statement.kind) {
      case 'unknown':
      case 'comment':
        // The attribute model cannot place preserved lines among attributes.
        // Keep such a source wholly opaque rather than move or lose its text.
        if (entry.entityId !== undefined) return null
        statements.push({ kind: 'opaque', lines: [entry.raw] })
        break
      case 'attribute': entityMap.get(entry.entityId!)!.attributes.push({ text: statement.text }); break
      case 'direction': {
        const group = entry.groupId !== undefined ? groupById.get(entry.groupId) : undefined
        if (group) group.direction = statement.direction
        else body.direction = statement.direction
        statements.push({ kind: 'direction', ...(group ? { groupId: group.id } : {}) })
        break
      }
      case 'group-open': {
        if (!writableErId(statement.id) || statement.title === '') return null
        const group: ErGroup = { id: statement.id, label: decodeErText(statement.title ?? statement.id) }
        body.groups!.push(group)
        groupById.set(group.id, group)
        statements.push({ kind: 'group-open', id: group.id })
        break
      }
      case 'end':
        statements.push({ kind: 'group-close', id: entry.groupId! })
        break
      case 'class-def':
        if (Object.keys(statement.props).length === 0) return null
        if (!body.classDefs) body.classDefs = {}
        for (const name of statement.names) body.classDefs[name] = { ...statement.props }
        break
      case 'class':
        for (const id of statement.ids) {
          // Upstream ignores class assignments before an entity exists.
          if (entityMap.has(id)) recordErClassNames(classNamesByEntity, id, statement.classNames)
        }
        break
      case 'style':
        if (statement.ids.length === 0 || Object.keys(statement.props).length === 0) return null
        for (const id of statement.ids) {
          const entity = upsert(id)
          entity.style = { ...entity.style, ...statement.props }
        }
        break
      case 'relation': {
        const { relation } = statement
        const left = parseErCardinality(relation.leftToken)
        const right = parseErCardinality(relation.rightToken)
        if (!left || !right) return null
        const relationIndex = body.relations.length
        body.relations.push({
          from: relation.entity1.id,
          to: relation.entity2.id,
          leftCard: AGENT_CARDINALITY[left],
          rightCard: AGENT_CARDINALITY[right],
          dashed: !relation.identifying,
          label: decodeErText(relation.label) || undefined,
        })
        for (const end of [relation.entity1, relation.entity2]) {
          if (entry.relationEntityIds!.includes(end.id)) upsert(end.id, end.className)
        }
        statements.push({ kind: 'relation', ref: relationIndex })
        break
      }
      case 'block-open': {
        // Entity with attribute block. The reference may carry a display alias.
        const { reference } = statement
        upsert(reference.id, reference.className)
        declareEntityStatement(reference.id)
        break
      }
      case 'entity': {
        // Bare or aliased entity declaration (no attributes).
        const { reference } = statement
        upsert(reference.id, reference.className)
        declareEntityStatement(reference.id)
        break
      }
    }
  }

  const placement = source.placement
  // An empty alias has no Mermaid spelling either (writableErId).
  if ([...placement.alias.values()].includes('')) return null
  for (const [id, names] of classNamesByEntity) entityMap.get(id)!.className = names.join(' ')
  body.entities = placement.order.map(id => {
    const { attributes, ...paint } = entityMap.get(id)!
    // The typed body keeps the first alias as written, its entity codes read;
    // markdown and `<br>` are the renderer's display.
    const alias = placement.alias.get(id)
    const owner = placement.owner.get(id)
    return {
      ...paint,
      ...(alias !== undefined ? { label: decodeErText(alias) } : {}),
      attributes,
      ...(owner !== undefined ? { groupId: owner } : {}),
    }
  })
  for (const group of body.groups!) {
    const parentId = placement.owner.get(group.id)
    if (parentId !== undefined) group.parentId = parentId
  }
  return body
}

// ---- Serializer -----------------------------------------------------------

const LEFT_GLYPH: Record<ErCardinality, string> = {
  'one-only': '||', 'zero-or-one': '|o', 'zero-or-many': '}o', 'one-or-many': '}|',
}
const RIGHT_GLYPH: Record<ErCardinality, string> = {
  'one-only': '||', 'zero-or-one': 'o|', 'zero-or-many': 'o{', 'one-or-many': '|{',
}

function renderErEntityReference(entity: ErEntity): string {
  const bare = parseErEntityId(entity.id) !== null
  // A quoted id is kept as written, and a quoted name cannot hold `"`, `%`
  // or `\`, so it needs no encoding.
  const renderedId = bare ? entity.id : `"${entity.id}"`
  return entity.label === undefined ? renderedId : `${renderedId}[${writeErName(entity.label)}]`
}

/** A trailing `style` line re-creates an entity by itself only when there is
 * nothing else (attributes, an alias, a subgraph) to declare. */
function styleCreatesErEntity(entity: ErEntity): boolean {
  return entity.style !== undefined && entity.attributes.length === 0 && !entity.groupId
    && renderErEntityReference(entity) === renderErEntityReference({ ...entity, label: undefined })
}

/** The subgraph re-reading the body's statements alone gives each entity
 * they name: the shared creation fold (src/er/creation.ts) over them. */
function statementErGroups(body: ErBody): ReadonlyMap<string, string> {
  const fold = createErCreationFold()
  for (const statement of body.statements ?? []) foldErStatement(fold, body, statement)
  return fold.finish().owner
}

/** Feed one typed statement to the creation fold, as re-reading it would. */
function foldErStatement(fold: ErCreationFold, body: ErBody, statement: ErStatement): void {
  if (statement.kind === 'group-open') fold.open(statement.id)
  else if (statement.kind === 'group-close') fold.close()
  else if (statement.kind === 'entity') fold.declare(statement.id)
  else if (statement.kind === 'relation') {
    const relation = body.relations[statement.ref]
    if (relation) { fold.relationEnd(relation.from); fold.relationEnd(relation.to) }
  }
}

/**
 * Insert `statement`, which names entity `id`, right after the statement that
 * creates `id` (its first mention, by the shared fold), or last when no
 * statement names it. There the entity already exists, and the new statement
 * sits in the subgraph of the one that named it, so re-reading keeps both
 * the creation order and the placement.
 */
function insertAfterCreatingStatement(body: ErBody, id: string, statement: ErStatement): void {
  const statements = ensureErStatements(body)
  const fold = createErCreationFold()
  const at = statements.findIndex(candidate => {
    foldErStatement(fold, body, candidate)
    return fold.created(id)
  })
  statements.splice(at < 0 ? statements.length : at + 1, 0, statement)
}

export function renderEr(body: ErBody): string {
  const lines: string[] = ['erDiagram']
  const entityById = new Map(body.entities.map(entity => [entity.id, entity]))
  const groupById = new Map((body.groups ?? []).map(group => [group.id, group]))
  const pushEntity = (entity: ErEntity): void => {
    const reference = renderErEntityReference(entity)
    if (entity.attributes.length === 0) lines.push(`  ${reference}`)
    else {
      lines.push(`  ${reference} {`)
      for (const attribute of entity.attributes) lines.push(`    ${attribute.text}`)
      lines.push('  }')
    }
  }
  const pushRelation = (relation: ErRelation): void => {
    const left = LEFT_GLYPH[relation.leftCard]
    const right = RIGHT_GLYPH[relation.rightCard]
    const link = relation.dashed ? '..' : '--'
    const label = relation.label ?? ''
    // Mermaid reads an alias only on a declaration, never on a relation end.
    const from = entityById.get(relation.from)
    const to = entityById.get(relation.to)
    const fromRef = from ? renderErEntityReference({ ...from, label: undefined }) : relation.from
    const toRef = to ? renderErEntityReference({ ...to, label: undefined }) : relation.to
    lines.push(`  ${fromRef} ${left}${link}${right} ${toRef} : ${writeErRelationLabel(label)}`)
  }

  const styleCreated = new Set<string>()
  if (body.statements) {
    // Re-parsing creates each entity at the first statement that names it and
    // puts it in the subgraph statementErGroups reports. Where either would
    // differ from the body, declare the entity inside its own subgraph, before
    // the statement that creates a later entity (or before that statement's
    // subgraph opens), so the source re-parses to the same entities, in the
    // same order and subgraphs.
    const { entities, statements } = body
    const order = new Map(entities.map((entity, index) => [entity.id, index]))
    const statementGroups = statementErGroups(body)
    const regroup = new Set(entities.filter(entity => statementGroups.get(entity.id) !== entity.groupId).map(entity => entity.id))
    const created = new Set<string>()
    let firstUncreated = 0
    // Entities whose declaration, attributes included, is already written; a
    // later declaration only places the entity in its subgraph.
    const declared = new Set<string>()
    const declaredByStatement = new Set(statements.flatMap(statement => statement.kind === 'entity' ? [statement.id] : []))
    const openGroups: string[] = []
    const declare = (entity: ErEntity): void => {
      if (declared.has(entity.id)) lines.push(`  ${renderErEntityReference(entity)}`)
      else pushEntity(entity)
      declared.add(entity.id)
      created.add(entity.id)
      regroup.delete(entity.id)
    }
    const uncreatedHere = (entity: ErEntity): boolean => !created.has(entity.id) && entity.groupId === openGroups.at(-1)
    const declareBefore = (limit: number): void => {
      while (firstUncreated < entities.length && created.has(entities[firstUncreated]!.id)) firstUncreated++
      for (const entity of entities.slice(firstUncreated, limit)) if (uncreatedHere(entity)) declare(entity)
    }
    const creates = (ids: string[]): void => {
      const fresh = [...new Set(ids)].filter(id => order.has(id) && !created.has(id)).map(id => order.get(id)!)
      if (fresh.length === 0) return
      // A relation creates both ends, in source order: when they are not the
      // next two entities, declare what must come before the later one.
      const [first, second] = fresh as [number, number?]
      const inPlace = second === undefined || (first < second && !entities.slice(first + 1, second).some(uncreatedHere))
      declareBefore(inPlace ? first : Math.max(first, second))
      for (const at of fresh) created.add(entities[at]!.id)
    }
    // The first body position a subgraph will create: an entity its
    // statements name, or one that belongs inside it.
    const firstCreatedWithin = (openAt: number): number => {
      const groups = new Set<string>()
      const named = new Set<string>()
      for (let index = openAt, depth = 0; index < statements.length; index++) {
        const statement = statements[index]!
        if (statement.kind === 'group-open') { groups.add(statement.id); depth++ }
        else if (statement.kind === 'group-close' && --depth === 0) break
        else if (statement.kind === 'entity') named.add(statement.id)
        else if (statement.kind === 'relation') {
          const relation = body.relations[statement.ref]
          if (relation) named.add(relation.from).add(relation.to)
        }
      }
      const at = entities.findIndex(entity => !created.has(entity.id)
        && (named.has(entity.id) || (entity.groupId !== undefined && groups.has(entity.groupId))))
      return at < 0 ? 0 : at
    }

    statements.forEach((statement, index) => {
      if (statement.kind === 'entity') {
        const entity = entityById.get(statement.id)
        if (entity && !declared.has(entity.id)) {
          creates([entity.id])
          pushEntity(entity)
          declared.add(entity.id)
        }
      } else if (statement.kind === 'relation') {
        const relation = body.relations[statement.ref]
        if (relation) {
          creates([relation.from, relation.to])
          pushRelation(relation)
          // An aliased end no declaration statement names gets its alias
          // right after the relation, which already named it here.
          for (const id of [relation.from, relation.to]) {
            const end = entityById.get(id)
            if (end?.label !== undefined && !declared.has(id) && !declaredByStatement.has(id) && renderErEntityReference(end) !== renderErEntityReference({ ...end, label: undefined })) {
              pushEntity(end)
              declared.add(id)
            }
          }
        }
      } else if (statement.kind === 'direction') {
        const direction = statement.groupId ? groupById.get(statement.groupId)?.direction : body.direction
        if (direction) lines.push(`  direction ${direction}`)
      } else if (statement.kind === 'group-open') {
        declareBefore(firstCreatedWithin(index))
        const group = groupById.get(statement.id)
        if (group) {
          const id = /\s/.test(group.id) ? `"${group.id}"` : group.id
          lines.push(`  subgraph ${id}${group.label !== decodeErText(group.id) ? ` [${writeErTitle(group.label)}]` : ''}`)
        }
        openGroups.push(statement.id)
      } else if (statement.kind === 'group-close') {
        // Last chance to create or place this subgraph's own entities. Re-parse
        // keeps only an entity's first declaration as a statement, so a second
        // one goes last, where it will be written again.
        const own = entities.filter(entity => entity.groupId === openGroups.at(-1))
        for (const entity of own) if (!created.has(entity.id) || (regroup.has(entity.id) && !declared.has(entity.id))) declare(entity)
        for (const entity of own) if (regroup.has(entity.id)) declare(entity)
        openGroups.pop()
        lines.push('  end')
      } else {
        for (const line of statement.lines) lines.push(line)
      }
    })
    // Trailing `style` lines re-create the last entities by themselves.
    let styleFrom = entities.length
    while (styleFrom > 0 && !created.has(entities[styleFrom - 1]!.id) && styleCreatesErEntity(entities[styleFrom - 1]!)) styleFrom--
    for (const entity of entities.slice(0, styleFrom)) if (!created.has(entity.id)) declare(entity)
    for (const entity of entities.slice(styleFrom)) styleCreated.add(entity.id)
  } else {
    if (body.direction) lines.push(`  direction ${body.direction}`)
    for (const entity of body.entities) pushEntity(entity)
    for (const relation of body.relations) pushRelation(relation)
  }

  for (const [name, style] of Object.entries(body.classDefs ?? {})) lines.push(`  classDef ${name} ${serializeStyleProps(style)}`)
  for (const entity of body.entities) {
    const reference = renderErEntityReference({ ...entity, label: undefined })
    const classLine = entity.className ? `  class ${reference} ${entity.className.trim().split(/[ \t]+/).join(',')}` : undefined
    const styleLine = entity.style ? `  style ${reference} ${serializeStyleProps(entity.style)}` : undefined
    // `class` applies only to an entity that exists, so it follows the `style`
    // line that creates one.
    for (const line of styleCreated.has(entity.id) ? [styleLine, classLine] : [classLine, styleLine]) if (line) lines.push(line)
  }
  return lines.join('\n') + '\n'
}

// ---- Mutator --------------------------------------------------------------

function cloneEr(body: ErBody): ErBody {
  return {
    kind: 'er',
    entities: body.entities.map(e => ({
      id: e.id,
      ...(e.label !== undefined ? { label: e.label } : {}),
      attributes: e.attributes.map(a => ({ ...a })),
      ...(e.className ? { className: e.className } : {}),
      ...(e.style ? { style: { ...e.style } } : {}),
      ...(e.groupId ? { groupId: e.groupId } : {}),
    })),
    relations: body.relations.map(r => ({ ...r })),
    ...(body.groups ? { groups: body.groups.map(group => ({ ...group })) } : {}),
    ...(body.direction ? { direction: body.direction } : {}),
    ...(body.classDefs ? { classDefs: Object.fromEntries(Object.entries(body.classDefs).map(([name, style]) => [name, { ...style }])) } : {}),
    ...(body.statements ? { statements: body.statements.map(statement => statement.kind === 'opaque' ? { ...statement, lines: [...statement.lines] } : { ...statement }) } : {}),
  }
}

function ensureErStatements(body: ErBody): ErStatement[] {
  if (!body.statements) {
    body.statements = [
      ...(body.direction ? [{ kind: 'direction' as const }] : []),
      ...body.entities.map(entity => ({ kind: 'entity' as const, id: entity.id })),
      ...body.relations.map((_, ref) => ({ kind: 'relation' as const, ref })),
    ]
  }
  return body.statements
}

function opaqueMentions(body: ErBody, id: string): boolean {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`(^|[^\\w.-])${escaped}([^\\w.-]|$)`)
  return (body.statements ?? []).some(statement => statement.kind === 'opaque' && statement.lines.some(line => pattern.test(line)))
}

function removeErRelations(body: ErBody, remove: (relation: ErRelation, index: number) => boolean): void {
  const indexMap = new Map<number, number>()
  const kept: ErRelation[] = []
  body.relations.forEach((relation, index) => {
    if (!remove(relation, index)) { indexMap.set(index, kept.length); kept.push(relation) }
  })
  body.relations = kept
  if (body.statements) {
    const statements: ErStatement[] = []
    for (const statement of body.statements) {
      if (statement.kind !== 'relation') statements.push(statement)
      else {
        const ref = indexMap.get(statement.ref)
        if (ref !== undefined) statements.push({ kind: 'relation', ref })
      }
    }
    body.statements = statements
  }
}

function normalizeErEntityLabel(value: string | null | undefined, field: string): Result<string | undefined, MutationError> {
  if (value === null || value === undefined) return ok(undefined)
  if (typeof value !== 'string') return err({ code: 'INVALID_OP', message: `ER entity ${field} must be a string or null` })
  const normalized = value.trim().replace(/\s+/g, ' ')
  if (!normalized || /[\r\n\[\]]/.test(normalized)) {
    return err({ code: 'INVALID_OP', message: `ER entity ${field} must be non-empty and must not contain brackets or line breaks` })
  }
  return ok(normalized)
}

export function mutateEr(body: ErBody, op: ErMutationOp): Result<ErBody, MutationError> {
  const b = cloneEr(body)
  const find = (id: string) => b.entities.find(e => e.id === id)

  switch (op.kind) {
    case 'add_entity': {
      if (!parseErEntityReference(op.id) || op.id.includes(':::') || op.id.includes('[')) {
        return err({ code: 'INVALID_OP', message: `ER entity id "${op.id}" must be a bare identifier` })
      }
      if (find(op.id)) return err({ code: 'DUPLICATE_ENTITY', message: `entity ${op.id} already exists` })
      const attributes = op.attributes ?? []
      if (attributes.some(text => !parseErAttribute(text))) {
        return err({ code: 'INVALID_OP', message: 'ER attributes must use: type name [PK, FK, UK] ["comment"]' })
      }
      const label = normalizeErEntityLabel(op.label, 'label')
      if (!label.ok) return label
      // Materialize the ordering list before adding the entity. Calling this
      // after the push would synthesize a statement for the new entity and
      // then append the same statement a second time.
      const statements = ensureErStatements(b)
      b.entities.push({ id: op.id, ...(label.value !== undefined ? { label: label.value } : {}), attributes: attributes.map(text => ({ text })) })
      statements.push({ kind: 'entity', id: op.id })
      return ok(b)
    }
    case 'remove_entity': {
      const i = b.entities.findIndex(e => e.id === op.id)
      if (i < 0) return err({ code: 'ENTITY_NOT_FOUND', message: `entity ${op.id} not found` })
      if (opaqueMentions(b, op.id)) return err({ code: 'INVALID_OP', message: `Cannot remove entity ${op.id}: an opaque preserved ER segment references it` })
      b.entities.splice(i, 1)
      removeErRelations(b, relation => relation.from === op.id || relation.to === op.id)
      if (b.statements) b.statements = b.statements.filter(statement => statement.kind !== 'entity' || statement.id !== op.id)
      return ok(b)
    }
    case 'rename_entity': {
      const e = find(op.from)
      if (!e) return err({ code: 'ENTITY_NOT_FOUND', message: `entity ${op.from} not found` })
      if (!parseErEntityReference(op.to) || op.to.includes(':::') || op.to.includes('[')) {
        return err({ code: 'INVALID_OP', message: `ER entity id "${op.to}" must be a bare identifier` })
      }
      if (find(op.to)) return err({ code: 'DUPLICATE_ENTITY', message: `entity ${op.to} already exists` })
      if (opaqueMentions(b, op.from)) return err({ code: 'INVALID_OP', message: `Cannot rename entity ${op.from}: an opaque preserved ER segment references it` })
      e.id = op.to
      for (const statement of b.statements ?? []) if (statement.kind === 'entity' && statement.id === op.from) statement.id = op.to
      for (const r of b.relations) {
        if (r.from === op.from) r.from = op.to
        if (r.to === op.from) r.to = op.to
      }
      return ok(b)
    }
    case 'set_entity_label': {
      const e = find(op.entity)
      if (!e) return err({ code: 'ENTITY_NOT_FOUND', message: `entity ${op.entity} not found` })
      const label = normalizeErEntityLabel(op.label, 'label')
      if (!label.ok) return label
      if (label.value === undefined) delete e.label
      else e.label = label.value
      return ok(b)
    }
    case 'add_attribute': {
      const e = find(op.entity)
      if (!e) return err({ code: 'ENTITY_NOT_FOUND', message: `entity ${op.entity} not found` })
      if (!parseErAttribute(op.text)) return err({ code: 'INVALID_OP', message: 'ER attribute must use: type name [PK, FK, UK] ["comment"]' })
      e.attributes.push({ text: op.text })
      if (!ensureErStatements(b).some(statement => statement.kind === 'entity' && statement.id === e.id)) {
        insertAfterCreatingStatement(b, e.id, { kind: 'entity', id: e.id })
      }
      return ok(b)
    }
    case 'remove_attribute': {
      const e = find(op.entity)
      if (!e) return err({ code: 'ENTITY_NOT_FOUND', message: `entity ${op.entity} not found` })
      if (op.index < 0 || op.index >= e.attributes.length) return err({ code: 'ATTRIBUTE_NOT_FOUND', message: `attribute index ${op.index} out of range` })
      e.attributes.splice(op.index, 1)
      return ok(b)
    }
    case 'add_relation': {
      if (!find(op.from)) return err({ code: 'ENTITY_NOT_FOUND', message: `entity ${op.from} not found` })
      if (!find(op.to)) return err({ code: 'ENTITY_NOT_FOUND', message: `entity ${op.to} not found` })
      b.relations.push({ from: op.from, to: op.to, leftCard: op.leftCard, rightCard: op.rightCard, dashed: op.dashed ?? false, label: op.label })
      ensureErStatements(b).push({ kind: 'relation', ref: b.relations.length - 1 })
      return ok(b)
    }
    case 'remove_relation': {
      if (op.index < 0 || op.index >= b.relations.length) return err({ code: 'RELATION_NOT_FOUND', message: `relation index ${op.index} out of range` })
      removeErRelations(b, (_relation, index) => index === op.index)
      return ok(b)
    }
    case 'set_direction': {
      b.direction = op.direction
      const statements = ensureErStatements(b)
      if (!statements.some(statement => statement.kind === 'direction')) statements.unshift({ kind: 'direction' })
      return ok(b)
    }
    case 'define_class': {
      if (!/^[\w-]+$/.test(op.name)) return err({ code: 'INVALID_OP', message: 'ER classDef name must contain only letters, digits, underscore, or hyphen' })
      const style = parseMutableStyleProps(op.style)
      if (!style.ok) return err({
        code: 'INVALID_OP',
        message: style.reason === 'MULTILINE'
          ? 'ER classDef style must be a single-line CSS-like property list'
          : style.reason === 'UNSAFE_PAINT'
            ? unsafeStylePaintError(`define_class ${op.name}`, style.paint).message
            : 'ER classDef style must contain at least one property:value pair',
      })
      if (!b.classDefs) b.classDefs = {}
      b.classDefs[op.name] = style.value
      return ok(b)
    }
    case 'set_entity_class': {
      const entity = find(op.entity)
      if (!entity) return err({ code: 'ENTITY_NOT_FOUND', message: `entity ${op.entity} not found` })
      if (op.className === null) delete entity.className
      else {
        if (!/^[\w-]+$/.test(op.className)) return err({ code: 'INVALID_OP', message: 'ER class name must contain only letters, digits, underscore, or hyphen' })
        entity.className = op.className
      }
      return ok(b)
    }
    case 'set_entity_style': {
      const entity = find(op.entity)
      if (!entity) return err({ code: 'ENTITY_NOT_FOUND', message: `entity ${op.entity} not found` })
      if (op.style === null) delete entity.style
      else {
        const style = parseMutableStyleProps(op.style)
        if (!style.ok) return err({
          code: 'INVALID_OP',
          message: style.reason === 'MULTILINE'
            ? 'ER entity style must be a single-line CSS-like property list'
            : style.reason === 'UNSAFE_PAINT'
              ? unsafeStylePaintError(`set_entity_style ${op.entity}`, style.paint).message
              : 'ER entity style must contain at least one property:value pair',
        })
        entity.style = style.value
      }
      return ok(b)
    }
    default:
      return err({ code: 'INVALID_OP', message: unknownOpMessage('er', op) })
  }
}

// ---- Verifier -------------------------------------------------------------

export function verifyErBody(body: ErBody, opts: VerifyOptions): LayoutWarning[] {
  const warnings: LayoutWarning[] = []
  if (body.entities.length === 0 && body.relations.length === 0 && (body.groups?.length ?? 0) === 0) {
    warnings.push({ code: 'EMPTY_DIAGRAM' })
    return warnings
  }
  const ids = new Set([...body.entities.map(e => e.id), ...(body.groups ?? []).map(group => group.id)])
  const overflow = labelOverflowCollector(warnings, opts)
  for (const group of body.groups ?? []) overflow(group.id, group.label)
  for (const e of body.entities) {
    if (e.label) overflow(e.id, e.label)
    for (let i = 0; i < e.attributes.length; i++) {
      overflow(`${e.id}#a${i}`, e.attributes[i]!.text)
    }
  }
  for (let i = 0; i < body.relations.length; i++) {
    const r = body.relations[i]!
    if (!ids.has(r.from) || !ids.has(r.to)) {
      warnings.push({
        code: 'EDGE_MISANCHORED', edge: `rel#${i}:${r.from}->${r.to}`,
        from: ids.has(r.from) ? r.from : undefined, to: ids.has(r.to) ? r.to : undefined,
      })
    }
    if (r.label) overflow(`rel#${i}`, r.label)
  }
  return warnings
}
