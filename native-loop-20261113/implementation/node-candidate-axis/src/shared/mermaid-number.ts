/** Mermaid's decimal-only numeric grammars cannot read JS exponent notation.
 * Expand the shortest round-tripping JS spelling without rounding the value. */
export function mermaidNumber(value: number): string {
  if (!Number.isFinite(value)) throw new TypeError('Mermaid numbers must be finite')
  const text = String(value)
  const [mantissa, exponent] = text.split('e')
  if (exponent === undefined) return text
  const negative = mantissa!.startsWith('-')
  const [whole, fraction = ''] = (negative ? mantissa!.slice(1) : mantissa!).split('.')
  const digits = whole! + fraction
  const point = whole!.length + Number(exponent)
  const decimal = point <= 0 ? `0.${'0'.repeat(-point)}${digits}`
    : point >= digits.length ? digits + '0'.repeat(point - digits.length)
      : `${digits.slice(0, point)}.${digits.slice(point)}`
  return negative ? `-${decimal}` : decimal
}
