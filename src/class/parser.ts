import type { ClassDiagram, ClassNode, ClassRelationship, ClassMember, RelationshipType, ClassNamespace } from './types.ts'
import { normalizeBrTags } from '../multiline-utils.ts'
import { parseDirectionStatement } from '../shared/direction-statement.ts'
import { parseStyleProps } from '../shared/style-props.ts'

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

/** Shared safe-link grammar for renderer and agent class parsers. */
export function parseClassInteraction(line: string): { id: string; generic?: string; href: string } | null {
  const link = line.match(/^(?:click|link)\s+(\S+)\s+(?:href\s+)?(?:"((?:\\.|[^"])*)"|(https?:\/\/\S+|mailto:\S+))/i)
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
  lines = lines.flatMap(expandInlineNamespaceStatement)
  const diagram: ClassDiagram = {
    classes: [],
    classDefs: new Map(),
    relationships: [],
    notes: [],
    namespaces: [],
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

    const accTitle = parseAccessibilityLine(line, 'accTitle')
    if (accTitle !== undefined) {
      diagram.accessibilityTitle = accTitle
      continue
    }

    const accDescrStart = line.match(/^accDescr\s*:?\s*\{\s*(.*)$/i)
    if (accDescrStart) {
      const parsed = collectAccessibilityBlock(accDescrStart[1] ?? '', lines, i)
      diagram.accessibilityDescription = normalizeBrTags(parsed.text)
      i = parsed.nextIndex
      continue
    }

    const accDescr = parseAccessibilityLine(line, 'accDescr')
    if (accDescr !== undefined) {
      diagram.accessibilityDescription = accDescr
      continue
    }

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
      const annotMatch = line.match(/^<<(\w+)>>$/)
      if (annotMatch) {
        currentClass.annotation = annotMatch[1]!
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

    // --- Inline annotation: `class ClassName { <<interface>> }` (single line) ---
    const inlineAnnotMatch = line.match(/^class\s+(\S+?)\s*\{\s*<<(\w+)>>\s*\}$/)
    if (inlineAnnotMatch) {
      const ref = parseClassReference(inlineAnnotMatch[1]!)
      if (!ref) continue
      const cls = ensureClass(classMap, ref.id, ref.generic)
      cls.annotation = inlineAnnotMatch[2]!
      claimClass(cls.id)
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
      // Make sure this isn't a relationship line (those have arrows)
      const rest = inlineAttrMatch[2]!
      if (!rest.match(/<\|--|--|\*--|o--|-->|\.\.>|\.\.\|>/)) {
        const ref = parseClassReference(inlineAttrMatch[1]!)
        if (!ref) continue
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
  }

  diagram.classes = [...classMap.values()]
  return diagram
}

function parseAccessibilityLine(line: string, directive: 'accTitle' | 'accDescr'): string | undefined {
  const match = line.match(new RegExp(`^${directive}\\s*:?[ \\t]+(.+)$`, 'i'))
  return match ? normalizeBrTags(match[1]!.trim()) : undefined
}

function collectAccessibilityBlock(initial: string, lines: string[], startIndex: number): { text: string; nextIndex: number } {
  const initialEnd = initial.indexOf('}')
  if (initialEnd !== -1) return { text: initial.slice(0, initialEnd).trim(), nextIndex: startIndex }
  const parts = [initial.trim()].filter(Boolean)
  for (let i = startIndex + 1; i < lines.length; i++) {
    const line = lines[i]!
    const end = line.indexOf('}')
    if (end !== -1) {
      const beforeBrace = line.slice(0, end).trim()
      if (beforeBrace) parts.push(beforeBrace)
      return { text: parts.join('\n'), nextIndex: i }
    }
    parts.push(line)
  }
  throw new Error('Class accDescr block is missing a closing "}"')
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
