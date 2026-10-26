import './ci-policy-enforce.ts'
import { consumePeerOutput, emptyTrackObservation, finalizeTrackObservation, inspectPeerSemantics, peerTrackVariant } from './peer-tracks.ts'
import type { PeerConsumer, PeerPhase, PeerStatus, PeerTrackObservation, TrackInput, TrackVariant, PeerVariantDomain } from './peer-tracks.ts'
import type { PELE_SEMANTIC_ADAPTER } from './pele-semantics.ts'

type Render = (source: string) => unknown
export interface TrackJob {
  semanticAdapter?: typeof PELE_SEMANTIC_ADAPTER.id
  phase: PeerPhase; consumer: PeerConsumer; round: number; samples: number; allocationSamples: number; maxCaseMs: number; warmCalls?: number; warmupMs?: number; coldSamples?: number; coldProbe?: 'timing' | 'allocation' | 'diagnostic'
}
const firstLine = (error: unknown) => String(error instanceof Error ? error.message : error).split('\n')[0]!
// A rejected call is an error here; the controller's family probe decides unsupported families.
const thenable = (value: unknown): value is PromiseLike<unknown> => typeof (value as PromiseLike<unknown> | null)?.then === 'function'

/** No observer is present during clocks or GCProfiler probes. Every timed
 * observation is one call, never a calibrated batch average. */
export async function measurePeerTrack(options: {
  peer: string; input: TrackInput; track: TrackJob; render?: Render
  allocation?: (run: () => unknown) => Promise<number>
  validate(svg: string, input: TrackInput): { missing: string[]; error?: string }
  progress?(row: PeerTrackObservation): void
}): Promise<PeerTrackObservation> {
  const { peer, input, track, render, allocation, validate } = options
  const row = emptyTrackObservation(peer, track.round, input.id, track.phase, track.consumer)
  if (!render) {
    row.calls.push({ index: 0, variant: 0, status: 'unsupported', detail: 'peer has no complete serialized receipt API' })
    return finalizeTrackObservation(row)
  }
  const observerKey = Symbol.for('agentic-mermaid.performance-observer.v1')
  const global = globalThis as unknown as Record<symbol, unknown>
  const priorObserver = global[observerKey]
  delete global[observerKey]
  const counters: Record<PeerVariantDomain, number> = { timing: 0, warmup: 0, allocation: 0, diagnostic: 0 }
  let latest: TrackVariant | undefined
  const next = (domain: PeerVariantDomain): TrackVariant => {
    const ordinal = ++counters[domain]
    // Edit tracks prime fresh inputs just as they measure fresh inputs. Cycling
    // a small working set would prime cache hits before a stream of misses.
    return latest = peerTrackVariant(input, track.phase, ordinal, domain)
  }
  const invoke = async (variant: TrackVariant) => {
    const start = performance.now()
    let value = render(variant.source)
    if (thenable(value)) value = await value
    const consumed = consumePeerOutput(value, track.consumer)
    return { ...consumed, elapsedMs: performance.now() - start }
  }
  const inspect = (svg: string, variant: TrackVariant) => {
    const checked = validate(svg, variant)
    const semantic = inspectPeerSemantics(svg, variant, peer === 'agentic' || peer.startsWith('agentic-'), track.semanticAdapter)
    const status: PeerStatus = checked.error || semantic.failures.length ? 'error' : checked.missing.length ? 'lost-labels' : 'ok'
    return { status, semantic, ...(checked.missing.length ? { missing: checked.missing.length, detail: checked.missing.slice(0, 3).join(', ') } : {}), ...(checked.error || semantic.failures.length ? { detail: checked.error ?? semantic.failures.join('; ') } : {}) }
  }
  try {
    // Exact-repeat is deliberately primed at identical bytes; edit phases are
    // primed at a different real input. First-use performs no earlier render.
    if (track.phase !== 'first-use') {
      const warmStarted = performance.now()
      let warm = 0
      const primed = () => warm >= (track.warmCalls ?? 3) && performance.now() - warmStarted >= (track.warmupMs ?? 0)
      while (!primed()) {
        const variant = next('warmup')
        const result = await invoke(variant)
        const checked = inspect(result.svg, variant)
        row.warmup = { calls: ++warm, elapsedMs: performance.now() - warmStarted, complete: false }
        if (checked.status !== 'ok') {
          row.calls.push({ index: -warm, variant: variant.variant, domain: variant.domain, elapsedMs: result.elapsedMs, ...checked, detail: checked.detail ?? 'warmup failed semantic/label validation' })
          return finalizeTrackObservation(row)
        }
        if (!primed() && row.warmup.elapsedMs >= track.maxCaseMs) throw new Error('warmup reached its case deadline before the required priming completed')
      }
      row.warmup = { calls: warm, elapsedMs: performance.now() - warmStarted, complete: true }
    }
    const coldProbe = track.phase === 'first-use' ? track.coldProbe ?? 'timing' : undefined
    const started = performance.now()
    for (let index = 0; index < (coldProbe ? coldProbe === 'timing' ? 1 : 0 : track.samples); index++) {
      const variant = next('timing')
      try {
        const result = await invoke(variant)
        row.calls.push({ index, variant: variant.variant, domain: variant.domain, elapsedMs: result.elapsedMs, consumedBytes: result.bytes, checksum: result.checksum, ...inspect(result.svg, variant) })
      } catch (error) {
        const detail = firstLine(error)
        row.calls.push({ index, variant: variant.variant, domain: variant.domain, status: 'error', detail })
      }
      options.progress?.(row)
      if (performance.now() - started > track.maxCaseMs) break
    }
    if (coldProbe && coldProbe !== 'allocation') row.allocationUnsupported = 'first-use allocation requires a separate fresh-process observation; warm probes are not equivalent'
    else if (!allocation) row.allocationUnsupported = 'runtime has no V8 GC-boundary allocation probe'
    else for (let index = 0; index < (coldProbe === 'allocation' ? 1 : track.allocationSamples); index++) {
      const variant = next('allocation')
      let result: Awaited<ReturnType<typeof invoke>> | undefined
      try {
        const bytes = await allocation(async () => { result = await invoke(variant) })
        const checked = inspect(result!.svg, variant)
        if (checked.status !== 'ok') throw new Error(checked.detail ?? `allocation observation ${checked.status}`)
        row.allocationSamplesBytes.push(bytes)
        if (coldProbe === 'allocation') row.calls.push({ index: 0, variant: variant.variant, domain: variant.domain, consumedBytes: result!.bytes, checksum: result!.checksum, ...checked })
      } catch (error) { (row.allocationErrors ??= []).push(firstLine(error)) }
    }
    if (coldProbe && coldProbe !== 'diagnostic') row.diagnostics.detail = 'cold diagnostic replay needs another fresh process; this worker has already rendered'
    else {
      global[observerKey] = (event: Record<string, unknown>) => {
        if (event?.version !== 1 || !['scope', 'cache', 'fallback'].includes(String(event.kind))) return
        if (event.kind === 'scope' && event.owner === 'graphical') row.diagnostics.status = 'observed'
        const key = [event.kind, event.owner, event.outcome, event.reason].filter(value => value !== undefined).join(':')
        row.diagnostics.counts[key] = (row.diagnostics.counts[key] ?? 0) + 1
        if (row.diagnostics.events.length < 100) row.diagnostics.events.push({ ...event })
      }
      try {
        const variant = next('diagnostic')
        const result = await invoke(variant)
        delete global[observerKey]
        const checked = inspect(result.svg, variant)
        if (checked.status !== 'ok') throw new Error(checked.detail ?? checked.status)
        if (coldProbe === 'diagnostic') row.calls.push({ index: 0, variant: variant.variant, domain: variant.domain, consumedBytes: result.bytes, checksum: result.checksum, ...checked })
        row.diagnostics.complete = row.diagnostics.status === 'observed'
      } catch (error) { row.diagnostics.complete = false; row.diagnostics.detail = firstLine(error) }
      delete global[observerKey]
    }
  } catch (error) {
    const detail = firstLine(error)
    row.calls.push({ index: row.calls.length, variant: latest?.variant ?? 0, domain: latest?.domain, status: 'error', detail })
  } finally {
    if (priorObserver === undefined) delete global[observerKey]
    else global[observerKey] = priorObserver
  }
  finalizeTrackObservation(row)
  const expected = track.phase === 'first-use' ? (track.coldProbe ?? 'timing') === 'timing' ? 1 : 0 : track.samples
  if (row.status === 'ok' && row.callSamplesMs.length !== expected) {
    row.status = 'error'
    row.detail = `incomplete timing population: expected ${expected}, observed ${row.callSamplesMs.length}`
  }
  return row
}
