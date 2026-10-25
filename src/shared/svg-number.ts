const SVG_NUMBER = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g
export const SVG_LONG_DECIMAL = /\.\d{12}/
const SCALAR_SVG_NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?(?:%|px|pt|pc|em|ex|rem|cm|mm|in)?$/
const SVG_NUMERIC_ATTRIBUTES = new Set([
  'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'dx', 'dy',
  'width', 'height', 'refX', 'refY', 'markerWidth', 'markerHeight',
  'stroke-width', 'stroke-dashoffset', 'stroke-miterlimit', 'pathLength',
  'font-size', 'font-weight', 'letter-spacing', 'textLength',
  'opacity', 'fill-opacity', 'stroke-opacity', 'stop-opacity', 'offset',
])

/** Write numeric SVG fields at twelve significant digits only when their decimal spelling has a long tail. */
export function formatSvgNumber(value: number): string {
  const text = String(value)
  return SVG_LONG_DECIMAL.test(text) && Number.isFinite(value) ? String(Number(value.toPrecision(12))) : text
}

/** Numeric SVG payloads share one spelling; semantic strings stay verbatim. */
export function formatSvgNumericAttribute(name: string, value: string): string {
  if (!SVG_LONG_DECIMAL.test(value)) return value
  const numeric = SVG_NUMERIC_ATTRIBUTES.has(name) && SCALAR_SVG_NUMBER.test(value)
    || (name === 'viewBox' || name === 'points' || name === 'stroke-dasharray') && /^[-+\d.eE,\s]+$/.test(value)
    || name === 'd' && /^[MmZzLlHhVvCcSsQqTtAa\d.eE,+\s-]+$/.test(value)
    || (name === 'transform' || name === 'gradientTransform' || name === 'patternTransform')
      && /^(?:(?:matrix|translate|scale|rotate|skewX|skewY)\s*\([-+\d.eE,\s]+\)\s*)+$/.test(value)
  if (!numeric) return value
  return value.replace(SVG_NUMBER, (token, index: number) => {
    if (!SVG_LONG_DECIMAL.test(token)) return token
    const number = Number(token)
    if (!Number.isFinite(number)) return token
    const formatted = formatSvgNumber(number)
    // SVG paths allow adjacent decimal tokens without whitespace. Preserve
    // their boundary if rounding changes a leading dot into a digit.
    return token.startsWith('.') && index > 0 && /[\d.]/.test(value[index - 1]!)
      ? ` ${formatted}` : formatted
  })
}
