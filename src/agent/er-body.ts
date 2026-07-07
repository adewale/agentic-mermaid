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

const REL_RE = /^([A-Za-z_][\w-]*)\s+([|o}{][|o}{])\s*(--|\.\.)\s*([|o}{][|o}{])\s+([A-Za-z_][\w-]*)\s*:\s*(.+)$/
const ENTITY_OPEN_RE = /^([A-Za-z_][\w-]*)\s*\{$/
const ENTITY_BARE_RE = /^([A-Za-z_][\w-]*)$/

export function parseErBody(lines: string[]): ErBody | null {
  const body: ErBody = { kind: 'er', entities: [], relations: [] }
  const entityMap = new Map<string, ErEntity>()
  const upsert = (id: string): ErEntity => {
    let e = entityMap.get(id)
    if (!e) { e = { id, attributes: [] }; entityMap.set(id, e); body.entities.push(e) }
    return e
  }

  let i = 0
  while (i < lines.length) {
    const raw = lines[i]!.trim()
    i++
    if (!raw || raw.startsWith('%%')) continue

    const rm = raw.match(REL_RE)
    if (rm) {
      const [, from, leftTok, lineTok, rightTok, to, rawLabel] = rm
      const lc = LEFT_CARD[leftTok!]
      const rc = RIGHT_CARD[rightTok!]
      if (!lc || !rc) return null
      let label: string = rawLabel!.trim()
      if (label.startsWith('"') && label.endsWith('"')) label = label.slice(1, -1)
      body.relations.push({ from: from!, to: to!, leftCard: lc, rightCard: rc, dashed: lineTok === '..', label: label || undefined })
      upsert(from!); upsert(to!)
      continue
    }

    // Bare entity declaration: `CUSTOMER` (no attributes)
    const bm = raw.match(ENTITY_BARE_RE)
    if (bm) { upsert(bm[1]!); continue }

    // Entity with attribute block
    const om = raw.match(ENTITY_OPEN_RE)
    if (om) {
      const e = upsert(om[1]!)
      while (i < lines.length) {
        const al = lines[i]!.trim()
        i++
        if (!al || al.startsWith('%%')) continue
        if (al === '}') break
        e.attributes.push({ text: al })
      }
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

export function renderEr(body: ErBody): string {
  const lines: string[] = ['erDiagram']
  for (const e of body.entities) {
    if (e.attributes.length === 0) {
      lines.push(`  ${e.id}`)
    } else {
      lines.push(`  ${e.id} {`)
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
    entities: body.entities.map(e => ({ id: e.id, attributes: e.attributes.map(a => ({ ...a })) })),
    relations: body.relations.map(r => ({ ...r })),
  }
}

export function mutateEr(body: ErBody, op: ErMutationOp): Result<ErBody, MutationError> {
  const b = cloneEr(body)
  const find = (id: string) => b.entities.find(e => e.id === id)

  switch (op.kind) {
    case 'add_entity': {
      if (find(op.id)) return err({ code: 'DUPLICATE_ENTITY', message: `entity ${op.id} already exists` })
      b.entities.push({ id: op.id, attributes: (op.attributes ?? []).map(text => ({ text })) })
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
      if (find(op.to)) return err({ code: 'DUPLICATE_ENTITY', message: `entity ${op.to} already exists` })
      e.id = op.to
      for (const r of b.relations) {
        if (r.from === op.from) r.from = op.to
        if (r.to === op.from) r.to = op.to
      }
      return ok(b)
    }
    case 'add_attribute': {
      const e = find(op.entity)
      if (!e) return err({ code: 'ENTITY_NOT_FOUND', message: `entity ${op.entity} not found` })
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
