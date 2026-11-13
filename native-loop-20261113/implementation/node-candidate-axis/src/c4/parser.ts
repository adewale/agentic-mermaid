import { assertC4DiagramWork, assertDiagramWorkLimit } from '../shared/diagram-limits.ts'
import { observeParserMutation, observeParserStatement, observeParserToken, parserObservationActive } from '../shared/parser-observation.ts'
import { generatedIds } from '../shared/generated-identity.ts'
import { decodeMermaidEntities } from '../shared/mermaid-entity-display.ts'
import { mermaidEntityPrepass } from '../shared/mermaid-entities.ts'
import { parseAccessibilityDirective } from '../shared/accessibility-directives.ts'
import { breakLineTags } from '../multiline-utils.ts'
import { decodeXML } from 'entities'
import { mermaidLineEnd } from '../shared/mermaid-cleanup.ts'
import { c4ShapeOverride } from './config.ts'
import { MermaidSyntaxError } from '../shared/syntax-error.ts'
import type {
  C4Argument, C4Body, C4Boundary, C4Diagnostic, C4Directive, C4Direction,
  C4Element, C4Relationship, C4Statement, C4Style, C4Variant,
} from './types.ts'

export const C4_VARIANTS: readonly C4Variant[] = ['C4Context', 'C4Container', 'C4Component', 'C4Dynamic', 'C4Deployment']

export class C4AmbiguousArgumentError extends MermaidSyntaxError {}

const ELEMENT = /^(Person|System|Container|Component)(Db|Queue)?(_Ext)?$/
const BOUNDARIES: Readonly<Record<string, C4Boundary['kind']>> = {
  Boundary: 'boundary', Enterprise_Boundary: 'enterprise', System_Boundary: 'system',
  Container_Boundary: 'container', Deployment_Node: 'deployment', Node: 'deployment', Node_L: 'deployment', Node_R: 'deployment',
}
const RELATIONS = new Set(['Rel', 'BiRel', 'Rel_U', 'Rel_Up', 'Rel_D', 'Rel_Down', 'Rel_L', 'Rel_Left', 'Rel_R', 'Rel_Right', 'Rel_Back', 'RelIndex'])
const DIRECTIONS: Readonly<Record<string, C4Direction>> = { U: 'BT', Up: 'BT', D: 'TB', Down: 'TB', L: 'RL', Left: 'RL', R: 'LR', Right: 'LR' }
const ELEMENT_STYLE = ['elementName', 'bgColor', 'fontColor', 'borderColor', 'shadowing', 'shape', 'sprite', 'techn', 'legendText', 'legendSprite']
const REL_STYLE = ['from', 'to', 'textColor', 'lineColor', 'offsetX', 'offsetY']
const ELEMENT_TAG = ['tagStereo', 'bgColor', 'fontColor', 'borderColor', 'shadowing', 'shape', 'sprite', 'techn', 'legendText', 'legendSprite']
const REL_TAG = ['tagStereo', 'textColor', 'lineColor', 'lineStyle', 'sprite', 'techn', 'legendText', 'legendSprite']

export function emptyC4Body(variant: C4Variant = 'C4Context'): C4Body {
  return { kind: 'c4', variant, elements: [], boundaries: [], relationships: [], directives: [], statements: [], diagnostics: [], layout: { hints: [] } }
}

function observeC4Statement(statement: C4Statement, kind: string): void {
  if (!parserObservationActive('c4')) return
  const { start, end, line, column } = statement.span
  observeParserStatement('c4', kind, statement.raw, { line, column, offset: start, endOffset: end, unit: 'physical' })
}

/** A bounded, forward-only scanner: delimiters inside strings and nested
 * helper calls never become statements, and each source byte advances once. */
function statements(source: string): C4Statement[] {
  const result: C4Statement[] = []
  let offset = 0, line = 1, column = 1, awaitingHeader = true
  const emit = (end: number, kind: C4Statement['kind'] = 'unknown'): void => {
    const raw = source.slice(offset, end)
    result.push({ id: `c4-statement-${result.length + 1}`, kind, raw, span: { start: offset, end, line, column } })
    if (parserObservationActive('c4')) observeParserToken('c4', `chunk:${kind}`, raw, { line, column, offset, endOffset: end, unit: 'physical' })
    let previous = source[offset - 1]
    for (const character of raw) {
      if (character === '\r' || character === '\n' && previous !== '\r') { line++; column = 1 }
      else if (character !== '\n') column++
      previous = character
    }
    offset = end
  }
  while (offset < source.length) {
    const start = offset
    if (/\s|;/.test(source[start]!)) {
      let end = start + 1
      while (end < source.length && /\s|;/.test(source[end]!)) end++
      emit(end, 'trivia'); continue
    }
    if (source.startsWith('%%', start)) {
      const end = mermaidLineEnd(source, start)
      const commentEnd = end < 0 ? source.length : end
      const owned = !awaitingHeader && parseAccessibilityDirective([source.slice(start, commentEnd)], 0)?.form === 'native'
      emit(commentEnd, owned ? 'accessibility' : 'trivia'); continue
    }
    if (awaitingHeader) {
      awaitingHeader = false
      const newline = mermaidLineEnd(source, start)
      const lineEnd = newline < 0 ? source.length : newline
      let headerEnd = lineEnd
      for (let index = start; index < lineEnd; index++) {
        if (source[index] === '&') {
          const entity = /^&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/i.exec(source.slice(index, lineEnd))
          if (entity) { index += entity[0].length - 1; continue }
        }
        if (source[index] === ';') { headerEnd = index; break }
      }
      const candidate = decodeXML(source.slice(start, headerEnd)).trim()
      if (C4_VARIANTS.some(variant => variant.toLowerCase() === candidate.toLowerCase())) { emit(headerEnd, 'header'); continue }
    }
    if (source[start] === '}') { emit(start + 1, 'boundary-close'); continue }
    const rest = source.slice(start)
    const name = /^[A-Za-z_][A-Za-z_0-9]*/.exec(rest)?.[0]
    let cursor = start + (name?.length ?? 0)
    while (cursor < source.length && /[ \t\r\n]/.test(source[cursor]!)) cursor++
    if (name && source[cursor] === '(') {
      let depth = 0, quote = ''
      for (; cursor < source.length; cursor++) {
        const ch = source[cursor]!
        if (quote) {
          if (ch === quote) quote = ''
        } else if (ch === '"' || ch === "'") quote = ch
        else if (ch === '(') depth++
        else if (ch === ')' && --depth === 0) { cursor++; break }
      }
      if (depth || quote) throw new Error(`C4: unclosed ${name} argument list at line ${line}`)
      let brace = cursor
      while (brace < source.length && /\s/.test(source[brace]!)) brace++
      if (source[brace] === '{') {
        if (BOUNDARIES[name]) { emit(brace + 1, 'boundary-open'); continue }
        // An unknown block remains one explicit segment. Its children cannot
        // accidentally masquerade as top-level native declarations.
        let braces = 1
        quote = ''
        cursor = brace + 1
        for (; cursor < source.length && braces; cursor++) {
          const ch = source[cursor]!
          if (quote) {
            if (ch === quote) quote = ''
          } else if (ch === '"' || ch === "'") quote = ch
          else if (ch === '%' && source[cursor + 1] === '%') {
            const newline = mermaidLineEnd(source, cursor + 2)
            cursor = newline < 0 ? source.length : newline
          }
          else if (ch === '{') braces++
          else if (ch === '}') braces--
        }
        if (braces) throw new Error(`C4: unclosed ${name} block at line ${line}`)
      }
      emit(cursor); continue
    }
    const end = mermaidLineEnd(source, start)
    if (/^accDescr[ \t]*:?[ \t]*\{/i.test(rest)) {
      const close = source.indexOf('}', start)
      if (close < 0) throw new Error(`C4: unclosed accessibility block at line ${line}`)
      emit(close + 1, 'accessibility'); continue
    }
    emit(end < 0 ? source.length : end)
  }
  return result
}

/** Mermaid's C4 grammar trims every argument, quoted or not, before its
 * entity codes are displayed, so whitespace inside the quotes at either end
 * is dropped and an encoded one (`#32;`) is kept. */
function argumentValue(raw: string, decode = true): string {
  const text = raw.trim()
  if (text.length >= 2 && (text[0] === '"' || text[0] === "'") && text.at(-1) === text[0]) {
    const inner = text.slice(1, -1).trim()
    return decode ? decodeMermaidEntities(inner) : inner
  }
  return decode ? decodeMermaidEntities(text) : text
}

/** Legacy C4 displays literal text with authored line-break tags. Decode only
 * after interpreting those tags, so encoded tag-like characters stay literal. */
export function c4DisplayArgument(args: readonly C4Argument[], names: readonly string[], key: string): string | undefined {
  let found: C4Argument | undefined
  for (let index = 0; index < args.length; index++) if ((args[index]!.name ?? names[index]) === key) found = args[index]
  if (!found) return undefined
  const raw = found.name ? found.raw.replace(/^\s*\$[A-Za-z_][A-Za-z_0-9]*\s*=/, '') : found.raw
  return decodeMermaidEntities(breakLineTags(argumentValue(raw, false)))
}

export function parseC4Arguments(text: string): C4Argument[] {
  if (!text.trim()) return []
  const parts: string[] = []
  let start = 0, depth = 0, quote = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (quote) {
      if (ch === quote) quote = ''
    } else if (ch === '"' || ch === "'") quote = ch
    else if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (ch === ',' && depth === 0) { parts.push(text.slice(start, i)); start = i + 1 }
  }
  parts.push(text.slice(start))
  return parts.map(raw => {
    const named = /^\s*\$([A-Za-z_][A-Za-z_0-9]*)\s*=([\s\S]*)$/.exec(raw)
    return { ...(named ? { name: named[1]! } : {}), value: argumentValue(named ? named[2]! : raw), raw }
  })
}

/** The attribute lexer consumes an unquoted argument through the next comma,
 * including a closing parenthesis. A final argument therefore needs a closed
 * double-quoted token. Named values use the non-empty string_kv_value state.
 * This checks token structure, independently of a declaration's semantics. */
export function c4ArgumentsArePortable(args: readonly C4Argument[], positionalFields: readonly string[] = []): boolean {
  return args.length > 0 && args.length >= positionalFields.length && args.every((arg, index) => {
    if (arg.name && (positionalFields.includes(arg.name) || index < positionalFields.length && positionalFields[index] !== 'label')) return false
    if (arg.raw.includes('%%{')) return false
    const text = (arg.name ? arg.raw.replace(/^\s*\$[A-Za-z_][A-Za-z_0-9]*\s*=/, '') : arg.raw).trim()
    if (arg.name) return /^ *\$[A-Za-z_][A-Za-z_0-9]* *= *"[^"]+"$/.test(arg.raw)
    if (text.startsWith('"')) return /^ *"[^"]*"$/.test(arg.raw)
    if (arg.raw === '' && index < args.length - 1) return true
    return index < args.length - 1 && text.length > 0 && !/^[\$']|[(),\r\n]/.test(text)
  })
}

function ambiguousNamedArgument(arg: C4Argument, index: number, args: readonly C4Argument[]): boolean {
  // Mermaid's bare attribute token consumes everything through the next comma:
  // embedded dollar text cannot start metadata inside that positional token.
  // A quoted comma is still a delimiter to that lexer, unlike our reader's.
  if (!arg.name && index < args.length - 1 && !/^["'$)]/.test(arg.raw.trim()) && !arg.raw.includes(',')) return false
  const value = arg.name ? arg.raw.replace(/^\s*\$[A-Za-z_][A-Za-z_0-9]*\s*=/, '') : arg.raw
  // Quoted text can literally describe `$link=...`. Outside quotes that
  // spelling may be a missing comma or `=`, so choosing prose would lose
  // the author's intended metadata.
  for (const match of value.matchAll(/"[^"]*"|'[^']*'|(\$[A-Za-z_][A-Za-z_0-9]*\s*(?:=|["']))/g)) if (match[1]) return true
  return false
}

export function c4ArgumentFields(args: readonly C4Argument[], names: readonly string[]): Record<string, string> {
  const fields: Record<string, string> = Object.create(null)
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!
    const key = arg.name ?? names[index]
    if (key !== undefined) fields[key] = arg.value
  }
  return fields
}

export function c4ElementFields(macro: string): readonly string[] {
  return macro.startsWith('Person') || macro.startsWith('System')
    ? ['alias', 'label', 'descr', 'sprite', 'tags', 'link']
    : ['alias', 'label', 'techn', 'descr', 'sprite', 'tags', 'link']
}
export function c4BoundaryFields(macro: string): readonly string[] {
  return BOUNDARIES[macro] === 'deployment'
    ? ['alias', 'label', 'type', 'descr', 'sprite', 'tags', 'link']
    : macro === 'Boundary' ? ['alias', 'label', 'type', 'tags', 'link'] : ['alias', 'label', 'tags', 'link']
}
export function c4RelationshipFields(macro: string): readonly string[] {
  return macro === 'RelIndex' ? ['index', 'from', 'to', 'label', 'tags', 'link'] : ['from', 'to', 'label', 'techn', 'descr', 'sprite', 'tags', 'link']
}
function tags(value?: string): string[] { return value ? value.split('+').map(tag => tag.trim()).filter(Boolean) : [] }
function optional(value: string | undefined): string | undefined { return value === '' ? undefined : value }
function required(fields: Record<string, string>, field: string, macro: string): string {
  const value = fields[field]
  if (value === undefined || (field !== 'label' && !value.trim())) throw new Error(`C4: ${macro} requires ${field === 'label' ? 'a' : 'a non-empty'} ${field}`)
  return value
}

function argumentLabel(args: readonly C4Argument[], names: readonly string[], fields: Record<string, string>, macro: string): string {
  const label = c4DisplayArgument(args, names, 'label')
  if (label !== undefined) return label
  // Named arguments address their field even in a positional label slot.
  // Keep that field and an empty label, rather than coercing it into text.
  if (args[names.indexOf('label')]?.name) return ''
  return required(fields, 'label', macro)
}

/** Fields which affect authored source, excluding derived cascade/layout data. */
export function c4RecordSignature(record: C4Element | C4Boundary | C4Relationship | C4Directive): string {
  const { args: _args, style: _style, effectiveLink: _effectiveLink, statementId: _statementId, ...fields } = record as (C4Element | C4Boundary | C4Relationship) & { name?: string; category?: string }
  if ('name' in record) return JSON.stringify([record.name, record.args.map(arg => [arg.name, arg.value])])
  return JSON.stringify(fields)
}

function diagnostic(body: C4Body, statementId: string, syntax: string, message: string, severity: C4Diagnostic['severity'] = 'warning'): void {
  body.diagnostics.push({ code: 'UNSUPPORTED_SYNTAX', syntax, severity, statementId, message })
}

// The directives pinned Mermaid's C4 grammar knows, besides the element,
// boundary and relationship macros.
const MERMAID_C4_DIRECTIVES = new Set(['UpdateElementStyle', 'UpdateRelStyle', 'UpdateLayoutConfig'])

export function c4DirectiveFields(name: string): readonly string[] | undefined {
  return name === 'UpdateElementStyle' ? ELEMENT_STYLE : name === 'UpdateRelStyle' ? REL_STYLE
    : name === 'UpdateLayoutConfig' ? ['c4ShapeInRow', 'c4BoundaryInRow'] : undefined
}

/** Style targets and all layout values are positional in the pinned DB,
 * even when the lexer accepts a named argument in that slot. */
export function c4DirectiveArgumentsArePortable(record: C4Directive): boolean {
  const fields = c4DirectiveFields(record.name)
  if (!fields) return c4ArgumentsArePortable(record.args)
  if (record.name === 'UpdateLayoutConfig') return c4ArgumentsArePortable(record.args) && record.args.every((arg, index) => !arg.name || arg.name === fields[index])
  const required = record.name === 'UpdateElementStyle' ? 1 : 2
  return c4ArgumentsArePortable(record.args, fields.slice(0, required))
}

export function c4DirectiveCategory(name: string): C4Directive['category'] {
  if (name === 'UpdateElementStyle') return 'element-style'
  if (name === 'UpdateRelStyle') return 'relationship-style'
  if (name === 'AddElementTag') return 'element-tag'
  if (name === 'AddRelTag') return 'relationship-tag'
  if (name === 'UpdateLayoutConfig' || name.startsWith('Lay_') || name.startsWith('LAYOUT_')) return 'layout'
  if (name === 'ShowLegend' || name === 'SHOW_LEGEND' || name === 'SHOW_FLOATING_LEGEND') return 'legend'
  if (name === 'AddElementLink' || name === 'AddRelLink') return 'link'
  return 'unknown'
}

function styleFields(fields: Record<string, string>, omit: readonly string[]): C4Style {
  return Object.fromEntries(Object.entries(fields).filter(([key, value]) => !omit.includes(key) && value !== ''))
}

/** Re-resolve cascade after typed directive/tag edits. This is semantic work,
 * shared by both projections; neither renderer silently reparses directives. */
export function resolveC4Directives(body: C4Body, admitWork = false): void {
  for (const record of [...body.elements, ...body.boundaries, ...body.relationships]) {
    record.style = {}; delete record.effectiveLink
    if (parserObservationActive('c4')) observeParserMutation('c4', 'reset-presentation', { id: record.id, style: record.style })
  }
  body.layout = { hints: [] }
  if (parserObservationActive('c4')) observeParserMutation('c4', 'reset-layout', body.layout)
  const declarations = new Map([...body.elements, ...body.boundaries].map(record => [record.id, record]))
  const pairs = new Map<string, C4Relationship[]>()
  const pairKey = (from: string | undefined, to: string | undefined): string => JSON.stringify([from, to])
  for (const relation of body.relationships) {
    const key = pairKey(relation.from, relation.to), matching = pairs.get(key) ?? []
    matching.push(relation); pairs.set(key, matching)
  }
  const directiveFields = (directive: C4Directive, slots: readonly string[]): Record<string, string> => {
    const fields = c4ArgumentFields(directive.args, slots)
    for (const key of ['techn', 'legendText']) {
      const display = c4DisplayArgument(directive.args, slots, key)
      if (display !== undefined) fields[key] = display
    }
    return fields
  }
  const elementTags = new Map<string, C4Style>(), relationTags = new Map<string, C4Style>()
  for (const directive of body.directives) {
    if (directive.category !== 'element-tag' && directive.category !== 'relationship-tag') continue
    const fields = directiveFields(directive, directive.category === 'element-tag' ? ELEMENT_TAG : REL_TAG)
    ;(directive.category === 'element-tag' ? elementTags : relationTags).set(fields.tagStereo ?? '', styleFields(fields, ['tagStereo']))
    if (parserObservationActive('c4')) observeParserMutation('c4', 'define-tag', { category: directive.category, tag: fields.tagStereo ?? '', style: (directive.category === 'element-tag' ? elementTags : relationTags).get(fields.tagStereo ?? '') })
  }
  for (const record of [...body.elements, ...body.boundaries]) for (const tag of record.tags) {
    Object.assign(record.style, elementTags.get(tag))
    if (parserObservationActive('c4')) observeParserMutation('c4', 'apply-tag', { id: record.id, tag, style: record.style })
  }
  for (const record of body.relationships) for (const tag of record.tags) {
    Object.assign(record.style, relationTags.get(tag))
    if (parserObservationActive('c4')) observeParserMutation('c4', 'apply-tag', { id: record.id, tag, style: record.style })
  }
  for (const directive of body.directives) {
    if (directive.category === 'element-style') {
      const fields = directiveFields(directive, ELEMENT_STYLE)
      const target = declarations.get(fields.elementName!)
      if (!target) throw new Error(`C4: UpdateElementStyle references undeclared alias ${JSON.stringify(fields.elementName)}`)
      Object.assign(target.style, styleFields(fields, ['elementName']))
      if (parserObservationActive('c4')) observeParserMutation('c4', 'set-element-style', { id: target.id, style: target.style })
    } else if (directive.category === 'relationship-style') {
      const fields = c4ArgumentFields(directive.args, REL_STYLE)
      const matching = pairs.get(pairKey(fields.from, fields.to))
      if (!matching) throw new Error('C4: UpdateRelStyle references an undeclared relationship pair')
      for (const offset of ['offsetX', 'offsetY']) if (fields[offset] !== undefined && !Number.isFinite(Number(fields[offset]))) throw new Error(`C4: ${offset} must be finite`)
      for (const target of matching) {
        Object.assign(target.style, styleFields(fields, ['from', 'to']))
        if (parserObservationActive('c4')) observeParserMutation('c4', 'set-relationship-style', { id: target.id, style: target.style })
      }
    } else if (directive.name === 'UpdateLayoutConfig') {
      const fields = c4ArgumentFields(directive.args, ['c4ShapeInRow', 'c4BoundaryInRow'])
      for (const [source, target] of [['c4ShapeInRow', 'shapesPerRow'], ['c4BoundaryInRow', 'boundariesPerRow']] as const) {
        if (fields[source] === undefined || fields[source] === '') continue
        const value = Number(fields[source])
        if (!Number.isSafeInteger(value) || value < 1) throw new Error(`C4: ${source} must be a positive integer`)
        body.layout[target] = value
        if (parserObservationActive('c4')) observeParserMutation('c4', 'set-layout-option', { name: target, value })
      }
    } else if (directive.name.startsWith('Lay_')) {
      const direction = DIRECTIONS[directive.name.slice(4)]
      const fields = c4ArgumentFields(directive.args, ['from', 'to'])
      if (!direction || !fields.from || !fields.to || !declarations.has(fields.from) || !declarations.has(fields.to)) throw new Error(`C4: ${directive.name} requires two declared aliases`)
      if (direction && fields.from && fields.to) {
        if (admitWork) assertDiagramWorkLimit('edges', body.relationships.length + body.layout.hints.length + 1)
        body.layout.hints.push({ from: fields.from, to: fields.to, direction, statementId: directive.statementId })
        if (parserObservationActive('c4')) observeParserMutation('c4', 'add-layout-hint', body.layout.hints.at(-1))
      }
    } else if (directive.name === 'direction') {
      body.layout.direction = directive.args[0]?.value as C4Direction
      if (parserObservationActive('c4')) observeParserMutation('c4', 'set-direction', body.layout.direction)
    } else if (directive.name === 'LAYOUT_LEFT_RIGHT' || directive.name === 'LAYOUT_TOP_DOWN') {
      body.layout.direction = directive.name === 'LAYOUT_LEFT_RIGHT' ? 'LR' : 'TB'
      if (parserObservationActive('c4')) observeParserMutation('c4', 'set-direction', body.layout.direction)
    } else if (directive.name === 'AddElementLink') {
      const fields = c4ArgumentFields(directive.args, ['alias', 'link'])
      const target = declarations.get(fields.alias!)
      if (target) {
        target.effectiveLink = fields.link
        if (parserObservationActive('c4')) observeParserMutation('c4', 'set-effective-link', { id: target.id, link: target.effectiveLink })
      }
    } else if (directive.name === 'AddRelLink') {
      const fields = c4ArgumentFields(directive.args, ['from', 'to', 'link'])
      for (const target of pairs.get(pairKey(fields.from, fields.to)) ?? []) {
        target.effectiveLink = fields.link
        if (parserObservationActive('c4')) observeParserMutation('c4', 'set-effective-link', { id: target.id, link: target.effectiveLink })
      }
    }
  }
  const legendIds = generatedIds([...body.elements, ...body.boundaries, ...body.relationships].map(record => record.id))
  body.legend = {
    visible: body.directives.some(directive => directive.category === 'legend'),
    entries: [
      ...[...elementTags.entries()].map(([tag, style]) => ({ id: legendIds(`c4-tag-${tag}`, ['element-tag', tag]), label: style.legendText ?? tag, kind: 'element' as const, style: { ...style } })),
      ...[...relationTags.entries()].map(([tag, style]) => ({ id: legendIds(`c4-tag-${tag}`, ['relationship-tag', tag]), label: style.legendText ?? tag, kind: 'relationship' as const, style: { ...style } })),
    ],
  }
  if (parserObservationActive('c4')) observeParserMutation('c4', 'set-legend', body.legend)
}

/** Lossless semantic reader. Unknown source is explicit and retained; strict
 * rendering calls parseC4Diagram instead, which refuses deferred semantics. */
export function readC4Source(input: string | readonly string[]): C4Body {
  return readC4(input, false)
}

function readC4(input: string | readonly string[], admitWork: boolean): C4Body {
  const source = typeof input === 'string' ? input : input.join('\n')
  const body = emptyC4Body()
  if (parserObservationActive('c4')) observeParserMutation('c4', 'initialize', body)
  body.statements = statements(source)
  const parents: string[] = []
  const boundaryStatements = new Set<string>()
  const ids = new Set<string>()
  let header = false
  // Pinned Mermaid C4 needs a line break after each statement and after a
  // boundary's `{`; only a closing `}` may share the line before it. Its
  // comments take the line breaks after them, so one after a statement leaves
  // that statement without one.
  let sharesLine = false
  let commented = false
  for (const statement of body.statements) {
    const text = statement.raw.trim()
    if (statement.kind === 'trivia') {
      observeC4Statement(statement, 'trivia')
      if (!text.startsWith('%%') && text.includes(';')) {
        diagnostic(body, statement.id, 'c4_semicolon_separator', 'Semicolon statement separators are a reader extension; pinned Mermaid C4 requires line breaks')
        sharesLine = commented = false
      } else if (text.startsWith('%%')) commented ||= sharesLine
      else if (/[\r\n]/.test(statement.raw) && !commented) sharesLine = false
      continue
    }
    if (sharesLine && statement.kind !== 'boundary-close') diagnostic(body, statement.id, 'c4_statements_on_one_line', 'Statements sharing a line are a reader extension; pinned Mermaid C4 requires a line break after each statement and after `{`, and a comment after a statement takes its line break')
    sharesLine = true
    commented = false
    if (!header) {
      const headerText = decodeXML(text)
      const variant = C4_VARIANTS.find(candidate => candidate.toLowerCase() === headerText.toLowerCase())
      if (!variant) throw new Error('C4: expected C4Context, C4Container, C4Component, C4Dynamic, or C4Deployment')
      observeC4Statement(statement, 'header')
      body.variant = variant
      if (parserObservationActive('c4')) observeParserMutation('c4', 'set-variant', variant)
      statement.kind = 'header'; statement.signature = variant; header = true; continue
    }
    if (statement.kind === 'boundary-close') {
      observeC4Statement(statement, 'boundary-close')
      const parent = parents.pop()
      if (!parent) throw new Error(`C4: unmatched closing boundary at line ${statement.span.line}`)
      if (parserObservationActive('c4')) observeParserMutation('c4', 'close-boundary', { id: parent })
      statement.entityId = parent; continue
    }
    if (mermaidEntityPrepass(text) !== text) diagnostic(body, statement.id, 'c4_entity_prepass', 'The global Mermaid entity prepass changes this statement; the writer protects its text fields without changing their values')
    if (/^title\s/i.test(text)) {
      observeC4Statement(statement, 'title')
      if (parents.length) diagnostic(body, statement.id, 'c4_nested_header_directive', 'Metadata inside a boundary is read as global. Pinned Mermaid requires it at document scope; the writer moves it after the header')
      if (/[#;]/.test(mermaidEntityPrepass(text.replace(/^title\s+/i, '')))) diagnostic(body, statement.id, 'c4_title_token', 'The title contains literal token delimiters; serialization writes entity escapes for pinned Mermaid')
      body.title = decodeMermaidEntities(breakLineTags(text.replace(/^title\s+/i, '')))
      if (parserObservationActive('c4')) observeParserMutation('c4', 'set-title', body.title)
      statement.kind = 'title'; statement.signature = body.title; continue
    }
    const accessibility = parseAccessibilityDirective(text.split(/\r\n?|\n/), 0)
    if (accessibility) {
      observeC4Statement(statement, 'accessibility')
      if (parents.length) diagnostic(body, statement.id, 'c4_nested_header_directive', 'Metadata inside a boundary is read as global. Pinned Mermaid requires it at document scope; the writer moves it after the header')
      if (!accessibility.title && accessibility.form !== 'native' && accessibility.value === '') diagnostic(body, statement.id, 'c4_empty_accessibility_description', 'An empty accessibility description block is a reader extension; the writer preserves its value in a native metadata comment')
      if (accessibility.title) body.accessibilityTitle = accessibility.value
      else body.accessibilityDescription = accessibility.value
      if (parserObservationActive('c4')) observeParserMutation('c4', accessibility.title ? 'set-accessibility-title' : 'set-accessibility-description', accessibility.value)
      statement.kind = 'accessibility'; statement.entityId = accessibility.title ? 'title' : 'description'; statement.signature = accessibility.value; continue
    }
    if (/^accDescription\s+/i.test(text)) {
      observeC4Statement(statement, 'accessibility')
      body.accessibilityDescription = text.replace(/^accDescription\s+/i, '')
      if (parserObservationActive('c4')) observeParserMutation('c4', 'set-accessibility-description', body.accessibilityDescription)
      statement.kind = 'accessibility'; statement.entityId = 'description'; statement.signature = body.accessibilityDescription; continue
    }
    const direction = /^direction\s+(LR|RL|TB|BT)\s*$/.exec(text)
    if (direction) {
      observeC4Statement(statement, 'direction')
      const directive: C4Directive = { id: statement.id, name: 'direction', args: [{ value: direction[1]!, raw: direction[1]! }], category: 'layout', statementId: statement.id }
      body.directives.push(directive)
      if (parserObservationActive('c4')) observeParserMutation('c4', 'add-directive', directive)
      statement.kind = 'directive'; statement.entityId = directive.id; statement.signature = c4RecordSignature(directive); continue
    }
    const call = /^([A-Za-z_][A-Za-z_0-9]*)\s*\(([\s\S]*)\)\s*(\{)?$/.exec(text)
    if (!call) {
      observeC4Statement(statement, 'unknown')
      diagnostic(body, statement.id, 'c4_unknown_statement', 'C4 statement is preserved but has no native interpretation', 'error')
      continue
    }
    const macro = call[1]!, args = parseC4Arguments(call[2]!)
    // The pinned grammar needs a statement inside every boundary. An empty
    // layout argument is a true no-op: neither layout value passes its >= 1
    // assignment guard. Treat its spelling as trivia, not an authored setting.
    if (macro === 'UpdateLayoutConfig' && (args.length === 0 || args.length === 1 && !args[0]!.name && args[0]!.value === '') && !call[3]) {
      if (parents.length) boundaryStatements.add(parents.at(-1)!)
      if (text[macro.length] !== '(' || !c4ArgumentsArePortable(args)) diagnostic(body, statement.id, 'c4_empty_layout_arguments', 'An empty layout call is a no-op; the writer supplies the attribute required by pinned Mermaid')
      statement.kind = 'trivia'; continue
    }
    if (/[\r\n]/.test(call[2]!.replace(/"[^"]*"|'[^']*'/g, ''))) diagnostic(body, statement.id, 'c4_multiline_arguments', 'Line breaks between C4 arguments are a reader extension; quoted multiline text remains supported')
    if (args.some(arg => arg.name && arg.value === '')) diagnostic(body, statement.id, 'c4_empty_named_argument', 'Empty named arguments are retained; pinned Mermaid requires a positional empty slot')
    const element = ELEMENT.exec(macro)
    const mermaidMacro = Boolean(element && !(element[1] === 'Person' && element[2])) || Object.hasOwn(BOUNDARIES, macro) || RELATIONS.has(macro) || MERMAID_C4_DIRECTIVES.has(macro)
    if (mermaidMacro && parents.length) boundaryStatements.add(parents.at(-1)!)
    if (mermaidMacro && args.some(ambiguousNamedArgument)) throw new C4AmbiguousArgumentError(`C4 argument is ambiguous in ${text}: separate named arguments with commas and use $name="value", or quote the entire value when it is literal text`)
    // A bare positional value consumes through the next comma in Mermaid's
    // attribute lexer, including a closing `)` when it is the last argument.
    // `$` instead enters named-argument syntax, whose value must be quoted.
    if (mermaidMacro && args.some((arg, index) => {
      const raw = arg.raw.trim()
      if (arg.name) return !/^\$[A-Za-z_][A-Za-z_0-9]*\s*=\s*"/.test(raw) && arg.value !== ''
      return raw.startsWith('$') || index === args.length - 1 && raw !== '' && !/^["']/.test(raw)
    })) diagnostic(body, statement.id, 'c4_unquoted_argument', 'Unquoted C4 argument text is read literally here, but pinned Mermaid requires a quoted final argument and quoted named values; serialization writes those values in double quotes')
    // Mermaid's lexer enters a macro's state at its name and reads only `(` there.
    if (mermaidMacro && text[macro.length] !== '(') diagnostic(body, statement.id, 'c4_space_before_arguments', `Pinned Mermaid reads "(" only straight after ${macro} and rejects whitespace between them; ours reads the call. Write ${macro}( with no space`)
    if (element && !(element[1] === 'Person' && element[2])) {
      observeC4Statement(statement, 'element')
      if (call[3]) throw new Error(`C4: ${macro} cannot open a boundary`)
      const fields = c4ArgumentFields(args, c4ElementFields(macro))
      const id = required(fields, 'alias', macro)
      if (ids.has(id)) throw new Error(`C4: duplicate declaration alias ${JSON.stringify(id)}`)
      ids.add(id)
      const record: C4Element = {
        id, macro, kind: element[1]!.toLowerCase() as C4Element['kind'], external: Boolean(element[3]),
        shape: element[1] === 'Person' ? 'person' : element[2] === 'Db' ? 'database' : element[2] === 'Queue' ? 'queue' : 'rectangle',
        label: argumentLabel(args, c4ElementFields(macro), fields, macro),
        technology: optional(c4DisplayArgument(args, c4ElementFields(macro), 'techn')), description: optional(c4DisplayArgument(args, c4ElementFields(macro), 'descr')),
        parentId: parents.at(-1), tags: tags(fields.tags), link: optional(fields.link), sprite: optional(fields.sprite), style: {}, args, statementId: statement.id,
      }
      if (admitWork) assertDiagramWorkLimit('nodes', body.elements.length + body.boundaries.length + 1)
      body.elements.push(record)
      if (parserObservationActive('c4')) observeParserMutation('c4', 'add-element', record)
      statement.kind = 'element'; statement.entityId = id; statement.signature = c4RecordSignature(record)
    } else if (BOUNDARIES[macro]) {
      observeC4Statement(statement, 'boundary-open')
      if (!call[3]) throw new Error(`C4: ${macro} requires a boundary block`)
      const fields = c4ArgumentFields(args, c4BoundaryFields(macro))
      const id = required(fields, 'alias', macro)
      if (ids.has(id)) throw new Error(`C4: duplicate declaration alias ${JSON.stringify(id)}`)
      ids.add(id)
      const record: C4Boundary = {
        id, macro, kind: BOUNDARIES[macro]!, label: argumentLabel(args, c4BoundaryFields(macro), fields, macro),
        type: optional(c4DisplayArgument(args, c4BoundaryFields(macro), 'type')), description: optional(c4DisplayArgument(args, c4BoundaryFields(macro), 'descr')),
        parentId: parents.at(-1), tags: tags(fields.tags), link: optional(fields.link), sprite: optional(fields.sprite), style: {}, args, statementId: statement.id,
        ...(macro === 'Node_L' ? { alignment: 'left' } : macro === 'Node_R' ? { alignment: 'right' } : {}),
      }
      if (admitWork) {
        assertDiagramWorkLimit('nodes', body.elements.length + body.boundaries.length + 1)
        assertDiagramWorkLimit('nesting', parents.length + 1)
      }
      body.boundaries.push(record); parents.push(id)
      if (parserObservationActive('c4')) observeParserMutation('c4', 'open-boundary', record)
      statement.entityId = id; statement.signature = c4RecordSignature(record)
    } else if (RELATIONS.has(macro)) {
      observeC4Statement(statement, 'relationship')
      const fields = c4ArgumentFields(args, c4RelationshipFields(macro))
      const from = required(fields, 'from', macro), to = required(fields, 'to', macro)
      const reversed = macro === 'Rel_Back'
      const record: C4Relationship = {
        id: '', macro, from, to, source: reversed ? to : from, target: reversed ? from : to,
        label: argumentLabel(args, c4RelationshipFields(macro), fields, macro),
        technology: optional(c4DisplayArgument(args, c4RelationshipFields(macro), 'techn')), description: optional(c4DisplayArgument(args, c4RelationshipFields(macro), 'descr')),
        tags: tags(fields.tags), link: optional(fields.link), sprite: optional(fields.sprite), style: {}, args, statementId: statement.id,
        index: macro === 'RelIndex' ? required(fields, 'index', macro) : undefined,
        order: body.relationships.length + 1, bidirectional: macro === 'BiRel', reversed, direction: DIRECTIONS[macro.slice(4)],
      }
      if (admitWork) assertDiagramWorkLimit('edges', body.relationships.length + body.layout.hints.length + 1)
      body.relationships.push(record)
      if (parserObservationActive('c4')) observeParserMutation('c4', 'add-relationship', record)
      statement.kind = 'relationship'
      if (macro === 'RelIndex' && args.slice(4).some(arg => !arg.name)) diagnostic(body, statement.id, 'c4_relindex_positional_metadata', 'RelIndex positional metadata follows documented tags/link slots; pinned Mermaid instead treats them as technology/description. Named $tags/$link avoids this ambiguity')
    } else {
      observeC4Statement(statement, 'directive')
      const directive: C4Directive = { id: statement.id, name: macro, args, category: c4DirectiveCategory(macro), statementId: statement.id }
      body.directives.push(directive)
      if (parserObservationActive('c4')) observeParserMutation('c4', 'add-directive', directive)
      statement.kind = 'directive'; statement.entityId = directive.id; statement.signature = c4RecordSignature(directive)
      if (directive.category === 'unknown') diagnostic(body, statement.id, 'c4_unknown_macro', `${macro} is preserved but has no native interpretation`, 'error')
      else if (!macro.startsWith('Update')) diagnostic(body, statement.id, 'c4_directive_extension', `${macro} is a reader extension; pinned Mermaid does not accept this directive`)
    }
    const knownNames = element ? c4ElementFields(macro) : BOUNDARIES[macro] ? c4BoundaryFields(macro) : RELATIONS.has(macro) ? c4RelationshipFields(macro)
      : c4DirectiveFields(macro) ?? (macro === 'AddElementTag' ? ELEMENT_TAG : macro === 'AddRelTag' ? REL_TAG : undefined)
    if (knownNames) {
      const assigned = new Set<string>()
      for (let index = 0; index < args.length; index++) {
        const arg = args[index]!, key = arg.name ?? knownNames[index]
        if (key === undefined || !knownNames.includes(key)) {
          diagnostic(body, statement.id, 'c4_unknown_argument', `${macro} argument ${arg.name ?? index + 1} is retained but has no native interpretation`, 'error')
        } else if (assigned.has(key)) {
          diagnostic(body, statement.id, 'c4_duplicate_argument', `${macro} assigns ${key} more than once; every argument is retained`, 'error')
        }
        if (key) assigned.add(key)
      }
    }
    if (args.some(arg => /^\s*'/.test(arg.raw) || /\\["']/.test(arg.raw))) {
      diagnostic(body, statement.id, 'c4_quoted_string_extension', 'Quoted-string extension is preserved; typed edits write Mermaid entity escapes')
    } else if (mermaidMacro && !c4ArgumentsArePortable(args)
      && !body.diagnostics.some(item => item.statementId === statement.id && ['c4_multiline_arguments', 'c4_empty_named_argument'].includes(item.syntax))) {
      diagnostic(body, statement.id, 'c4_argument_spelling', 'Argument text is retained as its native value; the writer emits complete quoted argument tokens instead of ambiguous imported spelling')
    }
  }
  if (!header) throw new Error('C4: missing diagram header')
  if (parents.length) throw new Error(`C4: unclosed boundary ${JSON.stringify(parents.at(-1))}`)
  if (admitWork) assertC4DiagramWork(body)
  const allocate = generatedIds(ids)
  const statementById = new Map(body.statements.map(statement => [statement.id, statement]))
  for (const relationship of body.relationships) {
    relationship.id = allocate(`c4-rel-${relationship.order}`, ['c4-relationship', relationship.order])
    if (parserObservationActive('c4')) observeParserMutation('c4', 'set-relationship-identity', { id: relationship.id, order: relationship.order })
    if (!ids.has(relationship.from) || !ids.has(relationship.to)) throw new Error(`C4: relationship ${relationship.id} references an undeclared endpoint`)
    const statement = statementById.get(relationship.statementId)!
    statement.entityId = relationship.id; statement.signature = c4RecordSignature(relationship)
  }
  resolveC4Directives(body, admitWork)
  for (const boundary of body.boundaries) {
    if (!boundaryStatements.has(boundary.id)) diagnostic(body, boundary.statementId, 'c4_empty_boundary', 'An empty boundary is retained; the writer supplies a no-op layout statement because pinned Mermaid requires a statement inside its block')
  }
  if (body.directives.some(directive => directive.name === 'direction')) {
    const direction = body.directives.find(directive => directive.name === 'direction')!
    diagnostic(body, direction.statementId, 'c4_direction', 'A standalone direction directive is a reader extension to legacy C4')
  }
  for (const record of [...body.elements, ...body.boundaries, ...body.relationships]) {
    if (record.sprite) diagnostic(body, record.statementId, 'c4_sprite', 'C4 sprite metadata is preserved; offline native output uses an explicit text fallback')
    if (record.style.lineStyle !== undefined && !['solid', 'dashed', 'dotted'].includes(record.style.lineStyle)) {
      diagnostic(body, record.statementId, 'c4_line_style', `C4 lineStyle ${JSON.stringify(record.style.lineStyle)} is preserved but has no native paint effect; the route uses solid strokes`)
    }
    for (const property of Object.keys(record.style)) {
      if (property === 'shape' && 'external' in record && c4ShapeOverride(record.style.shape) !== undefined) continue
      if (!['bgColor', 'fontColor', 'borderColor', 'textColor', 'lineColor', 'lineStyle', 'offsetX', 'offsetY', 'legendText', 'techn'].includes(property)) {
        diagnostic(body, record.statementId, 'c4_style_property', `C4 style ${property} is preserved as metadata but has no native paint effect`)
      }
    }
  }
  return body
}

/** A diagnostic's message with the authored statement it concerns. */
export function c4DiagnosticMessage(body: C4Body, diagnostic: C4Diagnostic): string {
  const statement = body.statements.find(record => record.id === diagnostic.statementId)
  return statement ? `${diagnostic.message} (in: ${statement.raw.trim()})` : diagnostic.message
}

export function parseC4Diagram(input: string | readonly string[]): C4Body {
  const body = readC4(input, true)
  const unsupported = body.diagnostics.find(item => item.severity === 'error')
  if (unsupported) throw new Error(`C4 unsupported syntax: ${c4DiagnosticMessage(body, unsupported)}`)
  return body
}
