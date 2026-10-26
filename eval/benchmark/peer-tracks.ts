/** Maintained peer protocol. Timing consumes all bytes; independent, bounded
 * semantic checks run after the clock. This is not a visual-equivalence oracle. */
import { decodeXML } from 'entities'
import { median } from './bench-stats.ts'
import { inspectPeleSemantics, PELE_SEMANTIC_ADAPTER } from './pele-semantics.ts'

export const PEER_FROZEN_COHORT = Object.freeze(['flow5', 'tree50', 'mesh50', 'seq20', 'class80', 'er40', 'state80'] as const)
export const PEER_PHASES = Object.freeze(['first-use', 'warm-new-source', 'exact-repeat', 'label-edit'] as const)
export const PEER_CONSUMERS = Object.freeze(['svg-utf8', 'receipt-json-utf8'] as const)
const range = (prefix: string, count: number) => Array.from({ length: count }, (_, i) => `${prefix}${i}`)
/** One enrollment owner, shared by the legacy timer and calibrated gates. */
export const PEER_EXPECTED_LABELS: Record<string, readonly string[]> = {
  flow5: ['Start', 'Check', 'Do it', 'Skip', 'End'], tree50: range('Node ', 50), mesh50: range('label ', 20), seq20: range('message ', 20),
  c4: ['User', 'Email', 'Uses', 'Sends'], class80: range('C', 80), er40: range('E', 40), state80: range('S', 81), packet240: range('Field ', 240),
  kanban240: Array.from({ length: 12 }, (_, stage) => [`Stage ${stage}`, ...Array.from({ length: 20 }, (_, task) => `Task ${stage}.${task}`)]).flat(),
  requirement100: range('Requirement ', 100), treemap260: ['Product allocation', ...range('Group ', 20)],
  ishikawa133: ['Delayed delivery', ...Array.from({ length: 12 }, (_, category) => [`Category ${category}`, ...Array.from({ length: 10 }, (_, cause) => `Cause ${category}.${cause}`)]).flat()],
  block120: range('Component ', 120),
}
/** Only known execution settings, never the process environment or secrets. */
export function peerExecutionEnvironment(env: Record<string, string | undefined>) {
  return { experiments: env.AGENTIC_MERMAID_EXPERIMENTS ?? null, nodeOptions: env.NODE_OPTIONS ?? null, bunOptions: env.BUN_OPTIONS ?? null, nodeEnv: env.NODE_ENV ?? null, timezone: env.TZ ?? null }
}
export type PeerPhase = (typeof PEER_PHASES)[number]
export type PeerConsumer = (typeof PEER_CONSUMERS)[number]
export type PeerStatus = 'ok' | 'lost-labels' | 'unsupported' | 'error'
export interface PeerSemantic { ok: boolean; checks: string[]; unsupported: string[]; failures: string[] }
export type PeerVariantDomain = 'timing' | 'warmup' | 'allocation' | 'diagnostic'
export const PEER_VARIANT_DOMAINS = Object.freeze({ timing: Object.freeze({ label: 'q', identity: 'v' }), warmup: Object.freeze({ label: 'w', identity: 'w' }), allocation: Object.freeze({ label: 'a', identity: 'a' }), diagnostic: Object.freeze({ label: 'd', identity: 'd' }) } as const)
export interface PeerCallObservation {
  index: number; variant: number; domain?: PeerVariantDomain; status: PeerStatus; elapsedMs?: number; consumedBytes?: number; checksum?: number; missing?: number; detail?: string; semantic?: PeerSemantic
}
export interface PeerTrackObservation {
  peer: string; round: number; workload: string; phase: PeerPhase; consumer: PeerConsumer; status: PeerStatus
  callSamplesMs: number[]; allocationSamplesBytes: number[]; p50Ms?: number; p95Ms?: number; insufficientSamples: boolean
  counts: { ok: number; unsupported: number; lostLabels: number; errors: number }
  semantic: PeerSemantic
  diagnostics: { status: 'observed' | 'unobserved'; complete: boolean; counts: Record<string, number>; events: Record<string, unknown>[]; detail?: string }
  warmup?: { calls: number; elapsedMs: number; complete: boolean }
  calls: PeerCallObservation[]; importMs?: number; setupMs?: number; detail?: string; allocationUnsupported?: string; allocationErrors?: string[]
}
export interface PeerTrackReport {
  schemaVersion: 1; contractVersion: 'semantic-peer-v1'; cohort: readonly string[]; phases: readonly PeerPhase[]
  consumers: readonly PeerConsumer[]; scaling: readonly string[]; observations: PeerTrackObservation[]
}
export interface TrackInput { id: string; source: string; expected: readonly string[]; svgLabelPrefixes?: readonly string[] }
export interface TrackVariant extends TrackInput { variant: number; domain: PeerVariantDomain }

export function parsePeerTracks(value: string | undefined): PeerPhase[] {
  if (value === undefined) return []
  if (value === 'all') return [...PEER_PHASES]
  const selected = [...new Set(value.split(',').map(item => item.trim()))]
  if (!selected.length || selected.some(item => !(PEER_PHASES as readonly string[]).includes(item))) throw new Error(`--tracks must be all or a list of ${PEER_PHASES.join(',')}`)
  return selected as PeerPhase[]
}

export function parsePeerConsumers(value: string | undefined): PeerConsumer[] {
  if (value === undefined || value === 'all') return [...PEER_CONSUMERS]
  const selected = [...new Set(value.split(',').map(item => item.trim()))]
  if (!selected.length || selected.some(item => !(PEER_CONSUMERS as readonly string[]).includes(item))) throw new Error(`--track-consumers must be all or a list of ${PEER_CONSUMERS.join(',')}`)
  return selected as PeerConsumer[]
}

/** Real edits of visible text; relationship edits preserve graph identity.
 * New-source additionally renames the seven graph fixtures' authored IDs.
 * Other families change a real label, never a comment/cache-busting suffix. */
export function peerTrackVariant(input: TrackInput, phase: PeerPhase, variant: number, domain: PeerVariantDomain = 'timing'): TrackVariant {
  if (phase === 'first-use' || phase === 'exact-repeat') return { ...input, variant: 0, domain }
  const previous = input.expected[0]
  if (!previous) throw new Error(`No authored label-edit contract for ${input.id}`)
  const prefixes = PEER_VARIANT_DOMAINS[domain]
  const label = `${prefixes.label}${variant.toString(36)}`
  let source = input.source
  let expected = [...input.expected]
  if (input.id === 'class80') {
    source = source.replace(/^([ \t]*C\d+[ \t]*<\|--[ \t]*C\d+)(?:[ \t]*:.*)?$/m, `$1 : ${label}`)
    expected.push(label)
  } else if (input.id === 'er40') {
    source = source.replace(/^([ \t]*E\d+[ \t]*\|\|--o\{[ \t]*E\d+)[ \t]*:.*$/m, `$1 : ${label}`)
    expected.push(label)
  } else if (input.id === 'state80') {
    source = source.replace(/^([ \t]*S\d+[ \t]*-->[ \t]*S\d+)[ \t]*:.*$/m, `$1 : ${label}`)
    expected.push(label)
  } else {
    if (!source.includes(previous)) throw new Error(`Authored label ${previous} absent from ${input.id}`)
    source = source.replaceAll(previous, label)
    expected = input.expected.map(item => item === previous ? label : item)
  }
  if (source === input.source) throw new Error(`Label edit did not change ${input.id}`)
  if (phase === 'warm-new-source' && /^(?:flow5|tree\d+|mesh\d+|seq20|seq300|class80|er40|state80)$/.test(input.id)) {
    const rename = (text: string) => text.replace(/\b(?:[A-E]|n\d+|P\d+|C\d+|E\d+|S\d+)\b/g, id => `${prefixes.identity}${variant}_${id}`)
    source = rename(source)
    expected = expected.map(rename)
  }
  return { ...input, source, expected, variant, domain }
}

/** Source syntax is intentionally bounded to these synthetic fixture families,
 * not a second Mermaid parser. Endpoint pair presence/direction is checked when
 * SVG exposes data-from/data-to; other peers explicitly lack that contract. */
function authoredRelations(input: TrackInput): Array<[string, string]> | undefined {
  const id = '([A-Za-z_][\\w]*)'
  const text = '(?:\\[[^\\]\\n]*\\]|\\{[^}\\n]*\\})?'
  let pattern: RegExp
  if (/^(flow5|tree\d+|mesh\d+)$/.test(input.id)) pattern = new RegExp(`${id}${text}\\s*-->\\s*(?:\\|[^|]*\\|\\s*)?${id}`, 'g')
  else if (input.id === 'seq20' || input.id === 'seq300') pattern = new RegExp(`${id}->>${id}`, 'g')
  else if (input.id === 'class80') pattern = new RegExp(`${id}\\s*<\\|--\\s*${id}`, 'g')
  else if (input.id === 'er40') pattern = new RegExp(`${id}\\s*\\|\\|--o\\{\\s*${id}`, 'g')
  else if (input.id === 'state80') pattern = new RegExp(`${id}\\s*-->\\s*${id}`, 'g')
  else return undefined
  return [...input.source.matchAll(pattern)].map(match => [match[1]!, match[2]!])
}

export function inspectPeerSemantics(svg: string, input: TrackInput, requireIdentity = false, semanticAdapter?: string): PeerSemantic {
  const result: PeerSemantic = { ok: true, checks: [], unsupported: [], failures: [] }
  // XML parsing is separately performed by resvg in the worker. A label-only
  // SVG with no drawable geometry must fail even when all labels are present.
  const drawing = svg.replace(/<defs\b[^>]*>[\s\S]*?<\/defs>/g, '')
  const tags = [...drawing.matchAll(/<(rect|path|circle|ellipse|line|polyline|polygon)\b[^>]*>/g)]
  const attr = (tag: string, name: string) => decodeXML(tag.match(new RegExp(`\\s${name}=["']([^"']*)["']`))?.[1] ?? '')
  const nonempty = tags.some(([tag, kind]) => {
    const positive = (name: string) => Number.parseFloat(attr(tag, name)) > 0
    if (kind === 'rect') return positive('width') && positive('height')
    if (kind === 'circle') return positive('r')
    if (kind === 'ellipse') return positive('rx') && positive('ry')
    if (kind === 'path') return /[LlHhVvCcSsQqTtAa]/.test(attr(tag, 'd'))
    if (kind === 'line') return attr(tag, 'x1') !== attr(tag, 'x2') || attr(tag, 'y1') !== attr(tag, 'y2')
    return attr(tag, 'points').trim().split(/[\s,]+/).length >= 4
  })
  if (nonempty) result.checks.push('nonempty drawable geometry')
  else result.failures.push('no nonempty drawable geometry')
  const expected = authoredRelations(input)
  if (semanticAdapter !== undefined) {
    const adapted: PeerSemantic = semanticAdapter === PELE_SEMANTIC_ADAPTER.id ? inspectPeleSemantics(svg, input, expected)
      : { ok: false, checks: [], unsupported: [`unknown rendered semantic adapter: ${semanticAdapter}`], failures: [] }
    return { ok: result.failures.length === 0 && adapted.ok, checks: [...result.checks, ...adapted.checks], failures: [...result.failures, ...adapted.failures], unsupported: adapted.unsupported }
  }
  if (expected === undefined) result.unsupported.push('authored identity/endpoint contract unavailable for this family')
  else {
    // Beautiful's ER emitter names source entities explicitly rather than
    // using the flowchart/sequence data-from/data-to convention.
    const actual = [...svg.matchAll(/<[A-Za-z][^>]*\s(?:data-from|data-entity1)=["'][^"']*["'][^>]*>/g)].map(([tag]) => [attr(tag, 'data-from') || attr(tag, 'data-entity1'), attr(tag, 'data-to') || attr(tag, 'data-entity2')] as [string, string])
    const ids = new Set([...svg.matchAll(/\sdata-id=["']([^"']*)["']/g)].map(match => decodeXML(match[1]!)))
    if (!actual.length) (requireIdentity ? result.failures : result.unsupported).push('peer does not expose data-from/data-to relations')
    else {
      const seen = new Set(actual.map(pair => JSON.stringify(pair)))
      const missing = expected.filter(pair => !seen.has(JSON.stringify(pair)))
      if (missing.length) result.failures.push(`${missing.length} authored directed endpoint pairs absent`)
      else result.checks.push(`${expected.length} authored directed endpoint pairs`)
      // Duplicate edge-label wrappers make exact multiplicity unavailable.
      result.unsupported.push('edge multiplicity and endpoint attachment geometry not asserted')
    }
    if (!ids.size) (requireIdentity ? result.failures : result.unsupported).push('peer does not expose authored data-id identities')
    else {
      const missing = [...new Set(expected.flat())].filter(id => !ids.has(id))
      if (missing.length) result.failures.push(`${missing.length} authored node identities absent`)
      else result.checks.push(`${new Set(expected.flat()).size} authored node identities`)
    }
  }
  result.ok = result.failures.length === 0 && (expected === undefined || !result.unsupported.some(item => item.startsWith('peer does not expose')))
  return result
}

export function consumePeerOutput(value: unknown, consumer: PeerConsumer): { svg: string; bytes: number; checksum: number } {
  const svg = consumer === 'svg-utf8' ? value : (value as { svg?: unknown } | null)?.svg
  if (typeof svg !== 'string' || !/^\s*(?:<\?xml[^>]*\?>\s*)?<svg\b/.test(svg)) throw new Error('returned no SVG')
  if (consumer === 'receipt-json-utf8' && !Object.prototype.hasOwnProperty.call(value, 'receipt')) throw new Error('returned no complete receipt')
  const bytes = Buffer.from(consumer === 'svg-utf8' ? svg : JSON.stringify(value), 'utf8')
  let checksum = 0
  for (let index = 0; index < bytes.length; index++) checksum = (Math.imul(checksum, 31) + bytes[index]!) >>> 0
  ;(globalThis as { __peerTrackSink?: unknown }).__peerTrackSink = { bytes, checksum }
  return { svg, bytes: bytes.length, checksum }
}

export function percentile(values: readonly number[], fraction: number): number | undefined {
  if (!values.length) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)]
}

export function emptyTrackObservation(peer: string, round: number, workload: string, phase: PeerPhase, consumer: PeerConsumer): PeerTrackObservation {
  return { peer, round, workload, phase, consumer, status: 'ok', callSamplesMs: [], allocationSamplesBytes: [], insufficientSamples: true, counts: { ok: 0, unsupported: 0, lostLabels: 0, errors: 0 }, semantic: { ok: true, checks: [], unsupported: [], failures: [] }, diagnostics: { status: 'unobserved', complete: false, counts: {}, events: [] }, calls: [] }
}
export function finalizeTrackObservation(row: PeerTrackObservation): PeerTrackObservation {
  row.callSamplesMs = row.calls.flatMap(call => call.status === 'ok' && call.elapsedMs !== undefined ? [call.elapsedMs] : [])
  row.counts = { ok: 0, unsupported: 0, lostLabels: 0, errors: 0 }
  for (const call of row.calls) row.counts[call.status === 'error' ? 'errors' : call.status === 'lost-labels' ? 'lostLabels' : call.status]++
  row.status = row.counts.errors ? 'error' : row.counts.lostLabels ? 'lost-labels' : row.counts.unsupported ? 'unsupported' : 'ok'
  row.p50Ms = row.callSamplesMs.length ? median(row.callSamplesMs) : undefined
  row.p95Ms = percentile(row.callSamplesMs, 0.95)
  row.insufficientSamples = row.callSamplesMs.length < 20
  const semantics = row.calls.flatMap(call => call.semantic ? [call.semantic] : [])
  row.semantic = { ok: semantics.length > 0 && semantics.every(item => item.ok), checks: [...new Set(semantics.flatMap(item => item.checks))], unsupported: [...new Set(semantics.flatMap(item => item.unsupported))], failures: [...new Set(semantics.flatMap(item => item.failures))] }
  if (row.allocationErrors?.length) { row.status = 'error'; row.detail = `${row.allocationErrors.length} allocation observations failed` }
  return row
}

/** Canonical installed runtime graph; artifact paths and root package versions
 * cannot manufacture a dependency difference between identical installations. */
export function peerRuntimeDependencyGraph(lock: { packages?: Record<string, { version?: string; integrity?: string; link?: boolean }> }) {
  return Object.entries(lock.packages ?? {}).filter(([path]) => path && path !== 'node_modules/agentic-mermaid').sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([path, value]) => ({ path, version: value.version ?? null, integrity: value.integrity ?? null, link: value.link ?? false }))
}
