import type { PositionedNode } from '../types.ts'

/** A broad phase only: callers retain their exact predicates and authored order.
 * Fixed power-of-two cells avoid cancellation from subtracting a large origin.
 * Both endpoint cells are included, so open intervals can only add candidates. */
export interface NodeLaneIndex {
  firstCell: number
  offsets: Uint32Array
  ordinals: Uint32Array
}

export type NodeLaneIndexes = { x?: NodeLaneIndex | null; y?: NodeLaneIndex | null }

const CELL_WIDTH = 128

type LaneBox = Pick<PositionedNode, 'x' | 'y' | 'width' | 'height'>
type IndexCharge = (amount: number, kind: 'capacity' | 'work') => void

export function buildNodeLaneIndex(nodes: readonly LaneBox[], cross: 'x' | 'y', clearance: number, charge?: IndexCharge): NodeLaneIndex | null {
  if (nodes.length < 32 || nodes.length > 0x10000000) return null
  let firstCell = Infinity, lastCell = -Infinity, memberships = 0
  charge?.(2 * nodes.length, 'capacity')
  const starts = new Float64Array(nodes.length), ends = new Float64Array(nodes.length)
  for (let ordinal = 0; ordinal < nodes.length; ordinal++) {
    charge?.(1, 'work')
    const node = nodes[ordinal]!
    const lo = node[cross] - clearance
    const hi = node[cross] + (cross === 'x' ? node.width : node.height) + clearance
    const start = Math.floor(lo / CELL_WIDTH), end = Math.floor(hi / CELL_WIDTH)
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) return null
    memberships += end - start + 1
    if (memberships > 8 * nodes.length) return null
    starts[ordinal] = start
    ends[ordinal] = end
    firstCell = Math.min(firstCell, start)
    lastCell = Math.max(lastCell, end)
  }
  charge?.(1, 'work')
  const cells = lastCell - firstCell + 1
  if (!Number.isSafeInteger(cells) || cells > 8 * nodes.length) return null
  charge?.(cells + 1, 'capacity')
  const offsets = new Uint32Array(cells + 1)
  for (let ordinal = 0; ordinal < nodes.length; ordinal++) {
    for (let cell = starts[ordinal]! - firstCell; cell <= ends[ordinal]! - firstCell; cell++) {
      charge?.(1, 'work')
      offsets[cell + 1]!++
    }
  }
  for (let cell = 1; cell <= cells; cell++) {
    charge?.(1, 'work')
    offsets[cell]! += offsets[cell - 1]!
  }
  charge?.(cells + memberships, 'capacity')
  const cursors = offsets.slice(0, cells), ordinals = new Uint32Array(memberships)
  for (let ordinal = 0; ordinal < nodes.length; ordinal++) {
    for (let cell = starts[ordinal]! - firstCell; cell <= ends[ordinal]! - firstCell; cell++) {
      charge?.(1, 'work')
      ordinals[cursors[cell]!++] = ordinal
    }
  }
  return { firstCell, offsets, ordinals }
}

/** null means scan the original array; an out-of-range finite cell is empty. */
export function nodeLaneCell(index: NodeLaneIndex, coordinate: number): number | null {
  const cell = Math.floor(coordinate / CELL_WIDTH)
  return Number.isSafeInteger(cell) ? cell - index.firstCell : null
}

/** A missing owner cache means live placement or custom-host geometry. */
export function nodeLaneIndexForQuery(indexes: NodeLaneIndexes | undefined, nodes: readonly PositionedNode[], cross: 'x' | 'y', clearance: number): NodeLaneIndex | null | undefined {
  if (!indexes) return undefined
  if (indexes[cross] === undefined) indexes[cross] = buildNodeLaneIndex(nodes, cross, clearance)
  return indexes[cross]
}
