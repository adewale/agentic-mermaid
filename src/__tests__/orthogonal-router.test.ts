// The shared orthogonal router: fewest bends, then shortest; never through an
// obstacle; honours required exit/entry directions, corridor-only routing, a
// minimum run between turns, and the lines of routes already drawn.

import { expect, test } from 'bun:test'
import { routeOrthogonal, type OrthogonalRouteRequest, type RouterPoint } from '../layout/orthogonal-router.ts'

const box = { x0: 100, y0: 0, x1: 200, y1: 100 }
const base: OrthogonalRouteRequest = { start: { x: 0, y: 50 }, end: { x: 300, y: 50 }, exit: 'E', entry: 'E', obstacles: [], clearance: 10 }
const bends = (route: readonly RouterPoint[]) => route.length - 2
const length = (route: readonly RouterPoint[]) => route.slice(1).reduce((sum, p, i) => sum + Math.abs(p.x - route[i]!.x) + Math.abs(p.y - route[i]!.y), 0)
const hits = (route: readonly RouterPoint[], b: typeof box) => route.slice(1).some((p, i) => {
  const a = route[i]!
  return Math.max(a.x, p.x) > b.x0 && Math.min(a.x, p.x) < b.x1 && Math.max(a.y, p.y) > b.y0 && Math.min(a.y, p.y) < b.y1
})

test.each([
  { name: 'a clear line stays straight', request: base, bends: 0 },
  { name: 'an obstacle on the line costs the fewest bends around it', request: { ...base, obstacles: [box] }, bends: 4 },
  { name: 'an offset target with a clear corridor needs two bends', request: { ...base, end: { x: 300, y: 200 } }, bends: 2 },
])('$name', ({ request, bends: expected }) => {
  const route = routeOrthogonal(request)!
  expect(route[0]).toEqual(request.start)
  expect(route.at(-1)).toEqual(request.end)
  expect(bends(route)).toBe(expected)
  for (const obstacle of request.obstacles) expect(hits(route, obstacle)).toBe(false)
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
