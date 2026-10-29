import type { ShapeRenderer } from './types.ts'
import { getBoxDimensions, renderBox, getBoxAttachmentPoint } from './rectangle.ts'
import { getCorners } from './corners.ts'

/** Box geometry and attachment are shared; corners carry the shape's identity. */
export function decoratedBoxRenderer(shape: 'circle' | 'diamond' | 'hexagon' | 'rounded'): ShapeRenderer {
  return {
    getDimensions: getBoxDimensions,
    render: (label, dimensions, options) => renderBox(label, dimensions, getCorners(shape, options.useAscii), options.useAscii),
    getAttachmentPoint: getBoxAttachmentPoint,
  }
}
