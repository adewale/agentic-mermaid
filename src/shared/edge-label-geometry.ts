import type { PositionedEdge } from '../types.ts'
import { graphEdgeTextBlock } from '../graph-text.ts'
import { resolveLabelContent } from './display-text.ts'

/** Padding between retained text bounds and the painted graph-label pill. */
export const LABEL_PILL_PADDING = 8

/** Opaque paint outside the pill, shared by placement and drawing. */
export function labelHaloExtension(edge: Pick<PositionedEdge, 'style'>, lineWidth: number): number {
  return Math.max(4, lineWidth * (edge.style === 'thick' ? 2 : 1) * 2)
}

export function pillRect(cx: number, cy: number, metrics: { width: number; height: number }): { x: number; y: number; w: number; h: number } {
  const w = metrics.width + 2 * LABEL_PILL_PADDING
  const h = metrics.height + 2 * LABEL_PILL_PADDING
  return { x: cx - w / 2, y: cy - h / 2, w, h }
}

export function labelRect(edge: PositionedEdge, style: Parameters<typeof graphEdgeTextBlock>[1]): ReturnType<typeof pillRect> | null {
  if (!edge.label || !edge.labelPosition) return null
  const block = edge.labelBlock ?? graphEdgeTextBlock(resolveLabelContent(edge.label, edge.labelContent), style)
  return pillRect(edge.labelPosition.x, edge.labelPosition.y, block)
}
