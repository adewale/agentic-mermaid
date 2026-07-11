import type { QuadrantChart, QuadrantAxis, QuadrantPoint } from './types.ts'
import { normalizeBrTags } from '../multiline-utils.ts'
import { syntaxError } from '../shared/syntax-error.ts'
import { parsePointStyleEntries, parseClassDefTail, splitPointClassSuffix } from './point-style.ts'

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
//   classDef <class> <style metadata>
//
// Point styling follows upstream (merged mermaid-js/mermaid#5173): styles are
// MODELED — they flow through layout to the renderer. The grammar lives in
// point-style.ts (shared with the agent body so the surfaces cannot drift).
//
// Faithfulness contract (docs/project/lessons-learned.md, Loop 17 ER lesson):
// malformed lines ERROR LOUDLY — never silently dropped:
//   - coordinates out of [0,1]
//   - non-numeric coordinates
//   - missing / malformed brackets on a point line
//   - malformed/unknown point or classDef style metadata
//   - any unrecognized statement
// ============================================================================

const TITLE_RE = /^title\s+(.+)$/i
const AXIS_RE = /^([xy])-axis\s+(.+)$/i
const QUADRANT_RE = /^quadrant-([1-4])\s+(.+)$/i
// A point line: `Label[:::class]: [x, y] [style metadata]`. The label is
// everything before the LAST colon that precedes a bracketed coordinate pair.
const POINT_RE = /^(.+?)\s*:\s*\[\s*([^,\]]+)\s*,\s*([^,\]]+)\s*\]\s*(.*)$/
const CLASSDEF_RE = /^classDef\s+(.+)$/i
const ACC_TITLE_RE = /^accTitle\s*:\s*(.+)$/i
const ACC_DESCR_RE = /^accDescr\s*:\s*(?!\{)(.+)$/i
const ACC_DESCR_BLOCK_RE = /^accDescr\s*:?\s*\{\s*(.*)$/i

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
  const accessibility: NonNullable<QuadrantChart['accessibility']> = {}
  let xAxis: QuadrantAxis | undefined
  let yAxis: QuadrantAxis | undefined
  const quadrants: [string?, string?, string?, string?] = [undefined, undefined, undefined, undefined]
  const points: QuadrantPoint[] = []
  // Null prototype: `__proto__`/`constructor` are legal class names and must
  // become ordinary own keys, never prototype writes/reads.
  const classDefs: QuadrantChart['classDefs'] = Object.create(null) as QuadrantChart['classDefs']
  const seenPointLabels = new Set<string>()

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim()
    if (line.length === 0 || line.startsWith('%%')) continue

    let m: RegExpMatchArray | null

    // classDef <name> <styles> — modeled (upstream point styling contract).
    if ((m = line.match(CLASSDEF_RE))) {
      const parsed = parseClassDefTail(m[1]!)
      if (!parsed.ok) {
        throw new Error(`Invalid quadrant classDef: ${parsed.error}`)
      }
      classDefs[parsed.name] = parsed.style
      continue
    }

    if ((m = line.match(ACC_TITLE_RE))) {
      accessibility.title = normalizeBrTags(m[1]!.trim())
      continue
    }
    if ((m = line.match(ACC_DESCR_RE))) {
      accessibility.description = normalizeBrTags(m[1]!.trim())
      continue
    }
    if ((m = line.match(ACC_DESCR_BLOCK_RE))) {
      const parts: string[] = []
      let rest = m[1]!
      let closed = false
      for (;;) {
        const end = rest.indexOf('}')
        if (end !== -1) {
          const text = rest.slice(0, end).trim()
          if (text) parts.push(text)
          if (rest.slice(end + 1).trim()) {
            throw new Error(`Unrecognized text after quadrant accDescr block: "${rest.slice(end + 1).trim()}"`)
          }
          closed = true
          break
        }
        if (rest.trim()) parts.push(rest.trim())
        i++
        if (i >= lines.length) break
        rest = lines[i]!
      }
      if (!closed) throw new Error('Quadrant accDescr block is missing a closing "}"')
      accessibility.description = normalizeBrTags(parts.join('\n'))
      continue
    }

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
      const { label: rawLabel, className } = splitPointClassSuffix(m[1]!.trim())
      const label = normalizeBrTags(rawLabel)
      const styleTail = m[4]!.trim()
      const parsedStyle = parsePointStyleEntries(styleTail)
      if (!parsedStyle.ok) {
        throw new Error(
          `Unsupported quadrant point style metadata: "${styleTail}" — ${parsedStyle.error}. ` +
            'Expected comma-separated radius/color/stroke-color/stroke-width entries.',
        )
      }
      const x = parseCoord(label, m[2]!.trim())
      const y = parseCoord(label, m[3]!.trim())
      if (seenPointLabels.has(label)) {
        throw new Error(`Duplicate quadrant point label: "${label}"`)
      }
      seenPointLabels.add(label)
      const point: QuadrantPoint = { label, x, y }
      if (className !== undefined) point.className = className
      if (parsedStyle.style !== undefined) point.style = parsedStyle.style
      points.push(point)
      continue
    }

    // A line that has a `:` looks like a point but didn't match the strict
    // shape (missing/malformed brackets) — surface it loudly.
    if (line.includes(':')) {
      throw new Error(
        `Invalid quadrant point: "${line}". Expected: Label: [x, y] with x,y in [0,1]`,
      )
    }

    throw syntaxError({
      what: `Unrecognized quadrant chart line: "${line}"`,
      expectedForm: 'a title, x-axis/y-axis, a quadrant-N label, a point (Label: [x, y]), or a classDef',
      example: 'Quick win: [0.2, 0.8]',
    })
  }

  return {
    title,
    ...(accessibility.title || accessibility.description ? { accessibility } : {}),
    xAxis,
    yAxis,
    quadrants,
    points,
    classDefs,
  }
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
