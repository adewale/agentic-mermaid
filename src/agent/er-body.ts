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
// Unmodeled (forces opaque):
//   - non-standard cardinality glyphs
//   - directives like `title`
// ============================================================================

import { unknownOpMessage } from './mutation-ops.ts'
import type {
  ErBody, ErEntity, ErRelation, ErCardinality, ErAttribute, ErStatement, ErGroup,
  ErMutationOp, MutationError, Result, LayoutWarning, VerifyOptions,
} from './types.ts'
import { ok, err, DEFAULT_LABEL_CHAR_CAP } from './types.ts'
import { labelOverflowWarning } from './label-metrics.ts'
import {
  parseErAttribute,
  parseErEntityId,
  parseErEntityReference,
  parseErGroupHeader,
  parseErRelationshipSyntax,
} from '../er/parser.ts'
import { parseDirectionStatement } from '../shared/direction-statement.ts'
import { parseMutableStyleProps, parseStyleProps, serializeStyleProps } from '../shared/style-props.ts'

/** ER subgraphs are rendered natively; ordered opaque segments keep their
 * exact source on the mutation surface until group-specific operations exist. */
export function erUnsupportedSyntaxWarnings(_canonicalSource: string): LayoutWarning[] {
  return []
}

// ---- Parser ---------------------------------------------------------------

const LEFT_CARD: Record<string, ErCardinality> = {
  '||': 'one-only', '|o': 'zero-or-one', 'o|': 'zero-or-one',
  '}o': 'zero-or-many', 'o{': 'zero-or-many',
  '}|': 'one-or-many', '|{': 'one-or-many',
}
const RIGHT_CARD: Record<string, ErCardinality> = {
  '||': 'one-only', '|o': 'zero-or-one', 'o|': 'zero-or-one',
  'o{': 'zero-or-many', '}o': 'zero-or-many',
  '|{': 'one-or-many', '}|': 'one-or-many',
}

export function parseErBody(lines: string[]): ErBody | null {
  const statements: ErStatement[] = []
  const body: ErBody = { kind: 'er', entities: [], relations: [], groups: [], statements }
  const entityMap = new Map<string, ErEntity>()
  const upsert = (id: string, label?: string, className?: string): ErEntity => {
    let e = entityMap.get(id)
    if (!e) {
      e = { id, ...(label !== undefined ? { label } : {}), attributes: [], ...(className ? { className } : {}) }
      entityMap.set(id, e)
      body.entities.push(e)
    } else {
      if (label !== undefined) e.label = label
      if (className !== undefined) e.className = className
    }
    return e
  }
  const declaredEntities = new Set<string>()
  const declareEntityStatement = (id: string): void => {
    if (!declaredEntities.has(id)) { declaredEntities.add(id); statements.push({ kind: 'entity', id }) }
  }

  const groupStack: ErGroup[] = []
  const groupIds = new Set<string>()
  let i = 0
  while (i < lines.length) {
    const raw = lines[i]!.trim()
    i++
    if (!raw || raw.startsWith('%%')) continue

    const groupHeader = parseErGroupHeader(raw)
    if (groupHeader) {
      if (groupIds.has(groupHeader.id)) return null
      const parentId = groupStack.at(-1)?.id
      const group: ErGroup = { ...groupHeader, ...(parentId ? { parentId } : {}) }
      body.groups!.push(group)
      groupIds.add(group.id)
      groupStack.push(group)
      statements.push({ kind: 'group-open', id: group.id })
      continue
    }
    if (raw === 'end' && groupStack.length > 0) {
      const group = groupStack.pop()!
      statements.push({ kind: 'group-close', id: group.id })
      continue
    }
    const direction = parseDirectionStatement(raw)
    if (direction) {
      const group = groupStack.at(-1)
      if (group) group.direction = direction
      else body.direction = direction
      statements.push({ kind: 'direction', ...(group ? { groupId: group.id } : {}) })
      continue
    }

    const classDef = raw.match(/^classDef\s+([\w,-]+)\s+(.+)$/i)
    if (classDef) {
      const props = parseStyleProps(classDef[2]!)
      if (Object.keys(props).length === 0) return null
      if (!body.classDefs) body.classDefs = {}
      for (const name of classDef[1]!.split(',').map(value => value.trim()).filter(Boolean)) body.classDefs[name] = { ...props }
      continue
    }
    const classAssignment = raw.match(/^class\s+(.+?)\s+([\w-]+)$/i)
    if (classAssignment) {
      const ids = classAssignment[1]!.split(',').map(value => parseErEntityReference(value.trim())?.id).filter((value): value is string => value !== undefined)
      if (ids.length === 0) return null
      for (const id of ids) upsert(id).className = classAssignment[2]!
      continue
    }
    const inlineStyle = raw.match(/^style\s+(.+?)\s+(.+)$/i)
    if (inlineStyle) {
      const ids = inlineStyle[1]!.split(',').map(value => parseErEntityReference(value.trim())?.id).filter((value): value is string => value !== undefined)
      const props = parseStyleProps(inlineStyle[2]!)
      if (ids.length === 0 || Object.keys(props).length === 0) return null
      for (const id of ids) {
        const entity = upsert(id)
        entity.style = { ...entity.style, ...props }
      }
      continue
    }

    const relation = parseErRelationshipSyntax(raw)
    if (relation) {
      const lc = LEFT_CARD[relation.leftToken]
      const rc = RIGHT_CARD[relation.rightToken]
      if (!lc || !rc) return null
      const relationIndex = body.relations.length
      body.relations.push({
        from: relation.entity1.id,
        to: relation.entity2.id,
        leftCard: lc,
        rightCard: rc,
        dashed: !relation.identifying,
        label: relation.label || undefined,
      })
      if (!groupIds.has(relation.entity1.id)) {
        const entity = upsert(relation.entity1.id, relation.entity1.label, relation.entity1.className)
        if (groupStack.length > 0 && !entity.groupId) entity.groupId = groupStack.at(-1)!.id
      }
      if (!groupIds.has(relation.entity2.id)) {
        const entity = upsert(relation.entity2.id, relation.entity2.label, relation.entity2.className)
        if (groupStack.length > 0 && !entity.groupId) entity.groupId = groupStack.at(-1)!.id
      }
      statements.push({ kind: 'relation', ref: relationIndex })
      continue
    }

    // Entity with attribute block. The reference may carry a display alias.
    if (raw.endsWith('{')) {
      const reference = parseErEntityReference(raw.slice(0, -1).trim())
      if (reference) {
        const e = upsert(reference.id, reference.label, reference.className)
        if (groupStack.length > 0) e.groupId = groupStack.at(-1)!.id
        declareEntityStatement(reference.id)
        let closed = false
        while (i < lines.length) {
          const al = lines[i]!.trim()
          i++
          if (!al || al.startsWith('%%')) continue
          if (al === '}') { closed = true; break }
          if (!parseErAttribute(al)) return null
          e.attributes.push({ text: al })
        }
        if (!closed) return null
        continue
      }
    }

    // Bare or aliased entity declaration (no attributes).
    const bare = parseErEntityReference(raw)
    if (bare) {
      const entity = upsert(bare.id, bare.label, bare.className)
      if (groupStack.length > 0) entity.groupId = groupStack.at(-1)!.id
      declareEntityStatement(bare.id)
      continue
    }

    return null
  }

  if (groupStack.length > 0) return null
  return body
}

// ---- Serializer -----------------------------------------------------------

const LEFT_GLYPH: Record<ErCardinality, string> = {
  'one-only': '||', 'zero-or-one': '|o', 'zero-or-many': '}o', 'one-or-many': '}|',
}
const RIGHT_GLYPH: Record<ErCardinality, string> = {
  'one-only': '||', 'zero-or-one': 'o|', 'zero-or-many': 'o{', 'one-or-many': '|{',
}

function quoteErText(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function renderErEntityReference(entity: ErEntity): string {
  const renderedId = parseErEntityId(entity.id) ? entity.id : quoteErText(entity.id)
  if (entity.label === undefined || entity.label === entity.id || entity.label === normalizeErQuotedIdLabel(entity.id)) return renderedId
  return `${renderedId}[${quoteErText(entity.label)}]`
}

function normalizeErQuotedIdLabel(id: string): string {
  return id.replace(/<br\s*\/?>/gi, '\n')
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
    const from = entityById.get(relation.from)
    const to = entityById.get(relation.to)
    const fromRef = from ? renderErEntityReference(from) : relation.from
    const toRef = to ? renderErEntityReference(to) : relation.to
    lines.push(`  ${fromRef} ${left}${link}${right} ${toRef} : ${label === '' || label.includes(' ') ? quoteErText(label) : label}`)
  }

  if (body.statements) {
    for (const statement of body.statements) {
      if (statement.kind === 'entity') {
        const entity = entityById.get(statement.id)
        if (entity) pushEntity(entity)
      } else if (statement.kind === 'relation') {
        const relation = body.relations[statement.ref]
        if (relation) pushRelation(relation)
      } else if (statement.kind === 'direction') {
        const direction = statement.groupId ? groupById.get(statement.groupId)?.direction : body.direction
        if (direction) lines.push(`  direction ${direction}`)
      } else if (statement.kind === 'group-open') {
        const group = groupById.get(statement.id)
        if (group) {
          const id = /\s/.test(group.id) ? quoteErText(group.id) : group.id
          lines.push(`  subgraph ${id}${group.label !== group.id ? ` [${group.label}]` : ''}`)
        }
      } else if (statement.kind === 'group-close') {
        lines.push('  end')
      } else {
        for (const line of statement.lines) lines.push(`  ${line}`)
      }
    }
  } else {
    if (body.direction) lines.push(`  direction ${body.direction}`)
    for (const entity of body.entities) pushEntity(entity)
    for (const relation of body.relations) pushRelation(relation)
  }

  for (const [name, style] of Object.entries(body.classDefs ?? {})) lines.push(`  classDef ${name} ${serializeStyleProps(style)}`)
  for (const entity of body.entities) {
    if (entity.className) lines.push(`  class ${renderErEntityReference({ ...entity, label: undefined })} ${entity.className}`)
    if (entity.style) lines.push(`  style ${renderErEntityReference({ ...entity, label: undefined })} ${serializeStyleProps(entity.style)}`)
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
      b.entities.push({ id: op.id, ...(label.value !== undefined ? { label: label.value } : {}), attributes: attributes.map(text => ({ text })) })
      ensureErStatements(b).push({ kind: 'entity', id: op.id })
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
      const statements = ensureErStatements(b)
      if (!statements.some(statement => statement.kind === 'entity' && statement.id === e.id)) {
        const relationAt = statements.findIndex(statement => statement.kind === 'relation' && (() => {
          const relation = b.relations[statement.ref]
          return relation?.from === e.id || relation?.to === e.id
        })())
        statements.splice(relationAt >= 0 ? relationAt : statements.length, 0, { kind: 'entity', id: e.id })
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
  const cap = opts.labelCharCap ?? DEFAULT_LABEL_CHAR_CAP
  if (body.entities.length === 0 && body.relations.length === 0 && (body.groups?.length ?? 0) === 0) {
    warnings.push({ code: 'EMPTY_DIAGRAM' })
    return warnings
  }
  const ids = new Set([...body.entities.map(e => e.id), ...(body.groups ?? []).map(group => group.id)])
  const overflow = (target: string, text: string) => {
    const w = labelOverflowWarning(target, text, cap)
    if (w) warnings.push(w)
  }
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
