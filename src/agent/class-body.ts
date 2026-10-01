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
//   link A "https://example.com" "optional tooltip"
//   title T
//   namespace X { class A ... }                  (repo #118: nesting, dot
//   namespace A.B.C { ... }                       paths, and ["Label"] via
//   namespace X["Label"] { ... }                  the render parser's own
//                                                 namespace grammar)
//
// Unmodeled (forces opaque):
//   - direction TB (wired at layout, unmodeled here); repeated class
//     annotations stay opaque because the renderer has one annotation slot.
//   - cssClass / callbacks / unsupported click forms
//   - styled / classDef
// ============================================================================

import { unknownOpMessage } from './mutation-ops.ts'
import type {
  ClassBody, ClassNode, ClassRelation, ClassRelationKind, ClassNote, ClassNamespaceDecl,
  ClassMutationOp, MutationError, Result, LayoutWarning, VerifyOptions,
} from './types.ts'
import { ok, err } from './types.ts'
import { labelOverflowCollector } from './body-utils.ts'
import { classCommentRejections, classDiagramHasStatement, parseClassBodyAnnotationToken, parseClassRelationship, readClassStatements } from '../class/parser.ts'
import type { ClassStatementNode } from '../class/parser.ts'
import { parseMutableStyleProps, serializeStyleProps, unsafeStylePaintError } from '../shared/style-props.ts'

// ---- Parser ---------------------------------------------------------------

function projectClassRelation(shared: NonNullable<ReturnType<typeof parseClassRelationship>>): ClassRelation & { fromGeneric?: string; toGeneric?: string } {
  return {
    from: shared.from, to: shared.to, kind: shared.type as ClassRelationKind,
    ...(shared.label ? { label: shared.label } : {}),
    ...(shared.fromCardinality ? { fromCardinality: shared.fromCardinality } : {}),
    ...(shared.toCardinality ? { toCardinality: shared.toCardinality } : {}),
    markerAt: shared.markerAt,
    ...(shared.fromType ? { fromKind: shared.fromType as ClassRelationKind } : {}),
    ...(shared.toType ? { toKind: shared.toType as ClassRelationKind } : {}),
    ...(shared.fromGeneric ? { fromGeneric: shared.fromGeneric } : {}),
    ...(shared.toGeneric ? { toGeneric: shared.toGeneric } : {}),
  }
}

export function parseClassRelationSyntax(line: string): (ClassRelation & { fromGeneric?: string; toGeneric?: string }) | null {
  const shared = parseClassRelationship(line)
  return shared ? projectClassRelation(shared) : null
}

export function parseClassBody(lines: string[]): ClassBody | null {
  const tree = readClassStatements(lines)
  if (tree.diagnostics.length > 0) return null
  const body: ClassBody = { kind: 'class', classes: [], relations: [], notes: [] }
  const classMap = new Map<string, ClassNode>()
  const upsert = (id: string, label?: string, generic?: string): ClassNode => {
    let cls = classMap.get(id)
    if (!cls) {
      cls = { id, label, generic, members: [] }
      classMap.set(id, cls)
      body.classes.push(cls)
    } else {
      if (label !== undefined) cls.label = label
      if (generic !== undefined && !cls.generic) cls.generic = generic
    }
    return cls
  }
  const namespaces: ClassNamespaceDecl[] = []
  const claim = (node: ClassNode, path: string): boolean => {
    // One typed membership cannot replay claims in multiple namespaces,
    // including the otherwise empty groups. Keep the authored source instead.
    if (path && node.namespace !== undefined && node.namespace !== path) return false
    if (path && node.namespace === undefined) node.namespace = path
    return true
  }
  const addAnnotation = (node: ClassNode, annotation: string): boolean => {
    if (node.members.some(member => parseClassBodyAnnotationToken(member) !== null)) return false
    node.members.push(`<<${annotation}>>`)
    return true
  }
  const visit = (nodes: ClassStatementNode[], path = '', owner?: ClassNode): boolean => {
    const frames = [{ nodes, path, owner, index: 0 }]
    while (frames.length) {
      const frame = frames.at(-1)!
      if (frame.index === frame.nodes.length) { frames.pop(); continue }
      const node = frame.nodes[frame.index++]!
      const { path, owner } = frame
      const value = node.value
      switch (value.kind) {
        case 'header': case 'trivia': case 'close': break
        case 'direction': case 'unknown': case 'source-only': return false // no typed slot; whole-body opaque is lossless
        case 'namespace': {
          // The typed model uses dotted paths, so a literal dot inside one
          // quoted atom has no lossless typed representation.
          if (value.path.some(segment => segment.includes('.'))) return false
          const namespacePath = [path, ...value.path].filter(Boolean).join('.')
          let namespace = namespaces.find(candidate => candidate.name === namespacePath)
          if (!namespace) {
            namespace = { name: namespacePath, ...(value.label !== undefined ? { label: value.label } : {}) }
            namespaces.push(namespace)
          } else if (value.label !== undefined) namespace.label = value.label
          frames.push({ nodes: node.children!, path: namespacePath, owner: undefined, index: 0 })
          break
        }
        case 'class': {
          const declaration = value.declaration
          const cls = upsert(declaration.id, declaration.label, declaration.generic)
          if (declaration.className !== undefined) cls.className = declaration.className
          if (!claim(cls, path)) return false
          if (node.children) frames.push({ nodes: node.children, path, owner: cls, index: 0 })
          break
        }
        case 'member': {
          const cls = value.reference ? upsert(value.reference.id, undefined, value.reference.generic) : owner!
          cls.members.push(value.text)
          break
        }
        case 'body-annotation': if (!addAnnotation(owner!, value.text)) return false; break
        case 'annotation': {
          const annotation = value.annotation
          if (annotation.placement === 'separate' && !classMap.has(annotation.id)) return false
          const cls = upsert(annotation.id, annotation.label, annotation.generic)
          if (!addAnnotation(cls, annotation.annotation)) return false
          if (!claim(cls, path)) return false
          break
        }
        case 'interaction': {
          const cls = upsert(value.interaction.id, undefined, value.interaction.generic)
          cls.href = value.interaction.href
          if (value.interaction.tooltip !== undefined) cls.tooltip = value.interaction.tooltip
          if (!claim(cls, path)) return false
          break
        }
        case 'note':
          // Decoded physical line breaks cannot be emitted inside a quoted
          // Class note. Keep authored source rather than expose an unsafe edit.
          if (/[\r\n]/.test(value.text)) return false
          if (value.reference) upsert(value.reference.id, undefined, value.reference.generic)
          body.notes.push({ text: value.text, for: value.reference?.id })
          break
        case 'title': body.title = value.text; break
        case 'relationship': {
          const relation = projectClassRelation(value.relationship)
          upsert(relation.from, undefined, relation.fromGeneric)
          upsert(relation.to, undefined, relation.toGeneric)
          const { fromGeneric: _fromGeneric, toGeneric: _toGeneric, ...plain } = relation
          body.relations.push(plain)
          break
        }
        case 'classDef':
          body.classDefs ??= {}
          for (const name of value.names) body.classDefs[name] = { ...value.props }
          break
        case 'assignment': case 'style':
          for (const reference of value.references) {
            const cls = upsert(reference.id, undefined, reference.generic)
            if (value.kind === 'assignment') cls.className = value.name
            else cls.style = { ...cls.style, ...value.props }
            if (!claim(cls, path)) return false
          }
          break
      }
    }
    return true
  }
  if (!visit(tree.statements)) return null
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
  lollipop: '()--',
}

function arrowForRelation(relation: ClassRelation): string {
  if (relation.kind === 'lollipop') return relation.markerAt === 'to' ? '--()' : '()--'
  if (relation.markerAt === 'both') {
    const fromKind = relation.fromKind ?? relation.kind
    const toKind = relation.toKind ?? relation.kind
    const endpoint = (kind: ClassRelationKind, left: boolean): string => {
      if (kind === 'inheritance' || kind === 'realization') return left ? '<|' : '|>'
      if (kind === 'composition') return '*'
      if (kind === 'aggregation') return 'o'
      return left ? '<' : '>'
    }
    const dashed = fromKind === 'dependency' || fromKind === 'realization' || toKind === 'dependency' || toKind === 'realization'
    return `${endpoint(fromKind, true)}${dashed ? '..' : '--'}${endpoint(toKind, false)}`
  }
  return ARROW_FOR[relation.kind]
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
    const segments = ns.name.split('.')
    if (segments.every(segment => /^[\w$]+$/.test(segment))) {
      lines.push(`  namespace ${ns.name}${ns.label !== undefined ? `["${ns.label}"]` : ''} {`)
      for (const c of members) pushClassLines(lines, c, '    ')
      lines.push('  }')
    } else {
      // Preserve each path atom: quoting the entire dotted path would turn a
      // nested namespace into one flat name.
      segments.forEach((segment, index) => {
        const label = index === segments.length - 1 && ns.label !== undefined ? `["${ns.label}"]` : ''
        lines.push(`${'  '.repeat(index + 1)}namespace ${quoteIfNeeded(segment)}${label} {`)
      })
      for (const c of members) pushClassLines(lines, c, '  '.repeat(segments.length + 1))
      for (let index = segments.length; index > 0; index--) lines.push(`${'  '.repeat(index)}}`)
    }
  }
  // Classes claimed by a namespace the registry doesn't know (possible only
  // through hand-built bodies) fall back to top level rather than vanishing.
  const known = new Set(registryPaths)
  for (const c of body.classes) {
    if (c.namespace !== undefined && known.has(c.namespace)) continue
    pushClassLines(lines, c, '  ')
  }
  // Notes can introduce a class on read. Emit them after declarations so a
  // reload cannot move their target ahead of the authored class identities.
  for (const n of body.notes) {
    const text = n.text.replace(/&/g, '&amp;').replace(/\\/g, '&#92;').replace(/"/g, '&quot;')
    if (n.for) lines.push(`  note for ${quoteIfNeeded(n.for)} "${text}"`)
    else lines.push(`  note "${text}"`)
  }
  for (const r of body.relations) {
    const arrow = arrowForRelation(r)
    const left = r.fromCardinality ? `${quoteIfNeeded(r.from)} "${r.fromCardinality}"` : quoteIfNeeded(r.from)
    const right = r.toCardinality ? `"${r.toCardinality}" ${quoteIfNeeded(r.to)}` : quoteIfNeeded(r.to)
    const label = r.label ? ` : ${r.label}` : ''
    lines.push(`  ${left} ${arrow} ${right}${label}`)
  }
  for (const [name, style] of Object.entries(body.classDefs ?? {})) lines.push(`  classDef ${name} ${serializeStyleProps(style)}`)
  for (const c of body.classes) {
    if (c.className) lines.push(`  class ${quoteIfNeeded(c.id)} ${c.className}`)
    if (c.style) lines.push(`  style ${quoteIfNeeded(c.id)} ${serializeStyleProps(c.style)}`)
    if (c.href) {
      lines.push(`  click ${quoteIfNeeded(c.id)} href "${c.href.replace(/&/g, '&amp;').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"${c.tooltip !== undefined ? ` "${c.tooltip.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"` : ''}`)
    }
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
      ...(c.href ? { href: c.href } : {}),
      ...(c.tooltip !== undefined ? { tooltip: c.tooltip } : {}),
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
          : style.reason === 'UNSAFE_PAINT'
            ? unsafeStylePaintError(`define_class ${op.name}`, style.paint).message
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
            : style.reason === 'UNSAFE_PAINT'
              ? unsafeStylePaintError(`set_class_style ${op.class}`, style.paint).message
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
      if (typeof op.text !== 'string' || /[\r\n]/.test(op.text)) {
        return err({ code: 'INVALID_OP', message: 'Class note text must be a single line; use <br/> for displayed line breaks' })
      }
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

/** Class source ours reads where Mermaid 11.16 rejects it, each on its
 * canonical line: a bare header draws an empty diagram, and a trailing `%%`
 * where Mermaid's class grammar does not end the statement is a comment. */
export function classUnsupportedSyntaxWarnings(canonicalSource: string): LayoutWarning[] {
  const lines = canonicalSource.split(/\r?\n/)
  const header = lines.findIndex(line => /^classDiagram(?:-v2)?\b/.test(line.trim()))
  if (header < 0) return []
  const bodyLines = lines.slice(header + 1)
  const warnings: LayoutWarning[] = []
  if (!classDiagramHasStatement(bodyLines)) {
    warnings.push({
      code: 'UNSUPPORTED_SYNTAX',
      syntax: 'class_empty_diagram',
      line: header + 1,
      message: 'A "classDiagram" header with no statement after it draws an empty class diagram. Mermaid 11.16 rejects this; add a class, relationship, note or other statement.',
    })
  }
  for (const { index, what } of classCommentRejections(bodyLines)) {
    warnings.push({
      code: 'UNSUPPORTED_SYNTAX',
      syntax: 'class_trailing_comment',
      line: header + 2 + index,
      message: `${what}. Mermaid 11.16 rejects this; put the comment on a line of its own.`,
    })
  }
  const extensionWarnings = (nodes: ClassStatementNode[]): void => {
    const pending = [...nodes].reverse()
    const semicolonLines = new Set<number>()
    while (pending.length) {
      const node = pending.pop()!
      if (node.followsNamespaceCloseOnSameLine && node.value.kind === 'trivia' && node.raw.startsWith('%%')) warnings.push({
        code: 'UNSUPPORTED_SYNTAX', syntax: 'class_trailing_comment', line: header + 1 + node.source.line,
        message: 'A %% comment after a namespace closing brace is read as a comment. Mermaid 11.16 rejects this; put the comment on a line of its own.',
      })
      else if (node.followsNamespaceCloseOnSameLine && node.value.kind !== 'trivia' && node.value.kind !== 'close') warnings.push({
        code: 'UNSUPPORTED_SYNTAX', syntax: 'class_statement_after_namespace_close', line: header + 1 + node.source.line,
        message: 'A Class statement after a namespace closing brace on the same line is read as a separate statement. Mermaid 11.16 rejects this, even with a semicolon; put the statement on a new line.',
      })
      if (node.compactSemicolon && !semicolonLines.has(node.source.line)) {
        semicolonLines.add(node.source.line)
        warnings.push({
          code: 'UNSUPPORTED_SYNTAX', syntax: 'class_compact_semicolon_statement_extension', line: header + 1 + node.source.line,
          message: 'Semicolon-separated statements inside a compact Class namespace are read as separate statements. Mermaid 11.16 rejects this source; put each statement on its own line.',
        })
      }
      if (node.value.kind === 'note' && node.value.escapedQuotes) warnings.push({
        code: 'UNSUPPORTED_SYNTAX', syntax: 'class_escaped_note_quotes', line: header + 1 + node.source.line,
        message: 'Backslash-escaped quotes in Class notes are read as text. Mermaid 11.16 rejects this; use &quot; inside the quoted note.',
      })
      if (node.children) for (let index = node.children.length - 1; index >= 0; index--) pending.push(node.children[index]!)
    }
  }
  extensionWarnings(readClassStatements(bodyLines).statements)
  return warnings
}

export function verifyClass(body: ClassBody, opts: VerifyOptions): LayoutWarning[] {
  const warnings: LayoutWarning[] = []

  if (body.classes.length === 0 && body.title === undefined) {
    warnings.push({ code: 'EMPTY_DIAGRAM' })
    return warnings
  }

  const overflow = labelOverflowCollector(warnings, opts)
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
