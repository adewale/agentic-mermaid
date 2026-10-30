// ============================================================================
// The default backend's SVG writer: each shape, text and connector mark's
// element is written from its typed fields, so paint certification, which
// reads those fields, describes the bytes a render emits. Families supply
// inert hooks (classes, data-*) through `attributes`; geometry, paint,
// typography, transforms, markers, identity and ARIA come from the mark.
// ============================================================================

import type { ConnectorLabelDescriptor, ConnectorMark, Geometry, MarkAttributes, MarkPaint, ScenePoint, SceneTransform, ShapeMark, TextMark } from './ir.ts'
import type { SvgSemanticIdentity } from './identity.ts'
import type { SvgSemanticAccessibility } from './accessibility.ts'
import { hasDomSvgIdentityRole } from './identity.ts'
import { serializeTransform } from './transforms.ts'
import { connectorInlineLabelText } from './bounds.ts'
import { escapeAttr, escapeXml, renderMultilineText, type PreparedSingleLineWrite } from '../multiline-utils.ts'
import { formatSvgNumber, formatSvgNumericAttribute } from '../shared/svg-number.ts'
import { connectorUnitTangent } from './connector-geometry.ts'
import { createWrittenPolyline } from './written-geometry.ts'
import { indentLines } from './serialization.ts'
import { verifySvgDocumentEnvelope, verifySvgDocumentDataPositions } from '../output-security.ts'
import { MAX_OCCLUSION_OPERATIONS } from './paint-work.ts'

/** XML construction belongs to one actual writer transaction. Raw chunks and
 * cached bytes retain their full markup in the validation projection. */
declare const svgXmlWrite: unique symbol
declare const svgXmlCapture: unique symbol
export interface SvgXmlWrite { readonly [svgXmlWrite]: true; readonly svg: string }
export interface SvgXmlWriteRecord { readonly svg: string; readonly node: object | undefined }
export interface SvgXmlCapture {
  readonly [svgXmlCapture]: true
  raw(svg: string, node?: object): SvgXmlWrite
  join(writes: Iterable<SvgXmlWrite>, separator?: string): SvgXmlWrite
  indent(write: SvgXmlWrite, spaces: number): SvgXmlWrite
  /** Identity and actual bytes only; exhaustion cannot discard emitted output. */
  read(write: SvgXmlWrite, expectedNode?: object): SvgXmlWriteRecord | undefined
  /** Fresh envelope verification binds occupied DATA positions to this actual tree. */
  verify(write: SvgXmlWrite): boolean
}
interface XmlList<T> { length: number; [index: number]: T }
function xmlList<T>(): XmlList<T> { const list = Object.create(null) as XmlList<T>; list.length = 0; return list }
interface XmlProjection { readonly skeleton: string; readonly occupied: Readonly<ArrayLike<number>> }
const EMPTY_XML_OCCUPIED: Readonly<ArrayLike<number>> = Object.freeze(Object.assign(Object.create(null), { length: 0 }))
const OCCUPIED_XML_LEAF: XmlProjection = Object.freeze({ skeleton: ' ', occupied: Object.freeze(Object.assign(Object.create(null), { 0: 0, length: 1 })) })
// Proof reads use primitive indexing, including under hooks installed before
// this module loads. No ambient String/RegExp method can rewrite the facts.
function xmlRange(value: string, start: number, end = value.length): string {
  let result = ''
  for (let i = start; i < end; i++) result += value[i]!
  return result
}
function xmlReferenceLength(value: string, start: number): number {
  const marker = start + 1 < value.length ? value[start + 1] : undefined
  if (marker === 'a') return start + 5 <= value.length && value[start + 2] === 'm' && value[start + 3] === 'p' && value[start + 4] === ';' ? 5 : 0
  if (marker === 'l' || marker === 'g') return start + 4 <= value.length && value[start + 2] === 't' && value[start + 3] === ';' ? 4 : 0
  if (marker === 'q') return start + 6 <= value.length && value[start + 2] === 'u' && value[start + 3] === 'o' && value[start + 4] === 't' && value[start + 5] === ';' ? 6 : 0
  if (marker !== '#' || start + 2 >= value.length) return 0
  const digit = value[start + 2]
  if (digit === '9') return start + 4 <= value.length && value[start + 3] === ';' ? 4 : 0
  return start + 5 <= value.length && (digit === '3' && value[start + 3] === '9' || digit === '1' && (value[start + 3] === '0' || value[start + 3] === '3')) && value[start + 4] === ';' ? 5 : 0
}
function xmlAsciiLetter(character: string): boolean { return character >= 'A' && character <= 'Z' || character >= 'a' && character <= 'z' }
type XmlProjectionResult = string | XmlProjection | undefined
interface XmlCaptureState {
  pay(operations: number): boolean
  literal(value: string, attribute: boolean): boolean
  name(value: string): boolean
  prepared(): boolean
  project(write: SvgXmlWrite): boolean
  boundary(value: string): boolean
  issue(svg: string, skeleton: string | (() => XmlProjectionResult), node?: object): SvgXmlWrite
}
interface XmlWriteFact {
  readonly capture: SvgXmlCapture
  readonly record: SvgXmlWriteRecord
  readonly projection: string | (() => XmlProjectionResult)
  projected?: XmlProjection
}
const xmlCaptures = new WeakMap<SvgXmlCapture, XmlCaptureState>()
const xmlWrites = new WeakMap<SvgXmlWrite, XmlWriteFact>()

export function createSvgXmlCapture(work: (operations: number) => boolean): SvgXmlCapture {
  const names = new Map<string, boolean>(), attributes = new Map<string, boolean>(), texts = new Map<string, boolean>(), boundaries = new Map<string, boolean>()
  let exhausted = false
  const pay = (count: number): boolean => {
    if (exhausted || !Number.isSafeInteger(count) || count < 0 || work(count) !== true) { exhausted = true; return false }
    return true
  }
  let capture: SvgXmlCapture
  const issue = (svg: string, projection: string | (() => XmlProjectionResult), node?: object): SvgXmlWrite => {
    pay(1)
    const write = Object.freeze(Object.assign(Object.create(null), { svg })) as SvgXmlWrite
    const record = Object.freeze(Object.assign(Object.create(null), { svg, node })) as SvgXmlWriteRecord
    xmlWrites.set(write, { capture, record, projection })
    return write
  }
  const factOf = (write: SvgXmlWrite): XmlWriteFact | undefined => {
    pay(1)
    if (typeof write !== 'object' || write === null) return undefined
    const found = xmlWrites.get(write)
    return found?.capture === capture ? found : undefined
  }
  // Opaque fragments must finish their lexical tokens before a typed element
  // can be substituted. Element nesting/namespaces stay with the final parser.
  const boundary = (value: string): boolean => {
    if (!pay(2)) return false
    const retained = boundaries.get(value)
    if (retained !== undefined) return retained
    if (!pay(value.length * 2 + 2)) return false
    let tag = false, reference = false, quote: '"' | "'" | undefined, valid = true
    for (let i = 0; i < value.length; i++) {
      const character = value[i]!
      if (reference) { if (character === ';') reference = false; continue }
      if (character === '&') { reference = true; continue }
      if (!tag) {
        if (character === '<') {
          const next = i + 1 < value.length ? value[i + 1] : undefined
          if (!next || next === '!' || next === '?') { valid = false; break }
          tag = true
        }
      } else if (quote) {
        if (character === quote) quote = undefined
        else if (character === '<') { valid = false; break }
      } else if (character === '"' || character === "'") quote = character
      else if (character === '>') tag = false
      else if (character === '<') { valid = false; break }
    }
    valid &&= !tag && !reference && quote === undefined
    boundaries.set(value, valid)
    return valid
  }
  const projectFact = (fact: XmlWriteFact): XmlProjection | undefined => {
    if (!pay(2)) return undefined
    if (fact.projected) return fact.projected
    const projected = typeof fact.projection === 'string' ? boundary(fact.projection) ? fact.projection : undefined : fact.projection()
    if (projected === undefined || exhausted) return undefined
    return fact.projected = typeof projected === 'string'
      ? Object.freeze({ skeleton: projected, occupied: EMPTY_XML_OCCUPIED }) : projected
  }
  const literal = (value: string, attribute: boolean): boolean => {
    if (!pay(2)) return false
    const cache = attribute ? attributes : texts
    const retained = cache.get(value)
    if (retained !== undefined) return retained
    if (!pay(value.length + 2)) return false
    let valid = true
    for (let i = 0; i < value.length; i++) {
      const character = value[i]!
      if (character === '<' || !attribute && character === '>' && i >= 2 && value[i - 1] === ']' && value[i - 2] === ']' || attribute && character === '"' || character < '\u0020' && character !== '\t' && character !== '\n' && character !== '\r' || character === '\ufffe' || character === '\uffff') { valid = false; break }
      if (character >= '\ud800' && character <= '\udbff') {
        const next = ++i < value.length ? value[i]! : ''
        if (!(next >= '\udc00' && next <= '\udfff')) { valid = false; break }
      } else if (character >= '\udc00' && character <= '\udfff') { valid = false; break }
      if (character === '&') {
        const length = xmlReferenceLength(value, i)
        if (!length) { valid = false; break }
        i += length - 1
      }
    }
    cache.set(value, valid)
    return valid
  }
  const name = (value: string): boolean => {
    if (!pay(2)) return false
    const retained = names.get(value)
    if (retained !== undefined) return retained
    if (!pay(value.length + 2)) return false
    let valid = value === 'xml:space'
    if (!valid && value !== 'xmlns' && value.length > 0 && (xmlAsciiLetter(value[0]!) || value[0] === '_')) {
      valid = true
      for (let i = 1; i < value.length; i++) {
        const character = value[i]!
        if (!xmlAsciiLetter(character) && !(character >= '0' && character <= '9') && character !== '_' && character !== '.' && character !== '-') { valid = false; break }
      }
    }
    names.set(value, valid)
    return valid
  }
  let preparedChecked = false
  const prepared = (): boolean => {
    if (!pay(1)) return false
    if (preparedChecked) return true
    const fixedNames = ['x', 'y', 'dy', 'textLength', 'data-prepared-text', 'lengthAdjust', 'data-font-metrics']
    for (let i = 0; i < fixedNames.length; i++) if (!name(fixedNames[i]!)) return false
    const fixedValues = ['true', 'spacingAndGlyphs', 'deterministic-fit']
    for (let i = 0; i < fixedValues.length; i++) if (!literal(fixedValues[i]!, true)) return false
    preparedChecked = true
    return true
  }
  capture = Object.freeze(Object.assign(Object.create(null), {
    raw(svg: string, node?: object): SvgXmlWrite {
      if (typeof svg !== 'string') throw new TypeError('XML raw chunks require a string')
      return issue(svg, svg, node)
    },
    join(writes: Iterable<SvgXmlWrite>, separator = '\n'): SvgXmlWrite {
      if (typeof separator !== 'string') throw new TypeError('XML joins require a string separator')
      const children = pay(1) ? xmlList<XmlWriteFact>() : undefined
      let svg = '', count = 0
      // Input iteration is public behavior. The retained private roster and
      // actual bytes use own slots/concatenation, never inherited array hooks.
      for (const write of writes) {
        const found = factOf(write)
        if (!found) throw new TypeError('XML composition requires this capture’s actual writes')
        if (count++) svg += separator
        svg += found.record.svg
        if (children) children[children.length++] = found
      }
      return issue(svg, children ? () => {
        if (children.length > 1 && !boundary(separator) || !pay(1)) return undefined
        const occupied = xmlList<number>()
        let skeleton = ''
        for (let i = 0; i < children.length; i++) {
          if (i) skeleton += separator
          const checked = projectFact(children[i]!)
          if (!checked) return undefined
          for (let j = 0; j < checked.occupied.length; j++) {
            if (!pay(1)) return undefined
            occupied[occupied.length++] = skeleton.length + checked.occupied[j]!
          }
          skeleton += checked.skeleton
        }
        if (!pay(children.length + skeleton.length + occupied.length + 2)) return undefined
        return Object.freeze({ skeleton, occupied: Object.freeze(occupied) })
      } : svg)
    },
    indent(write: SvgXmlWrite, spaces: number): SvgXmlWrite {
      const found = factOf(write)
      if (!found) throw new TypeError('XML indentation requires this capture’s actual write')
      if (spaces <= 0 || found.record.svg === '') return write
      if (typeof spaces !== 'number' || spaces === 1 / 0 || spaces > MAX_OCCLUSION_OPERATIONS) { const svg = indentLines(found.record.svg, spaces); return issue(svg, svg) }
      // Primitive numeric indentation is private construction. Generic values,
      // nonfinite errors and padding beyond the proof allowance keep the
      // established helper path, whose exact actual result remains raw.
      const padding = spaces !== spaces ? 0 : spaces - spaces % 1
      let pad = '', svg = ''
      for (let i = 0; i < padding; i++) pad += ' '
      svg += pad
      for (let i = 0; i < found.record.svg.length; i++) { const character = found.record.svg[i]!; svg += character; if (character === '\n') svg += pad }
      return issue(svg, () => {
        if (!pay(1)) return undefined
        const checked = projectFact(found)
        if (!checked || !pay(checked.skeleton.length + padding + 3)) return undefined
        const occupied = xmlList<number>()
        let skeleton = pad, next = 0
        for (let i = 0; i < checked.skeleton.length; i++) {
          if (next < checked.occupied.length && checked.occupied[next] === i) {
            if (!pay(1)) return undefined
            occupied[occupied.length++] = skeleton.length; next++
          }
          const character = checked.skeleton[i]!
          skeleton += character
          if (character === '\n') { if (!pay(padding)) return undefined; skeleton += pad }
        }
        if (!pay(occupied.length + 2)) return undefined
        return Object.freeze({ skeleton, occupied: Object.freeze(occupied) })
      })
    },
    read(write: SvgXmlWrite, expectedNode?: object): SvgXmlWriteRecord | undefined {
      const found = factOf(write)?.record
      return found && (expectedNode === undefined || found.node === expectedNode) ? found : undefined
    },
    verify(write: SvgXmlWrite): boolean {
      const found = factOf(write)
      if (!found) return false
      const projected = projectFact(found)
      return projected
        ? verifySvgDocumentDataPositions(projected.skeleton, projected.occupied, pay)
        : verifySvgDocumentEnvelope(found.record.svg, pay)
    },
  })) as SvgXmlCapture
  xmlCaptures.set(capture, { pay, literal, name, prepared, boundary, issue, project(write) {
    const found = factOf(write)
    return !!found && projectFact(found) !== undefined
  } })
  return capture
}

function finishXmlLeaf(capture: SvgXmlCapture, node: object, svg: string, xml: XmlLeafWrite | undefined, eligible = true, additional?: Readonly<ArrayLike<XmlLeafWrite>>, completion?: XmlLeafWrite): SvgXmlWrite {
  const state = xmlCaptures.get(capture)
  if (!state) throw new TypeError('Unknown XML capture')
  // Empty output cannot insert a delimiter between adjacent raw text spans.
  return state.issue(svg, svg && eligible && xml ? () => {
    let valid = xml.check()
    for (let i = 0; valid && additional && i < additional.length; i++) valid = additional[i]!.check()
    if (valid && completion) markXmlLeafComplete(completion)
    return valid ? OCCUPIED_XML_LEAF : state.boundary(svg) ? svg : undefined
  } : svg, node)
}

type XmlWriteEvent = readonly ['element', string] | readonly ['attribute', string, string, (keyof MarkPaint)?] | readonly ['text', string] | readonly ['prepared', string, string, string, string, string]
class XmlLeafWrite {
  readonly #state: XmlCaptureState
  readonly #events: XmlList<XmlWriteEvent> | undefined
  valid = true
  #paintPrepared = false
  #complete = false
  static markComplete(xml: XmlLeafWrite): void { xml.#complete = true }
  static completed(xml: XmlLeafWrite | undefined): boolean { return xml !== undefined && xml.#complete }
  constructor(state: XmlCaptureState) { this.#state = state; this.valid = state.pay(1); this.#events = this.valid ? xmlList() : undefined }
  list<T>(): XmlList<T> | undefined { return this.#state.pay(1) ? xmlList<T>() : undefined }
  element(name: string): void {
    if (this.valid) { this.valid = this.#state.pay(1); if (this.valid) this.#events![this.#events!.length++] = ['element', name] }
  }
  attribute(name: string, escaped: unknown): void {
    if (this.valid) { this.valid = typeof escaped === 'string' && this.#state.pay(1); if (this.valid) this.#events![this.#events!.length++] = ['attribute', name, escaped as string] }
  }
  recordPaintField(field: keyof MarkPaint): void {
    if (!this.valid) return
    this.valid = this.#state.pay(1)
    if (!this.valid) return
    const index = this.#events!.length - 1, event = this.#events![index]
    if (!event || event[0] !== 'attribute' || event.length !== 3) { this.valid = false; return }
    this.#events![index] = ['attribute', event[1], event[2], field]
  }
  text(content: string): void {
    if (this.valid) { this.valid = typeof content === 'string' && this.#state.pay(1); if (this.valid) this.#events![this.#events!.length++] = ['text', content] }
  }
  prepared(written: PreparedSingleLineWrite): void {
    if (!this.valid) return
    const { x, y, dy, textLength, content } = written
    this.valid = typeof x === 'string' && typeof y === 'string' && typeof dy === 'string' && typeof textLength === 'string' && typeof content === 'string' && this.#state.pay(5)
    if (this.valid) this.#events![this.#events!.length++] = ['prepared', x, y, dy, textLength, content]
    for (let i = 0; i < written.additionalAttributes.length; i++) { const attribute = written.additionalAttributes[i]!; this.attribute(attribute.name, attribute.value) }
  }
  markPaintPrepared(written: PreparedSingleLineWrite): void {
    if (this.valid) this.#paintPrepared = this.#state.pay(1) && written.additionalAttributes.length === 0
  }
  static paint(xml: XmlLeafWrite): MarkPaint | undefined {
    if (!xml.valid || !xml.#paintPrepared || !xml.#state.pay(1)) return undefined
    const paint = { __proto__: null } as MarkPaint
    let prepared = false
    for (let i = 0; i < xml.#events!.length; i++) {
      if (!xml.#state.pay(2)) return undefined
      const event = xml.#events![i]!
      if (event[0] === 'attribute' && event.length === 4) {
        const field = event[3], escaped = event[2]
        if (field === undefined || !xml.#state.pay(2 + escaped.length)) return undefined
        for (let j = 0; j < escaped.length; j++) if (escaped[j] === '&') return undefined
        textPaintDefine(paint, field, { value: escaped, enumerable: true, writable: false, configurable: false })
      } else if (event[0] === 'prepared') {
        const content = event[5]
        if (prepared || !xml.#state.pay(content.length + 1)) return undefined
        for (let j = 0; j < content.length; j++) if (content[j] === '<') return undefined
        prepared = true
      }
    }
    return prepared ? textPaintFreeze(paint) : undefined
  }
  check(): boolean {
    if (!this.valid || !this.#state.pay(1)) return false
    const attributes = new Set<string>()
    for (let i = 0; i < this.#events!.length; i++) {
      const event = this.#events![i]!
      if (!this.#state.pay(2)) return false
      if (event[0] === 'element') {
        attributes.clear()
        const name = event[1]
        if (name !== 'rect' && name !== 'circle' && name !== 'ellipse' && name !== 'line' && name !== 'polygon' && name !== 'polyline' && name !== 'path' && name !== 'text') return false
      } else if (event[0] === 'attribute') {
        if (attributes.has(event[1]) || !this.#state.name(event[1]) || !this.#state.literal(event[2], true)) return false
        attributes.add(event[1])
      } else if (event[0] === 'prepared') {
        if (!this.#state.prepared()) return false
        const attribute = (name: string, value?: string): boolean => {
          if (!this.#state.pay(2) || attributes.has(name)) return false
          attributes.add(name)
          return value === undefined || this.#state.literal(value, true)
        }
        if (!attribute('x', event[1]) || !attribute('y', event[2]) || !attribute('dy', event[3]) || !attribute('textLength', event[4])
          || !attribute('data-prepared-text') || !attribute('lengthAdjust') || !attribute('data-font-metrics') || !this.#state.literal(event[5], false)) return false
      } else if (!this.#state.literal(event[1], false)) return false
    }
    return true
  }
}

const projectXmlTextPaint = XmlLeafWrite.paint
const markXmlLeafComplete = XmlLeafWrite.markComplete, xmlLeafCompleted = XmlLeafWrite.completed

declare const svgTextPaintWrite: unique symbol
export interface SvgTextPaintWrite { readonly [svgTextPaintWrite]: true }
const textPaintDefine = Object.defineProperty, textPaintFreeze = Object.freeze, textPaintHasOwn = Object.hasOwn
const textPaintIssuer = { __proto__: null }
class ActualTextPaintWrite implements SvgTextPaintWrite {
  declare readonly [svgTextPaintWrite]: true
  readonly #capture: SvgXmlCapture
  readonly #write: SvgXmlWrite
  readonly #source: TextMark
  readonly #svg: string
  #paint: MarkPaint | undefined
  #paintRead = false
  readonly #xml: XmlLeafWrite | undefined
  readonly #inherited: boolean
  constructor(issuer: object, capture: SvgXmlCapture, write: SvgXmlWrite, source: TextMark, svg: string, xml: XmlLeafWrite | undefined, inherited: boolean) {
    if (issuer !== textPaintIssuer) throw new TypeError('Actual text paint requires its writer')
    this.#capture = capture; this.#write = write; this.#source = source; this.#svg = svg; this.#xml = xml; this.#inherited = inherited
  }
  static paint(value: unknown): MarkPaint | undefined {
    if (typeof value !== 'object' || value === null || !(#source in value)) return undefined
    if (!value.#paintRead) {
      value.#paintRead = true
      value.#paint = value.#xml ? projectXmlTextPaint(value.#xml) : undefined
    }
    return value.#paint
  }
  static inherited(value: unknown): boolean {
    return typeof value === 'object' && value !== null && #source in value && value.#inherited
  }
  static matches(value: unknown, capture: SvgXmlCapture, write: SvgXmlWrite | undefined, source: object, svg: string): boolean {
    return typeof value === 'object' && value !== null && #source in value && value.#capture === capture && value.#write === write && value.#source === source && value.#svg === svg
  }
  static closed(value: unknown): boolean {
    return typeof value === 'object' && value !== null && #source in value && xmlLeafCompleted(value.#xml)
  }
  static close(value: unknown, capture: SvgXmlCapture): boolean {
    if (typeof value !== 'object' || value === null || !(#source in value) || value.#capture !== capture) return false
    return xmlCaptures.get(capture)?.project(value.#write) === true && xmlLeafCompleted(value.#xml)
  }
  static read(value: unknown, source: object, svg: string, capture?: SvgXmlCapture, write?: SvgXmlWrite): MarkPaint | undefined {
    if (typeof value !== 'object' || value === null || !(#source in value)) return undefined
    return value.#source === source && value.#svg === svg && (capture === undefined || value.#capture === capture && value.#write === write) ? paintActualTextPaintWrite(value) : undefined
  }
}
const readActualTextPaintWrite = ActualTextPaintWrite.read, paintActualTextPaintWrite = ActualTextPaintWrite.paint
const inheritedActualTextPaintWrite = ActualTextPaintWrite.inherited, matchesActualTextPaintWrite = ActualTextPaintWrite.matches
export function svgTextPaintOf(value: SvgTextPaintWrite): MarkPaint | undefined { return paintActualTextPaintWrite(value) }
export function hasInheritedSvgTextPaint(value: SvgTextPaintWrite): boolean { return inheritedActualTextPaintWrite(value) }
const closedActualTextPaintWrite = ActualTextPaintWrite.closed, closeActualTextPaintWrite = ActualTextPaintWrite.close
export function hasSvgTextPaintClosure(value: SvgTextPaintWrite): boolean { return closedActualTextPaintWrite(value) }
export function closeSvgTextPaintWrite(value: SvgTextPaintWrite, capture: SvgXmlCapture): boolean { return closeActualTextPaintWrite(value, capture) }
/** A paint fact owns actual primitive tokens from this structured write. */
export function readSvgTextPaintWrite(value: SvgTextPaintWrite | undefined, source: object, svg: string): MarkPaint | undefined {
  return readActualTextPaintWrite(value, source, svg)
}
export function matchesSvgTextPaintWrite(value: SvgTextPaintWrite | undefined, capture: SvgXmlCapture, write: SvgXmlWrite | undefined, source: object, svg: string): boolean {
  return matchesActualTextPaintWrite(value, capture, write, source, svg)
}

/** A receipt from this actual geometry write, never from cached markup.
 * Undefined served geometry means numeric spelling exceeded bounded custody. */
export type SvgGeometryWriteSink = ((source: Geometry, served: Geometry | undefined) => void) & {
  /** Bound to this operation's ledger; called before variable projection work. */
  readonly reserveProjection?: (source: Geometry, operations: number) => boolean
  /** One complete shape write's actual paint literals and transform presence.
   * Undefined means the bounded attribute receipt could not be retained. */
  readonly rectangleAttributes?: (source: ShapeMark, attributes: Readonly<Record<string, string>> | undefined) => void
  readonly textPaint?: (source: TextMark, fact: SvgTextPaintWrite | undefined) => void
}

interface WrittenLeafContext { readonly transformed: boolean }
const writtenLeafContexts = new WeakMap<object, { readonly svg: string; readonly context: WrittenLeafContext | undefined }>()

/** Context only: the caller must own this exact source and pay the actual
 * string comparison. No geometry, cached-write or occurrence authority follows. */
export function writtenLeafContextOf(node: object, svg: string): WrittenLeafContext | undefined {
  const written = writtenLeafContexts.get(node)
  return written?.svg === svg ? written.context : undefined
}

/** One append-only writer for a mark. Attribute emission does not allocate
 * arrays, one-element spread operands, or temporary `name="value"` strings.
 * Numeric fields use the shared SVG spelling at this write boundary. */
class SvgWriter {
  value = ''
  transformed = false
  observeAttributes?: (name: string, literal: string) => void
  observePaint?: (field: keyof MarkPaint, literal: string, escaped: unknown) => void
  readonly xml?: XmlLeafWrite

  constructor(capture?: SvgXmlCapture, text = false) {
    const state = capture && xmlCaptures.get(capture)
    if (state) { this.xml = new XmlLeafWrite(state); if (text) this.xml.element('text') }
  }

  element(name: string): void {
    const actual = `${name}`
    this.raw(`<${actual}`)
    this.xml?.element(actual)
  }

  raw(text: string): void { this.value += text }

  attribute(name: string, value: string | number, changedToken?: (offset: number, literal: string) => boolean | void, numericToken?: (literal: string, raw: string) => boolean | void, paintField?: keyof MarkPaint): string {
    const literal = typeof value === 'number' ? formatSvgNumber(value) : formatSvgNumericAttribute(name, value, changedToken, numericToken)
    const escaped = typeof value === 'number' ? literal : escapeAttr(literal)
    this.value += ` ${name}="${escaped}"`
    this.xml?.attribute(name, escaped)
    if (paintField !== undefined && this.observePaint) this.xml?.recordPaintField(paintField)
    if (name === 'transform') this.transformed = true
    this.observeAttributes?.(name, literal)
    if (paintField !== undefined) this.observePaint?.(paintField, literal, escaped)
    return literal
  }
  paintAttribute(field: keyof MarkPaint, name: string, value: string): void { this.attribute(name, value, undefined, undefined, field) }
}

/** `data-*` keys the writer derives from typed fields, or that the shared
 * text writer emits itself. */
export const WRITER_OWNED_DATA_KEYS: ReadonlySet<string> = new Set([
  'id', 'role', 'from', 'to', 'relationship', 'direction',
  'prepared-text', 'font-metrics', 'text-fragment', 'connector-label-for',
])
export const MARK_CLASS_TOKENS = /^[A-Za-z0-9_-]+(?: [A-Za-z0-9_-]+)*$/
export const MARK_DATA_KEY = /^[a-z][a-z0-9-]*$/

function hooks(out: SvgWriter, attributes: MarkAttributes | undefined): void {
  if (!attributes) return
  if (attributes.className) out.attribute('class', attributes.className)
  if (attributes.data) for (const key of Object.keys(attributes.data)) out.attribute(`data-${key}`, attributes.data[key]!)
  if (attributes.ariaHidden) out.attribute('aria-hidden', 'true')
  if (attributes.tabIndex === 0) out.attribute('tabindex', 0)
  if (attributes.ariaLabel !== undefined) out.attribute('aria-label', attributes.ariaLabel)
}

function paintAttributes(out: SvgWriter, paint: MarkPaint): void {
  if (paint.fill !== undefined) out.paintAttribute('fill', 'fill', paint.fill)
  if (paint.fillOpacity !== undefined) out.paintAttribute('fillOpacity', 'fill-opacity', paint.fillOpacity)
  if (paint.stroke !== undefined) out.paintAttribute('stroke', 'stroke', paint.stroke)
  if (paint.strokeOpacity !== undefined) out.paintAttribute('strokeOpacity', 'stroke-opacity', paint.strokeOpacity)
  if (paint.strokeWidth !== undefined) out.paintAttribute('strokeWidth', 'stroke-width', paint.strokeWidth)
  if (paint.strokeDasharray !== undefined) out.paintAttribute('strokeDasharray', 'stroke-dasharray', paint.strokeDasharray)
  if (paint.strokeDashoffset !== undefined) out.paintAttribute('strokeDashoffset', 'stroke-dashoffset', paint.strokeDashoffset)
  if (paint.strokeLinecap !== undefined) out.paintAttribute('strokeLinecap', 'stroke-linecap', paint.strokeLinecap)
  if (paint.strokeLinejoin !== undefined) out.paintAttribute('strokeLinejoin', 'stroke-linejoin', paint.strokeLinejoin)
  if (paint.strokeMiterlimit !== undefined) out.paintAttribute('strokeMiterlimit', 'stroke-miterlimit', paint.strokeMiterlimit)
  if (paint.vectorEffect !== undefined) out.paintAttribute('vectorEffect', 'vector-effect', paint.vectorEffect)
  if (paint.paintOrder !== undefined) out.paintAttribute('paintOrder', 'paint-order', paint.paintOrder)
  if (paint.opacity !== undefined) out.paintAttribute('opacity', 'opacity', paint.opacity)
}

function transformAttribute(out: SvgWriter, transform: SceneTransform | undefined): void {
  if (transform) out.attribute('transform', serializeTransform(transform))
}

/** Identity on the roles whose DOM contract carries it, then relation ARIA. */
function identityAttributes(out: SvgWriter, identity: SvgSemanticIdentity | undefined, accessibility: SvgSemanticAccessibility | undefined): void {
  if (identity && hasDomSvgIdentityRole(identity.role)) {
    out.attribute('data-id', identity.id)
    out.attribute('data-role', identity.role)
    if (identity.from !== undefined) out.attribute('data-from', identity.from)
    if (identity.to !== undefined) out.attribute('data-to', identity.to)
  }
  if (accessibility) {
    out.attribute('role', accessibility.role)
    out.attribute('aria-roledescription', accessibility.roleDescription)
    out.attribute('aria-label', accessibility.label)
  }
}

type ElementGeometry = Exclude<Geometry, { kind: 'compound' }> | Exclude<ConnectorMark['route']['geometry'], { kind: 'line' }> | { kind: 'line'; x1: number; y1: number; x2: number; y2: number }

function geometryAttributes(out: SvgWriter, geometry: ElementGeometry, sink?: SvgGeometryWriteSink): void {
  switch (geometry.kind) {
    case 'rect': {
      const rawX = geometry.x, x = out.attribute('x', rawX)
      const rawY = geometry.y, y = out.attribute('y', rawY)
      const rawWidth = geometry.width, width = out.attribute('width', rawWidth)
      const rawHeight = geometry.height, height = out.attribute('height', rawHeight)
      let rawRx: number | undefined, rawRy: number | undefined, rx: string | undefined, ry: string | undefined
      // Keep the optional fields' original conditional/read order, including
      // generic getter callers. The receipt retains only actual attribute reads.
      if (geometry.rx !== undefined) { rawRx = geometry.rx; rx = out.attribute('rx', rawRx) }
      if (geometry.ry !== undefined) { rawRy = geometry.ry; ry = out.attribute('ry', rawRy) }
      if (sink) sink(geometry, {
        kind: 'rect', x: Number(x), y: Number(y), width: Number(width), height: Number(height),
        ...(rx === undefined ? {} : { rx: Number(rx) }), ...(ry === undefined ? {} : { ry: Number(ry) }),
      })
      return
    }
    case 'circle':
      out.attribute('cx', geometry.cx)
      out.attribute('cy', geometry.cy)
      out.attribute('r', geometry.r)
      return
    case 'ellipse':
      out.attribute('cx', geometry.cx)
      out.attribute('cy', geometry.cy)
      out.attribute('rx', geometry.rx)
      out.attribute('ry', geometry.ry)
      return
    case 'line': {
      const rawX1 = geometry.x1, x1 = out.attribute('x1', rawX1)
      const rawY1 = geometry.y1, y1 = out.attribute('y1', rawY1)
      const rawX2 = geometry.x2, x2 = out.attribute('x2', rawX2)
      const rawY2 = geometry.y2, y2 = out.attribute('y2', rawY2)
      if (sink) sink(geometry, Number(x1) === rawX1 && Number(y1) === rawY1 && Number(x2) === rawX2 && Number(y2) === rawY2
        ? geometry : { kind: 'line', x1: Number(x1), y1: Number(y1), x2: Number(x2), y2: Number(y2) })
      return
    }
    case 'polygon':
    case 'polyline': {
      let points = ''
      const observed = geometry.kind === 'polyline' ? sink : undefined
      let pointCount = 0
      for (; pointCount < geometry.points.length; pointCount++) {
        const point = geometry.points[pointCount]!
        const x = `${point.x}`, y = `${point.y}`, prefix = pointCount ? ' ' : ''
        points += `${prefix}${x},${y}`
      }
      let tokens = 0, understood = true, changed = false, x = 0, rawX = 0
      let projected: ScenePoint[] | undefined, previous: ScenePoint | undefined
      let firstTangent: ScenePoint | undefined, lastTangent: ScenePoint | undefined
      let rawPrevious: ScenePoint | undefined, rawFirstTangent: ScenePoint | undefined, rawLastTangent: ScenePoint | undefined
      let rawX0 = Infinity, rawY0 = Infinity, rawX1 = -Infinity, rawY1 = -Infinity
      let rawStartX = 0, rawStartY = 0, rawEndX = 0, rawEndY = 0
      const literal = out.attribute('points', points, undefined, observed ? (literal, raw) => {
        if (tokens === 0) {
          const cost = pointCount * 48 + 128
          if (!Number.isSafeInteger(pointCount) || pointCount < 2 || !Number.isSafeInteger(cost) || !observed.reserveProjection?.(geometry, cost)) { understood = false; return false }
          projected = []
        }
        if (tokens >= pointCount * 2) { understood = false; return false }
        const value = Number(literal), original = Number(raw)
        if (!Number.isFinite(value) || !Number.isFinite(original)) { understood = false; return false }
        changed ||= value !== original
        if (tokens++ % 2 === 0) { x = value; rawX = original; return }
        const point = Object.freeze({ x, y: value })
        const rawPoint = Object.freeze({ x: rawX, y: original })
        Object.defineProperty(projected, tokens / 2 - 1, { value: point, enumerable: true, writable: false, configurable: false })
        if (previous) {
          const tangent = connectorUnitTangent(previous, point)
          if (tangent) { lastTangent = Object.freeze(tangent); firstTangent ??= lastTangent }
        }
        if (rawPrevious) {
          const tangent = connectorUnitTangent(rawPrevious, rawPoint)
          if (tangent) { rawLastTangent = Object.freeze(tangent); rawFirstTangent ??= rawLastTangent }
        }
        previous = point
        rawPrevious = rawPoint
        rawX0 = Math.min(rawX0, rawX); rawY0 = Math.min(rawY0, original)
        rawX1 = Math.max(rawX1, rawX); rawY1 = Math.max(rawY1, original)
        if (tokens === 2) { rawStartX = rawX; rawStartY = original }
        rawEndX = rawX; rawEndY = original
      } : undefined)
      if (observed) {
        let served: Geometry | undefined = literal === points ? geometry : undefined
        if (changed && understood && tokens === pointCount * 2 && projected?.length === pointCount) {
          Object.defineProperty(projected, 'length', { writable: false })
          Object.preventExtensions(projected)
          const contour = Object.freeze({ start: projected[0]!, end: projected.at(-1)!, closed: false,
            ...(firstTangent ? { startTangent: firstTangent } : {}), ...(lastTangent ? { endTangent: lastTangent } : {}) })
          served = createWrittenPolyline(projected, { contours: Object.freeze([contour]), collapsed: !firstTangent,
            rawBounds: Object.freeze({ x0: rawX0, y0: rawY0, x1: rawX1, y1: rawY1 }),
            rawStart: Object.freeze({ x: rawStartX, y: rawStartY }), rawEnd: Object.freeze({ x: rawEndX, y: rawEndY }),
            ...(rawFirstTangent ? { rawStartTangent: rawFirstTangent } : {}), ...(rawLastTangent ? { rawEndTangent: rawLastTangent } : {}) })
        }
        observed(geometry, served)
      }
      return
    }
    case 'path': {
      const raw = geometry.d, literal = out.attribute('d', raw)
      sink?.(geometry, literal === raw ? geometry : { kind: 'path', d: literal })
    }
  }
}

/** Compound geometry writes one element per child, each with its own paint;
 * hooks, identity and ARIA go on the first. */
export function writeShapeSvg(node: ShapeMark, sink?: SvgGeometryWriteSink): string
export function writeShapeSvg(node: ShapeMark, sink: SvgGeometryWriteSink | undefined, capture: SvgXmlCapture): SvgXmlWrite
export function writeShapeSvg(node: ShapeMark, sink?: SvgGeometryWriteSink, capture?: SvgXmlCapture): string | SvgXmlWrite {
  const out = new SvgWriter(capture)
  const compound = node.geometry.kind === 'compound'
  const pieces = node.geometry.kind === 'compound' ? node.geometry.children : [node.geometry]
  const report = compound ? undefined : sink?.rectangleAttributes
  const attributes: Record<string, string> | undefined = report ? Object.create(null) : undefined
  let attributeCount = 0, invalidAttributes = false
  const observe = attributes ? (name: string, literal: string): void => {
    if (++attributeCount > 14 || Object.hasOwn(attributes, name)) { invalidAttributes = true; return }
    attributes[name] = literal
  } : undefined
  for (let index = 0; index < pieces.length; index++) {
    const piece = pieces[index]!
    if (piece.kind === 'compound') throw new TypeError(`Shape "${node.id}" nests compound geometry`)
    if (index) out.raw('\n')
    out.element(piece.kind)
    if (index === 0) hooks(out, node.attributes)
    geometryAttributes(out, piece, sink)
    // Only the13 paint fields and one transform can enter this receipt.
    // Data/identity hooks stay outside the observed writer phase entirely.
    out.observeAttributes = observe
    paintAttributes(out, compound ? node.childPaints?.[index] ?? node.paint : node.paint)
    transformAttribute(out, node.transform)
    out.observeAttributes = undefined
    if (index === 0) identityAttributes(out, node.identity, node.accessibility)
    out.raw(' />')
  }
  report?.(node, invalidAttributes ? undefined : Object.freeze(attributes!))
  writtenLeafContexts.set(node, { svg: out.value, context: Object.freeze({ transformed: out.transformed }) })
  return capture ? finishXmlLeaf(capture, node, out.value, out.xml) : out.value
}

function typographyAttributes(out: SvgWriter, node: TextMark): void {
  out.attribute('text-anchor', node.anchor)
  if (node.dominantBaseline) out.attribute('dominant-baseline', node.dominantBaseline)
  // A block measured in a named face is drawn in it; otherwise the document font applies.
  if (node.block?.fontFamily) out.attribute('font-family', node.block.fontFamily)
  out.attribute('font-size', node.fontSize)
  out.attribute('font-weight', node.fontWeight ?? node.block?.fontWeight ?? 400)
  if ((node.letterSpacing ?? 0) !== 0) out.attribute('letter-spacing', node.letterSpacing!)
  if (node.fontStyle) out.attribute('font-style', node.fontStyle)
  if (node.textDecoration) out.attribute('text-decoration', node.textDecoration)
}

/** Text goes through the shared multi-line writer, which owns line wrappers,
 * prepared runs and fitted advances. A fallback-measured mark is written from
 * its source text, as families wrote unprepared labels. */
export function writeTextSvg(node: TextMark): string
export function writeTextSvg(node: TextMark, capture: SvgXmlCapture, sink?: SvgGeometryWriteSink): SvgXmlWrite
export function writeTextSvg(node: TextMark, capture?: SvgXmlCapture, sink?: SvgGeometryWriteSink): string | SvgXmlWrite {
  const out = new SvgWriter(capture, true)
  hooks(out, node.attributes)
  typographyAttributes(out, node)
  const report = capture && sink?.textPaint
  const state = report && xmlCaptures.get(capture!)
  let inheritedPaint = false
  let paintReceiver: MarkPaint
  if (state) out.observePaint = field => {
    if (!state.pay(2)) return
    if (!textPaintHasOwn(paintReceiver, field)) inheritedPaint = true
  }
  paintAttributes(out, paintReceiver = node.paint)
  out.observePaint = undefined
  transformAttribute(out, node.transform)
  identityAttributes(out, node.identity, node.accessibility)
  const attrs = capture ? xmlRange(out.value, 1) : out.value.slice(1)
  const prepared = node.measurement === 'prepared' && node.block
  let observed = false
  const svg = renderMultilineText(prepared ? node.block! : node.text, node.x, node.y, node.fontSize, attrs, node.baselineShift ?? 0.35, node.display === 'literal', out.xml ? written => {
    observed = true
    out.xml!.prepared(written)
    if (report) out.xml!.markPaintPrepared(written)
  } : undefined, node.anchor)
  if (!node.spans) {
    if (!capture) return svg
    const write = finishXmlLeaf(capture, node, svg, out.xml, observed, undefined, report ? out.xml : undefined)
    if (report) {
      const fact = state!.pay(2)
        ? new ActualTextPaintWrite(textPaintIssuer, capture, write, node, svg, observed ? out.xml : undefined, inheritedPaint) : undefined
      report(node, fact)
    }
    return write
  }
  const shown = prepared ? node.block!.text : node.text
  const content = `>${escapeXml(shown)}</text>`
  if (!svg.endsWith(content)) throw new TypeError(`Text "${node.id}" spans require a one-line label`)
  let spans = ''
  for (const span of node.spans) spans += `<tspan fill="${escapeAttr(span.fill)}">${escapeXml(span.text)}</tspan>`
  const written = `${svg.slice(0, -content.length)}>${spans}</text>`
  if (!capture) return written
  const write = capture.raw(written, node)
  if (report) report(node, state!.pay(2) ? new ActualTextPaintWrite(textPaintIssuer, capture, write, node, written, undefined, inheritedPaint) : undefined)
  return write
}

function connectorInlineLabelSvg(node: ConnectorMark, label: ConnectorLabelDescriptor, index: number, capture?: SvgXmlCapture): { svg: string; transformed: boolean; xml?: XmlLeafWrite; complete: boolean } | undefined {
  if (label.visual?.kind !== 'inline') return undefined
  if (!label.anchor || !label.paint || label.fontSize === undefined || label.textAnchor === undefined) {
    throw new TypeError(`Connector "${node.id}" inline label ${index + 1} requires anchor, paint, fontSize, and textAnchor`)
  }
  const block = connectorInlineLabelText(label)
  const paint: MarkPaint = {
    ...label.paint,
    ...(label.halo ? {
      stroke: label.halo.color ?? 'var(--bg)',
      strokeWidth: String(label.halo.width),
      paintOrder: 'stroke fill',
    } : {}),
  }
  const out = new SvgWriter(capture, true)
  out.attribute('data-id', label.id ?? `${node.id}-label-${index + 1}`)
  out.attribute('data-role', 'label')
  out.attribute('data-connector-label-for', node.id)
  out.attribute('font-size', block.fontSize)
  out.attribute('font-weight', block.fontWeight)
  if (block.letterSpacing) out.attribute('letter-spacing', block.letterSpacing)
  out.attribute('text-anchor', label.textAnchor)
  transformAttribute(out, node.transform)
  paintAttributes(out, paint)
  let complete = false
  const svg = renderMultilineText(block, label.anchor.x, label.anchor.y - Math.max(0, label.clearance ?? 0), block.fontSize, capture ? xmlRange(out.value, 1) : out.value.slice(1), 0, false, out.xml ? written => {
    complete = true
    out.xml!.prepared(written)
  } : undefined, label.textAnchor)
  return { svg, transformed: out.transformed, xml: out.xml, complete }
}

/** A connector is one marker carrier element plus any labels it owns; an
 * invisible connector draws its labels without the carrier. SVG defaults
 * (butt caps, miter joins, limit 4) are left implicit. */
export function writeConnectorSvg(node: ConnectorMark, sink?: SvgGeometryWriteSink): string
export function writeConnectorSvg(node: ConnectorMark, sink: SvgGeometryWriteSink | undefined, capture: SvgXmlCapture): SvgXmlWrite
export function writeConnectorSvg(node: ConnectorMark, sink?: SvgGeometryWriteSink, capture?: SvgXmlCapture): string | SvgXmlWrite {
  const out = new SvgWriter(capture)
  const inline = out.xml?.list<XmlLeafWrite>()
  let complete = !capture || inline !== undefined
  const { stroke, markers } = node
  const dash = stroke.dash
  const midMarker = markers.mid[0]
  if (node.lineStyle !== 'invisible') {
    const geometry = node.route.geometry
    out.element(geometry.kind)
    hooks(out, node.attributes)
    geometryAttributes(out, geometry, sink)
    if (geometry.kind !== 'line') out.attribute('fill', 'none')
    out.attribute('stroke', stroke.color)
    if (stroke.opacity !== undefined) out.attribute('stroke-opacity', stroke.opacity)
    out.attribute('stroke-width', stroke.width)
    if (dash) out.attribute('stroke-dasharray', typeof dash.array === 'string' ? dash.array : dash.array.join(' '))
    if (dash?.offset !== undefined) out.attribute('stroke-dashoffset', dash.offset)
    if (stroke.lineCap !== 'butt') out.attribute('stroke-linecap', stroke.lineCap)
    if (stroke.lineJoin !== 'miter') out.attribute('stroke-linejoin', stroke.lineJoin)
    if (stroke.miterLimit !== 4) out.attribute('stroke-miterlimit', stroke.miterLimit)
    if (stroke.pathLength !== undefined) out.attribute('pathLength', stroke.pathLength)
    if (stroke.paintOrder !== undefined) out.attribute('paint-order', stroke.paintOrder)
    if (stroke.nonScaling) out.attribute('vector-effect', 'non-scaling-stroke')
    if (stroke.mixBlendMode) out.attribute('style', `mix-blend-mode:${stroke.mixBlendMode}`)
    if (markers.start) out.attribute('marker-start', `url(#${markers.start.id})`)
    if (midMarker) out.attribute('marker-mid', `url(#${midMarker.id})`)
    if (markers.end) out.attribute('marker-end', `url(#${markers.end.id})`)
    if (node.hit.pointerEvents === 'none') out.attribute('pointer-events', 'none')
    transformAttribute(out, node.transform)
    out.attribute('data-relationship', node.relationship.kind)
    out.attribute('data-direction', node.relationship.direction)
    identityAttributes(out, node.identity, node.accessibility)
    out.raw(' />')
  }
  for (let index = 0; index < node.labels.length; index++) {
    const label = connectorInlineLabelSvg(node, node.labels[index]!, index, capture)
    if (label !== undefined) {
      if (capture) { complete &&= label.complete && label.xml !== undefined; if (label.xml && inline) inline[inline.length++] = label.xml }
      if (out.value) out.raw('\n')
      out.raw(label.svg)
      out.transformed ||= label.transformed
    }
  }
  writtenLeafContexts.set(node, { svg: out.value, context: Object.freeze({ transformed: out.transformed }) })
  return capture ? finishXmlLeaf(capture, node, out.value, out.xml, complete, inline!) : out.value
}

/** Path for a header band with rounded top corners and a square bottom. */
export function topRoundedRectPath(x: number, y: number, width: number, height: number, radius: number): string {
  const r = clampRadius(radius, width / 2, height)
  if (r === 0) return `M${x},${y} H${x + width} V${y + height} H${x} Z`

  return [
    `M${x + r},${y}`,
    `H${x + width - r}`,
    `A${r},${r} 0 0 1 ${x + width},${y + r}`,
    `V${y + height}`,
    `H${x}`,
    `V${y + r}`,
    `A${r},${r} 0 0 1 ${x + r},${y}`,
    'Z',
  ].join(' ')
}


function clampRadius(radius: number, maxX: number, maxY: number): number {
  return Math.max(0, Math.min(radius, maxX, maxY))
}
