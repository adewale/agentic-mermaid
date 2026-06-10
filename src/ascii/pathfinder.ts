// ============================================================================
// ASCII renderer — A* pathfinding for edge routing
//
// Ported from AlexanderGrooff/mermaid-ascii cmd/arrow.go.
// Uses A* search with a corner-penalizing heuristic to find clean
// paths between nodes on the grid. Prefers straight lines over zigzags.
// ============================================================================

import type { GridCoord, AsciiNode } from './types.ts'
import { gridKey, gridCoordEquals } from './types.ts'

// ============================================================================
// Priority queue (min-heap) for A* open set
// ============================================================================

interface PQItem {
  coord: GridCoord
  priority: number
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
 * Simple min-heap priority queue with deterministic FIFO tie-breaking.
 * For the grid sizes we handle (~100s of cells), this is more than fast enough.
 */
class MinHeap {
  private items: PQItem[] = []

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
   * Order two heap items: by priority, then by insertion sequence (FIFO).
   * Returns true if `a` should sit above `b` in the min-heap.
   */
  private before(a: PQItem, b: PQItem): boolean {
    if (a.priority !== b.priority) return a.priority < b.priority
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

/** Check if a grid cell is unoccupied and has non-negative coordinates. */
function isFreeInGrid(grid: Map<string, AsciiNode>, c: GridCoord): boolean {
  if (c.x < 0 || c.y < 0) return false
  return !grid.has(gridKey(c))
}

/**
 * Order the four neighbour directions, trying `preferredDir` first.
 * Expanding a known exit direction first biases A* toward a route that commits
 * to that axis early (upstream lukilabs#113's preferred-direction idea). NOTE:
 * the edge router in this fork does NOT pass a preferredDir — see the comment in
 * edge-routing.ts `determinePath` for why. This stays a self-contained, tested
 * pathfinder capability rather than dead code.
 */
function orderedDirs(preferredDir?: GridCoord): GridCoord[] {
  if (!preferredDir) return MOVE_DIRS
  const rest = MOVE_DIRS.filter(d => !(d.x === preferredDir.x && d.y === preferredDir.y))
  return [{ x: preferredDir.x, y: preferredDir.y }, ...rest]
}

/**
 * Find a path from `from` to `to` on the grid using A*.
 * Returns the path as an array of GridCoords, or null if no path exists.
 *
 * @param preferredDir - Optional exit direction tried first during neighbour
 *   expansion (see `orderedDirs`). Currently unused by the edge router; kept as
 *   a tested capability and exercised by ascii-pathfinder-determinism.test.ts.
 */
export function getPath(
  grid: Map<string, AsciiNode>,
  from: GridCoord,
  to: GridCoord,
  preferredDir?: GridCoord,
): GridCoord[] | null {
  // #66 (ktrysmt): bound the search. `isFreeInGrid` only guards x/y < 0, so an
  // unreachable target (walled off) would let A* explore +x/+y unboundedly →
  // OOM/hang. Derive an upper bound from the grid extent + the from/to coords,
  // plus a hard iteration cap. On exhaustion we return null and the caller
  // falls back to a direct route, rather than exhausting memory.
  let maxX = Math.max(from.x, to.x)
  let maxY = Math.max(from.y, to.y)
  for (const key of grid.keys()) {
    const comma = key.indexOf(',')
    const kx = Number(key.slice(0, comma))
    const ky = Number(key.slice(comma + 1))
    if (kx > maxX) maxX = kx
    if (ky > maxY) maxY = ky
  }
  // Margin lets routes detour slightly around obstacles past the extent.
  const boundX = maxX + 4
  const boundY = maxY + 4
  // Iteration cap proportional to the bounded grid area (with a floor).
  const maxIterations = Math.max(10_000, (boundX + 1) * (boundY + 1) * 4)

  const dirs = orderedDirs(preferredDir)

  let seq = 0
  const pq = new MinHeap()
  pq.push({ coord: from, priority: 0, seq: seq++ })

  const costSoFar = new Map<string, number>()
  costSoFar.set(gridKey(from), 0)

  const cameFrom = new Map<string, GridCoord | null>()
  cameFrom.set(gridKey(from), null)

  let iterations = 0
  while (pq.length > 0) {
    if (++iterations > maxIterations) return null // #66 guard: bail to caller's fallback
    const current = pq.pop()!.coord

    if (gridCoordEquals(current, to)) {
      // Reconstruct path by walking backwards through cameFrom
      const path: GridCoord[] = []
      let c: GridCoord | null = current
      while (c !== null) {
        path.unshift(c)
        c = cameFrom.get(gridKey(c)) ?? null
      }
      return path
    }

    const currentCost = costSoFar.get(gridKey(current))!

    for (const dir of dirs) {
      const next: GridCoord = { x: current.x + dir.x, y: current.y + dir.y }

      // #66 guard: never expand past the bounded extent. Without this, an
      // unreachable target lets the search wander the unbounded +x/+y plane.
      if (next.x > boundX || next.y > boundY) continue

      // Allow moving to the destination even if it's occupied (it's a node boundary)
      if (!isFreeInGrid(grid, next) && !gridCoordEquals(next, to)) {
        continue
      }

      const newCost = currentCost + 1
      const nextKey = gridKey(next)
      const existingCost = costSoFar.get(nextKey)

      if (existingCost === undefined || newCost < existingCost) {
        costSoFar.set(nextKey, newCost)
        const priority = newCost + heuristic(next, to)
        pq.push({ coord: next, priority, seq: seq++ })
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
