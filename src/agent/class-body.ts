// ============================================================================
// Class diagram structured body: parse, serialize, mutate, verify.
//
// Structured-or-opaque: returns a typed body when every line maps cleanly
// into the model, else returns null so the caller falls back to an opaque
// body (lossless round-trip via canonicalSource).
//
// Supported:
//   class A
//   class A { +member ... }                      (multi-line braces)
//   class A["Display label"]
//   class A as "Display label"
//   A : +member                                  (separate-decl member)
//   A <|-- B  / *-- / o-- / --> / ..> / ..|> / -- / ..   (relations)
//   A "card" <|-- "card" B : label               (cardinalities + label)
//   note for A "text"
//   note "text"
//   title T
//
// Unmodeled (forces opaque):
//   - direction TB / namespaces / generic types / annotations like <<enum>>
//     embedded after `class X` (we DO accept them as `members` of X via the
//     `class X { <<interface>> }` form). The standalone `class X <<...>>`
//     form falls back to opaque.
//   - cssClass / link / callback / click handlers
//   - styled / classDef
// ============================================================================

import type {
  ClassBody, ClassNode, ClassRelation, ClassRelationKind, ClassNote,
  ClassMutationOp, MutationError, Result, LayoutWarning, VerifyOptions,
} from './types.ts'
import { ok, err, DEFAULT_LABEL_CHAR_CAP } from './types.ts'
import { labelOverflowWarning } from './label-metrics.ts'

// ---- Parser ---------------------------------------------------------------

const RELATION_TOKENS: Array<{ pat: RegExp; kind: ClassRelationKind }> = [
  // Order matters: more specific (4+ char) before shorter ones.
  { pat: /<\|--/, kind: 'inheritance' },
  { pat: /--\|>/, kind: 'inheritance' },
  { pat: /\.\.\|>/, kind: 'realization' },
  { pat: /\*--/, kind: 'composition' },
  { pat: /--\*/, kind: 'composition' },
  { pat: /o--/, kind: 'aggregation' },
  { pat: /--o/, kind: 'aggregation' },
  { pat: /-->/, kind: 'association' },
  { pat: /<--/, kind: 'association' },
  { pat: /\.\.>/, kind: 'dependency' },
  { pat: /<\.\./, kind: 'dependency' },
  { pat: /--/,    kind: 'link-solid' },
  { pat: /\.\./,  kind: 'link-dashed' },
]

// `class X`, `class X { ... }`, `class X["label"]`, `class X as "label"`
const CLASS_DECL_RE = /^class\s+(`[^`]+`|[\w$]+)(?:\s*\[\s*"([^"]*)"\s*\])?(?:\s+as\s+"([^"]+)")?\s*(\{)?\s*$/
const MEMBER_DECL_RE = /^(`[^`]+`|[\w$]+)\s*:\s*(.+)$/
const NOTE_RE = /^note(?:\s+for\s+(`[^`]+`|[\w$]+))?\s+"([^"]+)"\s*$/
const TITLE_RE = /^title\s+(.+)$/i

function stripBackticks(s: string): string {
  return s.startsWith('`') && s.endsWith('`') ? s.slice(1, -1) : s
}

function parseRelation(line: string): ClassRelation | null {
  for (const { pat, kind } of RELATION_TOKENS) {
    const m = line.match(new RegExp(`^(\\S+?)(?:\\s+"([^"]+)")?\\s*${pat.source}\\s*(?:"([^"]+)"\\s+)?(\\S+?)(?:\\s*:\\s*(.+))?$`))
    if (!m) continue
    const from = stripBackticks(m[1]!)
    const fromCardinality = m[2]
    const toCardinality = m[3]
    const to = stripBackticks(m[4]!)
    const label = m[5]?.trim()
    // Reject if from/to don't look like class names
    if (!/^[\w$]+$/.test(from) || !/^[\w$]+$/.test(to)) return null
    return { from, to, kind, label, fromCardinality, toCardinality }
  }
  return null
}

export function parseClassBody(lines: string[]): ClassBody | null {
  const body: ClassBody = { kind: 'class', classes: [], relations: [], notes: [] }
  const classMap = new Map<string, ClassNode>()
  const upsert = (id: string, label?: string): ClassNode => {
    let c = classMap.get(id)
    if (!c) { c = { id, label, members: [] }; classMap.set(id, c); body.classes.push(c) }
    else if (label !== undefined && !c.label) c.label = label
    return c
  }

  let i = 0
  while (i < lines.length) {
    const raw = lines[i]!.trim()
    i++
    if (!raw || raw.startsWith('%%')) continue

    // Title
    const tm = raw.match(TITLE_RE)
    if (tm) { body.title = tm[1]!.trim(); continue }

    // Class declaration (with or without open brace)
    const cm = raw.match(CLASS_DECL_RE)
    if (cm) {
      const id = stripBackticks(cm[1]!)
      const label = cm[2] ?? cm[3]
      const node = upsert(id, label)
      if (cm[4] === '{') {
        // Consume members until closing brace
        while (i < lines.length) {
          const ml = lines[i]!.trim()
          i++
          if (!ml || ml.startsWith('%%')) continue
          if (ml === '}') break
          node.members.push(ml)
        }
      }
      continue
    }

    // Note (with or without target)
    const nm = raw.match(NOTE_RE)
    if (nm) {
      body.notes.push({ text: nm[2]!, for: nm[1] ? stripBackticks(nm[1]) : undefined })
      continue
    }

    // Relation — try this before member because relations may have `:` too
    const rel = parseRelation(raw)
    if (rel) { body.relations.push(rel); upsert(rel.from); upsert(rel.to); continue }

    // Member declaration (X : member)
    const mm = raw.match(MEMBER_DECL_RE)
    if (mm) {
      const id = stripBackticks(mm[1]!)
      const text = mm[2]!.trim()
      upsert(id).members.push(text)
      continue
    }

    // Unmodeled line — bail to opaque.
    return null
  }
  return body
}

// ---- Serializer -----------------------------------------------------------

const ARROW_FOR: Record<ClassRelationKind, string> = {
  inheritance: '<|--',
  composition: '*--',
  aggregation: 'o--',
  association: '-->',
  dependency:  '..>',
  realization: '..|>',
  'link-solid': '--',
  'link-dashed': '..',
}

function quoteIfNeeded(id: string): string {
  return /^[\w$]+$/.test(id) ? id : `\`${id}\``
}

export function renderClass(body: ClassBody): string {
  const lines: string[] = ['classDiagram']
  if (body.title) lines.push(`  title ${body.title}`)
  for (const n of body.notes) {
    if (n.for) lines.push(`  note for ${quoteIfNeeded(n.for)} "${n.text}"`)
    else lines.push(`  note "${n.text}"`)
  }
  for (const c of body.classes) {
    const head = `class ${quoteIfNeeded(c.id)}${c.label ? `["${c.label}"]` : ''}`
    if (c.members.length === 0) {
      lines.push(`  ${head}`)
    } else {
      lines.push(`  ${head} {`)
      for (const m of c.members) lines.push(`    ${m}`)
      lines.push(`  }`)
    }
  }
  for (const r of body.relations) {
    const arrow = ARROW_FOR[r.kind]
    const left = r.fromCardinality ? `${quoteIfNeeded(r.from)} "${r.fromCardinality}"` : quoteIfNeeded(r.from)
    const right = r.toCardinality ? `"${r.toCardinality}" ${quoteIfNeeded(r.to)}` : quoteIfNeeded(r.to)
    const label = r.label ? ` : ${r.label}` : ''
    lines.push(`  ${left} ${arrow} ${right}${label}`)
  }
  return lines.join('\n') + '\n'
}

// ---- Mutator --------------------------------------------------------------

function cloneClass(body: ClassBody): ClassBody {
  return {
    kind: 'class',
    title: body.title,
    classes: body.classes.map(c => ({ id: c.id, label: c.label, members: [...c.members] })),
    relations: body.relations.map(r => ({ ...r })),
    notes: body.notes.map(n => ({ ...n })),
  }
}

export function mutateClass(body: ClassBody, op: ClassMutationOp): Result<ClassBody, MutationError> {
  const b = cloneClass(body)
  const findClass = (id: string) => b.classes.find(c => c.id === id)

  switch (op.kind) {
    case 'set_title': {
      b.title = op.title ?? undefined
      return ok(b)
    }
    case 'add_class': {
      if (findClass(op.id)) return err({ code: 'DUPLICATE_CLASS', message: `class ${op.id} already exists` })
      b.classes.push({ id: op.id, label: op.label, members: op.members ?? [] })
      return ok(b)
    }
    case 'remove_class': {
      const i = b.classes.findIndex(c => c.id === op.id)
      if (i < 0) return err({ code: 'CLASS_NOT_FOUND', message: `class ${op.id} not found` })
      b.classes.splice(i, 1)
      b.relations = b.relations.filter(r => r.from !== op.id && r.to !== op.id)
      b.notes = b.notes.filter(n => n.for !== op.id)
      return ok(b)
    }
    case 'rename_class': {
      const c = findClass(op.from)
      if (!c) return err({ code: 'CLASS_NOT_FOUND', message: `class ${op.from} not found` })
      if (findClass(op.to)) return err({ code: 'DUPLICATE_CLASS', message: `class ${op.to} already exists` })
      c.id = op.to
      for (const r of b.relations) {
        if (r.from === op.from) r.from = op.to
        if (r.to === op.from) r.to = op.to
      }
      for (const n of b.notes) if (n.for === op.from) n.for = op.to
      return ok(b)
    }
    case 'add_member': {
      const c = findClass(op.class)
      if (!c) return err({ code: 'CLASS_NOT_FOUND', message: `class ${op.class} not found` })
      c.members.push(op.text)
      return ok(b)
    }
    case 'remove_member': {
      const c = findClass(op.class)
      if (!c) return err({ code: 'CLASS_NOT_FOUND', message: `class ${op.class} not found` })
      if (op.index < 0 || op.index >= c.members.length) return err({ code: 'MEMBER_NOT_FOUND', message: `member index ${op.index} out of range` })
      c.members.splice(op.index, 1)
      return ok(b)
    }
    case 'add_relation': {
      if (!findClass(op.from)) return err({ code: 'CLASS_NOT_FOUND', message: `class ${op.from} not found` })
      if (!findClass(op.to)) return err({ code: 'CLASS_NOT_FOUND', message: `class ${op.to} not found` })
      b.relations.push({ from: op.from, to: op.to, kind: op.relKind, label: op.label })
      return ok(b)
    }
    case 'remove_relation': {
      if (op.index < 0 || op.index >= b.relations.length) return err({ code: 'RELATION_NOT_FOUND', message: `relation index ${op.index} out of range` })
      b.relations.splice(op.index, 1)
      return ok(b)
    }
    case 'add_note': {
      if (op.for && !findClass(op.for)) return err({ code: 'CLASS_NOT_FOUND', message: `class ${op.for} not found` })
      b.notes.push({ text: op.text, for: op.for })
      return ok(b)
    }
    case 'remove_note': {
      if (op.index < 0 || op.index >= b.notes.length) return err({ code: 'NOTE_NOT_FOUND', message: `note index ${op.index} out of range` })
      b.notes.splice(op.index, 1)
      return ok(b)
    }
    default:
      return err({ code: 'INVALID_OP', message: `unknown class op: ${(op as { kind: string }).kind}` })
  }
}

// ---- Verifier -------------------------------------------------------------

export function verifyClass(body: ClassBody, opts: VerifyOptions): LayoutWarning[] {
  const warnings: LayoutWarning[] = []
  const cap = opts.labelCharCap ?? DEFAULT_LABEL_CHAR_CAP

  if (body.classes.length === 0 && body.title === undefined) {
    warnings.push({ code: 'EMPTY_DIAGRAM' })
    return warnings
  }

  const overflow = (target: string, text: string) => {
    const w = labelOverflowWarning(target, text, cap)
    if (w) warnings.push(w)
  }
  if (body.title) overflow('title', body.title)

  const ids = new Set(body.classes.map(c => c.id))
  for (const c of body.classes) {
    if (c.label) overflow(c.id, c.label)
    for (let i = 0; i < c.members.length; i++) {
      overflow(`${c.id}#m${i}`, c.members[i]!)
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
  for (let i = 0; i < body.notes.length; i++) {
    const n = body.notes[i]!
    overflow(`note#${i}`, n.text)
    if (n.for && !ids.has(n.for)) {
      warnings.push({ code: 'EDGE_MISANCHORED', edge: `note#${i}->${n.for}`, from: undefined, to: undefined })
    }
  }

  return warnings
}
