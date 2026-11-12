import { describe, expect, test } from 'bun:test'
import { OccupancyMap } from '../ascii/occupancy.ts'
import { getClearAxisPath, getPath } from '../ascii/pathfinder.ts'
import { Down, Left, Right, Up } from '../ascii/types.ts'
import { allocateBoxRoutes } from '../ascii/class-like-layout.ts'

describe('verified axis routes', () => {
  test('clear segments preserve A* points in both directions and with every direction preference', () => {
    for (const [from, to] of [
      [{ x: 2, y: 3 }, { x: 18, y: 3 }], [{ x: 18, y: 3 }, { x: 2, y: 3 }],
      [{ x: 2, y: 3 }, { x: 2, y: 18 }], [{ x: 2, y: 18 }, { x: 2, y: 3 }],
      [{ x: 2, y: 3 }, { x: 2, y: 3 }],
    ] as const) {
      const occupied = new OccupancyMap([[`${from.x},${from.y}`, true], [`${to.x},${to.y}`, true]])
      // Obstacles alongside a segment do not change its unique shortest path.
      occupied.set(`${Math.max(from.x, to.x) + 1},${Math.max(from.y, to.y) + 1}`, true)
      for (const preferred of [undefined, Up, Down, Left, Right]) expect(getClearAxisPath(occupied, from, to)).toEqual(getPath(occupied, from, to, preferred))
    }
  })

  test('an interior obstacle refuses the shortcut and leaves the ordinary detour available', () => {
    const occupied = new OccupancyMap([['4,3', true]])
    const from = { x: 2, y: 3 }, to = { x: 8, y: 3 }
    expect(getClearAxisPath(occupied, from, to)).toBeNull()
    const detour = getPath(occupied, from, to)
    expect(detour).not.toBeNull()
    expect(detour!.some(point => point.y !== from.y)).toBe(true)
    expect(detour!.some(point => occupied.has(`${point.x},${point.y}`))).toBe(false)
  })

  test('non-axis, malformed and over-budget requests retain the bounded search path', () => {
    const occupied = new OccupancyMap()
    expect(getClearAxisPath(occupied, { x: 2, y: 3 }, { x: 8, y: 4 })).toBeNull()
    for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) expect(getClearAxisPath(occupied, { x: value, y: 3 }, { x: 8, y: 3 })).toBeNull()
    expect(getClearAxisPath(occupied, { x: 0, y: 0 }, { x: 10_000, y: 0 })).toBeNull()
  })

  test('box allocation preserves complete detours and labels when an aligned corridor is obstructed', () => {
    const boxes = [{ id: 'A', x: 4, y: 4, width: 8, height: 6 }, { id: 'B', x: 30, y: 4, width: 8, height: 6 }]
    const obstacle = { id: 'wall', x: 18, y: 4, width: 4, height: 6 }
    const [route] = allocateBoxRoutes(boxes, [{ id: 'AB', from: 'A', to: 'B', lines: ['owns'] }], 'LR', [obstacle])
    expect(route!.label!.lines).toEqual(['owns'])
    expect(route!.points.some(point => point.y < obstacle.y || point.y >= obstacle.y + obstacle.height)).toBe(true)
    for (const point of route!.points) expect(point.x >= obstacle.x && point.x < obstacle.x + obstacle.width && point.y >= obstacle.y && point.y < obstacle.y + obstacle.height).toBe(false)
  })

  test('box detours cross straight prior ink perpendicularly without sharing turns or marker approaches', () => {
    const boxes = [{ id: 'A', x: 8, y: 8, width: 14, height: 14 }, { id: 'B', x: 8, y: 45, width: 8, height: 8 },
      { id: 'Lane', x: 3, y: 38, width: 40, height: 22, container: true, headerHeight: 3 }]
    const laneRoutes = allocateBoxRoutes(boxes, [{ id: 'retry', from: 'A', to: 'A' }, { id: 'send', from: 'A', to: 'B' }, { id: 'back', from: 'B', to: 'A' }], 'LR')
    expect(laneRoutes.map(route => route.relation.id)).toEqual(['retry', 'send', 'back'])
    // A self-loop takes its own corner slot, so the lane may need no crossing.
    // Here a full-width card below and a source at the top edge leave no way
    // around the vertical route: the horizontal one must cross it.
    const forced = allocateBoxRoutes([{ id: 'C', x: 30, y: 0, width: 8, height: 6 }, { id: 'D', x: 0, y: 40, width: 90, height: 6 },
      { id: 'E', x: 4, y: 20, width: 8, height: 6 }, { id: 'F', x: 60, y: 20, width: 8, height: 6 }], [{ id: 'down', from: 'C', to: 'D' }, { id: 'across', from: 'E', to: 'F' }], 'LR')
    // Earlier routes extend beyond these three card rows. Crossing retries
    // must retain their extent after removing their ink from occupancy.
    const outsideCards = [false, true].map(horizontal => {
      const boxes = [
        ...Array.from({ length: 6 }, (_, index) => ({ id: `A${index}`, x: 4 + index * 22, y: 4, width: 16, height: 7 })),
        ...Array.from({ length: 15 }, (_, index) => ({ id: `B${index}`, x: 4 + index * 22, y: 19, width: 16, height: 7 })),
        ...[0, 1, 3, 4, 5, 6, 7, 8, 9].map(index => ({ id: `C${index}`, x: 92 + index * 22, y: 34, width: 16, height: 7 })),
      ].map(box => horizontal ? { ...box, x: box.y, y: box.x, width: box.height, height: box.width } : box)
      const pairs = [['A0', 'B4'], ...Array.from({ length: 5 }, (_, index) => [[`A${index + 1}`, `B${index * 2 + 5}`], [`A${index + 1}`, `B${index * 2 + 6}`]]).flat(),
        ['B0', 'C0'], ['B1', 'C1'], ['B2', 'C3'], ['B2', 'C4'], ['B3', 'C5'], ['B3', 'C6'], ['B4', 'C7'], ['B4', 'C8'], ['B5', 'C9']]
      const routes = allocateBoxRoutes(boxes, pairs.map(([from, to], index) => ({ id: `r${index}`, from: from!, to: to! })), horizontal ? 'LR' : 'TB')
      expect(routes).toHaveLength(pairs.length)
      expect(routes.some(route => route.points.some(point => (horizontal ? point.x : point.y) > 44))).toBe(true)
      return routes
    })
    let crossings = 0
    for (const routes of [laneRoutes, forced, ...outsideCards]) for (const [index, route] of routes.entries()) {
      for (const other of routes.slice(index + 1)) {
        for (const [at, point] of route.points.entries()) {
          const otherAt = other.points.findIndex(candidate => candidate.x === point.x && candidate.y === point.y)
          if (otherAt === -1) continue
          crossings++
          for (const [points, position] of [[route.points, at], [other.points, otherAt]] as const) {
            expect(position).toBeGreaterThan(2)
            expect(position).toBeLessThan(points.length - 3)
            const before = points[position - 1]!, after = points[position + 1]!
            expect(before.x === after.x || before.y === after.y).toBe(true)
          }
          expect(route.points[at - 1]!.x === route.points[at + 1]!.x).not.toBe(other.points[otherAt - 1]!.x === other.points[otherAt + 1]!.x)
        }
      }
    }
    expect(crossings).toBeGreaterThan(0)
  })
})
