import type { Point, PositionedEdge } from '../types.ts'
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

export const LABEL_INTERIOR_TOLERANCE = 0.5

/** Clip a segment against the open, slightly inset pill body. */
export function segmentEntersLabelRect(a: Point, b: Point, rect: ReturnType<typeof pillRect>): boolean {
  const left = rect.x + LABEL_INTERIOR_TOLERANCE, right = rect.x + rect.w - LABEL_INTERIOR_TOLERANCE
  const top = rect.y + LABEL_INTERIOR_TOLERANCE, bottom = rect.y + rect.h - LABEL_INTERIOR_TOLERANCE
  const dx = b.x - a.x, dy = b.y - a.y
  if (dx === 0) return dy !== 0 && a.x > left && a.x < right && Math.max(a.y, b.y) > top && Math.min(a.y, b.y) < bottom
  if (dy === 0) return a.y > top && a.y < bottom && Math.max(a.x, b.x) > left && Math.min(a.x, b.x) < right
  const x0 = (left - a.x) / dx, x1 = (right - a.x) / dx
  const y0 = (top - a.y) / dy, y1 = (bottom - a.y) / dy
  return Math.max(0, Math.min(x0, x1), Math.min(y0, y1)) < Math.min(1, Math.max(x0, x1), Math.max(y0, y1))
}
