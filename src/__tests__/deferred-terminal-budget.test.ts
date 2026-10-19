import '../index.ts'
import { describe, expect, test } from 'bun:test'
import * as marks from '../scene/marks.ts'
import { snapshotSvgEmissionRecipe, svgValue as v } from '../scene/svg-emission.ts'
import { deferredTerminalProjectionInput, withDeferredTerminalProjections } from '../scene/deferred-terminal-projection.ts'
import { EXTERNAL_SCENE_DOCUMENT_SNAPSHOT_LIMITS, freezeBoundedFirstPartyData, snapshotBoundedExternalData, type ExternalDataSnapshotLimits } from '../scene/external-data-snapshot.ts'

const defaults = EXTERNAL_SCENE_DOCUMENT_SNAPSHOT_LIMITS
const aggregateCaps = ['maxObjects', 'maxTextBytes', 'maxAggregateArrayEntries', 'maxAggregateProperties', 'maxAggregatePropertyKeyBytes'] as const

const noteEmission = snapshotSvgEmissionRecipe({ kind: 'primitive', attributes: [
  { name: 'x', value: v.geometry('x') }, { name: 'y', value: v.geometry('y') },
  { name: 'width', value: v.geometry('width') }, { name: 'height', value: v.geometry('height') },
  { name: 'data-note', value: v.meta('東京 & "é"') }, { name: 'fill', value: v.paint('fill') },
] })

function fixture(defer: boolean, reverse = false, typed = false) {
  const geometry = { kind: 'polyline' as const, points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }] }
  const marker = { id: 'shared-mid-and-end', shape: 'circle' as const, size: { width: 4, height: 4 }, paint: { fill: '#111' } }
  const build = () => Array.from({ length: 8 }, (_, index) => marks.connector({
    id: `e${index}`, role: 'edge', geometry, lineStyle: 'dashed',
    paint: { stroke: '#111', strokeDasharray: '4 2' },
    markers: { start: marker, mid: [marker], end: marker },
    endpoints: { from: `from${index}`, to: `to${index}` },
    labels: [{ text: `Label ${index} 東京`, anchor: { x: 10, y: 0 } }],
  }))
  const parts = defer ? withDeferredTerminalProjections(build) : build()
  const notes = typed ? [0, 1].map(index => marks.shape({ id: `note${index}`, role: 'chrome',
    geometry: { kind: 'rect', x: index, y: 0, width: 1, height: 1 }, paint: { fill: '#111' },
  }, noteEmission)) : undefined
  return { prefix: 'before connectors', parts: reverse ? parts.reverse() : parts,
    ...(notes ? { notes } : {}), suffix: 'after connectors' }
}

function outcome(defer: boolean, limits: ExternalDataSnapshotLimits, reverse = false, typed = false): string {
  try { freezeBoundedFirstPartyData(fixture(defer, reverse, typed), limits); return 'accepted' }
  catch (error) { return error instanceof Error ? error.message : String(error) }
}

/** Independent external-descriptor admission supplies the exact threshold,
 * including shared references; do not reproduce reservation arithmetic here. */
function exactBoundary(field: typeof aggregateCaps[number], reverse: boolean, typed = false): number {
  let low = 0, high = defaults[field]
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    try { snapshotBoundedExternalData(fixture(false, reverse, typed), { ...defaults, [field]: middle }); high = middle }
    catch { low = middle + 1 }
  }
  return low
}

describe('deferred terminal resource accounting', () => {
  test.each(aggregateCaps.map(field => [field] as const))('%s retains exact acceptance and rejection across shared connectors in either order', field => {
    for (const reverse of [false, true]) {
      const boundary = exactBoundary(field, reverse)
      for (const limit of [boundary - 1, boundary]) {
        const limits = { ...defaults, [field]: limit }
        const eager = outcome(false, limits, reverse)
        expect(outcome(true, limits, reverse), `${field}=${limit}, reverse=${reverse}`).toBe(eager)
        expect(eager === 'accepted').toBe(limit === boundary)
      }
    }
  })

  test.each(aggregateCaps.map(field => [field] as const))('%s includes private typed metadata when deferred reservations require exact recount', field => {
    for (const reverse of [false, true]) {
      const boundary = exactBoundary(field, reverse, true)
      for (const limit of [boundary - 1, boundary]) {
        const limits = { ...defaults, [field]: limit }
        const eager = outcome(false, limits, reverse, true)
        expect(outcome(true, limits, reverse, true), `${field}=${limit}, reverse=${reverse}`).toBe(eager)
        expect(eager === 'accepted').toBe(limit === boundary)
      }
      // A failed admission cannot leave counter/deduplication state behind.
      expect(outcome(true, { ...defaults, [field]: boundary }, reverse, true)).toBe('accepted')
    }
  })

  test('an oversized suffix cannot recursively drain a large reservation queue', () => {
    const limits = { ...defaults, maxObjects: 10_000_000, maxAggregateArrayEntries: 10_000_000,
      maxAggregateProperties: 50_000_000, maxAggregatePropertyKeyBytes: 500_000_000, maxTextBytes: 16_000_000 }
    const suffix = 'x'.repeat(limits.maxTextBytes + 1)
    const geometry = { kind: 'line' as const, x1: 0, y1: 0, x2: 1, y2: 1 }
    const build = () => Array.from({ length: 1000 }, (_, index) => marks.connector({ id: `e${index}`, role: 'edge', geometry, lineStyle: 'solid', paint: {} }))
    const parts = withDeferredTerminalProjections(build)
    freezeBoundedFirstPartyData({ parts }, limits)
    expect(parts.every(node => deferredTerminalProjectionInput(node) !== undefined)).toBe(true)
    const result = (value: unknown): string => {
      try { freezeBoundedFirstPartyData(value, limits); return 'accepted' }
      catch (error) { return `${error instanceof Error ? error.name : typeof error}: ${error instanceof Error ? error.message : String(error)}` }
    }
    const eager = result({ parts: build(), suffix })
    expect(eager).toBe(`Error: External Scene text values exceed the aggregate ${limits.maxTextBytes}-byte limit`)
    expect(result({ parts, suffix })).toBe(eager)
  })

  test('a near-cap connector batch reclaims only enough reservations and keeps unrelated projections deferred', () => {
    const value = fixture(true)
    expect(value.parts.every(node => deferredTerminalProjectionInput(node) !== undefined)).toBe(true)
    freezeBoundedFirstPartyData(value, { ...defaults, maxObjects: 2000 })
    const pending = value.parts.filter(node => deferredTerminalProjectionInput(node) !== undefined)
    expect(pending.length).toBeGreaterThan(0)
    expect(pending.length).toBeLessThan(value.parts.length)
    for (const node of value.parts) {
      const projection = node.terminalProjection
      expect(node.terminalProjection).toBe(projection)
      expect(Object.isFrozen(projection)).toBe(true)
    }
  })
})
