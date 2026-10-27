import { encodeMermaidEntities, protectMermaidEntityPrepass, TERMINAL_CONTROL_RE } from '../shared/mermaid-entities.ts'
import { generatedIds } from '../shared/generated-identity.ts'
import {
  C4_VARIANTS, C4AmbiguousArgumentError, c4ArgumentFields, c4ArgumentsArePortable, c4BoundaryFields, c4DiagnosticMessage, c4DirectiveArgumentsArePortable, c4DirectiveCategory, c4DirectiveFields, c4ElementFields,
  c4RecordSignature, c4RelationshipFields, emptyC4Body, readC4Source, resolveC4Directives,
} from '../c4/parser.ts'
import type {
  C4Argument, C4ArgumentInput, C4Body, C4Boundary, C4BoundaryInput, C4Directive,
  C4Element, C4ElementInput, C4MutationOp, C4Relationship, C4RelationshipInput, C4Statement,
} from '../c4/types.ts'
import type { Accessibility, LayoutWarning, MutationError, Result, SourceMap, VerifyOptions } from './types.ts'
import { err, ok } from './types.ts'
import { labelOverflowCollector } from './body-utils.ts'
import { unknownOpMessage } from './mutation-ops.ts'
import { appendAccessibilityLines } from './accessibility-envelope.ts'

export { emptyC4Body }

export function parseC4Body(lines: string[] | string, accessibility: Accessibility = {}): C4Body | null {
  try {
    const body = readC4Source(lines)
    if (accessibility.title !== undefined) body.accessibilityTitle = accessibility.title
    if (accessibility.descr !== undefined) body.accessibilityDescription = accessibility.descr
    return body
  } catch (error) {
    if (error instanceof C4AmbiguousArgumentError) throw error
    return null
  }
}

function quote(value: string, reserved = ''): string {
  // C4's official lexer has no backslash escape. Entity encoding also protects
  // literal entity spellings. Shield directive openers after encoding: the
  // public Mermaid prepass reads them even inside a quoted argument.
  return `"${edgeWhitespace(encodeMermaidEntities(value, '"\\' + reserved).replace(/%%\{/g, '%#37;{'))}"`
}

/** Mermaid's C4 grammar, and ours, trim each argument, so whitespace at
 * either end is written as an entity code, which neither trims. A control
 * character has no entity spelling: the serialized-model check refuses it. */
function edgeWhitespace(text: string): string {
  return text.replace(/^\s+|\s+$/g, run => [...run].map(character => TERMINAL_CONTROL_RE.test(character) ? character : `#${character.codePointAt(0)};`).join(''))
}

function alias(value: string, reserved = ''): string {
  return /^[A-Za-z_][A-Za-z_0-9]*$/.test(value) ? value : quote(value, reserved)
}
function displayQuote(value: string, reserved = ''): string { return `"${edgeWhitespace(encodeMermaidEntities(value, '"\\<>' + reserved).replace(/%%\{/g, '%#37;{').replace(/\r\n?|\n/g, '<br/>'))}"` }

function call(name: string, fields: Record<string, string | undefined>, slots: readonly string[], required: number): string {
  return protectMermaidEntityPrepass(reserved => {
    const args: string[] = []
    for (let index = 0; index < required; index++) {
      const key = slots[index]!, value = fields[key] ?? ''
      args.push(key === 'alias' || key === 'from' || key === 'to' || key === 'index' ? alias(value, reserved) : displayQuote(value, reserved))
    }
    for (let index = required; index < slots.length; index++) {
      const key = slots[index]!, value = fields[key]
      if (value !== undefined && value !== '') args.push(`$${key}=${['techn', 'descr', 'type'].includes(key) ? displayQuote(value, reserved) : quote(value, reserved)}`)
    }
    return `${name}(${args.join(', ')})`
  })
}

export function renderC4Element(record: C4Element): string {
  return call(record.macro, {
    alias: record.id, label: record.label, techn: record.technology, descr: record.description,
    sprite: record.sprite, tags: record.tags.join('+') || undefined, link: record.link,
  }, c4ElementFields(record.macro), 2)
}
export function renderC4Boundary(record: C4Boundary): string {
  return `${call(record.macro, {
    alias: record.id, label: record.label, type: record.type, descr: record.description,
    sprite: record.sprite, tags: record.tags.join('+') || undefined, link: record.link,
  }, c4BoundaryFields(record.macro), 2)} {`
}
export function renderC4Relationship(record: C4Relationship): string {
  return call(record.macro, {
    index: record.index, from: record.from, to: record.to, label: record.label, techn: record.technology,
    descr: record.description, sprite: record.sprite, tags: record.tags.join('+') || undefined, link: record.link,
  }, c4RelationshipFields(record.macro), record.macro === 'RelIndex' ? 4 : 3)
}
function renderDirective(record: C4Directive): string {
  if (record.name === 'direction') return `direction ${record.args[0]?.value ?? 'TB'}`
  return protectMermaidEntityPrepass(reserved => {
    const slots = c4DirectiveFields(record.name)
    if (slots) {
      const fields = c4ArgumentFields(record.args, slots)
      if (record.name === 'UpdateLayoutConfig') {
        // The DB ignores names here. An empty positional value leaves the
        // current setting untouched; the grammar still requires one attribute.
        const last = fields.c4BoundaryInRow !== undefined ? 2 : 1
        return `${record.name}(${slots.slice(0, last).map(key => quote(fields[key] ?? '', reserved)).join(', ')})`
      }
      const required = record.name === 'UpdateElementStyle' ? 1 : 2
      const args = slots.slice(0, required).map(key => quote(fields[key] ?? '', reserved))
      for (const key of slots.slice(required)) {
        if (fields[key] !== undefined && fields[key] !== '') args.push(`$${key}=${quote(fields[key]!, reserved)}`)
      }
      return `${record.name}(${args.join(', ')})`
    }
    return `${record.name}(${record.args.map(arg => `${arg.name ? `$${arg.name}=` : ''}${quote(arg.value, reserved)}`).join(', ')})`
  })
}

function newStatement(body: C4Body, kind: C4Statement['kind'], entityId?: string, raw = ''): C4Statement {
  const allocate = generatedIds(body.statements.map(statement => statement.id))
  return { id: allocate('c4-statement-new'), kind, entityId, raw, span: { start: 0, end: 0, line: 0, column: 0 } }
}

function canonicalStatements(body: C4Body): C4Statement[] {
  const result: C4Statement[] = []
  const push = (kind: C4Statement['kind'], entityId?: string, raw = ''): void => {
    result.push({ id: `c4-statement-${result.length + 1}`, kind, entityId, raw, span: { start: 0, end: 0, line: 0, column: 0 } })
  }
  push('header'); push('trivia', undefined, '\n')
  if (body.title !== undefined) { push('title'); push('trivia', undefined, '\n') }
  if (body.accessibilityTitle !== undefined) { push('accessibility', 'title'); push('trivia', undefined, '\n') }
  if (body.accessibilityDescription !== undefined) { push('accessibility', 'description'); push('trivia', undefined, '\n') }
  const children = new Map<string | undefined, (C4Element | C4Boundary)[]>()
  for (const record of [...body.boundaries, ...body.elements]) {
    const siblings = children.get(record.parentId) ?? []
    siblings.push(record); children.set(record.parentId, siblings)
  }
  const pending: ({ record: C4Element | C4Boundary; close?: boolean })[] = (children.get(undefined) ?? []).map(record => ({ record })).reverse()
  const boundaryIds = new Set(body.boundaries.map(record => record.id))
  while (pending.length) {
    const { record, close } = pending.pop()!
    if (close) push('boundary-close', record.id)
    else if (boundaryIds.has(record.id)) {
      push('boundary-open', record.id)
      pending.push({ record, close: true }, ...(children.get(record.id) ?? []).map(child => ({ record: child })).reverse())
    } else push('element', record.id)
    push('trivia', undefined, '\n')
  }
  for (const record of body.relationships) { push('relationship', record.id); push('trivia', undefined, '\n') }
  for (const record of body.directives) { push('directive', record.id); push('trivia', undefined, '\n') }
  return result
}

// Reader extensions with a spelling pinned Mermaid reads as ours reads them:
// the statement's canonical rendering (one line, quoted and named arguments).
const RESPELLED_C4_EXTENSIONS = new Set([
  'c4_multiline_arguments', 'c4_empty_named_argument', 'c4_space_before_arguments',
  'c4_quoted_string_extension', 'c4_relindex_positional_metadata',
  'c4_empty_layout_arguments', 'c4_unquoted_argument', 'c4_entity_prepass',
  'c4_empty_accessibility_description',
])

/** Unchanged statements retain exact raw bytes. A typed edit rewrites only its
 * declaration; comments, unknown balanced blocks and surrounding trivia keep
 * their original place. Header and dynamic variant are independent of layout.
 * `portable` writes each reader extension with a Mermaid spelling instead
 * (RESPELLED_C4_EXTENSIONS, `;` as a line break, a line break after a
 * statement that shares its line, global metadata outside boundaries), unless a statement has no native
 * interpretation: Mermaid cannot read that source anyway, so it is kept. */
function renderC4Unchecked(body: C4Body, portable = false): string {
  const respell = portable && !body.diagnostics.some(item => item.severity === 'error')
  const flagged = (syntax: (code: string) => boolean): Set<string | undefined> =>
    new Set(respell ? body.diagnostics.filter(item => syntax(item.syntax)).map(item => item.statementId) : [])
  const canonical = flagged(code => RESPELLED_C4_EXTENSIONS.has(code))
  const semicolons = flagged(code => code === 'c4_semicolon_separator')
  const breaks = flagged(code => code === 'c4_statements_on_one_line')
  const parts: RenderedPart[] = []
  const hoisted: RenderedPart[] = []
  const elements = new Map(body.elements.map(record => [record.id, record]))
  const boundaries = new Map(body.boundaries.map(record => [record.id, record]))
  const relationships = new Map(body.relationships.map(record => [record.id, record]))
  const directives = new Map(body.directives.map(record => [record.id, record]))
  const sourceStatements = body.statements.length ? body.statements : canonicalStatements(body)
  const boundaryContents: boolean[] = []
  for (const statement of sourceStatements) {
    let current: string | undefined, signature: string | undefined
    let rewriteArguments = false
    if (statement.kind === 'header') { current = body.variant; signature = body.variant }
    else if (statement.kind === 'trivia' && canonical.has(statement.id)) current = 'UpdateLayoutConfig("")'
    else if (statement.kind === 'title') {
      if (body.title === undefined) continue
      current = protectMermaidEntityPrepass(reserved => `title ${encodeMermaidEntities(body.title!, '#;<>' + reserved).replace(/%%\{/g, '%#37;{').replace(/\r\n?|\n/g, '<br/>')}`); signature = body.title
    } else if (statement.kind === 'accessibility') {
      const value = statement.entityId === 'title' ? body.accessibilityTitle : body.accessibilityDescription
      if (value === undefined) continue
      const metadata: string[] = []
      appendAccessibilityLines(metadata, statement.entityId === 'title' ? { accessibilityTitle: value } : { accessibilityDescription: value })
      current = metadata.join('\n').trimStart()
      signature = value
    } else if (statement.kind === 'boundary-close') {
      if (!boundaries.has(statement.entityId!)) continue
      current = '}'
    } else if (statement.kind === 'element' || statement.kind === 'boundary-open' || statement.kind === 'relationship' || statement.kind === 'directive') {
      const record = statement.kind === 'element' ? elements.get(statement.entityId!)
        : statement.kind === 'boundary-open' ? boundaries.get(statement.entityId!)
          : statement.kind === 'relationship' ? relationships.get(statement.entityId!) : directives.get(statement.entityId!)
      if (!record) continue
      const positional = statement.kind === 'element' ? c4ElementFields((record as C4Element).macro).slice(0, 2)
        : statement.kind === 'boundary-open' ? c4BoundaryFields((record as C4Boundary).macro).slice(0, 2)
          : statement.kind === 'relationship' ? c4RelationshipFields((record as C4Relationship).macro).slice(0, (record as C4Relationship).macro === 'RelIndex' ? 4 : 3) : []
      rewriteArguments = respell && ('name' in record ? !c4DirectiveArgumentsArePortable(record) : !c4ArgumentsArePortable(record.args, positional))
      signature = c4RecordSignature(record)
      current = statement.kind === 'element' ? renderC4Element(record as C4Element)
        : statement.kind === 'boundary-open' ? renderC4Boundary(record as C4Boundary)
          : statement.kind === 'relationship' ? renderC4Relationship(record as C4Relationship) : renderDirective(record as C4Directive)
    }
    const rewriteTitle = respell && statement.kind === 'title'
    if (respell && boundaryContents.length && (statement.kind === 'title' || statement.kind === 'accessibility')) {
      hoisted.push({ kind: 'trivia', text: '\n' }, { kind: statement.kind, text: current! }, { kind: 'trivia', text: '\n' })
      continue
    }
    let text = current === undefined || (statement.raw && (signature === statement.signature || statement.kind === 'boundary-close')) && !canonical.has(statement.id) && !rewriteArguments && !rewriteTitle ? statement.raw : current
    if (portable) {
      if (statement.kind === 'boundary-close') {
        if (boundaryContents.pop() === false) text = `\n  UpdateLayoutConfig("")\n${text}`
      } else if (statement.kind === 'element' || statement.kind === 'relationship' || statement.kind === 'directive' || statement.kind === 'boundary-open'
        || statement.kind === 'trivia' && /^\s*UpdateLayoutConfig\(\s*""\s*\)\s*$/.test(text)) {
        if (boundaryContents.length) boundaryContents[boundaryContents.length - 1] = true
        if (statement.kind === 'boundary-open') boundaryContents.push(false)
      }
    }
    if (semicolons.has(statement.id)) text = text.replace(/;/g, '')
    if (breaks.has(statement.id)) lineBreakBefore(parts)
    parts.push({ kind: statement.kind, text })
    if (semicolons.has(statement.id) && !text.includes('\n')) lineBreakBefore(parts)
  }
  parts.splice(parts.findIndex(part => part.kind === 'header') + 1, 0, ...hoisted)
  return parts.map(part => part.text).join('')
}

interface RenderedPart { kind: C4Statement['kind']; text: string }

/** End the line of the statement before the next one. Mermaid's comment
 * takes the line breaks after it, so a comment sharing that line moves to a
 * line of its own. The new line keeps that statement's indentation, one
 * level deeper (as appended statements are) after a boundary's `{`. */
function lineBreakBefore(parts: RenderedPart[]): void {
  let at = parts.length
  for (let index = parts.length - 1; index >= 0 && parts[index]!.kind === 'trivia'; index--) {
    if (parts[index]!.text.includes('\n')) at = index
    else if (parts[index]!.text.startsWith('%%')) at = index
  }
  // Spaces ending the statement's line give way to the line break.
  const spaces = at > 0 && parts[at - 1]!.kind === 'trivia' && /^[ \t]*$/.test(parts[at - 1]!.text) ? 1 : 0
  const ended = parts.slice(0, at - spaces)
  const before = ended.map(part => part.text).join('')
  const indent = /^[ \t]*/.exec(before.slice(before.lastIndexOf('\n') + 1))![0]
  const nested = ended.findLast(part => part.kind !== 'trivia')?.kind === 'boundary-open' ? '  ' : ''
  parts.splice(at - spaces, spaces, { kind: 'trivia', text: `\n${indent}${nested}` })
}

export function renderC4(body: C4Body): string {
  const problem = c4BodyProblem(body)
  if (problem) throw new Error(problem)
  return renderC4Unchecked(body, true)
}

function validText(value: unknown, name: string, required = false): string | null {
  if (typeof value !== 'string') return `${name} must be text`
  if (required && !value.trim()) return `${name} must not be empty`
  if (/\u0000/.test(value)) return `${name} cannot contain NUL`
  return null
}

/** Body invariants before serialization, also used for direct typed payloads. */
function c4BodyProblemCore(body: C4Body): string | null {
  if (!C4_VARIANTS.includes(body.variant)) return 'C4 variant must be a legacy C4 header'
  if (![body.elements, body.boundaries, body.relationships, body.directives, body.statements].every(Array.isArray)) return 'C4 collections must be arrays'
  const ids = new Set<string>(), boundaryIds = new Set(body.boundaries.map(record => record.id))
  for (const record of [...body.elements, ...body.boundaries]) {
    const problem = validText(record.id, 'C4 alias', true) ?? validText(record.label, 'C4 label')
    if (problem) return problem
    if (ids.has(record.id)) return `C4 alias ${JSON.stringify(record.id)} is already declared`
    ids.add(record.id)
    if (record.parentId !== undefined && !boundaryIds.has(record.parentId)) return `C4 parent ${JSON.stringify(record.parentId)} is not a boundary`
    if (!Array.isArray(record.tags) || record.tags.some(tag => typeof tag !== 'string' || !tag.trim() || tag.includes('+'))) return 'C4 tags must be non-empty names without + separators'
    for (const field of ['technology', 'description', 'type', 'link', 'sprite'] as const) {
      const value = (record as unknown as Record<string, unknown>)[field]
      if (value !== undefined && typeof value !== 'string') return `C4 ${field} must be text`
    }
  }
  const parents = new Map(body.boundaries.map(record => [record.id, record.parentId]))
  const checked = new Set<string>()
  for (const record of body.boundaries) {
    if (checked.has(record.id)) continue
    const visited = new Set<string>([record.id])
    let parent = record.parentId
    while (parent !== undefined) {
      if (visited.has(parent)) return `C4 boundary ${JSON.stringify(record.id)} would contain itself`
      if (checked.has(parent)) break
      visited.add(parent); parent = parents.get(parent)
    }
    for (const id of visited) checked.add(id)
  }
  const relationIds = new Set<string>()
  for (const record of body.relationships) {
    if (!ids.has(record.from) || !ids.has(record.to)) return `C4 relationship ${record.id} references an undeclared endpoint`
    if (relationIds.has(record.id) || ids.has(record.id)) return `C4 relationship identity ${record.id} collides`
    relationIds.add(record.id)
    if (validText(record.label, 'C4 relationship label')) return 'C4 relationship label must be text'
    if (record.source !== (record.reversed ? record.to : record.from) || record.target !== (record.reversed ? record.from : record.to)) return 'C4 effective relationship endpoints do not match its authored direction'
  }
  return null
}

function semanticSnapshot(body: C4Body): unknown {
  const record = (value: C4Element | C4Boundary | C4Relationship) => {
    const { args, statementId: _statementId, ...fields } = value
    return { ...fields, args: args.map(({ name, value: text }) => ({ name, value: text })) }
  }
  return {
    variant: body.variant, title: body.title, accessibilityTitle: body.accessibilityTitle, accessibilityDescription: body.accessibilityDescription,
    elements: body.elements.map(record), boundaries: body.boundaries.map(record), relationships: body.relationships.map(record),
    directives: body.directives.map(({ name, category, args }) => ({ name, category, args: args.map(({ name: key, value }) => ({ name: key, value })) })),
    layout: body.layout, legend: body.legend ?? { visible: false, entries: [] },
  }
}
function stableJSON(value: unknown): string {
  return JSON.stringify(value, (_key, current) => current && typeof current === 'object' && !Array.isArray(current)
    ? Object.fromEntries(Object.entries(current).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : current)
}

/** Serialization is also a typed-payload admission boundary. Source-preserved
 * statements may not quietly override changed typed fields, derived endpoint
 * flags, styles, or missing declarations. Mutations return a fresh artifact. */
export function c4BodyProblem(body: C4Body): string | null {
  try {
    const problem = c4BodyProblemCore(body)
    if (problem) return problem
    const source = renderC4Unchecked(body)
    const parsed = readC4Source(source)
    if (stableJSON(semanticSnapshot(body)) !== stableJSON(semanticSnapshot(parsed))) return 'C4 typed body does not match its serialized semantic model; use typed operations to keep source, fields and identities aligned'
    return null
  } catch (error) { return `Invalid C4 body: ${error instanceof Error ? error.message : String(error)}` }
}

function elementMacro(input: C4ElementInput, previous?: C4Element): string {
  if (input.macro !== undefined) return input.macro
  const kind = input.kind ?? previous?.kind ?? 'system'
  const shape = input.shape ?? previous?.shape ?? (kind === 'person' ? 'person' : 'rectangle')
  if ((kind === 'person' && shape !== 'person') || (kind !== 'person' && shape === 'person')) throw new Error('C4 person shape requires person kind; database and queue shapes require a non-person kind')
  return kind[0]!.toUpperCase() + kind.slice(1) + (shape === 'database' ? 'Db' : shape === 'queue' ? 'Queue' : '') + ((input.external ?? previous?.external) ? '_Ext' : '')
}
function boundaryMacro(input: C4BoundaryInput, previous?: C4Boundary): string {
  if (input.macro !== undefined) return input.macro
  if (input.kind === undefined && previous) return previous.macro
  return { boundary: 'Boundary', enterprise: 'Enterprise_Boundary', system: 'System_Boundary', container: 'Container_Boundary', deployment: 'Deployment_Node' }[input.kind ?? 'system']
}
function requireRepresented(input: object, parsed: object, fields: readonly string[], macro: string): void {
  for (const field of fields) {
    const requested = (input as Record<string, unknown>)[field]
    const actual = (parsed as Record<string, unknown>)[field]
    if (requested === undefined || (requested === '' && actual === undefined)) continue
    if (JSON.stringify(requested) !== JSON.stringify(actual)) throw new Error(`C4 ${macro} cannot represent ${field} without changing its meaning`)
  }
}
function elementFrom(input: C4ElementInput, previous?: C4Element): C4Element {
  const macro = elementMacro(input, previous)
  const fields = { ...previous, ...input, macro, tags: input.tags ?? previous?.tags ?? [], style: {}, args: [], statementId: '' } as C4Element
  const parsed = readC4Source(`C4Context\n${renderC4Element(fields)}`).elements[0]
  if (!parsed) throw new Error(`C4 ${macro} is not an element macro`)
  if (input.macro !== undefined) for (const field of ['kind', 'shape', 'external'] as const) {
    if (input[field] !== undefined && input[field] !== parsed[field]) throw new Error(`C4 macro ${macro} conflicts with ${field}`)
  }
  requireRepresented(input, parsed, ['id', 'label', 'technology', 'description', 'tags', 'link', 'sprite'], macro)
  parsed.parentId = input.parentId ?? previous?.parentId
  return parsed
}
function boundaryFrom(input: C4BoundaryInput, previous?: C4Boundary): C4Boundary {
  const macro = boundaryMacro(input, previous)
  const fields = { ...previous, ...input, macro, tags: input.tags ?? previous?.tags ?? [], style: {}, args: [], statementId: '' } as C4Boundary
  const parsed = readC4Source(`C4Context\n${renderC4Boundary(fields)}\n}`).boundaries[0]
  if (!parsed) throw new Error(`C4 ${macro} is not a boundary macro`)
  requireRepresented(input, parsed, ['id', 'label', 'kind', 'type', 'description', 'tags', 'link', 'sprite'], macro)
  parsed.parentId = input.parentId ?? previous?.parentId
  return parsed
}
function relationshipFrom(input: C4RelationshipInput, body: C4Body, previous?: C4Relationship): C4Relationship {
  const macro = input.macro ?? previous?.macro ?? (input.index !== undefined ? 'RelIndex' : 'Rel')
  const fields = { ...previous, ...input, macro, tags: input.tags ?? previous?.tags ?? [], style: {}, args: [], statementId: '' } as C4Relationship
  const declarations = [...new Set([input.from, input.to])].map(id => `System(${alias(id)}, "endpoint")`).join('\n')
  const parsed = readC4Source(`C4Context\n${declarations}\n${renderC4Relationship(fields)}`).relationships[0]
  if (!parsed) throw new Error(`C4 ${macro} is not a relationship macro`)
  requireRepresented(input, parsed, ['from', 'to', 'label', 'technology', 'description', 'tags', 'link', 'sprite', 'index'], macro)
  parsed.id = previous?.id ?? generatedIds([...body.elements, ...body.boundaries, ...body.relationships].map(record => record.id))(`c4-rel-${body.relationships.length + 1}`)
  if (input.id !== undefined && input.id !== parsed.id) throw new Error('C4 relationship IDs are allocated from authored occurrence order; arbitrary IDs cannot be represented in Mermaid source')
  parsed.order = previous?.order ?? body.relationships.length + 1
  return parsed
}

function appendStatement(body: C4Body, statement: C4Statement, parentId?: string): void {
  const close = parentId === undefined ? -1 : body.statements.findIndex(candidate => candidate.kind === 'boundary-close' && candidate.entityId === parentId)
  const entries = [newStatement(body, 'trivia', undefined, '\n  '), statement, newStatement(body, 'trivia', undefined, '\n')]
  if (close < 0) body.statements.push(...entries)
  else body.statements.splice(close, 0, ...entries)
}

function rewriteDirectiveReferences(directive: C4Directive, from: string, to: string): void {
  const slots = directive.category === 'element-style' ? ['elementName']
    : directive.category === 'relationship-style' || directive.name.startsWith('Lay_') || directive.name === 'AddRelLink' ? ['from', 'to']
      : directive.name === 'AddElementLink' ? ['alias'] : []
  for (let index = 0; index < directive.args.length; index++) {
    const arg = directive.args[index]!
    if ((arg.name ? slots.includes(arg.name) : index < slots.length) && arg.value === from) arg.value = to
  }
}

function moveDeclaration(body: C4Body, record: C4Element | C4Boundary, parentId: string | null): void {
  record.parentId = parentId ?? undefined
  const problem = c4BodyProblemCore(body)
  if (problem) throw new Error(problem)
  const start = body.statements.findIndex(statement => statement.id === record.statementId)
  const closing = body.boundaries.some(boundary => boundary.id === record.id)
    ? body.statements.findIndex(statement => statement.kind === 'boundary-close' && statement.entityId === record.id) : start
  if (start < 0 || closing < start) throw new Error('C4 source statement is missing')
  const segment = body.statements.splice(start, closing - start + 1)
  const insert = parentId === null ? body.statements.length : body.statements.findIndex(statement => statement.kind === 'boundary-close' && statement.entityId === parentId)
  if (insert < 0) throw new Error('C4 parent boundary source is missing')
  body.statements.splice(insert, 0, newStatement(body, 'trivia', undefined, '\n'), ...segment, newStatement(body, 'trivia', undefined, '\n'))
}

function inputObject<T>(value: T): T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('C4 operation payload must be an object')
  return value
}

function checkedFields<T>(value: T, allowed: readonly string[]): T {
  inputObject(value)
  for (const [key, field] of Object.entries(value as Record<string, unknown>)) {
    if (!allowed.includes(key)) throw new Error(`Unknown C4 field ${key}`)
    if (field === undefined) continue
    if (key === 'tags') {
      if (!Array.isArray(field) || field.some(tag => typeof tag !== 'string' || !tag.trim() || tag.includes('+'))) throw new Error('C4 tags must be an array of non-empty names without +')
    } else if (key === 'external') {
      if (typeof field !== 'boolean') throw new Error('C4 external must be boolean')
    } else if (typeof field !== 'string') throw new Error(`C4 ${key} must be text`)
  }
  const fields = value as Record<string, unknown>
  if (fields.shape !== undefined && !['person', 'rectangle', 'database', 'queue'].includes(fields.shape as string)) throw new Error('Invalid C4 shape')
  return value
}
const ELEMENT_INPUT = ['id', 'label', 'macro', 'kind', 'external', 'shape', 'technology', 'description', 'parentId', 'tags', 'link', 'sprite']
const BOUNDARY_INPUT = ['id', 'label', 'macro', 'kind', 'type', 'description', 'parentId', 'tags', 'link', 'sprite']
const RELATIONSHIP_INPUT = ['id', 'from', 'to', 'label', 'macro', 'technology', 'description', 'tags', 'link', 'sprite', 'index']

function reallocateRelationships(body: C4Body): void {
  const allocate = generatedIds([...body.elements, ...body.boundaries].map(record => record.id))
  const active = new Set(body.relationships.map(record => record.statementId))
  body.statements = body.statements.filter(statement => statement.kind !== 'relationship' || active.has(statement.id))
  const statements = new Map(body.statements.filter(statement => statement.kind === 'relationship').map(statement => [statement.entityId, statement]))
  for (const [index, record] of body.relationships.entries()) {
    const statement = statements.get(record.id)
    record.id = allocate(`c4-rel-${index + 1}`, ['c4-relationship', index + 1])
    record.order = index + 1
    if (statement) statement.entityId = record.id
  }
}

/** Each transaction returns the reparsed authored artifact. Relationship IDs
 * select independent lexical occurrences within that artifact; callers read
 * back IDs after insertion/removal instead of keeping stale pair selectors. */
export function mutateC4(body: C4Body, op: C4MutationOp): Result<C4Body, MutationError> {
  try {
    const originalProblem = c4BodyProblem(body)
    if (originalProblem) throw new Error(originalProblem)
    if (body.diagnostics.some(item => item.severity === 'error')) throw new Error('C4 edits are refused while deferred statements may contain unmodeled references; source is preserved')
    const next = structuredClone(body)
    if (next.statements.length === 0) next.statements = canonicalStatements(next)
    const missing = (kind: string, id: string): never => { throw new Error(`C4 ${kind} ${JSON.stringify(id)} was not found`) }
    switch (op.kind) {
      case 'add_element': {
        const record = elementFrom(checkedFields(op.element, ELEMENT_INPUT))
        const statement = newStatement(next, 'element', record.id)
        record.statementId = statement.id; next.elements.push(record); appendStatement(next, statement, record.parentId); break
      }
      case 'update_element': {
        const index = next.elements.findIndex(record => record.id === op.id), record = next.elements[index] ?? missing('element', op.id)
        checkedFields(op.changes, ELEMENT_INPUT.filter(key => key !== 'id' && key !== 'parentId'))
        const fields = { ...record, ...op.changes, macro: op.changes.macro ?? (op.changes.kind || op.changes.shape || op.changes.external !== undefined ? undefined : record.macro) }
        if (op.changes.macro !== undefined) {
          fields.kind = op.changes.kind as C4Element['kind']
          fields.shape = op.changes.shape as C4Element['shape']
          fields.external = op.changes.external as boolean
        }
        const replacement = elementFrom(fields, record)
        replacement.statementId = record.statementId; next.elements[index] = replacement; break
      }
      case 'add_boundary': {
        const record = boundaryFrom(checkedFields(op.boundary, BOUNDARY_INPUT))
        const open = newStatement(next, 'boundary-open', record.id)
        record.statementId = open.id; next.boundaries.push(record)
        appendStatement(next, open, record.parentId)
        const index = next.statements.indexOf(open)
        next.statements.splice(index + 1, 0, newStatement(next, 'trivia', undefined, '\n'), newStatement(next, 'boundary-close', record.id))
        break
      }
      case 'update_boundary': {
        const index = next.boundaries.findIndex(record => record.id === op.id), record = next.boundaries[index] ?? missing('boundary', op.id)
        checkedFields(op.changes, BOUNDARY_INPUT.filter(key => key !== 'id' && key !== 'parentId'))
        const fields = { ...record, ...op.changes, macro: op.changes.macro ?? (op.changes.kind ? undefined : record.macro) }
        if (op.changes.macro !== undefined) fields.kind = op.changes.kind as C4Boundary['kind']
        const replacement = boundaryFrom(fields, record)
        replacement.statementId = record.statementId; next.boundaries[index] = replacement; break
      }
      case 'rename_element': case 'rename_boundary': {
        const records = op.kind === 'rename_element' ? next.elements : next.boundaries
        const record = records.find(candidate => candidate.id === op.from) ?? missing(op.kind === 'rename_element' ? 'element' : 'boundary', op.from)
        if (validText(op.to, 'C4 alias', true)) throw new Error('C4 alias must be non-empty text')
        record.id = op.to
        for (const child of [...next.elements, ...next.boundaries]) if (child.parentId === op.from) child.parentId = op.to
        for (const relation of next.relationships) {
          if (relation.from === op.from) relation.from = op.to
          if (relation.to === op.from) relation.to = op.to
          if (relation.source === op.from) relation.source = op.to
          if (relation.target === op.from) relation.target = op.to
        }
        for (const directive of next.directives) rewriteDirectiveReferences(directive, op.from, op.to)
        for (const statement of next.statements) if (statement.entityId === op.from && ['element', 'boundary-open', 'boundary-close'].includes(statement.kind)) statement.entityId = op.to
        break
      }
      case 'reparent_element': case 'reparent_boundary': {
        const records = op.kind === 'reparent_element' ? next.elements : next.boundaries
        const record = records.find(candidate => candidate.id === op.id) ?? missing('declaration', op.id)
        moveDeclaration(next, record, op.parentId); break
      }
      case 'remove_element': case 'remove_boundary': {
        const records = op.kind === 'remove_element' ? next.elements : next.boundaries
        if (!records.some(record => record.id === op.id)) missing('declaration', op.id)
        const removed = new Set([op.id])
        let changed = true
        while (changed) {
          changed = false
          for (const record of [...next.boundaries, ...next.elements]) if (record.parentId !== undefined && removed.has(record.parentId) && !removed.has(record.id)) { removed.add(record.id); changed = true }
        }
        const referenced = next.relationships.some(record => removed.has(record.from) || removed.has(record.to))
        const referencedDirectives = next.directives.filter(directive => {
          const copy = structuredClone(directive)
          for (const id of removed) rewriteDirectiveReferences(copy, id, '\u0000removed')
          return c4RecordSignature(copy) !== c4RecordSignature(directive)
        })
        if (!op.cascade && (removed.size > 1 || referenced || referencedDirectives.length)) throw new Error('C4 declaration has children or references; explicit cascade:true is required')
        next.elements = next.elements.filter(record => !removed.has(record.id))
        next.boundaries = next.boundaries.filter(record => !removed.has(record.id))
        next.relationships = next.relationships.filter(record => !removed.has(record.from) && !removed.has(record.to))
        next.directives = next.directives.filter(record => !referencedDirectives.includes(record))
        break
      }
      case 'add_relationship': {
        const record = relationshipFrom(checkedFields(op.relationship, RELATIONSHIP_INPUT), next)
        const statement = newStatement(next, 'relationship', record.id)
        record.statementId = statement.id; next.relationships.push(record); appendStatement(next, statement); break
      }
      case 'update_relationship': {
        const index = next.relationships.findIndex(record => record.id === op.id), record = next.relationships[index] ?? missing('relationship', op.id)
        checkedFields(op.changes, RELATIONSHIP_INPUT.filter(key => key !== 'id'))
        const replacement = relationshipFrom({ ...record, ...op.changes, ...(op.changes.index !== undefined && op.changes.macro === undefined ? { macro: 'RelIndex' } : {}) }, next, record)
        replacement.statementId = record.statementId; next.relationships[index] = replacement; break
      }
      case 'remove_relationship': {
        if (!next.relationships.some(record => record.id === op.id)) missing('relationship', op.id)
        next.relationships = next.relationships.filter(record => record.id !== op.id)
        next.directives = next.directives.filter(record => {
          if (record.category !== 'relationship-style' && record.name !== 'AddRelLink') return true
          const fields = c4ArgumentFields(record.args, ['from', 'to'])
          return next.relationships.some(relation => relation.from === fields.from && relation.to === fields.to)
        })
        break
      }
      case 'set_title': {
        if (op.title !== null && (validText(op.title, 'C4 title', true) || /[\r\n]/.test(op.title))) throw new Error('C4 title must be non-empty single-line text or null')
        next.title = op.title ?? undefined
        if (!next.statements.some(statement => statement.kind === 'title') && op.title !== null) {
          const index = next.statements.findIndex(statement => statement.kind === 'header') + 1
          next.statements.splice(index, 0, newStatement(next, 'trivia', undefined, '\n'), newStatement(next, 'title'))
        }
        break
      }
      case 'set_variant': next.variant = op.variant; break
      case 'add_directive': case 'update_directive': {
        const previous = op.kind === 'update_directive' ? next.directives.find(record => record.id === op.id) ?? missing('directive', op.id) : undefined
        const name = op.kind === 'add_directive' ? op.name : previous!.name
        if (!['UpdateElementStyle', 'UpdateRelStyle', 'UpdateLayoutConfig'].includes(name)) throw new Error('Typed C4 directives must use UpdateElementStyle, UpdateRelStyle, or UpdateLayoutConfig supported by pinned Mermaid; reader extensions remain source-preserved')
        if (!Array.isArray(op.args)) throw new Error('C4 directive args must be an array')
        const args: C4Argument[] = op.args.map((value: C4ArgumentInput) => {
          if (!value || typeof value !== 'object' || typeof value.value !== 'string' || (value.name !== undefined && !/^[A-Za-z_][A-Za-z_0-9]*$/.test(value.name))) throw new Error('C4 directive arguments require text value and an optional parameter name')
          return { ...value, raw: `${value.name ? `$${value.name}=` : ''}${quote(value.value)}` }
        })
        if (previous) previous.args = args
        else {
          const statement = newStatement(next, 'directive')
          const record: C4Directive = { id: statement.id, name, args, category: c4DirectiveCategory(name), statementId: statement.id }
          statement.entityId = record.id; next.directives.push(record); appendStatement(next, statement)
        }
        break
      }
      case 'remove_directive': {
        if (!next.directives.some(record => record.id === op.id)) missing('directive', op.id)
        next.directives = next.directives.filter(record => record.id !== op.id); break
      }
      default: throw new Error(unknownOpMessage('c4', op))
    }
    reallocateRelationships(next)
    resolveC4Directives(next)
    const problem = c4BodyProblemCore(next)
    if (problem) throw new Error(problem)
    const parsed = readC4Source(renderC4Unchecked(next, true))
    if (parsed.diagnostics.some(item => item.severity === 'error')) throw new Error(parsed.diagnostics.find(item => item.severity === 'error')!.message)
    return ok(parsed)
  } catch (error) { return err({ code: 'INVALID_OP', message: error instanceof Error ? error.message : String(error) }) }
}

export function lintC4(body: C4Body, opts: VerifyOptions): LayoutWarning[] {
  const warnings: LayoutWarning[] = []
  const overflow = labelOverflowCollector(warnings, opts)
  if (body.elements.length === 0 && body.boundaries.length === 0) warnings.push({ code: 'EMPTY_DIAGRAM' })
  for (const record of [...body.elements, ...body.boundaries, ...body.relationships]) {
    for (const value of [record.label, 'technology' in record ? record.technology : undefined, record.description]) if (value) overflow(record.id, value)
  }
  for (const diagnostic of body.diagnostics) {
    const statement = body.statements.find(record => record.id === diagnostic.statementId)
    warnings.push({ code: 'UNSUPPORTED_SYNTAX', syntax: diagnostic.syntax, line: statement?.span.line, message: c4DiagnosticMessage(body, diagnostic) })
  }
  return warnings
}
export const verifyC4 = lintC4

export function buildC4SourceMap(body: C4Body, canonicalSource: string): SourceMap {
  const result: SourceMap = { nodes: new Map(), edges: new Map(), groups: new Map(), labels: new Map() }
  const parsed = readC4Source(canonicalSource)
  const statements = new Map(parsed.statements.map(statement => [statement.id, statement]))
  for (const [records, map, prefix] of [[parsed.elements, result.nodes, 'node'], [parsed.boundaries, result.groups, 'group'], [parsed.relationships, result.edges, 'edge']] as const) {
    for (const record of records) {
      const statement = statements.get(record.statementId)!
      map.set(record.id, { line: statement.span.line, col: statement.span.column })
      const slots = 'from' in record ? c4RelationshipFields(record.macro) : 'external' in record ? c4ElementFields(record.macro) : c4BoundaryFields(record.macro)
      let argumentOffset = statement.raw.indexOf('(') + 1
      for (const [index, argument] of record.args.entries()) {
        if ((argument.name ?? slots[index]) === 'label') {
          const prefixText = statement.raw.slice(0, argumentOffset)
          const namedPrefix = argument.name ? argument.raw.indexOf('=') + 1 : 0
          const leading = argument.raw.slice(namedPrefix).match(/^\s*/)?.[0].length ?? 0
          const quoted = argument.raw[namedPrefix + leading] === '"' || argument.raw[namedPrefix + leading] === "'"
          // The label starts after the quote and the blanks the reader trims.
          const inner = quoted ? argument.raw.slice(namedPrefix + leading + 1).match(/^\s*/)?.[0].length ?? 0 : 0
          const position = prefixText + argument.raw.slice(0, namedPrefix + leading + (quoted ? 1 + inner : 0))
          const lines = position.split(/\r\n?|\n/)
          result.labels.set(`${prefix}:${record.id}`, { line: statement.span.line + lines.length - 1, col: lines.length === 1 ? statement.span.column + position.length : lines.at(-1)!.length + 1 })
          break
        }
        argumentOffset += argument.raw.length + 1
      }
    }
  }
  return result
}
