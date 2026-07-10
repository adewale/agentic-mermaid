import type { ErDiagram, ErEntity, ErAttribute, ErRelationship, Cardinality } from './types.ts'
import { normalizeBrTags } from '../multiline-utils.ts'
import { parseDirectionStatement } from '../shared/direction-statement.ts'

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
export function parseErDiagram(lines: string[]): ErDiagram {
  const diagram: ErDiagram = {
    entities: [],
    relationships: [],
  }

  // Track entities by ID for deduplication
  const entityMap = new Map<string, ErEntity>()
  // Track entity body parsing
  let currentEntity: ErEntity | null = null
  // Flowchart-style `subgraph … end` blocks are TOLERATED, not modeled
  // (repo #103, option 2): the block delimiters and any `direction` scoped to
  // them are ignored; entity/relationship lines inside still parse (without
  // grouping). verify announces the dropped grouping via UNSUPPORTED_SYNTAX.
  // Upstream's pinned test rides the opener on the header line
  // (`erDiagram subgraph WithRL`), so that form opens a block too.
  let subgraphDepth = /^erdiagram\s+subgraph\b/i.test(lines[0] ?? '') ? 1 : 0

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!

    const accTitle = parseAccessibilityLine(line, 'accTitle')
    if (accTitle !== undefined) {
      diagram.accessibilityTitle = accTitle
      continue
    }

    const accDescrStart = line.match(/^accDescr\s*:?\s*\{\s*(.*)$/i)
    if (accDescrStart) {
      const parsed = collectAccessibilityBlock(accDescrStart[1] ?? '', lines, i)
      diagram.accessibilityDescription = normalizeBrTags(parsed.text)
      i = parsed.nextIndex
      continue
    }

    const accDescr = parseAccessibilityLine(line, 'accDescr')
    if (accDescr !== undefined) {
      diagram.accessibilityDescription = accDescr
      continue
    }

    // --- Inside entity body ---
    if (currentEntity) {
      if (line === '}') {
        currentEntity = null
        continue
      }

      // Attribute line: type name [PK|FK|UK] ["comment"]
      const attr = parseAttribute(line)
      if (attr) {
        currentEntity.attributes.push(attr)
      }
      continue
    }

    // --- Tolerated flowchart-syntax block delimiters (repo #103) ---
    if (/^subgraph\b/.test(line)) {
      subgraphDepth++
      continue
    }
    if (line === 'end' && subgraphDepth > 0) {
      subgraphDepth--
      continue
    }

    // --- Direction statement (upstream v11.4+) ---
    // Inside a tolerated subgraph block the direction belongs to the dropped
    // grouping and must not leak to the diagram level.
    const direction = parseDirectionStatement(line)
    if (direction) {
      if (subgraphDepth === 0) diagram.direction = direction
      continue
    }

    // --- Entity block start: `ENTITY_NAME {` ---
    const entityBlockMatch = line.match(/^(\S+)\s*\{$/)
    if (entityBlockMatch) {
      const id = entityBlockMatch[1]!
      const entity = ensureEntity(entityMap, id)
      currentEntity = entity
      continue
    }

    // --- Relationship: `ENTITY1 cardinality1--cardinality2 ENTITY2 : label` ---
    const rel = parseRelationshipLine(line)
    if (rel) {
      // Ensure both entities exist
      ensureEntity(entityMap, rel.entity1)
      ensureEntity(entityMap, rel.entity2)
      diagram.relationships.push(rel)
      continue
    }
  }

  diagram.entities = [...entityMap.values()]
  return diagram
}

function parseAccessibilityLine(line: string, directive: 'accTitle' | 'accDescr'): string | undefined {
  const match = line.match(new RegExp(`^${directive}\\s*:?[ \\t]+(.+)$`, 'i'))
  return match ? normalizeBrTags(match[1]!.trim()) : undefined
}

function collectAccessibilityBlock(initial: string, lines: string[], startIndex: number): { text: string; nextIndex: number } {
  const initialEnd = initial.indexOf('}')
  if (initialEnd !== -1) return { text: initial.slice(0, initialEnd).trim(), nextIndex: startIndex }
  const parts = [initial.trim()].filter(Boolean)
  for (let i = startIndex + 1; i < lines.length; i++) {
    const line = lines[i]!
    const end = line.indexOf('}')
    if (end !== -1) {
      const beforeBrace = line.slice(0, end).trim()
      if (beforeBrace) parts.push(beforeBrace)
      return { text: parts.join('\n'), nextIndex: i }
    }
    parts.push(line)
  }
  throw new Error('ER accDescr block is missing a closing "}"')
}

/** Ensure an entity exists in the map */
function ensureEntity(entityMap: Map<string, ErEntity>, id: string): ErEntity {
  let entity = entityMap.get(id)
  if (!entity) {
    entity = { id, label: id, attributes: [] }
    entityMap.set(id, entity)
  }
  return entity
}

/** Parse an attribute line inside an entity block */
function parseAttribute(line: string): ErAttribute | null {
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
  for (const part of restWithoutComment.split(/\s+/)) {
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
 * Full pattern example: CUSTOMER ||--o{ ORDER : places
 */
function parseRelationshipLine(line: string): ErRelationship | null {
  // Match: ENTITY1 <cardinality_and_line> ENTITY2 : label
  const match = line.match(/^(\S+)\s+([|o}{]+(?:--|\.\.)[|o}{]+)\s+(\S+)\s*:\s*(.+)$/)
  if (!match) return null

  const entity1 = match[1]!
  const cardinalityStr = match[2]!
  const entity2 = match[3]!
  // Strip surrounding quotes if present, then normalize br tags
  const rawLabel = match[4]!.trim().replace(/^["']|["']$/g, '')
  const label = normalizeBrTags(rawLabel)

  // Split the cardinality string into left side, line style, right side
  const lineMatch = cardinalityStr.match(/^([|o}{]+)(--|\.\.?)([|o}{]+)$/)
  if (!lineMatch) return null

  const leftStr = lineMatch[1]!
  const lineStyle = lineMatch[2]!
  const rightStr = lineMatch[3]!

  const cardinality1 = parseCardinality(leftStr)
  const cardinality2 = parseCardinality(rightStr)
  const identifying = lineStyle === '--'

  if (!cardinality1 || !cardinality2) {
    throw new Error(
      `Invalid ER cardinality "${cardinalityStr}" in "${line}" ` +
      `(valid tokens on either side: ||, |o, o|, }o, o{, }|, |{)`,
    )
  }

  return { entity1, entity2, cardinality1, cardinality2, label, identifying }
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
