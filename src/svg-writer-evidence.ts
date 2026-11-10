import { writtenAttributesFindings } from './output-security.ts'

export interface WrittenAttribute {
  readonly name: string
  readonly value: string
  readonly order: number
  readonly refs: readonly string[]
  readonly active: readonly string[]
}
export interface WrittenTag {
  readonly name: string
  readonly selfClosing: boolean
  readonly names: readonly string[]
  readonly attributes: readonly WrittenAttribute[]
}
let enabled = false
export function writerEvidenceEnabled(): boolean { return enabled }
/** Opaque/nested backends cannot inherit a surrounding writer's authority or
 * pay its evidence-construction cost. Only synchronous owned rendering enters. */
export function withWrittenSvgSecurity<T>(collect: boolean, run: () => T): T {
  const previous = enabled
  enabled = collect
  try { return run() } finally { enabled = previous }
}

// Exact immutable bytes are the key, including after a projection. No backend
// name, caller freeze or document prefix grants evidence. Bounds include values.
const tags = new Map<string, WrittenTag & { readonly weight: number }>()
let weight = 0
const MAX_WEIGHT = 2 * 1024 * 1024
export function writtenTagOf(tag: string): WrittenTag | undefined { return tags.get(tag) }

export function retainWrittenTag(tag: string, evidence: WrittenTag): void {
  if (tags.has(tag)) return
  const cost = tag.length * 2 + evidence.names.length * 16 + evidence.attributes.reduce((sum, item) => sum + (item.name.length + item.value.length + item.refs.join('').length + item.active.join('').length) * 2 + 96, 128)
  if (cost > MAX_WEIGHT) return
  // Detach slices from compound marks. Lookups never replace this key with a
  // slice retaining an entire SVG. FIFO eviction has no per-hit key mutation.
  // Field names and findings can also hold short slices of a much larger
  // source, including diagnostic ropes. Detach every retained string payload.
  const names = Object.freeze(JSON.parse(JSON.stringify(evidence.names)) as string[])
  // Ordinary scalar tags have no findings and need no extra copying here.
  const attributes = evidence.attributes.length
    ? JSON.parse(JSON.stringify(evidence.attributes)) as WrittenAttribute[] : evidence.attributes
  if (attributes !== evidence.attributes) {
    for (const attribute of attributes) {
      Object.freeze(attribute.refs); Object.freeze(attribute.active); Object.freeze(attribute)
    }
    Object.freeze(attributes)
  }
  tags.set(JSON.parse(JSON.stringify(tag)) as string, Object.freeze({ ...evidence, names, attributes, weight: cost }))
  weight += cost
  while (tags.size > 4096 || weight > MAX_WEIGHT) {
    const oldest = tags.keys().next().value!
    weight -= tags.get(oldest)!.weight
    tags.delete(oldest)
  }
}

/** The writer owns quoting and literal escaping. Duplicate names or unsupported
 * namespace syntax decline evidence rather than weakening final admission. */
export function retainWrittenFields(tag: string, name: string, fields: readonly string[], selfClosing: boolean): void {
  if (!enabled || tags.has(tag) || !/^(?:rect|circle|ellipse|line|polygon|polyline|path|text|tspan)$/.test(name)) return
  const attributes = writtenAttributesFindings(fields)
  if (attributes) retainWrittenTag(tag, { name, attributes, selfClosing, names: Object.freeze(fields.filter((_, index) => index % 2 === 0)) })
}

export interface WrittenTagRange { readonly start: number; readonly end: number; readonly tag: WrittenTag }
export interface WrittenReplacement { readonly start: number; readonly end: number; readonly value: string; readonly name?: string }

/** Carry custody only through attribute-value replacements belonging to this
 * exact tag. New attribute values receive fresh findings before publication. */
export function projectWrittenTag(source: string, range: WrittenTagRange, changes: readonly WrittenReplacement[]): void {
  if (!changes.length) return
  let text = source.slice(range.start, range.end)
  for (let i = changes.length - 1; i >= 0; i--) {
    const change = changes[i]!
    if (!change.name || change.start < range.start || change.end > range.end) return
    text = text.slice(0, change.start - range.start) + change.value + text.slice(change.end - range.start)
  }
  if (tags.has(text)) return
  const attributes = range.tag.attributes.filter(attribute => !changes.some(change => change.name === attribute.name))
  for (const change of changes) {
    const order = range.tag.names.indexOf(change.name!)
    const findings = writtenAttributesFindings([change.name!, change.value])
    if (order < 0 || !findings) return
    for (const finding of findings) attributes.push(Object.freeze({ ...finding, order }))
  }
  // Findings retain original lexical attribute order even if only a subset
  // has references. Unchanged positions are supplied by the source projection.
  attributes.sort((a, b) => a.order - b.order)
  retainWrittenTag(text, { ...range.tag, attributes: Object.freeze(attributes) })
}

export interface WrittenTextAttributes { readonly text: string; readonly fields: readonly string[] }
const textAttributes = new WeakSet<object>()
export function retainTextAttributes(text: string, fields: readonly string[]): WrittenTextAttributes {
  const result = Object.freeze({ text, fields: Object.freeze(fields) })
  textAttributes.add(result)
  return result
}
export type WrittenField = readonly [name: string, escapedValue: string]

/** Text templates use the same field order and literal bytes as the old
 * string writer. Only a private attributes bundle can cover inherited fields. */
export function writeTextOpening(name: 'text' | 'tspan', prefix: readonly WrittenField[], body = '', inherited?: WrittenTextAttributes, suffix: readonly WrittenField[] = [], bodySpace = false): string {
  let tag = `<${name}`
  for (const [field, value] of prefix) tag += ` ${field}="${value}"`
  if (bodySpace) tag += ` ${body}`
  for (const [field, value] of suffix) tag += ` ${field}="${value}"`
  tag += '>'
  if (enabled && !tags.has(tag) && (!body || inherited && textAttributes.has(inherited) && inherited.text === body)) {
    retainWrittenFields(tag, name, [...prefix.flat(), ...inherited?.fields ?? [], ...suffix.flat()], false)
  }
  return tag
}

export function textAttributeFields(bundle: WrittenTextAttributes | undefined, text: string): readonly string[] | undefined {
  return bundle && textAttributes.has(bundle) && bundle.text === text ? bundle.fields : undefined
}
export function recordTextOpening(tag: string, name: 'text' | 'tspan', fields: () => readonly string[] | undefined): string {
  if (enabled && !tags.has(tag)) {
    const values = fields()
    if (values) retainWrittenFields(tag, name, values, false)
  }
  return tag
}
