// The shared orthogonal router: fewest bends, then shortest; never through an
// obstacle; honours required (or listed) exit/entry directions, lead headings,
// corridor-only routing, a minimum run between turns, and the lines of routes
// already drawn, which it neither crowds nor, when an equal route exists, crosses.

import { expect, test } from 'bun:test'
import { routeOrthogonal, type OrthogonalRouteRequest, type RouterPoint } from '../layout/orthogonal-router.ts'

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
