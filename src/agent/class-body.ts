import { classInterfaceSide, createClassInterfaceAllocator } from '../class/interface-occurrences.ts'

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

import { decodeXML } from 'entities'
import type { ClassStatementNode } from '../class/parser.ts'
import { classCommentRejections, classDiagramHasStatement, classStatementEnds, MERMAID_DIRECTIVE_RE, parseClassBodyAnnotationToken, parseClassDiagram, parseClassMember, parseClassRelationship, readClassStatements, readsAsClassName, supportedRelationEndpoint, withoutStyleComment } from '../class/parser.ts'
import { classTextLabel, decodeClassText, hasClassDirectionToken, memberToString, writeClassText } from '../class/text.ts'
import { toMermaidLines } from '../mermaid-source-wrapper.ts'
import { parseAccessibilityDirective, scanAccessibilityDirectives, withAccessibilityFields } from '../shared/accessibility-directives.ts'
import { normalizeMermaidSource, preservedMermaidFamilySource, withFrontmatterTitle } from '../mermaid-source.ts'
import { sourceLineStarts, sourcePointAt } from '../shared/source-spans.ts'
import { prepareDisplayText, resolveLabelContent } from '../shared/display-text.ts'
import { mermaidEntityPrepass } from '../shared/mermaid-entities.ts'
import { compactStyleDeclarations, ownStyleDeclarations, parseMutableStyleProps, parseStyleDeclarations, projectStyleDeclarations, retainedStyleDeclarations, unsafeStylePaintError, type StyleDeclaration } from '../shared/style-props.ts'
import { classLikeStyleHasValueCommas, classLikeStyleStatement, portableClassLikeStyleProps } from '../shared/class-like-style.ts'
import { labelOverflowCollector } from './body-utils.ts'
import { unknownOpMessage } from './mutation-ops.ts'
import type { ClassBody, ClassMutationOp, ClassNamespaceDecl, ClassNode, ClassNote, ClassRelation, ClassRelationKind, LayoutWarning, MutationError, Result, VerifyOptions } from './types.ts'
import { err, ok } from './types.ts'
import { appendSourceStatement, applySourceEdits, sameSourceMeaning, type SourceEdit } from './source-mutation.ts'

// ---- Parser ---------------------------------------------------------------

/** `record[key] = value` as an own key: a class may be named `__proto__`,
 *  which an assignment would take as the record's prototype. */
function setOwn<T>(record: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(record, key, { value, enumerable: true, writable: true, configurable: true })
}

/** cssClass/classDef take one ALPHA token; ::: also takes a single minus
 * and reads ordinary statement keywords as names in its class lexer state. */
function writableStyleClassName(name: string, definition = false): boolean {
  return definition
    ? /^\w+$/.test(name) && name !== 'call' && readsAsClassName(name, false, true)
    : (/^\w+$/.test(name) || name === '-') && readsAsClassName(name, false, false)
}

/** Before the first colon, stylesOpt admits ALPHA and STYLE, but not the
 * other Class keyword tokens. accTitle/accDescr followed by ':' enter their
 * exclusive lexer states. Later properties are held inside LABEL tokens. */
function writableFirstStyleProperty(property: string): boolean {
  return /^\w+$/.test(property) && property !== 'accTitle' && property !== 'accDescr'
    && (property === 'style' || readsAsClassName(property, false, true))
}

function portableClassStyleProps(style: Readonly<Record<string, string>>, declarations?: readonly StyleDeclaration[]): Record<string, string> | undefined {
  const portable = portableClassLikeStyleProps(style, declarations)
  return portable && Object.keys(portable).length ? portable : undefined
}

function classStyleStatement(prefix: string, style: Readonly<Record<string, string>>, declarations?: readonly StyleDeclaration[]): string {
  return classLikeStyleStatement(prefix, style, !writableFirstStyleProperty(declarations?.[0]?.[0] ?? Object.keys(style)[0] ?? ''), declarations)
}

/** Inline STYLE requires ALPHA, unlike declarations and cssClass targets.
 * Backticks do not extend this production to arbitrary class identities. */
function writableInlineStyleTarget(id: string): boolean {
  return /^\w+$/.test(id) && id !== 'call' && readsAsClassName(id, false, true)
}

/** Raw member strings are authored grammar, so escaping a tag would change
 * their stored content. A tag opener spanning the method's `(` is consumed
 * by Mermaid's sanitizer; a name made only of tags is consumed too. */
function classMemberWriteProblem(member: string): string | undefined {
  if (/[{}]/.test(member) && hasClassDirectionToken(member)) return `Class member ${JSON.stringify(member)} requires inline syntax, where a greedy Mermaid direction token consumes it; no supported spelling preserves its authored string`
  if (parseClassBodyAnnotationToken(member) !== null) return
  const open = member.indexOf('(')
  if (open < 0 || !member.includes(')', open)) return
  const before = member.slice(0, open)
  const tag = /<[A-Za-z!/?]/
  if (/<[A-Za-z!/?][^>]*$/.test(before) || (tag.test(before) && before.replace(/<[^>]*>/g, '').replace(/^[#+~-]/, '').trim() === '')) {
    return `Class member ${JSON.stringify(member)} loses its method name in Mermaid's HTML sanitization and has no supported spelling that preserves its authored string`
  }
}

function classBodyWriteProblem(body: ClassBody): string | undefined {
  for (const node of body.classes) {
    if (node.label === '') return 'An explicitly empty Class label has no lossless Mermaid spelling; retain the source without typed editing'
    if (hasClassDirectionToken(node.id) || node.namespace !== undefined && hasClassDirectionToken(node.namespace)) return 'A Class identity containing a greedy direction token has no lossless Mermaid spelling'
    if (node.style && !writableInlineStyleTarget(node.id)) return `Class inline style target ${JSON.stringify(node.id)} is not an ALPHA identifier in Mermaid's style grammar`
    if (node.style && !portableClassStyleProps(node.style, node.styleDeclarations)) return `Class style on ${JSON.stringify(node.id)} has no supported lossless Mermaid property/value spelling`
    if (node.id.startsWith('"')) return `Class id ${JSON.stringify(node.id)} starts with a double quote and has no supported lossless Mermaid spelling`
    for (const name of node.className?.split(/\s+/).filter(Boolean) ?? []) {
      if (!writableStyleClassName(name)) return `Class style reference ${JSON.stringify(name)} has no supported lossless Mermaid spelling`
    }
    for (const member of node.members) {
      const problem = classMemberWriteProblem(member)
      if (problem) return problem
    }
  }
  if (body.namespaces?.some(namespace => namespace.label === '')) return 'An explicitly empty Class namespace label has no lossless Mermaid spelling; retain the source without typed editing'
  if (body.namespaces?.some(namespace => namespaceStartsGeneric(namespace.name.split('.')))) return 'A leading tilde in a Class namespace path segment opens a generic token even inside backticks and has no lossless Mermaid spelling'
  if (body.namespaces?.some(namespace => hasClassDirectionToken(namespace.name))) return 'A Class namespace identity containing a greedy direction token has no lossless Mermaid spelling'
  if (Object.keys(body.classDefDeclarations ?? {}).some(name => !Object.hasOwn(body.classDefs ?? {}, name))) return 'Ordered Class declarations require a matching property record'
  for (const node of body.classes) if (node.styleDeclarations && !node.style) return 'Ordered Class declarations require a matching property record'
  for (const [name, style] of Object.entries(body.classDefs ?? {})) {
    if (!writableStyleClassName(name, true)) return `Class style definition ${JSON.stringify(name)} has no supported lossless Mermaid spelling`
    if (!portableClassStyleProps(style, ownStyleDeclarations(body.classDefDeclarations, name))) return `Class style definition ${JSON.stringify(name)} has no supported lossless Mermaid property/value spelling`
  }
}

function projectClassRelation(shared: NonNullable<ReturnType<typeof parseClassRelationship>>): ClassRelation & { fromGeneric?: string; toGeneric?: string } {
  return {
    from: shared.from,
    to: shared.to,
    kind: shared.type as ClassRelationKind,
    ...(shared.label ? { label: shared.label } : {}),
    ...(shared.labelContent ? { labelContent: shared.labelContent } : {}),
    ...(shared.fromCardinality ? { fromCardinality: shared.fromCardinality } : {}),
    ...(shared.toCardinality ? { toCardinality: shared.toCardinality } : {}),
    ...(shared.fromCardinalityContent ? { fromCardinalityContent: shared.fromCardinalityContent } : {}),
    ...(shared.toCardinalityContent ? { toCardinalityContent: shared.toCardinalityContent } : {}),
    markerAt: shared.markerAt,
    ...(shared.fromType ? { fromKind: shared.fromType as ClassRelationKind } : {}),
    ...(shared.toType ? { toKind: shared.toType as ClassRelationKind } : {}),
    ...(shared.lineStyle ? { lineStyle: shared.lineStyle } : {}),
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
  const allocateInterface = createClassInterfaceAllocator(tree.statements)
  const laterCssClasses: Array<{ id: string; name: string }> = []
  const upsert = (id: string, label?: string, generic?: string): ClassNode => {
    let cls = classMap.get(id)
    if (!cls) {
      cls = { id, ...(label !== undefined ? classTextLabel(label, false) : { label }), generic, members: [] }
      classMap.set(id, cls)
      body.classes.push(cls)
    } else {
      if (label !== undefined) {
        delete cls.labelContent
        Object.assign(cls, classTextLabel(label, false))
      }
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
      if (frame.index === frame.nodes.length) {
        frames.pop()
        continue
      }
      const node = frame.nodes[frame.index++]!
      const { path, owner } = frame
      const value = node.value
      switch (value.kind) {
        case 'header':
        case 'trivia':
        case 'close':
          break
        case 'direction':
        case 'unknown':
        case 'source-only':
          return false // no typed slot; whole-body opaque is lossless
        case 'namespace': {
          // The typed model uses dotted paths, so a literal dot inside one
          // quoted atom has no lossless typed representation.
          if (value.path.some(segment => segment.includes('.'))) return false
          const namespacePath = [path, ...value.path].filter(Boolean).join('.')
          let namespace = namespaces.find(candidate => candidate.name === namespacePath)
          if (!namespace) {
            namespace = { name: namespacePath, ...(value.label !== undefined ? classTextLabel(value.label, false) : {}) }
            namespaces.push(namespace)
          } else if (value.label !== undefined) {
            delete namespace.labelContent
            Object.assign(namespace, classTextLabel(value.label, false))
          }
          frames.push({ nodes: node.children!, path: namespacePath, owner: undefined, index: 0 })
          break
        }
        case 'class': {
          const declaration = value.declaration
          const cls = upsert(declaration.id, declaration.label, declaration.generic)
          if (declaration.className !== undefined) cls.className = declaration.className
          if (declaration.annotation !== undefined && !addAnnotation(cls, declaration.annotation)) return false
          if (!claim(cls, path)) return false
          if (node.children) frames.push({ nodes: node.children, path, owner: cls, index: 0 })
          break
        }
        case 'member': {
          const cls = value.reference ? upsert(value.reference.id, undefined, value.reference.generic) : owner!
          cls.members.push(value.text)
          break
        }
        case 'body-annotation':
          if (!addAnnotation(owner!, value.text)) return false
          break
        case 'annotation': {
          const annotation = value.annotation
          if (annotation.placement === 'separate' && !classMap.has(annotation.id)) return false
          const cls = upsert(annotation.id, annotation.label, annotation.generic)
          if (annotation.className !== undefined) cls.className = annotation.className
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
          {
            const { label: text, labelContent: textContent } = classTextLabel(value.text, false)
            body.notes.push({ text, for: value.reference?.id, ...(textContent ? { textContent } : {}) })
          }
          break
        case 'title':
          body.title = value.text
          break
        case 'relationship': {
          const relation = projectClassRelation(value.relationship)
          const side = classInterfaceSide(value.relationship)
          if (side) {
            const generic = side === 'from' ? relation.fromGeneric : relation.toGeneric
            const label = relation[side] + (generic ? `~${generic}~` : '')
            const id = allocateInterface()
            const opposite = side === 'from' ? 'to' : 'from'
            upsert(relation[opposite], undefined, opposite === 'from' ? relation.fromGeneric : relation.toGeneric)
            const occurrence: ClassNode = { id, label, ...(generic ? { generic } : {}), isInterface: true, members: [] }
            classMap.set(id, occurrence)
            body.classes.push(occurrence)
            relation[side] = id
          } else {
            upsert(relation.from, undefined, relation.fromGeneric)
            upsert(relation.to, undefined, relation.toGeneric)
          }
          const { fromGeneric: _fromGeneric, toGeneric: _toGeneric, ...plain } = relation
          body.relations.push(plain)
          break
        }
        case 'classDef': {
          const props = portableClassStyleProps(value.props, value.declarations)
          if (!props) return false
          body.classDefs ??= {}
          for (const name of value.names) {
            const entries = compactStyleDeclarations([...(ownStyleDeclarations(body.classDefDeclarations, name) ?? Object.entries(body.classDefs[name] ?? {})), ...value.declarations])
            setOwn(body.classDefs, name, projectStyleDeclarations(entries))
            const declarations = retainedStyleDeclarations(entries)
            if (declarations) { body.classDefDeclarations ??= {}; setOwn(body.classDefDeclarations, name, declarations) }
          }
          break
        }
        case 'assignment':
        case 'style':
          for (const reference of value.references) {
            // A cssClass styles a class declared elsewhere, before or after
            // it, and declares none (src/class/parser.ts).
            if (value.kind === 'assignment' && value.form.startsWith('cssClass')) {
              const existing = classMap.get(reference.id)
              if (existing) existing.className = value.name
              else laterCssClasses.push({ id: reference.id, name: value.name })
              continue
            }
            const cls = upsert(reference.id, undefined, reference.generic)
            if (value.kind === 'assignment') cls.className = value.name
            else {
              const props = portableClassStyleProps(value.props, value.declarations)
              if (!props) return false
              const entries = compactStyleDeclarations([...(cls.styleDeclarations ?? Object.entries(cls.style ?? {})), ...value.declarations])
              cls.style = projectStyleDeclarations(entries)
              cls.styleDeclarations = retainedStyleDeclarations(entries)
              if (!cls.styleDeclarations) delete cls.styleDeclarations
            }
            if (!claim(cls, path)) return false
          }
          break
      }
    }
    return true
  }
  if (!visit(tree.statements)) return null
  for (const { id, name } of laterCssClasses) {
    const cls = classMap.get(id)
    if (cls && cls.className === undefined) cls.className = name
  }
  if (namespaces.length > 0) body.namespaces = namespaces
  if (classBodyWriteProblem(body)) return null
  // Mermaid cannot write empty namespace blocks. Preserve directly authored
  // ones verbatim instead of promising a portable structured edit.
  if (namespaces.some(namespace => !namespaceHasClasses(body, namespace.name))) return null
  body.classes = body.classes.filter(node => !node.isInterface).concat(body.classes.filter(node => node.isInterface))
  return body
}

function namespaceHasClasses(body: ClassBody, name: string): boolean {
  return body.classes.some(node => node.namespace === name || node.namespace?.startsWith(`${name}.`))
}

/** Empty unlabeled groups are structural scaffolding; explicit labels are
 * authored content and must not silently vanish when the last class leaves. */
function pruneEmptyNamespaces(body: ClassBody): Result<ClassBody, MutationError> {
  const empty = (body.namespaces ?? []).filter(namespace => !namespaceHasClasses(body, namespace.name))
  const labeled = empty.find(namespace => namespace.label !== undefined)
  if (labeled)
    return err({
      code: 'INVALID_OP',
      message: `Cannot empty labeled namespace "${labeled.name}" without losing its label; keep a class in the group or edit the source explicitly`,
    })
  if (body.namespaces) {
    body.namespaces = body.namespaces.filter(namespace => !empty.includes(namespace))
    if (body.namespaces.length === 0) delete body.namespaces
  }
  return ok(body)
}

// ---- Serializer -----------------------------------------------------------

const RELATION_SYNTAX: Record<
  ClassRelationKind,
  {
    from: string
    to: string
    shaft: '--' | '..'
    defaultMarkerAt: 'from' | 'to' | 'none'
  }
> = {
  inheritance: { from: '<|', to: '|>', shaft: '--', defaultMarkerAt: 'from' },
  composition: { from: '*', to: '*', shaft: '--', defaultMarkerAt: 'from' },
  aggregation: { from: 'o', to: 'o', shaft: '--', defaultMarkerAt: 'from' },
  association: { from: '<', to: '>', shaft: '--', defaultMarkerAt: 'to' },
  dependency: { from: '<', to: '>', shaft: '..', defaultMarkerAt: 'to' },
  realization: { from: '<|', to: '|>', shaft: '..', defaultMarkerAt: 'to' },
  'link-solid': { from: '', to: '', shaft: '--', defaultMarkerAt: 'none' },
  'link-dashed': { from: '', to: '', shaft: '..', defaultMarkerAt: 'none' },
  lollipop: { from: '()', to: '()', shaft: '--', defaultMarkerAt: 'from' },
}

/** The same endpoint ownership drives serialization and semantic read-back. */
export function classRelationMarkers(relation: ClassRelation): {
  at: NonNullable<ClassRelation['markerAt']>
  from?: ClassRelationKind
  to?: ClassRelationKind
} {
  const at = relation.markerAt ?? RELATION_SYNTAX[relation.kind].defaultMarkerAt
  return {
    at,
    ...(at === 'from' || at === 'both' ? { from: relation.fromKind ?? relation.kind } : {}),
    ...(at === 'to' || at === 'both' ? { to: relation.toKind ?? relation.kind } : {}),
  }
}

export function classRelationLineStyle(relation: ClassRelation): 'solid' | 'dashed' {
  if (relation.lineStyle !== undefined) return relation.lineStyle
  const markers = classRelationMarkers(relation)
  const from = markers.from && RELATION_SYNTAX[markers.from]
  const to = markers.to && RELATION_SYNTAX[markers.to]
  const dashed = from?.shaft === '..' || to?.shaft === '..' || (!from && !to && RELATION_SYNTAX[relation.kind].shaft === '..')
  return dashed ? 'dashed' : 'solid'
}

function arrowForRelation(relation: ClassRelation): string {
  const markers = classRelationMarkers(relation)
  const from = markers.from && RELATION_SYNTAX[markers.from]
  const to = markers.to && RELATION_SYNTAX[markers.to]
  return `${from?.from ?? ''}${classRelationLineStyle(relation) === 'dashed' ? '..' : '--'}${to?.to ?? ''}`
}

function quoteIfNeeded(id: string): string {
  // Mermaid reads `call` before a blank as a callback where a statement starts.
  if (/^[\w$]+$/.test(id) && id !== 'call' && supportedRelationEndpoint(id, id)) {
    const relation = `${id} -- __endpoint`
    const statements = readClassStatements([id, relation]).statements
    if (parseAccessibilityDirective([relation], 0) === null && statements[0]?.value.kind !== 'header' && statements[1]?.value.kind === 'relationship') return id
  }
  return `\`${id}\``
}

function quoteDirectiveTarget(id: string): string {
  return /^[\w$]+$/.test(id) ? id : `\`${id}\``
}

/** The writer quotes each non-identifier path atom separately. At the first
 * content character, Mermaid's wildcard ~ rule precedes bqstring content;
 * otherwise [^`]+ consumes the whole atom, including any later tildes. */
function namespaceStartsGeneric(segments: readonly string[]): boolean {
  return segments.some(segment => quoteDirectiveTarget(segment).startsWith('`~'))
}

/** Emit one class declaration (+ optional member block) at an indent depth. */
function pushClassLines(lines: string[], c: ClassNode, indent: string, deferredMembers: string[]): void {
  if (c.isInterface) return
  const head = `class ${quoteIfNeeded(c.id)}${c.generic ? `~${c.generic}~` : ''}${c.label ? `["${writeClassText(c.label, c.labelContent)}"]` : ''}`
  if (c.members.length === 0) {
    lines.push(`${indent}${head}`)
  } else if (c.members.some(member => /[{}]/.test(member))) {
    // Inline members consume braces as text; a class block treats them as
    // structure. Inline syntax cannot represent every block member (including
    // colons and annotations). Defer ordered runs until namespaces close;
    // reopening the existing class keeps its identity and namespace claim.
    lines.push(`${indent}${head}`)
    let block: string[] = []
    const flushBlock = (): void => {
      if (block.length === 0) return
      deferredMembers.push(`  class ${quoteIfNeeded(c.id)} {`, ...block.map(member => `    ${member}`), '  }')
      block = []
    }
    for (const member of c.members) {
      if (/[{}]/.test(member)) {
        flushBlock()
        deferredMembers.push(`  ${quoteIfNeeded(c.id)} : ${member}`)
      } else block.push(member)
    }
    flushBlock()
  } else {
    lines.push(`${indent}${head} {`)
    for (const m of c.members) lines.push(`${indent}  ${m}`)
    lines.push(`${indent}}`)
  }
}

/** `writeTitle` false when the title is written as the frontmatter `title:`,
 * the only title Mermaid's Class grammar reads. */
export function renderClass(body: ClassBody, writeTitle = true): string {
  const problem = classBodyWriteProblem(body)
  if (problem) throw new Error(problem)
  const lines: string[] = ['classDiagram']
  const deferredMembers: string[] = []
  if (body.title && writeTitle) lines.push(`  title ${body.title}`)
  // Dot paths imply unlabeled parents. A labeled parent without direct
  // classes must wrap its descendants: an empty standalone block is invalid.
  const namespaces = body.namespaces ?? []
  const registryPaths = namespaces.map(n => n.name)
  // A dotted child may be authored before its parent. Visit wrapping parents
  // first so moving descendants into a nested frame removes no earlier entry.
  const parentFirst: ClassNamespaceDecl[] = []
  for (const namespace of namespaces) {
    const wrapsDescendants = namespace.label !== undefined && !body.classes.some(node => node.namespace === namespace.name)
    const descendant = wrapsDescendants ? parentFirst.findIndex(candidate => candidate.name.startsWith(`${namespace.name}.`)) : -1
    if (descendant < 0) parentFirst.push(namespace)
    else parentFirst.splice(descendant, 0, namespace)
  }
  const frames = [{ entries: parentFirst, index: 0, prefix: '', depth: 1, closes: 0 }]
  while (frames.length > 0) {
    const frame = frames.at(-1)!
    if (frame.index === frame.entries.length) {
      for (let index = frame.closes; index > 0; index--) lines.push(`${'  '.repeat(frame.depth - frame.closes + index - 1)}}`)
      frames.pop()
      continue
    }
    const ns = frame.entries[frame.index++]!
    const members = body.classes.filter(c => c.namespace === ns.name)
    if (members.length === 0 && ns.label === undefined && registryPaths.some(path => path.startsWith(`${ns.name}.`))) continue
    const descendants = members.length === 0 && ns.label !== undefined ? frame.entries.filter(candidate => candidate.name.startsWith(`${ns.name}.`)) : []
    const relativePath = ns.name.slice(frame.prefix.length)
    const segments = relativePath.split('.')
    const levels = segments.every(segment => /^[\w$]+$/.test(segment)) ? 1 : segments.length
    if (segments.every(segment => /^[\w$]+$/.test(segment))) {
      lines.push(`${'  '.repeat(frame.depth)}namespace ${relativePath}${ns.label !== undefined ? `["${writeClassText(ns.label, ns.labelContent)}"]` : ''} {`)
    } else {
      // Preserve each path atom: quoting the entire dotted path would turn a
      // nested namespace into one flat name.
      segments.forEach((segment, index) => {
        const label = index === segments.length - 1 && ns.label !== undefined ? `["${writeClassText(ns.label, ns.labelContent)}"]` : ''
        lines.push(`${'  '.repeat(frame.depth + index)}namespace ${quoteDirectiveTarget(segment)}${label} {`)
      })
    }
    for (const c of members) pushClassLines(lines, c, '  '.repeat(frame.depth + levels), deferredMembers)
    if (members.length === 0 && descendants.length > 0) {
      frame.entries = frame.entries.filter(candidate => !candidate.name.startsWith(`${ns.name}.`))
      frames.push({ entries: descendants, index: 0, prefix: `${ns.name}.`, depth: frame.depth + levels, closes: levels })
    } else {
      for (let index = levels; index > 0; index--) lines.push(`${'  '.repeat(frame.depth + index - 1)}}`)
    }
  }
  // Classes claimed by a namespace the registry doesn't know (possible only
  // through hand-built bodies) fall back to top level rather than vanishing.
  const known = new Set(registryPaths)
  for (const c of body.classes) {
    if (c.namespace !== undefined && known.has(c.namespace)) continue
    pushClassLines(lines, c, '  ', deferredMembers)
  }
  lines.push(...deferredMembers)
  // Notes can introduce a class on read. Emit them after declarations so a
  // reload cannot move their target ahead of the authored class identities.
  for (const n of body.notes) {
    const text = n.textContent || /#\w+;/.test(n.text)
      ? writeClassText(n.text, n.textContent, '"&\\')
      : n.text.replace(/&/g, '&amp;').replace(/\\/g, '&#92;').replace(/"/g, '&quot;').replace(/%%\{/g, '%%#123;')
    if (n.for) lines.push(`  note for ${quoteIfNeeded(n.for)} "${text}"`)
    else lines.push(`  note "${text}"`)
  }
  const classById = new Map(body.classes.map(node => [node.id, node]))
  const endpoint = (id: string): string => {
    const node = classById.get(id)
    if (!node?.isInterface) return quoteIfNeeded(id)
    const label = node.label ?? id,
      suffix = node.generic ? `~${node.generic}~` : ''
    return quoteIfNeeded(suffix && label.endsWith(suffix) ? label.slice(0, -suffix.length) : label) + suffix
  }
  for (const r of body.relations) {
    const from = endpoint(r.from),
      to = endpoint(r.to)
    const arrow = arrowForRelation(r)
    const left = r.fromCardinality ? `${from} "${writeClassText(r.fromCardinality, r.fromCardinalityContent)}"` : from
    const right = r.toCardinality ? `"${writeClassText(r.toCardinality, r.toCardinalityContent)}" ${to}` : to
    const label = r.label ? ` : ${writeClassText(r.label, r.labelContent, ':;"')}` : ''
    lines.push(`  ${left} ${arrow} ${right}${label}`)
  }
  for (const c of body.classes) {
    // Mermaid reads `class A c` as a class named `Ac`; its cssClass names
    // the class by its id as written.
    if (c.className) {
      for (const name of c.className.split(/\s+/).filter(Boolean)) {
        lines.push(/[",]/.test(c.id) || !writableStyleClassName(name, true) ? `  class ${quoteIfNeeded(c.id)}:::${name}` : `  cssClass "${c.id}" ${name}`)
      }
    }
  }
  // The pinned Class DB copies definitions onto members only when it reads
  // classDef. Membership must already exist, and inline overrides come last.
  for (const [name, style] of Object.entries(body.classDefs ?? {})) lines.push(classStyleStatement(`  classDef ${name} `, style, ownStyleDeclarations(body.classDefDeclarations, name)))
  for (const c of body.classes) {
    if (c.style) lines.push(classStyleStatement(`  style ${quoteDirectiveTarget(c.id)} `, c.style, c.styleDeclarations))
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
      id: c.id,
      label: c.label,
      generic: c.generic,
      members: [...c.members],
      namespace: c.namespace,
      ...(c.isInterface ? { isInterface: true } : {}),
      ...(c.labelContent ? { labelContent: c.labelContent } : {}),
      ...(c.className ? { className: c.className } : {}),
      ...(c.style ? { style: { ...c.style } } : {}),
      ...(c.styleDeclarations ? { styleDeclarations: c.styleDeclarations.map(([key, value]) => [key, value] as StyleDeclaration) } : {}),
      ...(c.href ? { href: c.href } : {}),
      ...(c.tooltip !== undefined ? { tooltip: c.tooltip } : {}),
    })),
    ...(body.classDefDeclarations ? { classDefDeclarations: structuredClone(body.classDefDeclarations) } : {}),
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

/** An id the writer can spell: Mermaid's class lexer reads some words as
 *  keywords even in backticks, so no class can be named so. */
function validateClassId(id: string): MutationError | undefined {
  if (id.startsWith('"')) return { code: 'INVALID_OP', message: `Class id ${JSON.stringify(id)} starts with a double quote and has no supported lossless Mermaid spelling` }
  if (readsAsClassName(id, true, false)) return undefined
  return { code: 'INVALID_OP', message: `Class id "${id}" is a keyword to Mermaid's class lexer, which reads \`${id}\` as a keyword even in backticks; choose another id` }
}

function validateClassMembers(members: readonly string[]): MutationError | undefined {
  for (const member of members) {
    const decoded = typeof member === 'string' ? decodeXML(member) : undefined
    if (decoded === undefined || /[\r\n]/.test(decoded)) {
      return { code: 'INVALID_OP', message: 'Class members must be single lines; add each member separately' }
    }
    const problem = classMemberWriteProblem(member)
    if (problem) return { code: 'INVALID_OP', message: problem }
    if (toMermaidLines(decoded).length !== 1) {
      return { code: 'INVALID_OP', message: 'Class members must contain text, not blank lines, comments or init directives' }
    }
    if (parseAccessibilityDirective([decoded], 0) !== null) {
      return { code: 'INVALID_OP', message: 'Class members cannot be accessibility directives' }
    }
    if (new RegExp(MERMAID_DIRECTIVE_RE.source, 'i').test(decoded)) {
      return { code: 'INVALID_OP', message: 'Class members cannot hold a %%{…}%% directive, which Mermaid removes from the source' }
    }
    // Mermaid's class database reads a member with a `)` after its first
    // character as a method and fails on one its method pattern cannot split.
    const trimmed = decoded.trim()
    if (!(trimmed.startsWith('<<') && trimmed.endsWith('>>')) && trimmed.indexOf(')') > 0 && !/([#+~-])?(.+)\((.*)\)([\s$*])?(.*)([$*])?/.test(decoded)) {
      return { code: 'INVALID_OP', message: `Class member ${JSON.stringify(member)} holds \`)\` without a method name and \`(\` before it, which Mermaid 12.2.0's class database fails on` }
    }
    // A brace keeps a member out of a class block, and Mermaid's inline
    // `Class : member` text (`:[^:\n;]+`) ends at a colon or semicolon.
    if (/[{}]/.test(member) && /[:;]/.test(member)) {
      return { code: 'INVALID_OP', message: `Class member ${JSON.stringify(member)} holds a brace, which only the inline \`Class : member\` form carries, and a colon or semicolon, which ends that form in Mermaid 12.2.0; no spelling holds both` }
    }
  }
}

function validateClassRelation(relation: ClassRelation): MutationError | undefined {
  const invalid: MutationError = { code: 'INVALID_OP', message: 'Class relation kind, marker endpoints and line style must describe the same Mermaid arrow' }
  if (
    !Object.hasOwn(RELATION_SYNTAX, relation.kind) ||
    (relation.fromKind !== undefined && !Object.hasOwn(RELATION_SYNTAX, relation.fromKind)) ||
    (relation.toKind !== undefined && !Object.hasOwn(RELATION_SYNTAX, relation.toKind)) ||
    (relation.markerAt !== undefined && !['from', 'to', 'both', 'none'].includes(relation.markerAt)) ||
    (relation.lineStyle !== undefined && relation.lineStyle !== 'solid' && relation.lineStyle !== 'dashed')
  )
    return invalid
  const markers = classRelationMarkers(relation)
  if ((relation.fromKind !== undefined && markers.from === undefined) || (relation.toKind !== undefined && markers.to === undefined)) return invalid
  const reloaded = parseClassRelationSyntax(`A ${arrowForRelation(relation)} B`)
  if (!reloaded) return invalid
  const reloadedMarkers = classRelationMarkers(reloaded)
  if (reloaded.kind !== relation.kind || reloadedMarkers.at !== markers.at || reloadedMarkers.from !== markers.from || reloadedMarkers.to !== markers.to || classRelationLineStyle(reloaded) !== classRelationLineStyle(relation)) return invalid
}

function declareNamespaceOn(b: ClassBody, path: string): void {
  if (!b.namespaces) b.namespaces = []
  if (!b.namespaces.some(n => n.name === path)) b.namespaces.push({ name: path })
}

export function mutateClass(body: ClassBody, op: ClassMutationOp): Result<ClassBody, MutationError> {
  const problem = classBodyWriteProblem(body)
  if (problem) return err({ code: 'INVALID_OP', message: problem })
  const targetId = 'class' in op ? op.class : op.kind === 'rename_class' ? op.from : op.kind === 'add_note' ? op.for : undefined
  if (targetId && body.classes.some(node => node.id === targetId && node.isInterface)) {
    return err({ code: 'INVALID_OP', message: `A lollipop interface occurrence has no standalone class declaration; '${op.kind}' cannot add class-only metadata to '${targetId}'` })
  }
  const result = mutateClassBody(body, op)
  if (!result.ok) return result
  const next = result.value
  if (op.kind === 'add_interface' || !body.classes.some(node => node.isInterface)) return result
  const referenced = new Set(next.relations.flatMap(relation => [relation.from, relation.to]))
  next.classes = next.classes.filter(node => !node.isInterface || referenced.has(node.id))
  // Interface IDs are occurrence identities. Rebuild from the exact canonical
  // relation order after removal/addition, retaining authored labels and boxes.
  const canonical = parseClassBody(renderClass(next).trimEnd().split('\n').slice(1))
  return canonical ? ok(canonical) : err({ code: 'INVALID_OP', message: 'Class edit could not retain its lollipop interface occurrences in Mermaid source' })
}

interface ClassSourceMember {
  node: ClassStatementNode
  text?: string
  field?: 'attributes' | 'methods'
  index: number
}

/** Address the authored member sequence, including annotations, before
 * projecting its interleaved members into the native attribute/method lists. */
function classMemberSourceEdit(source: string, id: string, index: number, target: ReturnType<typeof parseClassDiagram>['classes'][number]): Result<{ edit: SourceEdit; field: 'attributes' | 'methods'; index: number }, MutationError> {
  const refuse = (): Result<never, MutationError> => err({ code: 'INVALID_OP', message: 'Member removal requires an unambiguous authored member owning one complete physical line without comments or directives' })
  const payload = preservedMermaidFamilySource(normalizeMermaidSource(source), 'authored')
  if (payload.text.includes('\r')) return refuse()
  const lines = payload.text.split('\n'), scanned = scanAccessibilityDirectives(lines, classStatementEnds(lines))
  const tree = readClassStatements(scanned.familyLines, undefined, false)
  if (scanned.unclosedIndex !== undefined || tree.diagnostics.length) return refuse()
  const members: ClassSourceMember[] = [], counts = { attributes: 0, methods: 0 }
  const add = (node: ClassStatementNode, text?: string): void => {
    if (text === undefined) { members.push({ node, index: -1 }); return }
    const parsed = parseClassMember(decodeXML(text))
    if (!parsed) { members.push({ node, text, index: -1 }); return }
    const field = parsed.isMethod ? 'methods' : 'attributes'
    members.push({ node, text, field, index: counts[field]++ })
  }
  const frames: Array<{ nodes: readonly ClassStatementNode[]; owner?: string; index: number }> = [{ nodes: tree.statements, index: 0 }]
  while (frames.length) {
    const frame = frames.at(-1)!
    if (frame.index === frame.nodes.length) { frames.pop(); continue }
    const node = frame.nodes[frame.index++]!, value = node.value
    if (value.kind === 'class') {
      if (value.declaration.id === id && value.declaration.annotation !== undefined) add(node)
      if (node.children) frames.push({ nodes: node.children, owner: value.declaration.id, index: 0 })
    } else if (value.kind === 'namespace') frames.push({ nodes: node.children!, index: 0 })
    else if (value.kind === 'member' && (value.reference?.id ?? frame.owner) === id) add(node, value.text)
    else if (value.kind === 'body-annotation' && frame.owner === id || value.kind === 'annotation' && value.annotation.id === id) add(node)
  }
  if (!Number.isInteger(index) || index < 0 || index >= members.length) return err({ code: 'MEMBER_NOT_FOUND', message: `member index ${index} out of range` })
  if (counts.attributes !== target.attributes.length || counts.methods !== target.methods.length
    || members.some(member => member.field && !sameSourceMeaning(parseClassMember(decodeXML(member.text!))?.member, target[member.field][member.index]))) return refuse()
  const selected = members[index]!, field = selected.field
  if (!field) return refuse()
  const rowIndex = selected.node.source.line - 1, row = scanned.familyLines[rowIndex]!
  const familyStarts = sourceLineStarts(scanned.familyLines.join('\n'))
  if (selected.node.source.end !== familyStarts[rowIndex]! + row.length || selected.node.raw.trim() !== row.trim() || selected.node.text !== row.trim()) return refuse()
  const payloadRow = scanned.familyOrigins[rowIndex]!, payloadStart = sourceLineStarts(payload.text)[payloadRow]!
  const start = payload.sourceOffset(payloadStart, 'end'), end = payload.sourceOffset(payloadStart + lines[payloadRow]!.length, 'start')
  const authoredStarts = sourceLineStarts(source), authoredRow = sourcePointAt(authoredStarts, start).line - 1
  const lineStart = authoredStarts[authoredRow]!, lineEnd = authoredStarts[authoredRow + 1] ?? source.length
  const content = source.slice(lineStart, lineEnd).replace(/\r\n$|[\r\n]$/, '')
  if (start !== lineStart || end !== lineStart + content.length || decodeXML(content).includes('%%')) return refuse()
  return ok({ edit: { start: lineStart, end: lineEnd, text: '' }, field, index: selected.index })
}

/** Edit owned member source while retaining every unrelated native field. */
export function mutateClassSource(source: string, op: ClassMutationOp): Result<readonly SourceEdit[], MutationError> {
  if (op.kind !== 'add_member' && op.kind !== 'remove_member') return err({ code: 'INVALID_OP', message: 'Source-preserving Class edits support add_member and owned whole-line remove_member only' })
  const read = (text: string) => {
    const normalized = normalizeMermaidSource(text, {}, 'render')
    // Without a distinct authored grammar, the native reader already uses
    // each semantic statement as its own quote provenance.
    return withFrontmatterTitle(withAccessibilityFields(parseClassDiagram(normalized.familyLines, normalized.authoredFamilyLines), normalized.accessibility), normalized.frontmatter)
  }
  try {
    const before = read(source), target = before.classes.find(node => node.id === op.class)
    if (!target) return err({ code: 'CLASS_NOT_FOUND', message: `class ${op.class} not found` })
    if (target.isInterface) return err({ code: 'INVALID_OP', message: 'An interface occurrence has no class member compartment' })
    let edits: readonly SourceEdit[], expected = before
    if (op.kind === 'add_member') {
      const invalid = validateClassMembers([op.text])
      if (invalid) return err(invalid)
      const member = parseClassMember(op.text)
      if (parseClassBodyAnnotationToken(op.text.trim()) !== null || !member?.member.name.trim()) return err({ code: 'INVALID_OP', message: 'Source-preserving add_member requires an attribute or method, not an annotation or empty member' })
      const field = member.isMethod ? 'methods' : 'attributes'
      expected = { ...before, classes: before.classes.map(node => node === target ? { ...node, [field]: [...node[field], member.member] } : node) }
      // Reopening retains the original namespace claim; `ID : member` cannot
      // address every quoted identity (notably IPC::Sender).
      edits = appendSourceStatement(source, `class ${quoteIfNeeded(target.id)} {\n  ${op.text}\n}`)
    } else {
      const removal = classMemberSourceEdit(source, op.class, op.index, target)
      if (!removal.ok) return removal
      const { field, index, edit } = removal.value
      expected = { ...before, classes: before.classes.map(node => node === target ? { ...node, [field]: node[field].filter((_, at) => at !== index) } : node) }
      edits = [edit]
    }
    const candidate = applySourceEdits(source, edits)
    if (!sameSourceMeaning(read(candidate), expected)) return err({ code: 'INVALID_OP', message: 'The source edit would change Class meaning beyond the requested member' })
    return ok(edits)
  } catch (error) {
    return err({ code: 'INVALID_OP', message: error instanceof Error ? error.message : String(error) })
  }
}

function mutateClassBody(body: ClassBody, op: ClassMutationOp): Result<ClassBody, MutationError> {
  const b = cloneClass(body)
  const findClass = (id: string) => b.classes.find(c => c.id === id)

  switch (op.kind) {
    case 'set_title': {
      b.title = op.title ?? undefined
      return ok(b)
    }
    case 'add_class': {
      if (findClass(op.id)) return err({ code: 'DUPLICATE_CLASS', message: `class ${op.id} already exists` })
      const invalidId = validateClassId(op.id)
      if (invalidId) return err(invalidId)
      if (op.label === '') return err({ code: 'INVALID_OP', message: 'An explicitly empty Class label has no lossless Mermaid spelling' })
      const invalidMembers = validateClassMembers(op.members ?? [])
      if (invalidMembers) return err(invalidMembers)
      if (op.namespace !== undefined && !NAMESPACE_PATH_RE.test(op.namespace)) {
        return err({ code: 'INVALID_OP', message: `invalid namespace path "${op.namespace}" — expected dot-joined identifier segments like "Platform.Auth"` })
      }
      let generic: string | undefined
      if (op.generic !== undefined) {
        const parsed = normalizeGeneric(op.generic)
        if (!parsed.ok) return parsed
        generic = parsed.value
      }
      b.classes.push({ id: op.id, label: op.label, generic, members: [...(op.members ?? [])], namespace: op.namespace })
      if (op.namespace !== undefined) declareNamespaceOn(b, op.namespace)
      return ok(b)
    }
    case 'set_class_namespace': {
      const c = findClass(op.class)
      if (!c) return err({ code: 'CLASS_NOT_FOUND', message: `class ${op.class} not found` })
      if (op.namespace === null) {
        c.namespace = undefined
        return pruneEmptyNamespaces(b)
      }
      if (!NAMESPACE_PATH_RE.test(op.namespace)) {
        return err({ code: 'INVALID_OP', message: `invalid namespace path "${op.namespace}" — expected dot-joined identifier segments like "Platform.Auth"` })
      }
      c.namespace = op.namespace
      declareNamespaceOn(b, op.namespace)
      return pruneEmptyNamespaces(b)
    }
    case 'define_class': {
      if (typeof op.name !== 'string' || !writableStyleClassName(op.name, true)) return err({ code: 'INVALID_OP', message: 'classDef name must be one non-reserved word token' })
      const style = parseMutableStyleProps(op.style)
      if (!style.ok)
        return err({
          code: 'INVALID_OP',
          message: style.reason === 'MULTILINE' ? 'classDef style must be a single-line CSS-like property list' : style.reason === 'UNSAFE_PAINT' ? unsafeStylePaintError(`define_class ${op.name}`, style.paint).message : 'classDef style must contain at least one property:value pair',
        })
      if (!b.classDefs) b.classDefs = {}
      const declarations = retainedStyleDeclarations(parseStyleDeclarations(op.style))
      const portable = portableClassStyleProps(style.value, declarations)
      if (!portable) return err({ code: 'INVALID_OP', message: 'Class style has no supported lossless Mermaid property/value spelling' })
      setOwn(b.classDefs, op.name, portable)
      if (declarations) { b.classDefDeclarations ??= {}; setOwn(b.classDefDeclarations, op.name, declarations) }
      else if (b.classDefDeclarations) { delete b.classDefDeclarations[op.name]; if (!Object.keys(b.classDefDeclarations).length) delete b.classDefDeclarations }
      return ok(b)
    }
    case 'set_css_class': {
      const c = findClass(op.class)
      if (!c) return err({ code: 'CLASS_NOT_FOUND', message: `class ${op.class} not found` })
      if (op.className === null) delete c.className
      else {
        if (!writableStyleClassName(op.className)) return err({ code: 'INVALID_OP', message: 'CSS class name must have a lossless Mermaid style reference spelling' })
        c.className = op.className
      }
      return ok(b)
    }
    case 'set_class_style': {
      const c = findClass(op.class)
      if (!c) return err({ code: 'CLASS_NOT_FOUND', message: `class ${op.class} not found` })
      if (op.style === null) { delete c.style; delete c.styleDeclarations }
      else {
        if (!writableInlineStyleTarget(c.id)) return err({ code: 'INVALID_OP', message: `Class inline style target ${JSON.stringify(c.id)} is not an ALPHA identifier in Mermaid's style grammar` })
        const style = parseMutableStyleProps(op.style)
        if (!style.ok)
          return err({
            code: 'INVALID_OP',
            message: style.reason === 'MULTILINE' ? 'Class style must be a single-line CSS-like property list' : style.reason === 'UNSAFE_PAINT' ? unsafeStylePaintError(`set_class_style ${op.class}`, style.paint).message : 'Class style must contain at least one property:value pair',
          })
        const declarations = retainedStyleDeclarations(parseStyleDeclarations(op.style))
        const portable = portableClassStyleProps(style.value, declarations)
        if (!portable) return err({ code: 'INVALID_OP', message: 'Class style has no supported lossless Mermaid property/value spelling' })
        c.style = portable
        if (declarations) c.styleDeclarations = declarations
        else delete c.styleDeclarations
      }
      return ok(b)
    }
    case 'remove_class': {
      const i = b.classes.findIndex(c => c.id === op.id)
      if (i < 0) return err({ code: 'CLASS_NOT_FOUND', message: `class ${op.id} not found` })
      b.classes.splice(i, 1)
      b.relations = b.relations.filter(r => r.from !== op.id && r.to !== op.id)
      b.notes = b.notes.filter(n => n.for !== op.id)
      return pruneEmptyNamespaces(b)
    }
    case 'rename_class': {
      const c = findClass(op.from)
      if (!c) return err({ code: 'CLASS_NOT_FOUND', message: `class ${op.from} not found` })
      if (findClass(op.to)) return err({ code: 'DUPLICATE_CLASS', message: `class ${op.to} already exists` })
      const invalidId = validateClassId(op.to)
      if (invalidId) return err(invalidId)
      if (c.style && !writableInlineStyleTarget(op.to)) return err({ code: 'INVALID_OP', message: `Class inline style target ${JSON.stringify(op.to)} is not an ALPHA identifier in Mermaid's style grammar` })
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
      const invalidMembers = validateClassMembers([op.text])
      if (invalidMembers) return err(invalidMembers)
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
    case 'add_interface': {
      const target = findClass(op.class)
      if (!target) return err({ code: 'CLASS_NOT_FOUND', message: `class ${op.class} not found` })
      if (target.isInterface) return err({ code: 'INVALID_OP', message: 'add_interface needs an ordinary class, not another interface occurrence' })
      if (typeof op.label !== 'string' || !op.label.trim() || /[\r\n`]|^\s*"/.test(op.label) || (op.side !== undefined && op.side !== 'from' && op.side !== 'to')) {
        return err({ code: 'INVALID_OP', message: 'Interface label must be a non-empty portable single-line name without backticks or a leading double quote; side must be from or to' })
      }
      if ((op.lineStyle !== undefined && op.lineStyle !== 'solid' && op.lineStyle !== 'dashed') || (op.relationLabel !== undefined && (typeof op.relationLabel !== 'string' || !op.relationLabel.trim() || /[\r\n]/.test(op.relationLabel)))) {
        return err({ code: 'INVALID_OP', message: 'Interface relationLabel must be a non-empty single line; lineStyle must be solid or dashed' })
      }
      const side = op.side ?? 'to',
        shaft = op.lineStyle === 'dashed' ? '..' : '--'
      const endpoints = side === 'from' ? `${quoteIfNeeded(op.label)} ()${shaft} ${quoteIfNeeded(target.id)}` : `${quoteIfNeeded(target.id)} ${shaft}() ${quoteIfNeeded(op.label)}`
      const statement = endpoints + (op.relationLabel !== undefined ? ` : ${writeClassText(op.relationLabel, undefined, ':;"')}` : '')
      const syntax = parseClassRelationship(statement)
      if (!syntax || syntax[side] !== op.label || (side === 'from' ? syntax.fromGeneric : syntax.toGeneric) || (op.relationLabel !== undefined && syntax.label !== op.relationLabel)) {
        return err({ code: 'INVALID_OP', message: 'Interface label cannot be represented as an exact pinned Mermaid endpoint name' })
      }
      const parsed = parseClassBody((renderClass(b).trimEnd() + `\n  ${statement}`).split('\n').slice(1))
      if (!parsed || parsed.classes.filter(node => node.isInterface).length !== b.classes.filter(node => node.isInterface).length + 1) {
        return err({ code: 'INVALID_OP', message: 'add_interface could not retain the new interface occurrence in Mermaid source' })
      }
      return ok(parsed)
    }
    case 'add_relation': {
      if (!findClass(op.from)) return err({ code: 'CLASS_NOT_FOUND', message: `class ${op.from} not found` })
      if (!findClass(op.to)) return err({ code: 'CLASS_NOT_FOUND', message: `class ${op.to} not found` })
      const relation: ClassRelation = {
        from: op.from,
        to: op.to,
        kind: op.relKind,
        label: op.label,
        ...(op.markerAt !== undefined ? { markerAt: op.markerAt } : {}),
        ...(op.fromKind !== undefined ? { fromKind: op.fromKind } : {}),
        ...(op.toKind !== undefined ? { toKind: op.toKind } : {}),
        ...(op.lineStyle !== undefined ? { lineStyle: op.lineStyle } : {}),
      }
      const invalidRelation = validateClassRelation(relation)
      if (invalidRelation) return err(invalidRelation)
      const markers = classRelationMarkers(relation)
      if ((markers.at === 'from' && markers.from === 'lollipop') || (markers.at === 'to' && markers.to === 'lollipop') || findClass(op.from)?.isInterface || findClass(op.to)?.isInterface) {
        return err({ code: 'INVALID_OP', message: 'A lone lollipop creates a distinct interface occurrence and cannot share an existing class endpoint; use add_interface with class, label and optional side' })
      }
      b.relations.push(relation)
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

/** Class source ours reads where pinned Mermaid rejects it, each on its
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
      message: 'A "classDiagram" header with no statement after it draws an empty class diagram. Pinned Mermaid rejects this; add a class, relationship, note or other statement.',
    })
  }
  for (const { index, what } of classCommentRejections(bodyLines)) {
    warnings.push({
      code: 'UNSUPPORTED_SYNTAX',
      syntax: 'class_trailing_comment',
      line: header + 2 + index,
      message: `${what}. Pinned Mermaid rejects this; put the comment on a line of its own.`,
    })
  }
  // The classes a statement declares as Mermaid reads it, which a cssClass
  // can style only after them.
  const declares = (value: ClassStatementNode['value']): string[] =>
    value.kind === 'class' ? [value.declaration.id] : value.kind === 'annotation' ? [value.annotation.id] : value.kind === 'member' && value.reference ? [value.reference.id] : value.kind === 'relationship' ? [value.relationship.from, value.relationship.to] : []
  const declaredAnywhere = new Set<string>()
  const collect = (nodes: readonly ClassStatementNode[]): void => {
    for (const node of nodes) {
      for (const id of declares(node.value)) declaredAnywhere.add(id)
      collect(node.children ?? [])
    }
  }
  const extensionWarnings = (nodes: ClassStatementNode[]): void => {
    collect(nodes)
    const declaredSoFar = new Set<string>()
    const pending = [...nodes].reverse()
    const semicolonLines = new Set<number>()
    while (pending.length) {
      const node = pending.pop()!
      if (node.followsNamespaceCloseOnSameLine && node.value.kind === 'trivia' && node.raw.startsWith('%%'))
        warnings.push({
          code: 'UNSUPPORTED_SYNTAX',
          syntax: 'class_trailing_comment',
          line: header + 1 + node.source.line,
          message: 'A %% comment after a namespace closing brace is read as a comment. Pinned Mermaid rejects this; put the comment on a line of its own.',
        })
      else if (node.followsNamespaceCloseOnSameLine && node.value.kind !== 'trivia' && node.value.kind !== 'close')
        warnings.push({
          code: 'UNSUPPORTED_SYNTAX',
          syntax: 'class_statement_after_namespace_close',
          line: header + 1 + node.source.line,
          message: 'A Class statement after a namespace closing brace on the same line is read as a separate statement. Pinned Mermaid rejects this, even with a semicolon; put the statement on a new line.',
        })
      else if (node.followsClassCloseOnSameLine)
        warnings.push({
          code: 'UNSUPPORTED_SYNTAX',
          syntax: 'class_statement_after_class_close',
          line: header + 1 + node.source.line,
          message: "A Class statement after a class body's closing brace on the same line is read as a separate statement. Pinned Mermaid rejects this; put the statement on a new line.",
        })
      if (node.compactSemicolon && !semicolonLines.has(node.source.line)) {
        semicolonLines.add(node.source.line)
        warnings.push({
          code: 'UNSUPPORTED_SYNTAX',
          syntax: 'class_compact_semicolon_statement_extension',
          line: header + 1 + node.source.line,
          message: 'Semicolon-separated statements inside a compact Class namespace are read as separate statements. Pinned Mermaid rejects this source; put each statement on its own line.',
        })
      }
      const value = node.value
      if (value.kind === 'title') warnings.push({
        code: 'UNSUPPORTED_SYNTAX', syntax: 'class_title', line: header + 1 + node.source.line,
        message: 'A Class `title` statement is read as the diagram title. Pinned Mermaid\'s Class grammar has no title statement: it ignores the line, or rejects it when the title holds punctuation such as `(` or `!`. The writer writes the title as the frontmatter `title:`, which Mermaid draws.',
      })
      if (value.kind === 'class' && value.declaration.label === '' || value.kind === 'namespace' && value.label === '') warnings.push({
        code: 'UNSUPPORTED_SYNTAX', syntax: 'class_empty_label', line: header + 1 + node.source.line,
        message: 'An explicitly empty Class label is retained for native rendering. Pinned Mermaid requires nonempty label text, so typed editing is unavailable rather than replacing the label with its identity.',
      })
      if (value.kind === 'namespace' && namespaceStartsGeneric(value.path)) warnings.push({
        code: 'UNSUPPORTED_SYNTAX', syntax: 'class_namespace_generic', line: header + 1 + node.source.line,
        message: 'A leading tilde in a Class namespace path segment opens Mermaid generic syntax even inside backticks. Entity codes change the identity; source and native rendering are preserved without typed editing.',
      })
      if (value.kind === 'style') for (const reference of value.references) if (!writableInlineStyleTarget(reference.id)) warnings.push({
        code: 'UNSUPPORTED_SYNTAX', syntax: 'class_style_target', line: header + 1 + node.source.line,
        message: `Class inline style target ${JSON.stringify(reference.id)} is outside Mermaid's ALPHA production; quoting does not extend it. Source is preserved; use an explicit named CSS class for this identity.`,
      })
      if ((value.kind === 'classDef' || value.kind === 'style') && classLikeStyleHasValueCommas(node.text)) warnings.push({
        code: 'UNSUPPORTED_SYNTAX', syntax: 'class_style_commas', line: header + 1 + node.source.line,
        message: portableClassLikeStyleProps(value.props)
          ? 'Native CSS commas remain inside their property values. Pinned Mermaid splits raw commas into separate styles; the writer protects value delimiters with entity codes.'
          : 'This style contains text outside the supported SVG attribute domain. Source is preserved, but typed editing is unavailable.',
      })
      const identities = declares(value).concat(value.kind === 'interaction' ? [value.interaction.id] : value.kind === 'note' && value.reference ? [value.reference.id] : [])
      if (identities.some(hasClassDirectionToken) || value.kind === 'namespace' && hasClassDirectionToken(value.path.join('.'))) warnings.push({
        code: 'UNSUPPORTED_SYNTAX', syntax: 'class_direction_identity', line: header + 1 + node.source.line,
        message: 'A greedy Mermaid direction token consumes this identity even inside backticks. Native reading and source are retained; typed editing is unavailable.',
      })
      for (const id of identities) if (id.startsWith('"')) warnings.push({
        code: 'UNSUPPORTED_SYNTAX', syntax: 'class_id', line: header + 1 + node.source.line,
        message: `Class id ${JSON.stringify(id)} starts with a double quote, which pinned Mermaid treats as syntax even inside backticks. Its source and native rendering are preserved, but typed editing is unavailable.`,
      })
      const styleNames = value.kind === 'classDef' ? value.names
        : value.kind === 'assignment' ? [value.name]
          : value.kind === 'class' ? [value.declaration.className]
            : value.kind === 'annotation' ? [value.annotation.className] : []
      for (const name of styleNames) if (name !== undefined && !writableStyleClassName(name, value.kind === 'classDef')) warnings.push({
        code: 'UNSUPPORTED_SYNTAX', syntax: 'class_style_name', line: header + 1 + node.source.line,
        message: `Class style ${value.kind === 'classDef' ? 'definition' : 'reference'} ${JSON.stringify(name)} has no supported lossless Mermaid spelling. The source and native rendering are preserved, but typed editing is unavailable.`,
      })
      if (value.kind === 'annotation' ? value.annotation.placement === 'inline' && value.annotation.className !== undefined : value.kind === 'class' && value.declaration.annotation !== undefined && value.declaration.className !== undefined)
        warnings.push({
          code: 'UNSUPPORTED_SYNTAX',
          syntax: 'class_style_before_annotation',
          line: header + 1 + node.source.line,
          message: "A :::style class before an inline <<annotation>> is read as the class's style class. Pinned Mermaid rejects this; put the annotation inside the class body or on a line of its own.",
        })
      for (const id of declares(value)) declaredSoFar.add(id)
      if (value.kind === 'assignment' && value.form === 'cssClass' && value.references.some(ref => declaredAnywhere.has(ref.id) && !declaredSoFar.has(ref.id))) warnings.push({
        code: 'UNSUPPORTED_SYNTAX', syntax: 'class_css_class_before_class', line: header + 1 + node.source.line,
        message: 'A cssClass before the class it names is applied to that class. Pinned Mermaid applies a cssClass only to classes declared before it, and draws this one unstyled; put the cssClass after the class.',
      })
      if (value.kind === 'assignment' && value.form !== 'cssClass') warnings.push({
        code: 'UNSUPPORTED_SYNTAX', syntax: 'class_style_assignment', line: header + 1 + node.source.line,
        message: value.form === 'class'
          ? `\`class A c\` is read as style class c on A. Pinned Mermaid reads it as one class named \`Ac\`; write \`cssClass "A" c\` or \`class A:::c\`.`
          : value.form === 'shorthand'
            ? 'A `:::style` class on a line of its own is read as the class\'s style class. Pinned Mermaid rejects it; write `cssClass "A" c` or `class A:::c`.'
            : 'A cssClass whose class list is not quoted is read as written. Pinned Mermaid rejects it; quote the list: `cssClass "A,B" c`.',
      })
      // Mermaid reads `A : text` as a LABEL token, `":"[^:\n;]+`, after it
      // removes `%%{…}%%` directives and runs its entity prepass: a colon or
      // `;` in the text ends it.
      if (value.kind === 'member' && value.reference) {
        const lexed = mermaidEntityPrepass(node.text.replace(/%%\{\s*\w+(?:(?!\}%%)[\s\S])*(?:\}%%)?/g, '')).replace(/#\w+;/g, '#')
        if (/[:;]/.test(lexed.slice(lexed.indexOf(':') + 1))) warnings.push({
          code: 'UNSUPPORTED_SYNTAX', syntax: 'class_member_text', line: header + 1 + node.source.line,
          message: 'A colon or `;` in the text after `Class :` is read as part of the member. Pinned Mermaid ends that text at either and rejects the line. The writer writes the member in the class body, `class A { … }`, which Mermaid reads.',
        })
      }
      // Before the first colon of `classDef` and `style`, Mermaid's class
      // grammar takes only ALPHA (`\w+`), `#`, `%` and commas; a colon then
      // starts a LABEL token, which reads on to the next colon.
      const firstStyleProperty = (value.kind === 'classDef' || value.kind === 'style')
        ? node.text.trim().replace(/^\S+\s+(?:`[^`]*`|"[^"]*"|\S+)\s+/, '').split(':')[0]!.trim()
        : ''
      if ((value.kind === 'classDef' || value.kind === 'style') && (!writableFirstStyleProperty(firstStyleProperty) || /[^\w\s#%,]/.test(node.text.replace(/^\S+/, '').split(':')[0]!))) warnings.push({
        code: 'UNSUPPORTED_SYNTAX', syntax: 'class_style_text', line: header + 1 + node.source.line,
        message: `\`${value.kind}\` is read with its names and CSS as written. Before the first colon, pinned Mermaid rejects hyphenated property names and reserved Class/accessibility tokens. The writer prefixes an empty CSS declaration, \`style:,stroke-width:2px\`, which sets no property and preserves the complete authored sequence.`,
      })
      // Mermaid's class DB reads a member holding `)` as a method, and its
      // method split, `([#+~-])?(.+)\((.*)\)…`, leaves one it cannot split
      // without a name, which fails the render (classTypes.ts parseMember).
      if (value.kind === 'member') {
        const problem = classMemberWriteProblem(value.text)
        if (problem) warnings.push({
          code: 'UNSUPPORTED_SYNTAX', syntax: /[{}]/.test(value.text) && hasClassDirectionToken(value.text) ? 'class_member_direction' : 'class_member_html', line: header + 1 + node.source.line,
          message: `${problem}. Its source and native rendering are preserved, but typed editing is unavailable.`,
        })
        const member = value.text.replace(/#\w+;/g, '#').trim()
        if (!(member.startsWith('<<') && member.endsWith('>>')) && member.indexOf(')') > 0 && !/^[#+~-]?.+\(.*\)/.test(member)) warnings.push({
          code: 'UNSUPPORTED_SYNTAX', syntax: 'class_member_parenthesis', line: header + 1 + node.source.line,
          message: 'A member holding a `)` with no name and `(…)` before it is read as written. Pinned Mermaid reads a member holding `)` as a method, and fails on one it cannot split into a name and `(…)`: it draws no diagram. Write the `)` as `#41;`, or the method as `name(…)`.',
        })
      }
      // Mermaid's class grammar reads a link as `click A href "…"` or
      // `link A "…"`: its keywords in lower case, the URL quoted.
      if (value.kind === 'interaction') {
        const form = /^(click|link)\s+(?:`[^`]+`|[\w$]+)(?:~[^~]+~)?\s+(href\s+)?(")?/.exec(node.text.trim())
        if (!form || (form[1] === 'click') !== (form[2] !== undefined) || form[3] === undefined) warnings.push({
          code: 'UNSUPPORTED_SYNTAX', syntax: 'class_link_form', line: header + 1 + node.source.line,
          message: 'This link is read as a link to its URL. Pinned Mermaid reads a link only as `click A href "…"` or `link A "…"`, its keyword in lower case and its URL quoted, and rejects this line. The writer writes `click A href "…"`.',
        })
      }
      if (value.kind === 'header') warnings.push({
        code: 'UNSUPPORTED_SYNTAX', syntax: 'class_repeated_header', line: header + 1 + node.source.line,
        message: 'A second `classDiagram` header is read as nothing, and the writer leaves it out. Pinned Mermaid rejects it. Remove it.',
      })
      if ((value.kind === 'classDef' || value.kind === 'style') && withoutStyleComment(node.text) !== node.text) warnings.push({
        code: 'UNSUPPORTED_SYNTAX', syntax: 'class_style_comment', line: header + 1 + node.source.line,
        message: `A \`%%\` comment after \`${value.kind}\` paint is read as a comment, and the paint before it is drawn. Pinned Mermaid reads the comment into the last property's value, which CSS then drops, so it draws that property's default. Put the comment on a line of its own.`,
      })
      if (node.value.kind === 'note' && node.value.escapedQuotes) warnings.push({
        code: 'UNSUPPORTED_SYNTAX', syntax: 'class_escaped_note_quotes', line: header + 1 + node.source.line,
        message: 'Backslash-escaped quotes in Class notes are read as text. Pinned Mermaid rejects this; use &quot; inside the quoted note.',
      })
      if (node.children) for (let index = node.children.length - 1; index >= 0; index--) pending.push(node.children[index]!)
    }
  }
  // An accTitle or accDescr is Mermaid's own statement, not a member: read
  // the statements around it, its lines left blank.
  const statementLines = [...bodyLines]
  for (let index = 0; index < statementLines.length; index++) {
    const directive = parseAccessibilityDirective(statementLines, index)
    if (directive === undefined) break
    if (directive === null) continue
    if (!directive.title && directive.form !== 'native' && directive.value === '') warnings.push({
      code: 'UNSUPPORTED_SYNTAX', syntax: 'class_empty_accessibility_description', line: header + index + 2,
      message: 'An empty accessibility description is retained, but pinned Mermaid rejects an empty Class accDescr block. The writer preserves the empty value in a native metadata comment.',
    })
    for (let at = index; at <= directive.endIndex; at++) statementLines[at] = ''
    if (directive.suffixLine) statementLines[directive.endIndex] = directive.suffixLine
    index = directive.endIndex
  }
  extensionWarnings(readClassStatements(statementLines).statements)
  return warnings
}

export function verifyClass(body: ClassBody, opts: VerifyOptions): LayoutWarning[] {
  const warnings: LayoutWarning[] = []

  // A title is frontmatter furniture: Mermaid rejects a Class diagram with no
  // statement, titled or not (class_empty_diagram).
  if (body.classes.length === 0) {
    warnings.push({ code: 'EMPTY_DIAGRAM' })
    return warnings
  }

  const overflow = labelOverflowCollector(warnings, opts)
  if (body.title) overflow('title', body.title)

  const ids = new Set(body.classes.map(c => c.id))
  for (const c of body.classes) {
    if (c.label) overflow(c.id, resolveLabelContent(c.label, c.labelContent))
    for (let i = 0; i < c.members.length; i++) {
      const authored = decodeXML(c.members[i]!)
      const annotation = parseClassBodyAnnotationToken(authored)
      const member = annotation === null ? parseClassMember(authored) : null
      const text = annotation !== null ? `<<${decodeClassText(annotation)}>>` : member ? memberToString(member.member) : ''
      overflow(`${c.id}#m${i}`, prepareDisplayText(text, 'literal'))
    }
  }
  for (const ns of body.namespaces ?? []) {
    if (ns.label) overflow(`namespace:${ns.name}`, resolveLabelContent(ns.label, ns.labelContent))
  }
  for (let i = 0; i < body.relations.length; i++) {
    const r = body.relations[i]!
    if (!ids.has(r.from) || !ids.has(r.to)) {
      warnings.push({
        code: 'EDGE_MISANCHORED',
        edge: `rel#${i}:${r.from}->${r.to}`,
        from: ids.has(r.from) ? r.from : undefined,
        to: ids.has(r.to) ? r.to : undefined,
      })
    }
    if (r.label) overflow(`rel#${i}`, resolveLabelContent(r.label, r.labelContent))
  }
  for (let i = 0; i < body.notes.length; i++) {
    const n = body.notes[i]!
    overflow(`note#${i}`, resolveLabelContent(n.text, n.textContent))
    if (n.for && !ids.has(n.for)) {
      warnings.push({ code: 'EDGE_MISANCHORED', edge: `note#${i}->${n.for}`, from: undefined, to: undefined })
    }
  }

  return warnings
}
