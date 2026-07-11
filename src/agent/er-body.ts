// ============================================================================
// ER diagram structured body: parse, serialize, mutate, verify.
//
// Supported:
//   CUSTOMER ||--o{ ORDER : places
//   CUSTOMER ||..o{ ORDER : "places (dashed)"
//   CUSTOMER {
//     string name PK
//     string email
//     int    age "comment"
//   }
//
// Unmodeled (forces opaque):
//   - non-standard cardinality glyphs
//   - directives like `title`
// ============================================================================

import { unknownOpMessage } from './mutation-ops.ts'
import type {
  ErBody, ErEntity, ErRelation, ErCardinality, ErAttribute,
  ErMutationOp, MutationError, Result, LayoutWarning, VerifyOptions,
} from './types.ts'
import { ok, err, DEFAULT_LABEL_CHAR_CAP } from './types.ts'
import { labelOverflowWarning } from './label-metrics.ts'
import {
  erContainsSubgraphConstruct,
  parseErAttribute,
  parseErEntityId,
  parseErEntityReference,
  parseErRelationshipSyntax,
} from '../er/parser.ts'
import { toMermaidLines } from '../mermaid-source.ts'

/**
 * ER source-level UNSUPPORTED_SYNTAX warnings (repo #103): flowchart-style
 * `subgraph … direction … end` blocks are tolerated by the render parser —
 * the entities inside render, the grouping does not. Announce the dropped
 * construct by name (the flowchart sourceWarnings pattern); its presence also
 * suppresses the generic `er_opaque` double-flag in verify.
 */
export function erUnsupportedSyntaxWarnings(canonicalSource: string): LayoutWarning[] {
  if (!erContainsSubgraphConstruct(toMermaidLines(canonicalSource))) return []
  return [{
    code: 'UNSUPPORTED_SYNTAX',
    syntax: 'er_subgraph',
    message: 'This erDiagram uses flowchart-style subgraph blocks. The renderer tolerates them: entities and relationships inside render, but the subgraph grouping (and any direction scoped to it) is dropped. Typed mutation is unavailable while the blocks are present.',
  }]
}

// ---- Parser ---------------------------------------------------------------

const LEFT_CARD: Record<string, ErCardinality> = {
  '||': 'one-only', '|o': 'zero-or-one', 'o|': 'zero-or-one',
  '}o': 'zero-or-many', 'o{': 'zero-or-many',
  '}|': 'one-or-many', '|{': 'one-or-many',
}
const RIGHT_CARD: Record<string, ErCardinality> = {
  '||': 'one-only', '|o': 'zero-or-one', 'o|': 'zero-or-one',
  'o{': 'zero-or-many', '}o': 'zero-or-many',
  '|{': 'one-or-many', '}|': 'one-or-many',
}

export function parseErBody(lines: string[]): ErBody | null {
  const body: ErBody = { kind: 'er', entities: [], relations: [] }
  const entityMap = new Map<string, ErEntity>()
  const upsert = (id: string, label?: string): ErEntity => {
    let e = entityMap.get(id)
    if (!e) {
      e = { id, ...(label !== undefined ? { label } : {}), attributes: [] }
      entityMap.set(id, e)
      body.entities.push(e)
    } else if (label !== undefined) {
      e.label = label
    }
    return e
  }

  let i = 0
  while (i < lines.length) {
    const raw = lines[i]!.trim()
    i++
    if (!raw || raw.startsWith('%%')) continue

    // Flowchart-style subgraph vocabulary (repo #103): unmodeled — fall back
    // to opaque so the block round-trips verbatim. Checked before the bare-
    // entity rule so a closing `end` can never mint a phantom entity.
    if (/^subgraph\b/.test(raw) || raw === 'end') return null

    const relation = parseErRelationshipSyntax(raw)
    if (relation) {
      // ER class styling is renderer-tolerated but not represented by ErBody;
      // preserve the whole source opaquely rather than silently discarding it.
      if (relation.entity1.className || relation.entity2.className) return null
      const lc = LEFT_CARD[relation.leftToken]
      const rc = RIGHT_CARD[relation.rightToken]
      if (!lc || !rc) return null
      body.relations.push({
        from: relation.entity1.id,
        to: relation.entity2.id,
        leftCard: lc,
        rightCard: rc,
        dashed: !relation.identifying,
        label: relation.label || undefined,
      })
      upsert(relation.entity1.id, relation.entity1.label)
      upsert(relation.entity2.id, relation.entity2.label)
      continue
    }

    // Entity with attribute block. The reference may carry a display alias.
    if (raw.endsWith('{')) {
      const reference = parseErEntityReference(raw.slice(0, -1).trim())
      if (reference) {
        if (reference.className) return null
        const e = upsert(reference.id, reference.label)
        let closed = false
        while (i < lines.length) {
          const al = lines[i]!.trim()
          i++
          if (!al || al.startsWith('%%')) continue
          if (al === '}') { closed = true; break }
          if (!parseErAttribute(al)) return null
          e.attributes.push({ text: al })
        }
        if (!closed) return null
        continue
      }
    }

    // Bare or aliased entity declaration (no attributes).
    const bare = parseErEntityReference(raw)
    if (bare) {
      if (bare.className) return null
      upsert(bare.id, bare.label)
      continue
    }

    return null
  }

  return body
}

// ---- Serializer -----------------------------------------------------------

const LEFT_GLYPH: Record<ErCardinality, string> = {
  'one-only': '||', 'zero-or-one': '|o', 'zero-or-many': '}o', 'one-or-many': '}|',
}
const RIGHT_GLYPH: Record<ErCardinality, string> = {
  'one-only': '||', 'zero-or-one': 'o|', 'zero-or-many': 'o{', 'one-or-many': '|{',
}

function quoteErText(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function renderErEntityReference(entity: ErEntity): string {
  const renderedId = parseErEntityId(entity.id) ? entity.id : quoteErText(entity.id)
  if (entity.label === undefined || entity.label === entity.id || entity.label === normalizeErQuotedIdLabel(entity.id)) return renderedId
  return `${renderedId}[${quoteErText(entity.label)}]`
}

function normalizeErQuotedIdLabel(id: string): string {
  return id.replace(/<br\s*\/?>/gi, '\n')
}

export function renderEr(body: ErBody): string {
  const lines: string[] = ['erDiagram']
  for (const e of body.entities) {
    const reference = renderErEntityReference(e)
    if (e.attributes.length === 0) {
      lines.push(`  ${reference}`)
    } else {
      lines.push(`  ${reference} {`)
      for (const a of e.attributes) lines.push(`    ${a.text}`)
      lines.push(`  }`)
    }
  }
  for (const r of body.relations) {
    const left = LEFT_GLYPH[r.leftCard]
    const right = RIGHT_GLYPH[r.rightCard]
    const link = r.dashed ? '..' : '--'
    const label = r.label ? r.label : ''
    // An empty label serializes as `: ""` — the parser strips the quotes back
    // to undefined, and a bare trailing `:` would not re-parse (opaque fallback).
    lines.push(`  ${r.from} ${left}${link}${right} ${r.to} : ${label === '' || label.includes(' ') ? `"${label}"` : label}`)
  }
  return lines.join('\n') + '\n'
}

// ---- Mutator --------------------------------------------------------------

function cloneEr(body: ErBody): ErBody {
  return {
    kind: 'er',
    entities: body.entities.map(e => ({ id: e.id, ...(e.label !== undefined ? { label: e.label } : {}), attributes: e.attributes.map(a => ({ ...a })) })),
    relations: body.relations.map(r => ({ ...r })),
  }
}

function normalizeErEntityLabel(value: string | null | undefined, field: string): Result<string | undefined, MutationError> {
  if (value === null || value === undefined) return ok(undefined)
  if (typeof value !== 'string') return err({ code: 'INVALID_OP', message: `ER entity ${field} must be a string or null` })
  const normalized = value.trim().replace(/\s+/g, ' ')
  if (!normalized || /[\r\n\[\]]/.test(normalized)) {
    return err({ code: 'INVALID_OP', message: `ER entity ${field} must be non-empty and must not contain brackets or line breaks` })
  }
  return ok(normalized)
}

export function mutateEr(body: ErBody, op: ErMutationOp): Result<ErBody, MutationError> {
  const b = cloneEr(body)
  const find = (id: string) => b.entities.find(e => e.id === id)

  switch (op.kind) {
    case 'add_entity': {
      if (!parseErEntityReference(op.id) || op.id.includes(':::') || op.id.includes('[')) {
        return err({ code: 'INVALID_OP', message: `ER entity id "${op.id}" must be a bare identifier` })
      }
      if (find(op.id)) return err({ code: 'DUPLICATE_ENTITY', message: `entity ${op.id} already exists` })
      const attributes = op.attributes ?? []
      if (attributes.some(text => !parseErAttribute(text))) {
        return err({ code: 'INVALID_OP', message: 'ER attributes must use: type name [PK, FK, UK] ["comment"]' })
      }
      const label = normalizeErEntityLabel(op.label, 'label')
      if (!label.ok) return label
      b.entities.push({ id: op.id, ...(label.value !== undefined ? { label: label.value } : {}), attributes: attributes.map(text => ({ text })) })
      return ok(b)
    }
    case 'remove_entity': {
      const i = b.entities.findIndex(e => e.id === op.id)
      if (i < 0) return err({ code: 'ENTITY_NOT_FOUND', message: `entity ${op.id} not found` })
      b.entities.splice(i, 1)
      b.relations = b.relations.filter(r => r.from !== op.id && r.to !== op.id)
      return ok(b)
    }
    case 'rename_entity': {
      const e = find(op.from)
      if (!e) return err({ code: 'ENTITY_NOT_FOUND', message: `entity ${op.from} not found` })
      if (!parseErEntityReference(op.to) || op.to.includes(':::') || op.to.includes('[')) {
        return err({ code: 'INVALID_OP', message: `ER entity id "${op.to}" must be a bare identifier` })
      }
      if (find(op.to)) return err({ code: 'DUPLICATE_ENTITY', message: `entity ${op.to} already exists` })
      e.id = op.to
      for (const r of b.relations) {
        if (r.from === op.from) r.from = op.to
        if (r.to === op.from) r.to = op.to
      }
      return ok(b)
    }
    case 'set_entity_label': {
      const e = find(op.entity)
      if (!e) return err({ code: 'ENTITY_NOT_FOUND', message: `entity ${op.entity} not found` })
      const label = normalizeErEntityLabel(op.label, 'label')
      if (!label.ok) return label
      if (label.value === undefined) delete e.label
      else e.label = label.value
      return ok(b)
    }
    case 'add_attribute': {
      const e = find(op.entity)
      if (!e) return err({ code: 'ENTITY_NOT_FOUND', message: `entity ${op.entity} not found` })
      if (!parseErAttribute(op.text)) return err({ code: 'INVALID_OP', message: 'ER attribute must use: type name [PK, FK, UK] ["comment"]' })
      e.attributes.push({ text: op.text })
      return ok(b)
    }
    case 'remove_attribute': {
      const e = find(op.entity)
      if (!e) return err({ code: 'ENTITY_NOT_FOUND', message: `entity ${op.entity} not found` })
      if (op.index < 0 || op.index >= e.attributes.length) return err({ code: 'ATTRIBUTE_NOT_FOUND', message: `attribute index ${op.index} out of range` })
      e.attributes.splice(op.index, 1)
      return ok(b)
    }
    case 'add_relation': {
      if (!find(op.from)) return err({ code: 'ENTITY_NOT_FOUND', message: `entity ${op.from} not found` })
      if (!find(op.to)) return err({ code: 'ENTITY_NOT_FOUND', message: `entity ${op.to} not found` })
      b.relations.push({ from: op.from, to: op.to, leftCard: op.leftCard, rightCard: op.rightCard, dashed: op.dashed ?? false, label: op.label })
      return ok(b)
    }
    case 'remove_relation': {
      if (op.index < 0 || op.index >= b.relations.length) return err({ code: 'RELATION_NOT_FOUND', message: `relation index ${op.index} out of range` })
      b.relations.splice(op.index, 1)
      return ok(b)
    }
    default:
      return err({ code: 'INVALID_OP', message: unknownOpMessage('er', op) })
  }
}

// ---- Verifier -------------------------------------------------------------

export function verifyErBody(body: ErBody, opts: VerifyOptions): LayoutWarning[] {
  const warnings: LayoutWarning[] = []
  const cap = opts.labelCharCap ?? DEFAULT_LABEL_CHAR_CAP
  if (body.entities.length === 0 && body.relations.length === 0) {
    warnings.push({ code: 'EMPTY_DIAGRAM' })
    return warnings
  }
  const ids = new Set(body.entities.map(e => e.id))
  const overflow = (target: string, text: string) => {
    const w = labelOverflowWarning(target, text, cap)
    if (w) warnings.push(w)
  }
  for (const e of body.entities) {
    if (e.label) overflow(e.id, e.label)
    for (let i = 0; i < e.attributes.length; i++) {
      overflow(`${e.id}#a${i}`, e.attributes[i]!.text)
    }
  }
  for (let i = 0; i < body.relations.length; i++) {
    const r = body.relations[i]!
    if (!ids.has(r.from) || !ids.has(r.to)) {
      warnings.push({
        code: 'EDGE_MISANCHORED', edge: `rel#${i}:${r.from}->${r.to}`,
        from: ids.has(r.from) ? r.from : undefined, to: ids.has(r.to) ? r.to : undefined,
      })
    }
    if (r.label) overflow(`rel#${i}`, r.label)
  }
  return warnings
}
