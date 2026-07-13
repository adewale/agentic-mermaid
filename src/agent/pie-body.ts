// ============================================================================
// Pie structured body (promotes pie from opaque-only fallback semantics to
// structured mutation, following the journey/xychart/architecture pilots).
//
// Modeled grammar (mirrors the legacy renderer parser, src/pie/parser.ts):
//   pie [showData] [title <text>]
//   title <text>                 — standalone title directive
//   showData                     — standalone show-data directive
//   "<label>" : <positive number>
//
// Structured-or-opaque: any other non-blank, non-comment family line returns
// null so the caller falls back to a lossless opaque body. Universal
// accTitle/accDescr directives are consumed and preserved by the source
// envelope before this grammar runs.
// We deliberately re-emit a canonical header
// (`pie showData`) plus standalone `title` / entry lines; the legacy parser
// re-parses that canonical output identically (differential-tested). Render
// support is unchanged — the legacy renderer keeps parsing canonical source.
//
// The legacy parser ERRORS LOUDLY on malformed entries; here a structured body
// is only produced when every line is modeled and every entry is a quoted
// label with a positive numeric value — anything else falls back to opaque
// (which preserves it verbatim), and the legacy renderer still surfaces the
// loud error at render time.
// ============================================================================

import { unknownOpMessage } from './mutation-ops.ts'
import type {
  PieBody, PieMutationOp,
  MutationError, Result, LayoutWarning, VerifyOptions,
} from './types.ts'
import { ok, err, DEFAULT_LABEL_CHAR_CAP } from './types.ts'
import { labelOverflowWarning } from './label-metrics.ts'
import { appendAccessibilityLines } from './accessibility-envelope.ts'

// ---- Number format ----------------------------------------------------------
//
// Pie values are positive numbers (Mermaid supports up to two decimal places).
// Canonical format is `String(n)` for finite n > 0; `parseFloat(String(n)) === n`
// for every finite n, and the legacy parser reads values with parseFloat.

function formatNumber(n: number): string {
  return String(n)
}

function isPositiveFinite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0
}

// ---- Parser -----------------------------------------------------------------

/** Entry line: a quoted label, a colon, and a value (shape mirrors legacy). */
const ENTRY_RE = /^"((?:[^"\\]|\\.)*)"\s*:\s*(.+)$/
/** Mermaid pie values: positive numbers, up to two decimal places. */
const NUMBER_RE = /^\+?(?:\d+(?:\.\d+)?|\.\d+)$/

function decodeEscapes(raw: string): string {
  return raw.replace(/\\(["\\])/g, '$1')
}

/** Re-encode a label for emission inside `"..."` (inverse of decodeEscapes). */
function encodeLabel(label: string): string {
  return label.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/**
 * Parse pie body lines (header excluded). The header tail (showData / inline
 * title) is parsed separately by the family hook and passed in. Returns a
 * structured body only if EVERY non-blank, non-comment line is a modeled
 * title / showData / entry directive with a positive numeric value and a
 * quoted label that round-trips. Otherwise returns null (opaque fallback).
 *
 * A structured body must contain at least one slice (the legacy renderer needs
 * data to render).
 */
export function parsePieBody(lines: string[], header: { showData: boolean; title?: string }): PieBody | null {
  const body: PieBody = { kind: 'pie', showData: header.showData, slices: [] }
  if (header.title !== undefined) body.title = header.title
  let sIdx = 0

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('%%')) continue

    if (/^showData\s*$/i.test(line)) {
      body.showData = true
      continue
    }

    const titleMatch = line.match(/^title\s+(.+)$/i)
    if (titleMatch) {
      const title = titleMatch[1]!.trim()
      if (!title) return null
      body.title = title
      continue
    }

    const entryMatch = line.match(ENTRY_RE)
    if (entryMatch) {
      const label = decodeEscapes(entryMatch[1]!)
      const rawValue = entryMatch[2]!.trim()
      if (!NUMBER_RE.test(rawValue)) return null
      const value = Number.parseFloat(rawValue)
      if (!isPositiveFinite(value)) return null
      // A label that wouldn't round-trip (newlines, etc.) falls back to opaque.
      if (label.includes('\n')) return null
      body.slices.push({ id: `slice-${sIdx++}`, label, value })
      continue
    }

    // Unmodeled family line (malformed entry/anything else) → opaque.
    return null
  }

  if (body.slices.length === 0) return null

  return body
}

// ---- Serializer -------------------------------------------------------------

export function renderPie(body: PieBody): string {
  const header = body.showData ? 'pie showData' : 'pie'
  const lines: string[] = [header]
  appendAccessibilityLines(lines, body)
  if (body.title !== undefined) lines.push(`  title ${body.title}`)
  for (const s of body.slices) {
    lines.push(`  "${encodeLabel(s.label)}" : ${formatNumber(s.value)}`)
  }
  return lines.join('\n') + '\n'
}

// ---- Mutator ----------------------------------------------------------------

function clonePie(b: PieBody): PieBody {
  return {
    kind: 'pie',
    accessibilityTitle: b.accessibilityTitle,
    accessibilityDescription: b.accessibilityDescription,
    title: b.title,
    showData: b.showData,
    slices: b.slices.map(s => ({ id: s.id, label: s.label, value: s.value })),
  }
}

function makeSliceIdAllocator(body: PieBody): () => string {
  const seen = new Set(body.slices.map(s => s.id))
  return () => {
    let n = 0
    while (seen.has(`slice-${n}`)) n++
    const id = `slice-${n}`
    seen.add(id)
    return id
  }
}

function validLabel(value: unknown, field: string): Result<string, MutationError> {
  if (typeof value !== 'string') return err({ code: 'INVALID_OP', message: `Pie ${field} must be a string` })
  const trimmed = value.trim()
  if (!trimmed || trimmed.includes('\n')) {
    return err({ code: 'INVALID_OP', message: `Pie ${field} must be non-empty single-line text` })
  }
  return ok(trimmed)
}

function validValue(value: unknown): Result<number, MutationError> {
  if (!isPositiveFinite(value)) {
    return err({ code: 'INVALID_OP', message: `Pie slice value must be a positive finite number, got ${JSON.stringify(value)}` })
  }
  return ok(value)
}

function findSlice(body: PieBody, label: string): number {
  return body.slices.findIndex(s => s.label === label)
}

export function mutatePie(body: PieBody, op: PieMutationOp): Result<PieBody, MutationError> {
  const next = clonePie(body)
  const nextId = makeSliceIdAllocator(next)

  switch (op.kind) {
    case 'set_title': {
      if (op.title === null) { delete next.title; break }
      const t = validLabel(op.title, 'title')
      if (!t.ok) return t
      next.title = t.value
      break
    }
    case 'set_show_data': {
      if (typeof op.showData !== 'boolean') {
        return err({ code: 'INVALID_OP', message: 'Pie set_show_data requires a boolean showData' })
      }
      next.showData = op.showData
      break
    }
    case 'add_slice': {
      const label = validLabel(op.label, 'slice label')
      if (!label.ok) return label
      if (findSlice(next, label.value) >= 0) {
        return err({ code: 'INVALID_OP', message: `Pie slice "${label.value}" already exists` })
      }
      const value = validValue(op.value)
      if (!value.ok) return value
      next.slices.push({ id: nextId(), label: label.value, value: value.value })
      break
    }
    case 'remove_slice': {
      const label = validLabel(op.label, 'slice label')
      if (!label.ok) return label
      const idx = findSlice(next, label.value)
      if (idx < 0) return err({ code: 'SLICE_NOT_FOUND', message: `Pie slice "${label.value}" not found` })
      next.slices.splice(idx, 1)
      break
    }
    case 'rename_slice': {
      const from = validLabel(op.from, 'slice label')
      if (!from.ok) return from
      const to = validLabel(op.to, 'slice label')
      if (!to.ok) return to
      const idx = findSlice(next, from.value)
      if (idx < 0) return err({ code: 'SLICE_NOT_FOUND', message: `Pie slice "${from.value}" not found` })
      if (from.value !== to.value && findSlice(next, to.value) >= 0) {
        return err({ code: 'INVALID_OP', message: `Pie slice "${to.value}" already exists` })
      }
      next.slices[idx]!.label = to.value
      break
    }
    case 'set_slice_value': {
      const label = validLabel(op.label, 'slice label')
      if (!label.ok) return label
      const idx = findSlice(next, label.value)
      if (idx < 0) return err({ code: 'SLICE_NOT_FOUND', message: `Pie slice "${label.value}" not found` })
      const value = validValue(op.value)
      if (!value.ok) return value
      next.slices[idx]!.value = value.value
      break
    }
    case 'reorder_slice': {
      const { from, to } = op
      if (!Number.isInteger(from) || !Number.isInteger(to) || !next.slices[from] || to < 0 || to >= next.slices.length) {
        return err({ code: 'SLICE_NOT_FOUND', message: `reorder_slice indices out of range (from=${from}, to=${to})` })
      }
      const [moved] = next.slices.splice(from, 1)
      next.slices.splice(to, 0, moved!)
      break
    }
    default: {
      const _x: never = op
      return err({ code: 'INVALID_OP', message: unknownOpMessage('pie', _x) })
    }
  }

  // Preserve the structured floor: a pie must keep at least one slice so it
  // always renders.
  if (next.slices.length === 0) {
    return err({ code: 'INVALID_OP', message: 'Pie must keep at least one slice' })
  }

  return ok(next)
}

// ---- Verifier (FamilyPlugin.verify hook) ------------------------------------

export function verifyPie(body: PieBody, opts: VerifyOptions): LayoutWarning[] {
  const cap = opts.labelCharCap ?? DEFAULT_LABEL_CHAR_CAP
  const warnings: LayoutWarning[] = []
  const overflow = (target: string, text: string) => {
    const w = labelOverflowWarning(target, text, cap)
    if (w) warnings.push(w)
  }
  if (body.slices.length === 0) warnings.push({ code: 'EMPTY_DIAGRAM' })
  if (body.title !== undefined) overflow('title', body.title)
  for (const s of body.slices) overflow(s.id, s.label)
  return warnings
}
