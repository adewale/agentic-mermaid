import type { ClassDiagram, ClassNode, ClassRelationship, ClassMember, RelationshipType, ClassNamespace } from './types.ts'
import { normalizeBrTags } from '../multiline-utils.ts'
import { parseAccessibilityDirective, requireClosedAccessibility, scanAccessibilityDirectives } from '../shared/accessibility-directives.ts'
import { parseDirectionStatement } from '../shared/direction-statement.ts'
import { parseStyleProps } from '../shared/style-props.ts'
import { syntaxError } from '../shared/syntax-error.ts'
import { isSafeActionHref } from '../output-security.ts'
import { decodeXML } from 'entities'

// ---- Shared namespace grammar ----------------------------------------------
// One grammar, two consumers: this render parser and the agent body parser
// (src/agent/class-body.ts) both parse namespace headers through
// parseNamespaceHeader, so membership cannot drift between the surfaces (C1).

/** `namespace A.B.C {` / `namespace X["Display label"] {` */
const NAMESPACE_OPEN_RE = /^namespace\s+([\w$]+(?:\.[\w$]+)*)(?:\s*\[\s*"?([^\]"]*)"?\s*\])?\s*\{$/

/** Parse a `namespace … {` opener into its dot path + optional label. */
export function parseNamespaceHeader(line: string): { path: string[]; label?: string } | null {
  const m = line.match(NAMESPACE_OPEN_RE)
  if (!m) return null
  return { path: m[1]!.split('.'), label: m[2] || undefined }
}

/** Expand upstream's compact `namespace X { class A; class B }` form into
 * the same statements consumed by both render and agent parsers. Class member
 * bodies retain their multiline grammar; this compact form intentionally owns
 * only brace-free statements. */
export function expandInlineNamespaceStatement(line: string): string[] {
  const match = line.match(/^(namespace\s+.+?)\s*\{\s*([^{}]*)\s*\}$/)
  if (!match) return [line]
  const opener = `${match[1]} {`
  if (!parseNamespaceHeader(opener)) return [line]
  const body: string[] = []
  let start = 0
  let quote: string | undefined
  for (let index = 0; index < match[2]!.length; index++) {
    const character = match[2]![index]!
    if (quote) {
      if (character === '\\' && quote === '"') { index++; continue }
      if (character === quote) quote = undefined
    } else if (character === '"' || character === '`' || character === '~') quote = character
    else if (character === ';') {
      body.push(match[2]!.slice(start, index).trim())
      start = index + 1
    }
  }
  body.push(match[2]!.slice(start).trim())
  return [opener, ...body.filter(Boolean), '}']
}

/** Split entity-created physical lines while retaining every other authored
 * entity for Class quote-boundary validation. */
export function splitAuthoredClassLine(line: string): string[] {
  return line.replace(/&(?:#(?:[xX][0-9a-fA-F]+|[0-9]+)|[A-Za-z][A-Za-z0-9]+);/g, token => {
    const decoded = decodeXML(token)
    return /[\r\n]/.test(decoded) ? decoded : token
  }).split(/\r\n|\r|\n/)
}

/** Match decoded Class statements to authored bytes one statement at a time.
 * Entity-created comments/directives and compact namespace expansions must
 * never shift quote provenance for an unrelated later link. */
function authoredClassStatements(lines: string[]): Array<string | undefined> {
  const authored = lines.flatMap(splitAuthoredClassLine).map(line => line.trim())
    .filter(line => {
      const semantic = decodeXML(line).trim()
      return semantic.length > 0 && !semantic.startsWith('%%')
    })
  const semantic = authored.map(line => decodeXML(line))
  const statements: Array<string | undefined> = []
  const add = (raw: string | undefined, decoded: string): void => {
    const decodedParts = expandInlineNamespaceStatement(decoded)
    const rawParts = raw === undefined ? [] : expandInlineNamespaceStatement(raw)
    if (rawParts.length === decodedParts.length
      && rawParts.every((part, index) => decodeXML(part) === decodedParts[index])) {
      statements.push(...rawParts)
    } else {
      statements.push(...decodedParts.map(() => undefined))
    }
  }
  for (let index = 0; index < authored.length; index++) {
    const directive = parseAccessibilityDirective(semantic, index)
    if (directive === undefined) {
      for (; index < authored.length; index++) add(authored[index], semantic[index]!)
      break
    }
    if (directive === null) {
      add(authored[index], semantic[index]!)
      continue
    }
    if (directive.suffixLine) {
      const rawClosing = authored[directive.endIndex]!
      const braceTokens = /}|&(?:#(?:[xX][0-9a-fA-F]+|[0-9]+)|[A-Za-z][A-Za-z0-9]+);/g
      let braceEnd = -1
      for (const match of rawClosing.matchAll(braceTokens)) {
        if (decodeXML(match[0]) === '}') {
          braceEnd = match.index + match[0].length
          break
        }
      }
      const candidate = braceEnd < 0 ? undefined : rawClosing.slice(braceEnd).trim()
      add(candidate !== undefined && decodeXML(candidate).trim() === directive.suffixLine.trim()
        ? candidate : undefined, directive.suffixLine.trim())
    }
    index = directive.endIndex
  }
  return statements
}

// Shared class declaration grammar. The structured serializer emits bracket
// labels, so the renderer and agent parser must resolve them to the same
// logical ID instead of treating `A["Label"]` as an identifier.
const CLASS_DECLARATION_RE = /^class\s+(`[^`]+`|[\w$]+)(?:\s*~([^~]+)~)?(?:\s*\[\s*"([^"]*)"\s*\])?(?:\s+as\s+"([^"]+)")?(?:\s+~([^~]+)~)?(?:\s*:::([\w-]+))?\s*(\{\s*\}|\{)?\s*$/

export interface ParsedClassDeclaration {
  id: string
  label?: string
  generic?: string
  className?: string
  opensBody: boolean
}

export function parseClassDeclaration(line: string): ParsedClassDeclaration | null {
  const match = line.match(CLASS_DECLARATION_RE)
  if (!match) return null
  const rawId = match[1]!
  return {
    id: rawId.startsWith('`') ? rawId.slice(1, -1) : rawId,
    generic: (match[2] ?? match[5])?.trim(),
    label: match[3] ?? match[4],
    ...(match[6] ? { className: match[6] } : {}),
    opensBody: match[7] === '{',
  }
}

/** Parse an upstream class reference, normalizing `Box~T~` to stable id
 * `Box` plus a generic parameter. The same identity rule is used by
 * declarations, relationships, notes, and member statements. */
export function parseClassReference(token: string): { id: string; generic?: string } | null {
  const match = token.trim().match(/^(`[^`]+`|[\w$]+)(?:~([^~]+)~)?$/)
  if (!match) return null
  const rawId = match[1]!
  return {
    id: rawId.startsWith('`') ? rawId.slice(1, -1) : rawId,
    generic: match[2]?.trim() || undefined,
  }
}

/** Inline and separate annotations use Mermaid's word-token lexer. */
export function parseClassAnnotationToken(token: string): string | null {
  const match = token.trim().match(/^<<[ \t]*(\w+)[ \t]*>>$/)
  return match?.[1] ?? null
}

/** Class-body annotations accept any interior text, including an empty
 * string and additional angle brackets, and retain its authored bytes. */
export function parseClassBodyAnnotationToken(token: string): string | null {
  const text = token.trim()
  return text.startsWith('<<') && text.endsWith('>>') ? text.slice(2, -2) : null
}

export interface ParsedClassAnnotationStatement {
  id: string
  generic?: string
  label?: string
  annotation: string
  placement: 'inline' | 'separate' | 'body-inline'
}

/** A class ID, generic, or quoted label may itself contain `<<...>>`.
 * Find the annotation opener only after leaving those declaration contexts.
 * One pass bounds work even for a full-size hostile source line. */
function findClassAnnotationStart(text: string): number {
  let inBacktick = false
  let inQuote = false
  let inGeneric = false
  let bracketDepth = 0
  for (let i = 0; i < text.length - 1; i++) {
    const char = text[i]!
    if (inBacktick) { if (char === '`') inBacktick = false; continue }
    if (inQuote) { if (char === '"') inQuote = false; continue }
    if (inGeneric) { if (char === '~') inGeneric = false; continue }
    if (char === '`') { inBacktick = true; continue }
    if (char === '"') { inQuote = true; continue }
    if (char === '~' && bracketDepth === 0) { inGeneric = true; continue }
    if (char === '[') { bracketDepth++; continue }
    if (char === ']') { bracketDepth = Math.max(0, bracketDepth - 1); continue }
    if (bracketDepth === 0 && char === '<' && text[i + 1] === '<') return i
  }
  return -1
}

/** Split once at the annotation delimiters, then reuse the declaration and
 * reference grammars. Avoid overlapping unbounded captures on hostile input. */
export function parseClassAnnotationStatement(line: string): ParsedClassAnnotationStatement | null {
  const text = line.trim()
  if (text.startsWith('<<')) {
    const close = text.indexOf('>>', 2)
    if (close < 0) return null
    const annotation = parseClassAnnotationToken(text.slice(0, close + 2))
    const ref = parseClassReference(text.slice(close + 2))
    return annotation && ref ? { ...ref, annotation, placement: 'separate' } : null
  }

  const prefix = text.match(/^class\s+/)
  if (!prefix) return null
  const declarationAndAnnotation = text.slice(prefix[0].length)
  const start = findClassAnnotationStart(declarationAndAnnotation)
  if (start < 0) return null
  let declarationText = declarationAndAnnotation.slice(0, start).trim()
  let annotationText = declarationAndAnnotation.slice(start).trim()
  const bodyInline = declarationText.endsWith('{') && annotationText.endsWith('}')
  if (bodyInline) {
    declarationText = declarationText.slice(0, -1).trim()
    annotationText = annotationText.slice(0, -1).trim()
  }
  const declaration = parseClassDeclaration(`class ${declarationText}`)
  const annotation = bodyInline
    ? parseClassBodyAnnotationToken(annotationText)
    : parseClassAnnotationToken(annotationText)
  return declaration && !declaration.opensBody && annotation !== null
    ? {
        id: declaration.id,
        ...(declaration.generic ? { generic: declaration.generic } : {}),
        ...(declaration.label !== undefined ? { label: declaration.label } : {}),
        annotation,
        placement: bodyInline ? 'body-inline' : 'inline',
      }
    : null
}

function applyClassAnnotation(node: ClassNode, annotation: string): void {
  if (node.annotation !== undefined) {
    throw syntaxError({
      what: `Multiple annotations for class "${node.id}" are not modeled without losing identity`,
      expectedForm: 'one annotation per class',
      example: `class ${node.id} <<${annotation}>>`,
    })
  }
  node.annotation = annotation
}

/** Mermaid's class grammar is `classDiagram NEWLINE statements EOF`, so
 * Mermaid rejects a header alone; ours draws it as an empty diagram and
 * verify reports the difference. Any statement in `bodyLines` (the lines
 * after the header, accTitle/accDescr included) lifts that floor. */
export function classDiagramHasStatement(bodyLines: readonly string[]): boolean {
  return bodyLines.some(line => {
    const statement = line.trim()
    return statement.length > 0 && !statement.startsWith('%%')
  })
}

// ---- Trailing `%%` comments -------------------------------------------------
// Both parsers read a trailing `%%` after a class statement as a comment. A
// "string", a `backtick` name, a ~generic~, `: label` text, callback
// `(arguments)`, a declaration's `{members}` and the bare link destination this
// repo also reads keep `%%` as text.
//
// Mermaid's class lexer reads `%%` as a comment only in its default state:
// after a relationship, note, link, style, classDef, cssClass or separate
// annotation. That comment also swallows the line break, so the next statement
// would join this one: Mermaid accepts it only on the diagram's last
// statement. In a `class …` statement, anywhere in a namespace and after a
// closing `}`, the lexer reads `%` as punctuation no rule accepts. A
// `direction` line is one token to the line end. classCommentRejections holds
// that rule, and verify reports where Mermaid rejects a comment ours reads.

const BARE_LINK_DESTINATION_RE = /(?:https?:\/\/|mailto:)\S*/iy
const CLASS_TEXT_CLOSERS: Readonly<Record<string, string>> = { '"': '"', '`': '`', '~': '~', '(': ')' }

/** Offset of the `%%` that starts a trailing comment on one class statement
 * line, by the class lexer's text rules above, or -1. */
export function classCommentStart(line: string): number {
  const declaration = /^class\b/.test(line)
  for (let index = 0; index < line.length - 1; index++) {
    const char = line[index]!
    const closer = CLASS_TEXT_CLOSERS[char] ?? (declaration && char === '{' ? '}' : undefined)
    if (closer !== undefined) {
      const end = line.indexOf(closer, index + 1)
      if (end < 0) return -1
      index = end
      continue
    }
    if (char === ':') {
      // `: label` text runs to the end of the line; `:::` names a style class.
      if (!line.startsWith(':::', index)) return -1
      index += 2
      continue
    }
    if (index === 0 || /\s/.test(line[index - 1]!)) {
      BARE_LINK_DESTINATION_RE.lastIndex = index
      if (BARE_LINK_DESTINATION_RE.test(line)) {
        index = BARE_LINK_DESTINATION_RE.lastIndex - 1
        continue
      }
    }
    if (char === '%' && line[index + 1] === '%') return index
  }
  return -1
}

/** A class statement line without its trailing `%%` comment. Member lines
 * inside a class body are text, not statements. */
export function classStatement(line: string): string {
  const start = classCommentStart(line)
  return start < 0 ? line : line.slice(0, start).trimEnd()
}

type ClassReference = NonNullable<ReturnType<typeof parseClassReference>>
type ClassSyntaxValue =
  | { kind: 'header' | 'trivia' | 'close' }
  | { kind: 'namespace'; path: string[]; label?: string }
  | { kind: 'class'; declaration: ParsedClassDeclaration }
  | { kind: 'member'; reference?: ClassReference; text: string }
  | { kind: 'annotation'; annotation: ParsedClassAnnotationStatement }
  | { kind: 'body-annotation'; text: string }
  | { kind: 'relationship'; relationship: NonNullable<ReturnType<typeof parseClassRelationship>> }
  | { kind: 'interaction'; interaction: NonNullable<ReturnType<typeof parseClassInteraction>> }
  | { kind: 'note'; text: string; reference?: ClassReference; escapedQuotes?: boolean }
  | { kind: 'direction'; direction: NonNullable<ReturnType<typeof parseDirectionStatement>> }
  | { kind: 'title'; text: string }
  | { kind: 'classDef'; names: string[]; props: Record<string, string> }
  | { kind: 'assignment'; references: ClassReference[]; name: string }
  | { kind: 'style'; references: ClassReference[]; props: Record<string, string> }
  | { kind: 'unknown'; reason: string }
  | { kind: 'source-only'; reason: string }

/** A lossless syntax tree, before either renderer or typed-model projection.
 * Offsets address the supplied lines joined with LF; line/column are one-based.
 * Compact namespace fragments retain the containing physical line's span. */
export interface ClassStatementNode {
  raw: string
  text: string
  source: { line: number; column: number; start: number; end: number }
  value: ClassSyntaxValue
  children?: ClassStatementNode[]
  closing?: ClassStatementNode
}

export interface ClassStatementTree {
  /** Exact supplied source, including compact syntax, whitespace and comments. */
  source: string
  statements: ClassStatementNode[]
  diagnostics: Array<{ reason: string; source: ClassStatementNode['source'] }>
}

/** Class-specific statement classification. Block ownership is handled only
 * by readClassStatements; consumers never decide whether a line is a member. */
function classifyClassStatement(text: string, authored: string | undefined): ClassSyntaxValue {
  if (/^classDiagram\s*$/i.test(text)) return { kind: 'header' }
  if (!text || text.startsWith('%%')) return { kind: 'trivia' }
  if (text === '}') return { kind: 'close' }
  const interaction = authored !== undefined ? parseClassInteractionWithAuthored(authored) : null
  if (interaction) return { kind: 'interaction', interaction }
  // These actions have an established inert sidecar surface. They remain
  // opaque to editing, but rendering their target is safe and intentional.
  if (/^callback\s+(?:`[^`]+`|[\w$]+)(?:~[^~]+~)?\s+"[^"\r\n]+"(?:\s+"[^"\r\n]*")?\s*$/i.test(text)
    || /^click\s+(?:`[^`]+`|[\w$]+)(?:~[^~]+~)?\s+call\s+.+$/i.test(text)
    || /^(?:click|link)\s+(?:`[^`]+`|[\w$]+)(?:~[^~]+~)?\s+(?:href\s+)?"(?!(?:https?:\/\/|mailto:))[^"\r\n]*"(?:\s+"[^"\r\n]*")?\s*$/i.test(text)) {
    return { kind: 'source-only', reason: 'Class callback or unsafe/relative link is retained as inert source-only action metadata' }
  }
  // Validate note delimiters against authored bytes, then decode content.
  // Entity quotes are text, not fresh syntax introduced by render normalization.
  const note = classStatement((authored ?? text).trim()).match(/^note(?:\s+for\s+(\S+))?\s+"((?:\\.|[^"\\])*)"\s*$/i)
  if (note) {
    const reference = note[1] ? parseClassReference(decodeXML(note[1])) : undefined
    if (!note[1] || reference) return {
      kind: 'note', text: decodeXML(note[2]!.replace(/\\(["\\])/g, '$1')),
      ...(reference ? { reference } : {}), ...(note[2]!.includes('\\"') ? { escapedQuotes: true } : {}),
    }
  }
  const title = text.match(/^title\s+(.+)$/i)
  if (title) return { kind: 'title', text: title[1]!.trim() }
  const direction = parseDirectionStatement(text)
  if (direction) return { kind: 'direction', direction }
  const namespace = parseNamespaceHeader(text)
  if (namespace) return { kind: 'namespace', ...namespace }
  const references = (raw: string): ClassReference[] | null => {
    const refs = raw.replace(/^"|"$/g, '').split(',').map(value => parseClassReference(value.trim()))
    return refs.every((ref): ref is ClassReference => ref !== null) ? refs : null
  }
  const classDef = text.match(/^classDef\s+([\w,-]+)\s+(.+)$/)
  if (classDef) {
    const props = parseStyleProps(classDef[2]!)
    if (Object.keys(props).length > 0) return { kind: 'classDef', names: classDef[1]!.split(',').filter(Boolean), props }
  }
  const assignment = text.match(/^(?:class|cssClass)\s+(.+?)\s+([\w-]+)$/)
  if (assignment && !text.includes('{') && !text.includes('[') && !text.includes(' as ')) {
    const refs = references(assignment[1]!)
    if (refs) return { kind: 'assignment', references: refs, name: assignment[2]! }
  }
  const style = text.match(/^style\s+(.+?)\s+(.+)$/)
  if (style) {
    const refs = references(style[1]!)
    const props = parseStyleProps(style[2]!)
    if (refs && Object.keys(props).length > 0) return { kind: 'style', references: refs, props }
  }
  const annotation = parseClassAnnotationStatement(text)
  if (annotation) return { kind: 'annotation', annotation }
  const declaration = parseClassDeclaration(text)
  if (declaration) return { kind: 'class', declaration }
  const shorthand = text.match(/^(.+?):::([\w-]+)$/)
  if (shorthand) {
    const reference = parseClassReference(shorthand[1]!)
    if (reference) return { kind: 'assignment', references: [reference], name: shorthand[2]! }
  }
  const member = text.match(/^(\S+?)\s*:\s*(.+)$/)
  if (member) {
    const reference = parseClassReference(member[1]!)
    if (reference) return { kind: 'member', reference, text: member[2]!.trim() }
  }
  const relationship = parseClassRelationship(text)
  if (relationship) return { kind: 'relationship', relationship }
  const form = text.includes('<<') || text.includes('>>') ? 'annotation'
    : isBareClassRelationshipCandidate(text) || isMarkedClassRelationshipCandidate(text) || isEscapedMarkedClassRelationshipCandidate(text) ? 'relationship'
    : /^(?:click|link)\b/i.test(text) ? 'link' : ''
  return { kind: 'unknown', reason: `Unrecognized class${form ? ` ${form}` : ''} statement "${text}"` }
}

/** Single owner of namespace and class-body boundaries, classification and
 * malformed/unknown disposition. Retain unknown nodes for lossless callers;
 * renderers must refuse diagnostics instead of drawing a partial diagram. */
export function readClassStatements(lines: readonly string[], authoredLines?: readonly (string | undefined)[]): ClassStatementTree {
  const tree: ClassStatementTree = { source: lines.join('\n'), statements: [], diagnostics: [] }
  const stack: ClassStatementNode[] = []
  let offset = 0
  lines.forEach((raw, lineIndex) => {
    const span = { line: lineIndex + 1, column: 1, start: offset, end: offset + raw.length }
    offset += raw.length + 1
    const authored = authoredLines ? authoredLines[lineIndex] : raw
    const parts = expandInlineNamespaceStatement(raw.trim())
    const authoredParts = authored === undefined ? [] : expandInlineNamespaceStatement(authored.trim())
    for (let partIndex = 0; partIndex < parts.length; partIndex++) {
      const source = parts[partIndex]!
      const owner = stack[stack.length - 1]
      const inClass = owner?.value.kind === 'class'
      const text = inClass && !source.startsWith('}') ? source : classStatement(source)
      let value: ClassSyntaxValue
      if (!source || source.startsWith('%%')) value = { kind: 'trivia' }
      else if (inClass && text !== '}') {
        const annotation = parseClassBodyAnnotationToken(text)
        value = annotation === null ? { kind: 'member', text } : { kind: 'body-annotation', text: annotation }
      } else value = classifyClassStatement(text, authoredParts.length === parts.length ? authoredParts[partIndex] : undefined)
      const node: ClassStatementNode = { raw: parts.length === 1 ? raw : source, text, source: span, value }
      if (value.kind === 'close') {
        if (owner) { owner.closing = node; stack.pop() }
        else {
          tree.statements.push(node)
          tree.diagnostics.push({ reason: 'Unexpected closing brace in class diagram', source: span })
        }
        continue
      }
      const siblings = owner ? owner.children! : tree.statements
      siblings.push(node)
      if (value.kind === 'unknown') tree.diagnostics.push({ reason: value.reason, source: span })
      if (value.kind === 'namespace' || (value.kind === 'class' && value.declaration.opensBody)) {
        node.children = []
        stack.push(node)
      }
    }
  })
  for (const owner of stack) tree.diagnostics.push({
    reason: `Unclosed ${owner.value.kind === 'namespace' ? 'namespace' : 'class'} block`, source: owner.source,
  })
  return tree
}

/** Each body line (after the `classDiagram` header, accTitle/accDescr
 * included) whose trailing `%%` comment Mermaid's class grammar rejects,
 * walked as the parsers walk it: its index in `bodyLines` and what ours reads
 * there. */
export function classCommentRejections(bodyLines: readonly string[]): Array<{ index: number; what: string }> {
  // An accTitle/accDescr is a statement whose text keeps `%%` (text '').
  const statements: Array<{ text: string; index: number }> = []
  for (let index = 0; index < bodyLines.length; index++) {
    const directive = parseAccessibilityDirective(bodyLines, index)
    if (directive === undefined) break
    if (directive !== null) {
      statements.push({ text: '', index })
      index = directive.endIndex
      continue
    }
    for (const text of expandInlineNamespaceStatement(bodyLines[index]!.trim())) {
      if (text.length > 0 && !text.startsWith('%%')) statements.push({ text, index })
    }
  }
  const rejections: Array<{ index: number; what: string }> = []
  const tree = readClassStatements(statements.map(statement => statement.text))
  const check = (node: ClassStatementNode, namespaces: number, inClassBody: boolean): void => {
    const at = node.source.line - 1
    const { text, index } = statements[at]!
    // A member keeps `%%` as text; its closing brace is a statement again.
    if (text === '' || (inClassBody && !text.startsWith('}'))) return
    const start = classCommentStart(text)
    if (start >= 0 && (namespaces > 0 || /^(?:class|namespace)\b/.test(text) || text.startsWith('}'))) {
      rejections.push({ index, what: 'A %% comment after a class declaration, a namespace or a statement inside one, or a closing brace is read as a comment' })
    } else if (start >= 0 && at < statements.length - 1 && node.value.kind !== 'direction') {
      rejections.push({ index, what: 'A trailing %% comment on a statement that another statement follows is read as a comment' })
    }
  }
  const visit = (nodes: ClassStatementNode[], namespaces = 0, inClassBody = false): void => {
    const frames: Array<{ nodes: ClassStatementNode[]; namespaces: number; inClassBody: boolean; index: number; closing?: ClassStatementNode }> = [{ nodes, namespaces, inClassBody, index: 0 }]
    while (frames.length) {
      const frame = frames.at(-1)!
      if (frame.index === frame.nodes.length) {
        if (frame.closing) check(frame.closing, frame.namespaces, frame.inClassBody)
        frames.pop()
        continue
      }
      const node = frame.nodes[frame.index++]!
      const { namespaces, inClassBody } = frame
      check(node, namespaces, inClassBody)
      if (node.children) {
        const childNamespaces = namespaces + (node.value.kind === 'namespace' ? 1 : 0)
        const classBody = node.value.kind === 'class'
        frames.push({ nodes: node.children, namespaces: childNamespaces, inClassBody: classBody, index: 0, closing: node.closing })
      }
    }
  }
  visit(tree.statements)
  return rejections
}

/** Shared safe-link grammar for renderer and agent class parsers. */
const CLASS_COMMENT_START_RE = /(?:%|&#(?:0*37|x0*25);){2}/iy

function startsClassComment(line: string, index = 0): boolean {
  CLASS_COMMENT_START_RE.lastIndex = index
  return CLASS_COMMENT_START_RE.test(line)
}

export function parseClassInteraction(line: string): { id: string; generic?: string; href: string; tooltip?: string } | null {
  // Parse the URL once, then scan the optional tooltip/comment tail once.
  // A bare URL may contain literal %% (a repo-supported extension), while a
  // Mermaid comment may follow a closing quote without intervening space.
  const link = line.trimStart().match(/^(?:click|link)\s+(`[^`]+`(?:~[^~]+~)?|[\w$]+(?:~[^~]+~)?)\s+(?:href\s+)?(?:"((?:\\.|[^"\\])*)"|((?:https?:\/\/|mailto:)[^\s"\\]+))/i)
  if (!link) return null
  const tail = line.trimStart().slice(link[0].length).trimStart()
  let tooltip: string | undefined
  if (tail.startsWith('"')) {
    // Hover text belongs to the quoted safe-link forms. A bare destination
    // followed by a quote is not a different, silently shortened URL.
    if (link[3] !== undefined) return null
    let close = -1
    let interiorQuotes = 0
    for (let i = 1; i < tail.length; i++) {
      if (tail[i] !== '"') continue
      let next = i + 1
      while (next < tail.length && /\s/.test(tail[next]!)) next++
      if (interiorQuotes % 2 === 0 && (next === tail.length || startsClassComment(tail, next))) {
        close = i
        break
      }
      interiorQuotes++
    }
    if (close < 0) return null
    tooltip = tail.slice(1, close)
    // Decoded &quot; pairs within hover text are content. The render waist no
    // longer knows whether an internal pair was authored raw or as entities,
    // so only unbalanced quotes can be rejected without losing valid text.
    if ((tooltip.match(/"/g)?.length ?? 0) % 2 !== 0) return null
    const suffix = tail.slice(close + 1).trimStart()
    if (suffix && !startsClassComment(suffix)) return null
  } else if (tail && !startsClassComment(tail)) return null
  const ref = parseClassReference(link[1]!)
  const href = (link[2] ?? link[3] ?? '').replace(/\\(["\\])/g, '$1')
  return ref && /^(?:https?:|mailto:)/i.test(href) && isSafeActionHref(href) && !/[\u0000-\u0020\u007f-\u009f]/.test(href) && (tooltip === undefined || !/[\u0000-\u001f\u007f-\u009f]/.test(tooltip))
    ? { id: ref.id, ...(ref.generic ? { generic: ref.generic } : {}), href, ...(tooltip ? { tooltip } : {}) }
    : null
}

/** Decode authored syntax once while shielding entity-encoded quotes from the
 * grammar. A raw extra quote remains a delimiter; an entity quote remains
 * content until after the strict boundary check. */
export function parseClassInteractionWithAuthored(authoredLine: string): ReturnType<typeof parseClassInteraction> {
  // Choose a marker absent from the *decoded* input: an entity can itself
  // represent any private-use code point, so checking authored bytes is not
  // enough to keep content distinct from protected quote provenance.
  const occupied = new Set<number>()
  for (const character of decodeXML(authoredLine)) {
    const code = character.charCodeAt(0)
    if (code >= 0xe000 && code <= 0xf8ff) occupied.add(code)
  }
  let markerCode = 0xe000
  while (occupied.has(markerCode)) markerCode++
  if (markerCode > 0xf8ff) return null
  const quoteMarker = String.fromCharCode(markerCode)
  const protectedLine = decodeXML(authoredLine.replace(/&quot;|&#0*34;|&#x0*22;/gi, token =>
    decodeXML(token) === '"' ? quoteMarker : token))
  const parseProtected = (line: string): ReturnType<typeof parseClassInteraction> => {
    const parsed = parseClassInteraction(line)
    if (!parsed || parsed.tooltip?.includes('"')) return null
    // A quote entity inside a destination cannot relax the URL token grammar.
    if (parsed.href.includes(quoteMarker)) return null
    const href = parsed.href
    const tooltip = parsed.tooltip?.replaceAll(quoteMarker, '"')
    if (!isSafeActionHref(href) || /[\u0000-\u0020\u007f-\u009f]/.test(href)
      || (tooltip !== undefined && /[\u0000-\u001f\u007f-\u009f]/.test(tooltip))) return null
    return { ...parsed, href, ...(tooltip !== undefined ? { tooltip } : {}) }
  }
  const direct = parseProtected(protectedLine)
  if (direct) return direct
  const restorePair = (line: string): string | null => {
    const first = line.indexOf(quoteMarker)
    const second = first < 0 ? -1 : line.indexOf(quoteMarker, first + 1)
    if (second < 0) return null
    return line.slice(0, first) + '"' + line.slice(first + 1, second) + '"' + line.slice(second + 1)
  }
  const withOuterQuotes = restorePair(protectedLine)
  if (!withOuterQuotes) return null
  const outerParsed = parseProtected(withOuterQuotes)
  if (outerParsed) return outerParsed
  // A second encoded pair can delimit the tooltip. More remaining entities
  // are ambiguous with an encoded target, so do not pair across them.
  if ([...withOuterQuotes].filter(character => character === quoteMarker).length !== 2) return null
  const withTooltipQuotes = restorePair(withOuterQuotes)
  return withTooltipQuotes === null ? null : parseProtected(withTooltipQuotes)
}

export function parseAuthoredClassInteraction(line: string): ReturnType<typeof parseClassInteraction> {
  return parseClassInteractionWithAuthored(line)
}

// ============================================================================
// Class diagram parser
//
// Parses Mermaid classDiagram syntax into a ClassDiagram structure.
//
// Supported syntax:
//   class Animal { +String name; +eat() void }
//   class Shape { <<abstract>> }
//   Animal <|-- Dog           (inheritance)
//   Car *-- Engine            (composition)
//   Car o-- Wheel             (aggregation)
//   A --> B                   (association)
//   A ..> B                   (dependency)
//   A ..|> B                  (realization)
//   A -- B / A .. B           (markerless solid/dashed links)
//   A "1" --> "*" B : label   (with cardinality + label)
//   Animal : +String name     (inline attribute)
//   namespace MyNamespace { class A { } }
//   namespace A.B.C { ... }   (dot notation auto-creates parents A, A.B)
//   namespace X["Label"] { }  (display label, upstream v11.15+)
//   direction LR              (TB | BT | LR | RL)
// ============================================================================

/**
 * Parse a Mermaid class diagram.
 * Expects the first line to be "classDiagram".
 */
export function parseClassDiagram(lines: string[], authoredLines?: string[]): ClassDiagram {
  const accessibility = scanAccessibilityDirectives(lines)
  requireClosedAccessibility(accessibility)
  const familyLines = accessibility.familyLines
  const authoredExpanded = authoredLines ? authoredClassStatements(authoredLines) : undefined
  // Align compact authored fragments before reading, preserving link quote
  // provenance while the reader owns the namespace expansion and blocks.
  const expanded = familyLines.flatMap(expandInlineNamespaceStatement)
  const tree = readClassStatements(expanded, authoredExpanded)
  if (tree.diagnostics.length > 0) {
    const diagnostic = tree.diagnostics[0]!
    throw syntaxError({
      what: `${diagnostic.reason} at line ${diagnostic.source.line}`,
      expectedForm: 'supported class statements and balanced class/namespace blocks',
      example: 'class A\nA --> B : linked',
    })
  }
  const diagram: ClassDiagram = {
    classes: [], classDefs: new Map(), relationships: [], notes: [], namespaces: [],
    ...(accessibility.accessibility.title !== undefined
      ? { accessibilityTitle: normalizeBrTags(accessibility.accessibility.title) } : {}),
    ...(accessibility.accessibility.descr !== undefined
      ? { accessibilityDescription: normalizeBrTags(accessibility.accessibility.descr) } : {}),
  }
  const classMap = new Map<string, ClassNode>()
  const namespaces = new Map<string, ClassNamespace>()
  const claimed = new Set<string>()
  const claim = (id: string, path: string): void => {
    if (path && !claimed.has(id)) { namespaces.get(path)!.classIds.push(id); claimed.add(id) }
  }
  const openNamespace = (path: string, segments: string[], label?: string): string => {
    let children = path ? namespaces.get(path)!.children : diagram.namespaces
    for (const segment of segments) {
      path = path ? `${path}.${segment}` : segment
      let namespace = namespaces.get(path)
      if (!namespace) {
        namespace = { name: segment, classIds: [], children: [] }
        children.push(namespace)
        namespaces.set(path, namespace)
      }
      children = namespace.children
    }
    if (label !== undefined) namespaces.get(path)!.label = label
    return path
  }
  const addMember = (node: ClassNode, text: string): void => {
    const member = parseMember(text)
    if (member) (member.isMethod ? node.methods : node.attributes).push(member.member)
  }
  const visit = (nodes: ClassStatementNode[], path = '', owner?: ClassNode): void => {
    const frames = [{ nodes, path, owner, index: 0 }]
    while (frames.length) {
      const frame = frames.at(-1)!
      if (frame.index === frame.nodes.length) { frames.pop(); continue }
      const node = frame.nodes[frame.index++]!
      const { path, owner } = frame
      const value = node.value
      switch (value.kind) {
        case 'header': case 'trivia': case 'close': case 'source-only': break
        case 'namespace': frames.push({ nodes: node.children!, path: openNamespace(path, value.path, value.label), owner: undefined, index: 0 }); break
        case 'class': {
          const declaration = value.declaration
          const cls = ensureClass(classMap, declaration.id, declaration.generic)
          if (declaration.label !== undefined) cls.label = normalizeBrTags(declaration.label)
          if (declaration.className !== undefined) cls.className = declaration.className
          claim(cls.id, path)
          if (node.children) frames.push({ nodes: node.children, path, owner: cls, index: 0 })
          break
        }
        case 'member': {
          const cls = value.reference ? ensureClass(classMap, value.reference.id, value.reference.generic) : owner!
          addMember(cls, value.text)
          break
        }
        case 'body-annotation': applyClassAnnotation(owner!, value.text); break
        case 'annotation': {
          const annotation = value.annotation
          if (annotation.placement === 'separate' && !classMap.has(annotation.id)) {
            throw syntaxError({ what: `Annotation targets undeclared class "${annotation.id}"`,
              expectedForm: 'declare the class before a separate annotation',
              example: `class ${annotation.id}\n<<${annotation.annotation}>> ${annotation.id}` })
          }
          const cls = ensureClass(classMap, annotation.id, annotation.generic)
          if (annotation.label !== undefined) cls.label = normalizeBrTags(annotation.label)
          applyClassAnnotation(cls, annotation.annotation)
          claim(cls.id, path)
          break
        }
        case 'interaction': {
          const cls = ensureClass(classMap, value.interaction.id, value.interaction.generic)
          cls.href = value.interaction.href
          if (value.interaction.tooltip !== undefined) cls.tooltip = value.interaction.tooltip
          claim(cls.id, path)
          break
        }
        case 'note':
          if (value.reference) ensureClass(classMap, value.reference.id, value.reference.generic)
          diagram.notes.push({ text: normalizeBrTags(value.text), ...(value.reference ? { for: value.reference.id } : {}) })
          break
        case 'title': diagram.title = value.text; break
        case 'direction': diagram.direction = value.direction; break
        case 'relationship': {
          const { fromGeneric, toGeneric, ...relationship } = value.relationship
          ensureClass(classMap, relationship.from, fromGeneric)
          ensureClass(classMap, relationship.to, toGeneric)
          diagram.relationships.push(relationship)
          break
        }
        case 'classDef': for (const name of value.names) diagram.classDefs.set(name, { ...value.props }); break
        case 'assignment': case 'style':
          for (const reference of value.references) {
            const cls = ensureClass(classMap, reference.id, reference.generic)
            if (value.kind === 'assignment') cls.className = value.name
            else cls.inlineStyle = { ...cls.inlineStyle, ...value.props }
            claim(cls.id, path)
          }
          break
        case 'unknown': break // diagnostics above refuse partial rendering
      }
    }
  }
  visit(tree.statements)
  diagram.classes = [...classMap.values()]
  return diagram
}

/** Ensure a class exists in the map, creating a default if needed */
function ensureClass(classMap: Map<string, ClassNode>, id: string, generic?: string): ClassNode {
  let cls = classMap.get(id)
  if (!cls) {
    cls = { id, label: generic ? `${id}<${generic}>` : id, generic, attributes: [], methods: [] }
    classMap.set(id, cls)
  } else if (generic && !cls.generic) {
    cls.generic = generic
    if (cls.label === id) cls.label = `${id}<${generic}>`
  }
  return cls
}

/** Parse a class member line (attribute or method) */
function parseMember(line: string): { member: ClassMember; isMethod: boolean } | null {
  const trimmed = line.trim().replace(/;$/, '')
  if (!trimmed) return null

  // Extract visibility prefix
  let visibility: ClassMember['visibility'] = ''
  let rest = trimmed
  if (/^[+\-#~]/.test(rest)) {
    visibility = rest[0] as ClassMember['visibility']
    rest = rest.slice(1).trim()
  }

  // Check if it's a method (has parentheses)
  const methodMatch = rest.match(/^(.+?)\(([^)]*)\)(?:\s*(.+))?$/)
  if (methodMatch) {
    const name = methodMatch[1]!.trim()
    const params = methodMatch[2]?.trim() || undefined // Store the parameter string
    const type = methodMatch[3]?.trim()
    // Check for static ($) or abstract (*) markers
    const isStatic = name.endsWith('$') || rest.includes('$')
    const isAbstract = name.endsWith('*') || rest.includes('*')
    return {
      member: {
        visibility,
        name: name.replace(/[$*]$/, ''),
        type: type || undefined,
        isStatic,
        isAbstract,
        isMethod: true,
        params,
      },
      isMethod: true,
    }
  }

  // It's an attribute: [Type] name or name Type
  // Common patterns: "String name", "+int age", "name"
  const parts = rest.split(/\s+/)
  let name: string
  let type: string | undefined

  if (parts.length >= 2) {
    // "Type name" pattern
    type = parts[0]
    name = parts.slice(1).join(' ')
  } else {
    name = parts[0] ?? rest
  }

  const isStatic = name.endsWith('$')
  const isAbstract = name.endsWith('*')

  return {
    member: {
      visibility,
      name: name.replace(/[$*]$/, ''),
      sourceText: trimmed.replace(/[$*]$/, ''),
      type: type || undefined,
      isStatic,
      isAbstract,
      isMethod: false,
    },
    isMethod: false,
  }
}

/** Parse a relationship line into a ClassRelationship */
export function parseClassRelationship(line: string): (ClassRelationship & { fromGeneric?: string; toGeneric?: string }) | null {
  // A trailing `%%` comment is not part of the relationship; where Mermaid
  // accepts one is classCommentRejections' rule.
  const comment = classCommentStart(line)
  if (comment >= 0) line = line.slice(0, comment).trimEnd()
  const markerless = parseMarkerlessClassRelationship(line)
  if (markerless) return markerless
  const marked = parseMarkedClassRelationship(line)
  if (marked) return marked

  // Lollipop interface endpoints are distinct UML semantics, not associations.
  const lollipop = !isEscapedMarkedClassRelationshipCandidate(line)
    ? line.match(/^(\S+?)\s+(\(\)--|--\(\))\s+(\S+?)(?:\s*:\s*(.+))?$/)
    : null
  if (lollipop) {
    const fromRef = parseClassReference(lollipop[1]!)
    const toRef = parseClassReference(lollipop[3]!)
    if (!fromRef || !toRef || !supportedRelationEndpoint(fromRef.id, lollipop[1]!) || !supportedRelationEndpoint(toRef.id, lollipop[3]!)) return null
    return {
      from: fromRef.id, to: toRef.id, type: 'lollipop', markerAt: lollipop[2] === '()--' ? 'from' : 'to',
      ...(lollipop[4]?.trim() ? { label: normalizeBrTags(lollipop[4]!.trim()) } : {}),
      ...(fromRef.generic ? { fromGeneric: fromRef.generic } : {}), ...(toRef.generic ? { toGeneric: toRef.generic } : {}),
    }
  }

  // Two-ended Mermaid relations: [Relation Type][Link][Relation Type].
  const twoWay = !isEscapedMarkedClassRelationshipCandidate(line)
    ? line.match(/^(\S+?)\s+(?:"([^"]*?)"\s+)?(<\||\*|o|<|>)(--|\.\.)(\|>|\*|o|>|<)\s+(?:"([^"]*?)"\s+)?(\S+?)(?:\s*:\s*(.+))?$/)
    : null
  if (twoWay) {
    const fromRef = parseClassReference(twoWay[1]!)
    const toRef = parseClassReference(twoWay[7]!)
    if (!fromRef || !toRef || !supportedRelationEndpoint(fromRef.id, twoWay[1]!) || !supportedRelationEndpoint(toRef.id, twoWay[7]!)) return null
    const dashed = twoWay[4] === '..'
    const fromType = endpointRelationshipType(twoWay[3]!, dashed)
    const toType = endpointRelationshipType(twoWay[5]!, dashed)
    return {
      from: fromRef.id, to: toRef.id, type: fromType, markerAt: 'both', fromType, toType,
      ...(twoWay[2] ? { fromCardinality: normalizeBrTags(twoWay[2]!) } : {}),
      ...(twoWay[6] ? { toCardinality: normalizeBrTags(twoWay[6]!) } : {}),
      ...(twoWay[8]?.trim() ? { label: normalizeBrTags(twoWay[8]!.trim()) } : {}),
      ...(fromRef.generic ? { fromGeneric: fromRef.generic } : {}), ...(toRef.generic ? { toGeneric: toRef.generic } : {}),
    }
  }

  // Once a one-way arrow has reached the bounded scanner, do not let the
  // legacy regex re-admit a malformed label or endpoint it rejected.
  if (isMarkedClassRelationshipCandidate(line) || isEscapedMarkedClassRelationshipCandidate(line)) return null

  // Relationship regex — handles ordinary one-ended arrows.
  const match = line.match(
    /^(\S+?)\s+(?:"([^"]*?)"\s+)?(<\|--|<\|\.\.|\*--|o--|-->|--\*|--o|--\|>|\.\.>|\.\.\|>|<--|<\.\.?)\s+(?:"([^"]*?)"\s+)?(\S+?)(?:\s*:\s*(.+))?$/
  )
  if (!match) return null

  const fromRef = parseClassReference(match[1]!)
  const toRef = parseClassReference(match[5]!)
  if (!fromRef || !toRef || !supportedRelationEndpoint(fromRef.id, match[1]!) || !supportedRelationEndpoint(toRef.id, match[5]!)) return null
  const from = fromRef.id
  const rawFromCardinality = match[2]
  const fromCardinality = rawFromCardinality ? normalizeBrTags(rawFromCardinality) : undefined
  const arrow = match[3]!.trim()
  const rawToCardinality = match[4]
  const toCardinality = rawToCardinality ? normalizeBrTags(rawToCardinality) : undefined
  const to = toRef.id
  const rawLabel = match[6]?.trim()
  const label = rawLabel ? normalizeBrTags(rawLabel) : undefined

  const parsed = parseArrow(arrow)
  if (!parsed) return null

  return {
    from, to, type: parsed.type, markerAt: parsed.markerAt, label,
    fromCardinality, toCardinality,
    ...(fromRef.generic ? { fromGeneric: fromRef.generic } : {}),
    ...(toRef.generic ? { toGeneric: toRef.generic } : {}),
  }
}

const MARKED_ONE_WAY_ARROWS = [
  '<|--', '<|..', '--|>', '..|>', '<--', '<..', '-->', '..>', '*--', '--*', 'o--', '--o',
] as const
const MARKED_SUFFIX_ARROWS = ['--|>', '-->', '--*', '--o'] as const

/** The legacy marked-link regex needs whitespace-delimited endpoints. Scan
 * the one-way operator outside escaped IDs/cardinalities so compact ordinary
 * links and space-bearing backtick IDs use the same bounded grammar. */
function parseMarkedClassRelationship(line: string): (ClassRelationship & { fromGeneric?: string; toGeneric?: string }) | null {
  let inBacktick = false
  let inQuote = false
  let inGeneric = false
  let operator = -1
  let arrow: string | undefined
  for (let i = 0; i < line.length; i++) {
    const char = line[i]!
    if (inBacktick) { if (char === '`') inBacktick = false; continue }
    if (inQuote) { if (char === '"') inQuote = false; continue }
    if (inGeneric) { if (char === '~') inGeneric = false; continue }
    if (char === '`') { inBacktick = true; continue }
    if (char === '"') { inQuote = true; continue }
    if (char === '~') { inGeneric = true; continue }
    // Arrow-looking bytes after the label separator are label text.
    if (char === ':' && operator >= 0) break
    const found = MARKED_ONE_WAY_ARROWS.find(token => line.startsWith(token, i))
    if (!found) continue
    // In `Foo-->B`, the final `o` of Foo overlaps `o--` but the complete
    // suffix arrow starts one byte later. Prefer that arrow. `Ao--B` has no
    // competing suffix arrow; the markerless parser already handles it as a
    // bare link from `Ao` to `B`, matching Mermaid. A separate `o--` token
    // after whitespace (as in `A o--out`) must keep its prefix meaning.
    if (found === 'o--' && /[\w$]/.test(line[i - 1] ?? '')
      && MARKED_SUFFIX_ARROWS.some(token => line.startsWith(token, i + 1))) continue
    if (operator >= 0) return null
    operator = i
    arrow = found
    i += found.length - 1
  }
  if (operator < 0 || !arrow) return null

  let left = line.slice(0, operator).trim()
  let right = line.slice(operator + arrow.length).trim()
  let fromCardinality: string | undefined
  if (left.endsWith('"')) {
    const start = left.lastIndexOf('"', left.length - 2)
    if (start >= 0) {
      fromCardinality = normalizeBrTags(left.slice(start + 1, -1))
      left = left.slice(0, start).trimEnd()
    }
  }
  let label: string | undefined
  inBacktick = false
  inQuote = false
  inGeneric = false
  for (let i = 0; i < right.length; i++) {
    const char = right[i]!
    if (inBacktick) { if (char === '`') inBacktick = false; continue }
    if (inQuote) { if (char === '"') inQuote = false; continue }
    if (inGeneric) { if (char === '~') inGeneric = false; continue }
    if (char === '`') { inBacktick = true; continue }
    if (char === '"') { inQuote = true; continue }
    if (char === '~') { inGeneric = true; continue }
    if (char === ':') {
      const rawLabel = right.slice(i + 1).trim()
      if (!rawLabel || rawLabel.includes(':') || rawLabel.includes(';')) return null
      label = normalizeBrTags(rawLabel)
      right = right.slice(0, i).trimEnd()
      break
    }
  }
  let toCardinality: string | undefined
  if (right.startsWith('"')) {
    const close = right.indexOf('"', 1)
    if (close < 0) return null
    toCardinality = normalizeBrTags(right.slice(1, close))
    right = right.slice(close + 1).trimStart()
  }
  const fromRef = parseClassReference(left)
  const toRef = parseClassReference(right)
  const parsed = parseArrow(arrow)
  if (!fromRef || !toRef || !parsed || !supportedRelationEndpoint(fromRef.id, left) || !supportedRelationEndpoint(toRef.id, right)) return null
  return {
    from: fromRef.id, to: toRef.id, type: parsed.type, markerAt: parsed.markerAt,
    ...(label ? { label } : {}),
    ...(fromCardinality !== undefined ? { fromCardinality } : {}),
    ...(toCardinality !== undefined ? { toCardinality } : {}),
    ...(fromRef.generic ? { fromGeneric: fromRef.generic } : {}),
    ...(toRef.generic ? { toGeneric: toRef.generic } : {}),
  }
}

/** Mermaid permits spaces to be omitted around bare `--` and `..` links.
 * Locate one operator outside IDs/cardinalities in linear time; the existing
 * arrow grammar below remains responsible for marked relationships. */
function parseMarkerlessClassRelationship(line: string): (ClassRelationship & { fromGeneric?: string; toGeneric?: string }) | null {
  const operator = findMarkerlessRelationshipOperator(line)
  if (operator < 0) return null

  const left = line.slice(0, operator).trim()
  let right = line.slice(operator + 2).trim()
  let fromRef = parseClassReference(left)
  let fromCardinality: string | undefined
  if (!fromRef && left.endsWith('"')) {
    const cardStart = left.lastIndexOf('"', left.length - 2)
    if (cardStart >= 0) {
      fromRef = parseClassReference(left.slice(0, cardStart).trimEnd())
      if (fromRef) fromCardinality = normalizeBrTags(left.slice(cardStart + 1, -1))
    }
  }
  if (!fromRef) return null

  // The first top-level colon separates a label; colons inside backtick IDs,
  // generic parameters, and cardinalities belong to those tokens instead.
  let inBacktick = false
  let inQuote = false
  let inGeneric = false
  let label: string | undefined
  for (let i = 0; i < right.length; i++) {
    const char = right[i]!
    if (inBacktick) { if (char === '`') inBacktick = false; continue }
    if (inQuote) { if (char === '"') inQuote = false; continue }
    if (inGeneric) { if (char === '~') inGeneric = false; continue }
    if (char === '`') { inBacktick = true; continue }
    if (char === '"') { inQuote = true; continue }
    if (char === '~') { inGeneric = true; continue }
    if (char === ':') {
      const rawLabel = right.slice(i + 1).trim()
      // Mermaid requires non-empty Class label text and rejects a second
      // colon or semicolon. Numeric entities need separate source-normalizer
      // work before native/agent rendering can claim them consistently.
      if (!rawLabel || rawLabel.includes(':') || rawLabel.includes(';')) return null
      label = normalizeBrTags(rawLabel)
      right = right.slice(0, i).trim()
      break
    }
  }

  let toCardinality: string | undefined
  if (right.startsWith('"')) {
    const close = right.indexOf('"', 1)
    if (close < 0) return null
    toCardinality = normalizeBrTags(right.slice(1, close))
    right = right.slice(close + 1).trim()
  }
  const toRef = parseClassReference(right)
  if (!toRef) return null
  if (!supportedRelationEndpoint(fromRef.id, left) || !supportedRelationEndpoint(toRef.id, right)) return null
  return {
    from: fromRef.id,
    to: toRef.id,
    type: line[operator] === '.' ? 'link-dashed' : 'link-solid',
    markerAt: 'none',
    ...(label ? { label } : {}),
    ...(fromCardinality !== undefined ? { fromCardinality } : {}),
    ...(toCardinality !== undefined ? { toCardinality } : {}),
    ...(fromRef.generic ? { fromGeneric: fromRef.generic } : {}),
    ...(toRef.generic ? { toGeneric: toRef.generic } : {}),
  }
}

const BARE_RELATION_RESERVED_IDS = new Set([
  'o', 'class', 'note', 'namespace', 'click', 'link', 'style', 'classDef', 'cssClass',
])
const BARE_RELATION_ESCAPED_RESERVED_IDS = new Set(['note', 'click', 'link', 'cssClass'])

/** Mermaid's relationship endpoint lexer reserves keywords/`o` and rejects
 * unescaped dollar signs. Escaped IDs containing `~` denote a generic base
 * identity upstream, which this relationship model cannot yet preserve. */
export function supportedRelationEndpoint(id: string, raw: string): boolean {
  return raw.startsWith('`')
    ? !BARE_RELATION_ESCAPED_RESERVED_IDS.has(id) && !id.includes('~')
    : !id.includes('$') && !BARE_RELATION_RESERVED_IDS.has(id)
}

function findMarkerlessRelationshipOperator(line: string): number {
  let inBacktick = false
  let inQuote = false
  let inGeneric = false
  for (let i = 0; i < line.length - 1; i++) {
    const char = line[i]!
    if (inBacktick) { if (char === '`') inBacktick = false; continue }
    if (inQuote) { if (char === '"') inQuote = false; continue }
    if (inGeneric) { if (char === '~') inGeneric = false; continue }
    if (char === '`') { inBacktick = true; continue }
    if (char === '"') { inQuote = true; continue }
    if (char === '~') { inGeneric = true; continue }
    if ((char === '-' || char === '.') && line[i + 1] === char) return i
  }
  return -1
}

/** Distinguish marked arrows from malformed bare links without confusing an
 * endpoint ID ending/starting with `o` (for example `Foo--B` or `A--out`). */
function isMarkedRelationshipOperator(line: string, operator: number): boolean {
  const before = line.slice(0, operator).trimEnd()
  const after = line.slice(operator + 2)
  if (line[operator] === '.') {
    return /(?:<\||<)$/.test(before) || /^(?:>|\|>)/.test(after)
  }
  const spacedPrefixO = before.endsWith('o')
    && /\s/.test(before[before.length - 2] ?? '')
    && before.slice(0, -2).trim().length > 0
  return /(?:<\||<|\*|\(\))$/.test(before) || spacedPrefixO
    || /^(?:>|\|>|\*|o\s+(?![:%])\S|\(\))/.test(after)
}

/** Only the shared parser may accept bare links. A failed bare-link parse must
 * not be reinterpreted by the agent's legacy marked-arrow fallback. */
export function isBareClassRelationshipCandidate(line: string): boolean {
  const operator = findMarkerlessRelationshipOperator(line)
  return operator >= 0 && !isMarkedRelationshipOperator(line, operator)
}

export function isMarkedClassRelationshipCandidate(line: string): boolean {
  const operator = findMarkerlessRelationshipOperator(line)
  return operator >= 0 && isMarkedRelationshipOperator(line, operator)
}

/** An escaped *endpoint* on a marked link, as opposed to a backtick in its
 * label or quoted cardinality. Failed scanner parses must stay failed in both
 * the native parser and the agent's legacy regex fallback. Two-ended and
 * lollipop forms are deliberately diagnosed until their line style/synthetic
 * interface semantics can be represented faithfully. */
export function isEscapedMarkedClassRelationshipCandidate(line: string): boolean {
  if (!line.includes('`')) return false
  const operator = findMarkerlessRelationshipOperator(line)
  if (operator < 0) return false
  const before = line.slice(0, operator).trimEnd()
  const afterOperator = line.slice(operator + 2)
  // The bare-link discriminator predates two-ended dashed diamond/circle
  // markers. Such escaped links must not fall through to a solid two-way edge.
  const dashedTwoEnded = line[operator] === '.'
    && /(?:\*|o)$/.test(before)
    && /^(?:\*|o|>|\|>|<)/.test(afterOperator)
  if (!isMarkedRelationshipOperator(line, operator) && !dashedTwoEnded) return false
  if (line.slice(0, operator).trimStart().startsWith('`')) return true
  let after = line.slice(operator + 2).trimStart()
  after = after.replace(/^(?:\|>|[>*o]|\(\))\s*/, '')
  after = after.replace(/^"[^"]*"\s*/, '')
  return after.startsWith('`')
}

/**
 * Map arrow syntax to relationship type and marker placement side.
 * Prefix markers (`<|--`, `*--`, `o--`) place the UML shape at the 'from' end.
 * Suffix markers (`..|>`, `-->`, `..>`, `--*`, `--o`) place it at the 'to' end.
 */
function endpointRelationshipType(token: string, dashed: boolean): RelationshipType {
  if (token === '*' ) return 'composition'
  if (token === 'o') return 'aggregation'
  if (token.includes('|')) return dashed ? 'realization' : 'inheritance'
  return dashed ? 'dependency' : 'association'
}

function parseArrow(arrow: string): { type: RelationshipType; markerAt: 'from' | 'to' } | null {
  // Trim whitespace that might be captured by the regex
  const a = arrow.trim()
  switch (a) {
    case '<|--': return { type: 'inheritance',  markerAt: 'from' }
    case '--|>': return { type: 'inheritance',  markerAt: 'to' }
    case '<|..': return { type: 'realization',  markerAt: 'from' }
    case '..|>': return { type: 'realization',  markerAt: 'to' }
    case '*--':  return { type: 'composition',  markerAt: 'from' }
    case '--*':  return { type: 'composition',  markerAt: 'to' }
    case 'o--':  return { type: 'aggregation',  markerAt: 'from' }
    case '--o':  return { type: 'aggregation',  markerAt: 'to' }
    case '-->':  return { type: 'association',  markerAt: 'to' }
    case '<--':  return { type: 'association',  markerAt: 'from' }
    case '..>':  return { type: 'dependency',   markerAt: 'to' }
    case '<..':  return { type: 'dependency',   markerAt: 'from' }
    default:     return null
  }
}
