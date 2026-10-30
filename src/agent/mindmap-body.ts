import { nativeAccessibilityText } from './accessibility-envelope.ts'
import type {
  LayoutWarning, MindmapBody, MindmapMutationOp, MutationError, Result, VerifyOptions,
} from './types.ts'
import { err, ok } from './types.ts'
import type { MindmapNode, MindmapShape } from '../mindmap/types.ts'
import { assignMindmapIdentities, mindmapAuthoredId, mindmapNestedShapeLines, mindmapNonportableTextLines, mindmapSerializationProblem, mindmapStatementEnds, parseMindmap, serializeMindmap } from '../mindmap/parser.ts'
import { parseAccessibilityDirective } from '../shared/accessibility-directives.ts'
import { labelOverflowCollector, setOptionalField } from './body-utils.ts'
import { unknownOpMessage } from './mutation-ops.ts'

export { mindmapSerializationProblem } from '../mindmap/parser.ts'

/** Parsed bodies whose authored header pinned Mermaid rejects for the space
 * after it. The canonical source keeps no blank line or trailing whitespace,
 * so parsing records it for verify. */
const spaceAfterHeader = new WeakSet<MindmapBody>()

/** `authored` is the authored source from the header on. */
export function parseMindmapBody(source: string, authored?: string): MindmapBody {
  const diagram = parseMindmap(source)
  const body: MindmapBody = { kind: 'mindmap', ...diagram }
  if (authored !== undefined && mermaidRejectsSpaceAfterHeader(authored)) spaceAfterHeader.add(body)
  return body
}

/** Mermaid's mindmap lexer takes whitespace at the end of the header line, or
 * a blank line after it, together with the line break, as one SPACELINE
 * token, which its grammar accepts after the header only before another line
 * break. It first removes each directive, leaving its line, and each `%%`
 * line together with the blank lines before it. */
function mermaidRejectsSpaceAfterHeader(authored: string): boolean {
  const text = authored.replace(/\r\n?/g, '\n')
    .replace(/%%\{[\s\S]*?\}%%/g, '')
    .replace(/^\s*%%(?!\{)[^\n]+\n?/gm, '')
    .replace(/^\s*mindmap/i, '')
  const space = /^\s*/.exec(text)![0]
  return space.lastIndexOf('\n') > 0 && space.length < text.length
}

export function renderMindmapBody(body: MindmapBody): string {
  return serializeMindmap(body)
}

function cloneNode(node: MindmapNode): MindmapNode {
  return { ...node, children: node.children.map(cloneNode) }
}

function cloneBody(body: MindmapBody): MindmapBody {
  return {
    kind: 'mindmap', root: cloneNode(body.root),
    ...(body.accessibilityTitle !== undefined ? { accessibilityTitle: body.accessibilityTitle } : {}),
    ...(body.accessibilityDescription !== undefined ? { accessibilityDescription: body.accessibilityDescription } : {}),
  }
}

interface Located { node: MindmapNode; parent?: MindmapNode }
function locate(root: MindmapNode, id: string, parent?: MindmapNode): Located | undefined {
  if (root.id === id) return { node: root, ...(parent ? { parent } : {}) }
  for (const child of root.children) {
    const found = locate(child, id, root)
    if (found) return found
  }
  return undefined
}

function validAccessibility(value: string, field: string): Result<string, MutationError> {
  try { return ok(nativeAccessibilityText(value)) }
  catch { return err({ code: 'INVALID_OP', message: `Mindmap accessibility ${field} must be non-empty text` }) }
}

function validText(value: unknown, field: string): Result<string, MutationError> {
  if (typeof value !== 'string' || !value.trim() || /[\r\n]/.test(value)) return err({ code: 'INVALID_OP', message: `Mindmap ${field} must be a non-empty single-line string` })
  return ok(value.trim())
}

const SHAPES: MindmapShape[] = ['default', 'rect', 'rounded', 'circle', 'cloud', 'bang', 'hexagon']

function stableNodeSyntax(id: string, label: string, shape: MindmapShape, markdown?: true): boolean {
  try {
    const reparsed = parseMindmap(serializeMindmap({ root: { id, label, shape, ...(markdown ? { markdown } : {}), children: [] } })).root
    return reparsed.id === id && reparsed.label === label && reparsed.shape === shape
  } catch {
    return false
  }
}

function unstableNodeError(id: string, label: string, shape: MindmapShape): Result<never, MutationError> {
  const text = shape === 'default' ? label : `${id}/${label}`
  const guidance = shape === 'default'
    ? 'choose a bordered shape for decorated labels'
    : `choose an id and label that do not conflict with ${shape} delimiters`
  return err({ code: 'INVALID_OP', message: `${shape === 'default' ? 'Default mindmap node text' : 'Mindmap node text'} '${text}' is not serialization-stable; ${guidance}` })
}

function nodeSignature(node: MindmapNode): string {
  return JSON.stringify([node.id, node.label, node.shape, node.markdown, node.icon, node.className, node.children.map(nodeSignature)])
}

function bodySignature(body: Pick<MindmapBody, 'root' | 'accessibilityTitle' | 'accessibilityDescription'>): string {
  return JSON.stringify([body.accessibilityTitle, body.accessibilityDescription, nodeSignature(body.root)])
}

/** Line-oriented decorations/metadata must leave the prospective body identical after reparse. */
function stableBodySyntax(body: MindmapBody): boolean {
  try {
    return bodySignature(parseMindmap(serializeMindmap(body))) === bodySignature(body)
  } catch {
    return false
  }
}

function unstableDecorationError(field: 'icon' | 'class', value: string): Result<never, MutationError> {
  return err({ code: 'INVALID_OP', message: `Mindmap ${field} '${value}' is not serialization-stable` })
}

/** Ids that earlier edits in a batch moved, old → current: set_label or
 * rename_node on a default-shaped node (its text is its id), or occurrence
 * ids renumbered by a structural edit. A body published by a fresh parse has
 * none, so this only explains addresses within one batch. */
const movedIds = new WeakMap<MindmapBody, ReadonlyMap<string, string>>()

function allNodes(root: MindmapNode): MindmapNode[] {
  const nodes: MindmapNode[] = []
  const visit = (node: MindmapNode): void => { nodes.push(node); node.children.forEach(visit) }
  visit(root)
  return nodes
}

export function mutateMindmap(body: MindmapBody, op: MindmapMutationOp): Result<MindmapBody, MutationError> {
  const problem = mindmapSerializationProblem(body)
  if (problem) return err({ code: 'INVALID_OP', message: problem })
  const next = cloneBody(body)
  const before = new Map(allNodes(next.root).map(node => [node, node.id]))
  const moved = new Map(movedIds.get(body) ?? [])
  const result = applyMindmapOp(next, op, moved)
  if (!result.ok) return result
  // One identity rule for parsing and editing: the edited body has the ids a
  // fresh parse of its source gives.
  assignMindmapIdentities(next.root)
  const live = new Set<string>()
  for (const node of allNodes(next.root)) {
    live.add(node.id)
    const old = before.get(node)
    if (old === undefined || old === node.id) continue
    for (const [from, to] of moved) if (to === old) moved.set(from, node.id)
    moved.set(old, node.id)
  }
  for (const from of moved.keys()) if (live.has(from)) moved.delete(from)
  if (moved.size) movedIds.set(next, moved)
  return ok(next)
}

function applyMindmapOp(next: MindmapBody, op: MindmapMutationOp, moved: ReadonlyMap<string, string>): Result<MindmapBody, MutationError> {
  const allIds = (): Set<string> => new Set(allNodes(next.root).map(node => node.id))
  // An address that names no node: say where an earlier edit moved it, or
  // list the ids there are.
  const rule = `A default-shaped node's text is its id (set_label and rename_node rename it), and repeated identities are numbered in document order (X, X#2, …).`
  const notFound = (role: 'node' | 'parent', id: string): Result<never, MutationError> => {
    const now = moved.get(id)
    if (now !== undefined) return err({ code: 'NODE_NOT_FOUND', message: `Mindmap ${role} '${id}' not found: an earlier edit changed its id to '${now}'; address it as '${now}'. ${rule}` })
    const ids = [...allIds()]
    const shown = ids.slice(0, 12).map(value => `'${value}'`).join(', ')
    return err({ code: 'NODE_NOT_FOUND', message: `Mindmap ${role} '${id}' not found. Node ids: ${shown}${ids.length > 12 ? `, … (${ids.length - 12} more)` : ''}. ${rule}` })
  }
  const duplicate = (id: string): Result<never, MutationError> => err({
    code: 'DUPLICATE_NODE',
    message: id === next.root.id
      ? `Mindmap node '${id}' already exists: it is the root, and every mindmap has exactly one (a new mindmap starts with the root 'root'). Rename it with rename_node or set_label, or add this node under a parent.`
      : `Mindmap node '${id}' already exists; choose another id.`,
  })
  switch (op.kind) {
    case 'add_node': {
      const id = validText(op.id, 'node id'); if (!id.ok) return id
      const label = validText(op.label, 'label'); if (!label.ok) return label
      if (allIds().has(id.value)) return duplicate(id.value)
      const parent = locate(next.root, op.parent)
      if (!parent) return notFound('parent', op.parent)
      const shape = op.shape ?? 'default'
      if (!SHAPES.includes(shape)) return err({ code: 'INVALID_OP', message: `Mindmap shape must be one of: ${SHAPES.join(', ')}` })
      if (shape === 'default' && id.value !== label.value) return err({ code: 'INVALID_OP', message: `A default-shaped mindmap node's text is its identity, so its id must equal its label; pass id '${label.value}', or give a bordered shape (rect, rounded, circle, cloud, bang, hexagon) for id '${id.value}' with label '${label.value}'` })
      if (!stableNodeSyntax(id.value, label.value, shape)) return unstableNodeError(id.value, label.value, shape)
      const index = op.index ?? parent.node.children.length
      if (!Number.isInteger(index) || index < 0 || index > parent.node.children.length) return err({ code: 'INVALID_OP', message: `Mindmap child index ${index} is out of range` })
      parent.node.children.splice(index, 0, { id: id.value, label: label.value, shape, children: [] })
      return ok(next)
    }
    case 'remove_node': {
      const found = locate(next.root, op.id)
      if (!found) return notFound('node', op.id)
      if (!found.parent) return err({ code: 'INVALID_OP', message: 'The mindmap root cannot be removed' })
      if (found.node.children.length > 0 && op.recursive !== true) return err({ code: 'INVALID_OP', message: `Mindmap node '${op.id}' has children; pass recursive:true to remove its subtree` })
      found.parent.children.splice(found.parent.children.indexOf(found.node), 1)
      return ok(next)
    }
    case 'rename_node': {
      const found = locate(next.root, op.from)
      if (!found) return notFound('node', op.from)
      const to = validText(op.to, 'rename target'); if (!to.ok) return to
      if (allIds().has(to.value)) return duplicate(to.value)
      // Valid default-shape nodes use their label as identity by construction.
      const nextLabel = found.node.shape === 'default' ? to.value : found.node.label
      if (!stableNodeSyntax(to.value, nextLabel, found.node.shape, found.node.markdown)) return unstableNodeError(to.value, nextLabel, found.node.shape)
      found.node.label = nextLabel
      found.node.id = to.value
      delete found.node.sourceId
      return ok(next)
    }
    case 'set_label': {
      const found = locate(next.root, op.id)
      if (!found) return notFound('node', op.id)
      const label = validText(op.label, 'label'); if (!label.ok) return label
      const authored = mindmapAuthoredId(found.node)
      // A default-shaped node's text is its identity: a new text renames it.
      const renames = found.node.shape === 'default' && label.value !== authored
      if (renames && allIds().has(label.value)) return duplicate(label.value)
      const nextId = renames ? label.value : authored
      if (!stableNodeSyntax(nextId, label.value, found.node.shape, found.node.markdown)) return unstableNodeError(nextId, label.value, found.node.shape)
      if (renames) {
        found.node.id = nextId
        delete found.node.sourceId
      }
      found.node.label = label.value
      return ok(next)
    }
    case 'move_node': {
      const found = locate(next.root, op.id)
      const parent = locate(next.root, op.parent)
      if (!found) return notFound('node', op.id)
      if (!parent) return notFound('parent', op.parent)
      if (!found.parent) return err({ code: 'INVALID_OP', message: 'The mindmap root cannot be moved' })
      if (locate(found.node, op.parent)) return err({ code: 'INVALID_OP', message: `Cannot move '${op.id}' into its own subtree` })
      found.parent.children.splice(found.parent.children.indexOf(found.node), 1)
      const index = op.index ?? parent.node.children.length
      if (!Number.isInteger(index) || index < 0 || index > parent.node.children.length) return err({ code: 'INVALID_OP', message: `Mindmap child index ${index} is out of range` })
      parent.node.children.splice(index, 0, found.node)
      return ok(next)
    }
    case 'set_shape': {
      const found = locate(next.root, op.id)
      if (!found) return notFound('node', op.id)
      if (!SHAPES.includes(op.shape)) return err({ code: 'INVALID_OP', message: `Mindmap shape must be one of: ${SHAPES.join(', ')}` })
      const authored = mindmapAuthoredId(found.node)
      if (op.shape === 'default' && authored !== found.node.label) return err({ code: 'INVALID_OP', message: `A default-shaped mindmap node's text is its identity, so its id must equal its label; rename '${authored}' to '${found.node.label}' first (rename_node), or keep a bordered shape` })
      if (!stableNodeSyntax(authored, found.node.label, op.shape, found.node.markdown)) return unstableNodeError(authored, found.node.label, op.shape)
      found.node.shape = op.shape
      return ok(next)
    }
    case 'set_icon': {
      const found = locate(next.root, op.id)
      if (!found) return notFound('node', op.id)
      if (op.icon === null) delete found.node.icon
      else {
        const icon = validText(op.icon, 'icon'); if (!icon.ok) return icon
        found.node.icon = icon.value
        if (!stableBodySyntax(next)) return unstableDecorationError('icon', icon.value)
      }
      return ok(next)
    }
    case 'set_node_class': {
      const found = locate(next.root, op.id)
      if (!found) return notFound('node', op.id)
      if (op.className === null) delete found.node.className
      else {
        const value = validText(op.className, 'class'); if (!value.ok) return value
        found.node.className = value.value
        if (!stableBodySyntax(next)) return unstableDecorationError('class', value.value)
      }
      return ok(next)
    }
    case 'set_accessibility_title': {
      const title = setOptionalField(next, 'accessibilityTitle', op.title, value => validAccessibility(value, 'title'))
      if (!title.ok) return title
      if (next.accessibilityTitle !== undefined && !stableBodySyntax(next)) return err({ code: 'INVALID_OP', message: `Mindmap accessibility title '${next.accessibilityTitle}' is not serialization-stable` })
      return ok(next)
    }
    case 'set_accessibility_description': {
      const description = setOptionalField(next, 'accessibilityDescription', op.description, value => validAccessibility(value, 'description'))
      if (!description.ok) return description
      if (next.accessibilityDescription !== undefined && !stableBodySyntax(next)) return err({ code: 'INVALID_OP', message: `Mindmap accessibility description '${next.accessibilityDescription}' is not serialization-stable` })
      return ok(next)
    }
    default:
      return err({ code: 'INVALID_OP', message: unknownOpMessage('mindmap', op) })
  }
}

/** Mindmap source ours reads where pinned Mermaid reads it otherwise, each
 * on its canonical line: shape text holding its own delimiters in pairs, and
 * an accessibility directive, which Mermaid's mindmap grammar does not have. */
export function mindmapUnsupportedSyntaxWarnings(canonicalSource: string): LayoutWarning[] {
  const warnings: Array<LayoutWarning & { line: number }> = mindmapNestedShapeLines(canonicalSource).map(line => ({
    code: 'UNSUPPORTED_SYNTAX',
    syntax: 'mindmap_nested_shape_delimiters',
    line,
    message: 'Shape text holding delimiters of its own in pairs, as `root((a (b) c))`, is read whole. Pinned Mermaid ends the shape at the first closing delimiter and rejects the rest; put the whole text in double quotes.',
  }))
  const lines = canonicalSource.split(/\r?\n/)
  const header = lines.findIndex(line => /^\s*mindmap\s*$/i.test(line))
  // A line inside a shape's text is no directive (mindmapStatementEnds).
  const ends = mindmapStatementEnds(lines)
  for (let index = header + 1; header >= 0 && index < lines.length;) {
    const directive = parseAccessibilityDirective(lines, index)
    if (directive === undefined) break
    if (directive === null) {
      index = ends[index]! + 1
      continue
    }
    warnings.push({
      code: 'UNSUPPORTED_SYNTAX',
      syntax: 'mindmap_accessibility',
      line: index + 1,
      message: 'Mindmap accessibility metadata is carried in native comments on export. External Mermaid ignores this metadata; diagram topology is preserved.',
    })
    index = directive.endIndex + 1
  }
  for (const problem of mindmapNonportableTextLines(canonicalSource)) warnings.push({
    code: 'UNSUPPORTED_SYNTAX', syntax: 'mindmap_nonportable_text', line: problem.line,
    message: `${problem.message}. The source is preserved; change this text to unlock typed Mindmap edits.`,
  })
  return warnings.sort((left, right) => left.line - right.line)
}

export function verifyMindmap(body: MindmapBody, opts: VerifyOptions): LayoutWarning[] {
  const warnings: LayoutWarning[] = []
  const overflow = labelOverflowCollector(warnings, opts)
  const visit = (node: MindmapNode): void => {
    overflow(node.id, node.label)
    node.children.forEach(visit)
  }
  visit(body.root)
  if (spaceAfterHeader.has(body)) {
    warnings.push({
      code: 'UNSUPPORTED_SYNTAX',
      syntax: 'mindmap_space_after_header',
      // The header's line in the body.
      line: 1,
      message: 'Whitespace at the end of the mindmap header line, or a blank line right after it, is ignored. Pinned Mermaid rejects the diagram; remove it, as the writer does.',
    })
  }
  return warnings
}
