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
// Spellings depend only on primitive numbers. Bound retention across unrelated
// documents; repeated coordinates and text metrics share their conversion.
const numberSpellings = new Map<number, string>()
const attributeSpellings = new Map<string, string>()

/** Write numeric SVG fields at twelve significant digits only when their decimal spelling has a long tail. */
export function formatSvgNumber(value: number): string {
  const cached = numberSpellings.get(value)
  if (cached !== undefined) return cached
  const text = String(value)
  const formatted = text.length >= 14 && SVG_LONG_DECIMAL.test(text) && Number.isFinite(value)
    ? String(Number(value.toPrecision(12))) : text
  if (numberSpellings.size >= 1024) numberSpellings.clear()
  numberSpellings.set(value, formatted)
  return formatted
}

/** Numeric SVG payloads share one spelling; semantic strings stay verbatim. */
export function formatSvgNumericAttribute(name: string, value: string): string {
  if (value.length < 13 || !SVG_LONG_DECIMAL.test(value)) return value
  // Retain only short numeric fields, never complete SVG or semantic payloads.
  const key = value.length <= 512 ? `${name}\0${value}` : undefined
  const cached = key === undefined ? undefined : attributeSpellings.get(key)
  if (cached !== undefined) return cached
  const numeric = SVG_NUMERIC_ATTRIBUTES.has(name) && SCALAR_SVG_NUMBER.test(value)
    || (name === 'viewBox' || name === 'points' || name === 'stroke-dasharray') && /^[-+\d.eE,\s]+$/.test(value)
    || name === 'd' && /^[MmZzLlHhVvCcSsQqTtAa\d.eE,+\s-]+$/.test(value)
    || (name === 'transform' || name === 'gradientTransform' || name === 'patternTransform')
      && /^(?:(?:matrix|translate|scale|rotate|skewX|skewY)\s*\([-+\d.eE,\s]+\)\s*)+$/.test(value)
  if (!numeric) return value
  const formatted = value.replace(SVG_NUMBER, (token, index: number) => {
    if (!SVG_LONG_DECIMAL.test(token)) return token
    const number = Number(token)
    if (!Number.isFinite(number)) return token
    const formatted = formatSvgNumber(number)
    // SVG paths allow adjacent decimal tokens without whitespace. Preserve
    // their boundary if rounding changes a leading dot into a digit.
    return token.startsWith('.') && index > 0 && /[\d.]/.test(value[index - 1]!)
      ? ` ${formatted}` : formatted
  })
  if (key !== undefined) {
    if (attributeSpellings.size >= 256) attributeSpellings.clear()
    attributeSpellings.set(key, formatted)
  }
  return formatted
}
