import { retainWrittenFields, retainTextAttributes, writeTextOpening, writerEvidenceEnabled } from '../svg-writer-evidence.ts'
// ============================================================================
// The default backend's SVG writer: each shape, text and connector mark's
// element is written from its typed fields, so paint certification, which
// reads those fields, describes the bytes a render emits. Families supply
// inert hooks (classes, data-*) through `attributes`; geometry, paint,
// typography, transforms, markers, identity and ARIA come from the mark.
// ============================================================================

import type { ConnectorLabelDescriptor, ConnectorMark, Geometry, ImageMark, MarkAttributes, MarkPaint, ScenePoint, SceneTransform, ShapeMark, TextMark } from './ir.ts'
import type { SvgSemanticIdentity } from './identity.ts'
import type { SvgSemanticAccessibility } from './accessibility.ts'
import { hasDomSvgIdentityRole } from './identity.ts'
import { serializeTransform } from './transforms.ts'
import { connectorInlineLabelText } from './bounds.ts'
import { escapeAttr, escapeXml, renderMultilineText, type PreparedSingleLineWrite } from '../multiline-utils.ts'
import { formatSvgNumber, formatSvgNumericAttribute } from '../shared/svg-number.ts'
import { connectorUnitTangent } from './connector-geometry.ts'
import { createWrittenPolyline, createActualWrittenPolyline, rectanglePaintFields, type WrittenPolylineProjection } from './written-geometry.ts'
import { indentLines } from './serialization.ts'
import { verifySvgDocumentEnvelope, verifySvgDocumentDataPositions } from '../output-security.ts'
import { isInlinePng } from '../shared/inline-png.ts'
import { SCENE_VALIDATION_LIMITS } from './scene-validation-limits.ts'
import { MAX_OCCLUSION_OPERATIONS } from './paint-work.ts'
import { nativeGroupOpeningOf, validatePlainNativeGroup, validateWrittenNativeGroup } from './group-emission.ts'

// Fresh written facts must be sealed before ambient hooks can observe them.
const writtenFactFreeze = Object.freeze, writtenFactDefine = Object.defineProperty, writtenFactSeal = Object.preventExtensions
const writtenFactDescriptor = Object.getOwnPropertyDescriptor, writtenFactOwn = Object.hasOwn
const writtenFactKeys = Reflect.ownKeys, writtenFactExtensible = Object.isExtensible
function closedWrittenSlot(value: object, key: string, expected: unknown): boolean {
  const slot = writtenFactDescriptor(value, key)
  return !!slot && writtenFactOwn(slot, 'value') && slot.value === expected && slot.writable === false && slot.configurable === false
}
const xmlFactMap = WeakMap, xmlFactApply = Reflect.apply
const xmlFactGet = WeakMap.prototype.get, xmlFactSet = WeakMap.prototype.set

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
  /** Source-bound plain group syntax; every actual child still closes late. */
  group(writes: Iterable<SvgXmlWrite>, parsed: unknown, separator?: string): SvgXmlWrite
  indent(write: SvgXmlWrite, spaces: number): SvgXmlWrite
  /** Identity and actual bytes only; exhaustion cannot discard emitted output. */
  read(write: SvgXmlWrite, expectedNode?: object): SvgXmlWriteRecord | undefined
  /** Fresh envelope verification binds occupied DATA positions to this actual tree. */
  verify(write: SvgXmlWrite): boolean
}
interface XmlList<T> { length: number; [index: number]: T }
function xmlList<T>(): XmlList<T> { return { __proto__: null, length: 0 } as XmlList<T> }
interface XmlProjection { readonly skeleton: string; readonly occupied: Readonly<ArrayLike<number>> }
const EMPTY_XML_OCCUPIED = { __proto__: null, length: 0 } as Readonly<ArrayLike<number>>
const OCCUPIED_XML_LEAF: XmlProjection = { skeleton: ' ', occupied: { __proto__: null, 0: 0, length: 1 } as Readonly<ArrayLike<number>> }
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
  readonly nativeComposition: boolean
  pay(operations: number): boolean
  literal(value: string, attribute: boolean): boolean
  name(value: string): boolean
  prepared(): boolean
  project(write: SvgXmlWrite): boolean
  issue(svg: string, skeleton: string | (() => XmlProjectionResult), node?: object, groupOpening?: WrittenGroupOpening): SvgXmlWrite
}
// The actual handle is also its immutable read record. Only this private
// registry owns the lazy validation state; caller hooks never see its entries.
const xmlSlot = { __proto__: null, value: undefined as unknown, enumerable: true, writable: false, configurable: false }
function pinXmlSlot(target: object, key: string, value: unknown): void {
  xmlSlot.value = value
  try { writtenFactDefine(target, key, xmlSlot) } finally { xmlSlot.value = undefined }
}
interface WrittenRectangle {
  readonly source: Geometry
  readonly x: number; readonly y: number; readonly width: number; readonly height: number
  readonly rx: number | undefined; readonly ry: number | undefined
  readonly attributes: Record<string, string>
  count: number
  valid: boolean
}
interface WrittenGeometry { readonly source: Geometry; served: Geometry | undefined; valid: boolean; received: boolean; reserved: boolean; projection?: WrittenPolylineProjection }
interface XmlWriteFact {
  readonly capture: SvgXmlCapture
  readonly record: SvgXmlWriteRecord
  projection: string | (() => XmlProjectionResult) | XmlProjection | undefined
  geometry?: ActualGeometryWrite
  readonly groupOpening?: WrittenGroupOpening
}
interface WrittenGroupOpening { readonly parsed: unknown; readonly node: object; readonly record: SvgXmlWriteRecord }
// This occurrence's producer appends its private primitive source, never a
// field subsequently returned by an interposed record-construction helper.
function actualXmlSource(fact: XmlWriteFact): string { return fact.record.svg }
const xmlCaptures = new xmlFactMap<SvgXmlCapture, XmlCaptureState>()
const xmlWrites = new xmlFactMap<SvgXmlWrite, XmlWriteFact>()
function xmlCaptureState(capture: SvgXmlCapture): XmlCaptureState | undefined { return xmlFactApply(xmlFactGet, xmlCaptures, [capture]) }
/** Native owns this allowance; no caller-dispatched work callback participates
 * in its late composition. Generic captures keep their original callback path. */
export function createNativeXmlWork(maxOperations: number) {
  if (!Number.isSafeInteger(maxOperations) || maxOperations < 0 || maxOperations > MAX_OCCLUSION_OPERATIONS) throw new RangeError('Invalid Native emission work allowance')
  let operations = 0, exhausted = false
  const pay = (count = 1): boolean => {
    if (exhausted) return false
    if (!Number.isSafeInteger(count) || count < 0 || count > maxOperations - operations) { exhausted = true; return false }
    operations += count
    return true
  }
  return { pay, operations: () => operations, exhausted: () => exhausted, capture: () => createXmlCapture(pay, true) }
}

export function createSvgXmlCapture(work: (operations: number) => boolean): SvgXmlCapture { return createXmlCapture(work, false) }

function createXmlCapture(work: (operations: number) => boolean, nativeComposition: boolean): SvgXmlCapture {
  const names = new Map<string, boolean>(), attributes = new Map<string, boolean>(), texts = new Map<string, boolean>()
  let exhausted = false
  const pay = (count: number): boolean => {
    // The private Native meter already validates and admits this exact count.
    // Foreign callbacks retain the capture's independent count admission.
    if (exhausted || !nativeComposition && (!Number.isSafeInteger(count) || count < 0) || work(count) !== true) { exhausted = true; return false }
    return true
  }
  let capture: SvgXmlCapture
  const issue = (svg: string, projection: string | (() => XmlProjectionResult), node?: object, groupOpening?: WrittenGroupOpening): SvgXmlWrite => {
    const funded = pay(1)
    const record = groupOpening?.record ?? { __proto__: null, svg, node } as SvgXmlWriteRecord
    if (!groupOpening) {
      pinXmlSlot(record, 'svg', svg); pinXmlSlot(record, 'node', node)
      writtenFactSeal(record)
    }
    const write = record as unknown as SvgXmlWrite
    xmlFactApply(xmlFactSet, xmlWrites, [write, { capture, record, projection: funded && typeof svg === 'string' ? projection : undefined, groupOpening }])
    return write
  }
  const factOf = (write: SvgXmlWrite): XmlWriteFact | undefined => {
    pay(1)
    if (write === null || typeof write !== 'object') return undefined
    const fact = xmlFactApply(xmlFactGet, xmlWrites, [write]) as XmlWriteFact | undefined
    return fact?.capture === capture && (fact.record as object) === write ? fact : undefined
  }
  // Raw fragments and separators remain verbatim. The final parser owns
  // token boundaries across chunks; every substituted typed leaf must land
  // in parsed DATA, never inside a tag, attribute, comment or reference.
  const projectFact = (fact: XmlWriteFact): XmlProjection | undefined => {
    if (!pay(2)) return undefined
    const pending = fact.projection
    if (typeof pending === 'object' || pending === undefined) return pending
    const projected = typeof pending === 'string' ? pending : pending()
    if (projected === undefined || exhausted) return undefined
    return fact.projection = typeof projected === 'string'
      ? { skeleton: projected, occupied: EMPTY_XML_OCCUPIED } : projected
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
  const compose = (writes: Iterable<SvgXmlWrite>, separator = '\n', group?: unknown): SvgXmlWrite => {
      if (typeof separator !== 'string') throw new TypeError('XML joins require a string separator')
      const children = pay(1) ? xmlList<XmlWriteFact>() : undefined
      let svg = '', count = 0
      for (const write of writes) {
        const found = factOf(write)
        if (!found) throw new TypeError('XML composition requires this capture’s actual writes')
        if (count++) svg += separator
        svg += actualXmlSource(found)
        if (children) children[children.length++] = found
      }
      return issue(svg, children ? () => {
        if (!pay(1)) return undefined
        let whitespace = nativeComposition
        if (whitespace) {
          if (!pay(separator.length + 1)) return undefined
          for (let i = 0; i < separator.length; i++) {
            const character = separator[i]!
            if (character !== ' ' && character !== '\t' && character !== '\r' && character !== '\n') { whitespace = false; break }
          }
        }
        const opening = children.length ? children[0]!.groupOpening : undefined
        if (group && whitespace && children.length >= 2 && actualXmlSource(children[children.length - 1]!) === '</g>'
          && (opening?.parsed === group && opening.record === children[0]!.record && opening.node === opening.record.node
            ? validateWrittenNativeGroup(group, opening.node, value => literal(value, true), pay)
            : validatePlainNativeGroup(group, actualXmlSource(children[0]!), value => literal(value, true), pay))) {
          let closed = true
          for (let index = 1; index < children.length - 1; index++) {
            const child = projectFact(children[index]!)
            if (!child) return undefined
            if (child !== OCCUPIED_XML_LEAF) closed = false
          }
          if (closed && pay(4)) return OCCUPIED_XML_LEAF
        }
        const occupied = xmlList<number>()
        let skeleton = '', previousOccupied = false
        for (let i = 0; i < children.length; i++) {
          const checked = projectFact(children[i]!)
          if (!checked) return undefined
          if (whitespace && previousOccupied && checked === OCCUPIED_XML_LEAF) continue
          if (i) skeleton += separator
          for (let j = 0; j < checked.occupied.length; j++) {
            if (!pay(1)) return undefined
            occupied[occupied.length++] = skeleton.length + checked.occupied[j]!
          }
          skeleton += checked.skeleton
          previousOccupied = checked === OCCUPIED_XML_LEAF
        }
        if (!pay(children.length + skeleton.length + occupied.length + 2)) return undefined
        if (nativeComposition && previousOccupied && occupied.length === 1 && skeleton === ' ') return OCCUPIED_XML_LEAF
        return { skeleton, occupied }
      } : svg)
  }
  capture = { __proto__: null,
    raw(svg: string, node?: object): SvgXmlWrite {
      if (typeof svg !== 'string') throw new TypeError('XML raw chunks require a string')
      return issue(svg, svg, node)
    },
    join(writes: Iterable<SvgXmlWrite>, separator = '\n'): SvgXmlWrite { return compose(writes, separator) },
    group(writes: Iterable<SvgXmlWrite>, parsed: unknown, separator = '\n'): SvgXmlWrite { return compose(writes, separator, parsed) },
    indent(write: SvgXmlWrite, spaces: number): SvgXmlWrite {
      const found = factOf(write)
      if (!found) throw new TypeError('XML indentation requires this capture’s actual write')
      if (spaces <= 0) return write
      const firstSvg = actualXmlSource(found)
      if (firstSvg === '') return write
      if (typeof spaces !== 'number' || spaces === 1 / 0 || spaces > MAX_OCCLUSION_OPERATIONS) { const svg = indentLines(actualXmlSource(found), spaces); return issue(svg, svg) }
      // Primitive numeric indentation is private construction. Generic values,
      // nonfinite errors and padding beyond the proof allowance keep the
      // established helper path, whose exact actual result remains raw.
      const padding = spaces !== spaces ? 0 : spaces - spaces % 1
      let pad = '', svg = '', start = 0
      for (let i = 0; i < padding; i++) pad += ' '
      svg = pad
      if (typeof firstSvg === 'string') {
        // A primitive packet is stable: one LF scan can append whole spans.
        for (let i = 0; i < firstSvg.length; i++) if (firstSvg[i] === '\n') {
          svg += xmlRange(firstSvg, start, i + 1) + pad; start = i + 1
        }
        svg += start === 0 ? firstSvg : xmlRange(firstSvg, start)
      } else {
        // Generic indentation helpers can return non-string operands. Keep
        // their original repeated length/index/coercion observations.
        for (let i = 0; i < found.record.svg.length; i++) {
          const character = found.record.svg[i]!
          svg += character
          if (character === '\n') svg += pad
        }
      }
      return issue(svg, () => {
        if (!pay(1)) return undefined
        const checked = projectFact(found)
        // Indentation cannot move a whole closed leaf out of DATA. Keep its
        // canonical insertion witness instead of copying padding and offsets.
        if (nativeComposition && checked === OCCUPIED_XML_LEAF) return checked
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
        return { skeleton, occupied }
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
        : verifySvgDocumentEnvelope(actualXmlSource(found), pay)
    },
  } as unknown as SvgXmlCapture
  pinXmlSlot(capture, 'raw', capture.raw); pinXmlSlot(capture, 'join', capture.join); pinXmlSlot(capture, 'group', capture.group)
  pinXmlSlot(capture, 'indent', capture.indent); pinXmlSlot(capture, 'read', capture.read); pinXmlSlot(capture, 'verify', capture.verify)
  writtenFactSeal(capture)
  xmlFactApply(xmlFactSet, xmlCaptures, [capture, { nativeComposition, pay, literal, name, prepared, issue, project(write: SvgXmlWrite) {
    const found = factOf(write)
    return !!found && projectFact(found) !== undefined
  } } satisfies XmlCaptureState])
  return capture
}

/** Internal Native group producer. A generic/raw opening retains its original
 * byte-comparison path; only this private lexer source can issue this fact. */
export function writeNativeGroupOpening(capture: SvgXmlCapture, node: object, parsed: unknown): SvgXmlWrite | undefined {
  const state = xmlCaptureState(capture)
  if (!state?.nativeComposition) return undefined
  const source = nativeGroupOpeningOf(parsed, node, state.pay)
  if (source === undefined || !state.pay(10)) return undefined
  const record = { __proto__: null, svg: source, node } as SvgXmlWriteRecord
  const readSource = () => source, readNode = () => node
  // A helper can observe the complete record, but cannot substitute the
  // primitive held by either getter. Verify getter identity, not source bytes.
  writtenFactDefine(record, 'svg', { __proto__: null, get: readSource, enumerable: true, configurable: false } as PropertyDescriptor)
  writtenFactDefine(record, 'node', { __proto__: null, get: readNode, enumerable: true, configurable: false } as PropertyDescriptor)
  writtenFactSeal(record)
  if (writtenFactExtensible(record) || writtenFactKeys(record).length !== 2) return undefined
  const svgSlot = writtenFactDescriptor(record, 'svg'), nodeSlot = writtenFactDescriptor(record, 'node')
  if (!svgSlot || svgSlot.get !== readSource || svgSlot.set !== undefined || svgSlot.configurable
    || !nodeSlot || nodeSlot.get !== readNode || nodeSlot.set !== undefined || nodeSlot.configurable) return undefined
  return state.issue(source, source, node, { parsed, node, record })
}

function finishXmlLeaf(capture: SvgXmlCapture, node: object, svg: string, xml: XmlLeafWrite | undefined, eligible = true, additional?: Readonly<ArrayLike<XmlLeafWrite>>, completion?: XmlLeafWrite): SvgXmlWrite {
  const state = xmlCaptureState(capture)
  if (!state) throw new TypeError('Unknown XML capture')
  // Empty output cannot insert a delimiter between adjacent raw text spans.
  const write = state.issue(svg, svg && eligible && xml ? () => {
    let valid = xml.check()
    for (let i = 0; valid && additional && i < additional.length; i++) valid = additional[i]!.check()
    if (valid && completion) markXmlLeafComplete(completion)
    return valid ? OCCUPIED_XML_LEAF : svg
  } : svg, node)
  const rectangle = xml && XmlLeafWrite.rectangle(xml)
  const geometry = xml && XmlLeafWrite.geometry(xml)
  if (rectangle || geometry) {
    const fact = xmlFactApply(xmlFactGet, xmlWrites, [write]) as XmlWriteFact | undefined
    if (fact) fact.geometry = new ActualGeometryWrite(geometryWriteIssuer, capture, write, node, xml!)
  }
  return write
}

const geometryWriteIssuer = { __proto__: null }
/** This handle contains actual writer data, not caller-sealed metadata. Its
 * discoverable constructor cannot issue geometry for another occurrence. */
class ActualGeometryWrite {
  readonly #capture: SvgXmlCapture
  readonly #write: SvgXmlWrite
  readonly #node: object
  readonly #xml: XmlLeafWrite
  constructor(issuer: object, capture: SvgXmlCapture, write: SvgXmlWrite, node: object, xml: XmlLeafWrite) {
    if (issuer !== geometryWriteIssuer) throw new TypeError('Actual geometry requires its writer')
    this.#capture = capture; this.#write = write; this.#node = node; this.#xml = xml
  }
  static geometry(value: unknown, capture: SvgXmlCapture, write: SvgXmlWrite | undefined, node: object, source: Geometry): Geometry | undefined {
    if (!value || typeof value !== 'object' || !(#capture in value) || value.#capture !== capture || value.#write !== write || value.#node !== node) return undefined
    const actual = XmlLeafWrite.geometry(value.#xml)
    return actual?.valid && actual.received && actual.source === source ? actual.served : undefined
  }
  static projection(value: unknown, capture: SvgXmlCapture, write: SvgXmlWrite | undefined, node: object, source: Geometry): WrittenPolylineProjection | undefined {
    if (!value || typeof value !== 'object' || !(#capture in value) || value.#capture !== capture || value.#write !== write || value.#node !== node) return undefined
    const actual = XmlLeafWrite.geometry(value.#xml)
    return actual?.valid && actual.received && actual.source === source && actual.projection ? { contours: actual.projection.contours, collapsed: actual.projection.collapsed } : undefined
  }
  static rectangle(value: unknown, capture: SvgXmlCapture, write: SvgXmlWrite | undefined, node: object, source: Geometry): Extract<Geometry, { kind: 'rect' }> | undefined {
    if (!value || typeof value !== 'object' || !(#capture in value) || value.#capture !== capture || value.#write !== write || value.#node !== node) return undefined
    const actual = XmlLeafWrite.rectangle(value.#xml)
    if (!actual?.valid || actual.source !== source) return undefined
    return { kind: 'rect', x: actual.x, y: actual.y, width: actual.width, height: actual.height,
      ...(actual.rx === undefined ? {} : { rx: actual.rx }), ...(actual.ry === undefined ? {} : { ry: actual.ry }) }
  }
  static matches(value: unknown, capture: SvgXmlCapture, write: SvgXmlWrite | undefined, node: object, source: Geometry, served: Extract<Geometry, { kind: 'rect' }>, paint: MarkPaint, pay: (operations: number) => boolean): boolean {
    if (!value || typeof value !== 'object' || !(#capture in value) || value.#capture !== capture || value.#write !== write || value.#node !== node) return false
    const actual = XmlLeafWrite.rectangle(value.#xml)
    if (!actual?.valid || actual.source !== source || !pay(16)) return false
    if (served.kind !== 'rect' || served.x !== actual.x || served.y !== actual.y || served.width !== actual.width || served.height !== actual.height || served.rx !== actual.rx || served.ry !== actual.ry || actual.attributes.transform !== undefined) return false
    let matched = 0
    for (const field of Object.keys(rectanglePaintFields) as (keyof MarkPaint)[]) {
      const expected = paint[field], literal = actual.attributes[rectanglePaintFields[field].attribute]
      if (!pay(4 + (expected?.length ?? 0) + (literal?.length ?? 0)) || literal !== expected) return false
      if (literal !== undefined) matched++
    }
    return actual.count === matched
  }
}
const actualWrittenProjection = ActualGeometryWrite.projection, actualWrittenGeometry = ActualGeometryWrite.geometry, actualWrittenRectangle = ActualGeometryWrite.rectangle, matchesWrittenRectangle = ActualGeometryWrite.matches
function geometryFact(write: SvgXmlWrite | undefined): unknown { return write && (xmlFactApply(xmlFactGet, xmlWrites, [write]) as XmlWriteFact | undefined)?.geometry }
export function readSvgGeometryProjection(capture: SvgXmlCapture, write: SvgXmlWrite | undefined, node: object, source: Geometry): WrittenPolylineProjection | undefined { return actualWrittenProjection(geometryFact(write), capture, write, node, source) }
export function readSvgGeometryWrite(capture: SvgXmlCapture, write: SvgXmlWrite | undefined, node: object, source: Geometry): Geometry | undefined { return actualWrittenGeometry(geometryFact(write), capture, write, node, source) }
export function readSvgRectangleWrite(capture: SvgXmlCapture, write: SvgXmlWrite | undefined, node: object, source: Geometry): Extract<Geometry, { kind: 'rect' }> | undefined { return actualWrittenRectangle(geometryFact(write), capture, write, node, source) }
export function matchesSvgRectangleWrite(capture: SvgXmlCapture, write: SvgXmlWrite | undefined, node: object, source: Geometry, served: Extract<Geometry, { kind: 'rect' }>, paint: MarkPaint, pay: (operations: number) => boolean): boolean { return matchesWrittenRectangle(geometryFact(write), capture, write, node, source, served, paint, pay) }

// These names reach the private writer only as module-owned literals.
type FixedXmlAttributeName = 'aria-hidden' | 'aria-label' | 'aria-roledescription' | 'class' | 'cx' | 'cy' | 'd' | 'data-connector-label-for' | 'data-direction' | 'data-from' | 'data-id' | 'data-relationship' | 'data-role' | 'data-to' | 'dominant-baseline' | 'fill' | 'fill-opacity' | 'font-family' | 'font-size' | 'font-style' | 'font-weight' | 'height' | 'href' | 'letter-spacing' | 'marker-end' | 'marker-mid' | 'marker-start' | 'opacity' | 'paint-order' | 'pathLength' | 'pointer-events' | 'points' | 'preserveAspectRatio' | 'r' | 'role' | 'rx' | 'ry' | 'stroke' | 'stroke-dasharray' | 'stroke-dashoffset' | 'stroke-linecap' | 'stroke-linejoin' | 'stroke-miterlimit' | 'stroke-opacity' | 'stroke-width' | 'style' | 'tabindex' | 'text-anchor' | 'text-decoration' | 'transform' | 'vector-effect' | 'width' | 'x' | 'x1' | 'x2' | 'y' | 'y1' | 'y2'
type XmlWriteEvent = readonly ['numeric-attribute', string, boolean] | readonly ['element', string] | readonly ['attribute' | 'fixed-attribute', string, string, (keyof MarkPaint)?] | readonly ['text', string] | readonly ['prepared', string, string, string, string, string]
function fixedAttributeBit(name: string): number {
  switch (name) {
    case 'x': return 1
    case 'y': return 2
    case 'dy': return 4
    case 'textLength': return 8
    case 'data-prepared-text': return 16
    case 'lengthAdjust': return 32
    case 'data-font-metrics': return 64
    case 'text-anchor': return 128
    case 'font-size': return 256
    case 'font-weight': return 512
    case 'data-id': return 1024
    case 'data-role': return 2048
    case 'fill': return 4096
    case 'stroke': return 8192
    case 'font-family': return 16384
    case 'class': return 32768
    case 'aria-label': return 65536
    case 'aria-hidden': return 131072
    case 'tabindex': return 262144
    case 'font-style': return 524288
    case 'text-decoration': return 1048576
    case 'dominant-baseline': return 2097152
    case 'letter-spacing': return 4194304
    case 'transform': return 8388608
    default: return 0
  }
}
class XmlLeafWrite {
  readonly #state: XmlCaptureState
  readonly #events: XmlList<XmlWriteEvent> | undefined
  valid = true
  #paintPrepared = false
  #complete = false
  #geometry: WrittenGeometry | undefined
  static geometry(xml: XmlLeafWrite): WrittenGeometry | undefined { return xml.#geometry }
  beginGeometry(source: Geometry): boolean {
    if (!this.#state.nativeComposition || !this.#state.pay(8)) return false
    this.#geometry = { source, served: undefined, valid: true, received: false, reserved: false }
    return true
  }
  reserveGeometry(source: Geometry, operations: number): boolean {
    const actual = this.#geometry
    if (!actual || actual.source !== source || actual.reserved) { if (actual) actual.valid = false; return false }
    actual.reserved = true
    return this.#state.pay(operations)
  }
  geometryWritten(source: Geometry, served: Geometry | undefined, projection?: WrittenPolylineProjection): void {
    const actual = this.#geometry
    if (!actual || actual.source !== source || actual.received) { if (actual) actual.valid = false; return }
    actual.received = true; actual.served = served; actual.projection = projection
  }
  #rectangle: WrittenRectangle | undefined
  #rectanglePhase = false
  static rectangle(xml: XmlLeafWrite): WrittenRectangle | undefined { return xml.#rectangle }
  retainRectangle(source: Geometry, x: string, y: string, width: string, height: string, rx: string | undefined, ry: string | undefined): void {
    if (!this.#state.nativeComposition || !this.#state.pay(24) || typeof x !== 'string' || typeof y !== 'string' || typeof width !== 'string' || typeof height !== 'string' || rx !== undefined && typeof rx !== 'string' || ry !== undefined && typeof ry !== 'string') return
    this.#rectangle = { source, x: +x, y: +y, width: +width, height: +height, rx: rx === undefined ? undefined : +rx, ry: ry === undefined ? undefined : +ry, attributes: { __proto__: null } as unknown as Record<string, string>, count: 0, valid: true }
  }
  numericPoints(value: string, valid: boolean): void {
    if (this.valid) { this.valid = this.#state.pay(1); if (this.valid) this.#events![this.#events!.length++] = ['numeric-attribute', 'points', valid] }
  }
  reserveScalarWork(operations: number): boolean { return this.#state.pay(operations) }
  rectanglePhase(active: boolean): void { this.#rectanglePhase = active }
  rectangleAttribute(name: string, literal: string, escaped: unknown): void {
    const actual = this.#rectangle
    if (!this.#rectanglePhase || !actual || !actual.valid) return
    if (!this.#state.pay(2) || ++actual.count > 14 || actual.attributes[name] !== undefined || literal !== escaped) { actual.valid = false; return }
    actual.attributes[name] = literal
  }
  static markComplete(xml: XmlLeafWrite): void { xml.#complete = true }
  static completed(xml: XmlLeafWrite | undefined): boolean { return xml !== undefined && xml.#complete }
  constructor(state: XmlCaptureState) { this.#state = state; this.valid = state.pay(1); this.#events = this.valid ? xmlList() : undefined }
  list<T>(): XmlList<T> | undefined { return this.#state.pay(1) ? xmlList<T>() : undefined }
  element(name: string): void {
    if (this.valid) { this.valid = this.#state.pay(1); if (this.valid) this.#events![this.#events!.length++] = ['element', name] }
  }
  attribute(name: string, escaped: unknown, fixed = false, numeric = false): void {
    if (this.valid) {
      this.valid = typeof escaped === 'string' && this.#state.pay(1)
      if (this.valid) this.#events![this.#events!.length++] = fixed && this.#state.nativeComposition && numeric
        ? ['numeric-attribute', name, true]
        : [fixed && this.#state.nativeComposition ? 'fixed-attribute' : 'attribute', name, escaped as string]
    }
  }
  recordPaintField(field: keyof MarkPaint): void {
    if (!this.valid) return
    this.valid = this.#state.pay(1)
    if (!this.valid) return
    const index = this.#events!.length - 1, event = this.#events![index]
    if (!event || event[0] !== 'attribute' && event[0] !== 'fixed-attribute' || event.length !== 3) { this.valid = false; return }
    this.#events![index] = [event[0], event[1], event[2], field]
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
      if ((event[0] === 'attribute' || event[0] === 'fixed-attribute') && event.length === 4) {
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
    let fixedNames = 0, preparedSeen = false
    for (let i = 0; i < this.#events!.length; i++) {
      const event = this.#events![i]!
      const attribute = event[0] === 'attribute' || event[0] === 'fixed-attribute' || event[0] === 'numeric-attribute'
      const bit = attribute && this.#state.nativeComposition ? fixedAttributeBit(event[1]) : 0
      // One fixed vocabulary bit replaces the two general Set operations.
      if (!this.#state.pay(bit ? 1 : 2)) return false
      if (event[0] === 'element') {
        attributes.clear()
        fixedNames = 0; preparedSeen = false
        const name = event[1]
        if (name !== 'rect' && name !== 'circle' && name !== 'ellipse' && name !== 'line' && name !== 'polygon' && name !== 'polyline' && name !== 'path' && name !== 'text') return false
      } else if (event[0] === 'attribute' || event[0] === 'fixed-attribute' || event[0] === 'numeric-attribute') {
        if (bit ? fixedNames & bit : attributes.has(event[1])) return false
        if (event[0] === 'numeric-attribute') {
          if (!event[2]) return false
          if (bit) fixedNames |= bit
          else attributes.add(event[1])
          continue
        }
        if (event[0] === 'attribute' && !this.#state.name(event[1]) || !this.#state.literal(event[2], true)) return false
        if (bit) fixedNames |= bit
        else attributes.add(event[1])
      } else if (event[0] === 'prepared') {
        if (!this.#state.prepared()) return false
        if (this.#state.nativeComposition) {
          // The multiline producer emitted these seven distinct fixed names.
          // The existing outer-attribute visit owns conflict discovery; only
          // the four actual variable literals and content still need checking.
          if (!this.#state.pay(2) || fixedNames & 127 || preparedSeen) return false
          preparedSeen = true
          fixedNames |= 127
          if (!this.#state.literal(event[1], true) || !this.#state.literal(event[2], true)
            || !this.#state.literal(event[3], true) || !this.#state.literal(event[4], true)
            || !this.#state.literal(event[5], false)) return false
          continue
        }
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
    return xmlCaptureState(capture)?.project(value.#write) === true && xmlLeafCompleted(value.#xml)
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
  private tagName?: string
  private start = 0
  private attributes: string[] | undefined = writerEvidenceEnabled() ? [] : undefined
  transformed = false
  ownedGeometry = false
  observeAttributes?: (name: string, literal: string) => void
  observePaint?: (field: keyof MarkPaint, literal: string, escaped: unknown) => void
  readonly xml?: XmlLeafWrite

  constructor(capture?: SvgXmlCapture, text = false) {
    const state = capture && xmlCaptureState(capture)
    if (state) {
      this.xml = new XmlLeafWrite(state)
      // The prepared multiline producer's opening name is the literal `text`.
      // This leaf has no earlier element or attributes to reset/revalidate.
      if (text && !state.nativeComposition) this.xml.element('text')
    }
  }

  element(name: string): void {
    const actual = `${name}`
    this.tagName = actual
    this.start = this.value.length
    this.attributes = writerEvidenceEnabled() ? [] : undefined
    this.raw(`<${actual}`)
    this.xml?.element(actual)
  }

  close(): void {
    this.value += ' />'
    if (this.tagName && this.attributes) retainWrittenFields(this.value.slice(this.start), this.tagName, this.attributes, true)
    this.tagName = undefined
  }

  textEvidence(text: string) { return this.attributes ? retainTextAttributes(text, this.attributes) : undefined }

  raw(text: string): void { this.value += text }

  attribute(name: string, value: string | number, changedToken?: (offset: number, literal: string) => boolean | void, numericToken?: (literal: string, raw: string) => boolean | void, paintField?: keyof MarkPaint, fixed = false): string {
    const literal = typeof value === 'number' ? formatSvgNumber(value) : formatSvgNumericAttribute(name, value, changedToken, numericToken)
    const escaped = typeof value === 'number' ? literal : escapeAttr(literal)
    this.attributes?.push(name, escaped)
    this.value += ` ${name}="${escaped}"`
    // The numeric producer spells primitive numbers with intrinsic ToString.
    // Its ASCII fact closes only XML syntax, never finite geometry or paint.
    // Paint observations retain their actual literal for the existing reader.
    this.xml?.attribute(name, escaped, fixed, typeof value === 'number' && paintField === undefined)
    this.xml?.rectangleAttribute(name, literal, escaped)
    if (paintField !== undefined && this.observePaint) this.xml?.recordPaintField(paintField)
    if (name === 'transform') this.transformed = true
    this.observeAttributes?.(name, literal)
    if (paintField !== undefined) this.observePaint?.(paintField, literal, escaped)
    return literal
  }
  numericPoints(value: string, valid: boolean): void {
    if (!valid) { this.fixedAttribute('points', value); return }
    this.attributes?.push('points', value)
    this.value += ` points="${value}"`
    this.xml?.numericPoints(value, valid)
  }
  fixedAttribute(name: FixedXmlAttributeName, value: string | number, changedToken?: (offset: number, literal: string) => boolean | void, numericToken?: (literal: string, raw: string) => boolean | void): string { return this.attribute(name, value, changedToken, numericToken, undefined, true) }
  paintAttribute(field: keyof MarkPaint, name: FixedXmlAttributeName, value: string): void { this.attribute(name, value, undefined, undefined, field, true) }
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
  if (attributes.className) out.fixedAttribute('class', attributes.className)
  if (attributes.data) for (const key of Object.keys(attributes.data)) out.attribute(`data-${key}`, attributes.data[key]!)
  if (attributes.ariaHidden) out.fixedAttribute('aria-hidden', 'true')
  if (attributes.tabIndex === 0) out.fixedAttribute('tabindex', 0)
  if (attributes.ariaLabel !== undefined) out.fixedAttribute('aria-label', attributes.ariaLabel)
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
  if (transform) out.fixedAttribute('transform', serializeTransform(transform))
}

/** Identity on the roles whose DOM contract carries it, then relation ARIA. */
function identityAttributes(out: SvgWriter, identity: SvgSemanticIdentity | undefined, accessibility: SvgSemanticAccessibility | undefined): void {
  if (identity && hasDomSvgIdentityRole(identity.role)) {
    out.fixedAttribute('data-id', identity.id)
    out.fixedAttribute('data-role', identity.role)
    if (identity.from !== undefined) out.fixedAttribute('data-from', identity.from)
    if (identity.to !== undefined) out.fixedAttribute('data-to', identity.to)
  }
  if (accessibility) {
    out.fixedAttribute('role', accessibility.role)
    out.fixedAttribute('aria-roledescription', accessibility.roleDescription)
    out.fixedAttribute('aria-label', accessibility.label)
  }
}

type ElementGeometry = Exclude<Geometry, { kind: 'compound' }> | Exclude<ConnectorMark['route']['geometry'], { kind: 'line' }> | { kind: 'line'; x1: number; y1: number; x2: number; y2: number }

/** The private Native writer reads source coordinates in their original order,
 * then formats each actual scalar once. No combined numeric string is rebuilt,
 * regex-rewritten and token-parsed to recover those same operands. */
function longPointDecimal(value: string): boolean {
  if (value.length < 14) return false
  let decimals = -1
  for (let index = 0; index < value.length; index++) {
    const character = value[index]!
    if (character === '.') decimals = 0
    else if (decimals >= 0 && character >= '0' && character <= '9') { if (++decimals >= 12) return true }
    else decimals = -1
  }
  return false
}
function nativePolylineAttributes(out: SvgWriter, geometry: Extract<ElementGeometry, { kind: 'polyline' }>): void {
  const operands = xmlList<number | string>()
  let pointCount = 0, needsNormalization = false
  for (; pointCount < geometry.points.length; pointCount++) {
    const point = geometry.points[pointCount]!
    const x = point.x, rawX = `${x}`, y = point.y, rawY = `${y}`
    needsNormalization ||= longPointDecimal(rawX) || longPointDecimal(rawY)
    operands[operands.length++] = x; operands[operands.length++] = rawX
    operands[operands.length++] = y; operands[operands.length++] = rawY
  }
  if (!needsNormalization) {
    let points = '', finite = true
    for (let index = 0; index < pointCount; index++) {
      const x = operands[index * 4], y = operands[index * 4 + 2]
      finite &&= typeof x === 'number' && x >= -SCENE_VALIDATION_LIMITS.maxExtent && x <= SCENE_VALIDATION_LIMITS.maxExtent
        && typeof y === 'number' && y >= -SCENE_VALIDATION_LIMITS.maxExtent && y <= SCENE_VALIDATION_LIMITS.maxExtent
      points += `${index ? ' ' : ''}${operands[index * 4 + 1]},${operands[index * 4 + 3]}`
    }
    // Primitive finite Number-to-string has only numeric ASCII. These exact
    // source operands are appended with private numeric punctuation, so no
    // escape/combined-string formatter or second character walk is needed.
    if (finite) out.numericPoints(points, true)
    else out.fixedAttribute('points', points)
    out.xml?.geometryWritten(geometry, finite ? geometry : undefined)
    return
  }
  let valid = pointCount >= 2 && !!out.xml?.reserveGeometry(geometry, pointCount * 20 + 64)
  let markup = '', changed = false, previous: ScenePoint | undefined
  let firstTangent: ScenePoint | undefined, lastTangent: ScenePoint | undefined
  const points: ScenePoint[] | undefined = valid ? [] : undefined
  let scalarLiteral = ''
  const scalar = (operand: number | string, raw: string): number => {
    const formatted = typeof operand === 'number' ? formatSvgNumber(operand) : raw
    const literal = typeof formatted === 'string' ? formatted : `${formatted}`
    let understood = typeof operand === 'number' && typeof formatted === 'string' && literal.length > 0
      && !!out.xml?.reserveScalarWork(literal.length + 1)
    if (understood) for (let index = 0; index < literal.length; index++) {
      const character = literal[index]!
      if (!(character >= '0' && character <= '9') && character !== '-' && character !== '+' && character !== '.' && character !== 'e' && character !== 'E') { understood = false; break }
    }
    const value = understood ? +literal : NaN
    understood &&= value >= -SCENE_VALIDATION_LIMITS.maxExtent && value <= SCENE_VALIDATION_LIMITS.maxExtent
      && typeof operand === 'number' && operand >= -SCENE_VALIDATION_LIMITS.maxExtent && operand <= SCENE_VALIDATION_LIMITS.maxExtent
    valid &&= understood
    changed ||= literal !== raw
    scalarLiteral = literal
    return value
  }
  for (let index = 0; index < pointCount; index++) {
    const x = scalar(operands[index * 4]!, operands[index * 4 + 1] as string), xLiteral = scalarLiteral
    const y = scalar(operands[index * 4 + 2]!, operands[index * 4 + 3] as string), yLiteral = scalarLiteral
    if (index) markup += ' '
    markup += `${xLiteral},${yLiteral}`
    if (!valid) continue
    const input = { x, y }, point = writtenFactFreeze(input)
    if (point !== input || !closedWrittenSlot(point, 'x', x) || !closedWrittenSlot(point, 'y', y)) { valid = false; continue }
    writtenFactDefine(points, index, { __proto__: null, value: point, enumerable: true, writable: false, configurable: false } as PropertyDescriptor)
    if (previous) {
      const tangent = connectorUnitTangent(previous, point)
      if (tangent) {
        const x = tangent.x, y = tangent.y, sealed = writtenFactFreeze(tangent)
        if (sealed !== tangent || !closedWrittenSlot(sealed, 'x', x) || !closedWrittenSlot(sealed, 'y', y)) { valid = false; continue }
        lastTangent = sealed; firstTangent ??= lastTangent
      }
    }
    if (!closedWrittenSlot(points!, String(index), point)) { valid = false; continue }
    previous = point
  }
  out.numericPoints(markup, valid)
  let served: Geometry | undefined = valid && !changed ? geometry : undefined
  let projection: WrittenPolylineProjection | undefined
  if (valid && changed && points?.length === pointCount) {
    writtenFactDefine(points, 'length', { __proto__: null, writable: false } as PropertyDescriptor)
    writtenFactSeal(points)
    const start = points[0]!, end = points[points.length - 1]!
    const input = { start, end, closed: false,
      ...(firstTangent ? { startTangent: firstTangent } : {}), ...(lastTangent ? { endTangent: lastTangent } : {}) }
    const contour = writtenFactFreeze(input), list = [contour], contours = writtenFactFreeze(list)
    if (contour === input && contours === list && closedWrittenSlot(points, 'length', pointCount) && closedWrittenSlot(contour, 'start', start)
      && closedWrittenSlot(contour, 'end', end) && closedWrittenSlot(contour, 'closed', false)
      && (!firstTangent || closedWrittenSlot(contour, 'startTangent', firstTangent))
      && (!lastTangent || closedWrittenSlot(contour, 'endTangent', lastTangent))
      && closedWrittenSlot(contours, '0', contour) && closedWrittenSlot(contours, 'length', 1)) {
      projection = { contours, collapsed: !firstTangent }
      served = createActualWrittenPolyline(points, contours, !firstTangent)
    }
  }
  out.xml?.geometryWritten(geometry, served, projection)
}

function geometryAttributes(out: SvgWriter, geometry: ElementGeometry, sink?: SvgGeometryWriteSink): void {
  switch (geometry.kind) {
    case 'rect': {
      const rawX = geometry.x, x = out.fixedAttribute('x', rawX)
      const rawY = geometry.y, y = out.fixedAttribute('y', rawY)
      const rawWidth = geometry.width, width = out.fixedAttribute('width', rawWidth)
      const rawHeight = geometry.height, height = out.fixedAttribute('height', rawHeight)
      let rawRx: number | undefined, rawRy: number | undefined, rx: string | undefined, ry: string | undefined
      // Keep the optional fields' original conditional/read order, including
      // generic getter callers. The receipt retains only actual attribute reads.
      if (geometry.rx !== undefined) { rawRx = geometry.rx; rx = out.fixedAttribute('rx', rawRx) }
      if (geometry.ry !== undefined) { rawRy = geometry.ry; ry = out.fixedAttribute('ry', rawRy) }
      if (!sink) out.xml?.retainRectangle(geometry, x, y, width, height, rx, ry)
      if (sink) sink(geometry, {
        kind: 'rect', x: Number(x), y: Number(y), width: Number(width), height: Number(height),
        ...(rx === undefined ? {} : { rx: Number(rx) }), ...(ry === undefined ? {} : { ry: Number(ry) }),
      })
      return
    }
    case 'circle':
      out.fixedAttribute('cx', geometry.cx)
      out.fixedAttribute('cy', geometry.cy)
      out.fixedAttribute('r', geometry.r)
      return
    case 'ellipse':
      out.fixedAttribute('cx', geometry.cx)
      out.fixedAttribute('cy', geometry.cy)
      out.fixedAttribute('rx', geometry.rx)
      out.fixedAttribute('ry', geometry.ry)
      return
    case 'line': {
      const rawX1 = geometry.x1, x1 = out.fixedAttribute('x1', rawX1)
      const rawY1 = geometry.y1, y1 = out.fixedAttribute('y1', rawY1)
      const rawX2 = geometry.x2, x2 = out.fixedAttribute('x2', rawX2)
      const rawY2 = geometry.y2, y2 = out.fixedAttribute('y2', rawY2)
      if (sink || out.ownedGeometry) {
        const served = Number(x1) === rawX1 && Number(y1) === rawY1 && Number(x2) === rawX2 && Number(y2) === rawY2
          ? geometry : { kind: 'line' as const, x1: Number(x1), y1: Number(y1), x2: Number(x2), y2: Number(y2) }
        if (sink) sink(geometry, served)
        else out.xml?.geometryWritten(geometry, served)
      }
      return
    }
    case 'polygon':
    case 'polyline': {
      if (geometry.kind === 'polyline' && out.ownedGeometry) { nativePolylineAttributes(out, geometry); return }
      let points = ''
      const observed = geometry.kind === 'polyline' && (sink !== undefined || out.ownedGeometry)
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
      const literal = out.fixedAttribute('points', points, undefined, observed ? (literal, raw) => {
        if (tokens === 0) {
          const cost = out.ownedGeometry ? pointCount * 32 + 112 : pointCount * 48 + 128
          if (!Number.isSafeInteger(pointCount) || pointCount < 2 || !Number.isSafeInteger(cost) || !(sink ? sink.reserveProjection?.(geometry, cost) : out.xml?.reserveGeometry(geometry, cost))) { understood = false; return false }
          projected = []
        }
        if (tokens >= pointCount * 2) { understood = false; return false }
        const value = Number(literal), original = Number(raw)
        if (!Number.isFinite(value) || !Number.isFinite(original)) { understood = false; return false }
        changed ||= value !== original
        if (tokens++ % 2 === 0) { x = value; rawX = original; return }
        const point = writtenFactFreeze({ x, y: value })
        const rawPoint = out.ownedGeometry ? undefined : writtenFactFreeze({ x: rawX, y: original })
        writtenFactDefine(projected, tokens / 2 - 1, { __proto__: null, value: point, enumerable: true, writable: false, configurable: false } as PropertyDescriptor)
        if (previous) {
          const tangent = connectorUnitTangent(previous, point)
          if (tangent) { lastTangent = writtenFactFreeze(tangent); firstTangent ??= lastTangent }
        }
        if (rawPrevious && rawPoint) {
          const tangent = connectorUnitTangent(rawPrevious, rawPoint)
          if (tangent) { rawLastTangent = writtenFactFreeze(tangent); rawFirstTangent ??= rawLastTangent }
        }
        previous = point
        rawPrevious = rawPoint
        if (!out.ownedGeometry) {
          rawX0 = Math.min(rawX0, rawX); rawY0 = Math.min(rawY0, original)
          rawX1 = Math.max(rawX1, rawX); rawY1 = Math.max(rawY1, original)
          if (tokens === 2) { rawStartX = rawX; rawStartY = original }
          rawEndX = rawX; rawEndY = original
        }
      } : undefined)
      if (observed) {
        let actualProjection: WrittenPolylineProjection | undefined
        let served: Geometry | undefined = literal === points ? geometry : undefined
        if (changed && understood && tokens === pointCount * 2 && projected?.length === pointCount) {
          writtenFactDefine(projected, 'length', { __proto__: null, writable: false } as PropertyDescriptor)
          writtenFactSeal(projected)
          const contour = writtenFactFreeze({ start: projected[0]!, end: projected[projected.length - 1]!, closed: false,
            ...(firstTangent ? { startTangent: firstTangent } : {}), ...(lastTangent ? { endTangent: lastTangent } : {}) })
          const contours = writtenFactFreeze([contour])
          if (out.ownedGeometry) actualProjection = { contours, collapsed: !firstTangent }
          served = out.ownedGeometry ? createActualWrittenPolyline(projected, contours, !firstTangent) : createWrittenPolyline(projected, { contours, collapsed: !firstTangent,
            rawBounds: writtenFactFreeze({ x0: rawX0, y0: rawY0, x1: rawX1, y1: rawY1 }),
            rawStart: writtenFactFreeze({ x: rawStartX, y: rawStartY }), rawEnd: writtenFactFreeze({ x: rawEndX, y: rawEndY }),
            ...(rawFirstTangent ? { rawStartTangent: rawFirstTangent } : {}), ...(rawLastTangent ? { rawEndTangent: rawLastTangent } : {}) })
        }
        if (sink) sink(geometry, served)
        else out.xml?.geometryWritten(geometry, served, actualProjection)
      }
      return
    }
    case 'path': {
      const raw = geometry.d, literal = out.fixedAttribute('d', raw)
      const served = literal === raw ? geometry : { kind: 'path' as const, d: literal }
      if (sink) sink(geometry, served)
      else out.xml?.geometryWritten(geometry, served)
    }
  }
}

export function writeImageSvg(node: ImageMark): string
export function writeImageSvg(node: ImageMark, capture: SvgXmlCapture): SvgXmlWrite
export function writeImageSvg(node: ImageMark, capture?: SvgXmlCapture): string | SvgXmlWrite {
  // Validate the values actually emitted, including mutable/getter-backed marks.
  const { href, x, y, width, height, fit } = node
  if (typeof href !== 'string' || href.length > SCENE_VALIDATION_LIMITS.maxSerializationBytesPerNode || !isInlinePng(href)) throw new TypeError('Image requires a self-contained PNG data URI')
  if (![x, y, width, height].every(value => Number.isFinite(value) && Math.abs(value) <= SCENE_VALIDATION_LIMITS.maxExtent)
    || width <= 0 || height <= 0 || fit !== 'contain' && fit !== 'stretch') throw new TypeError('Invalid image viewport')
  const out = new SvgWriter(capture)
  out.element('image')
  out.fixedAttribute('href', href)
  out.fixedAttribute('x', x); out.fixedAttribute('y', y)
  out.fixedAttribute('width', width); out.fixedAttribute('height', height)
  out.fixedAttribute('preserveAspectRatio', fit === 'contain' ? 'xMidYMid meet' : 'none')
  hooks(out, node.attributes)
  transformAttribute(out, node.transform)
  identityAttributes(out, node.identity, node.accessibility)
  out.raw(' />')
  writtenLeafContexts.set(node, { svg: out.value, context: Object.freeze({ transformed: out.transformed }) })
  return capture ? finishXmlLeaf(capture, node, out.value, out.xml) : out.value
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
    if (!sink && !compound && piece.kind !== 'rect') out.ownedGeometry = out.xml?.beginGeometry(piece) ?? false
    geometryAttributes(out, piece, sink)
    // Only the13 paint fields and one transform can enter this receipt.
    // Data/identity hooks stay outside the observed writer phase entirely.
    out.observeAttributes = observe
    if (!compound && !sink) out.xml?.rectanglePhase(true)
    paintAttributes(out, compound ? node.childPaints?.[index] ?? node.paint : node.paint)
    transformAttribute(out, node.transform)
    out.observeAttributes = undefined
    out.xml?.rectanglePhase(false)
    if (index === 0) identityAttributes(out, node.identity, node.accessibility)
    out.close()
  }
  report?.(node, invalidAttributes ? undefined : Object.freeze(attributes!))
  writtenLeafContexts.set(node, { svg: out.value, context: Object.freeze({ transformed: out.transformed }) })
  return capture ? finishXmlLeaf(capture, node, out.value, out.xml) : out.value
}

function typographyAttributes(out: SvgWriter, node: TextMark): void {
  out.fixedAttribute('text-anchor', node.anchor)
  if (node.dominantBaseline) out.fixedAttribute('dominant-baseline', node.dominantBaseline)
  // A block measured in a named face is drawn in it; otherwise the document font applies.
  if (node.block?.fontFamily) out.fixedAttribute('font-family', node.block.fontFamily)
  out.fixedAttribute('font-size', node.fontSize)
  out.fixedAttribute('font-weight', node.fontWeight ?? node.block?.fontWeight ?? 400)
  if ((node.letterSpacing ?? 0) !== 0) out.fixedAttribute('letter-spacing', node.letterSpacing!)
  if (node.fontStyle) out.fixedAttribute('font-style', node.fontStyle)
  if (node.textDecoration) out.fixedAttribute('text-decoration', node.textDecoration)
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
  const state = report && xmlCaptureState(capture!)
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
  } : undefined, node.anchor, out.textEvidence(attrs))
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
  for (const span of node.spans) spans += `${writeTextOpening('tspan', [['fill', escapeAttr(span.fill)]])}${escapeXml(span.text)}</tspan>`
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
  out.fixedAttribute('data-id', label.id ?? `${node.id}-label-${index + 1}`)
  out.fixedAttribute('data-role', 'label')
  out.fixedAttribute('data-connector-label-for', node.id)
  out.fixedAttribute('font-size', block.fontSize)
  out.fixedAttribute('font-weight', block.fontWeight)
  if (block.letterSpacing) out.fixedAttribute('letter-spacing', block.letterSpacing)
  out.fixedAttribute('text-anchor', label.textAnchor)
  transformAttribute(out, node.transform)
  paintAttributes(out, paint)
  let complete = false, attrs = ''
  const svg = renderMultilineText(block, label.anchor.x, label.anchor.y - Math.max(0, label.clearance ?? 0), block.fontSize, attrs = capture ? xmlRange(out.value, 1) : out.value.slice(1), 0, false, out.xml ? written => {
    complete = true
    out.xml!.prepared(written)
  } : undefined, label.textAnchor, out.textEvidence(attrs))
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
    if (!sink) out.ownedGeometry = out.xml?.beginGeometry(geometry) ?? false
    geometryAttributes(out, geometry, sink)
    if (geometry.kind !== 'line') out.fixedAttribute('fill', 'none')
    out.fixedAttribute('stroke', stroke.color)
    if (stroke.opacity !== undefined) out.fixedAttribute('stroke-opacity', stroke.opacity)
    out.fixedAttribute('stroke-width', stroke.width)
    if (dash) out.fixedAttribute('stroke-dasharray', typeof dash.array === 'string' ? dash.array : dash.array.join(' '))
    if (dash?.offset !== undefined) out.fixedAttribute('stroke-dashoffset', dash.offset)
    if (stroke.lineCap !== 'butt') out.fixedAttribute('stroke-linecap', stroke.lineCap)
    if (stroke.lineJoin !== 'miter') out.fixedAttribute('stroke-linejoin', stroke.lineJoin)
    if (stroke.miterLimit !== 4) out.fixedAttribute('stroke-miterlimit', stroke.miterLimit)
    if (stroke.pathLength !== undefined) out.fixedAttribute('pathLength', stroke.pathLength)
    if (stroke.paintOrder !== undefined) out.fixedAttribute('paint-order', stroke.paintOrder)
    if (stroke.nonScaling) out.fixedAttribute('vector-effect', 'non-scaling-stroke')
    if (stroke.mixBlendMode) out.fixedAttribute('style', `mix-blend-mode:${stroke.mixBlendMode}`)
    if (markers.start) out.fixedAttribute('marker-start', `url(#${markers.start.id})`)
    if (midMarker) out.fixedAttribute('marker-mid', `url(#${midMarker.id})`)
    if (markers.end) out.fixedAttribute('marker-end', `url(#${markers.end.id})`)
    if (node.hit.pointerEvents === 'none') out.fixedAttribute('pointer-events', 'none')
    transformAttribute(out, node.transform)
    out.fixedAttribute('data-relationship', node.relationship.kind)
    out.fixedAttribute('data-direction', node.relationship.direction)
    identityAttributes(out, node.identity, node.accessibility)
    out.close()
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
