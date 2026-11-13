import type { Point } from '../types.ts'
import type { ChannelWork } from './channel-tracks.ts'

export interface RoutingBox { x: number; y: number; width: number; height: number }
export interface Terminal { port: Point; stub: Point; penalty: number }

const inside = (point: Point, box: RoutingBox): boolean => point.x > box.x && point.x < box.x + box.width && point.y > box.y && point.y < box.y + box.height
const enters = (a: Point, b: Point, box: RoutingBox): boolean => a.x === b.x
  ? a.x > box.x && a.x < box.x + box.width && Math.max(a.y, b.y) > box.y && Math.min(a.y, b.y) < box.y + box.height
  : a.y > box.y && a.y < box.y + box.height && Math.max(a.x, b.x) > box.x && Math.min(a.x, b.x) < box.x + box.width

export function simplifyOrthogonal(points: readonly Point[]): Point[] {
  const result: Point[] = []
  for (const point of points) {
    if (result.at(-1)?.x === point.x && result.at(-1)?.y === point.y) continue
    result.push({ ...point })
    while (result.length > 2) {
      const a = result.at(-3)!, b = result.at(-2)!, c = result.at(-1)!
      if (!((a.x === b.x && b.x === c.x && b.y >= Math.min(a.y, c.y) && b.y <= Math.max(a.y, c.y))
        || (a.y === b.y && b.y === c.y && b.x >= Math.min(a.x, c.x) && b.x <= Math.max(a.x, c.x)))) break
      result.splice(result.length - 2, 1)
    }
  }
  return result
}

/** Bounded rectilinear visibility grid. The caller owns all geometry and the
 * shared routing budget; paths stay inside the declared content rectangle. */
export function createVisibilityGrid(
  bounds: RoutingBox, obstacles: readonly RoutingBox[], terminals: readonly Terminal[], anchors: readonly Point[],
  clearance: number, work: ChannelWork, remainingVertices: number, fail: (reason: string) => never,
): { vertices: number; route: (starts: readonly Terminal[], goal: Point) => Point[] } {
  const right = bounds.x + bounds.width, bottom = bounds.y + bounds.height
  const inBounds = (point: Point): boolean => point.x >= bounds.x && point.x <= right && point.y >= bounds.y && point.y <= bottom
  const relevant = obstacles.filter(box => {
    if (--work.pairs < 0) fail('agentic local cross-hierarchy obstacle-work limit')
    return box.x <= right && box.x + box.width >= bounds.x && box.y <= bottom && box.y + box.height >= bounds.y
  })
  const xs = new Set([bounds.x, right]), ys = new Set([bounds.y, bottom])
  for (const box of relevant) {
    if (--work.pairs < 0) fail('agentic local cross-hierarchy obstacle-work limit')
    for (const x of [box.x, box.x + box.width]) if (x >= bounds.x && x <= right) xs.add(x)
    for (const y of [box.y, box.y + box.height]) if (y >= bounds.y && y <= bottom) ys.add(y)
  }
  for (const point of [...terminals.flatMap(terminal => [terminal.port, terminal.stub]), ...anchors]) {
    if (--work.pairs < 0) fail('agentic local cross-hierarchy obstacle-work limit')
    if (!Number.isFinite(point.x + point.y)) fail('agentic local cross-hierarchy coordinate limit')
    if (inBounds(point)) { xs.add(point.x); ys.add(point.y) }
  }
  const sort = (a: number, b: number): number => {
    if (--work.swaps < 0) fail('agentic local cross-hierarchy coordinate-sort limit')
    return a - b
  }
  const x = [...xs].sort(sort), y = [...ys].sort(sort), columns = x.length, cells = columns * y.length
  if (cells * 3 > remainingVertices) fail('agentic local cross-hierarchy visibility-expansion limit')
  const pointClear = new Int8Array(cells), horizontal = new Int8Array(cells), vertical = new Int8Array(cells)
  const point = (id: number): Point => ({ x: x[id % columns]!, y: y[Math.floor(id / columns)]! })
  const clearPoint = (id: number): boolean => {
    if (pointClear[id]) return pointClear[id] === 1
    const p = point(id)
    for (const box of relevant) {
      if (--work.pairs < 0) fail('agentic local cross-hierarchy obstacle-work limit')
      if (inside(p, box)) { pointClear[id] = -1; return false }
    }
    pointClear[id] = 1; return true
  }
  const clearSegment = (a: Point, b: Point): boolean => {
    for (const box of relevant) {
      if (--work.pairs < 0) fail('agentic local cross-hierarchy obstacle-work limit')
      if (enters(a, b, box)) return false
    }
    return true
  }
  const locate = (p: Point): number => {
    const column = x.indexOf(p.x), row = y.indexOf(p.y)
    return column < 0 || row < 0 ? -1 : row * columns + column
  }
  return { vertices: cells * 3, route(starts, goal) {
    const target = locate(goal)
    if (target < 0 || !clearPoint(target)) fail('cross-hierarchy route has no clear anchor')
    const distance = new Float64Array(cells * 3).fill(Infinity), parent = new Int32Array(cells * 3).fill(-1)
    const slots = new Int32Array(cells * 3).fill(-1), roots = new Int32Array(cells * 3).fill(-1), heap: number[] = []
    const priority = (state: number): number => {
      const id = Math.floor(state / 3)
      return distance[state]! + Math.abs(x[id % columns]! - goal.x) + Math.abs(y[Math.floor(id / columns)]! - goal.y)
    }
    const less = (a: number, b: number): boolean => {
      if (--work.swaps < 0) fail('agentic local cross-hierarchy heap-work limit')
      return priority(a) < priority(b) || priority(a) === priority(b) && a < b
    }
    const swap = (a: number, b: number): void => { [heap[a], heap[b]] = [heap[b]!, heap[a]!]; slots[heap[a]!] = a; slots[heap[b]!] = b }
    const enqueue = (state: number): void => {
      let index = slots[state]!
      if (index === -2) return
      if (index < 0) { index = heap.length; heap.push(state); slots[state] = index }
      while (index > 0) { const before = Math.floor((index - 1) / 2); if (!less(heap[index]!, heap[before]!)) break; swap(index, before); index = before }
    }
    const pop = (): number => {
      const first = heap[0]!, last = heap.pop()!
      slots[first] = -2
      if (heap.length) {
        heap[0] = last; slots[last] = 0
        let index = 0
        while (2 * index + 1 < heap.length) {
          let next = 2 * index + 1
          if (next + 1 < heap.length && less(heap[next + 1]!, heap[next]!)) next++
          if (!less(heap[next]!, heap[index]!)) break
          swap(index, next); index = next
        }
      }
      return first
    }
    for (let index = 0; index < starts.length; index++) {
      const terminal = starts[index]!, id = locate(terminal.stub)
      if (id < 0 || !inBounds(terminal.port) || !clearPoint(id) || !clearSegment(terminal.port, terminal.stub)) continue
      const axis = terminal.port.x === terminal.stub.x ? 2 : 1, state = id * 3 + axis
      const value = Math.abs(terminal.stub.x - terminal.port.x) + Math.abs(terminal.stub.y - terminal.port.y) + terminal.penalty
      if (value < distance[state]!) { distance[state] = value; roots[state] = index; enqueue(state) }
    }
    while (heap.length) {
      const state = pop(), id = Math.floor(state / 3), axis = state % 3
      if (id === target) {
        const path: Point[] = []
        let current = state
        while (parent[current]! >= 0) { path.push(point(Math.floor(current / 3))); current = parent[current]! }
        path.push(point(Math.floor(current / 3)), starts[roots[current]!]!.port)
        return simplifyOrthogonal(path.reverse())
      }
      const column = id % columns, row = Math.floor(id / columns)
      for (const [next, direction] of [[column > 0 ? id - 1 : -1, 1], [column + 1 < columns ? id + 1 : -1, 1], [row > 0 ? id - columns : -1, 2], [row + 1 < y.length ? id + columns : -1, 2]]) {
        if (--work.arcs < 0) fail('agentic local cross-hierarchy visibility-arc limit')
        if (next! < 0 || !clearPoint(next!)) continue
        const key = Math.min(id, next!), cache = direction === 1 ? horizontal : vertical
        if (!cache[key]) cache[key] = clearSegment(point(id), point(next!)) ? 1 : -1
        if (cache[key] !== 1) continue
        const nextState = next! * 3 + direction!, a = point(id), b = point(next!)
        const value = distance[state]! + Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + (axis === direction ? 0 : clearance * 2)
        if (slots[nextState] !== -2 && value < distance[nextState]!) {
          distance[nextState] = value; parent[nextState] = state; roots[nextState] = roots[state]!; enqueue(nextState)
        }
      }
    }
    return fail('cross-hierarchy route has no bounded clear corridor')
  } }
}
