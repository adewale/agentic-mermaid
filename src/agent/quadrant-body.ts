// ============================================================================
// Quadrant structured body (promotes quadrant from opaque-only fallback
// semantics to structured mutation, following the journey/xychart/architecture
// pilots).
//
// Modeled grammar (mirrors the legacy renderer parser, src/quadrant/parser.ts):
//   quadrantChart
//   title <text>
//   x-axis <near> [--> <far>]
//   y-axis <near> [--> <far>]
//   quadrant-1..quadrant-4 <label>
//   <Label>: [x, y]                  x,y in [0,1]
//
// Mermaid quadrant numbering (reused from the renderer, src/quadrant/types.ts):
//   1 = top-right, 2 = top-left, 3 = bottom-left, 4 = bottom-right.
// Stored as a 0-based 4-tuple where index `n-1` holds quadrant-`n`.
//
// Structured-or-opaque: any other non-blank, non-comment line (accTitle,
// accDescr, styling `:::`/`classDef`, unmodeled syntax) returns null so the
// caller falls back to a lossless opaque body. The serializer re-emits a
// canonical form the legacy parser re-parses identically (differential-tested).
// The legacy renderer ERRORS LOUDLY on malformed lines / out-of-range coords;
// here those fall back to opaque (preserved verbatim) and still surface the
// loud render-time error.
// ============================================================================

import type {
  QuadrantBody, QuadrantAxis, QuadrantMutationOp,
  MutationError, Result, LayoutWarning, VerifyOptions,
} from './types.ts'
import { ok, err, DEFAULT_LABEL_CHAR_CAP } from './types.ts'
import { labelOverflowWarning } from './label-metrics.ts'

// ---- Number format ----------------------------------------------------------

function formatNumber(n: number): string {
  return String(n)
}

function isCoord(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1
}

// ---- Parser -----------------------------------------------------------------

const TITLE_RE = /^title\s+(.+)$/i
const AXIS_RE = /^([xy])-axis\s+(.+)$/i
const QUADRANT_RE = /^quadrant-([1-4])\s+(.+)$/i
const POINT_RE = /^(.+?)\s*:\s*\[\s*([^,\]]+)\s*,\s*([^,\]]+)\s*\]\s*$/
const COORD_RE = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/

function parseCoord(raw: string): number | null {
  if (!COORD_RE.test(raw)) return null
  const v = Number.parseFloat(raw)
  return isCoord(v) ? v : null
}

/** Parse an axis tail `<near> [--> <far>]`, or null when malformed. */
function parseAxis(tail: string): QuadrantAxis | null {
  const arrow = tail.indexOf('-->')
  if (arrow >= 0) {
    const near = tail.slice(0, arrow).trim()
    const far = tail.slice(arrow + 3).trim()
    if (!near || !far) return null
    return { near, far }
  }
  const near = tail.trim()
  if (!near) return null
  return { near }
}

/**
 * Parse quadrant body lines (header excluded). Returns a structured body only
 * if EVERY non-blank, non-comment line is a modeled title / axis / quadrant /
 * point directive with in-range coordinates and no duplicate point labels.
 * Otherwise returns null (opaque fallback). Unlike pie/xychart, an empty
 * quadrant chart (header only) still renders, so there is no minimum-content
 * floor.
 */
export function parseQuadrantBody(lines: string[]): QuadrantBody | null {
  const body: QuadrantBody = {
    kind: 'quadrant',
    quadrants: [undefined, undefined, undefined, undefined],
    points: [],
  }
  const seen = new Set<string>()

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('%%')) continue

    // Styling is unmodeled — fall back to opaque (legacy parser errors loudly).
    if (/^classDef\b/i.test(line) || line.includes(':::')) return null

    let m: RegExpMatchArray | null

    if ((m = line.match(TITLE_RE))) {
      const title = m[1]!.trim()
      if (!title) return null
      body.title = title
      continue
    }

    if ((m = line.match(AXIS_RE))) {
      const axis = parseAxis(m[2]!.trim())
      if (!axis) return null
      if (m[1]!.toLowerCase() === 'x') body.xAxis = axis
      else body.yAxis = axis
      continue
    }

    if ((m = line.match(QUADRANT_RE))) {
      const idx = Number.parseInt(m[1]!, 10) - 1
      const label = m[2]!.trim()
      if (!label) return null
      body.quadrants[idx] = label
      continue
    }

    if ((m = line.match(POINT_RE))) {
      const label = m[1]!.trim()
      const x = parseCoord(m[2]!.trim())
      const y = parseCoord(m[3]!.trim())
      if (!label || x === null || y === null) return null
      if (seen.has(label)) return null
      seen.add(label)
      body.points.push({ label, x, y })
      continue
    }

    // Unmodeled line → opaque fallback.
    return null
  }

  return body
}

// ---- Serializer -------------------------------------------------------------

function renderAxis(keyword: 'x-axis' | 'y-axis', axis: QuadrantAxis): string {
  const far = axis.far !== undefined ? ` --> ${axis.far}` : ''
  return `  ${keyword} ${axis.near}${far}`
}

export function renderQuadrant(body: QuadrantBody): string {
  const lines: string[] = ['quadrantChart']
  if (body.title !== undefined) lines.push(`  title ${body.title}`)
  if (body.xAxis) lines.push(renderAxis('x-axis', body.xAxis))
  if (body.yAxis) lines.push(renderAxis('y-axis', body.yAxis))
  for (let i = 0; i < 4; i++) {
    const label = body.quadrants[i]
    if (label !== undefined) lines.push(`  quadrant-${i + 1} ${label}`)
  }
  for (const p of body.points) {
    lines.push(`  ${p.label}: [${formatNumber(p.x)}, ${formatNumber(p.y)}]`)
  }
  return lines.join('\n') + '\n'
}

// ---- Mutator ----------------------------------------------------------------

function cloneAxis(a: QuadrantAxis): QuadrantAxis {
  return { near: a.near, far: a.far }
}

function cloneQuadrant(b: QuadrantBody): QuadrantBody {
  return {
    kind: 'quadrant',
    title: b.title,
    xAxis: b.xAxis ? cloneAxis(b.xAxis) : undefined,
    yAxis: b.yAxis ? cloneAxis(b.yAxis) : undefined,
    quadrants: [...b.quadrants] as QuadrantBody['quadrants'],
    points: b.points.map(p => ({ label: p.label, x: p.x, y: p.y })),
  }
}

/** A label that round-trips through the canonical serializer: non-empty, no
 *  newline, and (for points) no `:` / `[` that would re-parse as syntax. */
function validLabel(value: unknown, field: string, opts: { point?: boolean } = {}): Result<string, MutationError> {
  if (typeof value !== 'string') return err({ code: 'INVALID_OP', message: `Quadrant ${field} must be a string` })
  const trimmed = value.trim()
  if (!trimmed || trimmed.includes('\n')) {
    return err({ code: 'INVALID_OP', message: `Quadrant ${field} must be non-empty single-line text` })
  }
  if (opts.point && (trimmed.includes(':') || trimmed.includes('[') || trimmed.includes(']'))) {
    return err({ code: 'INVALID_OP', message: `Quadrant ${field} must not contain ':' or brackets` })
  }
  return ok(trimmed)
}

/** An axis label must not contain the `-->` operator (it would re-parse). */
function validAxisLabel(value: unknown, field: string): Result<string, MutationError> {
  const base = validLabel(value, field)
  if (!base.ok) return base
  if (base.value.includes('-->')) {
    return err({ code: 'INVALID_OP', message: `Quadrant ${field} must not contain "-->"` })
  }
  return base
}

function validCoord(value: unknown, field: string): Result<number, MutationError> {
  if (!isCoord(value)) {
    return err({ code: 'INVALID_OP', message: `Quadrant ${field} must be a number in [0, 1], got ${JSON.stringify(value)}` })
  }
  return ok(value)
}

function findPoint(body: QuadrantBody, label: string): number {
  return body.points.findIndex(p => p.label === label)
}

export function mutateQuadrant(body: QuadrantBody, op: QuadrantMutationOp): Result<QuadrantBody, MutationError> {
  const next = cloneQuadrant(body)

  switch (op.kind) {
    case 'set_title': {
      if (op.title === null) { delete next.title; break }
      const t = validLabel(op.title, 'title')
      if (!t.ok) return t
      next.title = t.value
      break
    }
    case 'set_axis_labels': {
      if (op.axis !== 'x' && op.axis !== 'y') {
        return err({ code: 'INVALID_OP', message: `Quadrant set_axis_labels axis must be 'x' or 'y', got ${JSON.stringify(op.axis)}` })
      }
      if (op.near === null) {
        if (op.axis === 'x') delete next.xAxis
        else delete next.yAxis
        break
      }
      const near = validAxisLabel(op.near, `${op.axis}-axis near label`)
      if (!near.ok) return near
      const axis: QuadrantAxis = { near: near.value }
      if (op.far !== undefined && op.far !== null) {
        const far = validAxisLabel(op.far, `${op.axis}-axis far label`)
        if (!far.ok) return far
        axis.far = far.value
      }
      if (op.axis === 'x') next.xAxis = axis
      else next.yAxis = axis
      break
    }
    case 'set_quadrant_label': {
      if (!Number.isInteger(op.quadrant) || op.quadrant < 1 || op.quadrant > 4) {
        return err({ code: 'INVALID_OP', message: `Quadrant number must be 1..4, got ${JSON.stringify(op.quadrant)}` })
      }
      const idx = op.quadrant - 1
      if (op.label === null) { next.quadrants[idx] = undefined; break }
      const label = validLabel(op.label, 'quadrant label')
      if (!label.ok) return label
      next.quadrants[idx] = label.value
      break
    }
    case 'add_point': {
      const label = validLabel(op.label, 'point label', { point: true })
      if (!label.ok) return label
      if (findPoint(next, label.value) >= 0) {
        return err({ code: 'INVALID_OP', message: `Quadrant point "${label.value}" already exists` })
      }
      const x = validCoord(op.x, 'point x')
      if (!x.ok) return x
      const y = validCoord(op.y, 'point y')
      if (!y.ok) return y
      next.points.push({ label: label.value, x: x.value, y: y.value })
      break
    }
    case 'remove_point': {
      const label = validLabel(op.label, 'point label', { point: true })
      if (!label.ok) return label
      const idx = findPoint(next, label.value)
      if (idx < 0) return err({ code: 'POINT_NOT_FOUND', message: `Quadrant point "${label.value}" not found` })
      next.points.splice(idx, 1)
      break
    }
    case 'move_point': {
      const label = validLabel(op.label, 'point label', { point: true })
      if (!label.ok) return label
      const idx = findPoint(next, label.value)
      if (idx < 0) return err({ code: 'POINT_NOT_FOUND', message: `Quadrant point "${label.value}" not found` })
      const x = validCoord(op.x, 'point x')
      if (!x.ok) return x
      const y = validCoord(op.y, 'point y')
      if (!y.ok) return y
      next.points[idx]!.x = x.value
      next.points[idx]!.y = y.value
      break
    }
    case 'rename_point': {
      const from = validLabel(op.from, 'point label', { point: true })
      if (!from.ok) return from
      const to = validLabel(op.to, 'point label', { point: true })
      if (!to.ok) return to
      const idx = findPoint(next, from.value)
      if (idx < 0) return err({ code: 'POINT_NOT_FOUND', message: `Quadrant point "${from.value}" not found` })
      if (from.value !== to.value && findPoint(next, to.value) >= 0) {
        return err({ code: 'INVALID_OP', message: `Quadrant point "${to.value}" already exists` })
      }
      next.points[idx]!.label = to.value
      break
    }
    default: {
      const _x: never = op
      return err({ code: 'INVALID_OP', message: `Unknown op: ${JSON.stringify(_x)}` })
    }
  }

  return ok(next)
}

// ---- Verifier (FamilyPlugin.verify hook) ------------------------------------

export function verifyQuadrant(body: QuadrantBody, opts: VerifyOptions): LayoutWarning[] {
  const cap = opts.labelCharCap ?? DEFAULT_LABEL_CHAR_CAP
  const warnings: LayoutWarning[] = []
  const overflow = (target: string, text: string) => {
    const w = labelOverflowWarning(target, text, cap)
    if (w) warnings.push(w)
  }
  // A quadrant chart with no axes, no quadrant labels, and no points renders as
  // an empty grid — flag it as empty, mirroring the other families' floor.
  const empty = body.title === undefined && !body.xAxis && !body.yAxis &&
    body.quadrants.every(q => q === undefined) && body.points.length === 0
  if (empty) warnings.push({ code: 'EMPTY_DIAGRAM' })
  if (body.title !== undefined) overflow('title', body.title)
  if (body.xAxis) { overflow('x-axis', body.xAxis.near); if (body.xAxis.far !== undefined) overflow('x-axis', body.xAxis.far) }
  if (body.yAxis) { overflow('y-axis', body.yAxis.near); if (body.yAxis.far !== undefined) overflow('y-axis', body.yAxis.far) }
  for (let i = 0; i < 4; i++) {
    const label = body.quadrants[i]
    if (label !== undefined) overflow(`quadrant-${i + 1}`, label)
  }
  for (const p of body.points) overflow(p.label, p.label)
  return warnings
}
