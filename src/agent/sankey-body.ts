// ============================================================================
// Sankey structured body — structured mutation for `sankey` / `sankey-beta`
// diagrams, following the journey/xychart/pie/quadrant/radar pilots.
//
// Modeled grammar (mirrors the renderer parser, src/sankey/parser.ts):
//   sankey-beta
//   source,target,value        (CSV, RFC 4180 subset, exactly 3 columns)
//
// Nodes are implied by the labels; the label IS the node identity, so
// rename_node rewrites every occurrence and rejects a collision (it would
// silently merge two nodes' flows). Parallel duplicate rows are legal and
// addressed by (source, target, occurrence).
//
// Structured-or-opaque: accTitle/accDescr and any unmodeled/malformed line
// returns null so the caller falls back to a lossless opaque body. The
// serializer emits a canonical CSV form the renderer parser re-parses
// identically, quoting only when a label demands it. The canonical header is
// `sankey-beta` — the form the wider rendering ecosystem accepts. Empty (no
// links) → opaque, so the loud "no rows" render error still surfaces.
// ============================================================================

import { findSankeyCycle, parseSankeyDiagram } from '../sankey/parser.ts'
import { labelOverflowWarning } from './label-metrics.ts'
import { unknownOpMessage } from './mutation-ops.ts'
import type { LayoutWarning, MutationError, Result, SankeyBody, SankeyMutationOp, VerifyOptions } from './types.ts'
import { DEFAULT_LABEL_CHAR_CAP, err, ok } from './types.ts'

const HEADER_RE = /^sankey(?:-beta)?\s*:?\s*$/i

function formatNumber(n: number): string {
  return String(n)
}

// ---- Parser (structured-or-opaque) ------------------------------------------

/**
 * Construct the typed body only after the renderer parser has fully recognized
 * the source. Accessibility remains source-preserved/opaque, and model states
 * that cannot uphold link addressing stay opaque.
 */
export function parseSankeyBody(lines: string[]): SankeyBody | null {
  if (lines.some(raw => /^\s*acc(?:Title|Descr)\b/i.test(raw))) return null
  const sourceLines = lines.some(raw => HEADER_RE.test(raw.trim())) ? lines : ['sankey-beta', ...lines]
  try {
    const diagram = parseSankeyDiagram(sourceLines)
    const body: SankeyBody = {
      kind: 'sankey',
      links: diagram.links.map(link => ({ source: link.source, target: link.target, value: link.value })),
    }
    return sankeyBodyProblem(body, false) === null ? body : null
  } catch {
    return null
  }
}

/** One owner for every typed SankeyBody invariant. */
export function sankeyBodyProblem(body: SankeyBody, allowEmptyDraft = false): string | null {
  if (body.links.length === 0 && !allowEmptyDraft) {
    return 'Sankey requires at least one source,target,value link.'
  }
  for (const link of body.links) {
    for (const [field, label] of [
      ['source', link.source],
      ['target', link.target],
    ] as const) {
      if (typeof label !== 'string' || label.trim().length === 0) {
        return `Every typed sankey link needs a non-empty ${field} label.`
      }
      if (/[\r\n]/.test(label)) return `Sankey ${field} labels cannot contain line breaks.`
    }
    if (!Number.isFinite(link.value) || link.value < 0) {
      return `Sankey link "${link.source}" -> "${link.target}" needs a non-negative finite value.`
    }
    if (link.source === link.target) {
      return `Sankey link "${link.source}" -> "${link.target}" is a self-loop; sankey diagrams must be acyclic.`
    }
  }
  const cycle = findSankeyCycle(body.links)
  if (cycle) {
    return `Sankey links contain a cycle: ${cycle.map(label => `"${label}"`).join(' -> ')}; sankey diagrams must be acyclic.`
  }
  return null
}

// ---- Serializer -------------------------------------------------------------

/** Quote a CSV field only when its content demands it (RFC 4180). */
function renderCsvField(label: string): string {
  if (/[",]/.test(label) || label !== label.trim()) {
    return `"${label.replace(/"/g, '""')}"`
  }
  return label
}

export function renderSankey(body: SankeyBody): string {
  const lines: string[] = ['sankey-beta']
  for (const link of body.links) {
    lines.push(`  ${renderCsvField(link.source)},${renderCsvField(link.target)},${formatNumber(link.value)}`)
  }
  return lines.join('\n') + '\n'
}

// ---- Mutator ----------------------------------------------------------------

function cloneSankey(b: SankeyBody): SankeyBody {
  return {
    kind: 'sankey',
    links: b.links.map(link => ({ source: link.source, target: link.target, value: link.value })),
  }
}

function validLabel(value: unknown, field: string): Result<string, MutationError> {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return err({ code: 'INVALID_OP', message: `Sankey ${field} must be non-empty text, got ${JSON.stringify(value)}` })
  }
  if (/[\r\n]/.test(value)) {
    return err({ code: 'INVALID_OP', message: `Sankey ${field} cannot contain line breaks` })
  }
  return ok(value.trim())
}

function validValue(value: unknown, field: string): Result<number, MutationError> {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return err({ code: 'INVALID_OP', message: `Sankey ${field} must be a non-negative number, got ${JSON.stringify(value)}` })
  }
  return ok(value)
}

/** Index of the `occurrence`-th link with the given endpoints, else -1. */
function findLink(b: SankeyBody, source: string, target: string, occurrence: number): number {
  let remaining = occurrence
  for (let index = 0; index < b.links.length; index++) {
    const link = b.links[index]!
    if (link.source === source && link.target === target) {
      if (remaining === 0) return index
      remaining--
    }
  }
  return -1
}

function validOccurrence(value: unknown): Result<number, MutationError> {
  if (value === undefined) return ok(0)
  if (!Number.isInteger(value) || (value as number) < 0) {
    return err({ code: 'INVALID_OP', message: `Sankey occurrence must be a non-negative integer, got ${JSON.stringify(value)}` })
  }
  return ok(value as number)
}

export function mutateSankey(body: SankeyBody, op: SankeyMutationOp): Result<SankeyBody, MutationError> {
  const next = cloneSankey(body)

  switch (op.kind) {
    case 'add_link': {
      const source = validLabel(op.source, 'link source')
      if (!source.ok) return source
      const target = validLabel(op.target, 'link target')
      if (!target.ok) return target
      const value = validValue(op.value, 'link value')
      if (!value.ok) return value
      if (source.value === target.value) {
        return err({ code: 'INVALID_OP', message: `Sankey link "${source.value}" -> "${target.value}" would be a self-loop` })
      }
      let at = next.links.length
      if (op.index !== undefined) {
        if (!Number.isInteger(op.index) || op.index < 0 || op.index > next.links.length) {
          return err({ code: 'INVALID_OP', message: `Sankey link index must be an integer from 0 through ${next.links.length}, got ${JSON.stringify(op.index)}` })
        }
        at = op.index
      }
      next.links.splice(at, 0, { source: source.value, target: target.value, value: value.value })
      break
    }
    case 'remove_link': {
      const occurrence = validOccurrence(op.occurrence)
      if (!occurrence.ok) return occurrence
      const idx = findLink(next, String(op.source), String(op.target), occurrence.value)
      if (idx < 0) {
        return err({ code: 'LINK_NOT_FOUND', message: `Sankey link "${String(op.source)}" -> "${String(op.target)}" (occurrence ${occurrence.value}) not found` })
      }
      next.links.splice(idx, 1)
      break
    }
    case 'set_link_value': {
      const occurrence = validOccurrence(op.occurrence)
      if (!occurrence.ok) return occurrence
      const value = validValue(op.value, 'link value')
      if (!value.ok) return value
      const idx = findLink(next, String(op.source), String(op.target), occurrence.value)
      if (idx < 0) {
        return err({ code: 'LINK_NOT_FOUND', message: `Sankey link "${String(op.source)}" -> "${String(op.target)}" (occurrence ${occurrence.value}) not found` })
      }
      next.links[idx]!.value = value.value
      break
    }
    case 'rename_node': {
      const from = validLabel(op.from, 'node label')
      if (!from.ok) return from
      const to = validLabel(op.to, 'node label')
      if (!to.ok) return to
      const exists = next.links.some(link => link.source === from.value || link.target === from.value)
      if (!exists) return err({ code: 'NODE_NOT_FOUND', message: `Sankey node "${from.value}" not found` })
      if (from.value !== to.value && next.links.some(link => link.source === to.value || link.target === to.value)) {
        return err({ code: 'INVALID_OP', message: `Sankey node "${to.value}" already exists; renaming would merge two nodes' flows` })
      }
      for (const link of next.links) {
        if (link.source === from.value) link.source = to.value
        if (link.target === from.value) link.target = to.value
      }
      break
    }
    default: {
      const _x: never = op
      return err({ code: 'INVALID_OP', message: unknownOpMessage('sankey', _x) })
    }
  }

  const invariantProblem = sankeyBodyProblem(next, true)
  if (invariantProblem) return err({ code: 'INVALID_OP', message: invariantProblem })
  return ok(next)
}

// ---- Verifier (FamilyPlugin.verify hook) ------------------------------------

export function verifySankey(body: SankeyBody, opts: VerifyOptions): LayoutWarning[] {
  const cap = opts.labelCharCap ?? DEFAULT_LABEL_CHAR_CAP
  const warnings: LayoutWarning[] = []
  if (body.links.length === 0) warnings.push({ code: 'EMPTY_DIAGRAM' })
  const seen = new Set<string>()
  for (const link of body.links) {
    for (const label of [link.source, link.target]) {
      if (seen.has(label)) continue
      seen.add(label)
      const w = labelOverflowWarning(label, label, cap)
      if (w) warnings.push(w)
    }
  }
  // Conservation (FLOW_IMBALANCE): an intermediate node should pass its
  // quantity through — the layout silently renders max(in, out) when it
  // doesn't. Relative tolerance absorbs float representation, not data drift.
  const inflow = new Map<string, number>()
  const outflow = new Map<string, number>()
  for (const link of body.links) {
    outflow.set(link.source, (outflow.get(link.source) ?? 0) + link.value)
    inflow.set(link.target, (inflow.get(link.target) ?? 0) + link.value)
  }
  for (const label of seen) {
    const received = inflow.get(label)
    const emitted = outflow.get(label)
    if (received === undefined || emitted === undefined) continue
    if (Math.abs(received - emitted) <= 1e-9 * Math.max(1, received, emitted)) continue
    const unaccounted = Number(Math.abs(received - emitted).toPrecision(12))
    warnings.push({
      code: 'FLOW_IMBALANCE',
      node: label,
      inflow: received,
      outflow: emitted,
      message: `Sankey node "${label}" receives ${received} but emits ${emitted}; ` + `the unaccounted ${unaccounted} renders as node height with no matching ribbon`,
    })
  }
  return warnings
}
