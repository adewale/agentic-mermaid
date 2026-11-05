// Adapted from Pele (MIT, copyright 2026 kepano), revision 3a2f075.
// See LICENSES/pele-MIT.txt.

import { observeParserStatement, parserObservationActive } from '../../shared/parser-observation.ts'

import { type DraftBoundary, type DraftElement, type DraftEndpoint, type DraftJson, type DraftLabel, type DraftProperty, type Drafts, emptyDrafts, resolveUsecase } from './db.ts'
import { parseOrderedJson } from './json.ts'
import { lineColumn, locationText, tokenize } from './lexer.ts'
import { PeleError } from './support.ts'
import { T, TOKEN_NAMES } from './tokens.ts'
import { Arrow, type GraphStatement, type MetadataOccurrence, type NodeOccurrence, type RelationshipType, type Span, type UseCaseShape, type UsecaseModel } from './types.ts'

// Mermaid parses use case diagrams with a Chevrotain parser, which decides each choice by looking
// at most three tokens ahead and reports the first token that fits nowhere. This parser makes the
// same decisions from the same lookahead, so it accepts the same text and names the same token in
// its errors. It builds the model directly, where Mermaid builds a syntax tree and then visits it.

const LINE = 1
const RELATION = 2
const STYLE_PART = 4
const FOLLOWS_NAME = 8
const BOUNDARY_LINE = 16
const CLOSES_LABEL = 32
const METADATA_FIRST = 64

const ARROWS = 'DEPENDENCY_ARROW|GENERALIZATION|FORWARD_SOLID|BACKWARD_SOLID|MARKERLESS_SOLID|FORWARD_CIRCLE|BACKWARD_CIRCLE|FORWARD_CROSS|BACKWARD_CROSS'
const NAMES = 'IDENTIFIER|PLAIN_STRING|MARKDOWN_STRING'
const LABELS = 'PLAIN_STRING|MARKDOWN_STRING|LABEL_TEXT'
const STATEMENTS = 'ACC_TITLE_LINE|ACC_DESCR_LINE|ACC_DESCR_BLOCK|DIRECTION|ACTOR|SYSTEM_BOUNDARY|NOTE|JSON_DECLARATION_START|CLASS_DEF|CLASS|STYLE'
const STYLE_PARTS = 'WORD|PLAIN_STRING|NUMBER|HASH_COLOR|CSS_IDENTIFIER|CSS_ESCAPED_COMMA|DASH|DOT|PERCENT|CSS_PUNCTUATION|COLON|LPAREN|RPAREN|LBRACKET|RBRACKET|LBRACE|RBRACE|AT|MARKERLESS_SOLID'

const FLAGS = new Uint8Array(T.RPAREN + 1)
function flag(names: string, bits: number): void {
  for (const name of names.split('|')) {
    // WORD is a category: every keyword and IDENTIFIER.
    if (name === 'WORD') for (let t = T.USECASE; t <= T.IDENTIFIER; t++) FLAGS[t]! |= bits
    else FLAGS[TOKEN_NAMES.indexOf(name)]! |= bits
  }
}
flag(`NEWLINE|COMMENT|${STATEMENTS}|${NAMES}`, LINE)
flag(`IDENTIFIER|${ARROWS}`, RELATION)
flag(STYLE_PARTS, STYLE_PART)
flag(`STEREOTYPE_START|CLASS_SEPARATOR|IDENTIFIER|${ARROWS}|NEWLINE|EOF`, FOLLOWS_NAME)
flag(`NEWLINE|COMMENT|ACTOR|${NAMES}`, BOUNDARY_LINE)
flag('FORWARD_SOLID|MARKERLESS_SOLID|FORWARD_CIRCLE|FORWARD_CROSS', CLOSES_LABEL)
flag('NEWLINE|IDENTIFIER|PLAIN_STRING|RBRACE', METADATA_FIRST)

const FORBIDDEN = new Set(['allowmixing', 'newpage', 'package', 'rectangle', 'skinparam'])

interface Item {
  id: string
  label: DraftLabel
  span: Span
  generated: boolean
  shape?: UseCaseShape
  metadata?: DraftProperty[]
  stereotype?: string
  stereotypeSpan?: Span
  classes: string[]
  classSpans: Span[]
  // Whether this mention says something about the element, and so declares it.
  explicit: boolean
  nodeSpan: Span
}

interface Tail {
  explicitId?: string
  explicitIdSpan?: Span
  type: RelationshipType
  arrowType: number
  label?: DraftLabel
  minlen: number
  target: Item
  span: Span
}

let src = ''
let types: number[] = []
let starts: number[] = []
let ends: number[] = []
let p = 0
// Where the last token before the most recent line end stops, which is where its statement stops.
let lastEnd = 0
let drafts: Drafts
let parent: DraftBoundary | undefined
let pendingJson: [DraftJson, number][] = []
let edgeCount = 0
let noteCount = 0

function image(k: number): string {
  return src.slice(starts[k]!, ends[k]!)
}

function span(k: number): Span {
  return [starts[k]!, ends[k]!]
}

function fail(detail: string): never {
  const [line, column] = lineColumn(src, starts[p]!)
  throw new PeleError(`Error parsing usecase diagram: ${detail} at ${locationText(src, starts[p]!, ends[p]!)}`, 'syntax', { type: 'usecase', line, column })
}

function mismatch(name: string): never {
  fail(`Expecting token of type --> ${name} <-- but found --> '${image(p)}' <--`)
}

function expect(type: number): number {
  if (types[p]! !== type) mismatch(TOKEN_NAMES[type]!)
  return p++
}

// Chevrotain lists every token sequence that would have been accepted.
function noAlternative(expected: string): never {
  const list = expected.split('|').map((sequence, i) => `  ${i + 1}. [${sequence}]`)
  fail(`Expecting: one of these possible Token sequences:\n${list.join('\n')}\nbut found: '${image(p)}'`)
}

function statementSequences(): string {
  const names = NAMES.split('|')
  const metadata = names.flatMap(name => ['NEWLINE', 'IDENTIFIER', 'PLAIN_STRING', 'RBRACE'].map(next => `${name}, METADATA_START, ${next}`))
  const follows = `STEREOTYPE_START|CLASS_SEPARATOR|IDENTIFIER|${ARROWS}|NEWLINE|EOF`.split('|')
  const entities = names.flatMap((name, i) => (i === 0 ? ['LPAREN', 'LBRACKET', ...follows] : follows).map(next => `${name}, ${next}`))
  return [STATEMENTS, ...metadata, ...entities, ...metadata].join('|')
}

function isWord(type: number): boolean {
  return type >= T.USECASE && type <= T.IDENTIFIER
}

function isLabelText(type: number): boolean {
  return type >= T.USECASE && type <= T.LABEL_SYMBOL
}

function lineEnd(): void {
  lastEnd = ends[p - 1]!
  if (types[p]! === T.NEWLINE) p++
  else if (types[p]! !== T.EOF) noAlternative('NEWLINE|EOF')
}

// The text of a name or string token, without its quotes.
function content(k: number): Span {
  const trim = types[k]! === T.MARKDOWN_STRING ? 2 : types[k]! === T.PLAIN_STRING ? 1 : 0
  return [starts[k]! + trim, ends[k]! - trim]
}

function tokenLabel(k: number): DraftLabel {
  const at = content(k)
  return { text: src.slice(at[0]!, at[1]!), type: types[k]! === T.MARKDOWN_STRING ? 'markdown' : 'text', span: at }
}

function generatedId(label: string): string {
  return label.replace(/\W/g, '_')
}

// An unquoted label runs to the next delimiter and is taken from the source as written.
function label(): DraftLabel {
  const type = types[p]!
  if (type === T.PLAIN_STRING || type === T.MARKDOWN_STRING) return tokenLabel(p++)
  if (!isLabelText(type)) noAlternative(LABELS)
  const first = p
  while (isLabelText(types[p]!)) p++
  const at: Span = [starts[first]!, ends[p - 1]!]
  return { text: src.slice(at[0]!, at[1]!), type: 'text', span: at }
}

function isKey(type: number): boolean {
  return type === T.IDENTIFIER || type === T.PLAIN_STRING
}

function property(): DraftProperty {
  const key = p
  if (!isKey(types[p]!)) noAlternative('IDENTIFIER|PLAIN_STRING')
  p++
  expect(T.COLON)
  const value = p
  const type = types[p]!
  if (!isKey(type) && type !== T.TRUE && type !== T.FALSE) noAlternative('IDENTIFIER|PLAIN_STRING|TRUE|FALSE')
  p++
  const keySpan = content(key)
  const valueSpan = content(value)
  return {
    key: src.slice(keySpan[0]!, keySpan[1]!),
    value: type === T.TRUE ? true : type === T.FALSE ? false : src.slice(valueSpan[0]!, valueSpan[1]!),
    span: [starts[key]!, ends[value]!],
    keySpan,
    valueSpan,
  }
}

// Whether another property follows. A comma or line breaks before the closing brace do not count,
// but Chevrotain looks only three tokens ahead, so a comma and two line breaks, or three line
// breaks, are taken for a separator and the brace after them is then an error.
function separatorAhead(): boolean {
  const a = types[p]!
  const b = types[p + 1]!
  const c = types[p + 2]!
  if (a === T.COMMA) return isKey(b) || (b === T.NEWLINE && (c === T.NEWLINE || isKey(c)))
  if (a !== T.NEWLINE) return false
  return b === T.COMMA || isKey(b) || (b === T.NEWLINE && (c === T.NEWLINE || c === T.COMMA || isKey(c)))
}

function metadata(): DraftProperty[] {
  expect(T.METADATA_START)
  const properties: DraftProperty[] = []
  while (types[p]! === T.NEWLINE) p++
  if (isKey(types[p]!)) {
    properties.push(property())
    while (separatorAhead()) {
      if (types[p]! === T.COMMA) p++
      else {
        while (types[p]! === T.NEWLINE) p++
        if (types[p]! === T.COMMA) p++
      }
      while (types[p]! === T.NEWLINE) p++
      properties.push(property())
    }
    if (types[p]! === T.COMMA) p++
    while (types[p]! === T.NEWLINE) p++
  }
  expect(T.RBRACE)
  return properties
}

function occurrences(properties: DraftProperty[]): MetadataOccurrence[] {
  return properties.map(({ key, span, keySpan, valueSpan }) => ({ key, span, keySpan, valueSpan }))
}

function classSuffix(classes: string[], spans: Span[]): void {
  do {
    p++
    const id = expect(T.IDENTIFIER)
    classes.push(image(id))
    spans.push(span(id))
  } while (types[p]! === T.COMMA)
}

// An id with an optional label in parentheses or brackets, or a string that stands for both.
function name(brackets: boolean): Item {
  const k = p
  const type = types[p]!
  const item: Item = {
    id: '',
    label: undefined as unknown as DraftLabel,
    span: content(k),
    generated: type !== T.IDENTIFIER,
    classes: [],
    classSpans: [],
    explicit: false,
    nodeSpan: [0, 0],
  }
  if (type === T.IDENTIFIER) {
    p++
    item.id = image(k)
    const open = types[p]!
    if (open === T.LPAREN || (brackets && open === T.LBRACKET)) {
      p++
      item.label = label()
      expect(open === T.LPAREN ? T.RPAREN : T.RBRACKET)
      item.shape = open === T.LPAREN ? 'ellipse' : 'rect'
    } else item.label = tokenLabel(k)
  } else if (type === T.PLAIN_STRING || type === T.MARKDOWN_STRING) {
    p++
    item.label = tokenLabel(k)
    item.id = generatedId(item.label.text)
  } else noAlternative(NAMES)
  return item
}

function element(actor: boolean): Item {
  const first = p
  const item = name(!actor)
  if (actor) item.shape = undefined
  if (types[p]! === T.METADATA_START) item.metadata = metadata()
  if (types[p]! === T.STEREOTYPE_START) {
    p++
    const text = expect(T.STEREOTYPE_TEXT)
    expect(T.STEREOTYPE_END)
    item.stereotype = image(text).trim()
    item.stereotypeSpan = span(text)
  }
  if (types[p]! === T.CLASS_SEPARATOR) classSuffix(item.classes, item.classSpans)
  item.explicit = Boolean(item.shape || item.metadata || item.stereotype)
  item.nodeSpan = [starts[first]!, ends[p - 1]!]
  return item
}

function draft(item: Item, kind: 'actor' | 'usecase'): DraftElement {
  return {
    id: item.id,
    kind,
    label: item.label,
    span: item.span,
    generated: item.generated,
    parent,
    shape: item.shape,
    metadata: item.metadata,
    stereotype: item.stereotype,
    classes: item.classes,
  }
}

function endpoint(item: Item, declares: boolean): DraftEndpoint {
  return {
    id: item.id,
    label: item.label,
    span: item.span,
    generated: item.generated,
    declares,
    classed: item.classes.length > 0,
  }
}

function occurrence(item: Item, defines: boolean): NodeOccurrence {
  const out: NodeOccurrence = { id: item.id, span: item.nodeSpan, idSpan: item.span, labelSpan: item.label.span }
  if (defines) out.defines = true
  if (item.stereotypeSpan) out.stereotypeSpan = item.stereotypeSpan
  if (item.metadata) out.metadata = occurrences(item.metadata)
  if (item.classSpans.length > 0) out.classSpans = item.classSpans
  return out
}

// Whether a label and then one of the operators that can close it come next.
function labeledRight(closers: number): boolean {
  if (types[p]! < T.USECASE || types[p]! > T.MARKDOWN_STRING) return false
  for (let k = p + 1; ; k++) {
    const type = types[k]!
    if (type === T.MARKERLESS_SOLID || (FLAGS[type]! & closers) !== 0) return true
    if (type < T.USECASE || type > T.MARKDOWN_STRING) return false
  }
}

// Each dash beyond the second asks for one more rank between the two ends.
function minimumLength(k: number): number {
  const dashes = ends[k]! - starts[k]! - (types[k]! === T.MARKERLESS_SOLID ? 0 : 1)
  return Math.max(1, dashes - 1)
}

function relationTail(): Tail {
  const first = p
  const tail: Tail = {
    type: 'association',
    arrowType: Arrow.SOLID_ARROW,
    minlen: 1,
    target: undefined as unknown as Item,
    span: [0, 0],
  }
  if (types[p]! === T.IDENTIFIER && types[p + 1]! === T.AT) {
    tail.explicitId = image(p)
    tail.explicitIdSpan = span(p)
    p += 2
  }
  const k = p
  const type = types[p++]!
  if (type === T.DEPENDENCY_ARROW) {
    expect(T.COLON)
    if (types[p]! !== T.INCLUDE && types[p]! !== T.EXTEND) noAlternative('INCLUDE|EXTEND')
    tail.type = types[p]! === T.INCLUDE ? 'include' : 'extend'
    tail.label = { text: tail.type, type: 'text', span: span(p) }
    p++
  } else if (type === T.GENERALIZATION) tail.type = 'generalization'
  else if (type === T.FORWARD_SOLID) tail.minlen = minimumLength(k)
  else if (type === T.BACKWARD_SOLID) {
    tail.arrowType = Arrow.BACK_ARROW
    // Only the shortest operator can open a label: `A <-- label -- B`.
    if (ends[k]! - starts[k]! === 3 && labeledRight(0)) {
      tail.label = label()
      tail.minlen = minimumLength(expect(T.MARKERLESS_SOLID))
    } else tail.minlen = minimumLength(k)
  } else if (type === T.MARKERLESS_SOLID) {
    tail.arrowType = Arrow.LINE_SOLID
    if (ends[k]! - starts[k]! === 2 && labeledRight(CLOSES_LABEL)) {
      tail.label = label()
      const close = types[p]!
      if (close === T.FORWARD_SOLID) tail.arrowType = Arrow.SOLID_ARROW
      else if (close === T.FORWARD_CIRCLE) tail.arrowType = Arrow.CIRCLE_ARROW
      else if (close === T.FORWARD_CROSS) tail.arrowType = Arrow.CROSS_ARROW
      else if (close !== T.MARKERLESS_SOLID) noAlternative('FORWARD_SOLID|MARKERLESS_SOLID|FORWARD_CIRCLE|FORWARD_CROSS')
      if (tail.arrowType === Arrow.SOLID_ARROW || tail.arrowType === Arrow.LINE_SOLID) tail.minlen = minimumLength(p)
      p++
    } else tail.minlen = minimumLength(k)
  } else if (type === T.FORWARD_CIRCLE) tail.arrowType = Arrow.CIRCLE_ARROW
  else if (type === T.FORWARD_CROSS) tail.arrowType = Arrow.CROSS_ARROW
  else if (type === T.BACKWARD_CIRCLE || type === T.BACKWARD_CROSS) {
    tail.arrowType = type === T.BACKWARD_CIRCLE ? Arrow.CIRCLE_ARROW_REVERSED : Arrow.CROSS_ARROW_REVERSED
    if (labeledRight(0)) {
      tail.label = label()
      expect(T.MARKERLESS_SOLID)
    }
  } else {
    p--
    noAlternative(ARROWS)
  }
  tail.target = element(false)
  tail.span = [starts[first]!, ends[p - 1]!]
  return tail
}

function statement(kind: GraphStatement['kind']): GraphStatement {
  return { kind, span: [0, 0] }
}

function relationship(source: Item, declaration: boolean, tail: Tail, nodes: NodeOccurrence[]): GraphStatement {
  const target = tail.target
  if (target.explicit) drafts.elements.push(draft(target, 'usecase'))
  drafts.relationships.push({
    source: endpoint(source, declaration),
    target: endpoint(target, target.explicit),
    span: tail.span,
    id: tail.explicitId,
    idSpan: tail.explicitIdSpan,
    type: tail.type,
    arrowType: tail.arrowType,
    label: tail.label,
    minlen: tail.minlen,
  })
  nodes.push(occurrence(target, target.explicit))
  const out = statement('edge')
  out.nodes = nodes
  out.edges = [{ id: tail.explicitId ?? `edge-${edgeCount++}`, span: out.span }]
  if (tail.explicitIdSpan) out.edges[0]!.idSpan = tail.explicitIdSpan
  if (tail.label) out.edges[0]!.labelSpan = tail.label.span
  return out
}

function declaration(nodes: NodeOccurrence[]): GraphStatement {
  const out = statement('node')
  out.nodes = nodes
  return out
}

// `actor A, B` declares several actors; at the top level `actor A --> B` declares one and relates it.
function actors(top: boolean): GraphStatement {
  p++
  const items = [element(true)]
  let tail: Tail | undefined
  if (types[p]! === T.COMMA) {
    do {
      p++
      items.push(element(true))
    } while (types[p]! === T.COMMA)
  } else if (top && (FLAGS[types[p]!]! & RELATION) !== 0) tail = relationTail()
  lineEnd()
  for (const item of items) drafts.elements.push(draft(item, 'actor'))
  const nodes = items.map(item => occurrence(item, true))
  return tail ? relationship(items[0]!, true, tail, nodes) : declaration(nodes)
}

function entity(top: boolean): GraphStatement {
  const source = element(false)
  const tail = top && (FLAGS[types[p]!]! & RELATION) !== 0 ? relationTail() : undefined
  lineEnd()
  if (!tail) {
    source.explicit = true
    source.shape ??= 'ellipse'
  }
  if (source.explicit) drafts.elements.push(draft(source, 'usecase'))
  const nodes = [occurrence(source, source.explicit)]
  return tail ? relationship(source, source.explicit, tail, nodes) : declaration(nodes)
}

function boundary(): GraphStatement {
  p++
  const named = name(true)
  const group: DraftBoundary = {
    id: named.id,
    label: named.label,
    span: named.span,
    generated: named.generated,
    classes: named.classes,
  }
  const inline = types[p]! === T.METADATA_START ? metadata() : undefined
  if (types[p]! === T.CLASS_SEPARATOR) classSuffix(named.classes, named.classSpans)
  lineEnd()
  drafts.boundaries.push(group)
  parent = group
  const children: GraphStatement[] = []
  while ((FLAGS[types[p]!]! & BOUNDARY_LINE) !== 0) children.push(line(false))
  parent = undefined
  const end = expect(T.END)
  lineEnd()
  const out = statement('group')
  out.group = group.id
  out.idSpan = group.span
  out.titleSpan = group.label.span
  out.endSpan = span(end)
  out.classSpans = named.classSpans
  if (children.length > 0) out.children = children
  if (inline) {
    out.metadata = occurrences(inline)
    drafts.metadata.push({ target: group.id, span: group.span, properties: inline, statement: out })
  }
  return out
}

function style(): string {
  const first = p
  const type = types[p]!
  if (isWord(type) || type === T.CSS_IDENTIFIER) p++
  else if (type === T.MARKERLESS_SOLID) {
    p++
    if (!isWord(types[p]!)) mismatch('WORD')
    p++
  } else noAlternative('WORD|CSS_IDENTIFIER|MARKERLESS_SOLID')
  expect(T.COLON)
  if ((FLAGS[types[p]!]! & STYLE_PART) === 0) {
    fail(`Expecting: expecting at least one iteration which starts with one of these possible Token sequences::\n  <[${STYLE_PARTS.replaceAll('|', '] ,[')}]>\nbut found: '${image(p)}'`)
  }
  while ((FLAGS[types[p]!]! & STYLE_PART) !== 0) p++
  // The value is taken from the source, so the spaces inside `1px solid red` survive.
  return src.slice(starts[first]!, ends[p - 1]!).replaceAll('\\,', ',')
}

function styles(): string[] {
  const out = [style()]
  while (types[p]! === T.COMMA) {
    p++
    out.push(style())
  }
  return out
}

function identifiers(): number[] {
  const out = [expect(T.IDENTIFIER)]
  while (types[p]! === T.COMMA) {
    p++
    out.push(expect(T.IDENTIFIER))
  }
  return out
}

function reference(k: number): NodeOccurrence {
  const at = content(k)
  return { id: image(k), span: at, idSpan: at }
}

function topStatement(): GraphStatement {
  const k = p
  const type = types[p]!
  let out: GraphStatement
  if (type === T.ACC_TITLE_LINE || type === T.ACC_DESCR_LINE || type === T.ACC_DESCR_BLOCK) {
    p++
    const text = image(k)
    if (type === T.ACC_DESCR_BLOCK) {
      drafts.accDescription = text.slice(text.indexOf('{') + 1, text.lastIndexOf('}')).trim()
    } else if (type === T.ACC_DESCR_LINE) drafts.accDescription = text.slice(text.indexOf(':') + 1).trim()
    else drafts.accTitle = text.slice(text.indexOf(':') + 1).trim()
    out = statement(type === T.ACC_TITLE_LINE ? 'accTitle' : 'accDescr')
  } else if (type === T.DIRECTION) {
    p++
    const value = types[p]!
    if (value < T.TD || value > T.RL) noAlternative('TD|TB|BT|LR|RL')
    drafts.direction = value === T.TD ? 'TB' : (image(p) as 'TB' | 'BT' | 'LR' | 'RL')
    p++
    out = statement('direction')
  } else if (type === T.ACTOR) return actors(true)
  else if (type === T.SYSTEM_BOUNDARY) return boundary()
  else if (type === T.NOTE) {
    p++
    expect(T.FOR)
    const target = expect(T.IDENTIFIER)
    const text = label()
    drafts.notes.push({ target: image(target), span: span(target), label: text })
    out = statement('note')
    out.ref = `note-${noteCount++}`
    out.refSpan = text.span
    out.nodes = [reference(target)]
  } else if (type === T.JSON_DECLARATION_START) {
    p++
    const literal = expect(T.JSON_OBJECT_LITERAL)
    const classes: string[] = []
    const classSpans: Span[] = []
    if (types[p]! === T.CLASS_SEPARATOR) classSuffix(classes, classSpans)
    let from = starts[k]! + 4
    while (src.charCodeAt(from) === 32 || src.charCodeAt(from) === 9) from++
    let to = from
    while (/\w/.test(src.charAt(to))) to++
    const json: DraftJson = { id: src.slice(from, to), value: {}, propertyOrder: new Map(), span: [from, to], classes }
    drafts.jsons.push(json)
    pendingJson.push([json, literal])
    out = statement('json')
    out.nodes = [{ id: json.id, span: json.span, idSpan: json.span, defines: true, classSpans }]
    out.classSpans = classSpans
  } else if (type === T.CLASS_DEF) {
    p++
    const ids = identifiers()
    drafts.classDefs.push({ ids: ids.map(image), styles: styles() })
    out = statement('classDef')
    out.ref = image(ids[0]!)
    out.refSpan = span(ids[0]!)
  } else if (type === T.CLASS) {
    p++
    const targets = identifiers()
    const classes = identifiers()
    drafts.classes.push({
      targets: targets.map(id => ({ id: image(id), span: span(id) })),
      classes: classes.map(image),
    })
    out = statement('classAssign')
    out.ref = image(classes[0]!)
    out.refSpan = span(classes[0]!)
    out.nodes = targets.map(reference)
  } else if (type === T.STYLE) {
    p++
    const target = expect(T.IDENTIFIER)
    drafts.styles.push({ target: image(target), span: span(target), styles: styles() })
    out = statement('style')
    out.nodes = [reference(target)]
  } else {
    const next = types[p + 1]!
    if (next === T.METADATA_START) {
      if ((FLAGS[types[p + 2]!]! & METADATA_FIRST) === 0) noAlternative(statementSequences())
      p++
      const target = reference(k)
      if (type !== T.IDENTIFIER) target.id = generatedId(src.slice(target.span[0]!, target.span[1]!))
      const assigned = metadata()
      out = statement('metadata')
      out.nodes = [target]
      out.metadata = occurrences(assigned)
      drafts.metadata.push({ target: target.id, span: target.span, properties: assigned, statement: out })
    } else {
      const follows = (FLAGS[next]! & FOLLOWS_NAME) !== 0 || (type === T.IDENTIFIER && (next === T.LPAREN || next === T.LBRACKET))
      // Mermaid turns away the PlantUML statements people are most likely to try.
      if (!follows || (type === T.IDENTIFIER && FORBIDDEN.has(image(k).toLowerCase()))) {
        noAlternative(statementSequences())
      }
      return entity(true)
    }
  }
  lineEnd()
  return out
}

function line(top: boolean): GraphStatement {
  const k = p
  const type = types[p]!
  if (type === T.NEWLINE) {
    p++
    return { kind: 'blank', span: span(k) }
  }
  if (type === T.COMMENT) {
    p++
    lineEnd()
    return { kind: 'comment', span: span(k) }
  }
  const out = top ? topStatement() : type === T.ACTOR ? actors(false) : entity(false)
  out.span = [starts[k]!, lastEnd]
  if (out.edges) for (const edge of out.edges) edge.span = out.span
  if (parserObservationActive('usecase')) {
    const [line, column] = lineColumn(src, out.span[0]!)
    observeParserStatement('usecase', out.kind, src.slice(out.span[0]!, out.span[1]!), { line, column, offset: out.span[0], endOffset: out.span[1], unit: 'normalized' })
  }
  return out
}

export function parseUsecase(source: string, title?: string): UsecaseModel {
  const previous = { src, types, starts, ends, p, lastEnd, drafts, parent, pendingJson, edgeCount, noteCount }
  try {
    src = source
    ;({ types, starts, ends } = tokenize(source))
    p = 0
    drafts = emptyDrafts()
    parent = undefined
    pendingJson = []
    edgeCount = 0
    noteCount = 0
    const header = expect(T.USECASE)
    lineEnd()
    const statements: GraphStatement[] = []
    while ((FLAGS[types[p]!]! & LINE) !== 0) statements.push(line(true))
    if (types[p]! !== T.EOF) fail(`Redundant input, expecting EOF but found: ${image(p)}`)
    // The whole text has to be well formed before the JSON in it is looked at, as in Mermaid.
    for (const [json, literal] of pendingJson) {
      const parsed = parseOrderedJson(image(literal), () => lineColumn(source, starts[literal]!))
      json.value = parsed.value
      json.propertyOrder = parsed.propertyOrder
    }
    return resolveUsecase(source, drafts, span(header), statements, title)
  } finally {
    ;({ src, types, starts, ends, p, lastEnd, drafts, parent, pendingJson, edgeCount, noteCount } = previous)
  }
}
