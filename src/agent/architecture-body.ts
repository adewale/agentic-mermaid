// ============================================================================
// Architecture structured body (BUILD-17: promotes architecture-beta from
// opaque-only fallback semantics to structured mutation, following the BUILD-15
// journey pilot).
//
// Modeled grammar (mirrors the legacy renderer parser, src/architecture/parser.ts):
//   group <id>(<icon>)[<Label>] [in <parentGroup>]
//   service <id>(<icon>)[<Label>] [in <group>]
//   junction <id> [in <group>]
//   <id>[{group}]:<SIDE> <arrow> <SIDE>:<id>[{group}]   (SIDE ∈ L|R|T|B)
//     arrows: -- --> <-- <-->  and labeled  -[label]-  forms
//   align row|column <id> <id> ...   (upstream v11.16.0 — shared shape parser
//     in src/architecture/align.ts; preserved losslessly, layout does not
//     honor the constraint, verify lints UNSUPPORTED_SYNTAX architecture_align)
//
// Structured-or-opaque: any other non-blank, non-comment line (accTitle,
// accDescr, the {group} boundary modifier, unmodeled syntax) returns null so
// the caller falls back to a lossless opaque body. Render support is unchanged
// — the legacy renderer keeps parsing the canonical source this module emits.
// ============================================================================

import { unknownOpMessage } from './mutation-ops.ts'
import { ALIGN_DIRECTIVE_RE, parseAlignDirective, serializeAlignDirective } from '../architecture/align.ts'
import type {
  ArchitectureBody, ArchitectureGroup, ArchitectureService, ArchitectureJunction,
  ArchitectureEdge, ArchitectureAlignment, ArchitectureSide, ArchitectureMutationOp,
  MutationError, Result, LayoutWarning, VerifyOptions,
} from './types.ts'
import { ok, err, DEFAULT_LABEL_CHAR_CAP } from './types.ts'
import { labelOverflowWarning } from './label-metrics.ts'

// ---- Parser -----------------------------------------------------------------

const IDENT = '[\\w-]+'
const ICON = '\\(([^)]+)\\)'
const LABEL = '\\[(.+)\\]'

const GROUP_RE = new RegExp(`^group\\s+(${IDENT})(?:${ICON})?(?:${LABEL})?(?:\\s+in\\s+(${IDENT}))?\\s*$`)
const SERVICE_RE = new RegExp(`^service\\s+(${IDENT})(?:${ICON})?(?:${LABEL})?(?:\\s+in\\s+(${IDENT}))?\\s*$`)
const JUNCTION_RE = new RegExp(`^junction\\s+(${IDENT})(?:\\s+in\\s+(${IDENT}))?\\s*$`)
// Endpoints: id:SIDE on the source, SIDE:id on the target. We deliberately do
// NOT model the {group} boundary modifier (id{group}:R) — those lines fall
// back to opaque, preserving the renderer's group-boundary feature losslessly.
const SOURCE_RE = new RegExp(`^(${IDENT}):(L|R|T|B)$`)
const TARGET_RE = new RegExp(`^(L|R|T|B):(${IDENT})$`)

const SIDES = new Set<ArchitectureSide>(['L', 'R', 'T', 'B'])

function normalizeText(value: string): string {
  return value.split(/\r?\n/).map(part => part.trim()).filter(Boolean).join(' ')
}

interface ParsedEndpoint { id: string; side: ArchitectureSide }

/** Parse an edge operator, returning the modeled arrow forms or null. */
function parseArrow(token: string): { label?: string; hasArrowStart: boolean; hasArrowEnd: boolean } | null {
  const t = token.trim()
  if (t === '<-->') return { hasArrowStart: true, hasArrowEnd: true }
  if (t === '-->') return { hasArrowStart: false, hasArrowEnd: true }
  if (t === '<--') return { hasArrowStart: true, hasArrowEnd: false }
  if (t === '--') return { hasArrowStart: false, hasArrowEnd: false }
  const m = t.match(/^(<)?-\[(.*)\]-(>)?$/)
  if (!m) return null
  const label = normalizeText(m[2] ?? '') || undefined
  // A label that contains the bracket delimiter would not round-trip; reject.
  if (label && (label.includes('[') || label.includes(']'))) return null
  return { label, hasArrowStart: Boolean(m[1]), hasArrowEnd: Boolean(m[3]) }
}

function parseEdge(line: string): ArchitectureEdge | null {
  const m = line.match(/^(\S+)\s+(.+)\s+(\S+)$/)
  if (!m) return null
  const src = m[1]!.match(SOURCE_RE)
  const tgt = m[3]!.match(TARGET_RE)
  if (!src || !tgt) return null
  const arrow = parseArrow(m[2]!)
  if (!arrow) return null
  return {
    source: { id: src[1]!, side: src[2] as ArchitectureSide },
    target: { id: tgt[2]!, side: tgt[1] as ArchitectureSide },
    label: arrow.label,
    hasArrowStart: arrow.hasArrowStart,
    hasArrowEnd: arrow.hasArrowEnd,
  }
}

/**
 * Parse architecture body lines (header excluded). Returns a structured body
 * only if EVERY non-blank, non-comment line is a modeled group, service,
 * junction, or edge, AND the diagram is internally consistent (no duplicate
 * ids, every `in` parent and every edge endpoint resolves). Otherwise returns
 * null (opaque fallback).
 */
export function parseArchitectureBody(lines: string[]): ArchitectureBody | null {
  const groups: ArchitectureGroup[] = []
  const services: ArchitectureService[] = []
  const junctions: ArchitectureJunction[] = []
  const edges: ArchitectureEdge[] = []
  const alignments: ArchitectureAlignment[] = []
  const ids = new Set<string>()
  const groupIds = new Set<string>()
  const endpointIds = new Set<string>() // services + junctions (valid edge endpoints)
  const pendingParents: Array<{ parent: string }> = []

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('%%')) continue

    const gm = line.match(GROUP_RE)
    if (gm) {
      const id = gm[1]!
      if (ids.has(id)) return null
      ids.add(id)
      groupIds.add(id)
      const icon = gm[2]?.trim() || undefined
      const label = normalizeText(gm[3] ?? id)
      const parentId = gm[4] ?? undefined
      if (parentId) pendingParents.push({ parent: parentId })
      groups.push({ id, label, icon, parentId })
      continue
    }

    const sm = line.match(SERVICE_RE)
    if (sm) {
      const id = sm[1]!
      if (ids.has(id)) return null
      ids.add(id)
      endpointIds.add(id)
      const icon = sm[2]?.trim() || undefined
      const label = normalizeText(sm[3] ?? id)
      const parentId = sm[4] ?? undefined
      if (parentId) pendingParents.push({ parent: parentId })
      services.push({ id, label, icon, parentId })
      continue
    }

    const jm = line.match(JUNCTION_RE)
    if (jm) {
      const id = jm[1]!
      if (ids.has(id)) return null
      ids.add(id)
      endpointIds.add(id)
      const parentId = jm[2] ?? undefined
      if (parentId) pendingParents.push({ parent: parentId })
      junctions.push({ id, parentId })
      continue
    }

    // `align` is reserved upstream, so a leading `align` token is always a
    // directive. Malformed directives (bad axis, <2 members, duplicates) fall
    // back to opaque — the legacy render parser rejects them, exactly like
    // upstream, and verify reports the render failure honestly.
    if (ALIGN_DIRECTIVE_RE.test(line)) {
      const parsed = parseAlignDirective(line)
      if (!parsed.ok) return null
      // Renderer semantics are declaration-order-sensitive: align can only
      // reference endpoints already declared at this source position.
      if (parsed.alignment.members.some(member => !endpointIds.has(member))) return null
      alignments.push(parsed.alignment)
      continue
    }

    const edge = parseEdge(line)
    if (edge) {
      edges.push(edge)
      continue
    }

    // Unmodeled line (accTitle/accDescr/{group} boundary/anything else) → opaque.
    return null
  }

  // Validation: every `in` parent must be a declared group; every edge endpoint
  // and align member must be a declared service or junction. The legacy parser
  // rejects diagrams that violate these, so a structured body must satisfy
  // them to round-trip.
  for (const { parent } of pendingParents) {
    if (!groupIds.has(parent)) return null
  }
  for (const edge of edges) {
    if (!endpointIds.has(edge.source.id) || !endpointIds.has(edge.target.id)) return null
  }
  for (const alignment of alignments) {
    for (const member of alignment.members) {
      if (!endpointIds.has(member)) return null
    }
  }

  // The legacy renderer rejects an empty architecture diagram; model the same
  // floor so a structured body always renders.
  if (groups.length === 0 && services.length === 0 && junctions.length === 0) return null

  return { kind: 'architecture', groups, services, junctions, edges, alignments }
}

// ---- Serializer -------------------------------------------------------------

function renderNode(keyword: 'group' | 'service', id: string, label: string, icon?: string, parentId?: string): string {
  const iconPart = icon ? `(${icon})` : ''
  const labelPart = `[${label}]`
  const inPart = parentId ? ` in ${parentId}` : ''
  return `  ${keyword} ${id}${iconPart}${labelPart}${inPart}`
}

function renderArrow(edge: ArchitectureEdge): string {
  if (edge.label !== undefined) {
    return `${edge.hasArrowStart ? '<' : ''}-[${edge.label}]-${edge.hasArrowEnd ? '>' : ''}`
  }
  if (edge.hasArrowStart && edge.hasArrowEnd) return '<-->'
  if (edge.hasArrowEnd) return '-->'
  if (edge.hasArrowStart) return '<--'
  return '--'
}

export function renderArchitecture(body: ArchitectureBody): string {
  const lines: string[] = ['architecture-beta']
  for (const g of body.groups) lines.push(renderNode('group', g.id, g.label, g.icon, g.parentId))
  for (const s of body.services) lines.push(renderNode('service', s.id, s.label, s.icon, s.parentId))
  for (const j of body.junctions) {
    lines.push(`  junction ${j.id}${j.parentId ? ` in ${j.parentId}` : ''}`)
  }
  for (const e of body.edges) {
    lines.push(`  ${e.source.id}:${e.source.side} ${renderArrow(e)} ${e.target.side}:${e.target.id}`)
  }
  // Align directives last: canonical order guarantees every member is already
  // declared, which both the upstream grammar and the legacy parser require.
  for (const a of body.alignments ?? []) {
    lines.push(`  ${serializeAlignDirective(a)}`)
  }
  return lines.join('\n') + '\n'
}

// ---- Mutator ----------------------------------------------------------------

function cloneArchitecture(b: ArchitectureBody): ArchitectureBody {
  return {
    kind: 'architecture',
    groups: b.groups.map(g => ({ ...g })),
    services: b.services.map(s => ({ ...s })),
    junctions: b.junctions.map(j => ({ ...j })),
    edges: b.edges.map(e => ({
      source: { ...e.source }, target: { ...e.target },
      label: e.label, hasArrowStart: e.hasArrowStart, hasArrowEnd: e.hasArrowEnd,
    })),
    ...(b.alignments ? { alignments: b.alignments.map(a => ({ axis: a.axis, members: [...a.members] })) } : {}),
  }
}

/**
 * Keep align directives coherent after id changes: drop removed members and
 * dissolve any directive left with fewer than two (the grammar's floor —
 * mirrors the edge cascade in remove_service). `rename` rewrites in place.
 */
function dropAlignmentMember(next: ArchitectureBody, id: string): void {
  if (!next.alignments) return
  next.alignments = next.alignments
    .map(a => ({ axis: a.axis, members: a.members.filter(m => m !== id) }))
    .filter(a => a.members.length >= 2)
}

function renameAlignmentMember(next: ArchitectureBody, from: string, to: string): void {
  if (!next.alignments) return
  for (const a of next.alignments) {
    a.members = a.members.map(m => (m === from ? to : m))
  }
}

function allIds(b: ArchitectureBody): Set<string> {
  const s = new Set<string>()
  for (const g of b.groups) s.add(g.id)
  for (const sv of b.services) s.add(sv.id)
  for (const j of b.junctions) s.add(j.id)
  return s
}

const ID_RE = /^[\w-]+$/

function validId(value: unknown, field: string): Result<string, MutationError> {
  if (typeof value !== 'string' || !ID_RE.test(value)) {
    return err({ code: 'INVALID_OP', message: `Architecture ${field} must match [A-Za-z0-9_-]+, got ${JSON.stringify(value)}` })
  }
  return ok(value)
}

function normalizeLabel(value: string, field: string): Result<string, MutationError> {
  if (typeof value !== 'string') return err({ code: 'INVALID_OP', message: `Architecture ${field} must be a string` })
  const normalized = normalizeText(value)
  // Labels are rendered inside [...]; a bracket would break round-trip.
  if (!normalized || normalized.includes('[') || normalized.includes(']')) {
    return err({ code: 'INVALID_OP', message: `Architecture ${field} must be non-empty and must not contain [ or ]` })
  }
  return ok(normalized)
}

function validSide(value: unknown): value is ArchitectureSide {
  return typeof value === 'string' && SIDES.has(value as ArchitectureSide)
}

/** Edge id convention: `<from>-><to>` (matches the flowchart edgeId idiom). */
export function architectureEdgeId(e: ArchitectureEdge): string {
  return `${e.source.id}->${e.target.id}`
}

export function mutateArchitecture(body: ArchitectureBody, op: ArchitectureMutationOp): Result<ArchitectureBody, MutationError> {
  const next = cloneArchitecture(body)

  switch (op.kind) {
    case 'add_service': {
      const id = validId(op.id, 'service id')
      if (!id.ok) return id
      if (allIds(next).has(id.value)) return err({ code: 'INVALID_OP', message: `Identifier "${id.value}" already exists` })
      const label = normalizeLabel(op.label ?? id.value, 'service label')
      if (!label.ok) return label
      let icon: string | undefined
      if (op.icon !== undefined && op.icon !== null) {
        if (typeof op.icon !== 'string' || op.icon.includes('(') || op.icon.includes(')')) {
          return err({ code: 'INVALID_OP', message: 'Architecture service icon must be a string without parentheses' })
        }
        icon = op.icon.trim() || undefined
      }
      if (op.group !== undefined && op.group !== null) {
        const g = validId(op.group, 'group id')
        if (!g.ok) return g
        if (!next.groups.some(grp => grp.id === g.value)) return err({ code: 'GROUP_NOT_FOUND', message: `No group "${g.value}"` })
        next.services.push({ id: id.value, label: label.value, icon, parentId: g.value })
      } else {
        next.services.push({ id: id.value, label: label.value, icon })
      }
      break
    }
    case 'remove_service': {
      const idx = next.services.findIndex(s => s.id === op.id)
      if (idx < 0) return err({ code: 'SERVICE_NOT_FOUND', message: `No service "${op.id}"` })
      next.services.splice(idx, 1)
      // Cascade: drop every edge that touches the removed service, and every
      // align membership (dissolving directives that fall below two members).
      next.edges = next.edges.filter(e => e.source.id !== op.id && e.target.id !== op.id)
      dropAlignmentMember(next, op.id)
      break
    }
    case 'rename_service': {
      const from = validId(op.from, 'service id')
      if (!from.ok) return from
      const to = validId(op.to, 'service id')
      if (!to.ok) return to
      const svc = next.services.find(s => s.id === from.value)
      if (!svc) return err({ code: 'SERVICE_NOT_FOUND', message: `No service "${from.value}"` })
      if (from.value !== to.value && allIds(next).has(to.value)) {
        return err({ code: 'INVALID_OP', message: `Identifier "${to.value}" already exists` })
      }
      svc.id = to.value
      // Keep edges and align memberships anchored to the renamed service.
      for (const e of next.edges) {
        if (e.source.id === from.value) e.source.id = to.value
        if (e.target.id === from.value) e.target.id = to.value
      }
      renameAlignmentMember(next, from.value, to.value)
      break
    }
    case 'set_service_label': {
      const svc = next.services.find(s => s.id === op.id)
      if (!svc) return err({ code: 'SERVICE_NOT_FOUND', message: `No service "${op.id}"` })
      const label = normalizeLabel(op.label, 'service label')
      if (!label.ok) return label
      svc.label = label.value
      break
    }
    case 'set_service_icon': {
      const svc = next.services.find(s => s.id === op.id)
      if (!svc) return err({ code: 'SERVICE_NOT_FOUND', message: `No service "${op.id}"` })
      if (op.icon === null) { delete svc.icon; break }
      if (typeof op.icon !== 'string' || op.icon.includes('(') || op.icon.includes(')')) {
        return err({ code: 'INVALID_OP', message: 'Architecture service icon must be a string without parentheses' })
      }
      const icon = op.icon.trim()
      if (!icon) return err({ code: 'INVALID_OP', message: 'Architecture service icon must be non-empty (use null to clear)' })
      svc.icon = icon
      break
    }
    case 'move_service': {
      const svc = next.services.find(s => s.id === op.id)
      if (!svc) return err({ code: 'SERVICE_NOT_FOUND', message: `No service "${op.id}"` })
      if (op.group === null) { delete svc.parentId; break }
      const g = validId(op.group, 'group id')
      if (!g.ok) return g
      if (!next.groups.some(grp => grp.id === g.value)) return err({ code: 'GROUP_NOT_FOUND', message: `No group "${g.value}"` })
      svc.parentId = g.value
      break
    }
    case 'add_group': {
      const id = validId(op.id, 'group id')
      if (!id.ok) return id
      if (allIds(next).has(id.value)) return err({ code: 'INVALID_OP', message: `Identifier "${id.value}" already exists` })
      const label = normalizeLabel(op.label ?? id.value, 'group label')
      if (!label.ok) return label
      let icon: string | undefined
      if (op.icon !== undefined && op.icon !== null) {
        if (typeof op.icon !== 'string' || op.icon.includes('(') || op.icon.includes(')')) {
          return err({ code: 'INVALID_OP', message: 'Architecture group icon must be a string without parentheses' })
        }
        icon = op.icon.trim() || undefined
      }
      let parentId: string | undefined
      if (op.parent !== undefined && op.parent !== null) {
        const p = validId(op.parent, 'group id')
        if (!p.ok) return p
        if (!next.groups.some(grp => grp.id === p.value)) return err({ code: 'GROUP_NOT_FOUND', message: `No group "${p.value}"` })
        parentId = p.value
      }
      next.groups.push({ id: id.value, label: label.value, icon, parentId })
      break
    }
    case 'remove_group': {
      const idx = next.groups.findIndex(g => g.id === op.id)
      if (idx < 0) return err({ code: 'GROUP_NOT_FOUND', message: `No group "${op.id}"` })
      // Policy: refuse to remove a non-empty group. Removing a group that still
      // owns services, junctions, or child groups would orphan members (the
      // legacy parser requires every `in <group>` to resolve), so we make the
      // caller move/remove members first rather than silently re-parenting or
      // cascade-deleting an entire subtree. Tested in agent-architecture.test.ts.
      const hasMembers =
        next.services.some(s => s.parentId === op.id) ||
        next.junctions.some(j => j.parentId === op.id) ||
        next.groups.some(g => g.parentId === op.id)
      if (hasMembers) return err({ code: 'INVALID_OP', message: `Group "${op.id}" is not empty; move or remove its members first` })
      next.groups.splice(idx, 1)
      break
    }
    case 'add_edge': {
      const from = validId(op.from, 'service id')
      if (!from.ok) return from
      const to = validId(op.to, 'service id')
      if (!to.ok) return to
      const endpoints = new Set([...next.services.map(s => s.id), ...next.junctions.map(j => j.id)])
      if (!endpoints.has(from.value)) return err({ code: 'SERVICE_NOT_FOUND', message: `No service/junction "${from.value}"` })
      if (!endpoints.has(to.value)) return err({ code: 'SERVICE_NOT_FOUND', message: `No service/junction "${to.value}"` })
      if (!validSide(op.fromSide)) return err({ code: 'INVALID_OP', message: `fromSide must be one of L|R|T|B, got ${JSON.stringify(op.fromSide)}` })
      if (!validSide(op.toSide)) return err({ code: 'INVALID_OP', message: `toSide must be one of L|R|T|B, got ${JSON.stringify(op.toSide)}` })
      let label: string | undefined
      if (op.label !== undefined && op.label !== null) {
        const l = normalizeLabel(op.label, 'edge label')
        if (!l.ok) return l
        label = l.value
      }
      next.edges.push({
        source: { id: from.value, side: op.fromSide },
        target: { id: to.value, side: op.toSide },
        label,
        hasArrowStart: op.hasArrowStart ?? false,
        hasArrowEnd: op.hasArrowEnd ?? true,
      })
      break
    }
    case 'remove_edge': {
      if (typeof op.index === 'number') {
        if (!next.edges[op.index]) return err({ code: 'EDGE_NOT_FOUND', message: `No edge at index ${op.index}` })
        next.edges.splice(op.index, 1)
      } else if (typeof op.id === 'string') {
        const idx = next.edges.findIndex(e => architectureEdgeId(e) === op.id)
        if (idx < 0) return err({ code: 'EDGE_NOT_FOUND', message: `No edge "${op.id}"` })
        next.edges.splice(idx, 1)
      } else {
        return err({ code: 'INVALID_OP', message: 'remove_edge requires index (number) or id (from->to)' })
      }
      break
    }
    default: {
      const _x: never = op
      return err({ code: 'INVALID_OP', message: unknownOpMessage('architecture', _x) })
    }
  }

  // Preserve the structured floor: an architecture diagram must keep at least
  // one node so it always renders.
  if (next.groups.length === 0 && next.services.length === 0 && next.junctions.length === 0) {
    return err({ code: 'INVALID_OP', message: 'Architecture diagram must keep at least one group, service, or junction' })
  }

  return ok(next)
}

// ---- Verifier (FamilyPlugin.verify hook) ------------------------------------

export function verifyArchitecture(body: ArchitectureBody, opts: VerifyOptions): LayoutWarning[] {
  const cap = opts.labelCharCap ?? DEFAULT_LABEL_CHAR_CAP
  const warnings: LayoutWarning[] = []
  const overflow = (target: string, text: string) => {
    const w = labelOverflowWarning(target, text, cap)
    if (w) warnings.push(w)
  }
  if (body.groups.length === 0 && body.services.length === 0 && body.junctions.length === 0) {
    warnings.push({ code: 'EMPTY_DIAGRAM' })
  }
  for (const g of body.groups) overflow(g.id, g.label)
  for (const s of body.services) overflow(s.id, s.label)
  body.edges.forEach((e, i) => {
    // Anchor any edge whose endpoints no longer resolve (defensive; mutate keeps
    // these consistent, but an externally-synthesized body might not).
    const ids = new Set([...body.services.map(s => s.id), ...body.junctions.map(j => j.id)])
    if (!ids.has(e.source.id) || !ids.has(e.target.id)) {
      warnings.push({
        code: 'EDGE_MISANCHORED', edge: `edge#${i}:${architectureEdgeId(e)}`,
        from: ids.has(e.source.id) ? e.source.id : undefined,
        to: ids.has(e.target.id) ? e.target.id : undefined,
      })
    }
    if (e.label !== undefined) overflow(`edge#${i}:${architectureEdgeId(e)}`, e.label)
  })
  // P4 (documented limitation ⇒ runtime diagnostic): align directives are
  // parsed and preserved losslessly, but the deterministic layout does not
  // honor them as placement constraints. One lint names the construct; it
  // never flips verify.ok (Tier 3).
  if ((body.alignments ?? []).length > 0) {
    warnings.push({
      code: 'UNSUPPORTED_SYNTAX',
      syntax: 'architecture_align',
      message: 'align row/column directives are parsed and preserved in source, but the deterministic layout does not honor them as placement constraints; the layered placement never stacks siblings on one coordinate, so rendering proceeds without the alignment.',
    })
  }
  return warnings
}
