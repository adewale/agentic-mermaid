import type { ErDiagram, ErEntity, ErAttribute, ErRelationship, Cardinality } from './types.ts'
import { normalizeBrTags } from '../multiline-utils.ts'
import { requireClosedAccessibility, scanAccessibilityDirectives } from '../shared/accessibility-directives.ts'
import { parseDirectionStatement } from '../shared/direction-statement.ts'
import { parseStyleProps } from '../shared/style-props.ts'

// Mermaid ER accepts ordinary names, numeric/decimal names, and fully quoted
// names (e.g. `1`, `2.5`, `"Entity<br>Name"`). Keep this grammar in one
// place so declarations, blocks, relationships, and the agent body agree.
const ER_BARE_ENTITY_ID_SOURCE = String.raw`[A-Za-z0-9_][\w.-]*`
const ER_QUOTED_ENTITY_ID_SOURCE = String.raw`"(?:\\.|[^"\\])+"`
const ER_ENTITY_ID_SOURCE = `(?:${ER_QUOTED_ENTITY_ID_SOURCE}|${ER_BARE_ENTITY_ID_SOURCE})`
const ER_ENTITY_ID_RE = new RegExp(`^${ER_BARE_ENTITY_ID_SOURCE}$`)
const ER_ENTITY_REFERENCE_SOURCE = `${ER_ENTITY_ID_SOURCE}(?:\\[\\s*(?:"(?:\\\\.|[^"\\\\])*"|[^\\]"\\r\\n]+)\\s*\\])?(?::::[\\w-]+)?`

export interface ParsedErEntityReference {
  id: string
  label?: string
  /** Mermaid `:::class` styling is render-tolerated but not agent-modeled. */
  className?: string
}

/** Shared renderer/agent grammar for bare and aliased ER entity references. */
export function parseErEntityReference(value: string): ParsedErEntityReference | null {
  const regex = new RegExp(`^(${ER_ENTITY_ID_SOURCE})(?:\\[\\s*(?:"((?:\\\\.|[^"\\\\])*)"|([^\\]"\\r\\n]+))\\s*\\])?(?::::([\\w-]+))?$`)
  const match = value.trim().match(regex)
  if (!match) return null
  const quotedId = match[1]!.startsWith('"')
  const id = quotedId
    ? match[1]!.slice(1, -1).replace(/\\(["\\])/g, '$1')
    : match[1]!
  const alias = (match[2] ?? match[3]?.trim())?.replace(/\\(["\\])/g, '$1')
  return {
    id,
    ...(alias !== undefined
      ? { label: formatErMarkdown(alias) }
      : quotedId ? { label: formatErMarkdown(id) } : {}),
    ...(match[4] ? { className: match[4] } : {}),
  }
}

/** Shared renderer/agent grammar for a plain ER entity identifier. */
export function parseErEntityId(value: string): string | null {
  const id = value.trim()
  return ER_ENTITY_ID_RE.test(id) ? id : null
}

// ============================================================================
// ER diagram parser
//
// Parses Mermaid erDiagram syntax into an ErDiagram structure.
//
// Supported syntax:
//   CUSTOMER ||--o{ ORDER : places
//   CUSTOMER {
//     string name PK
//     int age
//     string email UK "user email"
//   }
//
// Cardinality notation (same token set both sides, matching Mermaid's lexer):
//   ||  exactly one
//   o|  zero or one (also |o)
//   }|  one or more (also |{)
//   o{  zero or more (also }o)
//   {o, o}, |}, {| are not Mermaid tokens and are rejected with an error.
//
// Line style:
//   --  identifying (solid line)
//   ..  non-identifying (dashed line)
// ============================================================================

/**
 * Parse a Mermaid ER diagram.
 * Expects the first line to be "erDiagram".
 */
function formatErMarkdown(value: string): string {
  return normalizeBrTags(value)
    .replace(/\*\*([\s\S]+?)\*\*/g, '<b>$1</b>')
    .replace(/_([^_\n]+)_/g, '<i>$1</i>')
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<i>$1</i>')
}

export function parseErGroupHeader(line: string): { id: string; label: string } | null {
  const explicit = line.match(/^subgraph\s+("(?:\\.|[^"])+"|\S+?)(?:\s*\[([^\]]+)\])?$/i)
  if (!explicit) return null
  const rawId = explicit[1]!
  const quoted = rawId.startsWith('"')
  const id = quoted ? rawId.slice(1, -1).replace(/\\(["\\])/g, '$1') : rawId
  return { id, label: formatErMarkdown(explicit[2]?.trim() || id) }
}

export function parseErDiagram(lines: string[]): ErDiagram {
  const accessibility = scanAccessibilityDirectives(lines)
  requireClosedAccessibility(accessibility)
  lines = accessibility.familyLines
  const diagram: ErDiagram = {
    entities: [],
    classDefs: new Map(),
    relationships: [],
    groups: [],
    ...(accessibility.accessibility.title !== undefined
      ? { accessibilityTitle: normalizeBrTags(accessibility.accessibility.title) }
      : {}),
    ...(accessibility.accessibility.descr !== undefined
      ? { accessibilityDescription: normalizeBrTags(accessibility.accessibility.descr) }
      : {}),
  }

  // Track entities by ID for deduplication
  const entityMap = new Map<string, ErEntity>()
  // Track entity body parsing and typed nested subgraph ownership.
  let currentEntity: ErEntity | null = null
  const groupStack: string[] = []
  const groupById = new Map<string, ErDiagram['groups'][number]>()
  const currentGroup = () => groupStack.at(-1)

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!

    // --- Inside entity body ---
    if (currentEntity) {
      if (line === '}') {
        currentEntity = null
        continue
      }

      // Attribute line: type name [PK|FK|UK] ["comment"]
      const attr = parseErAttribute(line)
      if (attr) {
        currentEntity.attributes.push(attr)
      }
      continue
    }

    // --- Mermaid 11.16 ER subgraphs: identity, nesting and scoped direction. ---
    const groupHeader = parseErGroupHeader(line)
    if (groupHeader) {
      if (groupById.has(groupHeader.id)) throw new Error(`Duplicate ER subgraph id '${groupHeader.id}'`)
      const group = { ...groupHeader, ...(currentGroup() ? { parentId: currentGroup() } : {}), entityIds: [] }
      groupById.set(group.id, group)
      diagram.groups.push(group)
      groupStack.push(group.id)
      continue
    }
    if (line === 'end' && groupStack.length > 0) {
      groupStack.pop()
      continue
    }

    const direction = parseDirectionStatement(line)
    if (direction) {
      const group = currentGroup() ? groupById.get(currentGroup()!) : undefined
      if (group) group.direction = direction
      else diagram.direction = direction
      continue
    }

    // --- Entity paint directives (upstream ER grammar) ---
    const classDef = line.match(/^classDef\s+([\w,-]+)\s+(.+)$/i)
    if (classDef) {
      const props = parseStyleProps(classDef[2]!)
      for (const name of classDef[1]!.split(',').map(value => value.trim()).filter(Boolean)) diagram.classDefs.set(name, { ...props })
      continue
    }
    const classAssignment = line.match(/^class\s+(.+?)\s+([\w-]+)$/i)
    if (classAssignment) {
      const ids = classAssignment[1]!.split(',').map(value => parseErEntityReference(value.trim())?.id).filter((value): value is string => value !== undefined)
      for (const id of ids) ensureEntity(entityMap, id).className = classAssignment[2]!
      continue
    }
    const inlineStyle = line.match(/^style\s+(.+?)\s+(.+)$/i)
    if (inlineStyle) {
      const ids = inlineStyle[1]!.split(',').map(value => parseErEntityReference(value.trim())?.id).filter((value): value is string => value !== undefined)
      const props = parseStyleProps(inlineStyle[2]!)
      for (const id of ids) {
        const entity = ensureEntity(entityMap, id)
        entity.inlineStyle = { ...entity.inlineStyle, ...props }
      }
      continue
    }

    // --- Entity block start: `ENTITY_NAME {` ---
    const entityBlockMatch = line.match(new RegExp(`^(${ER_ENTITY_REFERENCE_SOURCE})\\s*\\{$`))
    if (entityBlockMatch) {
      const reference = parseErEntityReference(entityBlockMatch[1]!)
      if (!reference) continue
      const entity = ensureEntity(entityMap, reference.id, reference.label, reference.className, currentGroup())
      if (currentGroup()) groupById.get(currentGroup()!)?.entityIds.push(reference.id)
      currentEntity = entity
      continue
    }

    // --- Relationship: `ENTITY1 cardinality1--cardinality2 ENTITY2 : label` ---
    const rel = parseRelationshipLine(line)
    if (rel) {
      // Group endpoints retain group identity instead of minting phantom entities.
      if (!groupById.has(rel.entity1)) ensureEntity(entityMap, rel.entity1, rel.entity1Label, rel.entity1Class, currentGroup())
      if (!groupById.has(rel.entity2)) ensureEntity(entityMap, rel.entity2, rel.entity2Label, rel.entity2Class, currentGroup())
      diagram.relationships.push(rel)
      continue
    }

    // Bare entities are emitted by the typed serializer. Delimiters,
    // subgraph headers, and direction statements were consumed above, so this
    // branch cannot mint phantom `end` or direction entities.
    const bareEntity = parseErEntityReference(line)
    if (bareEntity) {
      ensureEntity(entityMap, bareEntity.id, bareEntity.label, bareEntity.className, currentGroup())
      if (currentGroup()) groupById.get(currentGroup()!)?.entityIds.push(bareEntity.id)
    }
  }

  diagram.entities = [...entityMap.values()]
  return diagram
}

/** Ensure an entity exists in the map */
function ensureEntity(entityMap: Map<string, ErEntity>, id: string, label?: string, className?: string, groupId?: string): ErEntity {
  let entity = entityMap.get(id)
  if (!entity) {
    entity = { id, label: label ?? id, attributes: [], ...(className ? { className } : {}), ...(groupId ? { groupId } : {}) }
    entityMap.set(id, entity)
  } else {
    if (label !== undefined) entity.label = label
    if (className !== undefined) entity.className = className
    if (groupId !== undefined && entity.groupId === undefined) entity.groupId = groupId
  }
  return entity
}

/** Parse an attribute line inside an entity block */
export function parseErAttribute(line: string): ErAttribute | null {
  // Format: type name [PK|FK|UK [...]] ["comment"]
  const match = line.match(/^(\S+)\s+(\S+)(?:\s+(.+))?$/)
  if (!match) return null

  const type = match[1]!
  const name = match[2]!
  const rest = match[3]?.trim() ?? ''

  // Extract key constraints (PK, FK, UK) and optional comment
  const keys: ErAttribute['keys'] = []
  let comment: string | undefined

  // Extract quoted comment first (supports <br> tags)
  const commentMatch = rest.match(/"([^"]*)"/)
  if (commentMatch) {
    comment = normalizeBrTags(commentMatch[1]!)
  }

  // Extract key constraints
  const restWithoutComment = rest.replace(/"[^"]*"/, '').trim()
  for (const part of restWithoutComment.split(/[\s,]+/)) {
    const upper = part.toUpperCase()
    if (upper === 'PK' || upper === 'FK' || upper === 'UK') {
      keys.push(upper as 'PK' | 'FK' | 'UK')
    }
  }

  return { type, name, keys, comment }
}

/**
 * Parse a relationship line.
 *
 * Cardinality tokens (same set on both sides, matching Mermaid's lexer and
 * the agent ER body parser in src/agent/er-body.ts):
 *   ||  |o  o|  }o  o{  }|  |{
 * Line: -- (identifying) or .. (non-identifying)
 *
 * Forms like {o, o}, |}, {| are not Mermaid tokens; a relationship-shaped
 * line carrying one throws instead of being silently dropped.
 *
 * Full pattern examples: CUSTOMER ||--o{ ORDER : places; CUSTOMER ||--o{ ORDER
 */
export interface ParsedErRelationshipSyntax {
  entity1: ParsedErEntityReference
  entity2: ParsedErEntityReference
  leftToken: string
  rightToken: string
  identifying: boolean
  label: string
}

/** Shared relationship grammar. Alias text may contain spaces; entity styling
 * suffixes normalize to the same stable id instead of becoming phantom ids. */
export function parseErRelationshipSyntax(line: string): ParsedErRelationshipSyntax | null {
  const regex = new RegExp(`^(${ER_ENTITY_REFERENCE_SOURCE})\\s+([|o}{]+)(--|\\.\\.)([|o}{]+)\\s+(${ER_ENTITY_REFERENCE_SOURCE})(?:\\s*:\\s*(.*))?$`)
  const match = line.match(regex)
  if (!match) return null
  const entity1 = parseErEntityReference(match[1]!)
  const entity2 = parseErEntityReference(match[5]!)
  if (!entity1 || !entity2) return null
  const rawLabel = (match[6] ?? '').trim().replace(/^["']|["']$/g, '')
  return {
    entity1,
    entity2,
    leftToken: match[2]!,
    rightToken: match[4]!,
    identifying: match[3] === '--',
    label: formatErMarkdown(rawLabel),
  }
}

function parseRelationshipLine(line: string): (ErRelationship & { entity1Label?: string; entity2Label?: string; entity1Class?: string; entity2Class?: string }) | null {
  const syntax = parseErRelationshipSyntax(line)
  if (!syntax) return null
  const cardinality1 = parseCardinality(syntax.leftToken)
  const cardinality2 = parseCardinality(syntax.rightToken)

  if (!cardinality1 || !cardinality2) {
    throw new Error(
      `Invalid ER cardinality "${syntax.leftToken}${syntax.identifying ? '--' : '..'}${syntax.rightToken}" in "${line}" ` +
      `(valid tokens on either side: ||, |o, o|, }o, o{, }|, |{)`,
    )
  }

  return {
    entity1: syntax.entity1.id,
    entity2: syntax.entity2.id,
    ...(syntax.entity1.label !== undefined ? { entity1Label: syntax.entity1.label } : {}),
    ...(syntax.entity2.label !== undefined ? { entity2Label: syntax.entity2.label } : {}),
    ...(syntax.entity1.className !== undefined ? { entity1Class: syntax.entity1.className } : {}),
    ...(syntax.entity2.className !== undefined ? { entity2Class: syntax.entity2.className } : {}),
    cardinality1,
    cardinality2,
    label: syntax.label,
    identifying: syntax.identifying,
  }
}

/**
 * Does this ER source carry the tolerated flowchart-style subgraph construct
 * (repo #103) — either riding the header (`erDiagram subgraph X`) or as body
 * `subgraph …` openers? Consumed by verify to emit the UNSUPPORTED_SYNTAX
 * lint that announces the dropped grouping; lives beside the tolerance so the
 * announcement cannot drift from what the parser actually ignores.
 */
export function erContainsSubgraphConstruct(lines: string[]): boolean {
  if (/^erdiagram\s+subgraph\b/i.test(lines[0] ?? '')) return true
  return lines.slice(1).some(line => /^subgraph\b/.test(line))
}

/** Parse a cardinality notation string into a Cardinality type */
function parseCardinality(str: string): Cardinality | null {
  switch (str) {
    case '||': return 'one'
    case '|o': case 'o|': return 'zero-one'
    case '}|': case '|{': return 'many'
    case '}o': case 'o{': return 'zero-many'
    default: return null
  }
}
