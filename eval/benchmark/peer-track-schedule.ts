import { median } from './bench-stats.ts'
import { emptyTrackObservation, finalizeTrackObservation, type PeerTrackObservation } from './peer-tracks.ts'
import type { TrackJob } from './peer-track-worker.ts'

/** First-use processes stay independent; only their serial launch order changes. */
export const PEER_TRACK_SCHEDULES = ['peer-block-v1', 'paired-cold-ordinal-v1'] as const
export type PeerTrackSchedule = (typeof PEER_TRACK_SCHEDULES)[number]
export interface ColdTrackGroup {
  ids: string[]
  probe: 'timing' | 'allocation' | 'diagnostic'
  sample: number
}

export function coldTrackGroups(workloads: readonly string[], coldSamples: number, allocationSamples: number): ColdTrackGroup[] {
  return workloads.flatMap(id => [
    ...Array.from({ length: coldSamples }, (_, sample) => ({ ids: [id], probe: 'timing' as const, sample })),
    ...Array.from({ length: allocationSamples }, (_, sample) => ({ ids: [id], probe: 'allocation' as const, sample })),
    { ids: [id], probe: 'diagnostic' as const, sample: 0 },
  ])
}

/** Group peers in separate processes at the same case/probe/ordinal.
 * Reversing after each ordinal gives AB, BA for two peers, with the opposite
 * starting order next round. No render or probe is added or discarded. */
export function pairedColdTrackSchedule(peers: readonly string[], workloads: readonly string[], coldSamples: number, allocationSamples: number, round: number) {
  return coldTrackGroups(workloads, coldSamples, allocationSamples).flatMap((group, index) =>
    (index + round) % 2 === 0 ? peers.map(peer => ({ peer, group })) : [...peers].reverse().map(peer => ({ peer, group })))
}

export function combineColdTrackRows(peer: string, workloads: readonly string[], track: TrackJob, rows: readonly PeerTrackObservation[], diagnostics: ReadonlyMap<string, PeerTrackObservation['diagnostics']>): PeerTrackObservation[] {
  return workloads.map(id => {
    const parts = rows.filter(row => row.workload === id)
    const row = emptyTrackObservation(peer, track.round, id, track.phase, track.consumer)
    row.calls = parts.flatMap(part => part.calls).map((call, index) => ({ ...call, index }))
    row.allocationSamplesBytes = parts.flatMap(part => part.allocationSamplesBytes)
    row.allocationErrors = parts.flatMap(part => part.allocationErrors ?? [])
    row.diagnostics = diagnostics.get(id) ?? row.diagnostics
    const imports = parts.flatMap(part => part.importMs === undefined ? [] : [part.importMs])
    const setups = parts.flatMap(part => part.setupMs === undefined ? [] : [part.setupMs])
    if (imports.length) row.importMs = median(imports)
    if (setups.length) row.setupMs = median(setups)
    if (!row.allocationSamplesBytes.length) row.allocationUnsupported = parts.find(part => part.allocationUnsupported)?.allocationUnsupported
    return finalizeTrackObservation(row)
  })
}
