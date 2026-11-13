import type { PositionedMindmapNode } from './types.ts'

/** Alternating horizontal radius used by the twelve-point `))bang((` burst. */
export const MINDMAP_BANG_INNER_RADIUS_RATIO = 0.38

/** X coordinate where a horizontal branch meets the node's painted outline.
 * Most shapes reach their rectangular side at mid-height; the bang burst does
 * not, so routing to its layout box leaves a visible gap. */
export function mindmapHorizontalBoundaryX(
  node: PositionedMindmapNode,
  side: 'left' | 'right',
): number {
  const radius = node.width * (node.shape === 'bang' ? MINDMAP_BANG_INNER_RADIUS_RATIO : 0.5)
  return node.x + node.width / 2 + (side === 'right' ? radius : -radius)
}
