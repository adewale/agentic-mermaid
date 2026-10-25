import { describe, expect, test } from 'bun:test'
import { coldTrackGroups, combineColdTrackRows, pairedColdTrackSchedule } from '../../eval/benchmark/peer-track-schedule.ts'
import { emptyTrackObservation } from '../../eval/benchmark/peer-tracks.ts'

describe('first-use process scheduling', () => {
  test('comparison sides stay adjacent at each case/probe/ordinal and reverse without changing the population', () => {
    const jobs = pairedColdTrackSchedule(['candidate', 'baseline'], ['flow', 'sequence'], 21, 3, 0)
    expect(jobs).toHaveLength(100)
    const identities = new Set<string>()
    for (let index = 0; index < jobs.length; index += 2) {
      const a = jobs[index]!, b = jobs[index + 1]!
      expect(a.group).toEqual(b.group)
      expect([a.peer, b.peer]).toEqual(index % 4 === 0 ? ['candidate', 'baseline'] : ['baseline', 'candidate'])
      for (const job of [a, b]) identities.add(`${job.peer}/${job.group.ids[0]}/${job.group.probe}/${job.group.sample}`)
    }
    expect(identities.size).toBe(100)
    for (const peer of ['candidate', 'baseline']) for (const id of ['flow', 'sequence']) {
      const groups = jobs.filter(job => job.peer === peer && job.group.ids[0] === id).map(job => job.group)
      expect(groups.filter(group => group.probe === 'timing').map(group => group.sample)).toEqual(Array.from({ length: 21 }, (_, i) => i))
      expect(groups.filter(group => group.probe === 'allocation').map(group => group.sample)).toEqual([0, 1, 2])
      expect(groups.filter(group => group.probe === 'diagnostic')).toHaveLength(1)
    }
    expect(pairedColdTrackSchedule(['candidate', 'baseline'], ['flow'], 21, 3, 1).slice(0, 2).map(job => job.peer)).toEqual(['baseline', 'candidate'])
    expect(coldTrackGroups(['flow', 'sequence'], 21, 3)).toHaveLength(50)
  })

  test('cold aggregation retains timing errors and untimed probes without inventing clocks or discarding failed diagnostics', () => {
    const row = () => emptyTrackObservation('agentic', 0, 'flow5', 'first-use', 'svg-utf8')
    const timed = row()
    timed.calls = [{ index: 0, variant: 0, status: 'ok', elapsedMs: 7, consumedBytes: 42, checksum: 9 }]
    const failed = row()
    failed.calls = [{ index: 0, variant: 0, status: 'error', detail: 'retained failure' }]
    const allocation = row()
    allocation.calls = [{ index: 0, variant: 0, status: 'ok', consumedBytes: 42, checksum: 9 }]
    allocation.allocationSamplesBytes = [123]
    const diagnostic = row()
    diagnostic.diagnostics = { status: 'observed', complete: false, counts: {}, events: [], detail: 'diagnostic failure' }
    const [combined] = combineColdTrackRows('agentic', ['flow5'], { phase: 'first-use', consumer: 'svg-utf8', round: 0, samples: 201, allocationSamples: 3, maxCaseMs: 180000 }, [timed, failed, allocation, diagnostic])
    expect(combined!.calls.map(call => call.index)).toEqual([0, 1, 2])
    expect(combined!.callSamplesMs).toEqual([7])
    expect(combined!.allocationSamplesBytes).toEqual([123])
    expect(combined!.calls[1]!.detail).toBe('retained failure')
    expect(combined!.diagnostics.detail).toBe('diagnostic failure')
    expect(combined!.diagnostics.complete).toBe(false)
    expect(combined!.status).toBe('error')
  })
})
