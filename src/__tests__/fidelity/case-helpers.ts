// Shared vocabulary for fidelity case modules: semantic-JSON narrowing,
// canonical equality, SVG attribute/geometry parsing, and the pinned official
// fence inventory. Case files keep only their family-specific oracles.

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseRegisteredMermaid, serializeMermaid, verifyMermaid } from '../../agent/index.ts'
import type { ParsedDiagram, VerifyResult } from '../../agent/types.ts'
import { UPSTREAM_MERMAID_MANIFEST, type UpstreamSyntaxExample } from '../../upstream-mermaid-manifest.ts'
import type {
  ApplicableFidelitySurfaceExpectation,
  FidelityDisposition,
  FidelityJson,
  NotApplicableFidelitySurfaceExpectation,
  ObservedFidelitySurfaceEvidence,
} from './contract.ts'

export type FidelityRecord = Readonly<Record<string, FidelityJson>>

export function fail(message: string): never {
  throw new Error(message)
}

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Narrow semantic JSON to an object. Evaluators throw on a malformed shape so
 * the runner records the evaluator failure instead of a silent mismatch. */
export function record(value: FidelityJson | undefined, context = 'fidelity evidence'): FidelityRecord {
  if (!isRecord(value)) throw new TypeError(`${context} must be an object`)
  return value as FidelityRecord
}

/** The observed semantic payload of one surface. */
export function facts(evidence: ObservedFidelitySurfaceEvidence): FidelityRecord {
  return record(evidence.semantics, 'semantic evidence')
}

/** Structural JSON equality that ignores object key order. */
export function same(left: unknown, right: unknown): boolean {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .map(([key, item]) => [key, canonical(item)]))
      : value
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
}

export function applicable(
  disposition: FidelityDisposition,
  evaluate: ApplicableFidelitySurfaceExpectation['evaluate'],
  diagnosticCodes: readonly string[] = [],
): ApplicableFidelitySurfaceExpectation {
  return { applicability: 'applicable', disposition, diagnosticCodes, evaluate }
}

export function notApplicable(rationale: string): NotApplicableFidelitySurfaceExpectation {
  return { applicability: 'not-applicable', rationale }
}

export function parsedOrThrow(source: string, context = 'agent parse'): ParsedDiagram {
  const parsed = parseRegisteredMermaid(source)
  if (!parsed.ok) fail(`${context} failed: ${parsed.error.map(error => error.code).join(', ')}`)
  return parsed.value
}

export interface CheckedRoundTrip {
  parsed: ParsedDiagram
  verified: VerifyResult
  serialized: string
  /** serialize(parse(serialized)) reproduces the serialized bytes. */
  stable: boolean
}

/** Parse as `kind`, verify, serialize and reparse, failing the observer when a
 * precondition of the official-fence receipts does not hold. */
export function checkedRoundTrip(source: string, kind: string, context: string): CheckedRoundTrip {
  const parsed = parseRegisteredMermaid(source)
  if (!parsed.ok || parsed.value.body.kind !== kind) fail(`${context} must parse as ${kind}`)
  const verified = verifyMermaid(source)
  if (!verified.ok) fail(`${context} must verify`)
  const serialized = serializeMermaid(parsed.value)
  const reparsed = parseRegisteredMermaid(serialized)
  if (!reparsed.ok) fail(`${context} must reparse`)
  return { parsed: parsed.value, verified, serialized, stable: serializeMermaid(reparsed.value) === serialized }
}

// ---- SVG text --------------------------------------------------------------

const XML_ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" }

export function decodeXml(value: string): string {
  return value.replace(/&(amp|lt|gt|quot|apos|#39);/g, (_, entity: string) => XML_ENTITIES[entity]!)
}

/** Decoded attributes of one start tag. */
export function attrs(tag: string): Record<string, string> {
  return Object.fromEntries([...tag.matchAll(/([A-Za-z_:][-A-Za-z0-9_:.]*)="([^"]*)"/g)]
    .map(match => [match[1]!, decodeXml(match[2]!)]))
}

function hasClass(attributes: Readonly<Record<string, string>>, className: string): boolean {
  return (attributes.class ?? '').split(/\s+/).includes(className)
}

/** Attributes of every `<tag>` carrying `className`, in document order. */
export function tags(svg: string, tag: string, className: string): Record<string, string>[] {
  return [...svg.matchAll(new RegExp(`<${tag}\\b[^>]*>`, 'g'))].map(match => attrs(match[0]))
    .filter(item => hasClass(item, className))
}

/** Like `tags`, plus the element's direct text content when it has no children. */
export function textTags(svg: string, tag: string, className: string): { attributes: Record<string, string>; text: string }[] {
  return [...svg.matchAll(new RegExp(`<${tag}\\b[^>]*>(?:[^<]*<\\/${tag}>)?`, 'g'))]
    .map(match => ({
      attributes: attrs(match[0]),
      text: decodeXml(match[0].match(new RegExp(`>([^<]*)<\\/${tag}>$`))?.[1] ?? ''),
    }))
    .filter(item => hasClass(item.attributes, className))
}

/** Trimmed, tag-stripped text of every `<text>` carrying `className`. */
export function classTexts(svg: string, className: string): string[] {
  return [...svg.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)]
    .filter(match => hasClass(attrs(match[1]!), className))
    .map(match => decodeXml(match[2]!.replace(/<[^>]+>/g, '')).trim())
}

/** Declarations of the embedded stylesheet rule for `.className`, or null. */
export function cssRule(svg: string, className: string): string | null {
  return svg.match(new RegExp(`\\.${className} \\{([^}]*)\\}`))?.[1]?.trim() ?? null
}

// ---- SVG geometry ----------------------------------------------------------

const SVG_NUMBER = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?'

/** A strict SVG number attribute, or NaN (rejects hex, empty and junk). */
export function svgNumber(value: unknown): number {
  if (typeof value !== 'string' || !new RegExp(`^${SVG_NUMBER}$`).test(value)) return NaN
  const number = Number(value)
  return Number.isFinite(number) ? number : NaN
}

/** Parse an SVG `points` list of at least two `x,y` pairs, or null. */
export function svgPoints(value: unknown): readonly (readonly [number, number])[] | null {
  if (typeof value !== 'string') return null
  if (!new RegExp(`^${SVG_NUMBER},${SVG_NUMBER}(?: ${SVG_NUMBER},${SVG_NUMBER})+$`).test(value)) return null
  const points = value.split(' ').map(pair => pair.split(',').map(Number))
  return points.every(point => point.length === 2 && point.every(Number.isFinite)) ? points as [number, number][] : null
}

/** Endpoints and controls of a single cubic ribbon `M x y C x y, x y, x y`. */
export function ribbonPath(d: string): FidelityJson {
  const number = '-?(?:\\d+(?:\\.\\d*)?|\\.\\d+)'
  const match = d.match(new RegExp(`^M (${number}) (${number}) C (${number}) (${number}), (${number}) (${number}), (${number}) (${number})$`))
  if (!match) return { valid: false }
  return { valid: true, start: [Number(match[1]), Number(match[2])],
    control1: [Number(match[3]), Number(match[4])], control2: [Number(match[5]), Number(match[6])],
    end: [Number(match[7]), Number(match[8])] }
}

export function viewBoxOf(svg: string): string | null {
  return svg.match(/<svg\b[^>]*\bviewBox="([^"]+)"/)?.[1] ?? null
}

export interface ViewBox {
  x: number
  y: number
  width: number
  height: number
}

/** A well-formed, positive-area viewBox, or null. */
export function parseViewBox(value: FidelityJson | undefined): ViewBox | null {
  if (typeof value !== 'string') return null
  const parts = value.trim().split(/[\s,]+/).map(svgNumber)
  if (parts.length !== 4 || parts.some(part => !Number.isFinite(part))) return null
  const [x, y, width, height] = parts as [number, number, number, number]
  return width > 0 && height > 0 ? { x, y, width, height } : null
}

/** Point containment in a viewBox, with an optional rounding tolerance. */
export function inViewBox(box: ViewBox, x: number, y: number, tolerance = 0): boolean {
  return Number.isFinite(x) && Number.isFinite(y)
    && x >= box.x - tolerance && x <= box.x + box.width + tolerance
    && y >= box.y - tolerance && y <= box.y + box.height + tolerance
}

// ---- Pinned official syntax pages -----------------------------------------

export const UPSTREAM_DOCS_DIRECTORY = join(import.meta.dir, '..', '..', '..', 'skills', 'agentic-mermaid-diagram-workflow', 'references', 'upstream')

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/** Distinct Mermaid fences of a markdown page in first-occurrence order, the
 * same extraction the upstream manifest generator applies. */
export function extractMermaidFences(markdown: string): string[] {
  const sources: string[] = []
  for (const match of markdown.matchAll(/^```mermaid(?:-example)?[^\S\r\n]*\r?\n([\s\S]*?)\r?\n```[^\S\r\n]*$/gm)) {
    const source = match[1]!.trim()
    if (source && !sources.includes(source)) sources.push(source)
  }
  return sources
}

export interface OfficialFences {
  sources: readonly string[]
  /** Manifest examples, index-aligned with `sources`. */
  examples: readonly UpstreamSyntaxExample[]
}

/** Every fence of one pinned official page, each verified against its
 * manifest example by position and source digest. */
export function officialFences(file: string): OfficialFences {
  const sources = extractMermaidFences(readFileSync(join(UPSTREAM_DOCS_DIRECTORY, file), 'utf8'))
  const examples = UPSTREAM_MERMAID_MANIFEST.semanticInventory.examples
    .filter(example => example.origin === `official-syntax/${file}`)
    .sort((left, right) => left.index - right.index)
  if (sources.length === 0 || sources.length !== examples.length) {
    fail(`Pinned ${file} has ${sources.length} fences but the manifest lists ${examples.length}`)
  }
  for (const [index, source] of sources.entries()) {
    const example = examples[index]!
    if (example.index !== index || example.sourceSha256 !== sha256(source)) {
      fail(`Pinned ${file} fence ${index} differs from manifest example ${example.id}`)
    }
  }
  return { sources, examples }
}
