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
//   <Label>[:::class]: [x, y] [styles]   x,y in [0,1]
//   classDef <class> <styles>
//
// Per-point styling (upstream mermaid#5173) is STRUCTURED content: `:::`
// classes, direct radius/color/stroke styles, and classDef tables parse into
// typed fields, survive every mutation op, and serialize canonically. The
// style grammar is shared with the renderer parser via
// src/quadrant/point-style.ts, so the two surfaces cannot drift.
//
// Mermaid quadrant numbering (reused from the renderer, src/quadrant/types.ts):
//   1 = top-right, 2 = top-left, 3 = bottom-left, 4 = bottom-right.
// Stored as a 0-based 4-tuple where index `n-1` holds quadrant-`n`.
//
// Structured-or-opaque: any other non-blank, non-comment family line
// (malformed style metadata or unmodeled syntax) returns null. Universal
// accTitle/accDescr directives are consumed and preserved by the source
// envelope before this grammar runs.
// Unmodeled family syntax falls back to a lossless opaque body. The serializer re-emits a
// canonical form the legacy parser re-parses identically (differential-tested).
// The legacy renderer ERRORS LOUDLY on malformed lines / out-of-range coords;
// here those fall back to opaque (preserved verbatim) and still surface the
// loud render-time error.
// ============================================================================

import { unknownOpMessage } from './mutation-ops.ts'
import type {
  QuadrantBody, QuadrantAxis, QuadrantMutationOp, QuadrantPointStyle,
  MutationError, Result, LayoutWarning, VerifyOptions,
} from './types.ts'
import { ok, err, DEFAULT_LABEL_CHAR_CAP } from './types.ts'
import { labelOverflowWarning } from './label-metrics.ts'
import { appendAccessibilityLines } from './accessibility-envelope.ts'
import { renderPointStyleEntries } from '../quadrant/point-style.ts'
import { parseQuadrantChart } from '../quadrant/parser.ts'

// ---- Number format ----------------------------------------------------------

function formatNumber(n: number): string {
  return String(n)
}

function isCoord(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1
}

// ---- Parser -----------------------------------------------------------------

/**
 * Parse quadrant body lines (header excluded). Returns a structured body only
 * if EVERY non-blank, non-comment line is a modeled title / axis / quadrant /
 * point directive with in-range coordinates and no duplicate point labels.
 * Otherwise returns null (opaque fallback). Unlike pie/xychart, an empty
 * quadrant chart (header only) still renders, so there is no minimum-content
 * floor.
 */
export function parseQuadrantBody(lines: string[]): QuadrantBody | null {
  try {
    const parsed = parseQuadrantChart(['quadrantChart', ...lines])
    const body: QuadrantBody = {
      kind: 'quadrant',
      ...(parsed.title === undefined ? {} : { title: parsed.title }),
      ...(parsed.xAxis === undefined ? {} : { xAxis: { ...parsed.xAxis } }),
      ...(parsed.yAxis === undefined ? {} : { yAxis: { ...parsed.yAxis } }),
      quadrants: [...parsed.quadrants],
      points: parsed.points.map(point => ({
        ...point,
        ...(point.style === undefined ? {} : { style: { ...point.style } }),
      })),
    }
    if (Object.keys(parsed.classDefs).length > 0) {
      body.classDefs = Object.assign(Object.create(null), parsed.classDefs)
    }
    return body
  } catch {
    return null
  }
}

// ---- Serializer -------------------------------------------------------------

/** Mermaid represents semantic line breaks inside one statement as `<br/>`. */
function encodeMultilineText(text: string): string {
  return text.replace(/\r?\n/g, '<br/>')
}

function renderAxis(keyword: 'x-axis' | 'y-axis', axis: QuadrantAxis): string {
  const far = axis.far !== undefined ? ` --> ${encodeMultilineText(axis.far)}` : ''
  return `  ${keyword} ${encodeMultilineText(axis.near)}${far}`
}

export function renderQuadrant(body: QuadrantBody): string {
  const lines: string[] = ['quadrantChart']
  appendAccessibilityLines(lines, body)
  if (body.title !== undefined) lines.push(`  title ${encodeMultilineText(body.title)}`)
  if (body.xAxis) lines.push(renderAxis('x-axis', body.xAxis))
  if (body.yAxis) lines.push(renderAxis('y-axis', body.yAxis))
  for (let i = 0; i < 4; i++) {
    const label = body.quadrants[i]
    // JSON round-trips sparse/undefined tuple slots as null. Treat both forms
    // as an absent optional label at the untrusted synthesis boundary.
    if (label != null) lines.push(`  quadrant-${i + 1} ${encodeMultilineText(label)}`)
  }
  for (const p of body.points) {
    const cls = p.className !== undefined ? `:::${p.className}` : ''
    const tail = renderPointStyleEntries(p.style)
    lines.push(`  ${encodeMultilineText(p.label)}${cls}: [${formatNumber(p.x)}, ${formatNumber(p.y)}]${tail ? ` ${tail}` : ''}`)
  }
  // classDefs after points (the upstream docs' canonical order).
  for (const [name, style] of Object.entries(body.classDefs ?? {})) {
    lines.push(`  classDef ${name} ${renderPointStyleEntries(style)}`)
  }
  return lines.join('\n') + '\n'
}

// ---- Mutator ----------------------------------------------------------------

function cloneAxis(a: QuadrantAxis): QuadrantAxis {
  return { near: a.near, far: a.far }
}

function cloneStyle(s: QuadrantPointStyle): QuadrantPointStyle {
  const style: QuadrantPointStyle = {}
  if (s.radius !== undefined) style.radius = s.radius
  if (s.color !== undefined) style.color = s.color
  if (s.strokeColor !== undefined) style.strokeColor = s.strokeColor
  if (s.strokeWidth !== undefined) style.strokeWidth = s.strokeWidth
  if (s.extra !== undefined) style.extra = [...s.extra]
  return style
}

function cloneQuadrant(b: QuadrantBody): QuadrantBody {
  const clone: QuadrantBody = {
    kind: 'quadrant',
    accessibilityTitle: b.accessibilityTitle,
    accessibilityDescription: b.accessibilityDescription,
    title: b.title,
    xAxis: b.xAxis ? cloneAxis(b.xAxis) : undefined,
    yAxis: b.yAxis ? cloneAxis(b.yAxis) : undefined,
    quadrants: [...b.quadrants] as QuadrantBody['quadrants'],
    points: b.points.map(p => {
      const point: QuadrantBody['points'][number] = { label: p.label, x: p.x, y: p.y }
      if (p.className !== undefined) point.className = p.className
      if (p.style !== undefined) point.style = cloneStyle(p.style)
      return point
    }),
  }
  if (b.classDefs !== undefined) {
    // Null prototype for the same reason as the parse site.
    clone.classDefs = Object.assign(
      Object.create(null) as NonNullable<QuadrantBody['classDefs']>,
      Object.fromEntries(Object.entries(b.classDefs).map(([name, style]) => [name, cloneStyle(style)])),
    )
  }
  return clone
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
      return err({ code: 'INVALID_OP', message: unknownOpMessage('quadrant', _x) })
    }
  }

  return ok(next)
}

// ---- Verifier (FamilyDescriptor.verify hook) --------------------------------

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
