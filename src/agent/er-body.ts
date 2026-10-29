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
import { decodeXML } from 'entities'
import type {
  ErBody, ErEntity, ErRelation, ErCardinality, ErAttribute, ErStatement, ErGroup,
  ErMutationOp, MutationError, Result, LayoutWarning, VerifyOptions,
} from './types.ts'
import { ok, err } from './types.ts'
import { labelOverflowCollector } from './body-utils.ts'
import { prepareDisplayText, resolveLabelContent } from '../shared/display-text.ts'
import {
  erNameNeedsQuotes,
  writeErStyleText,
  writeErStyleStatement,
  isErKeywordName,
  parseErAttribute,
  portableErAttributeText,
  parseErEntityId,
  parseErEntityReference,
  recordErClassNames,
  parseErCardinality,
  hasErTrailingComment,
  readErStatements,
} from '../er/parser.ts'
import { createErCreationFold, type ErCreationFold } from '../er/creation.ts'
import { decodeErText, erCommentText, erTextLabel, writeErName, writeErRelationLabel, writeErTitle } from '../er/text.ts'
import { parseAccessibilityDirective } from '../shared/accessibility-directives.ts'
import { parseMutableStyleProps, serializeStyleProps, unsafeStylePaintError } from '../shared/style-props.ts'

/** ER source ours reads where pinned Mermaid rejects it, each on its canonical
 * line: a trailing `%%` comment after a statement is a comment, and quoted
 * text Mermaid's lexer refuses is read generously (src/er/text.ts). */
export function erUnsupportedSyntaxWarnings(canonicalSource: string): LayoutWarning[] {
  const lines = canonicalSource.split(/\r?\n/)
  const header = lines.findIndex(line => /^erDiagram\b/i.test(line.trim()))
  if (header < 0) return []
  const warnings: LayoutWarning[] = []
  const warn = (index: number, syntax: string, what: string, portable: string): void => {
    warnings.push({ code: 'UNSUPPORTED_SYNTAX', syntax, line: index + 1, message: `${what}. Pinned Mermaid rejects this; ${portable}.` })
  }
  const grammar = lines.slice(header + 1)
  const statementLines: number[] = []
  for (let index = header + 1; index < lines.length; index++) {
    const directive = parseAccessibilityDirective(lines, index)
    if (directive === undefined) break
    if (directive !== null) {
      for (let at = index; at <= directive.endIndex; at++) grammar[at - header - 1] = ''
      if (directive.suffixLine) grammar[directive.endIndex - header - 1] = directive.suffixLine
      index = directive.endIndex
      continue
    }
    statementLines.push(index)
  }
  const quotedText: Array<[index: number, what: string, portable: string]> = []
  let source: ReturnType<typeof readErStatements> | undefined
  try {
    source = readErStatements(grammar, (what, portable, index) => quotedText.push([index, what, portable]))
  } catch {
    // A statement ours cannot read fails the render; verify reports that.
  }
  for (const index of statementLines) {
    const line = lines[index]!.trim()
    if (!line || line.startsWith('%%')) continue
    // Text a comment left open on an earlier line holds is no statement.
    if (hasErTrailingComment(lines[index]!.slice(source?.continuedComments.get(index - header - 1) ?? 0))) warn(index, 'er_trailing_comment', 'A trailing %% comment after an ER statement is read as a comment', 'put the comment on a line of its own')
  }
  for (const [index, what, portable] of quotedText) warn(header + index + 1, 'er_quoted_text', what, portable)
  if (source) {
    const directionLines = new Set<number>()
    for (const entry of source.statements) {
      const { syntax } = entry
      if (syntax.kind === 'unknown') warnings.push({
        code: 'UNSUPPORTED_SYNTAX', syntax: 'er_statement', line: header + entry.line + 2,
        message: `ER statement is preserved in source but not drawn: ${entry.raw.trim()}`,
      })
      const references = syntax.kind === 'entity' || syntax.kind === 'block-open' ? [syntax.reference]
        : syntax.kind === 'relation' ? [syntax.relation.entity1, syntax.relation.entity2] : []
      for (const reference of references) {
        if (!reference.quoted && isErKeywordName(reference.id)) warn(header + entry.line + 1, 'er_keyword_name', `ER name ${reference.id} is read as a name, where Mermaid reads a keyword`, `quote it ("${reference.id}")`)
      }
      const classNames = syntax.kind === 'class' ? syntax.classNames : references.flatMap(reference => reference.className?.split(' ') ?? [])
      for (const name of classNames) if (!writableErClassName(name)) warn(header + entry.line + 1, 'er_class_name', `ER class name ${JSON.stringify(name)} has no supported lossless spelling`, 'the source and drawing are preserved, but typed editing is unavailable')
      if ((syntax.kind === 'style' || syntax.kind === 'class-def') && writeErStyleText(syntax.props) === undefined) warn(header + entry.line + 1, 'er_style_text', 'ER style text contains a property or value with no supported lossless spelling', 'the source and drawing are preserved, but typed editing is unavailable')
      if (syntax.kind === 'entity' && syntax.reference.id === '1' && !syntax.reference.quoted) {
        const remaining = [grammar[entry.line]!.slice(entry.column), ...grammar.slice(entry.line + 1)].join('\n').trimStart()
        if (/^1\s+[A-Za-z_"'0-9]/.test(remaining)) warn(header + entry.line + 1, 'er_numeric_name', 'ER name 1 before another name is read as an entity, where Mermaid reads a cardinality', 'quote it ("1")')
      }
      if (syntax.kind === 'attribute' && syntax.generous) warn(header + entry.line + 1, 'er_attribute_form', 'An attribute with keys apart or after its comment is read as its type, name, keys and comment', 'write its keys comma-separated before the comment (`int id PK, FK "c"`)')
      if (syntax.kind === 'relation' && syntax.relation.unreadLabel) {
        const { label } = syntax.relation
        if (label === '') warn(header + entry.line + 1, 'er_relation_label', 'A relationship with no label is read without one', 'write its label after a `:` on the relationship\'s line (`: ""` for none)')
        else warn(header + entry.line + 1, 'er_relation_label', `ER relation label ${label} is read as written, where Mermaid's lexer reads a keyword, a cardinality, a number or punctuation in it`, `quote it (: "${label.replace(/"/g, '#quot;')}")`)
      }
      if (syntax.kind === 'relation' && syntax.relation.unquotedWords) warnings.push({
        code: 'UNSUPPORTED_SYNTAX', syntax: 'er_label_words', line: header + entry.line + 2,
        message: 'A relationship label of several unquoted words, or of a word and a quoted name, is read whole. Pinned Mermaid reads only its first word as the label and declares the others as entities; quote the label',
      })
      // Mermaid's `.*direction\s+LR` rule makes a line holding a direction a
      // direction statement, whatever else it holds, from where the line is
      // lexed outside a block.
      if (syntax.kind !== 'direction' && entry.entityId === undefined && !['attribute', 'block-close', 'comment', 'blank'].includes(syntax.kind)
        && /direction\s+(?:TB|BT|LR|RL)/i.test((grammar[entry.line] ?? '').slice(entry.column)) && !directionLines.has(entry.line)) {
        directionLines.add(entry.line)
        warnings.push({
          code: 'UNSUPPORTED_SYNTAX', syntax: 'er_direction_line', line: header + entry.line + 2,
          message: 'A line holding direction TB (BT, LR, RL) beside other text is read statement by statement. Pinned Mermaid reads the whole line as a direction and drops the rest; put the direction on a line of its own',
        })
      }
    }
  }
  return warnings
}

/** An edit's style that no ER style text Mermaid reads can spell. */
function erStyleUnwritable(subject: string, style: Readonly<Record<string, string>>): Result<never, MutationError> | undefined {
  if (writeErStyleText(style) !== undefined) return undefined
  return err({ code: 'INVALID_OP', message: `${subject}: ER style ${serializeStyleProps(style)} contains a control character or unpaired surrogate that cannot be retained losslessly in Mermaid's SVG; remove it` })
}

/** Whether the serializer can write `id` as a Mermaid ER name: bare, or one
 * quoted name without `"`, `%` or `\`. Ours reads others (verify reports
 * them), and the typed body leaves such a diagram opaque, as written: an id is
 * identity, so it is not re-spelled with entity codes as text is. */
function writableErId(id: string): boolean {
  return parseErEntityId(id) !== null || (id !== '' && !/["%\\\r\n]/.test(id))
}

/** Class references use idList, which has neither numeric nor quoted tokens. */
function writableErClassName(name: string): boolean {
  return /^[\w-]+$/.test(name) && !/^\d/.test(name) && !isErKeywordName(name)
}

function erBodyWriteProblem(body: ErBody): string | undefined {
  for (const entity of body.entities) {
    for (const name of entity.className?.trim().split(/[ \t]+/) ?? []) {
      if (!writableErClassName(name)) return `ER class name ${JSON.stringify(name)} has no supported lossless Mermaid spelling`
    }
    if (entity.style && writeErStyleText(entity.style) === undefined) return `ER entity ${JSON.stringify(entity.id)} has style text with no supported lossless Mermaid spelling`
  }
  for (const [name, style] of Object.entries(body.classDefs ?? {})) {
    if (writeErStyleText(style) === undefined) return `ER classDef ${JSON.stringify(name)} has style text with no supported lossless Mermaid spelling`
  }
}

// ---- Parser ---------------------------------------------------------------

const AGENT_CARDINALITY = {
  one: 'one-only', 'zero-one': 'zero-or-one', many: 'one-or-many', 'zero-many': 'zero-or-many', parent: 'parent',
} as const satisfies Record<NonNullable<ReturnType<typeof parseErCardinality>>, ErCardinality>

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
        const group: ErGroup = { id: statement.id, ...erTextLabel(statement.title ?? statement.id) }
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
        if (!left || !right || right === 'parent') return null
        const relationIndex = body.relations.length
        body.relations.push({
          from: relation.entity1.id,
          to: relation.entity2.id,
          leftCard: AGENT_CARDINALITY[left],
          rightCard: AGENT_CARDINALITY[right],
          dashed: !relation.identifying,
          ...(relation.label ? erTextLabel(relation.label) : { label: undefined }),
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
  // An unknown-only source has no editable ER content. Preserve it as a whole
  // opaque body rather than advertise an empty structured schema as support.
  if (placement.order.length === 0 && source.statements.some(entry => entry.syntax.kind === 'unknown')) return null
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
      ...(alias !== undefined ? erTextLabel(alias) : {}),
      attributes,
      ...(owner !== undefined ? { groupId: owner } : {}),
    }
  })
  for (const group of body.groups!) {
    const parentId = placement.owner.get(group.id)
    if (parentId !== undefined) group.parentId = parentId
  }
  return erBodyWriteProblem(body) ? null : body
}

// ---- Serializer -----------------------------------------------------------

const LEFT_GLYPH: Record<ErCardinality, string> = {
  'one-only': '||', 'zero-or-one': '|o', 'zero-or-many': '}o', 'one-or-many': '}|', parent: 'u',
}
const RIGHT_GLYPH: Record<Exclude<ErCardinality, 'parent'>, string> = {
  'one-only': '||', 'zero-or-one': 'o|', 'zero-or-many': 'o{', 'one-or-many': '|{',
}

// Mermaid's style-state id token.
const ER_STYLE_TEXT = /^(?:[^\x00-\x7F]|\w|-|\*)+$/

function renderErEntityReference(entity: ErEntity): string {
  const bare = parseErEntityId(entity.id) !== null && !erNameNeedsQuotes(entity.id)
  // A quoted id is kept as written, and a quoted name cannot hold `"`, `%`
  // or `\`, so it needs no encoding.
  const renderedId = bare ? entity.id : `"${entity.id}"`
  return entity.label === undefined ? renderedId : `${renderedId}[${writeErName(entity.label, entity.labelContent)}]`
}

/** A trailing `style` line re-creates an entity by itself only when there is
 * nothing else (attributes, an alias, a subgraph) to declare. */
function styleCreatesErEntity(entity: ErEntity): boolean {
  return entity.style !== undefined && entity.attributes.length === 0 && !entity.groupId
    && renderErEntityReference(entity) === renderErEntityReference({ ...entity, label: undefined })
}

/** The subgraph re-reading the body's statements alone gives each entity
 * they name: the shared creation fold (src/er/creation.ts) over them. */
function statementErGroups(body: ErBody, predeclared: ReadonlySet<string>): ReadonlyMap<string, string> {
  const fold = createErCreationFold()
  for (const statement of body.statements ?? []) {
    // A declaration moved into the prefix is omitted at its former position.
    // Its owner may therefore need a bare mention before that group closes.
    if (statement.kind !== 'entity' || !predeclared.has(statement.id)) foldErStatement(fold, body, statement)
  }
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
  const problem = erBodyWriteProblem(body)
  if (problem) throw new Error(problem)
  const written = writeEr(body, [])
  const position = new Map(written.order.map((id, index) => [id, index]))
  // The suffix after the rightmost inversion already appears in body order.
  // Predeclaring the preceding prefix at top level fixes creation order
  // independently of later group membership. This needs one further write,
  // never a search over groups, and leaves faithful statement streams alone.
  let next = Infinity
  for (let index = body.entities.length - 1; index >= 0; index--) {
    const at = position.get(body.entities[index]!.id) ?? Infinity
    if (at >= next) return writeEr(body, body.entities.slice(0, index + 1)).source
    next = at
  }
  return written.source
}

function writeEr(body: ErBody, prefix: readonly ErEntity[]): { source: string; order: readonly string[] } {
  const lines: string[] = ['erDiagram']
  const fold = createErCreationFold()
  const predeclared = new Set(prefix.map(entity => entity.id))
  const entityById = new Map(body.entities.map(entity => [entity.id, entity]))
  const groupById = new Map((body.groups ?? []).map(group => [group.id, group]))
  const pushEntity = (entity: ErEntity): void => {
    fold.declare(entity.id)
    const reference = renderErEntityReference(entity)
    if (entity.attributes.length === 0) lines.push(`  ${reference}`)
    else {
      lines.push(`  ${reference} {`)
      for (const attribute of entity.attributes) lines.push(`    ${portableErAttributeText(attribute.text)}`)
      lines.push('  }')
    }
  }
  const pushRelation = (relation: ErRelation): void => {
    fold.relationEnd(relation.from)
    fold.relationEnd(relation.to)
    const left = LEFT_GLYPH[relation.leftCard]
    const right = RIGHT_GLYPH[relation.rightCard]
    if (left === undefined || right === undefined) throw new Error('Invalid ER endpoint marker: parent is only writable before the relationship connector')
    const link = relation.dashed ? '..' : '--'
    const label = relation.label ?? ''
    // Mermaid reads an alias only on a declaration, never on a relation end.
    const from = entityById.get(relation.from)
    const to = entityById.get(relation.to)
    const fromRef = from ? renderErEntityReference({ ...from, label: undefined }) : relation.from
    const toRef = to ? renderErEntityReference({ ...to, label: undefined }) : relation.to
    lines.push(`  ${fromRef} ${left}${link}${right} ${toRef} : ${writeErRelationLabel(label, relation.labelContent)}`)
  }

  const styleCreated = new Set<string>()
  if (body.statements) {
    for (const entity of prefix) pushEntity(entity)
    // Re-parsing creates each entity at the first statement that names it and
    // puts it in the subgraph statementErGroups reports. Where either would
    // differ from the body, declare the entity inside its own subgraph, before
    // the statement that creates a later entity (or before that statement's
    // subgraph opens), so the source re-parses to the same entities, in the
    // same order and subgraphs.
    const { entities, statements } = body
    const order = new Map(entities.map((entity, index) => [entity.id, index]))
    const statementGroups = statementErGroups(body, predeclared)
    const regroup = new Set(entities.filter(entity => statementGroups.get(entity.id) !== entity.groupId).map(entity => entity.id))
    const created = new Set(predeclared)
    let firstUncreated = 0
    // Entities whose declaration, attributes included, is already written; a
    // later declaration only places the entity in its subgraph.
    const declared = new Set(predeclared)
    const declaredByStatement = new Set(statements.flatMap(statement => statement.kind === 'entity' ? [statement.id] : []))
    const openGroups: string[] = []
    const declare = (entity: ErEntity): void => {
      if (declared.has(entity.id)) {
        lines.push(`  ${renderErEntityReference(entity)}`)
        fold.declare(entity.id)
      }
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
          // Quoted where Mermaid cannot read it bare, as an entity name is.
          const id = parseErEntityId(group.id) !== null && !/^\d/.test(group.id) && !erNameNeedsQuotes(group.id) ? group.id : `"${group.id}"`
          lines.push(`  subgraph ${id}${group.label !== decodeErText(group.id) ? ` [${writeErTitle(group.label, group.labelContent)}]` : ''}`)
          fold.open(statement.id)
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
        fold.close()
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

  for (const [name, style] of Object.entries(body.classDefs ?? {})) lines.push(writeErStyleStatement(`  classDef ${name}`, style)!)
  for (const entity of body.entities) {
    const reference = renderErEntityReference({ ...entity, label: undefined })
    const classes = entity.className?.trim().split(/[ \t]+/).join(',')
    // A `style` line lexes its id as style text, so a keyword or a number is
    // written bare there; a `class` line cannot name one at all, so its class
    // goes on the entity itself (`"one":::foo`).
    const classLine = classes === undefined ? undefined
      : !writableErClassName(entity.id) ? `  ${reference}:::${classes}` : `  class ${reference} ${classes}`
    const styleLine = entity.style ? writeErStyleStatement(`  style ${ER_STYLE_TEXT.test(entity.id) ? entity.id : reference}`, entity.style) : undefined
    if (styleLine) fold.style(entity.id)
    // `class` applies only to an entity that exists, so it follows the `style`
    // line that creates one.
    for (const line of styleCreated.has(entity.id) ? [styleLine, classLine] : [classLine, styleLine]) if (line) lines.push(line)
  }
  return { source: lines.join('\n') + '\n', order: fold.finish().order }
}

// ---- Mutator --------------------------------------------------------------

function cloneEr(body: ErBody): ErBody {
  return {
    kind: 'er',
    entities: body.entities.map(e => ({
      id: e.id,
      ...(e.label !== undefined ? { label: e.label } : {}),
      ...(e.labelContent ? { labelContent: e.labelContent } : {}),
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
  const problem = erBodyWriteProblem(body)
  if (problem) return err({ code: 'INVALID_OP', message: problem })
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
      if (label.value !== e.label) delete e.labelContent
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
      if (!Object.hasOwn(LEFT_GLYPH, op.leftCard) || !Object.hasOwn(RIGHT_GLYPH, op.rightCard)) {
        return err({ code: 'INVALID_OP', message: 'Invalid ER endpoint marker: parent is only writable on the left, before the relationship connector' })
      }
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
      const unwritable = erStyleUnwritable(`define_class ${op.name}`, style.value)
      if (unwritable) return unwritable
      if (!b.classDefs) b.classDefs = {}
      b.classDefs[op.name] = style.value
      return ok(b)
    }
    case 'set_entity_class': {
      const entity = find(op.entity)
      if (!entity) return err({ code: 'ENTITY_NOT_FOUND', message: `entity ${op.entity} not found` })
      if (op.className === null) delete entity.className
      else {
        if (!writableErClassName(op.className)) return err({ code: 'INVALID_OP', message: 'ER class name must have a nonnumeric, nonkeyword spelling using letters, digits, underscore, or hyphen' })
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
        const unwritable = erStyleUnwritable(`set_entity_style ${op.entity}`, style.value)
        if (unwritable) return unwritable
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
  for (const group of body.groups ?? []) overflow(group.id, resolveLabelContent(group.label, group.labelContent))
  for (const e of body.entities) {
    if (e.label) overflow(e.id, resolveLabelContent(e.label, e.labelContent))
    for (let i = 0; i < e.attributes.length; i++) {
      const attr = parseErAttribute(decodeXML(e.attributes[i]!.text))
      if (!attr) continue
      // Each column is a literal label. Separate lines let the shared cap
      // measure the widest column once, without counting grammar or padding.
      const columns = [attr.type, attr.name, attr.keys.join(','), erCommentText(attr.comment ?? '', attr.commentContent)]
      overflow(`${e.id}#a${i}`, prepareDisplayText(columns.join('\n'), 'literal'))
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
    if (r.label) overflow(`rel#${i}`, resolveLabelContent(r.label, r.labelContent))
  }
  return warnings
}
