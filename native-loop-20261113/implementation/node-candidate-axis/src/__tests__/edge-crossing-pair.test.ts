import { describe, expect, test } from 'bun:test'
import { countPolylineCrossings, type CrossingPolyline } from '../shared/edge-crossings.ts'
import { countPolylinePairCrossings } from '../shared/edge-crossing-pair.ts'
import { countPointPairCrossings as countLazyPair } from '../shared/edge-crossing-pair.lazy.ts'

type Coordinate = readonly [number, number]
type MutablePolyline = { points: Array<{ x: number; y: number }>; visible?: boolean }

function route(points: readonly Coordinate[], visible?: boolean): MutablePolyline {
  return { points: points.map(([x, y]) => ({ x, y })), ...(visible === undefined ? {} : { visible }) }
}

function reverse(value: CrossingPolyline): CrossingPolyline {
  return { ...value, points: [...value.points].reverse() }
}

function subdivide(value: CrossingPolyline): CrossingPolyline {
  return { ...value, points: value.points.flatMap((point, index) => {
    const next = value.points[index + 1]
    return next ? [point, { x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 }] : [point]
  }) }
}

function transform(value: CrossingPolyline, scale: number, offset: number): CrossingPolyline {
  return { ...value, points: value.points.map(({ x, y }) => ({ x: x * scale + offset, y: y * scale - offset })) }
}

function parity(first: CrossingPolyline, second: CrossingPolyline, label: string, expected?: number): void {
  // Keep the original general sweep as an independent reference. It must not
  // dispatch to the pair specialization, or this would become a tautology.
  const reference = countPolylineCrossings([first, second])
  if (expected !== undefined) expect({ label, reference }).toEqual({ label, reference: expected })
  expect({ label, crossings: countPolylinePairCrossings(first, second) }).toEqual({ label, crossings: reference })
  if (first.visible !== false && second.visible !== false) expect({ label, lazy: countLazyPair(first.points, second.points) }).toEqual({ label, lazy: reference })
}

function variants(first: CrossingPolyline, second: CrossingPolyline, label: string, expected?: number): void {
  for (const reverseFirst of [false, true]) for (const reverseSecond of [false, true]) for (const swap of [false, true]) {
    const a = reverseFirst ? reverse(first) : first
    const b = reverseSecond ? reverse(second) : second
    parity(swap ? b : a, swap ? a : b, `${label};reverse=${reverseFirst}/${reverseSecond};swap=${swap}`, expected)
  }
}

describe('specialized polyline pair crossing metric', () => {
  test('preserves proper incidences, route endpoints, tangencies and shared ink', () => {
    const horizontal = route([[-100, 0], [100, 0]])
    const fixtures: Array<{ name: string; first: CrossingPolyline; second: CrossingPolyline; expected: number }> = [
      { name: 'proper interior', first: horizontal, second: route([[0, -100], [0, 100]]), expected: 1 },
      { name: 'crossing at internal vertices', first: route([[-100, 0], [0, 0], [100, 0]]), second: route([[0, -100], [0, 0], [0, 100]]), expected: 1 },
      { name: 'two distinct incidences', first: horizontal, second: route([[-50, -100], [-50, 100], [50, 100], [50, -100]]), expected: 2 },
      { name: 'endpoint contact', first: horizontal, second: route([[0, 0], [0, 100]]), expected: 0 },
      { name: 'physical endpoint radius', first: route([[0, 0], [100000, 0]]), second: route([[0.005, -10], [0.005, 10]]), expected: 0 },
      { name: 'outside physical endpoint radius', first: route([[0, 0], [100000, 0]]), second: route([[0.02, -10], [0.02, 10]]), expected: 1 },
      { name: 'internal bend tangency', first: horizontal, second: route([[-50, -100], [0, 0], [50, -100]]), expected: 0 },
      { name: 'collinear shared ink', first: horizontal, second: route([[-50, 0], [50, 0]]), expected: 0 },
      { name: 'self crossings alone do not count', first: route([[-20, -20], [20, 20], [-20, 20], [20, -20]]), second: route([[200, 200], [300, 300]]), expected: 0 },
      { name: 'duplicate subdivision vertex', first: route([[-100, 0], [0, 0], [0, 0], [100, 0]]), second: route([[0, -100], [0, 0], [0, 0], [0, 100]]), expected: 1 },
      { name: 'empty', first: route([]), second: horizontal, expected: 0 },
      { name: 'singleton', first: route([[0, 0]]), second: horizontal, expected: 0 },
      { name: 'all zero length', first: route([[0, 0], [0, 0], [0, 0]]), second: horizontal, expected: 0 },
      { name: 'hidden first', first: { ...horizontal, visible: false }, second: route([[0, -100], [0, 100]]), expected: 0 },
      { name: 'explicit visible', first: { ...horizontal, visible: true }, second: route([[0, -100], [0, 100]]), expected: 1 },
    ]
    for (const fixture of fixtures) {
      variants(fixture.first, fixture.second, fixture.name, fixture.expected)
      variants(subdivide(fixture.first), subdivide(fixture.second), `${fixture.name};subdivided`, fixture.expected)
    }
  })

  test('deduplicates retracing without merging nearby distinct crossing locations', () => {
    const horizontal = route([[-10, 0], [10, 0]])
    const nearby = route([
      [-1, -1], [1, (1 - 0.006) / (1 + 0.006)], [-1, -1],
      [1, 1], [-1, -1], [1, (1 - 0.012) / (1 + 0.012)], [-1, -1],
    ])
    variants(horizontal, nearby, 'three incidences within physical endpoint tolerance', 3)
    variants(subdivide(horizontal), subdivide(nearby), 'subdivided nearby incidences', 3)

    const diagonal = route([[-1990000, 3010000], [2010000, -1990000]])
    const retraced = route([[10000, 10000], [2010000, 2010000], [-1990000, -1990000]])
    variants(diagonal, retraced, 'million-unit retracing', 1)
    variants(subdivide(diagonal), subdivide(retraced), 'million-unit retracing subdivided', 1)
  })

  test('retains numerical vertex topology and very short subdivisions', () => {
    const second = route([[-3, 2], [-2, 0], [1, 3]])
    for (const [endY, expected] of [[0, 0], [3, 1]] as const) {
      const first = route([[-1.98, 0], [0, 2], [-1, endY]])
      variants(first, second, `roundoff vertex endY=${endY}`, expected)
      variants(subdivide(first), subdivide(second), `roundoff vertex subdivided endY=${endY}`, expected)
    }
    for (const halfLength of [1e-2, 1e-6, 1e-10, 1e-13]) {
      variants(route([[0, 0], [0.5 - halfLength, 0], [0.5 + halfLength, 0], [1, 0]]),
        route([[0.5, -1], [0.5, 1]]), `tiny subdivision=${halfLength}`, 1)
    }
    for (const displacement of [-1e-10, 0, 1e-10]) {
      // Near-parallel cancellation and a near-endpoint contact are compared
      // to the reference without inventing a scale-independent topology rule.
      variants(route([[-1000, -1], [1000, 1]]),
        route([[-1000, -1 + displacement], [0, displacement], [1000, 1 - displacement]]), `near parallel=${displacement}`)
    }
  })

  test('agrees across numeric scales and large translations', () => {
    const first = route([[-100, -100], [100, 100], [-100, 100], [100, -100]])
    const second = route([[-75, -150], [-75, 150], [75, 150], [75, -150]])
    for (const scale of [1e-7, 0.1, 1, 1e3, 1e7]) for (const offset of [-1e12, -1e4, 0, 1e4, 1e12]) {
      const a = transform(first, scale, offset), b = transform(second, scale, offset)
      // Physical endpoint tolerance and ULPs can change topology at extreme
      // scales. Exact reference parity, not scale invariance, is the contract.
      variants(a, b, `scale=${scale};offset=${offset}`)
      variants(subdivide(a), subdivide(b), `scale=${scale};offset=${offset};subdivided`)
    }
  })

  test('matches the general metric on deterministic mixed multi-segment routes', () => {
    let state = 0x449c0ffe
    const random = (): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      return state / 0x100000000
    }
    const integer = (limit: number): number => Math.floor(random() * limit)
    const polyline = (mode: number): MutablePolyline => {
      const points: Array<{ x: number; y: number }> = []
      const length = 2 + integer(11)
      for (let index = 0; index < length; index++) {
        const previous = points[index - 1]
        if (previous && random() < 0.15) { points.push({ ...previous }); continue }
        if (points.length > 2 && random() < 0.15) { points.push({ ...points[integer(points.length)]! }); continue }
        const x = integer(41) - 20, y = integer(41) - 20
        points.push(previous && mode === 0
          ? random() < 0.5 ? { x: previous.x, y } : { x, y: previous.y }
          : { x, y })
      }
      return { points }
    }
    for (let index = 0; index < 240; index++) {
      const first = polyline(index % 3), second = polyline((index + 1) % 3)
      if (index % 19 === 0) first.visible = false
      if (index % 23 === 0) second.visible = false
      variants(first, second, `seed=0x449c0ffe;case=${index}`)
      if (index % 4 === 0) variants(subdivide(first), subdivide(second), `seed=0x449c0ffe;case=${index};subdivided`)
    }
  })

  test('does not retain stale segment geometry or leak scratch state between calls', () => {
    const horizontal = route([[-100, 0], [100, 0]])
    const changing = route([[0, -100], [0, 100]])
    parity(horizontal, changing, 'initial', 1)
    changing.points[0]!.x = 200
    changing.points[1]!.x = 200
    parity(horizontal, changing, 'same point and array identities moved', 0)
    changing.points.splice(0, changing.points.length, { x: 0, y: -100 }, { x: 0, y: 100 })
    parity(horizontal, changing, 'same array with replaced points', 1)
    changing.visible = false
    parity(horizontal, changing, 'same object hidden', 0)
    changing.visible = true
    parity(horizontal, changing, 'same object visible again', 1)
    parity(route([]), changing, 'empty after populated state', 0)
    parity(horizontal, changing, 'populated after empty state', 1)
    parity(horizontal, horizontal, 'same route object is shared ink', 0)
    parity(horizontal, changing, 'different pair after shared ink', 1)

    const frozen = (value: CrossingPolyline): CrossingPolyline => Object.freeze({
      ...value, points: Object.freeze(value.points.map(point => Object.freeze({ ...point }))),
    })
    parity(frozen(horizontal), frozen(changing), 'frozen inputs prove no mutation', 1)
  })
})
