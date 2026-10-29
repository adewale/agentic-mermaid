import { decodeXML } from 'entities'
import { normalizeBrTags } from '../multiline-utils.ts'
import { isSafeActionHref } from '../output-security.ts'
import { parseAccessibilityDirective, requireClosedAccessibility, scanAccessibilityDirectives } from '../shared/accessibility-directives.ts'
import { assertClassDiagramWork } from '../shared/diagram-limits.ts'
import { parseDirectionStatement } from '../shared/direction-statement.ts'
import { observeParserMutation, observeParserStatement, parserObservationActive } from '../shared/parser-observation.ts'
import { parseClassLikeStyleDeclarations, parseClassLikeStyleProps } from '../shared/class-like-style.ts'
import { mergeStyleProps } from '../shared/style-props.ts'
import { syntaxError } from '../shared/syntax-error.ts'
import { classInterfaceSide, createClassInterfaceAllocator } from './interface-occurrences.ts'
import { classTextLabel, decodeClassText } from './text.ts'
import type { ClassDiagram, ClassMember, ClassNamespace, ClassNode, ClassRelationship, RelationshipType } from './types.ts'

// ---- Shared namespace grammar ----------------------------------------------
// One grammar, two consumers: this render parser and the agent body parser
// (src/agent/class-body.ts) both parse namespace headers through
// parseNamespaceHeader, so membership cannot drift between the surfaces (C1).

/** Namespace path atoms may be bare identifiers or backtick-quoted names. */
const NAMESPACE_OPEN_RE = /^namespace\s+((?:`[^`\r\n]+`|[\w$]+)(?:\.(?:`[^`\r\n]+`|[\w$]+))*)(?:\s*\[\s*"?([^\]"]*)"?\s*\])?\s*\{/

/** Parse a `namespace … {` opener into its dot path + optional label. */
export function parseNamespaceHeader(line: string): { path: string[]; label?: string } | null {
  const m = line.match(NAMESPACE_OPEN_RE)
  if (!m || m[0].length !== line.length) return null
  const path = [...m[1]!.matchAll(/`[^`]+`|[\w$]+/g)].map(atom => (atom[0].startsWith('`') ? atom[0].slice(1, -1) : atom[0]))
  return { path, label: m[2] || undefined }
}

/** Expand compact namespace boundaries, even when the first statement shares
 * the opener line and the closing brace occurs on a later physical line.
 * Quotes protect authored punctuation; class member braces stay with their
 * declaration rather than being confused with a namespace close. */
export function expandInlineNamespaceStatement(line: string): string[] {
  return scanInlineNamespaceStatement(line).map(fragment => fragment.text)
}

interface ClassStatementFragment {
  text: string
  followsNamespaceCloseOnSameLine?: true
  compactSemicolon?: true
}

/** Retain delimiter provenance while expanding, so the shared reader can
 * diagnose statements after a namespace close on the same physical line. */
function scanInlineNamespaceStatement(line: string): ClassStatementFragment[] {
  const match = line.match(NAMESPACE_OPEN_RE)
  if (!match) return [{ text: line }]
  const opener = match[0]
  const tail = line.slice(opener.length).trim()
  if (!tail || tail.startsWith('%%')) return [{ text: line }]
  const body: ClassStatementFragment[] = []
  let start = 0
  let quote: string | undefined
  let braces = 0
  let followsClose = false
  let compactSemicolon = false
  const append = (text: string): void => {
    text = text.trim()
    if (text) body.push({ text, ...(followsClose ? { followsNamespaceCloseOnSameLine: true } : {}) })
  }
  for (let index = 0; index < tail.length; index++) {
    const character = tail[index]!
    if (quote) {
      if (character === '\\' && quote === '"') {
        index++
        continue
      }
      if (character === quote) quote = undefined
    } else if (character === '"' || character === '`' || character === '~') quote = character
    else if (character === '{') braces++
    else if (character === '}' && braces > 0) braces--
    else if (braces === 0 && (character === ';' || character === '}')) {
      const fragment = tail.slice(start, index)
      // Class text rules protect percent pairs in URLs and callback arguments.
      // Classify comments once per bounded fragment, not once per percent pair.
      // A delimiter inside a real comment belongs to the remaining raw text.
      if (classCommentStart(fragment) >= 0) break
      append(fragment)
      if (character === ';' && !followsClose) compactSemicolon = true
      if (character === '}') body.push({ text: '}' })
      if (character === '}') followsClose = true
      start = index + 1
    }
  }
  append(tail.slice(start))
  return [{ text: opener, ...(compactSemicolon ? { compactSemicolon: true } : {}) }, ...body]
}

/** Split entity-created physical lines while retaining every other authored
 * entity for Class quote-boundary validation. */
export function splitAuthoredClassLine(line: string): string[] {
  return line
    .replace(/&(?:#(?:[xX][0-9a-fA-F]+|[0-9]+)|[A-Za-z][A-Za-z0-9]+);/g, token => {
      const decoded = decodeXML(token)
      return /[\r\n]/.test(decoded) ? decoded : token
    })
    .split(/\r\n|\r|\n/)
}

/** Match decoded Class statements to authored bytes one statement at a time.
 * Entity-created comments/directives and compact namespace expansions must
 * never shift quote provenance for an unrelated later link. */
function authoredClassStatements(lines: string[]): Array<string | undefined> {
  const authored = lines
    .flatMap(splitAuthoredClassLine)
    .map(line => line.trim())
    .filter(line => {
      const semantic = decodeXML(line).trim()
      return semantic.length > 0 && !semantic.startsWith('%%')
    })
  const semantic = authored.map(line => decodeXML(line))
  const statements: Array<string | undefined> = []
  const add = (raw: string | undefined, decoded: string): void => {
    const decodedParts = expandInlineNamespaceStatement(decoded)
    const rawParts = raw === undefined ? [] : expandInlineNamespaceStatement(raw)
    if (rawParts.length === decodedParts.length && rawParts.every((part, index) => decodeXML(part) === decodedParts[index])) {
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
      add(candidate !== undefined && decodeXML(candidate).trim() === directive.suffixLine.trim() ? candidate : undefined, directive.suffixLine.trim())
    }
    index = directive.endIndex
  }
  return statements
}

// Shared class declaration grammar. The structured serializer emits bracket
// labels, so the renderer and agent parser must resolve them to the same
// logical ID instead of treating `A["Label"]` as an identifier.
const CLASS_ID_SOURCE = '`[^`]+`|[\\w$\\p{L}\\p{N}\\p{M}]+(?:[.-][\\w$\\p{L}\\p{N}\\p{M}]+)*'
const CLASS_DECLARATION_RE = new RegExp(`^class\\s+(${CLASS_ID_SOURCE})(?:\\s*~([^~]+)~)?(?:\\s*\\[\\s*"([^"]*)"\\s*\\])?(?:\\s+as\\s+"([^"]+)")?(?:\\s+~([^~]+)~)?(?:\\s*:::([\\w-]+))?\\s*(\\{\\s*\\}|\\{)?\\s*$`, 'u')
const CLASS_REFERENCE_RE = new RegExp(`^(${CLASS_ID_SOURCE})(?:~([^~]+)~)?$`, 'u')

export interface ParsedClassDeclaration {
  id: string
  label?: string
  generic?: string
  className?: string
  /** `class A <<interface>> {`: an inline annotation before the body. */
  annotation?: string
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
  const match = token.trim().match(CLASS_REFERENCE_RE)
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
  /** `class A:::c <<interface>>`: the declaration's style class. */
  className?: string
  /** The statement goes on to open the class's member block. */
  opensBody?: true
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
    if (inBacktick) {
      if (char === '`') inBacktick = false
      continue
    }
    if (inQuote) {
      if (char === '"') inQuote = false
      continue
    }
    if (inGeneric) {
      if (char === '~') inGeneric = false
      continue
    }
    if (char === '`') {
      inBacktick = true
      continue
    }
    if (char === '"') {
      inQuote = true
      continue
    }
    if (char === '~' && bracketDepth === 0) {
      inGeneric = true
      continue
    }
    if (char === '[') {
      bracketDepth++
      continue
    }
    if (char === ']') {
      bracketDepth = Math.max(0, bracketDepth - 1)
      continue
    }
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
  // The class body may follow an inline annotation (Mermaid 11.14): `{`
  // opens it, `{}` leaves it empty.
  const block = bodyInline ? undefined : annotationText.match(/\{\s*\}?$/)?.[0]
  if (block) annotationText = annotationText.slice(0, -block.length).trim()
  const declaration = parseClassDeclaration(`class ${declarationText}`)
  const annotation = bodyInline ? parseClassBodyAnnotationToken(annotationText) : parseClassAnnotationToken(annotationText)
  return declaration && !declaration.opensBody && annotation !== null
    ? {
        id: declaration.id,
        ...(declaration.generic ? { generic: declaration.generic } : {}),
        ...(declaration.label !== undefined ? { label: declaration.label } : {}),
        annotation,
        placement: bodyInline ? 'body-inline' : 'inline',
        ...(declaration.className !== undefined ? { className: declaration.className } : {}),
        ...(block === '{' ? { opensBody: true as const } : {}),
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
  node.annotation = decodeClassText(annotation)
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

/** The paint of a `classDef` or `style` line without a trailing `%%`
 * comment. Mermaid's LABEL token reads the comment into the last property's
 * value, which CSS then drops; ours reads it as the comment it is. */
export function withoutStyleComment(style: string): string {
  const comment = style.indexOf('%%')
  return comment < 0 ? style : style.slice(0, comment).trimEnd()
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
  | { kind: 'classDef'; names: string[]; props: Record<string, string>; declarations: import('../shared/style-props.ts').StyleDeclaration[] }
  /** A style class assigned to classes: `cssClass "A,B" c`, which Mermaid
   * applies only to classes that exist, or a form Mermaid reads otherwise
   * (`class A c`, unquoted `cssClass A c`, `A:::c` on its own). */
  | { kind: 'assignment'; references: ClassReference[]; name: string; form: 'cssClass' | 'cssClassUnquoted' | 'class' | 'shorthand' }
  | { kind: 'style'; references: ClassReference[]; props: Record<string, string>; declarations: import('../shared/style-props.ts').StyleDeclaration[] }
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
  /** A readable compact extension that Mermaid requires a newline for. */
  followsNamespaceCloseOnSameLine?: true
  /** The same after a class body's closing brace. */
  followsClassCloseOnSameLine?: true
  /** A semicolon used as syntax rather than protected quoted data. */
  compactSemicolon?: true
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
  if (/^classDiagram(?:-v2)?\s*$/i.test(text)) return { kind: 'header' }
  if (!text || text.startsWith('%%')) return { kind: 'trivia' }
  if (text === '}') return { kind: 'close' }
  const interaction = authored !== undefined ? parseClassInteractionWithAuthored(authored) : null
  if (interaction) return { kind: 'interaction', interaction }
  // These actions have an established inert sidecar surface. They remain
  // opaque to editing, but rendering their target is safe and intentional.
  if (/^callback\s+(?:`[^`]+`|[\w$]+)(?:~[^~]+~)?\s+"[^"\r\n]+"(?:\s+"[^"\r\n]*")?\s*$/i.test(text) || /^click\s+(?:`[^`]+`|[\w$]+)(?:~[^~]+~)?\s+call\s+.+$/i.test(text) || /^(?:click|link)\s+(?:`[^`]+`|[\w$]+)(?:~[^~]+~)?\s+(?:href\s+)?"(?!(?:https?:\/\/|mailto:))[^"\r\n]*"(?:\s+"[^"\r\n]*")?\s*$/i.test(text)) {
    return { kind: 'source-only', reason: 'Class callback or unsafe/relative link is retained as inert source-only action metadata' }
  }
  // Validate note delimiters against authored bytes, then decode content.
  // Entity quotes are text, not fresh syntax introduced by render normalization.
  // Mermaid's string has no escapes (`"C:\"` is the text `C:\`); ours reads
  // `\"` as a quote only where Mermaid's reading leaves the line unread.
  const noteSource = classStatement((authored ?? text).trim())
  const plainNote = noteSource.match(/^note(?:\s+for\s+(\S+))?\s+"([^"]*)"\s*$/i)
  const note = plainNote ?? noteSource.match(/^note(?:\s+for\s+(\S+))?\s+"((?:\\.|[^"\\])*)"\s*$/i)
  if (note) {
    const reference = note[1] ? parseClassReference(decodeXML(note[1])) : undefined
    if (!note[1] || reference)
      return {
        kind: 'note',
        text: decodeXML(plainNote ? note[2]! : note[2]!.replace(/\\(["\\])/g, '$1')),
        ...(reference ? { reference } : {}),
        ...(!plainNote ? { escapedQuotes: true } : {}),
      }
  }
  const title = text.match(/^title\s+(.+)$/i)
  if (title) return { kind: 'title', text: title[1]!.trim() }
  const direction = parseDirectionStatement(text)
  if (direction) return { kind: 'direction', direction }
  const namespace = parseNamespaceHeader(text)
  if (namespace) return { kind: 'namespace', ...namespace }
  const references = (raw: string): ClassReference[] | null => {
    const refs = raw
      .replace(/^"|"$/g, '')
      .split(',')
      .map(value => parseClassReference(value.trim()))
    return refs.every((ref): ref is ClassReference => ref !== null) ? refs : null
  }
  const classDef = text.match(/^classDef\s+([\w,-]+)\s+(.+)$/)
  if (classDef) {
    const props = parseClassLikeStyleProps(withoutStyleComment(classDef[2]!))
    if (Object.keys(props).length > 0) return { kind: 'classDef', names: classDef[1]!.split(',').filter(Boolean), props, declarations: parseClassLikeStyleDeclarations(withoutStyleComment(classDef[2]!)) }
  }
  const assignment = text.match(/^(class|cssClass)\s+(.+?)\s+([\w-]+)$/)
  if (assignment && !text.includes('{') && !text.includes('[') && !text.includes(' as ')) {
    // Mermaid's cssClass names classes by their ids as written, `my class`
    // too, parted by commas.
    const quoted = assignment[1] === 'cssClass' && /^"[^"]*"$/.test(assignment[2]!)
    const refs = quoted
      ? assignment[2]!
          .slice(1, -1)
          .split(',')
          .map(value => parseClassReference(value.trim()) ?? (value.trim() ? { id: value.trim() } : null))
      : references(assignment[2]!)
    if (refs?.every((ref): ref is ClassReference => ref !== null)) {
      return { kind: 'assignment', references: refs, name: assignment[3]!, form: assignment[1] === 'class' ? 'class' : quoted ? 'cssClass' : 'cssClassUnquoted' }
    }
  }
  const style = text.match(/^style\s+(.+?)\s+(.+)$/)
  if (style) {
    const refs = references(style[1]!)
    const props = parseClassLikeStyleProps(withoutStyleComment(style[2]!))
    if (refs && Object.keys(props).length > 0) return { kind: 'style', references: refs, props, declarations: parseClassLikeStyleDeclarations(withoutStyleComment(style[2]!)) }
  }
  const annotation = parseClassAnnotationStatement(text)
  if (annotation?.opensBody) {
    const { id, generic, label, className } = annotation
    return { kind: 'class', declaration: { id, generic, label, ...(className !== undefined ? { className } : {}), annotation: annotation.annotation, opensBody: true } }
  }
  if (annotation) return { kind: 'annotation', annotation }
  const declaration = parseClassDeclaration(text)
  if (declaration && !readsAsClassName(declaration.id, /^class\s+`/.test(text), false)) {
    return { kind: 'unknown', reason: `Unrecognized class statement "${text}": Mermaid reads \`${declaration.id}\` there as a keyword, not a class name` }
  }
  if (declaration) return { kind: 'class', declaration }
  const shorthand = text.match(/^(.+?):::([\w-]+)$/)
  if (shorthand) {
    const reference = parseClassReference(shorthand[1]!)
    if (reference) return { kind: 'assignment', references: [reference], name: shorthand[2]!, form: 'shorthand' }
  }
  const member = text.match(/^(\S+?)\s*:\s*(.+)$/)
  if (member) {
    const reference = parseClassReference(member[1]!)
    if (reference && (!readsAsClassName(reference.id, member[1]!.startsWith('`'), true) || /^call\s/.test(text))) {
      return { kind: 'unknown', reason: `Unrecognized class member statement "${text}": Mermaid reads \`${reference.id}\` there as a keyword, not a class name` }
    }
    if (reference) return { kind: 'member', reference, text: member[2]!.trim() }
  }
  const relationship = parseClassRelationship(text)
  if (relationship) return { kind: 'relationship', relationship }
  const form = text.includes('<<') || text.includes('>>') ? 'annotation' : isBareClassRelationshipCandidate(text) || isMarkedClassRelationshipCandidate(text) || isEscapedMarkedClassRelationshipCandidate(text) ? 'relationship' : /^(?:click|link)\b/i.test(text) ? 'link' : ''
  return { kind: 'unknown', reason: `Unrecognized class${form ? ` ${form}` : ''} statement "${text}"` }
}

// What comes before a string that holds label text: a note's text, a class's
// or namespace's ["label"]. A relationship's cardinality is any string before
// its `: label` in a statement no keyword starts.
const CLASS_LABEL_STRING_PREFIX_RE = /^(?:note(?:\s+for\s+(?:`[^`]*`|\S+))?\s+|(?:class|namespace)\s[^"]*\[\s*)$/i
const CLASS_STRING_KEYWORD_RE = /^(?:class|namespace|note|click|link|callback|cssClass|style|classDef|title|direction)\b|^<</i

/** Whether `text` ends inside a quoted note, label or cardinality, whose
 * string Mermaid reads on across the line break. Mermaid's string has no
 * escapes: `"C:\"` closes at its second quote. Ours reads `\"` in a note as a
 * quote, so text runs on only where the string is open in both readings. */
function continuesClassText(text: string): boolean {
  return [false, true].every(escapes => {
    let quote: string | undefined
    let open = -1
    for (let index = 0; index < text.length; index++) {
      const character = text[index]!
      if (quote) {
        if (escapes && character === '\\' && quote === '"') index++
        else if (character === quote) quote = undefined
      } else if (character === '"' || character === '`') {
        quote = character
        open = index
      }
    }
    if (quote !== '"') return false
    const before = text.slice(0, open)
    return CLASS_LABEL_STRING_PREFIX_RE.test(before) || (!CLASS_STRING_KEYWORD_RE.test(text) && !before.includes(':'))
  })
}

/** Where a class declaration's member block opens: its first `{` outside a
 * quoted label, a backtick name or a ~generic~. */
function classBodyOpenAt(text: string): number {
  let quote: string | undefined
  for (let index = 0; index < text.length; index++) {
    const character = text[index]!
    if (quote) {
      if (character === quote) quote = undefined
    } else if (character === '"' || character === '`' || character === '~') quote = character
    else if (character === '{') return index
  }
  return -1
}

/** The members on the line that opens a class block, split at `;`. Mermaid
 * reads `{+x; +y()}` as one method named `x; +y`; ours reads the two members
 * the author wrote (docs/project/divergences.md). A `;` in a parameter list or
 * ending an entity code (`#59;`, `&amp;`) is text. */
function splitBlockLineMembers(text: string): string[] {
  const members: string[] = []
  let start = 0
  let parens = 0
  for (let index = 0; index < text.length; index++) {
    const character = text[index]!
    if (character === '(') parens++
    else if (character === ')') parens = Math.max(0, parens - 1)
    else if (character === ';' && parens === 0) {
      let word = index
      while (word > start && /\w/.test(text[word - 1]!)) word--
      if (word < index && (text[word - 1] === '#' || text[word - 1] === '&')) continue
      members.push(text.slice(start, index))
      start = index + 1
    }
  }
  members.push(text.slice(start))
  return members.map(member => member.trim()).filter(Boolean)
}

/** Mermaid's lexer ends a statement at a brace, not only at a line break: a
 * class block's `{`, members and `}` may share its line (`class A {+x}`), and
 * a statement's `}` may close the namespace around it (`class B }`). The
 * statements such a line holds, to read one by one, or null. A member runs
 * to a brace, and a `{` in the block is a parse error in Mermaid
 * (`class A { lass B{`), so such a line stays unrecognized. */
function splitClassBlockStatement(text: string, inNamespace: boolean): string[] | null {
  const open = /^class\s/.test(text) ? classBodyOpenAt(text) : -1
  const head = text.slice(0, open + 1)
  const declared = open < 0 ? undefined : classifyClassStatement(head, undefined)
  if (declared?.kind === 'class' && declared.declaration.opensBody) {
    const rest = text.slice(open + 1)
    const close = rest.indexOf('}')
    if (rest.slice(0, close < 0 ? undefined : close).includes('{')) return null
    const after = close < 0 ? '' : rest.slice(close)
    // After the class's `}` Mermaid reads only braces closing namespaces;
    // ours also reads a statement there, and verify reports it.
    const braces = /^[\s}]*/.exec(after)![0]
    const statement = after.slice(braces.length).trim()
    return [head, ...splitBlockLineMembers(close < 0 ? rest : rest.slice(0, close)), ...(braces.match(/\}/g) ?? []), ...(statement ? [statement] : [])]
  }
  if (!inNamespace) return null
  let end = text.length
  while (end > 0 && /[\s}]/.test(text[end - 1]!)) end--
  const statement = text.slice(0, end)
  return end < text.length && statement && classifyClassStatement(statement, undefined).kind !== 'unknown' ? [statement, ...text.slice(end).match(/\}/g)!] : null
}

/** Single owner of namespace and class-body boundaries, classification and
 * malformed/unknown disposition. Retain unknown nodes for lossless callers;
 * renderers must refuse diagnostics instead of drawing a partial diagram. */
/**
 * For each line, the last line of the statement that starts there: a quoted
 * note, label or cardinality runs on to its closing quote, as the statement
 * reader joins it (FamilyOperations.statementEnds).
 */
export function classStatementEnds(lines: readonly string[]): number[] {
  const ends = lines.map((_, index) => index)
  let tree: ClassStatementTree
  try {
    tree = readClassStatements(lines)
  } catch {
    return ends
  }
  const starts: number[] = []
  let offset = 0
  for (const line of lines) {
    starts.push(offset)
    offset += line.length + 1
  }
  const visit = (nodes: readonly ClassStatementNode[]): void => {
    for (const node of nodes) {
      const first = node.source.line - 1
      let last = first
      while (last + 1 < lines.length && starts[last + 1]! <= node.source.end) last++
      if (last > ends[first]!) ends[first] = last
      visit(node.children ?? [])
    }
  }
  visit(tree.statements)
  return ends
}

/** Mermaid's directive (`%%{…}%%`, `diagram-api/regexes.ts`), which its
 * preprocessing removes from the source wherever it stands, before any
 * grammar reads it; its `init` and `wrap` configure the diagram. */
export const MERMAID_DIRECTIVE_RE = /%{2}\{\s*(?:(\w+)\s*:|(\w+))\s*(?:(\w+)|((?:(?!\}%{2}).|\r?\n)*))?\s*(?:\}%{2})?/gi

/** Whole physical rows owned by style declarations, excluding class members
 * and compact rows that also carry a body boundary or another statement. */
export function classStyleStatementLines(lines: readonly string[]): ReadonlySet<number> {
  const result = new Set<number>()
  const pending = [...readClassStatements(lines, undefined, false).statements]
  while (pending.length > 0) {
    const node = pending.pop()!
    if ((node.value.kind === 'style' || node.value.kind === 'classDef')
      && node.raw.trim() === lines[node.source.line - 1]?.trim()) result.add(node.source.line)
    for (const child of node.children ?? []) pending.push(child)
  }
  return result
}

export function readClassStatements(lines: readonly string[], authoredLines?: readonly (string | undefined)[], observe = true): ClassStatementTree {
  const tree: ClassStatementTree = { source: lines.join('\n'), statements: [], diagnostics: [] }
  const stack: ClassStatementNode[] = []
  let offset = 0
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]!
    const span = { line: lineIndex + 1, column: 1, start: offset, end: offset + line.length }
    offset += line.length + 1
    // Read the line as Mermaid's grammar meets it, without its directives.
    let raw = line.replace(MERMAID_DIRECTIVE_RE, '')
    const authored = authoredLines ? authoredLines[lineIndex]?.replace(MERMAID_DIRECTIVE_RE, '') : raw
    const scanned = scanInlineNamespaceStatement(raw.trim())
    const authoredParts = authored === undefined ? [] : expandInlineNamespaceStatement(authored.trim())
    let fragments: Array<ClassStatementFragment & { authored?: string }> = scanned.map((fragment, index) => ({ ...fragment, authored: authoredParts.length === scanned.length ? authoredParts[index] : undefined }))
    // Mermaid's string runs on across line breaks. Where it holds a note, a
    // cardinality or a label, read the lines it spans as one statement with
    // `<br>`, the label line break, for each break, as flowchart does for
    // markdown strings. A link, a tooltip or a backtick name stays on its line.
    const last = fragments.at(-1)!
    let end = lineIndex
    let statement = last.text
    // At most a relationship's two cardinalities; each scan reads on only to
    // the next line holding a quote, which closes Mermaid's string, so the
    // reader stays linear.
    for (let strings = 0; strings < 2 && stack.at(-1)?.value.kind !== 'class' && continuesClassText(statement); strings++) {
      let closing = end + 1
      while (closing < lines.length && !lines[closing]!.includes('"')) closing++
      if (closing === lines.length) break
      statement = [statement, ...lines.slice(end + 1, closing + 1).map(line => line.trim())].join('<br>')
      end = closing
    }
    if (end > lineIndex) {
      for (const line of lines.slice(lineIndex + 1, end + 1)) offset += line.length + 1
      span.end = offset - 1
      lineIndex = end
      raw = statement
      fragments = [...fragments.slice(0, -1), ...scanInlineNamespaceStatement(statement).map(fragment => ({ ...last, ...fragment, authored: undefined }))]
    }
    // Fragments still to read, the next one last, so a statement read apart
    // puts its parts back in its place in time linear in the line.
    const pending = fragments.reverse()
    const whole = pending.length === 1
    let split = false
    // What a `}` closed earlier on this line, if anything.
    let closedOnLine: 'class' | 'namespace' | undefined
    const putBack = (fragment: (typeof pending)[number], parts: string[]): void => {
      for (let index = parts.length - 1; index >= 0; index--) pending.push({ ...fragment, text: parts[index]!, authored: undefined })
      split = true
    }
    while (pending.length > 0) {
      const fragment = pending.pop()!
      const source = fragment.text
      const owner = stack[stack.length - 1]
      const inClass = owner?.value.kind === 'class'
      // In a class body, a closing brace ends the member token even when it
      // follows text on the same line. Outside a body, inline members retain
      // literal braces. Consume each boundary before classifying its suffix.
      const close = inClass ? source.indexOf('}') : source.startsWith('}') ? 0 : -1
      if (close >= 0 && source !== '}' && !source.startsWith('%%')) {
        putBack(fragment, [source.slice(0, close).trim(), '}', source.slice(close + 1).trim()].filter(Boolean))
        continue
      }
      const text = inClass && !source.startsWith('}') ? source : classStatement(source)
      let value: ClassSyntaxValue
      if (!source || source.startsWith('%%')) value = { kind: 'trivia' }
      else if (inClass && text !== '}') {
        const annotation = parseClassBodyAnnotationToken(text)
        // A `{` in a class body opens nothing Mermaid reads (OPEN_IN_STRUCT),
        // on the line that opens the block or a later one, and where the
        // author meant the block to close cannot be told.
        value = text.includes('{') ? { kind: 'unknown', reason: `Unrecognized class member "${text}": a class body cannot hold "{"` }
          : annotation === null ? { kind: 'member', text } : { kind: 'body-annotation', text: annotation }
      } else value = classifyClassStatement(text, fragment.authored)
      // A member is never split: inside a body the splitter would hand back
      // the same text and the reader would never end.
      const parts = value.kind === 'unknown' && !inClass ? splitClassBlockStatement(text, owner?.value.kind === 'namespace') : null
      if (parts) {
        putBack(fragment, parts)
        continue
      }
      const node: ClassStatementNode = { raw: whole && !split ? raw : source, text, source: span, value }
      if (observe && parserObservationActive('class')) observeParserStatement('class', value.kind, text, { line: span.line, column: span.column, offset: span.start, endOffset: span.end, unit: 'normalized' })
      if (fragment.followsNamespaceCloseOnSameLine || (closedOnLine === 'namespace' && value.kind !== 'trivia' && value.kind !== 'close')) node.followsNamespaceCloseOnSameLine = true
      else if (closedOnLine === 'class' && value.kind !== 'trivia' && value.kind !== 'close') node.followsClassCloseOnSameLine = true
      if (value.kind === 'close' && owner) closedOnLine = inClass ? 'class' : 'namespace'
      if (fragment.compactSemicolon) node.compactSemicolon = true
      if (value.kind === 'close') {
        if (owner) {
          owner.closing = node
          stack.pop()
        } else {
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
  }
  for (const owner of stack)
    tree.diagnostics.push({
      reason: `Unclosed ${owner.value.kind === 'namespace' ? 'namespace' : 'class'} block`,
      source: owner.source,
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
  return ref && /^(?:https?:|mailto:)/i.test(href) && isSafeActionHref(href) && !/[\u0000-\u0020\u007f-\u009f]/.test(href) && (tooltip === undefined || !/[\u0000-\u001f\u007f-\u009f]/.test(tooltip)) ? { id: ref.id, ...(ref.generic ? { generic: ref.generic } : {}), href, ...(tooltip ? { tooltip } : {}) } : null
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
  const protectedLine = decodeXML(authoredLine.replace(/&quot;|&#0*34;|&#x0*22;/gi, token => (decodeXML(token) === '"' ? quoteMarker : token)))
  const parseProtected = (line: string): ReturnType<typeof parseClassInteraction> => {
    const parsed = parseClassInteraction(line)
    if (!parsed || parsed.tooltip?.includes('"')) return null
    // A quote entity inside a destination cannot relax the URL token grammar.
    if (parsed.href.includes(quoteMarker)) return null
    const href = parsed.href
    const tooltip = parsed.tooltip?.replaceAll(quoteMarker, '"')
    if (!isSafeActionHref(href) || /[\u0000-\u0020\u007f-\u009f]/.test(href) || (tooltip !== undefined && /[\u0000-\u001f\u007f-\u009f]/.test(tooltip))) return null
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
  const accessibility = scanAccessibilityDirectives(lines, classStatementEnds(lines))
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
    classes: [],
    classDefs: new Map(),
    relationships: [],
    notes: [],
    namespaces: [],
    ...(accessibility.accessibility.title !== undefined ? { accessibilityTitle: normalizeBrTags(accessibility.accessibility.title) } : {}),
    ...(accessibility.accessibility.descr !== undefined ? { accessibilityDescription: normalizeBrTags(accessibility.accessibility.descr) } : {}),
  }
  const classMap = new Map<string, ClassNode>()
  const allocateInterface = createClassInterfaceAllocator(tree.statements)
  const namespaces = new Map<string, ClassNamespace>()
  const claimed = new Set<string>()
  // cssClass statements naming a class not declared yet: applied once it is.
  const laterCssClasses: Array<{ id: string; name: string }> = []
  const claim = (id: string, path: string): void => {
    if (path && !claimed.has(id)) {
      namespaces.get(path)!.classIds.push(id)
      claimed.add(id)
      if (parserObservationActive('class')) observeParserMutation('class', 'claim-member', { id, parent: path })
    }
  }
  const openNamespace = (path: string, segments: string[], label?: string): string => {
    let children = path ? namespaces.get(path)!.children : diagram.namespaces
    for (const segment of segments) {
      path = path ? `${path}.${segment}` : segment
      let namespace = namespaces.get(path)
      if (namespace && namespace.name !== segment) {
        throw syntaxError({
          what: `Class namespace path collision "${path}" between a quoted literal name and a dotted hierarchy`,
          expectedForm: 'distinct namespace names that do not flatten to the same path',
          example: 'namespace `Literal A.B` { class First }',
        })
      }
      if (!namespace) {
        namespace = { name: segment, classIds: [], children: [] }
        children.push(namespace)
        namespaces.set(path, namespace)
        if (parserObservationActive('class')) observeParserMutation('class', 'add-namespace', { id: path, parent: path.slice(0, -(segment.length + 1)) || undefined, name: segment })
      }
      children = namespace.children
    }
    if (label !== undefined) {
      const namespace = namespaces.get(path)!
      delete namespace.labelContent
      Object.assign(namespace, classTextLabel(label))
      if (parserObservationActive('class')) observeParserMutation('class', 'set-namespace-label', { id: path, label: namespace.label })
    }
    return path
  }
  const addMember = (node: ClassNode, text: string): void => {
    const member = parseClassMember(text)
    if (member) {
      ;(member.isMethod ? node.methods : node.attributes).push(member.member)
      if (parserObservationActive('class')) observeParserMutation('class', 'add-member', { id: node.id, method: member.isMethod, member: member.member })
    }
  }
  const visit = (nodes: ClassStatementNode[], path = '', owner?: ClassNode): void => {
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
        case 'source-only':
          break
        case 'namespace':
          frames.push({ nodes: node.children!, path: openNamespace(path, value.path, value.label), owner: undefined, index: 0 })
          break
        case 'class': {
          const declaration = value.declaration
          const cls = ensureClass(classMap, declaration.id, declaration.generic)
          if (declaration.label !== undefined) {
            delete cls.labelContent
            Object.assign(cls, classTextLabel(declaration.label))
          }
          if (declaration.className !== undefined) cls.className = declaration.className
          if (parserObservationActive('class')) observeParserMutation('class', 'declare-class', cls, { line: node.source.line, unit: 'normalized' })
          if (declaration.annotation !== undefined) {
            applyClassAnnotation(cls, declaration.annotation)
            if (parserObservationActive('class')) observeParserMutation('class', 'set-annotation', { id: cls.id, annotation: cls.annotation })
          }
          claim(cls.id, path)
          if (node.children) frames.push({ nodes: node.children, path, owner: cls, index: 0 })
          break
        }
        case 'member': {
          const cls = value.reference ? ensureClass(classMap, value.reference.id, value.reference.generic) : owner!
          addMember(cls, value.text)
          break
        }
        case 'body-annotation':
          applyClassAnnotation(owner!, value.text)
          if (parserObservationActive('class')) observeParserMutation('class', 'set-annotation', { id: owner!.id, annotation: owner!.annotation })
          break
        case 'annotation': {
          const annotation = value.annotation
          if (annotation.placement === 'separate' && !classMap.has(annotation.id)) {
            throw syntaxError({ what: `Annotation targets undeclared class "${annotation.id}"`, expectedForm: 'declare the class before a separate annotation', example: `class ${annotation.id}\n<<${annotation.annotation}>> ${annotation.id}` })
          }
          const cls = ensureClass(classMap, annotation.id, annotation.generic)
          if (annotation.label !== undefined) {
            delete cls.labelContent
            Object.assign(cls, classTextLabel(annotation.label))
          }
          if (annotation.className !== undefined) cls.className = annotation.className
          applyClassAnnotation(cls, annotation.annotation)
          if (parserObservationActive('class')) observeParserMutation('class', 'set-annotation', { id: cls.id, annotation: cls.annotation, label: cls.label })
          claim(cls.id, path)
          break
        }
        case 'interaction': {
          const cls = ensureClass(classMap, value.interaction.id, value.interaction.generic)
          cls.href = value.interaction.href
          if (value.interaction.tooltip !== undefined) cls.tooltip = value.interaction.tooltip
          if (parserObservationActive('class')) observeParserMutation('class', 'set-interaction', { id: cls.id, href: cls.href, tooltip: cls.tooltip })
          claim(cls.id, path)
          break
        }
        case 'note':
          if (value.reference) ensureClass(classMap, value.reference.id, value.reference.generic)
          {
            const { label: text, labelContent: textContent } = classTextLabel(value.text)
            diagram.notes.push({ text, ...(textContent ? { textContent } : {}), ...(value.reference ? { for: value.reference.id } : {}) })
          }
          if (parserObservationActive('class')) observeParserMutation('class', 'add-note', diagram.notes.at(-1))
          break
        case 'title':
          diagram.title = value.text
          if (parserObservationActive('class')) observeParserMutation('class', 'set-title', diagram.title)
          break
        case 'direction':
          diagram.direction = value.direction
          if (parserObservationActive('class')) observeParserMutation('class', 'set-direction', diagram.direction)
          break
        case 'relationship': {
          const { fromGeneric, toGeneric, ...relationship } = value.relationship
          const side = classInterfaceSide(relationship)
          if (side) {
            const generic = side === 'from' ? fromGeneric : toGeneric
            const label = relationship[side] + (generic ? `~${generic}~` : '')
            const id = allocateInterface()
            const opposite = side === 'from' ? 'to' : 'from'
            ensureClass(classMap, relationship[opposite], opposite === 'from' ? fromGeneric : toGeneric)
            const occurrence: ClassNode = { id, label, ...(generic ? { generic } : {}), isInterface: true, attributes: [], methods: [] }
            classMap.set(id, occurrence)
            if (parserObservationActive('class')) observeParserMutation('class', 'add-class', occurrence)
            relationship[side] = id
          } else {
            ensureClass(classMap, relationship.from, fromGeneric)
            ensureClass(classMap, relationship.to, toGeneric)
          }
          diagram.relationships.push(relationship)
          if (parserObservationActive('class')) observeParserMutation('class', 'add-relationship', relationship, { line: node.source.line, unit: 'normalized' })
          break
        }
        case 'classDef':
          for (const name of value.names) {
            diagram.classDefs.set(name, mergeStyleProps(diagram.classDefs.get(name), value.props))
            if (parserObservationActive('class')) observeParserMutation('class', 'define-class', { name, props: value.props })
          }
          break
        case 'assignment':
        case 'style':
          for (const reference of value.references) {
            // A cssClass styles a class declared elsewhere, before or after
            // it, and declares none.
            if (value.kind === 'assignment' && value.form.startsWith('cssClass')) {
              const existing = classMap.get(reference.id)
              if (existing) existing.className = value.name
              else laterCssClasses.push({ id: reference.id, name: value.name })
              continue
            }
            const cls = ensureClass(classMap, reference.id, reference.generic)
            if (value.kind === 'assignment') cls.className = value.name
            else cls.inlineStyle = mergeStyleProps(cls.inlineStyle, value.props)
            if (parserObservationActive('class')) observeParserMutation('class', value.kind === 'assignment' ? 'assign-class' : 'set-style', cls)
            claim(cls.id, path)
          }
          break
        case 'unknown':
          break // diagnostics above refuse partial rendering
      }
    }
  }
  visit(tree.statements)
  for (const { id, name } of laterCssClasses) {
    const cls = classMap.get(id)
    if (cls && cls.className === undefined) cls.className = name
  }
  diagram.classes = [...classMap.values()].filter(node => !node.isInterface).concat([...classMap.values()].filter(node => node.isInterface))
  assertClassDiagramWork(diagram)
  return diagram
}

/** Ensure a class exists in the map, creating a default if needed */
function ensureClass(classMap: Map<string, ClassNode>, id: string, generic?: string): ClassNode {
  let cls = classMap.get(id)
  if (!cls) {
    cls = { id, label: generic ? `${id}<${generic}>` : id, generic, attributes: [], methods: [] }
    classMap.set(id, cls)
    if (parserObservationActive('class')) observeParserMutation('class', 'add-class', cls)
  } else if (generic && !cls.generic) {
    cls.generic = generic
    if (cls.label === id) cls.label = `${id}<${generic}>`
    if (parserObservationActive('class')) observeParserMutation('class', 'set-generic', cls)
  }
  return cls
}

/** Parse a class member line (attribute or method) */
export function parseClassMember(line: string): { member: ClassMember; isMethod: boolean } | null {
  const authored = line.trim()
  const trimmed = /#\w+;$/.test(authored) ? authored : authored.replace(/;$/, '')
  if (!trimmed) return null

  // Extract visibility prefix
  let visibility: ClassMember['visibility'] = ''
  let rest = trimmed
  if (/^[+\-#~]/.test(rest) && !/^#\w+;/.test(rest)) {
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

/** Parse a relationship without confusing marker tokens with authored IDs. */
export function parseClassRelationship(line: string): (ClassRelationship & { fromGeneric?: string; toGeneric?: string }) | null {
  const comment = classCommentStart(line)
  if (comment >= 0) line = line.slice(0, comment).trimEnd()
  // Bare links win the ambiguous compact `Ao--B` / `A--oB` spellings.
  return parseMarkerlessClassRelationship(line) ?? parseMarkedClassRelationship(line)
}

function parseMarkedClassRelationship(line: string): (ClassRelationship & { fromGeneric?: string; toGeneric?: string }) | null {
  const operator = findMarkerlessRelationshipOperator(line)
  if (operator < 0) return null
  const before = line.slice(0, operator)
  const after = line.slice(operator + 2)
  let fromToken = before.match(/(<\||\(\)|[*o<>])$/)?.[1]
  let toToken = after.match(/^(\|>|\(\)|[*o<>])/)?.[1]
  // The letter o belongs to an adjacent bare identifier unless separated.
  // This also keeps `Foo-->B` and `A o--out` on their authored endpoints.
  if (fromToken === 'o' && /[\w$]/.test(before[before.length - 2] ?? '')) fromToken = undefined
  if (toToken === 'o' && /[\w$]/.test(after[1] ?? '')) toToken = undefined
  if (!fromToken && !toToken) return null
  const endpoints = parseClassRelationEndpoints(before.slice(0, before.length - (fromToken?.length ?? 0)), after.slice(toToken?.length ?? 0))
  if (!endpoints) return null
  const dashed = line[operator] === '.'
  const fromType = fromToken ? endpointRelationshipType(fromToken, dashed) : undefined
  const toType = toToken ? endpointRelationshipType(toToken, dashed) : undefined
  const type = (fromType ?? toType)!
  const markerAt = fromType && toType ? 'both' : fromType ? 'from' : 'to'
  const inferredDashed = [fromType, toType].some(kind => kind === 'dependency' || kind === 'realization')
  return {
    ...endpoints,
    type,
    markerAt,
    ...(markerAt === 'both' ? { fromType, toType } : {}),
    ...(dashed && !inferredDashed ? { lineStyle: 'dashed' as const } : {}),
  }
}

/** Expand entities only after endpoint and label grammar has been read. */
function classRelationText(label?: string, fromCardinality?: string, toCardinality?: string): Pick<ClassRelationship, 'label' | 'labelContent' | 'fromCardinality' | 'fromCardinalityContent' | 'toCardinality' | 'toCardinalityContent'> {
  const from = fromCardinality === undefined ? undefined : classTextLabel(fromCardinality)
  const to = toCardinality === undefined ? undefined : classTextLabel(toCardinality)
  return {
    ...(label ? classTextLabel(label) : {}),
    ...(from ? { fromCardinality: from.label, ...(from.labelContent ? { fromCardinalityContent: from.labelContent } : {}) } : {}),
    ...(to ? { toCardinality: to.label, ...(to.labelContent ? { toCardinalityContent: to.labelContent } : {}) } : {}),
  }
}

/** Endpoints, generics, cardinalities and labels share one bounded scanner for
 * one-ended and mixed relationships, including escaped IDs with spaces. */
function parseClassRelationEndpoints(leftSource: string, rightSource: string): (Omit<ClassRelationship, 'type' | 'markerAt'> & { fromGeneric?: string; toGeneric?: string }) | null {
  if (callBeforeBlank(leftSource, rightSource)) return null
  let left = leftSource.trim()
  let right = rightSource.trim()
  let fromCardinality: string | undefined
  if (left.endsWith('"')) {
    const start = left.lastIndexOf('"', left.length - 2)
    if (start >= 0) {
      fromCardinality = left.slice(start + 1, -1)
      left = left.slice(0, start).trimEnd()
    }
  }
  let label: string | undefined
  let inBacktick = false
  let inQuote = false
  let inGeneric = false
  for (let i = 0; i < right.length; i++) {
    const char = right[i]!
    if (inBacktick) {
      if (char === '`') inBacktick = false
      continue
    }
    if (inQuote) {
      if (char === '"') inQuote = false
      continue
    }
    if (inGeneric) {
      if (char === '~') inGeneric = false
      continue
    }
    if (char === '`') {
      inBacktick = true
      continue
    }
    if (char === '"') {
      inQuote = true
      continue
    }
    if (char === '~') {
      inGeneric = true
      continue
    }
    if (char === ':') {
      const rawLabel = right.slice(i + 1).trim()
      if (!rawLabel || /[:;]/.test(rawLabel.replace(/(?<!&)#\w+;/g, ''))) return null
      label = rawLabel
      right = right.slice(0, i).trimEnd()
      break
    }
  }
  let toCardinality: string | undefined
  if (right.startsWith('"')) {
    const close = right.indexOf('"', 1)
    if (close < 0) return null
    toCardinality = right.slice(1, close)
    right = right.slice(close + 1).trimStart()
  }
  const fromRef = parseClassReference(left)
  const toRef = parseClassReference(right)
  if (!fromRef || !toRef || !supportedRelationEndpoint(fromRef.id, left) || !supportedRelationEndpoint(toRef.id, right)) return null
  return {
    from: fromRef.id,
    to: toRef.id,
    ...classRelationText(label, fromCardinality, toCardinality),
    ...(fromRef.generic ? { fromGeneric: fromRef.generic } : {}),
    ...(toRef.generic ? { toGeneric: toRef.generic } : {}),
  }
}

/** Mermaid permits spaces to be omitted around bare `--` and `..` links.
 * Locate one operator outside IDs/cardinalities in linear time; the existing
 * arrow grammar below remains responsible for marked relationships. */
function parseMarkerlessClassRelationship(line: string): (ClassRelationship & { fromGeneric?: string; toGeneric?: string }) | null {
  const operator = findMarkerlessRelationshipOperator(line)
  if (operator < 0 || callBeforeBlank(line.slice(0, operator), line.slice(operator + 2))) return null

  const left = line.slice(0, operator).trim()
  let right = line.slice(operator + 2).trim()
  let fromRef = parseClassReference(left)
  let fromCardinality: string | undefined
  if (!fromRef && left.endsWith('"')) {
    const cardStart = left.lastIndexOf('"', left.length - 2)
    if (cardStart >= 0) {
      fromRef = parseClassReference(left.slice(0, cardStart).trimEnd())
      if (fromRef) fromCardinality = left.slice(cardStart + 1, -1)
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
    if (inBacktick) {
      if (char === '`') inBacktick = false
      continue
    }
    if (inQuote) {
      if (char === '"') inQuote = false
      continue
    }
    if (inGeneric) {
      if (char === '~') inGeneric = false
      continue
    }
    if (char === '`') {
      inBacktick = true
      continue
    }
    if (char === '"') {
      inQuote = true
      continue
    }
    if (char === '~') {
      inGeneric = true
      continue
    }
    if (char === ':') {
      const rawLabel = right.slice(i + 1).trim()
      // Mermaid requires non-empty Class label text and rejects a second
      // colon or semicolon outside a protected Mermaid entity token.
      if (!rawLabel || /[:;]/.test(rawLabel.replace(/(?<!&)#\w+;/g, ''))) return null
      label = rawLabel
      right = right.slice(0, i).trim()
      break
    }
  }

  let toCardinality: string | undefined
  if (right.startsWith('"')) {
    const close = right.indexOf('"', 1)
    if (close < 0) return null
    toCardinality = right.slice(1, close)
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
    ...classRelationText(label, fromCardinality, toCardinality),
    ...(fromRef.generic ? { fromGeneric: fromRef.generic } : {}),
    ...(toRef.generic ? { toGeneric: toRef.generic } : {}),
  }
}

// Words Mermaid's class lexer reads as keywords where a class name stands:
// in any lexer state, inside backticks too; in any state, bare; and, bare,
// where a statement starts (a relationship or `A : member`), as `call`
// before a blank is too.
const CLASS_KEYWORDS_IN_BACKTICKS = new Set(['note', 'click', 'link', 'cssClass', 'href', 'callback'])
const CLASS_KEYWORDS = new Set([...CLASS_KEYWORDS_IN_BACKTICKS, 'o', '_self', '_blank', '_parent', '_top'])
const CLASS_STATEMENT_KEYWORDS = new Set([...CLASS_KEYWORDS, 'class', 'classDiagram', 'namespace', 'style', 'classDef'])

/** Whether Mermaid's class lexer reads `id`, written bare or in backticks,
 *  as a class name: after `class`, or where a statement starts. */
export function readsAsClassName(id: string, backticked: boolean, statementStart: boolean): boolean {
  return !(backticked ? CLASS_KEYWORDS_IN_BACKTICKS : statementStart ? CLASS_STATEMENT_KEYWORDS : CLASS_KEYWORDS).has(id)
}

/** Whether a relationship's source or target is `call` before a blank or
 *  the line's end, as written around its arrow: Mermaid's lexer reads it
 *  there as a callback, where `call-->A` and `A --> call: x` name a class. */
function callBeforeBlank(leftSource: string, rightSource: string): boolean {
  return /^\s*call\s/.test(leftSource) || /^\s*(?:"[^"]*"\s*)?call(?:\s|$)/.test(rightSource)
}

/** Mermaid's relationship endpoint lexer reserves keywords/`o` and rejects
 * unescaped dollar signs. Escaped IDs containing `~` denote a generic base
 * identity upstream, which this relationship model cannot yet preserve. */
export function supportedRelationEndpoint(id: string, raw: string): boolean {
  return raw.startsWith('`')
    ? readsAsClassName(id, true, true) && !id.includes('~')
    : !id.includes('$') && readsAsClassName(id, false, true)
}

function findMarkerlessRelationshipOperator(line: string): number {
  let inBacktick = false
  let inQuote = false
  let inGeneric = false
  for (let i = 0; i < line.length - 1; i++) {
    const char = line[i]!
    if (inBacktick) {
      if (char === '`') inBacktick = false
      continue
    }
    if (inQuote) {
      if (char === '"') inQuote = false
      continue
    }
    if (inGeneric) {
      if (char === '~') inGeneric = false
      continue
    }
    if (char === '`') {
      inBacktick = true
      continue
    }
    if (char === '"') {
      inQuote = true
      continue
    }
    if (char === '~') {
      inGeneric = true
      continue
    }
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
  const spacedPrefixO = before.endsWith('o') && /\s/.test(before[before.length - 2] ?? '') && before.slice(0, -2).trim().length > 0
  return /(?:<\||<|\*|\(\))$/.test(before) || spacedPrefixO || /^(?:>|\|>|\*|o\s+(?![:%])\S|\(\))/.test(after)
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
 * the native parser and the agent reader. */
export function isEscapedMarkedClassRelationshipCandidate(line: string): boolean {
  if (!line.includes('`')) return false
  const operator = findMarkerlessRelationshipOperator(line)
  if (operator < 0) return false
  const before = line.slice(0, operator).trimEnd()
  const afterOperator = line.slice(operator + 2)
  // The bare-link discriminator predates two-ended dashed diamond/circle
  // markers. Such escaped links must not fall through to a solid two-way edge.
  const dashedTwoEnded = line[operator] === '.' && /(?:\*|o)$/.test(before) && /^(?:\*|o|>|\|>|<)/.test(afterOperator)
  if (!isMarkedRelationshipOperator(line, operator) && !dashedTwoEnded) return false
  if (line.slice(0, operator).trimStart().startsWith('`')) return true
  let after = line.slice(operator + 2).trimStart()
  after = after.replace(/^(?:\|>|[>*o]|\(\))\s*/, '')
  after = after.replace(/^"[^"]*"\s*/, '')
  return after.startsWith('`')
}

/** Marker meaning and shaft style are independent for diamonds and circles. */
function endpointRelationshipType(token: string, dashed: boolean): RelationshipType {
  if (token === '()') return 'lollipop'
  if (token === '*') return 'composition'
  if (token === 'o') return 'aggregation'
  if (token.includes('|')) return dashed ? 'realization' : 'inheritance'
  return dashed ? 'dependency' : 'association'
}

/** Resolve old programmatic defaults while honoring an explicitly authored shaft. */
export function classRelationshipLineStyle(relation: Pick<ClassRelationship, 'type' | 'fromType' | 'toType' | 'lineStyle'>): 'solid' | 'dashed' {
  return relation.lineStyle ?? ([relation.type, relation.fromType, relation.toType].some(kind => kind === 'dependency' || kind === 'realization' || kind === 'link-dashed') ? 'dashed' : 'solid')
}
