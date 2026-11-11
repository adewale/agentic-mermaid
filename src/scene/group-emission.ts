import { decodeXML } from 'entities'
import { visitSvgFirstTagAttributes, visitSvgStartTagsFresh, svgClassHasTokenFresh, type SvgStartTagToken, type SvgAttributeToken } from '../svg-structure.ts'
import { parseSvgTransform, transformMatrix } from './transforms.ts'
import type { GroupMark } from './ir.ts'

const GROUP_HOOK = /^(?:class|data-[a-z][a-z0-9-]*|role|aria-[a-z]+|tabindex|pointer-events|transform|style)$/
const GROUP_OPEN = /^\s*<g\b[^>]*>(?:<title>[^<]*<\/title>)?$/
/** Custom properties only: values a family scopes to the group for its marks' var() paints. */
const CUSTOM_PROPERTIES = /^\s*(?:--[A-Za-z0-9_-]+\s*:[^;]*(?:;\s*|$))*$/
/** A group's open tag carries hooks, and the transform its typed field
 * declares; paint belongs to the marks inside it, which the writer paints. */
type GroupFields = Pick<GroupMark, 'id' | 'open' | 'close' | 'join' | 'transform' | 'paint'>
type Pay = (operations: number) => boolean
type Visitor = typeof visitSvgFirstTagAttributes
// Private operands are pinned before any ambient sealing callback can see
// them. Keep their exact literal receiver; a freeze return is no authority.
const groupDefine = Object.defineProperties, groupSlot = Object.defineProperty, groupPrevent = Object.preventExtensions
function attributeRecord(name: string, value: string, quote: '"' | "'", nameStart: number, valueStart: number, valueEnd: number): SvgAttributeToken {
  return groupPrevent(groupDefine({}, {
    name: { value: name, enumerable: true }, value: { value, enumerable: true }, quote: { value: quote, enumerable: true },
    nameStart: { value: nameStart, enumerable: true }, valueStart: { value: valueStart, enumerable: true }, valueEnd: { value: valueEnd, enumerable: true },
  })) as SvgAttributeToken
}
function tagRecord(name: string, start: number, end: number, selfClosing: boolean, attributes: readonly SvgAttributeToken[]): SvgStartTagToken {
  return groupPrevent(groupDefine({}, {
    name: { value: name, enumerable: true }, start: { value: start, enumerable: true }, end: { value: end, enumerable: true },
    selfClosing: { value: selfClosing, enumerable: true }, attributes: { value: attributes, enumerable: true },
  })) as SvgStartTagToken
}
function closeRoster<T>(values: T[]): readonly T[] {
  groupSlot(values, 'length', { value: values.length, writable: false })
  return groupPrevent(values)
}

function checkInertGroup({ id, open, close, join, transform, paint }: GroupFields, visit: Visitor) {
  if (close !== '</g>' || !/^\s*$/.test(join)) throw new TypeError(`Group "${id}" close and join must not add artwork`)
  const names = new Set<string>()
  let rawTransform: string | undefined
  const tag = GROUP_OPEN.test(open) ? visit(open, 'g', (name, value) => {
    if (names.has(name)) throw new TypeError(`Group "${id}" open has a duplicate "${name}"`)
    names.add(name)
    if ((name === 'opacity' || name === 'fill') && paint?.[name] !== undefined && decodeXML(value) === paint[name]) return
    if (!GROUP_HOOK.test(name)) throw new TypeError(`Group "${id}" open sets "${name}"; paint and geometry belong to typed marks`)
    if (name === 'style' && !CUSTOM_PROPERTIES.test(decodeXML(value))) {
      throw new TypeError(`Group "${id}" open style may only set custom properties; paint belongs to typed marks`)
    }
    if (name === 'transform') rawTransform = value
  }) : undefined
  if (['opacity', 'fill'].some(name => names.has(name) !== ((paint as Record<string, unknown> | undefined)?.[name] !== undefined))) throw new TypeError(`Group "${id}" open disagrees with its typed paint`)
  if (tag !== 'g') throw new TypeError(`Group "${id}" open must be one <g> tag with an optional <title>`)
  const written = rawTransform === undefined ? undefined : decodeXML(rawTransform)
  const matrix = written === undefined ? undefined : parseSvgTransform(written)
  const typed = transform ? transformMatrix(transform) : undefined
  if (written !== undefined && !matrix) throw new TypeError(`Group "${id}" open has an unsupported transform`)
  if (!!matrix !== !!typed || matrix && typed && matrix.some((value, index) => Math.abs(value - typed[index]!) > 1e-9 * Math.max(1, Math.abs(value)))) {
    throw new TypeError(`Group "${id}" open transform disagrees with its typed transform`)
  }
  return { matrix: matrix && Object.freeze(matrix), style: names.has('style') }
}

export function assertInertGroup(fields: GroupFields) {
  return checkInertGroup(fields, visitSvgFirstTagAttributes)
}

export interface NativeGroupParse {
  readonly open: string
  readonly firstName: string | undefined
  /** The consuming ledger pays every new receiver before it is allocated. */
  materialize(pay: Pay): readonly SvgStartTagToken[] | undefined
}

interface PrimitiveGroupList<T> { length: number; [index: number]: T }
interface PrimitiveGroupTag { name: string; start: number; end: number; selfClosing: boolean; attributes: PrimitiveGroupList<SvgAttributeToken> }
function primitiveGroupList<T>(): PrimitiveGroupList<T> { return { __proto__: null, length: 0 } as PrimitiveGroupList<T> }

interface PlainGroupInput {
  valid: boolean
  start: number
  end: number
  cursor: number
  readonly values: { length: number; [index: number]: string }
  readonly names: { [index: number]: string }
}
const nativeGroupParseIssuer = { __proto__: null }
/** Actual primitive lexer operands, independent of ambient record/seal helpers.
 * The ordinary token roster remains complete for existing foreign observers. */
class ParsedNativeGroup {
  declare readonly open: string
  declare readonly firstName: string | undefined
  declare readonly materialize: NativeGroupParse['materialize']
  readonly #source: string
  readonly #plain: PlainGroupInput | undefined
  readonly #node: object | undefined
  constructor(issuer: object, source: string, plain: PlainGroupInput | undefined, node?: object) {
    if (issuer !== nativeGroupParseIssuer) throw new TypeError('Native group facts require their actual lexer')
    this.#source = source; this.#plain = plain; this.#node = node
  }
  static context(value: unknown, node: GroupMark, source: string, pay: Pay): NativePlainGroupContext | undefined {
    if (!value || typeof value !== 'object' || !(#source in value) || value.#node !== node || !value.#plain?.valid
      || !pay(source.length * 2 + 8) || value.#source !== source || groupEmission.get(node)?.nativeParse !== value) return undefined
    // The strict plain lexer already checked every name, duplicate and exact
    // quote/separator boundary. Context needs only the actual class literal;
    // plain groups cannot carry paint, style, transforms or nested markup.
    let mono = false
    const plain = value.#plain
    for (let index = 0; index < plain.values.length; index++) {
      if (!pay(2)) return undefined
      if (plain.names[index] === 'class') {
        const raw = plain.values[index]!
        if (!pay(raw.length * 8 + 4)) return undefined
        mono = svgClassHasTokenFresh(decodeXML(raw), 'mono')
      }
    }
    const join = node.join
    if (typeof join !== 'string' || !pay(join.length + 4)) return undefined
    let fractional = node.close === '</g>'
    for (let index = 0; index < join.length; index++) if (!groupXmlSpace(join[index])) fractional = false
    return { uncertain: mono || node.paint?.opacity !== undefined || node.paint?.fill !== undefined || node.transform !== undefined,
      matrix: undefined, fractional }
  }

  static validate(value: unknown, source: string, literal: (value: string) => boolean, pay: Pay): boolean {
    if (!value || typeof value !== 'object' || !(#source in value) || !value.#plain?.valid || !value.#node || groupEmission.get(value.#node)?.nativeParse !== value) return false
    if (!pay(source.length * 2 + 4) || value.#source !== source) return false
    for (let index = 0; index < value.#plain.values.length; index++) {
      if (!pay(1) || !literal(value.#plain.values[index]!)) return false
    }
    return true
  }
}
export interface NativePlainGroupContext { readonly uncertain: boolean; readonly matrix: undefined; readonly fractional: boolean }
const nativeParsedContext = ParsedNativeGroup.context
export function consumeNativeGroupEmission(node: GroupMark, open: string, pay: Pay): NativePlainGroupContext | undefined {
  if (!pay(2)) return undefined
  return nativeParsedContext(groupEmission.get(node)?.nativeParse, node, open, pay)
}
const validateParsedNativeGroup = ParsedNativeGroup.validate
export function validatePlainNativeGroup(value: unknown, source: string, literal: (value: string) => boolean, pay: Pay): boolean { return validateParsedNativeGroup(value, source, literal, pay) }

function groupXmlSpace(character: string | undefined): boolean { return character === ' ' || character === '\t' || character === '\r' || character === '\n' }

function plainGroupName(name: string): boolean {
  if (name === 'class' || name === 'role' || name === 'tabindex' || name === 'pointer-events') return true
  const data = name[0] === 'd' && name[1] === 'a' && name[2] === 't' && name[3] === 'a' && name[4] === '-'
  const aria = name[0] === 'a' && name[1] === 'r' && name[2] === 'i' && name[3] === 'a' && name[4] === '-'
  if ((!data && !aria) || name.length === 5) return false
  for (let index = 5; index < name.length; index++) {
    const character = name[index]!
    if (!(character >= 'a' && character <= 'z') && !(data && index > 5 && (character >= '0' && character <= '9' || character === '-'))) return false
  }
  return true
}

interface GroupEmission { readonly open: string; readonly opacity: string | undefined; readonly style: boolean; readonly matrix: ReturnType<typeof parseSvgTransform>; readonly nativeParse?: NativeGroupParse }
const groupEmission = new WeakMap<object, GroupEmission>()
function emissionRecord(open: string, opacity: string | undefined, style: boolean, matrix: ReturnType<typeof parseSvgTransform>, nativeParse?: NativeGroupParse): GroupEmission {
  return groupPrevent(groupDefine({}, {
    open: { value: open, enumerable: true }, opacity: { value: opacity, enumerable: true }, style: { value: style, enumerable: true },
    matrix: { value: matrix, enumerable: true }, nativeParse: { value: nativeParse, enumerable: true },
  })) as GroupEmission
}
export function registerGroupEmission(node: object, fields: Omit<GroupEmission, 'nativeParse'>, nativePay?: Pay): void {
  if (!nativePay || !nativePay(20)) {
    // Generic constructor observability and exhausted Native delivery stay as
    // before; only a paid Native registration can guard later private facts.
    groupEmission.set(node, Object.freeze({ open: fields.open, opacity: fields.opacity, style: fields.style, matrix: fields.matrix }))
    return
  }
  groupEmission.set(node, emissionRecord(fields.open, fields.opacity, fields.style, fields.matrix))
}
export function retainedGroupEmission(node: object) { return groupEmission.get(node) }

/** Only a constructor-owned plain shell can retain its final validation's
 * primitive operands. Old construction metadata alone grants no parse reuse. */
export function captureNativeGroupEmission(node: GroupMark, pay: (operations: number) => boolean): void {
  if (!pay(2)) { assertInertGroup(node); return }
  const prior = groupEmission.get(node)
  if (!prior || !pay(20)) { assertInertGroup(node); return }
  for (const field of ['id', 'open', 'close', 'join', 'transform', 'paint']) {
    const slot = Object.getOwnPropertyDescriptor(node, field)
    if (slot ? !Object.hasOwn(slot, 'value') : field in node) { assertInertGroup(node); return }
  }
  // Admission still validates in its original order. Its primitive visitor
  // need not construct a retained roster that the final shell would copy.
  checkInertGroup(node, (source, _expected, check) => {
    pay(source.length + 4)
    let firstName: string | undefined, tags = 0
    visitSvgStartTagsFresh(source, {
      tag(name) { if (tags++ === 0) firstName = name },
      attribute(name, value) { if (tags === 1 && firstName === 'g') check(name, value) },
    })
    return firstName
  })
}

/** Bind the final captured shell and the exact opening actually written. */
export function bindNativeGroupEmission(node: GroupMark, open: string, pay: Pay): NativeGroupParse | undefined {
  if (!pay(2)) return undefined
  const prior = groupEmission.get(node)
  if (!prior || !pay(20)) return undefined
  for (const field of ['id', 'open', 'close', 'join', 'transform', 'paint']) {
    const slot = Object.getOwnPropertyDescriptor(node, field)
    if (slot ? !Object.hasOwn(slot, 'value') : field in node) return undefined
  }
  const ownOpen = Object.getOwnPropertyDescriptor(node, 'open')
  if (!ownOpen || ownOpen.value !== open || ownOpen.writable || ownOpen.configurable || Object.isExtensible(node)) return undefined
  const parsed = captureNativeGroupParse(node, pay, node)
  if (!parsed || !pay(12)) return undefined
  groupEmission.set(node, emissionRecord(open, prior.opacity, prior.style, prior.matrix, parsed))
  return parsed
}

/** This shares only private primitive instructions. The consumer must bind
 * its own pinned open string and allocate its own lexical receivers. */
export function transferNativeGroupEmission(source: object, target: object, pay: (operations: number) => boolean): void {
  if (!pay(2)) return
  const prior = groupEmission.get(source)
  if (prior && pay(2)) groupEmission.set(target, prior)
}

/** The retained closure is created outside the producing ledger scope; it
 * captures only private rows and primitive source operands. */
function nativeParseRecord(source: string, firstName: string | undefined, tags: PrimitiveGroupList<PrimitiveGroupTag>, attributeCount: number, plain?: PlainGroupInput, node?: object): NativeGroupParse {
  const materialize = (pay: Pay): readonly SvgStartTagToken[] | undefined => {
      if (!pay(tags.length * 24 + attributeCount * 24 + 8)) return undefined
      const result: SvgStartTagToken[] = []
      for (let i = 0; i < tags.length; i++) {
        const tag = tags[i]!, attributes: SvgAttributeToken[] = []
        for (let j = 0; j < tag.attributes.length; j++) {
          const item = tag.attributes[j]!
          const attribute = attributeRecord(item.name, item.value, item.quote, item.nameStart, item.valueStart, item.valueEnd)
          groupSlot(attributes, j, { value: attribute, enumerable: true })
        }
        const token = tagRecord(tag.name, tag.start, tag.end, tag.selfClosing, closeRoster(attributes))
        groupSlot(result, i, { value: token, enumerable: true })
      }
      return closeRoster(result)
  }
  return groupPrevent(groupDefine(new ParsedNativeGroup(nativeGroupParseIssuer, source, plain, node), { open: { value: source, enumerable: true }, firstName: { value: firstName, enumerable: true }, materialize: { value: materialize, enumerable: true } })) as NativeGroupParse
}

/** The final primitive lexer retains private rows directly: no token records,
 * descriptor operands, immutable rosters or sealing callbacks are constructed.
 * Each private row/list append is paid before allocation. Generic consumers
 * still materialize complete fresh public tokens and pay their original
 * descriptor/closing work; bound plain context and XML consume private rows. */
function collectNativeGroup(source: string, pay: Pay, check?: (name: string, value: string) => void, first?: (name: string) => void, node?: object): NativeGroupParse | undefined {
  if (!pay(12)) return undefined
  const tags = primitiveGroupList<PrimitiveGroupTag>()
  let current: PrimitiveGroupTag | undefined, firstName: string | undefined, complete = true, attributeCount = 0, tagCount = 0
  const plain: PlainGroupInput | undefined = check ? { valid: true, start: 0, end: 0, cursor: 0, values: { __proto__: null, length: 0 } as unknown as PlainGroupInput['values'], names: { __proto__: null } as unknown as PlainGroupInput['names'] } : undefined
  const names = { __proto__: null } as unknown as Record<string, true>
  visitSvgStartTagsFresh(source, {
    tag(name, start, end, selfClosing) {
      if (tagCount++ === 0) {
        firstName = name; first?.(name)
        if (plain) { plain.start = start; plain.end = end; plain.cursor = start + 2; plain.valid = name === 'g' && !selfClosing }
      } else if (plain) plain.valid = false
      if (!complete || !pay(12)) { complete = false; current = undefined; return }
      current = { name, start, end, selfClosing, attributes: primitiveGroupList() }
      tags[tags.length++] = current
    },
    attribute(name, value, quote, nameStart, valueStart, valueEnd) {
      // Validation continues even if retaining its additional operands fails.
      if (tagCount === 1 && firstName === 'g') check?.(name, value)
      if (plain?.valid) {
        if (!pay(nameStart - plain.cursor + valueStart - nameStart + name.length + 6)) plain.valid = false
        else {
          if (names[name] || !plainGroupName(name)) plain.valid = false
          names[name] = true
          let cursor = plain.cursor
          if (cursor >= nameStart) plain.valid = false
          while (cursor < nameStart && groupXmlSpace(source[cursor])) cursor++
          if (cursor !== nameStart) plain.valid = false
          cursor = nameStart + name.length
          while (cursor < valueStart - 1 && groupXmlSpace(source[cursor])) cursor++
          if (source[cursor++] !== '=') plain.valid = false
          while (cursor < valueStart - 1 && groupXmlSpace(source[cursor])) cursor++
          if (cursor !== valueStart - 1 || source[cursor] !== quote || source[valueEnd] !== quote) plain.valid = false
          plain.cursor = valueEnd + 1
          plain.names[plain.values.length] = name
          plain.values[plain.values.length++] = value
        }
      }
      if (!complete || !current || !pay(12)) { complete = false; return }
      current.attributes[current.attributes.length++] = { name, value, quote, nameStart, valueStart, valueEnd }
      attributeCount++
    },
  })
  if (!complete || !pay(tags.length * 2 + attributeCount + 12)) return undefined
  if (plain?.valid) {
    if (!pay(plain.start + source.length - plain.cursor + 1)) plain.valid = false
    else for (let index = 0; index < source.length; index++) {
      if (index >= plain.start && index < plain.cursor) { index = plain.cursor - 1; continue }
      if (index === plain.end - 1 && source[index] === '>') continue
      const character = source[index]!
      if (!groupXmlSpace(character)) { plain.valid = false; break }
    }
  }
  return nativeParseRecord(source, firstName, tags, attributeCount, plain, node)
}

/** Only the final Native validator uses this primitive visitor. The public
 * constructor and generic admission retain their original callback behavior. */
export function captureNativeGroupParse(fields: GroupFields, pay: Pay, node?: object): NativeGroupParse | undefined {
  let parsed: NativeGroupParse | undefined
  checkInertGroup(fields, (source, expected, check) => {
    let visited = false, firstName: string | undefined
    parsed = collectNativeGroup(source, pay, check, name => { visited = true; firstName = name }, node)
    // Retention failure cannot replay a partly completed validator callback.
    // When collection started, its required validation still ran to completion.
    return visited ? firstName : visitSvgFirstTagAttributes(source, expected, check)
  })
  return parsed
}

/** An unmatched shell still needs fresh primitive custody, never tokens
 * returned by inherited array methods or a public inspection cache. */
export function freshNativeGroupTags(source: string, pay: Pay): readonly SvgStartTagToken[] | undefined {
  return collectNativeGroup(source, pay)?.materialize(pay)
}
