import { decodeXML } from 'entities'
import { visitSvgFirstTagAttributes, visitSvgStartTagsFresh, type SvgStartTagToken, type SvgAttributeToken } from '../svg-structure.ts'
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
const groupFreeze = Object.freeze, groupDescriptor = Object.getOwnPropertyDescriptor, groupPrototype = Object.prototype
function ordinaryDescriptorDefaults(): boolean {
  // Legacy descriptor operands inherit these four fields. Preserve that
  // observable path when a caller supplies defaults or accessor hooks.
  return groupDescriptor(groupPrototype, 'get') === undefined && groupDescriptor(groupPrototype, 'set') === undefined
    && groupDescriptor(groupPrototype, 'writable') === undefined && groupDescriptor(groupPrototype, 'configurable') === undefined
}
function frozenGroupRecord<T extends object>(record: T): Readonly<T> { groupFreeze(record); return record }
function attributeRecord(name: string, value: string, quote: '"' | "'", nameStart: number, valueStart: number, valueEnd: number): SvgAttributeToken {
  if (ordinaryDescriptorDefaults()) return frozenGroupRecord({ name, value, quote, nameStart, valueStart, valueEnd })
  return groupPrevent(groupDefine({}, {
    name: { value: name, enumerable: true }, value: { value, enumerable: true }, quote: { value: quote, enumerable: true },
    nameStart: { value: nameStart, enumerable: true }, valueStart: { value: valueStart, enumerable: true }, valueEnd: { value: valueEnd, enumerable: true },
  })) as SvgAttributeToken
}
function tagRecord(name: string, start: number, end: number, selfClosing: boolean, attributes: readonly SvgAttributeToken[]): SvgStartTagToken {
  if (ordinaryDescriptorDefaults()) return frozenGroupRecord({ name, start, end, selfClosing, attributes })
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

interface GroupEmission { readonly open: string; readonly opacity: string | undefined; readonly style: boolean; readonly matrix: ReturnType<typeof parseSvgTransform>; readonly nativeParse?: NativeGroupParse }
const groupEmission = new WeakMap<object, GroupEmission>()
function emissionRecord(open: string, opacity: string | undefined, style: boolean, matrix: ReturnType<typeof parseSvgTransform>, nativeParse?: NativeGroupParse): GroupEmission {
  if (ordinaryDescriptorDefaults()) return frozenGroupRecord({ open, opacity, style, matrix, nativeParse })
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
  const parsed = captureNativeGroupParse(node, pay)
  if (!parsed || !pay(12)) return
  groupEmission.set(node, emissionRecord(prior.open, prior.opacity, prior.style, prior.matrix, parsed))
}

/** This shares only private primitive instructions. The consumer must bind
 * its own pinned open string and allocate its own lexical receivers. */
export function transferNativeGroupEmission(source: object, target: object, pay: (operations: number) => boolean): void {
  if (!pay(2)) return
  const prior = groupEmission.get(source)
  if (prior?.nativeParse && pay(2)) groupEmission.set(target, prior)
}

/** The retained closure is created outside the producing ledger scope; it
 * captures only private rows and primitive source operands. */
function nativeParseRecord(source: string, firstName: string | undefined, tags: readonly SvgStartTagToken[], attributeCount: number): NativeGroupParse {
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
  if (ordinaryDescriptorDefaults()) return frozenGroupRecord({ open: source, firstName, materialize })
  return groupPrevent(groupDefine({}, { open: { value: source, enumerable: true }, firstName: { value: firstName, enumerable: true }, materialize: { value: materialize, enumerable: true } })) as NativeGroupParse
}

/** Existing validation already visits these lexical operands. Retention adds
 * 16 per attribute (record, six descriptor/stores, six descriptor operands,
 * prevention, append), 24 per tag, plus list closing. Materialization prepays
 * 24 per attribute and 24 per tag for fresh ordinary receivers, private-slot
 * reads and pinned stores. Closing prepays readonly lengths and prevention,
 * plus the parse record's three pinned slots/closure. No string is
 * rescanned here; the consumer separately pays exact binding and queries. */
function collectNativeGroup(source: string, pay: Pay, check?: (name: string, value: string) => void, first?: (name: string) => void): NativeGroupParse | undefined {
  if (!pay(12)) return undefined
  const tags: Array<{ name: string; start: number; end: number; selfClosing: boolean; attributes: SvgAttributeToken[] }> = []
  let current: (typeof tags)[number] | undefined, firstName: string | undefined, complete = true, attributeCount = 0, tagCount = 0
  visitSvgStartTagsFresh(source, {
    tag(name, start, end, selfClosing) {
      if (tagCount++ === 0) { firstName = name; first?.(name) }
      if (!complete || !pay(24)) { complete = false; current = undefined; return }
      const attributes: SvgAttributeToken[] = []
      current = tagRecord(name, start, end, selfClosing, attributes) as (typeof tags)[number]
      groupSlot(tags, tags.length, { value: current, enumerable: true })
    },
    attribute(name, value, quote, nameStart, valueStart, valueEnd) {
      // Validation continues even if retaining its additional operands fails.
      if (tagCount === 1 && firstName === 'g') check?.(name, value)
      if (!complete || !current || !pay(16)) { complete = false; return }
      const attribute = attributeRecord(name, value, quote, nameStart, valueStart, valueEnd)
      groupSlot(current.attributes, current.attributes.length, { value: attribute, enumerable: true })
      attributeCount++
    },
  })
  if (!complete || !pay(tags.length * 2 + attributeCount + 12)) return undefined
  for (let i = 0; i < tags.length; i++) closeRoster(tags[i]!.attributes)
  closeRoster(tags)
  return nativeParseRecord(source, firstName, tags, attributeCount)
}

/** Only the final Native validator uses this primitive visitor. The public
 * constructor and generic admission retain their original callback behavior. */
export function captureNativeGroupParse(fields: GroupFields, pay: Pay): NativeGroupParse | undefined {
  let parsed: NativeGroupParse | undefined
  checkInertGroup(fields, (source, expected, check) => {
    let visited = false, firstName: string | undefined
    parsed = collectNativeGroup(source, pay, check, name => { visited = true; firstName = name })
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
