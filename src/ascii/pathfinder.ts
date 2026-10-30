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
// Priority queue (min-heap) for A* open set
// ============================================================================

interface PQItem {
  coord: GridCoord
  priority: number
  /** Path cost when queued; a later, cheaper entry for the cell makes this stale. */
  cost: number
  /** Heuristic distance to the target; orders equal priorities toward it. */
  remaining: number
  /**
   * Monotonic insertion sequence. Used as a deterministic FIFO tie-breaker so
   * equal-priority nodes pop in insertion order regardless of heap topology
   * (upstream lukilabs#113). Without this, the order two equal-priority cells
   * are visited depends on incidental heap shape, which let sibling fan-out
   * edges pick inconsistent corners and produce L-shaped detours.
   */
  seq: number
}

/**
 * Simple min-heap priority queue with deterministic FIFO tie-breaking, or,
 * when `towardTarget` is set, nearest-to-target first and then FIFO.
 */
class MinHeap {
  private items: PQItem[] = []
  constructor(private readonly towardTarget: boolean) {}

  get length(): number {
    return this.items.length
  }

  push(item: PQItem): void {
    this.items.push(item)
    this.bubbleUp(this.items.length - 1)
  }

  pop(): PQItem | undefined {
    if (this.items.length === 0) return undefined
    const top = this.items[0]!
    const last = this.items.pop()!
    if (this.items.length > 0) {
      this.items[0] = last
      this.sinkDown(0)
    }
    return top
  }

  /**
   * Order two heap items: by priority, then (toward the target only) by
   * remaining distance, then by insertion sequence (FIFO).
   * Returns true if `a` should sit above `b` in the min-heap.
   */
  private before(a: PQItem, b: PQItem): boolean {
    if (a.priority !== b.priority) return a.priority < b.priority
    if (this.towardTarget && a.remaining !== b.remaining) return a.remaining < b.remaining
    return a.seq < b.seq
  }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (this.before(this.items[i]!, this.items[parent]!)) {
        ;[this.items[i], this.items[parent]] = [this.items[parent]!, this.items[i]!]
        i = parent
      } else {
        break
      }
    }
  }

  private sinkDown(i: number): void {
    const n = this.items.length
    while (true) {
      let smallest = i
      const left = 2 * i + 1
      const right = 2 * i + 2
      // Upstream lukilabs#113 used `<=` here to break ties; we encode the same
      // determinism explicitly via the seq tie-breaker in `before`, which is
      // unambiguous regardless of traversal order.
      if (left < n && this.before(this.items[left]!, this.items[smallest]!)) {
        smallest = left
      }
      if (right < n && this.before(this.items[right]!, this.items[smallest]!)) {
        smallest = right
      }
      if (smallest !== i) {
        ;[this.items[i], this.items[smallest]] = [this.items[smallest]!, this.items[i]!]
        i = smallest
      } else {
        break
      }
    }
  }
}

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
 */
export function getPath(
  cells: PathOccupancy | ReadonlyMap<string, unknown>,
  from: GridCoord,
  to: GridCoord,
  preferredDir?: Direction,
  canStep?: (from: GridCoord, to: GridCoord) => boolean,
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
  const boundX = maxX + 4
  const boundY = maxY + 4
  // Iteration cap proportional to the bounded grid area (with a floor).
  const maxIterations = Math.max(10_000, (boundX + 1) * (boundY + 1) * 4)
  const search: Search = { grid, from, to, moveDirs: buildMoveDirs(preferredDir), canStep, boundX, boundY, pops: 0 }

  const exactBudget = EXACT_SEARCH_FACTOR * heuristic(from, to) + EXACT_SEARCH_ALLOWANCE
  let path = searchPath(search, false, Math.min(exactBudget, maxIterations))
  if (path === undefined && exactBudget < maxIterations) path = searchPath(search, true, maxIterations)
  observeWork('terminal-route-search', search.pops)
  return path ?? null // #66 guard: an exhausted cap bails to the caller's fallback
}

interface Search {
  readonly grid: PathOccupancy
  readonly from: GridCoord
  readonly to: GridCoord
  readonly moveDirs: readonly GridCoord[]
  readonly canStep: ((from: GridCoord, to: GridCoord) => boolean) | undefined
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
  const free = grid.hasCell
    ? (x: number, y: number) => x >= 0 && y >= 0 && !grid.hasCell!(x, y)
    : (x: number, y: number) => isFreeInGrid(grid, { x, y })

  let seq = 0
  const pq = new MinHeap(towardTarget)
  pq.push({ coord: from, priority: 0, cost: 0, remaining: heuristic(from, to), seq: seq++ })

  const fromKey = keyOf(from.x, from.y)
  const costSoFar = new Map<number, number>([[fromKey, 0]])
  const cameFrom = new Map<number, GridCoord | null>([[fromKey, null]])

  for (let pops = 1; pq.length > 0; pops++) {
    if (pops > budget) return undefined
    search.pops++
    const item = pq.pop()!, current = item.coord
    const currentCost = costSoFar.get(keyOf(current.x, current.y))!
    // A cell re-queued at a lower cost leaves its earlier entry behind.
    // Expanding that stale entry again cannot improve any neighbour.
    if (item.cost > currentCost) continue

    if (current.x === to.x && current.y === to.y) {
      // Reconstruct path by walking backwards through cameFrom
      const path: GridCoord[] = []
      let c: GridCoord | null = current
      while (c !== null) {
        path.push(c)
        c = cameFrom.get(keyOf(c.x, c.y)) ?? null
      }
      return path.reverse()
    }

    for (const dir of moveDirs) {
      const nx = current.x + dir.x, ny = current.y + dir.y

      // #66 guard: never expand past the bounded extent. Without this, an
      // unreachable target lets the search wander the unbounded +x/+y plane.
      if (nx > boundX || ny > boundY) continue
      // Allow moving to the destination even if it's occupied (it's a node boundary)
      if (!(nx === to.x && ny === to.y) && !free(nx, ny)) continue
      const next: GridCoord = { x: nx, y: ny }
      if (canStep && !canStep(current, next)) continue

      const newCost = currentCost + 1
      const nextKey = keyOf(nx, ny)
      const existingCost = costSoFar.get(nextKey)

      if (existingCost === undefined || newCost < existingCost) {
        costSoFar.set(nextKey, newCost)
        const remaining = heuristic(next, to)
        pq.push({ coord: next, priority: newCost + remaining, cost: newCost, remaining, seq: seq++ })
        cameFrom.set(nextKey, current)
      }
    }
  }

  return null // No path found
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
