// ============================================================================
// ASCII renderer — A* pathfinding for edge routing
//
// Ported from AlexanderGrooff/mermaid-ascii cmd/arrow.go.
// Uses A* search with a corner-penalizing heuristic to find clean
// paths between nodes on the grid. Prefers straight lines over zigzags.
// ============================================================================

import type { GridCoord, Direction } from './types.ts'
import { gridKey } from './types.ts'
import { pathOccupancy, type PathOccupancy } from './occupancy.ts'
import { observeWork } from '../performance-observations.ts'

// ============================================================================
// Open set (min-heap) and per-cell search state for A*
// ============================================================================

/**
 * A* open set whose entries live in parallel typed arrays, numbered in
 * insertion order. That number is the deterministic FIFO tie-breaker
 * (upstream lukilabs#113): equal-priority cells pop in insertion order
 * regardless of heap topology. Without it, the order two equal-priority cells
 * are visited depends on incidental heap shape, which let sibling fan-out
 * edges pick inconsistent corners and produce L-shaped detours. Entries pop by
 * priority, then (when `towardTarget` is set) nearest to the target, then
 * first in, first out; the order is total, so the representation never
 * matters. Integer priorities without the target order use one first-in,
 * first-out list per priority instead of the heap.
 */
class OpenSet {
  x = new Float64Array(256)
  y = new Float64Array(256)
  priority = new Float64Array(256)
  /** Path cost when queued; a later, cheaper entry for the cell makes this stale. */
  cost = new Float64Array(256)
  /** Heuristic distance to the target; orders equal priorities toward it. */
  remaining = new Float64Array(256)
  private heap = new Int32Array(256)
  /** The next entry queued at the same priority (bucket lists). */
  private next = new Int32Array(256)
  /** First and last entry queued at each priority; -1 when none. */
  private first = new Int32Array(0)
  private last = new Int32Array(0)
  /** No bucket below this priority holds an entry. */
  private lowest = 0
  /** Highest bucket written since the last reset. */
  private highest = -1
  private entries = 0
  size = 0
  private towardTarget = false
  private buckets = false

  /** `buckets` requires every pushed priority to be a nonnegative integer. */
  reset(towardTarget: boolean, buckets: boolean): void {
    if (this.highest >= 0) this.first.fill(-1, 0, this.highest + 1)
    this.entries = 0; this.size = 0; this.towardTarget = towardTarget
    this.buckets = buckets && !towardTarget; this.lowest = 0; this.highest = -1
  }

  push(x: number, y: number, priority: number, cost: number, remaining: number): void {
    const entry = this.entries++
    if (entry === this.x.length) this.grow()
    this.x[entry] = x; this.y[entry] = y; this.priority[entry] = priority; this.cost[entry] = cost; this.remaining[entry] = remaining
    this.size++
    if (this.buckets) {
      if (priority >= this.first.length) this.growBuckets(priority)
      this.next[entry] = -1
      if (this.first[priority]! < 0) this.first[priority] = entry
      else this.next[this.last[priority]!] = entry
      this.last[priority] = entry
      if (priority < this.lowest) this.lowest = priority
      if (priority > this.highest) this.highest = priority
      return
    }
    const heap = this.heap
    let i = this.size - 1
    while (i > 0) {
      const parent = (i - 1) >> 1, above = heap[parent]!
      if (!this.before(entry, above)) break
      heap[i] = above; i = parent
    }
    heap[i] = entry
  }

  /** Remove and return the first entry; callers check `size` first. */
  pop(): number {
    if (this.buckets) {
      let priority = this.lowest
      while (this.first[priority]! < 0) priority++
      const entry = this.first[priority]!
      this.first[priority] = this.next[entry]!
      this.lowest = priority
      this.size--
      return entry
    }
    const heap = this.heap, top = heap[0]!, last = heap[--this.size]!, n = this.size
    let i = 0
    for (;;) {
      const left = 2 * i + 1
      if (left >= n) break
      const right = left + 1
      const child = right < n && this.before(heap[right]!, heap[left]!) ? right : left
      if (!this.before(heap[child]!, last)) break
      heap[i] = heap[child]!; i = child
    }
    heap[i] = last
    return top
  }

  /** Whether entry `a` pops before entry `b`. */
  private before(a: number, b: number): boolean {
    const pa = this.priority[a]!, pb = this.priority[b]!
    if (pa !== pb) return pa < pb
    if (this.towardTarget) {
      const ra = this.remaining[a]!, rb = this.remaining[b]!
      if (ra !== rb) return ra < rb
    }
    return a < b
  }

  private grow(): void {
    const size = this.x.length * 2
    const grown = (values: Float64Array): Float64Array<ArrayBuffer> => { const next = new Float64Array(size); next.set(values); return next }
    this.x = grown(this.x); this.y = grown(this.y); this.priority = grown(this.priority); this.cost = grown(this.cost); this.remaining = grown(this.remaining)
    const heap = new Int32Array(size); heap.set(this.heap); this.heap = heap
    const next = new Int32Array(size); next.set(this.next); this.next = next
  }

  private growBuckets(priority: number): void {
    const size = Math.max(priority + 1, this.first.length * 2, 256)
    const first = new Int32Array(size).fill(-1); first.set(this.first); this.first = first
    const last = new Int32Array(size); last.set(this.last); this.last = last
  }
}

/** Searched extents up to this many cells keep their state in dense arrays of
 * nine bytes a cell, reused (and retained) across searches; larger or
 * non-integer extents use maps. A dense cost never exceeds the pops spent. */
const DENSE_SEARCH_CELLS = 1 << 22

/** Best known cost and arrival move of each reached cell, keyed by one number.
 * Dense state is stamped with a per-search generation instead of cleared. */
class CellStates {
  private stamps = new Uint32Array(0)
  private costs = new Int32Array(0)
  private moves = new Int8Array(0)
  private generation = 0
  private dense = false
  private readonly costMap = new Map<number, number>()
  private readonly moveMap = new Map<number, number>()

  reset(cells: number, dense: boolean): void {
    this.dense = dense
    this.costMap.clear(); this.moveMap.clear()
    if (!dense) return
    if (this.stamps.length < cells) {
      const size = Math.min(DENSE_SEARCH_CELLS, Math.max(cells, this.stamps.length * 2))
      this.stamps = new Uint32Array(size); this.costs = new Int32Array(size); this.moves = new Int8Array(size); this.generation = 0
    }
    if (++this.generation === 0x1_0000_0000) { this.stamps.fill(0); this.generation = 1 }
  }

  /** Best known cost, or Infinity for a cell not reached yet. */
  cost(key: number): number {
    if (this.dense) return this.stamps[key] === this.generation ? this.costs[key]! : Infinity
    return this.costMap.get(key) ?? Infinity
  }

  /** Index of the move that reached the cell; -1 for the start. */
  move(key: number): number {
    return this.dense ? this.moves[key]! : this.moveMap.get(key)!
  }

  set(key: number, cost: number, move: number): void {
    if (this.dense) { this.stamps[key] = this.generation; this.costs[key] = cost; this.moves[key] = move; return }
    this.costMap.set(key, cost); this.moveMap.set(key, move)
  }
}

/** Reusable search scratch. A search nested in a step callback takes its own. */
const idleOpenSets: OpenSet[] = []
const idleCellStates: CellStates[] = []


// ============================================================================
// A* heuristic
// ============================================================================

/**
 * Manhattan distance with a +1 penalty when both dx and dy are non-zero.
 * This encourages the pathfinder to prefer straight lines and minimize corners.
 */
export function heuristic(a: GridCoord, b: GridCoord): number {
  const absX = Math.abs(a.x - b.x)
  const absY = Math.abs(a.y - b.y)
  if (absX === 0 || absY === 0) {
    return absX + absY
  }
  return absX + absY + 1
}

// ============================================================================
// A* pathfinding
// ============================================================================

/** 4-directional movement (no diagonals in grid pathfinding). */
const MOVE_DIRS: GridCoord[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
]

/** Build a move-direction order that tries the edge's initial cardinal direction first. */
function buildMoveDirs(preferredDir?: Direction): GridCoord[] {
  if (!preferredDir) return [...MOVE_DIRS]

  // Direction values are 3x3 node attachment offsets, not signed deltas:
  // Up={1,0}, Down={1,2}, Left={0,1}, Right={2,1}.
  if (preferredDir.x === 2 && preferredDir.y === 1) {
    return [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]
  }
  if (preferredDir.x === 0 && preferredDir.y === 1) {
    return [{ x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]
  }
  if (preferredDir.x === 1 && preferredDir.y === 2) {
    return [{ x: 0, y: 1 }, { x: 0, y: -1 }, { x: 1, y: 0 }, { x: -1, y: 0 }]
  }
  if (preferredDir.x === 1 && preferredDir.y === 0) {
    return [{ x: 0, y: -1 }, { x: 0, y: 1 }, { x: 1, y: 0 }, { x: -1, y: 0 }]
  }

  const dx = preferredDir.x - 1
  const dy = preferredDir.y - 1
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0
      ? [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]
      : [{ x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]
  }
  return dy >= 0
    ? [{ x: 0, y: 1 }, { x: 0, y: -1 }, { x: 1, y: 0 }, { x: -1, y: 0 }]
    : [{ x: 0, y: -1 }, { x: 0, y: 1 }, { x: 1, y: 0 }, { x: -1, y: 0 }]
}

/** Check if a grid cell is unoccupied and has non-negative coordinates. */
function isFreeInGrid(grid: PathOccupancy, c: GridCoord): boolean {
  if (c.x < 0 || c.y < 0) return false
  return !grid.has(gridKey(c))
}

/** The clear axis segment is the unique shortest four-neighbour path. This
 * narrow shortcut is used only where the caller has no extra canStep policy.
 * Leave longer paths to the ordinary bounded search: 10,000 popped cells is
 * its minimum work cap, including both endpoints. Occupied endpoints retain
 * getPath's semantics; only the segment's interior must be free. */
export function getClearAxisPath(grid: PathOccupancy, from: GridCoord, to: GridCoord): GridCoord[] | null {
  if (![from.x, from.y, to.x, to.y].every(value => Number.isSafeInteger(value) && value >= 0)) return null
  if (from.x !== to.x && from.y !== to.y) return null
  const distance = Math.abs(to.x - from.x) + Math.abs(to.y - from.y)
  if (distance >= 10_000) return null
  const dx = Math.sign(to.x - from.x), dy = Math.sign(to.y - from.y)
  for (let step = 1; step < distance; step++) if (grid.has(`${from.x + dx * step},${from.y + dy * step}`)) return null
  return Array.from({ length: distance + 1 }, (_, step) => ({ x: from.x + dx * step, y: from.y + dy * step }))
}


/** Pops the exact search may spend per cell of the endpoints' heuristic
 * distance, plus a fixed allowance for local detours around a card. Every
 * committed golden route stays within this budget. */
const EXACT_SEARCH_FACTOR = 8
const EXACT_SEARCH_ALLOWANCE = 256

/**
 * Find a path from `from` to `to` on the grid using A*.
 * Returns the path as an array of GridCoords, or null if no path exists.
 *
 * Equal-priority cells pop first-in first-out, which lets A* flood every cell
 * of the rectangle between the endpoints before it reaches the target: work
 * grows with that area, not with the route. Up to a budget proportional to
 * the endpoints' distance this exact search runs unchanged, keeping its
 * established routes. Past that budget the same A* restarts, ordering equal
 * priorities toward the target, and expands about one cell per route cell.
 *
 * @param preferredDir - Optional exit direction tried first during neighbour
 *   expansion (see `orderedDirs`). Currently unused by the edge router; kept as
 *   a tested capability and exercised by ascii-pathfinder-determinism.test.ts.
 * @param canStep - Optional step policy, consulted for each move onto a free
 *   neighbour or the target.
 * @param work - Optional pops shared by several searches. A search stops when
 *   the shared total reaches its limit and returns null; the caller tells that
 *   exhaustion from an unreachable target by comparing `pops` with `limit`.
 *   Its `margin` widens the bounded extent on the right and bottom.
 */
export function getPath(
  cells: PathOccupancy | ReadonlyMap<string, unknown>,
  from: GridCoord,
  to: GridCoord,
  preferredDir?: Direction,
  canStep?: RouteStep,
  work?: RouteSearchWork,
): GridCoord[] | null {
  // #66 (ktrysmt): bound the search. `isFreeInGrid` only guards x/y < 0, so an
  // unreachable target (walled off) would let A* explore +x/+y unboundedly →
  // OOM/hang. Derive an upper bound from the grid extent + the from/to coords,
  // plus a hard iteration cap. On exhaustion we return null and the caller
  // falls back to a direct route, rather than exhausting memory.
  const grid = pathOccupancy(cells)
  const maxX = Math.max(from.x, to.x, grid.extent.maxX)
  const maxY = Math.max(from.y, to.y, grid.extent.maxY)
  // Margin lets routes detour slightly around obstacles past the extent.
  const boundX = maxX + 4 + (work?.margin ?? 0)
  const boundY = maxY + 4 + (work?.margin ?? 0)
  // Iteration cap proportional to the bounded grid area (with a floor).
  const remaining = work ? Math.max(0, work.limit - work.pops) : Infinity
  const maxIterations = Math.min(remaining, Math.max(10_000, (boundX + 1) * (boundY + 1) * 4))
  const search: Search = { grid, from, to, moveDirs: buildMoveDirs(preferredDir), canStep, boundX, boundY, pops: 0 }

  const exactBudget = EXACT_SEARCH_FACTOR * heuristic(from, to) + EXACT_SEARCH_ALLOWANCE
  let path = searchPath(search, false, Math.min(exactBudget, maxIterations))
  // A shared ceiling also counts the exact attempt's pops.
  if (path === undefined && exactBudget < maxIterations) path = searchPath(search, true, work ? maxIterations - search.pops : maxIterations)
  if (work) work.pops += search.pops
  observeWork('terminal-route-search', search.pops)
  return path ?? null // #66 guard: an exhausted cap bails to the caller's fallback
}

/** Search pops spent by several getPath calls against one shared ceiling,
 * and extra cells each search may detour beyond the occupied extent. */
export interface RouteSearchWork { pops: number; readonly limit: number; margin?: number }

/** May a route step from cell (fromX, fromY) to its neighbour (toX, toY)?
 * Plain coordinates keep the search loop free of per-step allocation. */
export type RouteStep = (fromX: number, fromY: number, toX: number, toY: number) => boolean

interface Search {
  readonly grid: PathOccupancy
  readonly from: GridCoord
  readonly to: GridCoord
  readonly moveDirs: readonly GridCoord[]
  readonly canStep: RouteStep | undefined
  readonly boundX: number
  readonly boundY: number
  /** Cells popped across every attempt: the deterministic work measure. */
  pops: number
}

/** One A* attempt. Returns undefined when `budget` pops did not reach the
 * target, and null when the bounded grid holds no path. */
function searchPath(search: Search, towardTarget: boolean, budget: number): GridCoord[] | null | undefined {
  const { grid, from, to, moveDirs, canStep, boundX, boundY } = search
  // Search state is keyed by one number per cell. Only the endpoints may lie
  // below zero (every other step must be free, and free cells are >= 0).
  const minX = Math.min(0, from.x, to.x), minY = Math.min(0, from.y, to.y)
  const stride = boundX - minX + 1
  const keyOf = (x: number, y: number): number => (y - minY) * stride + (x - minX)
  const cells = stride * (boundY - minY + 1)
  // Every expanded cell lies in [min, bound] on both axes; dense keys need
  // integer coordinates and endpoints inside that extent.
  const dense = cells <= DENSE_SEARCH_CELLS && [from.x, from.y, to.x, to.y, boundX, boundY].every(Number.isSafeInteger)
    && Math.max(from.x, to.x) <= boundX && Math.max(from.y, to.y) <= boundY
  const numeric = typeof grid.hasCell === 'function'
  const targetX = to.x, targetY = to.y
  const dx = moveDirs.map(dir => dir.x), dy = moveDirs.map(dir => dir.y)

  const open = idleOpenSets.pop() ?? new OpenSet()
  const states = idleCellStates.pop() ?? new CellStates()
  open.reset(towardTarget, dense)
  states.reset(cells, dense)
  try {
    open.push(from.x, from.y, 0, 0, heuristic(from, to))
    const fromKey = keyOf(from.x, from.y)
    states.set(fromKey, 0, -1)

    for (let pops = 1; open.size > 0; pops++) {
      if (pops > budget) return undefined
      search.pops++
      const entry = open.pop(), x = open.x[entry]!, y = open.y[entry]!
      const currentCost = states.cost(keyOf(x, y))
      // A cell re-queued at a lower cost leaves its earlier entry behind.
      // Expanding that stale entry again cannot improve any neighbour.
      if (open.cost[entry]! > currentCost) continue

      if (x === targetX && y === targetY) {
        // Reconstruct the path by walking back along each cell's arrival move.
        // Each step back lowers the recorded cost, so the start is at most
        // `currentCost` steps away.
        const path: GridCoord[] = []
        for (let cx = x, cy = y, key = keyOf(cx, cy), steps = 0; key !== fromKey && steps < currentCost; key = keyOf(cx, cy), steps++) {
          path.push({ x: cx, y: cy })
          const move = states.move(key)
          cx -= dx[move]!; cy -= dy[move]!
        }
        path.push(from)
        return path.reverse()
      }

      for (let move = 0; move < dx.length; move++) {
        const nx = x + dx[move]!, ny = y + dy[move]!

        // #66 guard: never expand past the bounded extent. Without this, an
        // unreachable target lets the search wander the unbounded +x/+y plane.
        if (nx > boundX || ny > boundY) continue
        // Allow moving to the destination even if it's occupied (it's a node boundary)
        const target = nx === targetX && ny === targetY
        if (!target && (nx < 0 || ny < 0)) continue
        // A neighbour needs a cheaper arrival before its occupancy and step
        // policy matter. Both are pure predicates, so testing the cost first
        // admits the same moves while skipping most of their calls: a flood
        // reaches each cell once, then finds it settled from every side.
        const newCost = currentCost + 1
        const nextKey = keyOf(nx, ny)
        if (!(newCost < states.cost(nextKey))) continue
        if (!target && (numeric ? grid.hasCell!(nx, ny) : !isFreeInGrid(grid, { x: nx, y: ny }))) continue
        if (canStep && !canStep(x, y, nx, ny)) continue

        states.set(nextKey, newCost, move)
        const absX = Math.abs(nx - targetX), absY = Math.abs(ny - targetY)
        const remaining = absX === 0 || absY === 0 ? absX + absY : absX + absY + 1 // heuristic(next, to)
        open.push(nx, ny, newCost + remaining, newCost, remaining)
      }
    }

    return null // No path found
  } finally {
    idleOpenSets.push(open)
    idleCellStates.push(states)
  }
}


/**
 * Simplify a path by removing intermediate waypoints on straight segments.
 * E.g., [(0,0), (1,0), (2,0), (2,1)] becomes [(0,0), (2,0), (2,1)].
 * This reduces the number of line-drawing operations.
 */
export function mergePath(path: GridCoord[]): GridCoord[] {
  if (path.length <= 2) return path

  const toRemove = new Set<number>()
  let step0 = path[0]!
  let step1 = path[1]!

  for (let idx = 2; idx < path.length; idx++) {
    const step2 = path[idx]!
    const prevDx = step1.x - step0.x
    const prevDy = step1.y - step0.y
    const dx = step2.x - step1.x
    const dy = step2.y - step1.y

    // Same direction — the middle point is redundant
    if (prevDx === dx && prevDy === dy) {
      // In Go: indexToRemove = append(indexToRemove, idx+1) but idx is 0-based from path[2:]
      // which corresponds to index idx in the full path. Go uses idx+1 because idx iterates
      // from 0 in the [2:] slice, mapping to full-array index idx+1.
      // Actually re-checking Go code: the loop is `for idx, step2 := range path[2:]`
      // so idx=0 → path[2], and it removes idx+1 which is index 1 in the full array.
      // Wait, that doesn't look right. Let me re-read:
      //   step0 = path[0], step1 = path[1]
      //   for idx, step2 := range path[2:] { ... indexToRemove = append(indexToRemove, idx+1) ... }
      //   When idx=0, step2=path[2], and it removes index 1 (step1 = path[1]) if directions match
      // So it removes the middle point (step1) which is at index idx+1 in the original array
      // when counting from the 2-ahead loop. Let me just track which middle indices to remove.
      toRemove.add(idx - 1) // Remove the middle point (step1's position)
    }

    step0 = step1
    step1 = step2
  }

  return path.filter((_, i) => !toRemove.has(i))
}
