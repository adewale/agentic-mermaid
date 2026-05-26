// ============================================================================
// SVG path helpers for partial fills inside rounded boxes.
//
// Use these instead of rounded <rect> elements for header bands and accent rails:
// a full rounded rect gives partial-height/partial-width fills their own rounded
// bottom/right corners, which creates visual seams and pill/crescent artifacts.
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

export function leftRoundedRectPath(x: number, y: number, width: number, height: number, radius: number): string {
  const right = x + width
  const bottom = y + height
  const r = clampRadius(radius, Number.POSITIVE_INFINITY, height / 2)
  if (r === 0) return `M${x},${y} H${right} V${bottom} H${x} Z`

  if (width < r) {
    const inset = r - Math.sqrt(Math.max(0, r * r - (r - width) * (r - width)))
    return [
      `M${right},${y + inset}`,
      `V${bottom - inset}`,
      `A${r},${r} 0 0 1 ${x},${bottom - r}`,
      `V${y + r}`,
      `A${r},${r} 0 0 1 ${right},${y + inset}`,
      'Z',
    ].join(' ')
  }

  return [
    `M${right},${y}`,
    `V${bottom}`,
    `H${x + r}`,
    `A${r},${r} 0 0 1 ${x},${bottom - r}`,
    `V${y + r}`,
    `A${r},${r} 0 0 1 ${x + r},${y}`,
    'Z',
  ].join(' ')
}

function clampRadius(radius: number, maxX: number, maxY: number): number {
  return Math.max(0, Math.min(radius, maxX, maxY))
}
