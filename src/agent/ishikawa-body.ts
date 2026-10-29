export { ISHIKAWA_OP_SCHEMAS, ISHIKAWA_OP_KINDS } from '../ishikawa/ops.ts'
import { unknownOpMessage } from './mutation-ops.ts'
import type { IshikawaBody, IshikawaMutationOp } from '../ishikawa/types.ts'
import { isIshikawaHeader, parseIshikawaDiagram } from '../ishikawa/parser.ts'
import type { LayoutWarning, MutationError, Result, VerifyOptions } from './types.ts'
import { ok, err } from './types.ts'
import { labelOverflowCollector } from './body-utils.ts'
import { nativeAccessibilityText } from './accessibility-envelope.ts'
import { appendNativeAccessibilityLines, parseAccessibilityDirective } from '../shared/accessibility-directives.ts'
import { hierarchyChildren, hierarchyDescendants, validateHierarchy } from '../shared/hierarchy-model.ts'
import { writeGrammarText } from '../shared/grammar-text.ts'

// The header token takes this prefix at every node, before the free-text rule.
// Quotes remain literal label text, so they cannot shield the same label.
const NONPORTABLE_LABEL = /^ishikawa\b/i

export function parseIshikawaBody(lines: string[]): IshikawaBody | null {
  try {
    return parseIshikawaDiagram(['ishikawa', ...lines])
  } catch {
    return null
  }
}

function assertIshikawaLabel(label: unknown): asserts label is string {
  if (typeof label !== 'string' || !label || label !== label.trim() || /[\r\n]/.test(label)) throw new Error('Ishikawa labels must be nonempty single-line text without surrounding whitespace')
}

export function ishikawaUnsupportedSyntaxWarnings(source: string): LayoutWarning[] {
  try {
    parseIshikawaDiagram(source)
    const lines = source.split(/\r?\n/), header = lines.findIndex(isIshikawaHeader)
    const warnings: LayoutWarning[] = lines.flatMap((line, index) => index > header && NONPORTABLE_LABEL.test(line.trim()) ? [{
      code: 'UNSUPPORTED_SYNTAX' as const, syntax: 'ishikawa_label', line: index + 1,
      message: `Ishikawa label "${line.trim()}" is read literally. The writer shields its keyword prefix for pinned Mermaid.`,
    }] : [])
    if (lines[header]?.includes('%%{')) warnings.push({ code: 'UNSUPPORTED_SYNTAX', syntax: 'ishikawa_header_comment', line: header + 1,
      message: 'An unclosed directive-looking comment after the Ishikawa header is read as a comment. Pinned Mermaid rejects this spelling; canonical export writes the header on its own.',
    })
    for (let index = header + 1; index < lines.length; index++) {
      const directive = parseAccessibilityDirective(lines, index)
      if (!directive) continue
      warnings.push({ code: 'UNSUPPORTED_SYNTAX', syntax: 'ishikawa_accessibility', line: index + 1,
        message: 'Ishikawa accessibility metadata is carried in native comments on export. External Mermaid ignores this metadata; diagram topology is preserved.' })
      index = directive.endIndex
    }
    return warnings
  } catch { return [] }
}

export function renderIshikawa(body: IshikawaBody): string {
  validateHierarchy(body.nodes)
  if (body.nodes.length && (body.nodes[0]!.parentId !== undefined || body.nodes.slice(1).some(node => node.parentId === undefined))) throw new Error('Ishikawa must have one effect first, with every cause below it')
  const lines = ['ishikawa']
  appendNativeAccessibilityLines(lines, body)
  const children = hierarchyChildren(body.nodes)
  const pending = [...(children.get(undefined) ?? [])].reverse().map(node => ({ node, depth: 0 }))
  let written = 0
  while (pending.length) {
    const { node, depth } = pending.pop()!
    assertIshikawaLabel(node.label)
    written++
    lines.push(`${'  '.repeat(depth)}${writeGrammarText(node.label, '%', /^(?:ishikawa\b|accTitle\b|accDescr\b)/i)}`)
    for (const child of [...(children.get(node.id) ?? [])].reverse()) pending.push({ node: child, depth: depth + 1 })
  }
  if (written !== body.nodes.length) throw new Error('Ishikawa causes must be connected below the effect')
  return lines.join('\n') + '\n'
}

export function mutateIshikawa(body: IshikawaBody, op: IshikawaMutationOp): Result<IshikawaBody, MutationError> {
  try {
    const next = structuredClone(body)
    const find = (id: string) => {
      const node = next.nodes.find(node => node.id === id)
      if (!node) throw new Error(`Ishikawa node ${id} was not found`)
      return node
    }
    switch (op.kind) {
      case 'set_effect':
        if (next.nodes.length) next.nodes[0]!.label = op.label
        else next.nodes.push({ id: 'effect', label: op.label })
        break
      case 'set_accessibility_title':
        next.accessibilityTitle = op.title == null ? undefined : nativeAccessibilityText(op.title)
        break
      case 'set_accessibility_description':
        next.accessibilityDescription = op.description == null ? undefined : nativeAccessibilityText(op.description)
        break
      case 'add_cause': {
        const parentId = op.parentId ?? next.nodes[0]?.id
        if (!parentId) throw new Error('Set the effect before adding a cause')
        find(parentId)
        let n = 1
        while (next.nodes.some(node => node.id === `cause-${n}`)) n++
        next.nodes.push({ id: `cause-${n}`, label: op.label, parentId })
        break
      }
      case 'remove_cause': {
        const node = find(op.id)
        if (!node.parentId) throw new Error('The effect cannot be removed as a cause')
        const ids = hierarchyDescendants(next.nodes, op.id)
        next.nodes = next.nodes.filter(item => !ids.has(item.id))
        break
      }
      case 'set_label':
        find(op.id).label = op.label
        break
      case 'move_cause': {
        const node = find(op.id)
        find(op.parentId)
        if (!node.parentId) throw new Error('The effect cannot move')
        if (hierarchyDescendants(next.nodes, op.id).has(op.parentId)) throw new Error('A cause cannot move into its own subtree')
        node.parentId = op.parentId
        const siblings = next.nodes.filter(other => other.parentId === op.parentId && other.id !== op.id)
        const index = op.index ?? siblings.length
        if (!Number.isSafeInteger(index) || index < 0 || index > siblings.length) throw new Error('Invalid destination index')
        next.nodes = next.nodes.filter(other => other.id !== op.id)
        const before = siblings[index]
        next.nodes.splice(before ? next.nodes.findIndex(other => other.id === before.id) : next.nodes.length, 0, node)
        break
      }
      default:
        throw new Error(unknownOpMessage('ishikawa', op))
    }
    renderIshikawa(next)
    return ok(next)
  } catch (error) {
    return err({ code: 'INVALID_OP', message: error instanceof Error ? error.message : String(error) })
  }
}

export function verifyIshikawa(body: IshikawaBody, opts: VerifyOptions): LayoutWarning[] {
  const warnings: LayoutWarning[] = []
  if (!body.nodes.length) warnings.push({ code: 'EMPTY_DIAGRAM' })
  const overflow = labelOverflowCollector(warnings, opts)
  for (const node of body.nodes) overflow(node.id, node.label)
  return warnings
}
