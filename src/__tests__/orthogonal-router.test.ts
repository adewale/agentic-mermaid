// The shared orthogonal router: fewest bends, then shortest; never through an
// obstacle; honours required (or listed) exit/entry directions, lead headings,
// corridor-only routing, a minimum run between turns, and the lines of routes
// already drawn, which it neither crowds nor, when an equal route exists, crosses.

import { expect, test } from 'bun:test'
import fc from 'fast-check'
import { COST_LIMIT_SLACK, routeOrthogonal, type OrthogonalRouteRequest, type RouterDirection, type RouterPoint } from '../layout/orthogonal-router.ts'
import { fcParameters } from './helpers/fc-parameters.ts'

const box = { x0: 100, y0: 0, x1: 200, y1: 100 }
const base: OrthogonalRouteRequest = { start: { x: 0, y: 50 }, end: { x: 300, y: 50 }, exit: 'E', entry: 'E', obstacles: [], clearance: 10 }
const bends = (route: readonly RouterPoint[]) => route.length - 2
const length = (route: readonly RouterPoint[]) => route.slice(1).reduce((sum, p, i) => sum + Math.abs(p.x - route[i]!.x) + Math.abs(p.y - route[i]!.y), 0)
const on = (point: RouterPoint, a: RouterPoint, b: RouterPoint) => (a.x === b.x ? point.x === a.x : point.y === a.y)
  && point.x >= Math.min(a.x, b.x) && point.x <= Math.max(a.x, b.x) && point.y >= Math.min(a.y, b.y) && point.y <= Math.max(a.y, b.y)
const hits = (route: readonly RouterPoint[], b: typeof box) => route.slice(1).some((p, i) => {
  const a = route[i]!
  return Math.max(a.x, p.x) > b.x0 && Math.min(a.x, p.x) < b.x1 && Math.max(a.y, p.y) > b.y0 && Math.min(a.y, p.y) < b.y1
})

test.each([
  { name: 'a clear line stays straight', request: base, bends: 0 },
  { name: 'an obstacle on the line costs the fewest bends around it', request: { ...base, obstacles: [box] }, bends: 4 },
  { name: 'an offset target with a clear corridor needs two bends', request: { ...base, end: { x: 300, y: 200 } }, bends: 2 },
  // Leaving north must turn twice; listing east as well needs one turn.
  { name: 'listed exit and entry directions admit the cheapest pairing', request: { ...base, end: { x: 300, y: 200 }, stub: 20, channels: { y: [0] }, exit: ['N', 'E'], entry: ['W', 'S'] }, bends: 1 },
  // Straight back west would turn back along both leads. Every detour turns
  // four times counting the turns off and onto the leads; the shortest leaves
  // south and arrives north, turning onto the end lead.
  { name: 'headings forbid turning back along a lead and count turning off it', request: { ...base, start: { x: 0, y: 0 }, end: { x: -100, y: 0 }, exit: ['E', 'S', 'W', 'N'], entry: ['E', 'S', 'W', 'N'], startHeading: 'E', endHeading: 'E', channels: { x: [60, -160], y: [40] } }, bends: 2, corner: { x: 0, y: 40 } },
  // Both Zs are equally long; the one the search would take, at the channel,
  // crosses a drawn segment, so the one at the midpoint wins.
  { name: 'an equal route avoids crossing a drawn segment', request: { ...base, end: { x: 300, y: 150 }, channels: { x: [250] }, crossings: { segments: [[{ x: 220, y: 100 }, { x: 280, y: 100 }]], cost: 5000 } }, bends: 2, corner: { x: 150, y: 50 } },
  // The band blocks the straight run along it; crossing it is free.
  { name: 'a one-axis obstacle blocks runs along it', request: { ...base, channels: { x: [50, 250], y: [150] }, axisObstacles: { horizontal: [box] } }, bends: 4 },
  { name: 'a one-axis obstacle lets a route cross it', request: { ...base, start: { x: 150, y: -50 }, end: { x: 150, y: 150 }, exit: 'S', entry: 'S', axisObstacles: { horizontal: [box] } }, bends: 0 },
  // A stub already leaves along the exit direction, so the route may turn at
  // its end; per-end stubs leave the arrival free.
  { name: 'a route may turn where its start stub ends', request: { ...base, end: { x: 20, y: -100 }, entry: 'N', stub: [20, 0], clearance: 0 }, bends: 1, corner: { x: 20, y: 50 } },
  // Both Zs are equally long; running off the channel costs a little more.
  { name: 'an off-channel cost settles equal routes on a channel', request: { ...base, end: { x: 300, y: 150 }, channels: { x: [250] }, offChannelCost: 0.05 }, bends: 2, corner: { x: 250, y: 50 } },
  // Both Zs are equally long; the listed line costs rank the bend columns.
  { name: 'line costs rank where an equal route bends', request: { ...base, end: { x: 300, y: 150 }, channels: { x: [100, 250] }, channelsOnly: true, lineCosts: { x: [{ at: 100, cost: 0.01 }, { at: 250, cost: 0 }] } }, bends: 2, corner: { x: 250, y: 50 } },
  // Via points are passed in order, under the same rules (no turning back).
  { name: 'via points are passed in order', request: { ...base, via: [{ x: 150, y: 200 }, { x: 250, y: 200 }] }, bends: 4 },
] as { name: string; request: OrthogonalRouteRequest; bends: number; corner?: RouterPoint }[])('$name', ({ request, bends: expected, corner }) => {
  const route = routeOrthogonal(request)!
  expect(route[0]).toEqual(request.start)
  expect(route.at(-1)).toEqual(request.end)
  expect(bends(route)).toBe(expected)
  if (corner) expect(route).toContainEqual(corner)
  for (const obstacle of request.obstacles) expect(hits(route, obstacle)).toBe(false)
  for (const point of request.via ?? []) expect(route.slice(1).some((p, i) => on(point, route[i]!, p))).toBe(true)
  for (let i = 1; i < route.length; i++) expect(route[i]!.x === route[i - 1]!.x || route[i]!.y === route[i - 1]!.y).toBe(true)
})

test('among routes with equally few bends the shorter wins', () => {
  // Around the box both above and below take four bends; below is nearer.
  const route = routeOrthogonal({ ...base, start: { x: 0, y: 80 }, end: { x: 300, y: 80 }, obstacles: [box] })!
  expect(bends(route)).toBe(4)
  expect(Math.max(...route.map(point => point.y))).toBeGreaterThan(box.y1)
  expect(length(route)).toBeLessThan(length(routeOrthogonal({ ...base, start: { x: 0, y: 80 }, end: { x: 300, y: 80 }, obstacles: [box], channels: { y: [-50] }, channelsOnly: true }) ?? [{ x: 0, y: 0 }, { x: 1e6, y: 0 }]))
})

test('corridor-only routing uses only the declared channels', () => {
  const route = routeOrthogonal({ ...base, end: { x: 300, y: 200 }, channels: { x: [250] }, channelsOnly: true })!
  expect(route.filter((point, i) => i > 0 && i < route.length - 1).every(point => point.x === 250)).toBe(true)
})

test('a minimum run forbids a visible tiny jog', () => {
  const jog = { ...base, end: { x: 300, y: 54 } }
  const free = routeOrthogonal(jog)!
  expect(bends(free)).toBe(2)
  expect(Math.abs(free[1]!.y - free[2]!.y)).toBe(4)
  expect(routeOrthogonal({ ...jog, minRun: 12 })).toBeUndefined()
})

test('a route does not share a line with one already drawn', () => {
  const request = { ...base, end: { x: 300, y: 200 }, channels: { x: [150, 250] }, channelsOnly: true }
  const first = routeOrthogonal(request)!
  const used = first[1]!.x
  const drawn = [[{ x: used, y: 120 }, { x: used, y: 300 }]] as const
  const route = routeOrthogonal({ ...request, avoid: { segments: drawn, separation: 6, gap: 24 } })!
  expect(route.some(point => point.x === used)).toBe(false)
  expect(bends(route)).toBe(2)
})

test('a route keeps off a drawn line by running beside it', () => {
  // The midpoint row is the only place to step across, and a drawn segment
  // runs along it near the start; the lines a separation beside it are
  // candidates too.
  const request: OrthogonalRouteRequest = { start: { x: 0, y: 0 }, end: { x: 100, y: 60 }, exit: 'S', entry: 'S', obstacles: [], clearance: 0 }
  const drawn = [[{ x: -50, y: 30 }, { x: 150, y: 30 }]] as const
  const route = routeOrthogonal({ ...request, avoid: { segments: drawn, separation: 8, gap: 24 } })!
  expect(bends(route)).toBe(2)
  expect(route.map(point => point.y)).not.toContain(30)
  expect([22, 38]).toContain(route[1]!.y)
})

test('a caller bounds the search work by throwing from charge', () => {
  let steps = 0
  expect(routeOrthogonal({ ...base, obstacles: [box], charge: () => { steps++ } })).toBeDefined()
  expect(steps).toBeGreaterThan(0)
  expect(() => routeOrthogonal({ ...base, obstacles: [box], charge: () => { throw new Error('budget') } })).toThrow('budget')
})

// A stub is a segment like any other: it may leave the clearance around the
// box its endpoint sits on, or a box its endpoint lies inside (a family that
// grows its own box), but never cross another box on the way to the grid.
const thin = { x0: 2, y0: -10, x1: 5, y1: 10 }
const stubbed: OrthogonalRouteRequest = { start: { x: 0, y: 0 }, end: { x: 100, y: 50 }, exit: 'E', entry: 'E', stub: 8, obstacles: [], clearance: 0 }
test.each([
  { name: 'a start stub may not cross a thin box', request: { ...stubbed, obstacles: [thin] }, routes: false },
  { name: 'nor an end stub', request: { ...stubbed, obstacles: [{ x0: 95, y0: 40, x1: 98, y1: 60 }] }, routes: false },
  { name: 'another exit leaves clear of the thin box', request: { ...stubbed, exit: ['E', 'S'], obstacles: [thin] }, routes: true },
  { name: 'a stub may not cross a box whose clearance holds its endpoint', request: { ...stubbed, clearance: 3, obstacles: [thin] }, routes: false },
  { name: 'but may leave the clearance around its own box', request: { ...stubbed, clearance: 6, stub: 10, obstacles: [{ x0: -40, y0: -20, x1: 0, y1: 20 }] }, routes: true },
  { name: 'or a grown box its endpoint lies inside', request: { ...stubbed, obstacles: [{ x0: -5, y0: -5, x1: 5, y1: 5 }] }, routes: true, own: true },
  { name: 'a band blocks a stub along it', request: { ...stubbed, axisObstacles: { horizontal: [thin] } }, routes: false },
  { name: 'but not a stub across it', request: { ...stubbed, exit: 'S', axisObstacles: { horizontal: [{ x0: -10, y0: 2, x1: 10, y1: 5 }] } }, routes: true },
] as { name: string; request: OrthogonalRouteRequest; routes: boolean; own?: true }[])('$name', ({ request, routes, own }) => {
  const route = routeOrthogonal(request)
  expect(route !== undefined).toBe(routes)
  if (route && !own) for (const obstacle of request.obstacles) expect(hits(route, obstacle)).toBe(false)
})

// The run before a turn at a lead heading includes the stub it turns off.
test.each([
  // Straight down onto the end stub, then east: the last run is 15 + 10.
  { name: 'a straight arrival counts the end stub in the run before the end heading', request: { start: { x: 0, y: 0 }, end: { x: 100, y: 25 }, exit: 'E', entry: 'S', stub: [0, 10], minRun: 20, endHeading: 'E' }, route: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 25 }] },
  // Turning onto the end stub, then off it east: the stub is the whole run.
  { name: 'a turn onto a short end stub cannot turn off it again', request: { start: { x: 0, y: -30 }, end: { x: 100, y: 25 }, exit: 'S', entry: 'S', stub: [0, 10], minRun: 20, endHeading: 'E', channelsOnly: true }, route: undefined },
  { name: 'a turn onto a long enough end stub can', request: { start: { x: 0, y: -30 }, end: { x: 100, y: 35 }, exit: 'S', entry: 'S', stub: [0, 20], minRun: 20, endHeading: 'E', channelsOnly: true }, route: [{ x: 0, y: -30 }, { x: 0, y: 15 }, { x: 100, y: 15 }, { x: 100, y: 35 }] },
  // Turning off the start heading at the start: the stub counts as run.
  { name: 'a turn off the start heading counts the start stub', request: { start: { x: 0, y: 0 }, end: { x: 100, y: 20 }, exit: 'S', entry: 'E', stub: [15, 0], minRun: 20, startHeading: 'E', channelsOnly: true }, route: [{ x: 0, y: 0 }, { x: 0, y: 20 }, { x: 100, y: 20 }] },
] as { name: string; request: Omit<OrthogonalRouteRequest, 'obstacles' | 'clearance'>; route?: RouterPoint[] }[])('$name', ({ request, route }) => {
  expect(routeOrthogonal({ ...request, obstacles: [], clearance: 0 })).toEqual(route)
})

// A search that has not arrived after a few states asks a cheaper
// reachability check whether it can arrive at all, and gives up when it
// cannot. A `charge` budget counts every step the full search checks, so it
// turns the check off: with and without one, every request routes alike.
const lattice = fc.integer({ min: 0, max: 30 }).map(value => value * 10)
const point = fc.record({ x: lattice, y: lattice })
const heading = fc.constantFrom<RouterDirection>('E', 'S', 'W', 'N')
const block = fc.tuple(lattice, lattice, fc.integer({ min: 1, max: 8 }), fc.integer({ min: 1, max: 8 }))
  .map(([x, y, w, h]) => ({ x0: x, y0: y, x1: x + w * 10, y1: y + h * 10 }))
const drawn = fc.tuple(point, fc.integer({ min: 1, max: 10 }), fc.boolean())
  .map(([p, run, vertical]) => [p, vertical ? { x: p.x, y: p.y + run * 10 } : { x: p.x + run * 10, y: p.y }] as const)
const request = fc.record({
  start: point, end: point, exit: heading, entry: heading, obstacles: fc.array(block, { maxLength: 10 }),
  clearance: fc.constantFrom(0, 4), stub: fc.constantFrom(0, 10, 20), via: fc.array(point, { maxLength: 2 }),
  minRun: fc.constantFrom(0, 15), guided: fc.boolean(),
  avoid: fc.option(fc.record({ segments: fc.array(drawn, { maxLength: 4 }), separation: fc.constant(8), gap: fc.constant(16) }), { nil: undefined }),
}) as fc.Arbitrary<OrthogonalRouteRequest>
// The end sits in a walled yard (the clearance closes its corners), so a
// search through the via points visits everything outside before it fails.
const walled: OrthogonalRouteRequest = {
  start: { x: 0, y: 0 }, end: { x: 200, y: 200 }, exit: 'E', entry: 'E', stub: 10, clearance: 4, guided: false, minRun: 0,
  via: [{ x: 300, y: 50 }, { x: 50, y: 300 }],
  obstacles: [{ x0: 140, y0: 140, x1: 260, y1: 160 }, { x0: 140, y0: 240, x1: 260, y1: 260 }, { x0: 140, y0: 160, x1: 160, y1: 240 }, { x0: 240, y0: 160, x1: 260, y1: 240 }],
}
test('giving up on a route that cannot arrive never drops one that can', () => {
  expect(routeOrthogonal(walled)).toBeUndefined()
  fc.assert(fc.property(request, input => {
    expect(routeOrthogonal(input)).toEqual(routeOrthogonal({ ...input, charge: () => {} }))
  }), fcParameters({ numRuns: 300, examples: [[walled]] }))
})

// A caller keeping the cheapest of several routes passes the cost to beat:
// the route within it is unchanged, and one costing more is not searched out.
test('a cost limit keeps the route within it and drops a costlier one', () => {
  fc.assert(fc.property(request, input => {
    const route = routeOrthogonal(input)
    if (!route) return
    const [startStub, endStub] = typeof input.stub === 'object' ? input.stub : [input.stub ?? 0, input.stub ?? 0]
    const cost = bends(route) * 1e4 + length(route) - startStub - endStub
    expect(routeOrthogonal({ ...input, costLimit: cost })).toEqual(route)
    expect(routeOrthogonal({ ...input, costLimit: cost - COST_LIMIT_SLACK - 1 })).toBeUndefined()
  }), fcParameters({ numRuns: 300 }))
})
