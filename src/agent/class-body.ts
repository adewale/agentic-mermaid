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
//   namespace X { class A ... }                  (repo #118: nesting, dot
//   namespace A.B.C { ... }                       paths, and ["Label"] via
//   namespace X["Label"] { ... }                  the render parser's own
//                                                 namespace grammar)
//
// Unmodeled (forces opaque):
//   - direction TB (wired at layout, unmodeled here) / annotations like
//     <<enum>> embedded after `class X` (we DO accept them
//     as `members` of X via the `class X { <<interface>> }` form). The
//     standalone `class X <<...>>` form falls back to opaque.
//   - cssClass / link / callback / click handlers
//   - styled / classDef
// ============================================================================

import { unknownOpMessage } from './mutation-ops.ts'
import type {
  ClassBody, ClassNode, ClassRelation, ClassRelationKind, ClassNote, ClassNamespaceDecl,
  ClassMutationOp, MutationError, Result, LayoutWarning, VerifyOptions,
} from './types.ts'
import { ok, err, DEFAULT_LABEL_CHAR_CAP } from './types.ts'
import { labelOverflowWarning } from './label-metrics.ts'
import { expandInlineNamespaceStatement, parseClassDeclaration, parseClassReference, parseNamespaceHeader } from '../class/parser.ts'
import { parseMutableStyleProps, parseStyleProps, serializeStyleProps } from '../shared/style-props.ts'

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

const MEMBER_DECL_RE = /^(\S+)\s*:\s*(.+)$/
const NOTE_RE = /^note(?:\s+for\s+(\S+))?\s+"([^"]+)"\s*$/
const TITLE_RE = /^title\s+(.+)$/i

function parseRelation(line: string): (ClassRelation & { fromGeneric?: string; toGeneric?: string }) | null {
  for (const { pat, kind } of RELATION_TOKENS) {
    const m = line.match(new RegExp(`^(\\S+?)(?:\\s+"([^"]+)")?\\s*${pat.source}\\s*(?:"([^"]+)"\\s+)?(\\S+?)(?:\\s*:\\s*(.+))?$`))
    if (!m) continue
    const fromRef = parseClassReference(m[1]!)
    const toRef = parseClassReference(m[4]!)
    if (!fromRef || !toRef) return null
    const from = fromRef.id
    const fromCardinality = m[2]
    const toCardinality = m[3]
    const to = toRef.id
    const label = m[5]?.trim()
    return {
      from, to, kind, label, fromCardinality, toCardinality,
      ...(fromRef.generic ? { fromGeneric: fromRef.generic } : {}),
      ...(toRef.generic ? { toGeneric: toRef.generic } : {}),
    }
  }
  return null
}

export function parseClassBody(lines: string[]): ClassBody | null {
  lines = lines.flatMap(expandInlineNamespaceStatement)
  const body: ClassBody = { kind: 'class', classes: [], relations: [], notes: [] }
  const classMap = new Map<string, ClassNode>()
  const upsert = (id: string, label?: string, generic?: string): ClassNode => {
    let c = classMap.get(id)
    if (!c) { c = { id, label, generic, members: [] }; classMap.set(id, c); body.classes.push(c) }
    else {
      if (label !== undefined && !c.label) c.label = label
      if (generic !== undefined && !c.generic) c.generic = generic
    }
    return c
  }
  // Open namespace nesting: segment stack + how many segments each
  // `namespace` opener pushed (a dot path pushes several that one closing
  // `}` pops together). Declared paths are registered in first-seen order.
  const nsStack: string[] = []
  const nsFrames: number[] = []
  const namespaces: ClassNamespaceDecl[] = []
  const declareNamespace = (path: string, label?: string): void => {
    const existing = namespaces.find(n => n.name === path)
    if (!existing) namespaces.push(label !== undefined ? { name: path, label } : { name: path })
    else if (label !== undefined && existing.label === undefined) existing.label = label
  }
  const claimClass = (node: ClassNode): void => {
    if (nsStack.length > 0 && node.namespace === undefined) node.namespace = nsStack.join('.')
  }

  let i = 0
  while (i < lines.length) {
    const raw = lines[i]!.trim()
    i++
    if (!raw || raw.startsWith('%%')) continue

    // Title
    const tm = raw.match(TITLE_RE)
    if (tm) { body.title = tm[1]!.trim(); continue }

    // Namespace opener — the same grammar the render parser uses
    // (src/class/parser.ts parseNamespaceHeader), so membership cannot drift.
    const ns = parseNamespaceHeader(raw)
    if (ns) {
      nsStack.push(...ns.path)
      nsFrames.push(ns.path.length)
      declareNamespace(nsStack.join('.'), ns.label)
      continue
    }

    // Namespace close
    if (raw === '}' && nsFrames.length > 0) {
      nsStack.length -= nsFrames.pop()!
      continue
    }

    // Class paint directives — parsed before declarations so `class A hot`
    // cannot be mistaken for a malformed class declaration.
    const classDef = raw.match(/^classDef\s+([\w,-]+)\s+(.+)$/)
    if (classDef) {
      const props = parseStyleProps(classDef[2]!)
      if (Object.keys(props).length === 0) return null
      if (!body.classDefs) body.classDefs = {}
      for (const name of classDef[1]!.split(',').map(value => value.trim()).filter(Boolean)) body.classDefs[name] = { ...props }
      continue
    }
    const assignment = raw.match(/^(?:class|cssClass)\s+(.+?)\s+([\w-]+)$/)
    if (assignment && !raw.includes('{') && !raw.includes('[') && !raw.includes(' as ')) {
      const refs = assignment[1]!.replace(/^"|"$/g, '').split(',').map(value => parseClassReference(value.trim()))
      if (refs.every(Boolean)) {
        for (const ref of refs) {
          const node = upsert(ref!.id, undefined, ref!.generic)
          node.className = assignment[2]!
          claimClass(node)
        }
        continue
      }
    }
    const styleLine = raw.match(/^style\s+(.+?)\s+(.+)$/)
    if (styleLine) {
      const refs = styleLine[1]!.replace(/^"|"$/g, '').split(',').map(value => parseClassReference(value.trim()))
      const props = parseStyleProps(styleLine[2]!)
      if (refs.every(Boolean) && Object.keys(props).length > 0) {
        for (const ref of refs) {
          const node = upsert(ref!.id, undefined, ref!.generic)
          node.style = { ...node.style, ...props }
          claimClass(node)
        }
        continue
      }
    }
    const shorthand = raw.match(/^(.+?):::([\w-]+)$/)
    if (shorthand) {
      const ref = parseClassReference(shorthand[1]!)
      if (!ref) return null
      const node = upsert(ref.id, undefined, ref.generic)
      node.className = shorthand[2]!
      claimClass(node)
      continue
    }

    // Class declaration (with or without open brace)
    const declaration = parseClassDeclaration(raw)
    if (declaration) {
      const node = upsert(declaration.id, declaration.label, declaration.generic)
      claimClass(node)
      if (declaration.opensBody) {
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
      const target = nm[1] ? parseClassReference(nm[1]) : null
      if (nm[1] && !target) return null
      body.notes.push({ text: nm[2]!, for: target?.id })
      continue
    }

    // Relation — try this before member because relations may have `:` too
    const rel = parseRelation(raw)
    if (rel) {
      upsert(rel.from, undefined, rel.fromGeneric)
      upsert(rel.to, undefined, rel.toGeneric)
      const { fromGeneric: _fromGeneric, toGeneric: _toGeneric, ...relation } = rel
      body.relations.push(relation)
      continue
    }

    // Member declaration (X : member)
    const mm = raw.match(MEMBER_DECL_RE)
    if (mm) {
      const ref = parseClassReference(mm[1]!)
      if (!ref) return null
      const text = mm[2]!.trim()
      upsert(ref.id, undefined, ref.generic).members.push(text)
      continue
    }

    // Unmodeled line — bail to opaque.
    return null
  }
  // A dangling namespace block (missing `}`) is malformed — keep it opaque
  // rather than guessing where the block ends.
  if (nsFrames.length > 0) return null
  if (namespaces.length > 0) body.namespaces = namespaces
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

/** Emit one class declaration (+ optional member block) at an indent depth. */
function pushClassLines(lines: string[], c: ClassNode, indent: string): void {
  const head = `class ${quoteIfNeeded(c.id)}${c.generic ? `~${c.generic}~` : ''}${c.label ? `["${c.label}"]` : ''}`
  if (c.members.length === 0) {
    lines.push(`${indent}${head}`)
  } else {
    lines.push(`${indent}${head} {`)
    for (const m of c.members) lines.push(`${indent}  ${m}`)
    lines.push(`${indent}}`)
  }
}

export function renderClass(body: ClassBody): string {
  const lines: string[] = ['classDiagram']
  if (body.title) lines.push(`  title ${body.title}`)
  for (const n of body.notes) {
    if (n.for) lines.push(`  note for ${quoteIfNeeded(n.for)} "${n.text}"`)
    else lines.push(`  note "${n.text}"`)
  }
  // Namespace blocks (repo #118), canonicalized to dot-path form — the exact
  // production the render parser's namespace grammar accepts (P3). A parent
  // path without direct members is implied by its descendants' dot paths and
  // skipped, unless it carries a label or is a childless declaration.
  const namespaces = body.namespaces ?? []
  const registryPaths = namespaces.map(n => n.name)
  for (const ns of namespaces) {
    const members = body.classes.filter(c => c.namespace === ns.name)
    const hasRegisteredDescendant = registryPaths.some(p => p.startsWith(`${ns.name}.`))
    if (members.length === 0 && ns.label === undefined && hasRegisteredDescendant) continue
    lines.push(`  namespace ${ns.name}${ns.label !== undefined ? `["${ns.label}"]` : ''} {`)
    for (const c of members) pushClassLines(lines, c, '    ')
    lines.push(`  }`)
  }
  // Classes claimed by a namespace the registry doesn't know (possible only
  // through hand-built bodies) fall back to top level rather than vanishing.
  const known = new Set(registryPaths)
  for (const c of body.classes) {
    if (c.namespace !== undefined && known.has(c.namespace)) continue
    pushClassLines(lines, c, '  ')
  }
  for (const r of body.relations) {
    const arrow = ARROW_FOR[r.kind]
    const left = r.fromCardinality ? `${quoteIfNeeded(r.from)} "${r.fromCardinality}"` : quoteIfNeeded(r.from)
    const right = r.toCardinality ? `"${r.toCardinality}" ${quoteIfNeeded(r.to)}` : quoteIfNeeded(r.to)
    const label = r.label ? ` : ${r.label}` : ''
    lines.push(`  ${left} ${arrow} ${right}${label}`)
  }
  for (const [name, style] of Object.entries(body.classDefs ?? {})) lines.push(`  classDef ${name} ${serializeStyleProps(style)}`)
  for (const c of body.classes) {
    if (c.className) lines.push(`  class ${quoteIfNeeded(c.id)} ${c.className}`)
    if (c.style) lines.push(`  style ${quoteIfNeeded(c.id)} ${serializeStyleProps(c.style)}`)
  }
  return lines.join('\n') + '\n'
}

// ---- Mutator --------------------------------------------------------------

function cloneClass(body: ClassBody): ClassBody {
  return {
    kind: 'class',
    title: body.title,
    classes: body.classes.map(c => ({
      id: c.id, label: c.label, generic: c.generic, members: [...c.members], namespace: c.namespace,
      ...(c.className ? { className: c.className } : {}),
      ...(c.style ? { style: { ...c.style } } : {}),
    })),
    relations: body.relations.map(r => ({ ...r })),
    notes: body.notes.map(n => ({ ...n })),
    ...(body.namespaces ? { namespaces: body.namespaces.map(n => ({ ...n })) } : {}),
    ...(body.classDefs ? { classDefs: Object.fromEntries(Object.entries(body.classDefs).map(([name, style]) => [name, { ...style }])) } : {}),
  }
}

/** Valid namespace path: dot-joined identifier segments (the same shape the
 *  render parser's namespace grammar accepts). */
const NAMESPACE_PATH_RE = /^[\w$]+(\.[\w$]+)*$/

/** Register a namespace path on the body (first-seen order, idempotent). */
function normalizeGeneric(value: unknown): Result<string, MutationError> {
  if (typeof value !== 'string') return err({ code: 'INVALID_OP', message: 'Class generic must be a string or null' })
  const generic = value.trim()
  if (!generic || generic.includes('~') || /[\r\n]/.test(generic)) {
    return err({ code: 'INVALID_OP', message: 'Class generic must be non-empty and must not contain ~ or line breaks' })
  }
  return ok(generic)
}

function declareNamespaceOn(b: ClassBody, path: string): void {
  if (!b.namespaces) b.namespaces = []
  if (!b.namespaces.some(n => n.name === path)) b.namespaces.push({ name: path })
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
      if (op.namespace !== undefined && !NAMESPACE_PATH_RE.test(op.namespace)) {
        return err({ code: 'INVALID_OP', message: `invalid namespace path "${op.namespace}" — expected dot-joined identifier segments like "Platform.Auth"` })
      }
      let generic: string | undefined
      if (op.generic !== undefined) {
        const parsed = normalizeGeneric(op.generic)
        if (!parsed.ok) return parsed
        generic = parsed.value
      }
      b.classes.push({ id: op.id, label: op.label, generic, members: op.members ?? [], namespace: op.namespace })
      if (op.namespace !== undefined) declareNamespaceOn(b, op.namespace)
      return ok(b)
    }
    case 'set_class_namespace': {
      const c = findClass(op.class)
      if (!c) return err({ code: 'CLASS_NOT_FOUND', message: `class ${op.class} not found` })
      if (op.namespace === null) {
        c.namespace = undefined
        return ok(b)
      }
      if (!NAMESPACE_PATH_RE.test(op.namespace)) {
        return err({ code: 'INVALID_OP', message: `invalid namespace path "${op.namespace}" — expected dot-joined identifier segments like "Platform.Auth"` })
      }
      c.namespace = op.namespace
      declareNamespaceOn(b, op.namespace)
      return ok(b)
    }
    case 'define_class': {
      if (typeof op.name !== 'string' || !/^[\w-]+$/.test(op.name)) return err({ code: 'INVALID_OP', message: 'classDef name must contain only letters, digits, underscore, or hyphen' })
      const style = parseMutableStyleProps(op.style)
      if (!style.ok) return err({
        code: 'INVALID_OP',
        message: style.reason === 'MULTILINE'
          ? 'classDef style must be a single-line CSS-like property list'
          : 'classDef style must contain at least one property:value pair',
      })
      if (!b.classDefs) b.classDefs = {}
      b.classDefs[op.name] = style.value
      return ok(b)
    }
    case 'set_css_class': {
      const c = findClass(op.class)
      if (!c) return err({ code: 'CLASS_NOT_FOUND', message: `class ${op.class} not found` })
      if (op.className === null) delete c.className
      else {
        if (!/^[\w-]+$/.test(op.className)) return err({ code: 'INVALID_OP', message: 'CSS class name must contain only letters, digits, underscore, or hyphen' })
        c.className = op.className
      }
      return ok(b)
    }
    case 'set_class_style': {
      const c = findClass(op.class)
      if (!c) return err({ code: 'CLASS_NOT_FOUND', message: `class ${op.class} not found` })
      if (op.style === null) delete c.style
      else {
        const style = parseMutableStyleProps(op.style)
        if (!style.ok) return err({
          code: 'INVALID_OP',
          message: style.reason === 'MULTILINE'
            ? 'Class style must be a single-line CSS-like property list'
            : 'Class style must contain at least one property:value pair',
        })
        c.style = style.value
      }
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
    case 'set_class_generic': {
      const c = findClass(op.class)
      if (!c) return err({ code: 'CLASS_NOT_FOUND', message: `class ${op.class} not found` })
      if (op.generic === null) {
        c.generic = undefined
      } else {
        const generic = normalizeGeneric(op.generic)
        if (!generic.ok) return generic
        c.generic = generic.value
      }
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
      return err({ code: 'INVALID_OP', message: unknownOpMessage('class', op) })
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
  for (const ns of body.namespaces ?? []) {
    if (ns.label) overflow(`namespace:${ns.name}`, ns.label)
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
