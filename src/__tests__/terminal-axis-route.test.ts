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
})
