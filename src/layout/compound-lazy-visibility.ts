import type { Point } from '../types.ts'
import type { ChannelWork } from './channel-tracks.ts'
import type { RoutingBox, Terminal } from './compound-visibility.ts'
import { createCompoundObstacleIndex } from './compound-obstacle-index.ts'

const PAGE_SIZE = 32

/** The dense grid's IDs and search order, with cumulative, bounded storage.
 * A point-cache cell, query state, heap slot, or emitted point costs one
 * expansion unit. Segment-cache capacity uses the separate arc reserve.
 * Whole page capacity is reserved before allocation, including unused slots.
 * Query pages are private; cache pages persist. Neither is refunded on failure. */
export function createLazyVisibilityGrid(
  bounds: RoutingBox, obstacles: readonly RoutingBox[], terminals: readonly Terminal[], anchors: readonly Point[],
  clearance: number, work: ChannelWork, remainingVertices: number, fail: (reason: string) => never,
  reserveVertices?: (amount: number) => void,
): { readonly vertices: number; readonly virtualVertices: number; route: (starts: readonly Terminal[], goal: Point) => Point[] } {
  let allocated = 0
  const reserve = (amount: number): void => {
    if (allocated + amount > remainingVertices) fail('agentic local cross-hierarchy visibility-expansion limit')
    reserveVertices?.(amount)
    allocated += amount
  }
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
  const include = (point: Point): void => {
    if (--work.pairs < 0) fail('agentic local cross-hierarchy obstacle-work limit')
    if (!Number.isFinite(point.x + point.y)) fail('agentic local cross-hierarchy coordinate limit')
    if (inBounds(point)) { xs.add(point.x); ys.add(point.y) }
  }
  for (const terminal of terminals) { include(terminal.port); include(terminal.stub) }
  for (const anchor of anchors) include(anchor)
  const sort = (a: number, b: number): number => {
    if (--work.swaps < 0) fail('agentic local cross-hierarchy coordinate-sort limit')
    return a - b
  }
  const x = [...xs].sort(sort), y = [...ys].sort(sort), columns = x.length, cells = columns * y.length
  // Parent and heap entries retain exact state IDs in signed Int32 pages.
  // The old eager admission check used to imply this range bound.
  if (!Number.isSafeInteger(cells * 3) || cells * 3 > 0x7fff_ffff) fail('agentic local cross-hierarchy coordinate limit')

  const bytes = (segments = false) => {
    const pages = new Map<number, Int8Array>()
    return {
      get(id: number): number { return pages.get(Math.floor(id / PAGE_SIZE))?.[id % PAGE_SIZE] ?? 0 },
      set(id: number, value: number): void {
        const page = Math.floor(id / PAGE_SIZE)
        let data = pages.get(page)
        if (!data) {
          const count = Math.min(PAGE_SIZE, cells - page * PAGE_SIZE)
          if (segments) {
            work.arcs -= count
            if (work.arcs < 0) fail('agentic local cross-hierarchy visibility-arc limit')
          } else reserve(count)
          data = new Int8Array(count)
          pages.set(page, data)
        }
        data[id % PAGE_SIZE] = value
      },
    }
  }
  const pointClear = bytes(), horizontal = bytes(true), vertical = bytes(true)
  let obstacleIndex: ReturnType<typeof createCompoundObstacleIndex> | undefined
  const index = () => obstacleIndex ??= createCompoundObstacleIndex(relevant, work, fail)
  const clearPoint = (id: number): boolean => {
    const cached = pointClear.get(id)
    if (cached) return cached === 1
    const px = x[id % columns]!, py = y[Math.floor(id / columns)]!
    if (index().containsPoint(px, py)) { pointClear.set(id, -1); return false }
    pointClear.set(id, 1)
    return true
  }
  const clearCoordinates = (ax: number, ay: number, bx: number, by: number): boolean => {
    return !index().entersSegment(ax, ay, bx, by)
  }
  const clearSegment = (from: number, to: number): boolean => clearCoordinates(x[from % columns]!, y[Math.floor(from / columns)]!, x[to % columns]!, y[Math.floor(to / columns)]!)
  const locate = (point: Point): number => {
    const column = x.indexOf(point.x), row = y.indexOf(point.y)
    return column < 0 || row < 0 ? -1 : row * columns + column
  }
  return { get vertices() { return allocated }, virtualVertices: cells * 3, route(starts, goal) {
    const target = locate(goal)
    if (target < 0 || !clearPoint(target)) fail('cross-hierarchy route has no clear anchor')
    type StatePage = { distance: Float64Array; parent: Int32Array; slots: Int32Array; roots: Int32Array }
    const pages = new Map<number, StatePage>(), heapPages = new Map<number, Int32Array>()
    const ensure = (state: number): StatePage => {
      const index = Math.floor(state / PAGE_SIZE)
      let page = pages.get(index)
      if (!page) {
        const count = Math.min(PAGE_SIZE, cells * 3 - index * PAGE_SIZE)
        reserve(count)
        page = { distance: new Float64Array(count).fill(Infinity), parent: new Int32Array(count).fill(-1), slots: new Int32Array(count).fill(-1), roots: new Int32Array(count).fill(-1) }
        pages.set(index, page)
      }
      return page
    }
    const statePage = (state: number): StatePage | undefined => pages.get(Math.floor(state / PAGE_SIZE))
    const distance = (state: number): number => statePage(state)?.distance[state % PAGE_SIZE] ?? Infinity
    const parent = (state: number): number => statePage(state)?.parent[state % PAGE_SIZE] ?? -1
    const slot = (state: number): number => statePage(state)?.slots[state % PAGE_SIZE] ?? -1
    const root = (state: number): number => statePage(state)?.roots[state % PAGE_SIZE] ?? -1
    let heapSize = 0
    const heap = (index: number): number => heapPages.get(Math.floor(index / PAGE_SIZE))![index % PAGE_SIZE]!
    const setHeap = (index: number, state: number): void => {
      const page = Math.floor(index / PAGE_SIZE)
      let data = heapPages.get(page)
      if (!data) {
        const count = Math.min(PAGE_SIZE, cells * 3 - page * PAGE_SIZE)
        reserve(count)
        data = new Int32Array(count)
        heapPages.set(page, data)
      }
      data[index % PAGE_SIZE] = state
    }
    const priority = (state: number): number => {
      const id = Math.floor(state / 3)
      return distance(state) + Math.abs(x[id % columns]! - goal.x) + Math.abs(y[Math.floor(id / columns)]! - goal.y)
    }
    const less = (a: number, b: number): boolean => {
      if (--work.swaps < 0) fail('agentic local cross-hierarchy heap-work limit')
      return priority(a) < priority(b) || priority(a) === priority(b) && a < b
    }
    const swap = (a: number, b: number): void => {
      const saved = heap(a)
      setHeap(a, heap(b)); setHeap(b, saved)
      ensure(heap(a)).slots[heap(a) % PAGE_SIZE] = a
      ensure(heap(b)).slots[heap(b) % PAGE_SIZE] = b
    }
    const enqueue = (state: number): void => {
      let index = slot(state)
      if (index === -2) return
      if (index < 0) {
        index = heapSize
        setHeap(heapSize++, state)
        ensure(state).slots[state % PAGE_SIZE] = index
      }
      while (index > 0) {
        const before = Math.floor((index - 1) / 2)
        if (!less(heap(index), heap(before))) break
        swap(index, before); index = before
      }
    }
    const pop = (): number => {
      const first = heap(0), last = heap(--heapSize)
      ensure(first).slots[first % PAGE_SIZE] = -2
      if (heapSize) {
        setHeap(0, last); ensure(last).slots[last % PAGE_SIZE] = 0
        let index = 0
        while (2 * index + 1 < heapSize) {
          let next = 2 * index + 1
          if (next + 1 < heapSize && less(heap(next + 1), heap(next))) next++
          if (!less(heap(next), heap(index))) break
          swap(index, next); index = next
        }
      }
      return first
    }
    for (let index = 0; index < starts.length; index++) {
      const terminal = starts[index]!, id = locate(terminal.stub)
      if (id < 0 || !inBounds(terminal.port) || !clearPoint(id)) continue
      if (!clearCoordinates(terminal.port.x, terminal.port.y, terminal.stub.x, terminal.stub.y)) continue
      const axis = terminal.port.x === terminal.stub.x ? 2 : 1, state = id * 3 + axis
      const value = Math.abs(terminal.stub.x - terminal.port.x) + Math.abs(terminal.stub.y - terminal.port.y) + terminal.penalty
      if (value < distance(state)) {
        const page = ensure(state), offset = state % PAGE_SIZE
        page.distance[offset] = value; page.roots[offset] = index; enqueue(state)
      }
    }
    const point = (id: number): Point => {
      reserve(1)
      return { x: x[id % columns]!, y: y[Math.floor(id / columns)]! }
    }
    while (heapSize) {
      const state = pop(), id = Math.floor(state / 3), axis = state % 3
      if (id === target) {
        const path: Point[] = []
        let current = state
        while (parent(current) >= 0) { path.push(point(Math.floor(current / 3))); current = parent(current) }
        path.push(point(Math.floor(current / 3)))
        reserve(1)
        path.push({ ...starts[root(current)]!.port })
        // These points are already fresh, so simplify without allocating a
        // second unaccounted set of point records.
        const result: Point[] = []
        for (const p of path.reverse()) {
          if (result.at(-1)?.x === p.x && result.at(-1)?.y === p.y) continue
          result.push(p)
          while (result.length > 2) {
            const a = result.at(-3)!, b = result.at(-2)!, c = result.at(-1)!
            if (!((a.x === b.x && b.x === c.x && b.y >= Math.min(a.y, c.y) && b.y <= Math.max(a.y, c.y))
              || (a.y === b.y && b.y === c.y && b.x >= Math.min(a.x, c.x) && b.x <= Math.max(a.x, c.x)))) break
            result.splice(result.length - 2, 1)
          }
        }
        return result
      }
      const column = id % columns, row = Math.floor(id / columns)
      for (let step = 0; step < 4; step++) {
        const next = step === 0 ? column > 0 ? id - 1 : -1
          : step === 1 ? column + 1 < columns ? id + 1 : -1
            : step === 2 ? row > 0 ? id - columns : -1 : row + 1 < y.length ? id + columns : -1
        const direction = step < 2 ? 1 : 2
        if (--work.arcs < 0) fail('agentic local cross-hierarchy visibility-arc limit')
        if (next < 0 || !clearPoint(next)) continue
        const key = Math.min(id, next), cache = direction === 1 ? horizontal : vertical
        if (!cache.get(key)) cache.set(key, clearSegment(id, next) ? 1 : -1)
        if (cache.get(key) !== 1) continue
        const nextState = next * 3 + direction
        const value = distance(state) + Math.abs(x[id % columns]! - x[next % columns]!) + Math.abs(y[Math.floor(id / columns)]! - y[Math.floor(next / columns)]!) + (axis === direction ? 0 : clearance * 2)
        if (slot(nextState) !== -2 && value < distance(nextState)) {
          const page = ensure(nextState), offset = nextState % PAGE_SIZE
          page.distance[offset] = value; page.parent[offset] = state; page.roots[offset] = root(state); enqueue(nextState)
        }
      }
    }
    return fail('cross-hierarchy route has no bounded clear corridor')
  } }
}
