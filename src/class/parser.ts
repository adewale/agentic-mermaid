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
  const body = match[2]!.split(';').map(statement => statement.trim()).filter(Boolean)
  return [opener, ...body, '}']
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
const CLASS_DECLARATION_RE = /^class\s+(`[^`]+`|[\w$]+)(?:\s*~([^~]+)~)?(?:\s*\[\s*"([^"]*)"\s*\])?(?:\s+as\s+"([^"]+)")?(?:\s+~([^~]+)~)?\s*(\{)?\s*$/

export interface ParsedClassDeclaration {
  id: string
  label?: string
  generic?: string
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
    opensBody: match[6] === '{',
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
  lines = accessibility.familyLines.flatMap(expandInlineNamespaceStatement)
  const authoredExpanded = authoredLines ? authoredClassStatements(authoredLines) : undefined
  const diagram: ClassDiagram = {
    classes: [],
    classDefs: new Map(),
    relationships: [],
    notes: [],
    namespaces: [],
    ...(accessibility.accessibility.title !== undefined
      ? { accessibilityTitle: normalizeBrTags(accessibility.accessibility.title) }
      : {}),
    ...(accessibility.accessibility.descr !== undefined
      ? { accessibilityDescription: normalizeBrTags(accessibility.accessibility.descr) }
      : {}),
  }

  // Track classes by ID for deduplication
  const classMap = new Map<string, ClassNode>()
  // Namespace registry by full dot path (dot notation and re-opened blocks
  // share one node) + the currently-open nesting stack.
  const namespaceByPath = new Map<string, ClassNamespace>()
  const namespaceStack: ClassNamespace[] = []
  const pathStack: string[] = []
  // A class belongs to exactly one namespace: the first block that declares it.
  const claimedClasses = new Set<string>()

  /** Resolve (creating as needed) the namespace chain for a dot path relative
   *  to the current stack, and return the final node. */
  const openNamespace = (segments: string[], label: string | undefined): ClassNamespace => {
    let parentPath = pathStack.join('.')
    let parentChildren = namespaceStack.length > 0
      ? namespaceStack[namespaceStack.length - 1]!.children
      : diagram.namespaces
    let node: ClassNamespace | undefined
    for (const segment of segments) {
      const fullPath = parentPath ? `${parentPath}.${segment}` : segment
      node = namespaceByPath.get(fullPath)
      if (!node) {
        node = { name: segment, classIds: [], children: [] }
        namespaceByPath.set(fullPath, node)
        parentChildren.push(node)
      }
      parentPath = fullPath
      parentChildren = node.children
      pathStack.push(segment)
      namespaceStack.push(node)
    }
    if (label && node) node.label = label
    return node!
  }

  const claimClass = (id: string): void => {
    if (namespaceStack.length === 0 || claimedClasses.has(id)) return
    claimedClasses.add(id)
    namespaceStack[namespaceStack.length - 1]!.classIds.push(id)
  }

  // Track class body parsing
  let currentClass: ClassNode | null = null
  let braceDepth = 0
  // How many stack levels each open `namespace` line pushed (dot paths push
  // several segments that one closing `}` must pop together).
  const namespaceFrameSizes: number[] = []

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!
    if (!line || line.startsWith('%%')) continue

    // --- Inside a class body block ---
    if (currentClass && braceDepth > 0) {
      if (line === '}') {
        braceDepth--
        if (braceDepth === 0) {
          currentClass = null
        }
        continue
      }

      // Check for annotation like <<interface>>
      const annotation = parseClassBodyAnnotationToken(line)
      if (annotation !== null) {
        applyClassAnnotation(currentClass, annotation)
        continue
      }

      // Parse member: visibility, name, type, optional parens for method
      const member = parseMember(line)
      if (member) {
        if (member.isMethod) {
          currentClass.methods.push(member.member)
        } else {
          currentClass.attributes.push(member.member)
        }
      }
      continue
    }

    // --- Safe class links. Callback forms remain inert and unmodeled. ---
    const candidate = authoredExpanded?.[i]
    const authoredLine = candidate !== undefined && decodeXML(candidate).trim() === line
      ? candidate
      : undefined
    const interaction = authoredLine !== undefined
      ? parseClassInteractionWithAuthored(authoredLine)
      : authoredLines === undefined ? parseAuthoredClassInteraction(line) : null
    if (interaction) {
      const cls = ensureClass(classMap, interaction.id, interaction.generic)
      cls.href = interaction.href
      if (interaction.tooltip !== undefined) cls.tooltip = interaction.tooltip
      continue
    }

    // --- UML notes ---
    const note = line.match(/^note(?:\s+for\s+(\S+))?\s+"((?:\\.|[^"\\])*)"\s*$/i)
    if (note) {
      const target = note[1] ? parseClassReference(note[1]) : null
      if (note[1] && target) ensureClass(classMap, target.id, target.generic)
      diagram.notes.push({ text: note[2]!.replace(/\\(["\\])/g, '$1'), ...(target ? { for: target.id } : {}) })
      continue
    }

    // --- Direction statement ---
    const direction = parseDirectionStatement(line)
    if (direction) {
      diagram.direction = direction
      continue
    }

    // --- Namespace block start (supports nesting, dot paths, labels) ---
    const nsHeader = parseNamespaceHeader(line)
    if (nsHeader) {
      openNamespace(nsHeader.path, nsHeader.label)
      namespaceFrameSizes.push(nsHeader.path.length)
      continue
    }

    // --- Namespace end ---
    if (line === '}' && namespaceFrameSizes.length > 0) {
      const frame = namespaceFrameSizes.pop()!
      namespaceStack.length -= frame
      pathStack.length -= frame
      continue
    }

    // --- Class paint directives ---
    const classDef = line.match(/^classDef\s+([\w,-]+)\s+(.+)$/)
    if (classDef) {
      const props = parseStyleProps(classDef[2]!)
      for (const name of classDef[1]!.split(',').map(value => value.trim()).filter(Boolean)) diagram.classDefs.set(name, { ...props })
      continue
    }
    const classAssignment = line.match(/^(?:class|cssClass)\s+(.+?)\s+([\w-]+)$/)
    if (classAssignment && !line.includes('{') && !line.includes('[') && !line.includes(' as ')) {
      const refs = classAssignment[1]!.replace(/^"|"$/g, '').split(',').map(value => parseClassReference(value.trim())).filter((value): value is { id: string; generic?: string } => value !== null)
      if (refs.length > 0) {
        for (const ref of refs) {
          const cls = ensureClass(classMap, ref.id, ref.generic)
          cls.className = classAssignment[2]!
          claimClass(cls.id)
        }
        continue
      }
    }
    const inlineStyle = line.match(/^style\s+(.+?)\s+(.+)$/)
    if (inlineStyle) {
      const refs = inlineStyle[1]!.replace(/^"|"$/g, '').split(',').map(value => parseClassReference(value.trim())).filter((value): value is { id: string; generic?: string } => value !== null)
      const props = parseStyleProps(inlineStyle[2]!)
      if (refs.length > 0 && Object.keys(props).length > 0) {
        for (const ref of refs) {
          const cls = ensureClass(classMap, ref.id, ref.generic)
          cls.inlineStyle = { ...cls.inlineStyle, ...props }
          claimClass(cls.id)
        }
        continue
      }
    }

    // --- Class annotation, in either official placement or a one-line body. ---
    const annotationStatement = parseClassAnnotationStatement(line)
    if (annotationStatement) {
      if (annotationStatement.placement === 'separate' && !classMap.has(annotationStatement.id)) {
        throw syntaxError({
          what: `Annotation targets undeclared class "${annotationStatement.id}"`,
          expectedForm: 'declare the class before a separate annotation',
          example: `class ${annotationStatement.id}\n<<${annotationStatement.annotation}>> ${annotationStatement.id}`,
        })
      }
      const cls = ensureClass(classMap, annotationStatement.id, annotationStatement.generic)
      if (annotationStatement.label !== undefined) cls.label = normalizeBrTags(annotationStatement.label)
      applyClassAnnotation(cls, annotationStatement.annotation)
      claimClass(cls.id)
      continue
    }

    // --- Class declaration (standalone or opening a member block) ---
    const declaration = parseClassDeclaration(line)
    if (declaration) {
      const cls = ensureClass(classMap, declaration.id, declaration.generic)
      if (declaration.label !== undefined) cls.label = normalizeBrTags(declaration.label)
      if (declaration.opensBody) {
        currentClass = cls
        braceDepth = 1
      }
      claimClass(declaration.id)
      continue
    }

    // --- Class shorthand: `ClassName:::style` ---
    // The suffix decorates the stable class identity; it is never a member.
    const classShorthand = line.match(/^(.+?):::([\w-]+)$/)
    if (classShorthand) {
      const reference = parseClassReference(classShorthand[1]!)
      if (reference) {
        const cls = ensureClass(classMap, reference.id, reference.generic)
        cls.className = classShorthand[2]!
        claimClass(reference.id)
        continue
      }
    }

    // --- Inline attribute: `ClassName : +String name` ---
    const inlineAttrMatch = line.match(/^(\S+?)\s*:\s*(.+)$/)
    if (inlineAttrMatch) {
      const rest = inlineAttrMatch[2]!
      // A valid class reference before ':' makes this an inline member even
      // when its text contains link-looking punctuation. A relationship has
      // both endpoints before ':', so its prefix cannot parse as one ref.
      const ref = parseClassReference(inlineAttrMatch[1]!)
      if (ref) {
        const cls = ensureClass(classMap, ref.id, ref.generic)
        const member = parseMember(rest)
        if (member) {
          if (member.isMethod) {
            cls.methods.push(member.member)
          } else {
            cls.attributes.push(member.member)
          }
        }
        continue
      }
    }

    // --- Relationship ---
    // Pattern: [FROM] ["card"] ARROW ["card"] [TO] [: label]
    // Arrows: <|--, *--, o--, -->, ..|>, ..>
    // Can also be reversed: --o, --*, --|>
    const rel = parseClassRelationship(line)
    if (rel) {
      // Ensure both classes exist
      ensureClass(classMap, rel.from, rel.fromGeneric)
      ensureClass(classMap, rel.to, rel.toGeneric)
      const { fromGeneric: _fromGeneric, toGeneric: _toGeneric, ...relationship } = rel
      diagram.relationships.push(relationship)
      continue
    }

    // An annotation-like statement that misses the shared grammar must not
    // disappear from an otherwise plausible class diagram.
    if (line.includes('<<') || line.includes('>>')) {
      throw syntaxError({
        what: `Unrecognized class annotation statement "${line}"`,
        expectedForm: 'class Name <<annotation>> or <<annotation>> Name',
        example: 'class Shape <<interface>>',
      })
    }
    // A malformed relationship cannot be silently omitted from an otherwise
    // plausible diagram. Ignore delimiter-looking text inside IDs/generics.
    if (isBareClassRelationshipCandidate(line) || isMarkedClassRelationshipCandidate(line) || isEscapedMarkedClassRelationshipCandidate(line)) {
      throw syntaxError({
        what: `Unrecognized class relationship statement "${line}"`,
        expectedForm: 'A .. B, A -- B, or A --> B, optionally with a label',
        example: 'A --> B : linked',
      })
    }
    // A safe URL followed by unmodeled tooltip/target/trailing syntax must
    // not be accepted as an invisible statement. Unsafe links and callbacks
    // remain source-only rather than becoming executable output.
    if (/^(?:click|link)\s+(?:`[^`]+`(?:~[^~]+~)?|[\w$]+(?:~[^~]+~)?)\s+(?:href\s+)?"?(?:https?:\/\/|mailto:)/i.test(line)) {
      throw syntaxError({
        what: `Unrecognized class link statement "${line}"`,
        expectedForm: 'link Name "https://example.com" "optional tooltip"',
        example: 'click Name href "https://example.com" "Documentation"',
      })
    }
  }

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
    // After the label separator, `%%` is label text rather than a comment.
    if (char === ':' && operator >= 0) break
    if (char === '%' && line[i + 1] === '%') { line = line.slice(0, i).trimEnd(); break }
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
  // Class inline `%%` comments are legal after a relationship. Do not let the
  // comment become part of an endpoint or label; a quoted cardinality, generic,
  // or escaped ID can contain the same bytes without starting a comment.
  let commentBacktick = false
  let commentQuote = false
  let commentGeneric = false
  let inLabel = false
  for (let i = 0; i < line.length - 1; i++) {
    const char = line[i]!
    if (commentBacktick) { if (char === '`') commentBacktick = false; continue }
    if (commentQuote) { if (char === '"') commentQuote = false; continue }
    if (commentGeneric) { if (char === '~') commentGeneric = false; continue }
    if (char === '`') { commentBacktick = true; continue }
    if (char === '"') { commentQuote = true; continue }
    if (char === '~') { commentGeneric = true; continue }
    // Mermaid treats `%%` after the label separator as label text, not a
    // comment. Before the separator it is an inert trailing comment.
    if (char === ':') { inLabel = true; continue }
    if (!inLabel && char === '%' && line[i + 1] === '%') { line = line.slice(0, i).trimEnd(); break }
  }

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
