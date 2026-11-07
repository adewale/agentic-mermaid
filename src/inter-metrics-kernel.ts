import { interMetricsData } from './inter-metrics-data.ts'
import type { ProfileTextMeasurementInput, TextMeasurementProfile } from './text-measurement-profile.ts'
import type { measureMonospaceTextWidth, measureTextWidth } from './text-metrics.ts'

export function createInterMetrics(fallback: { monospace: typeof measureMonospaceTextWidth; estimate: typeof measureTextWidth }): TextMeasurementProfile {
  type Face = { advances: readonly number[]; keys: Uint16Array; adjustments: Int16Array; upem: number }
  const faces = new Map<number, Face>()

  function faceFor(weight: number): Face | undefined {
    const cached = faces.get(weight)
    if (cached) return cached
    const data = interMetricsData().find(face => face.weight === weight)
    if (!data) return undefined
    const bytes = Uint8Array.from(atob(data.pairs), char => char.charCodeAt(0))
    const keys = new Uint16Array(data.count), adjustments = new Int16Array(keys.length)
    for (let i = 0, cursor = 0, key = 0; i < keys.length; i++) {
      let delta = bytes[cursor++]!
      if (delta & 128) delta = (delta & 127) | (bytes[cursor++]! << 7)
      key += delta
      keys[i] = key
      adjustments[i] = data.values[bytes[cursor++]!]!
    }
    const face = { advances: data.advances, keys, adjustments, upem: data.upem }
    faces.set(weight, face)
    return face
  }

  function pairAdjustment(face: Face, key: number): number {
    let low = 0, high = face.keys.length - 1
    while (low <= high) {
      const middle = (low + high) >>> 1, found = face.keys[middle]!
      if (found === key) return face.adjustments[middle]!
      if (found < key) low = middle + 1
      else high = middle - 1
    }
    return 0
  }

  /** Pinned Inter normal faces, printable ASCII, exact supported weights. Other
   * runs retain the deterministic estimator. Pair corrections are deliberately
   * not advertised as a general contextual or international shaping engine. */
  function measure(input: Readonly<ProfileTextMeasurementInput>): number {
    if (input.monospace) return fallback.monospace(input.text, input.fontSize, 0, input.fontWeight, input.fontStyle, input.fontFamily)
    const firstFamily = input.fontFamily.split(',')[0]!.trim().replace(/^['"]|['"]$/g, '').toLowerCase()
    const face = firstFamily === 'inter' && input.fontStyle === 'normal' && !/[^\x20-\x7e]/u.test(input.text) ? faceFor(input.fontWeight) : undefined
    if (!face) return fallback.estimate(input.text, input.fontSize, input.fontWeight, input.fontStyle, input.fontFamily)
    let units = 0, previous = -1
    for (let i = 0; i < input.text.length; i++) {
      const glyph = input.text.charCodeAt(i) - 32
      units += face.advances[glyph]!
      if (previous >= 0) units += pairAdjustment(face, previous * 95 + glyph)
      previous = glyph
    }
    return Math.max(0, units * input.fontSize / face.upem)
  }

  return Object.freeze({
    id: 'agentic-mermaid:bundled-inter-ascii', version: '1.0.0', measure,
  })
}

export const coversInterMetrics = (input: Readonly<ProfileTextMeasurementInput>): boolean => !input.monospace && input.fontStyle === 'normal'
  && input.fontFamily.split(',')[0]!.trim().replace(/^['"]|['"]$/g, '').toLowerCase() === 'inter'
  && [400, 500, 600, 700].includes(input.fontWeight) && !/[^\x20-\x7e]/u.test(input.text)
