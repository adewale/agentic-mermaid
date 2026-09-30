import type { ErDiagram, ErEntity, ErAttribute, ErRelationship, Cardinality } from './types.ts'
import type { Direction } from '../types.ts'
import { normalizeBrTags } from '../multiline-utils.ts'
import { requireClosedAccessibility, scanAccessibilityDirectives } from '../shared/accessibility-directives.ts'
import { parseDirectionStatement } from '../shared/direction-statement.ts'
import { parseStyleProps } from '../shared/style-props.ts'
import { stripTrailingComment, trailingCommentStart } from '../shared/trailing-comment.ts'
import { createErCreationFold } from './creation.ts'
import { decodeErText, erDisplayText, type ErQuotedTextReport, readErQuotedName, readErRelationLabel } from './text.ts'

// Mermaid ER accepts ordinary names, numeric/decimal names, and fully quoted
// names (e.g. `1`, `2.5`, `"Entity<br>Name"`). Keep this grammar in one
// place so declarations, blocks, relationships, and the agent body agree.
// A bare name ends where the lexer's word ends: `id1||--||id2` is two names.
const ER_BARE_ENTITY_ID_SOURCE = String.raw`[A-Za-z0-9_][\w.-]*(?![\w.-])`
// A quoted name as the lexer hands it over. A `\"` stays inside the token, and
// readErQuotedName reads it as `"` (Mermaid ER quoted text has no escapes).
const ER_QUOTED_NAME_SOURCE = String.raw`"(?:\\.|[^"\\])*"`
const ER_QUOTED_NAME_RE = new RegExp(`^${ER_QUOTED_NAME_SOURCE}$`)
const ER_ENTITY_ID_SOURCE = `(?:${ER_QUOTED_NAME_SOURCE}|${ER_BARE_ENTITY_ID_SOURCE})`
const ER_ENTITY_ID_RE = new RegExp(`^${ER_BARE_ENTITY_ID_SOURCE}$`)
const ER_ENTITY_REFERENCE_SOURCE = String.raw`${ER_ENTITY_ID_SOURCE}(?:\[\s*(?:${ER_QUOTED_NAME_SOURCE}|[^\]"\r\n]+)\s*\])?(?::::[\w-]+(?:,[\w-]+)*)?`
// The same reference with its id, quoted alias, bare alias and classes captured.
const ER_ENTITY_REFERENCE_RE = new RegExp(String.raw`^(${ER_ENTITY_ID_SOURCE})(?:\[\s*(?:(${ER_QUOTED_NAME_SOURCE})|([^\]"\r\n]+))\s*\])?(?::::([\w-]+(?:,[\w-]+)*))?$`)
// Mermaid 11.16.0 accepts word/numeric aliases for the same four crow's-foot
// cardinalities. This is the single lexer vocabulary for renderer and agent.
// Keep the glyph-candidate fallback so malformed crow's-foot tokens still reach
// parseErCardinality and raise the existing fail-loud error.
const ER_CARDINALITY_SOURCE = String.raw`(?:one or zero|zero or one|one or more|one or many|zero or more|zero or many|only one|many\(0\)|many\(1\)|1\+|0\+|many|one|1|[|o}{]+)`
// A crow's-foot token needs no space to part it from a name (`id1||--||id2`);
// a word or numeric alias does.
const ER_GLYPH_SOURCE = String.raw`(?:\|\||\|o|o\||\}o|o\{|\}\||\|\{)`
const ER_RELATIONSHIP_RE = new RegExp(
  `^(${ER_ENTITY_REFERENCE_SOURCE})(?:[ \\t]+(${ER_CARDINALITY_SOURCE})|(${ER_GLYPH_SOURCE}))` +
  `(?:([ \\t]*(?:--|\\.\\.)[ \\t]*)|([ \\t]+(?:optionally to|to)[ \\t]+))` +
  `(?:(${ER_CARDINALITY_SOURCE})[ \\t]+|(${ER_GLYPH_SOURCE}))(${ER_ENTITY_REFERENCE_SOURCE})(?:[ \\t]*:[ \\t]*(.*))?$`,
  'i',
)

export interface ParsedErEntityReference {
  /** The entity's identity: a bare name, or a quoted name as written. */
  id: string
  /** The alias as written (`ID["Alias"]`, `ID[Alias]`), quotes removed. */
  alias?: string
  /** Mermaid `:::class1,class2` styling in source order, space-separated. */
  className?: string
}

/** Shared renderer/agent grammar for bare and aliased ER entity references.
 * `report` hears quoted text Mermaid rejects (src/er/text.ts). */
export function parseErEntityReference(value: string, report?: ErQuotedTextReport): ParsedErEntityReference | null {
  const match = value.trim().match(ER_ENTITY_REFERENCE_RE)
  if (!match) return null
  const id = match[1]!.startsWith('"') ? readErQuotedName(match[1]!, 'ER entity name', report) : match[1]!
  const alias = match[2] !== undefined ? readErQuotedName(match[2], 'ER entity alias', report) : match[3]?.trim()
  return {
    id,
    ...(alias !== undefined ? { alias } : {}),
    ...(match[4] ? { className: match[4].replaceAll(',', ' ') } : {}),
  }
}

/** The text the renderer draws for an entity: its alias, else its name. A
 * quoted name is text (`"Entity<br>Name"`); a bare name is drawn as written. */
function erEntityDisplayText(id: string, alias: string | undefined): string {
  if (alias !== undefined) return erDisplayText(alias)
  return ER_ENTITY_ID_RE.test(id) ? id : erDisplayText(id)
}

/** Shared renderer/agent grammar for a plain ER entity identifier. */
export function parseErEntityId(value: string): string | null {
  const id = value.trim()
  return ER_ENTITY_ID_RE.test(id) ? id : null
}

/** Mermaid's `class id,id name,name` lists share one bounded lexer on both paths. */
export function parseErClassAssignment(line: string, report?: ErQuotedTextReport): { ids: string[]; classNames: string[] } | null {
  const prefix = /^class[ \t]+/i.exec(line)
  if (!prefix) return null
  const content = line.slice(prefix[0].length).trimEnd()
  let cursor = content.length
  const reversedNames: string[] = []
  const isNameChar = (char: string): boolean => /[A-Za-z0-9_-]/.test(char)
  while (cursor > 0) {
    const end = cursor
    while (cursor > 0 && isNameChar(content[cursor - 1]!)) cursor--
    if (cursor === end) return null
    reversedNames.push(content.slice(cursor, end))

    const afterName = cursor
    while (cursor > 0 && (content[cursor - 1] === ' ' || content[cursor - 1] === '\t')) cursor--
    if (content[cursor - 1] === ',') {
      cursor--
      while (cursor > 0 && (content[cursor - 1] === ' ' || content[cursor - 1] === '\t')) cursor--
      continue
    }
    if (cursor === afterName || cursor === 0) return null
    const refs = content.slice(0, cursor).split(',').map(value => parseErEntityReference(value.trim(), report))
    if (refs.length === 0 || refs.some(value => value === null)) return null
    return { ids: refs.map(value => value!.id), classNames: reversedNames.reverse() }
  }
  return null
}

export function recordErClassNames(byEntity: Map<string, string[]>, id: string, names: readonly string[]): void {
  const existing = byEntity.get(id)
  if (existing) for (const name of names) existing.push(name)
  else byEntity.set(id, [...names])
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

const ER_GROUP_HEADER_RE = new RegExp(String.raw`^subgraph\s+(${ER_QUOTED_NAME_SOURCE}|\S+?)(?:\s*\[([^\]]+)\])?$`, 'i')

/** A subgraph header: its id as written, and its bracketed title as written. */
export function parseErGroupHeader(line: string, report?: ErQuotedTextReport): { id: string; title?: string } | null {
  const explicit = line.match(ER_GROUP_HEADER_RE)
  if (!explicit) return null
  const id = explicit[1]!.startsWith('"') ? readErQuotedName(explicit[1]!, 'ER subgraph id', report) : explicit[1]!
  const title = explicit[2]?.trim()
  if (!title) return { id }
  return { id, title: ER_QUOTED_NAME_RE.test(title) ? readErQuotedName(title, 'ER subgraph title', report) : title }
}

/** A `direction` statement. Upstream's lexer reads it to the end of its
 * line, so a `%%` after it is not a comment but part of the statement. */
export function readErDirection(line: string): Direction | undefined {
  return parseDirectionStatement(stripTrailingComment(line))
}

/**
 * Whether one ER body line carries a trailing `%%` comment. Mermaid ER has
 * none: after any statement but a `direction`, `%%` is a syntax error
 * upstream. Both parsers read it as a comment (stripTrailingComment) and
 * verify reports it. (A whole-line `%%` comment is removed before the grammar
 * runs, and `%%` inside a quoted relation label is text.)
 */
export function hasErTrailingComment(line: string): boolean {
  return trailingCommentStart(line) >= 0 && readErDirection(line) === undefined
}

/** One ER body statement outside an attribute block, as both the renderer
 * and the typed body read it. */
export type ErStatementLine =
  | { kind: 'direction'; direction: Direction }
  | { kind: 'group-open'; id: string; title?: string }
  | { kind: 'end' }
  | { kind: 'class-def'; names: string[]; props: Record<string, string> }
  | { kind: 'class'; ids: string[]; classNames: string[] }
  | { kind: 'style'; ids: string[]; props: Record<string, string> }
  | { kind: 'block-open'; reference: ParsedErEntityReference }
  | { kind: 'relation'; relation: ParsedErRelationshipSyntax }
  | { kind: 'entity'; reference: ParsedErEntityReference }

/**
 * Read one body line outside an attribute block, without its trailing `%%`
 * comment: the statement it is, or null when it is none. Throws a syntax
 * error for one ours cannot read. `end` closes a subgraph only while one is
 * open; otherwise it names an entity. `report` hears quoted text Mermaid
 * rejects (src/er/text.ts).
 */
export function readErStatement(source: string, inGroup: boolean, report?: ErQuotedTextReport): ErStatementLine | null {
  const direction = readErDirection(source)
  if (direction) return { kind: 'direction', direction }
  const line = stripTrailingComment(source)

  // --- ER subgraphs: identity, nesting and scoped direction. ---
  const groupHeader = parseErGroupHeader(line, report)
  if (groupHeader) return { kind: 'group-open', ...groupHeader }
  if (line === 'end' && inGroup) return { kind: 'end' }

  // --- Entity paint directives (upstream ER grammar) ---
  const classDef = line.match(/^classDef\s+([\w,-]+)\s+(.+)$/i)
  if (classDef) {
    return { kind: 'class-def', names: classDef[1]!.split(',').map(value => value.trim()).filter(Boolean), props: parseStyleProps(classDef[2]!) }
  }
  const classAssignment = parseErClassAssignment(line, report)
  if (classAssignment) return { kind: 'class', ...classAssignment }
  if (/^class(?:[ \t]|$)/i.test(line)) throw new Error(`Invalid ER class assignment: ${line}`)
  const inlineStyle = line.match(/^style\s+(.+?)\s+(.+)$/i)
  if (inlineStyle) {
    const ids = inlineStyle[1]!.split(',').map(value => parseErEntityReference(value.trim(), report)?.id).filter((value): value is string => value !== undefined)
    return { kind: 'style', ids, props: parseStyleProps(inlineStyle[2]!) }
  }

  // --- Entity block start: `ENTITY_NAME {` ---
  const block = line.match(ER_BLOCK_OPEN_RE)
  const blockReference = block ? parseErEntityReference(block[1]!, report) : null
  if (blockReference) return { kind: 'block-open', reference: blockReference }

  // --- Relationship: `ENTITY1 cardinality1--cardinality2 ENTITY2 : label` ---
  const relation = parseErRelationshipSyntax(line, report)
  if (relation) return { kind: 'relation', relation }

  // A bare or aliased declaration, as the typed serializer writes one.
  const reference = parseErEntityReference(line, report)
  return reference ? { kind: 'entity', reference } : null
}

const ER_BLOCK_OPEN_RE = new RegExp(`^(${ER_ENTITY_REFERENCE_SOURCE})\\s*\\{$`)

/**
 * Parse a Mermaid ER diagram.
 * Expects the first line to be "erDiagram".
 */
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

  // Which statement creates each entity, and which subgraph keeps it.
  const fold = createErCreationFold()
  // Entity records by id; their order and subgraphs come from the fold.
  const entityMap = new Map<string, ErEntity>()
  // Keep repeated assignments linear; materialize the public string once.
  const classNamesByEntity = new Map<string, string[]>()
  const ensureStyledEntity = (id: string, className?: string): ErEntity => {
    const entity = ensureEntity(entityMap, id)
    if (className) recordErClassNames(classNamesByEntity, id, className.split(' '))
    return entity
  }
  const declare = (reference: ParsedErEntityReference): ErEntity => {
    fold.declare(reference.id, reference.alias)
    return ensureStyledEntity(reference.id, reference.className)
  }
  // Subgraph labels and scoped directions; nesting and members come from the fold.
  const groupById = new Map<string, Omit<ErDiagram['groups'][number], 'entityIds'>>()
  let currentEntity: ErEntity | null = null

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!

    // --- Inside entity body ---
    if (currentEntity) {
      const statement = stripTrailingComment(line)
      if (statement === '}') {
        currentEntity = null
        continue
      }

      // Attribute line: type name [PK|FK|UK] ["comment"]
      const attr = parseErAttribute(statement)
      if (attr) {
        currentEntity.attributes.push(attr)
      }
      continue
    }

    const statement = readErStatement(line, fold.innermost !== undefined)
    switch (statement?.kind) {
      case 'direction': {
        const group = fold.innermost !== undefined ? groupById.get(fold.innermost) : undefined
        if (group) group.direction = statement.direction
        else diagram.direction = statement.direction
        break
      }
      case 'group-open':
        fold.open(statement.id)
        groupById.set(statement.id, { id: statement.id, label: erDisplayText(statement.title ?? statement.id) })
        break
      case 'end':
        fold.close()
        break
      case 'class-def':
        for (const name of statement.names) diagram.classDefs.set(name, { ...statement.props })
        break
      case 'class':
        for (const id of statement.ids) {
          // Mermaid only applies `class` to entities that already exist.
          if (entityMap.has(id)) recordErClassNames(classNamesByEntity, id, statement.classNames)
        }
        break
      case 'style':
        for (const id of statement.ids) {
          fold.style(id)
          const entity = ensureEntity(entityMap, id)
          entity.inlineStyle = { ...entity.inlineStyle, ...statement.props }
        }
        break
      case 'block-open':
        currentEntity = declare(statement.reference)
        break
      case 'relation': {
        diagram.relationships.push(relationshipFrom(statement.relation, line))
        // Group endpoints retain group identity instead of minting phantom entities.
        for (const end of [statement.relation.entity1, statement.relation.entity2]) {
          if (fold.relationEnd(end.id, end.alias)) ensureStyledEntity(end.id, end.className)
        }
        break
      }
      case 'entity':
        // Bare entities are emitted by the typed serializer.
        declare(statement.reference)
        break
    }
  }

  const placement = fold.finish()
  for (const [id, names] of classNamesByEntity) entityMap.get(id)!.className = names.join(' ')
  diagram.entities = placement.order.map(id => {
    const entity = entityMap.get(id)!
    entity.label = erEntityDisplayText(id, placement.alias.get(id))
    const owner = placement.owner.get(id)
    return owner !== undefined ? { ...entity, groupId: owner } : entity
  })
  diagram.groups = placement.groups.map(group => ({
    ...groupById.get(group.id)!,
    ...(group.parentId !== undefined ? { parentId: group.parentId } : {}),
    entityIds: group.entityIds,
  }))
  return diagram
}

/** Ensure an entity exists in the map; its label is set once the fold has
 * its first alias. */
function ensureEntity(entityMap: Map<string, ErEntity>, id: string): ErEntity {
  let entity = entityMap.get(id)
  if (!entity) {
    entity = { id, label: id, attributes: [] }
    entityMap.set(id, entity)
  }
  return entity
}

/** Parse an attribute line inside an entity block, without its trailing
 * `%%` comment (hasErTrailingComment); one that still has one is none. */
export function parseErAttribute(line: string): ErAttribute | null {
  // Format: type name [PK|FK|UK [...]] ["comment"]
  const match = line.match(/^(\S+)\s+(\S+)(?:\s+(.+))?$/)
  if (!match || trailingCommentStart(line) >= 0) return null

  const type = match[1]!
  const name = match[2]!
  const rest = match[3]?.trim() ?? ''

  // Extract key constraints (PK, FK, UK) and optional comment
  const keys: ErAttribute['keys'] = []
  let comment: string | undefined

  // Extract quoted comment first (supports <br> tags and entity codes)
  const commentMatch = rest.match(/"([^"]*)"/)
  if (commentMatch) {
    comment = decodeErText(normalizeBrTags(commentMatch[1]!))
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
  /** The label as written, quotes removed (src/er/text.ts reads it). */
  label: string
}

/** Shared relationship grammar. Alias text may contain spaces; entity styling
 * suffixes normalize to the same stable id instead of becoming phantom ids. */
export function parseErRelationshipSyntax(line: string, report?: ErQuotedTextReport): ParsedErRelationshipSyntax | null {
  const match = line.match(ER_RELATIONSHIP_RE)
  if (!match) return null
  const leftToken = match[2] ?? match[3]!
  // Mermaid's numeric `1` lexer recognizes a glyph operator only when it is
  // adjacent on the left. Other aliases may have whitespace before the glyph.
  if (leftToken === '1' && /^[ \t]/.test(match[4] ?? '')) return null
  const entity1 = parseErEntityReference(match[1]!, report)
  const entity2 = parseErEntityReference(match[8]!, report)
  if (!entity1 || !entity2) return null
  const operator = (match[4] ?? match[5]!).trim().replace(/[ \t]+/g, ' ').toLowerCase()
  return {
    entity1,
    entity2,
    leftToken,
    rightToken: match[6] ?? match[7]!,
    identifying: operator === '--' || operator === 'to',
    label: readErRelationLabel(match[9] ?? '', report),
  }
}

function relationshipFrom(syntax: ParsedErRelationshipSyntax, line: string): ErRelationship {
  const cardinality1 = parseErCardinality(syntax.leftToken)
  const cardinality2 = parseErCardinality(syntax.rightToken)

  if (!cardinality1 || !cardinality2) {
    throw new Error(
      `Invalid ER cardinality "${syntax.leftToken}${syntax.identifying ? '--' : '..'}${syntax.rightToken}" in "${line}" ` +
      `(valid tokens include ||, |o, o|, }o, o{, }|, |{ and Mermaid's word/numeric aliases)`,
    )
  }

  return {
    entity1: syntax.entity1.id,
    entity2: syntax.entity2.id,
    cardinality1,
    cardinality2,
    label: erDisplayText(syntax.label),
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
export function parseErCardinality(str: string): Cardinality | null {
  switch (str.toLowerCase()) {
    case '||': case 'only one': case '1': case 'one': return 'one'
    case '|o': case 'o|': case 'one or zero': case 'zero or one': return 'zero-one'
    case '}|': case '|{': case 'one or more': case 'one or many': case 'many(1)': case '1+': return 'many'
    case '}o': case 'o{': case 'zero or more': case 'zero or many': case 'many(0)': case '0+': case 'many': return 'zero-many'
    default: return null
  }
}
