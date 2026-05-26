// ============================================================================
// SVG path helpers for partial fills inside rounded boxes.
//
// Use this instead of rounded <rect> elements for header bands: a full rounded
// rect gives partial-height fills their own rounded bottom corners, which creates
// visual seams and pill/crescent artifacts.
// ============================================================================

export function topRoundedRectPath(x: number, y: number, width: number, height: number, radius: number): string {
  const r = clampRadius(radius, width / 2, height)
  if (r === 0) return `M${x},${y} H${x + width} V${y + height} H${x} Z`

  return [
    `M${x + r},${y}`,
    `H${x + width - r}`,
    `A${r},${r} 0 0 1 ${x + width},${y + r}`,
    `V${y + height}`,
    `H${x}`,
    `V${y + r}`,
    `A${r},${r} 0 0 1 ${x + r},${y}`,
    'Z',
  ].join(' ')
}


function clampRadius(radius: number, maxX: number, maxY: number): number {
  return Math.max(0, Math.min(radius, maxX, maxY))
}
