import type { QuadrantChart, QuadrantAxis, QuadrantPoint } from './types.ts'
import { accessibilityDirectiveEnd } from '../shared/accessibility-directives.ts'
import { normalizeBrTags } from '../multiline-utils.ts'

// ============================================================================
// Quadrant chart parser
//
// Parses Mermaid quadrantChart syntax into a QuadrantChart structure.
//
// Supported statements:
//   quadrantChart                      (header)
//   title <text>
//   x-axis <left> [--> <right>]
//   y-axis <bottom> [--> <top>]
//   quadrant-1..quadrant-4 <label>
//   <Label>[:::class]: [x, y] [radius/color/stroke metadata]
//   classDef <class> <style metadata>    accepted for Mermaid-docs fidelity;
//                                      style metadata is intentionally ignored
//                                      by the local renderer.
//
// Faithfulness contract (docs/project/lessons-learned.md, Loop 17 ER lesson):
// malformed lines ERROR LOUDLY — never silently dropped:
//   - coordinates out of [0,1]
//   - non-numeric coordinates
//   - missing / malformed brackets on a point line
//   - malformed/unknown point style metadata
//   - any unrecognized statement
// ============================================================================

const TITLE_RE = /^title\s+(.+)$/i
const AXIS_RE = /^([xy])-axis\s+(.+)$/i
const QUADRANT_RE = /^quadrant-([1-4])\s+(.+)$/i
// A point line: `Label[:::class]: [x, y] [style metadata]`. The label is
// everything before the LAST colon that precedes a bracketed coordinate pair.
const POINT_RE = /^(.+?)\s*:\s*\[\s*([^,\]]+)\s*,\s*([^,\]]+)\s*\]\s*(.*)$/
const POINT_CLASS_SUFFIX_RE = /\s*:::\s*[A-Za-z_][\w-]*\s*$/
const POINT_STYLE_KEYS = new Set(['radius', 'color', 'stroke-color', 'stroke-width'])

/**
 * Parse a Mermaid quadrant chart from preprocessed lines (trimmed,
 * comment-stripped). The first line is expected to be the `quadrantChart`
 * header.
 *
 * Throws on malformed input (see faithfulness contract above).
 */
export function parseQuadrantChart(lines: string[]): QuadrantChart {
  if (lines.length === 0) {
    throw new Error('Quadrant chart is empty')
  }

  const header = lines[0]!.trim()
  if (!/^quadrantChart\b\s*$/i.test(header)) {
    throw new Error(`Quadrant chart must start with "quadrantChart", got: "${header}"`)
  }

  let title: string | undefined
  let xAxis: QuadrantAxis | undefined
  let yAxis: QuadrantAxis | undefined
  const quadrants: [string?, string?, string?, string?] = [undefined, undefined, undefined, undefined]
  const points: QuadrantPoint[] = []
  const seenPointLabels = new Set<string>()

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim()
    if (line.length === 0 || line.startsWith('%%')) continue

    // Mermaid's official quadrant docs use classDef and point style metadata.
    // The local renderer does not model those visual styles yet, but accepting
    // and ignoring known styling keeps render/verify seams open without losing
    // source fidelity in the agent path (which falls back to opaque for style).
    if (/^classDef\s+[A-Za-z_][\w-]*\s+.+$/i.test(line)) continue

    // Mermaid-universal accessibility directives: accept and skip, same as
    // classDef (sequence models them fully; quadrant has no aria slot yet).
    const accEnd = accessibilityDirectiveEnd(lines, i)
    if (accEnd !== -1) { i = accEnd; continue }

    let m: RegExpMatchArray | null

    if ((m = line.match(TITLE_RE))) {
      title = normalizeBrTags(m[1]!.trim())
      continue
    }

    if ((m = line.match(AXIS_RE))) {
      const axis = parseAxis(m[2]!.trim(), m[1]!.toLowerCase())
      if (m[1]!.toLowerCase() === 'x') xAxis = axis
      else yAxis = axis
      continue
    }

    if ((m = line.match(QUADRANT_RE))) {
      const idx = Number.parseInt(m[1]!, 10) - 1
      quadrants[idx] = normalizeBrTags(m[2]!.trim())
      continue
    }

    if ((m = line.match(POINT_RE))) {
      const rawLabel = stripPointClass(m[1]!.trim())
      const label = normalizeBrTags(rawLabel)
      const styleTail = m[4]!.trim()
      if (!isSupportedPointStyleTail(styleTail)) {
        throw new Error(
          `Unsupported quadrant point style metadata: "${styleTail}". ` +
            'Expected comma-separated radius/color/stroke-color/stroke-width entries.',
        )
      }
      const x = parseCoord(label, m[2]!.trim())
      const y = parseCoord(label, m[3]!.trim())
      if (seenPointLabels.has(label)) {
        throw new Error(`Duplicate quadrant point label: "${label}"`)
      }
      seenPointLabels.add(label)
      points.push({ label, x, y })
      continue
    }

    // A line that has a `:` looks like a point but didn't match the strict
    // shape (missing/malformed brackets) — surface it loudly.
    if (line.includes(':')) {
      throw new Error(
        `Invalid quadrant point: "${line}". Expected: Label: [x, y] with x,y in [0,1]`,
      )
    }

    throw new Error(`Unrecognized quadrant chart line: "${line}"`)
  }

  return { title, xAxis, yAxis, quadrants, points }
}

/** Parse an axis declaration tail (`<near> [--> <far>]`). */
function parseAxis(tail: string, which: string): QuadrantAxis {
  const side = which === 'x' ? 'left' : 'bottom'
  const arrowIdx = tail.indexOf('-->')
  if (arrowIdx >= 0) {
    const near = normalizeBrTags(tail.slice(0, arrowIdx).trim())
    const far = normalizeBrTags(tail.slice(arrowIdx + 3).trim())
    if (!near) throw new Error(`Quadrant ${which}-axis is missing its ${side} label: "${tail}"`)
    if (!far) throw new Error(`Quadrant ${which}-axis has "-->" but no far label: "${tail}"`)
    return { near, far }
  }
  const near = normalizeBrTags(tail.trim())
  if (!near) throw new Error(`Quadrant ${which}-axis is missing its ${side} label`)
  return { near }
}

function stripPointClass(label: string): string {
  return label.replace(POINT_CLASS_SUFFIX_RE, '').trim()
}

function isSupportedPointStyleTail(tail: string): boolean {
  if (tail.length === 0) return true
  const parts = tail.split(',').map(part => part.trim()).filter(Boolean)
  if (parts.length === 0) return true
  return parts.every(part => {
    const match = part.match(/^([a-z][\w-]*)\s*:\s*(.+)$/i)
    return Boolean(match && POINT_STYLE_KEYS.has(match[1]!.toLowerCase()) && match[2]!.trim().length > 0)
  })
}

/** Parse a coordinate, enforcing the [0,1] range (loud error otherwise). */
function parseCoord(label: string, raw: string): number {
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(raw)) {
    throw new Error(
      `Quadrant point "${label}" has non-numeric coordinate "${raw}". ` +
        'Coordinates must be numbers in [0, 1].',
    )
  }
  const value = Number.parseFloat(raw)
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(
      `Quadrant point "${label}" coordinate "${raw}" is out of range. ` +
        'Coordinates must be in [0, 1].',
    )
  }
  return value
}
