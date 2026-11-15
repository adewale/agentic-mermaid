import type { ScenePoint, SceneTransform } from './ir.ts'

export type AffineMatrix = readonly [number, number, number, number, number, number]
export const IDENTITY_MATRIX: AffineMatrix = [1, 0, 0, 1, 0, 0]

export function transformMatrix(transform?: SceneTransform): AffineMatrix {
  if (!transform) return IDENTITY_MATRIX
  if (transform.kind === 'matrix') return [transform.a, transform.b, transform.c, transform.d, transform.e, transform.f]
  const radians = transform.angle * Math.PI / 180
  const c = Math.cos(radians), s = Math.sin(radians)
  return [c, s, -s, c, transform.cx - c * transform.cx + s * transform.cy, transform.cy - s * transform.cx - c * transform.cy]
}

export function composeMatrices(a: AffineMatrix, b: AffineMatrix): AffineMatrix {
  return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]]
}

export function transformPoint(point: ScenePoint, m: AffineMatrix): ScenePoint {
  return { x: m[0] * point.x + m[2] * point.y + m[4], y: m[1] * point.x + m[3] * point.y + m[5] }
}

export function inverseMatrix(m: AffineMatrix): AffineMatrix | undefined {
  const determinant = m[0] * m[3] - m[1] * m[2]
  if (!Number.isFinite(determinant) || determinant === 0) return undefined
  return [m[3] / determinant, -m[1] / determinant, -m[2] / determinant, m[0] / determinant, (m[2] * m[5] - m[3] * m[4]) / determinant, (m[1] * m[4] - m[0] * m[5]) / determinant]
}

/** Closed SVG transform grammar used by our own family artwork wrappers. */
export function parseSvgTransform(value: string): AffineMatrix | undefined {
  let matrix = IDENTITY_MATRIX
  let cursor = 0
  const calls = /([A-Za-z]+)\s*\(([^()]*)\)/g
  for (const match of value.matchAll(calls)) {
    if (value.slice(cursor, match.index).trim()) return undefined
    cursor = match.index! + match[0].length
    const raw = match[2]!.trim()
    if (!raw || /^(?:,)|(?:,)$|,\s*,/.test(raw) || !/^[-+\d.eE,\s]+$/.test(raw)) return undefined
    const values = raw.split(/[\s,]+/).map(Number)
    if (!values.every(Number.isFinite)) return undefined
    let next: AffineMatrix
    if (match[1] === 'matrix' && values.length === 6) next = values as unknown as AffineMatrix
    else if (match[1] === 'translate' && (values.length === 1 || values.length === 2)) next = [1, 0, 0, 1, values[0]!, values[1] ?? 0]
    else if (match[1] === 'scale' && (values.length === 1 || values.length === 2)) next = [values[0]!, 0, 0, values[1] ?? values[0]!, 0, 0]
    else if (match[1] === 'rotate' && (values.length === 1 || values.length === 3)) next = transformMatrix({ kind: 'rotate', angle: values[0]!, cx: values[1] ?? 0, cy: values[2] ?? 0 })
    else return undefined
    matrix = composeMatrices(matrix, next)
  }
  return cursor > 0 && !value.slice(cursor).trim() ? matrix : undefined
}

export function serializeTransform(transform: SceneTransform): string {
  return transform.kind === 'rotate'
    ? `rotate(${transform.angle} ${transform.cx} ${transform.cy})`
    : `matrix(${transform.a} ${transform.b} ${transform.c} ${transform.d} ${transform.e} ${transform.f})`
}
