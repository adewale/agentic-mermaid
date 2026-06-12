import type { QuadrantChart, QuadrantAxis, QuadrantPoint } from './types.ts'
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
//   <Label>: [x, y]                    x,y in [0,1]
//
// Faithfulness contract (docs/project/lessons-learned.md, Loop 17 ER lesson):
// malformed lines ERROR LOUDLY — never silently dropped:
//   - coordinates out of [0,1]
//   - non-numeric coordinates
//   - missing / malformed brackets on a point line
//   - styling syntax we don't model (point/quadrant `:::class`, `classDef`,
//     trailing radius/color directives) — erroring is the honest fallback,
//     since rendering a chart with styling silently stripped would be a lie.
//   - any unrecognized statement
// ============================================================================

const TITLE_RE = /^title\s+(.+)$/i
const AXIS_RE = /^([xy])-axis\s+(.+)$/i
const QUADRANT_RE = /^quadrant-([1-4])\s+(.+)$/i
// A point line: `Label: [x, y]`. The label is everything before the LAST
// colon that precedes a bracketed coordinate pair.
const POINT_RE = /^(.+?)\s*:\s*\[\s*([^,\]]+)\s*,\s*([^,\]]+)\s*\]\s*$/

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

    // We do not model point/class styling. Reject loudly rather than drop.
    if (/^classDef\b/i.test(line)) {
      throw new Error(
        `Quadrant chart styling (classDef) is not supported: "${line}". ` +
          'Remove styling to render this chart.',
      )
    }
    if (line.includes(':::')) {
      throw new Error(
        `Quadrant chart class assignment (:::) is not supported: "${line}". ` +
          'Remove styling to render this chart.',
      )
    }

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
      const label = normalizeBrTags(m[1]!.trim())
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
