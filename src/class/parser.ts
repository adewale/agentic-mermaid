import type { ClassDiagram, ClassNode, ClassRelationship, ClassMember, RelationshipType, ClassNamespace } from './types.ts'
import { normalizeBrTags } from '../multiline-utils.ts'
import { requireClosedAccessibility, scanAccessibilityDirectives } from '../shared/accessibility-directives.ts'
import { parseDirectionStatement } from '../shared/direction-statement.ts'
import { parseStyleProps } from '../shared/style-props.ts'
import { syntaxError } from '../shared/syntax-error.ts'

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
export function parseClassInteraction(line: string): { id: string; generic?: string; href: string } | null {
  const link = line.match(/^(?:click|link)\s+(`[^`]+`(?:~[^~]+~)?|[\w$]+(?:~[^~]+~)?)\s+(?:href\s+)?(?:"((?:\\.|[^"])*)"|(https?:\/\/\S+|mailto:\S+))/i)
  if (!link) return null
  const ref = parseClassReference(link[1]!)
  const href = (link[2] ?? link[3] ?? '').replace(/\\(["\\])/g, '$1')
  return ref && /^(?:https?:|mailto:)/i.test(href) ? { ...ref, href } : null
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
export function parseClassDiagram(lines: string[]): ClassDiagram {
  const accessibility = scanAccessibilityDirectives(lines)
  requireClosedAccessibility(accessibility)
  lines = accessibility.familyLines.flatMap(expandInlineNamespaceStatement)
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
    const interaction = parseClassInteraction(line)
    if (interaction) {
      ensureClass(classMap, interaction.id, interaction.generic).href = interaction.href
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
    const bareOperator = findMarkerlessRelationshipOperator(line)
    const beforeOperator = bareOperator > 0 ? line[bareOperator - 1] : undefined
    const afterOperator = bareOperator >= 0 ? line[bareOperator + 2] : undefined
    if (bareOperator >= 0 && !['<', '|', '*', 'o', ')'].includes(beforeOperator ?? '')
      && !['>', '|', '*', 'o', '('].includes(afterOperator ?? '')) {
      throw syntaxError({
        what: `Unrecognized class relationship statement "${line}"`,
        expectedForm: 'A .. B : label or A -- B : label',
        example: 'A .. B : linked',
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

  // Lollipop interface endpoints are distinct UML semantics, not associations.
  const lollipop = line.match(/^(\S+?)\s+(\(\)--|--\(\))\s+(\S+?)(?:\s*:\s*(.+))?$/)
  if (lollipop) {
    const fromRef = parseClassReference(lollipop[1]!)
    const toRef = parseClassReference(lollipop[3]!)
    if (!fromRef || !toRef) return null
    return {
      from: fromRef.id, to: toRef.id, type: 'lollipop', markerAt: lollipop[2] === '()--' ? 'from' : 'to',
      ...(lollipop[4]?.trim() ? { label: normalizeBrTags(lollipop[4]!.trim()) } : {}),
      ...(fromRef.generic ? { fromGeneric: fromRef.generic } : {}), ...(toRef.generic ? { toGeneric: toRef.generic } : {}),
    }
  }

  // Two-ended Mermaid relations: [Relation Type][Link][Relation Type].
  const twoWay = line.match(/^(\S+?)\s+(?:"([^"]*?)"\s+)?(<\||\*|o|<|>)(--|\.\.)(\|>|\*|o|>|<)\s+(?:"([^"]*?)"\s+)?(\S+?)(?:\s*:\s*(.+))?$/)
  if (twoWay) {
    const fromRef = parseClassReference(twoWay[1]!)
    const toRef = parseClassReference(twoWay[7]!)
    if (!fromRef || !toRef) return null
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

  // Relationship regex — handles ordinary one-ended arrows.
  const match = line.match(
    /^(\S+?)\s+(?:"([^"]*?)"\s+)?(<\|--|<\|\.\.|\*--|o--|-->|--\*|--o|--\|>|\.\.>|\.\.\|>|<--|<\.\.?|--)\s+(?:"([^"]*?)"\s+)?(\S+?)(?:\s*:\s*(.+))?$/
  )
  if (!match) return null

  const fromRef = parseClassReference(match[1]!)
  const toRef = parseClassReference(match[5]!)
  if (!fromRef || !toRef) return null
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
      label = normalizeBrTags(right.slice(i + 1).trim()) || undefined
      // Mermaid's Class label token has one separator; a second top-level
      // colon is not an accepted relationship label (including URL syntax).
      if (label?.includes(':')) return null
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
    case '--':   return { type: 'association',  markerAt: 'to' }
    default:     return null
  }
}
