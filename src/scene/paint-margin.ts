/** How far past a mark's canonical paint (its geometry widened by half its
 * stroke) any paint backend may ink, in user units: sketch jitter, bowing and
 * multi-pass strokes included. Backends stay inside it, and layouts keep
 * canonical paint at least this far inside the canvas, so changing the paint
 * backend neither clips ink nor needs a different layout. */
export const PAINT_MARGIN = 8

/** Canvas padding that keeps the paint margin: what was asked for, or the
 * margin when less was asked. */
export function reservePaintMargin<T extends { padding?: number }>(options: T): T {
  return options.padding !== undefined && options.padding < PAINT_MARGIN ? { ...options, padding: PAINT_MARGIN } : options
}
