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
// Structured-or-opaque: any unmodeled/malformed row
// returns null so the caller falls back to a lossless opaque body. The
// serializer emits a canonical CSV form the renderer parser re-parses
// identically, quoting only when a label demands it. The canonical header is
// `sankey-beta` — the form the wider rendering ecosystem accepts. Empty (no
// links) → opaque, so the loud "no rows" render error still surfaces.
// ============================================================================

import { csvQuotedFieldIsOpen, findSankeyCycle, isSankeyHeader, parseSankeyDiagram } from '../sankey/parser.ts'
import { parseAccessibilityDirective } from '../shared/accessibility-directives.ts'
import { mermaidEntityPrepass } from '../shared/mermaid-entities.ts'
import { labelOverflowCollector } from './body-utils.ts'
import { unknownOpMessage } from './mutation-ops.ts'
import type { Accessibility, LayoutWarning, MutationError, Result, SankeyBody, SankeyMutationOp, VerifyOptions } from './types.ts'
import { err, ok } from './types.ts'

const HEADER_RE = /^sankey(?:-beta)?\s*:?\s*$/i

function formatNumber(n: number): string {
  return String(n)
}

// ---- Parser (structured-or-opaque) ------------------------------------------

/**
 * Construct the typed body only after the renderer parser has fully recognized
 * the source. The shared envelope owns accessibility; model states that
 * cannot uphold link addressing stay opaque.
 */
export function parseSankeyBody(lines: string[], _accessibility: Accessibility = {}): SankeyBody | null {
  if (lines.some(raw => /^\s*acc(?:Title|Descr)\b/i.test(raw))) return null
  const sourceLines = ['sankey-beta', ...lines]
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
      if (label.includes('%%{')) return `Sankey ${field} labels cannot contain a directive opener; CSV has no escape that preserves this identity.`
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

/** Quote a CSV field only when its content demands it (RFC 4180), or when
 * a bare field would open a `%%` comment line. */
function renderCsvField(label: string): string {
  if (/[",]/.test(label) || label !== label.trim() || label.startsWith('%%')) {
    return `"${label.replace(/"/g, '""')}"`
  }
  return label
}

export function renderSankey(body: SankeyBody): string {
  const lines: string[] = ['sankey-beta']
  for (const link of body.links) {
    const row = `${renderCsvField(link.source)},${renderCsvField(link.target)},${formatNumber(link.value)}`
    // Pinned Mermaid rejects an indented row that opens with a quoted field.
    lines.push(row.startsWith('"') ? row : `  ${row}`)
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

/** A node name a typed edit writes. Mermaid's Sankey CSV reader takes only
 * printable ASCII, quoted or not, and its entity prepass turns `#name;` codes
 * into characters it rejects (sankey_unsupported_character): no spelling
 * holds other text. */
function writableName(value: unknown, field: string): Result<string, MutationError> {
  const name = validLabel(value, field)
  if (!name.ok) return name
  const outside = /[^\x20-\x7E]/u.exec(name.value)?.[0]
  if (outside !== undefined) return err({ code: 'INVALID_OP', message: `Sankey ${field} ${JSON.stringify(name.value)} holds U+${outside.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}; Mermaid 12.2.0 reads only printable ASCII in a Sankey row` })
  if (/#\w+;/.test(mermaidEntityPrepass(name.value))) return err({ code: 'INVALID_OP', message: `Sankey ${field} ${JSON.stringify(name.value)} holds an entity code, which Mermaid 12.2.0 decodes to a character its Sankey reader rejects` })
  return name
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
      const source = writableName(op.source, 'link source')
      if (!source.ok) return source
      const target = writableName(op.target, 'link target')
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
      const to = writableName(op.to, 'node label')
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
  const warnings: LayoutWarning[] = []
  const overflow = labelOverflowCollector(warnings, opts)
  if (body.links.length === 0) warnings.push({ code: 'EMPTY_DIAGRAM' })
  const seen = new Set<string>()
  for (const link of body.links) {
    for (const label of [link.source, link.target]) {
      if (seen.has(label)) continue
      seen.add(label)
      overflow(label, label)
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

/** Sankey rows ours reads where pinned Mermaid rejects them, each on its
 * canonical line. Mermaid's CSV lexer reads only printable ASCII in a row
 * (RFC 4180 TEXTDATA, plus commas and quotes), quoted or not: a tab or any
 * non-ASCII character fails, except in the whitespace it trims from the end
 * of the whole source. Its entity prepass first turns each `#name;` or
 * `#123;` code into a marker of non-ASCII characters, so a row holding one
 * fails too. Ours reads the text as written. */
export function sankeyUnsupportedSyntaxWarnings(canonicalSource: string, authoredLine?: (canonicalLine: number) => string | undefined): LayoutWarning[] {
  const lines = canonicalSource.split(/\r?\n/)
  const header = lines.findIndex(line => HEADER_RE.test(line.trim()))
  if (header < 0) return []
  let last = lines.length - 1
  while (last > header && !lines[last]!.trim()) last--
  const warnings: LayoutWarning[] = []
  let csvRecord = ''
  for (let index = header + 1; index <= last; index++) {
    const trimmed = lines[index]!.trim()
    if (!trimmed) continue
    const continuation = csvRecord.length > 0
    if (!continuation && isSankeyHeader(trimmed)) {
      warnings.push({ code: 'UNSUPPORTED_SYNTAX', syntax: 'sankey_repeated_header', line: index + 1,
        message: 'A standalone repeated Sankey header is read as a header, not a CSV row. Pinned Mermaid rejects it; canonical export writes one header.',
      })
      continue
    }
    const directive = continuation ? null : parseAccessibilityDirective(lines, index)
    if (directive === undefined) break
    if (directive) {
      warnings.push({ code: 'UNSUPPORTED_SYNTAX', syntax: 'sankey_accessibility', line: index + 1, message: 'Sankey accessibility metadata is carried in native comments on export. External Mermaid ignores this metadata; diagram topology is preserved.' })
      index = directive.endIndex
      continue
    }
    if (!continuation && trimmed.startsWith('%%')) continue
    csvRecord = continuation ? `${csvRecord}\n${lines[index]!}` : lines[index]!
    if (!csvQuotedFieldIsOpen(csvRecord)) csvRecord = ''
    // Mermaid trims whitespace from the end of the source.
    const raw = authoredLine?.(index + 1) ?? lines[index]!
    const row = index === last ? raw.trimEnd() : raw
    if (!continuation && /^\s+"/.test(row)) warnings.push({ code: 'UNSUPPORTED_SYNTAX', syntax: 'sankey_indented_quoted_row', line: index + 1, message: 'Pinned Mermaid rejects an indented Sankey row that opens with a quoted field. Ours reads it; canonical export writes that row unindented.' })
    if (row.includes('%%{')) warnings.push({ code: 'UNSUPPORTED_SYNTAX', syntax: 'sankey_directive_text', line: index + 1, message: 'A Sankey node name containing a directive opener is read as written. Pinned Mermaid rejects it, and CSV has no escape preserving the name; this source remains preserved without typed edits.' })
    const outside = /[^\x20-\x7E\r]/u.exec(row)?.[0]
    if (outside !== undefined) {
      const what = outside === '\t' ? 'a tab' : `${JSON.stringify(outside)} (U+${outside.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')})`
      warnings.push({
        code: 'UNSUPPORTED_SYNTAX', syntax: 'sankey_unsupported_character', line: index + 1,
        message: `Pinned Mermaid's Sankey reader takes only printable ASCII characters in a row, quoted or not, and rejects ${what} here. Ours reads the row as written; ${outside === '\t' ? 'use spaces instead' : 'Mermaid has no spelling for this character'}.`,
      })
    }
    // The prepass's own `;` strip is mermaid_cleanup's to report.
    const entity = /#\w+;/.exec(mermaidEntityPrepass(row))?.[0]
    if (entity !== undefined) warnings.push({
      code: 'UNSUPPORTED_SYNTAX', syntax: 'sankey_unsupported_character', line: index + 1,
      message: `Pinned Mermaid reads ${entity} as an entity code, which its Sankey reader then rejects as a character outside printable ASCII. Ours reads and draws ${entity} as written; Mermaid has no spelling for this text, so write the character itself if it is printable ASCII.`,
    })
  }
  return warnings
}
