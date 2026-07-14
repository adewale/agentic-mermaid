// ============================================================================
// Radar structured body — structured mutation for `radar-beta` diagrams,
// following the journey/xychart/pie/quadrant pilots.
//
// Modeled grammar (mirrors the legacy renderer parser, src/radar/parser.ts):
//   radar-beta
//   title <text>
//   axis  id[["Label"]] [, id2 …]
//   curve id[["Label"]]{ v1, v2, … }        (positional, axis order)
//   curve id[["Label"]]{ axisId[:] v, … }   (keyed, colon optional)
//   min <n> | max <n> | ticks <n> | graticule circle|polygon | showLegend <bool>
//
// Coupling invariant: every curve carries exactly one value per axis, so
// add/remove/reorder-axis re-shape every curve's value vector and the mutator
// keeps `curve.values.length === axes.length` by construction.
//
// Structured-or-opaque: accTitle/accDescr and any unmodeled/malformed line
// returns null so the caller falls back to a lossless opaque body. The
// serializer emits a canonical form the legacy parser re-parses identically
// (differential-tested). Empty (no axes) → opaque, so the loud "no axes" render
// error still surfaces.
// ============================================================================

import { unknownOpMessage } from './mutation-ops.ts'
import type {
  RadarBody, RadarMutationOp,
  MutationError, Result, LayoutWarning, VerifyOptions,
} from './types.ts'
import { ok, err, DEFAULT_LABEL_CHAR_CAP } from './types.ts'
import { labelOverflowWarning } from './label-metrics.ts'
import { MAX_RADAR_TICKS, parseRadarChart } from '../radar/parser.ts'
import { resolveRadarScale } from '../radar/scale.ts'
import { normalizeBrTags } from '../multiline-utils.ts'

// ---- Shared lexical shapes --------------------------------------------------

const HEADER_RE = /^radar-beta\s*:?\s*$/i
const ID_RE = /^[\w](?:[\w-]*[\w])?$/

function formatNumber(n: number): string { return String(n) }

// ---- Parser (structured-or-opaque) ------------------------------------------

/**
 * Construct the typed body only after the renderer parser has fully recognized
 * the source. Accessibility remains source-preserved/opaque, and model states
 * that cannot uphold stable identity plus axis↔value coupling stay opaque.
 */
export function parseRadarBody(lines: string[]): RadarBody | null {
  if (lines.some(raw => /^\s*acc(?:Title|Descr)\b/i.test(raw))) return null
  const sourceLines = lines.some(raw => HEADER_RE.test(raw.trim())) ? lines : ['radar-beta', ...lines]
  try {
    const chart = parseRadarChart(sourceLines)
    const body: RadarBody = {
      kind: 'radar',
      title: chart.title,
      axes: chart.axes.map(axis => ({ id: axis.id, label: axis.label })),
      curves: chart.curves.map(curve => ({ id: curve.id, label: curve.label, values: [...curve.values] })),
      min: chart.min,
      max: chart.max,
      ticks: chart.ticks,
      graticule: chart.graticule,
      showLegend: chart.showLegend,
    }
    return radarBodyProblem(body, false) === null ? body : null
  } catch {
    return null
  }
}

/** One owner for every typed RadarBody invariant. */
export function radarBodyProblem(body: RadarBody, allowEmptyDraft = false): string | null {
  const emptyDraft = allowEmptyDraft && body.axes.length === 0 && body.curves.length === 0
  if (body.axes.length === 0 && !emptyDraft) return 'Radar requires at least one axis before curves can exist.'
  if (body.axes.some(axis => !ID_RE.test(axis.id))) return 'Every typed radar axis id must satisfy the Mermaid identifier grammar.'
  if (body.curves.some(curve => !ID_RE.test(curve.id))) return 'Every typed radar curve id must satisfy the Mermaid identifier grammar.'
  if (body.axes.some(axis => axis.label.trim().length === 0)) return 'Typed radar axis labels must be non-empty.'
  if (body.curves.some(curve => curve.label.trim().length === 0)) return 'Typed radar curve labels must be non-empty.'
  if (body.title !== undefined && body.title.trim().length === 0) return 'A typed radar title must be non-empty.'
  if (new Set(body.axes.map(axis => axis.id)).size !== body.axes.length) return 'Radar axis ids must be unique for typed mutation.'
  if (new Set(body.curves.map(curve => curve.id)).size !== body.curves.length) return 'Radar curve ids must be unique for typed mutation.'
  for (const curve of body.curves) {
    if (curve.values.length !== body.axes.length) {
      return `Radar curve "${curve.id}" needs exactly ${body.axes.length} value(s) (one per axis).`
    }
  }
  if (!Number.isInteger(body.ticks) || body.ticks < 1 || body.ticks > MAX_RADAR_TICKS) {
    return `Radar ticks must be an integer from 1 through ${MAX_RADAR_TICKS}.`
  }
  if (emptyDraft) {
    if (!Number.isFinite(body.min) || body.min < 0) return 'Radar min must be a finite non-negative number.'
    if (body.max !== undefined && (!Number.isFinite(body.max) || body.max <= body.min)) return 'Radar max must be finite and greater than min.'
    return null
  }
  try { resolveRadarScale(body) } catch (error) { return error instanceof Error ? error.message : String(error) }
  return null
}

// ---- Serializer -------------------------------------------------------------

function renderAxisLabel(id: string, label: string): string {
  if (label === id) return id
  const escaped = label
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
  return `${id}["${escaped}"]`
}

export function renderRadar(body: RadarBody): string {
  const lines: string[] = ['radar-beta']
  if (body.title !== undefined) lines.push(`  title ${body.title.replace(/\r\n?|\n/g, '<br/>')}`)
  if (body.axes.length > 0) {
    lines.push('  axis ' + body.axes.map(a => renderAxisLabel(a.id, a.label)).join(', '))
  }
  for (const c of body.curves) {
    lines.push(`  curve ${renderAxisLabel(c.id, c.label)}{${c.values.map(formatNumber).join(', ')}}`)
  }
  // Non-default options only — keeps canonical output minimal and idempotent.
  if (body.min !== 0) lines.push(`  min ${formatNumber(body.min)}`)
  if (body.max !== undefined) lines.push(`  max ${formatNumber(body.max)}`)
  if (body.ticks !== 5) lines.push(`  ticks ${formatNumber(body.ticks)}`)
  if (body.graticule !== 'circle') lines.push(`  graticule ${body.graticule}`)
  if (!body.showLegend) lines.push('  showLegend false')
  return lines.join('\n') + '\n'
}

// ---- Mutator ----------------------------------------------------------------

function cloneRadar(b: RadarBody): RadarBody {
  return {
    kind: 'radar',
    title: b.title,
    axes: b.axes.map(a => ({ id: a.id, label: a.label })),
    curves: b.curves.map(c => ({ id: c.id, label: c.label, values: [...c.values] })),
    min: b.min,
    max: b.max,
    ticks: b.ticks,
    graticule: b.graticule,
    showLegend: b.showLegend,
  }
}

function validId(value: unknown, field: string): Result<string, MutationError> {
  if (typeof value !== 'string' || !ID_RE.test(value.trim())) {
    return err({ code: 'INVALID_OP', message: `Radar ${field} must be an identifier (letters/digits/_/-, not ending in -), got ${JSON.stringify(value)}` })
  }
  return ok(value.trim())
}

function validLabel(value: unknown, field: string): Result<string, MutationError> {
  if (typeof value !== 'string') return err({ code: 'INVALID_OP', message: `Radar ${field} must be a string` })
  const text = normalizeBrTags(value).trim()
  if (!text) return err({ code: 'INVALID_OP', message: `Radar ${field} must be non-empty text` })
  return ok(text)
}

function validValue(value: unknown, field: string): Result<number, MutationError> {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return err({ code: 'INVALID_OP', message: `Radar ${field} must be a non-negative number, got ${JSON.stringify(value)}` })
  }
  return ok(value)
}

function findAxis(b: RadarBody, id: string): number { return b.axes.findIndex(a => a.id === id) }
function findCurve(b: RadarBody, id: string): number { return b.curves.findIndex(c => c.id === id) }

function insertionIndex(index: number | undefined, len: number, what: string): Result<number, MutationError> {
  if (index === undefined) return ok(len)
  if (!Number.isInteger(index) || index < 0 || index > len) {
    return err({ code: 'INVALID_OP', message: `Radar ${what} index must be an integer from 0 through ${len}, got ${JSON.stringify(index)}` })
  }
  return ok(index)
}

export function mutateRadar(body: RadarBody, op: RadarMutationOp): Result<RadarBody, MutationError> {
  const next = cloneRadar(body)

  switch (op.kind) {
    case 'set_title': {
      if (op.title === null) { delete next.title; break }
      const t = validLabel(op.title, 'title')
      if (!t.ok) return t
      next.title = t.value
      break
    }
    case 'add_axis': {
      const id = validId(op.id, 'axis id')
      if (!id.ok) return id
      if (findAxis(next, id.value) >= 0) return err({ code: 'INVALID_OP', message: `Radar axis "${id.value}" already exists` })
      let label = id.value
      if (op.label !== undefined && op.label !== null) {
        const l = validLabel(op.label, 'axis label')
        if (!l.ok) return l
        label = l.value
      }
      let fill = next.min
      if (op.fill !== undefined) {
        const f = validValue(op.fill, 'axis fill value')
        if (!f.ok) return f
        fill = f.value
      }
      const at = insertionIndex(op.index, next.axes.length, 'axis insertion')
      if (!at.ok) return at
      next.axes.splice(at.value, 0, { id: id.value, label })
      for (const c of next.curves) c.values.splice(at.value, 0, fill)
      break
    }
    case 'remove_axis': {
      const idx = findAxis(next, typeof op.id === 'string' ? op.id : '')
      if (idx < 0) return err({ code: 'AXIS_NOT_FOUND', message: `Radar axis "${String(op.id)}" not found` })
      next.axes.splice(idx, 1)
      for (const c of next.curves) c.values.splice(idx, 1)
      break
    }
    case 'rename_axis': {
      const from = validId(op.from, 'axis id')
      if (!from.ok) return from
      const to = validId(op.to, 'axis id')
      if (!to.ok) return to
      const idx = findAxis(next, from.value)
      if (idx < 0) return err({ code: 'AXIS_NOT_FOUND', message: `Radar axis "${from.value}" not found` })
      if (from.value !== to.value && findAxis(next, to.value) >= 0) return err({ code: 'INVALID_OP', message: `Radar axis "${to.value}" already exists` })
      const axis = next.axes[idx]!
      const hadDefaultLabel = axis.label === axis.id
      axis.id = to.value
      if (hadDefaultLabel) axis.label = to.value
      break
    }
    case 'set_axis_label': {
      const idx = findAxis(next, typeof op.id === 'string' ? op.id : '')
      if (idx < 0) return err({ code: 'AXIS_NOT_FOUND', message: `Radar axis "${String(op.id)}" not found` })
      if (op.label === null) { next.axes[idx]!.label = next.axes[idx]!.id; break }
      const l = validLabel(op.label, 'axis label')
      if (!l.ok) return l
      next.axes[idx]!.label = l.value
      break
    }
    case 'reorder_axis': {
      const move = reorder(next.axes.length, op.from, op.to, 'axis')
      if (!move.ok) return move
      const [f, t] = [move.value.from, move.value.to]
      const [axis] = next.axes.splice(f, 1)
      next.axes.splice(t, 0, axis!)
      for (const c of next.curves) { const [v] = c.values.splice(f, 1); c.values.splice(t, 0, v!) }
      break
    }
    case 'add_curve': {
      const id = validId(op.id, 'curve id')
      if (!id.ok) return id
      if (findCurve(next, id.value) >= 0) return err({ code: 'INVALID_OP', message: `Radar curve "${id.value}" already exists` })
      if (!Array.isArray(op.values) || op.values.length !== next.axes.length) {
        return err({ code: 'INVALID_OP', message: `Radar curve "${id.value}" needs exactly ${next.axes.length} value(s) (one per axis)` })
      }
      const values: number[] = []
      for (const v of op.values) { const vr = validValue(v, 'curve value'); if (!vr.ok) return vr; values.push(vr.value) }
      let label = id.value
      if (op.label !== undefined && op.label !== null) {
        const l = validLabel(op.label, 'curve label')
        if (!l.ok) return l
        label = l.value
      }
      const at = insertionIndex(op.index, next.curves.length, 'curve insertion')
      if (!at.ok) return at
      next.curves.splice(at.value, 0, { id: id.value, label, values })
      break
    }
    case 'remove_curve': {
      const idx = findCurve(next, typeof op.id === 'string' ? op.id : '')
      if (idx < 0) return err({ code: 'CURVE_NOT_FOUND', message: `Radar curve "${String(op.id)}" not found` })
      next.curves.splice(idx, 1)
      break
    }
    case 'set_curve_values': {
      const idx = findCurve(next, typeof op.id === 'string' ? op.id : '')
      if (idx < 0) return err({ code: 'CURVE_NOT_FOUND', message: `Radar curve "${String(op.id)}" not found` })
      if (!Array.isArray(op.values) || op.values.length !== next.axes.length) {
        return err({ code: 'INVALID_OP', message: `Radar curve values must have exactly ${next.axes.length} entr(y/ies) (one per axis)` })
      }
      const values: number[] = []
      for (const v of op.values) { const vr = validValue(v, 'curve value'); if (!vr.ok) return vr; values.push(vr.value) }
      next.curves[idx]!.values = values
      break
    }
    case 'set_curve_value': {
      const cIdx = findCurve(next, typeof op.curve === 'string' ? op.curve : '')
      if (cIdx < 0) return err({ code: 'CURVE_NOT_FOUND', message: `Radar curve "${String(op.curve)}" not found` })
      const aIdx = findAxis(next, typeof op.axis === 'string' ? op.axis : '')
      if (aIdx < 0) return err({ code: 'AXIS_NOT_FOUND', message: `Radar axis "${String(op.axis)}" not found` })
      const v = validValue(op.value, 'curve value')
      if (!v.ok) return v
      next.curves[cIdx]!.values[aIdx] = v.value
      break
    }
    case 'set_curve_label': {
      const idx = findCurve(next, typeof op.id === 'string' ? op.id : '')
      if (idx < 0) return err({ code: 'CURVE_NOT_FOUND', message: `Radar curve "${String(op.id)}" not found` })
      if (op.label === null) { next.curves[idx]!.label = next.curves[idx]!.id; break }
      const l = validLabel(op.label, 'curve label')
      if (!l.ok) return l
      next.curves[idx]!.label = l.value
      break
    }
    case 'rename_curve': {
      const from = validId(op.from, 'curve id')
      if (!from.ok) return from
      const to = validId(op.to, 'curve id')
      if (!to.ok) return to
      const idx = findCurve(next, from.value)
      if (idx < 0) return err({ code: 'CURVE_NOT_FOUND', message: `Radar curve "${from.value}" not found` })
      if (from.value !== to.value && findCurve(next, to.value) >= 0) return err({ code: 'INVALID_OP', message: `Radar curve "${to.value}" already exists` })
      const curve = next.curves[idx]!
      const hadDefaultLabel = curve.label === curve.id
      curve.id = to.value
      if (hadDefaultLabel) curve.label = to.value
      break
    }
    case 'reorder_curve': {
      const move = reorder(next.curves.length, op.from, op.to, 'curve')
      if (!move.ok) return move
      const [curve] = next.curves.splice(move.value.from, 1)
      next.curves.splice(move.value.to, 0, curve!)
      break
    }
    case 'set_config': {
      const draft = { min: next.min, max: next.max, ticks: next.ticks, graticule: next.graticule, showLegend: next.showLegend }
      if (op.min !== undefined) { if (op.min === null) draft.min = 0; else { const r = validValue(op.min, 'min'); if (!r.ok) return r; draft.min = r.value } }
      if (op.max !== undefined) { if (op.max === null) draft.max = undefined; else { const r = validValue(op.max, 'max'); if (!r.ok) return r; draft.max = r.value } }
      if (op.ticks !== undefined) { if (op.ticks === null) draft.ticks = 5; else { if (!Number.isInteger(op.ticks) || op.ticks < 1 || op.ticks > MAX_RADAR_TICKS) return err({ code: 'INVALID_OP', message: `Radar ticks must be an integer from 1 through ${MAX_RADAR_TICKS}, got ${JSON.stringify(op.ticks)}` }); draft.ticks = op.ticks } }
      if (op.graticule !== undefined) { if (op.graticule === null) draft.graticule = 'circle'; else if (op.graticule !== 'circle' && op.graticule !== 'polygon') return err({ code: 'INVALID_OP', message: `Radar graticule must be 'circle' or 'polygon'` }); else draft.graticule = op.graticule }
      if (op.showLegend !== undefined) { if (op.showLegend === null) draft.showLegend = true; else if (typeof op.showLegend !== 'boolean') return err({ code: 'INVALID_OP', message: 'Radar showLegend must be a boolean' }); else draft.showLegend = op.showLegend }
      if (draft.max !== undefined && draft.max <= draft.min) return err({ code: 'INVALID_OP', message: `Radar max (${draft.max}) must be greater than min (${draft.min})` })
      next.min = draft.min
      next.max = draft.max
      next.ticks = draft.ticks
      next.graticule = draft.graticule
      next.showLegend = draft.showLegend
      break
    }
    default: {
      const _x: never = op
      return err({ code: 'INVALID_OP', message: unknownOpMessage('radar', _x) })
    }
  }

  const invariantProblem = radarBodyProblem(next, true)
  if (invariantProblem) return err({ code: 'INVALID_OP', message: invariantProblem })
  return ok(next)
}

function reorder(len: number, from: unknown, to: unknown, what: string): Result<{ from: number; to: number }, MutationError> {
  if (!Number.isInteger(from) || (from as number) < 0 || (from as number) >= len) {
    return err({ code: 'INVALID_OP', message: `Radar reorder ${what} 'from' must be 0..${len - 1}, got ${JSON.stringify(from)}` })
  }
  if (!Number.isInteger(to) || (to as number) < 0 || (to as number) >= len) {
    return err({ code: 'INVALID_OP', message: `Radar reorder ${what} 'to' must be 0..${len - 1}, got ${JSON.stringify(to)}` })
  }
  return ok({ from: from as number, to: to as number })
}

// ---- Verifier (FamilyPlugin.verify hook) ------------------------------------

export function verifyRadar(body: RadarBody, opts: VerifyOptions): LayoutWarning[] {
  const cap = opts.labelCharCap ?? DEFAULT_LABEL_CHAR_CAP
  const warnings: LayoutWarning[] = []
  const overflow = (target: string, text: string) => {
    const w = labelOverflowWarning(target, text, cap)
    if (w) warnings.push(w)
  }
  if (body.axes.length === 0 && body.curves.length === 0) warnings.push({ code: 'EMPTY_DIAGRAM' })
  if (body.title !== undefined) overflow('title', body.title)
  for (const a of body.axes) overflow(a.id, a.label)
  for (const c of body.curves) overflow(c.id, c.label)
  return warnings
}
