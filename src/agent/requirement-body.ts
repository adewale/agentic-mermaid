export { REQUIREMENT_OP_SCHEMAS, REQUIREMENT_OP_KINDS } from '../requirement/ops.ts'
import { unknownOpMessage } from './mutation-ops.ts'
import { parseRequirementDiagram, type RequirementStyleDirective } from '../requirement/parser.ts'
import { RequirementType, Relationships, RiskLevel, VerifyType } from '../requirement/db.ts'
import type { RequirementBody, RequirementMutationOp, Requirement, RequirementElement } from '../requirement/types.ts'
import type { Accessibility, LayoutWarning, MutationError, Result, VerifyOptions } from './types.ts'
import { err, ok } from './types.ts'
import { appendAccessibilityLines } from './accessibility-envelope.ts'
import { labelOverflowCollector } from './body-utils.ts'
import { parseMutableStyleProps, parseStyleProps } from '../shared/style-props.ts'
import { mermaidEntityPrepass } from '../shared/mermaid-entities.ts'
import { cleanupMermaidSource } from '../shared/mermaid-cleanup.ts'
import { requirementStyleTextCanSerialize, tokenize } from '../requirement/lexer.ts'
import { T } from '../requirement/tokens.ts'

export function parseRequirementBody(input: string[] | string, accessibility: Accessibility = {}): RequirementBody | null {
  try {
    const source = typeof input === 'string'
      ? input
      : ['requirementDiagram', ...input]
    const styles: RequirementStyleDirective[] = []
    const body = parseRequirementDiagram(source, directive => styles.push(directive))
    if (requirementStyleProblem(body, styles)) return null
    body.accessibilityTitle = accessibility.title ?? body.accessibilityTitle
    body.accessibilityDescription = accessibility.descr ?? body.accessibilityDescription
    return body
  } catch {
    return null
  }
}
const TYPE_NAMES: Record<string, string> = { Requirement: 'requirement', 'Functional Requirement': 'functionalRequirement', 'Interface Requirement': 'interfaceRequirement', 'Performance Requirement': 'performanceRequirement', 'Physical Requirement': 'physicalRequirement', 'Design Constraint': 'designConstraint' }
/** A requirement string as the reader takes it back. A quoted string has no
 * escape for `"`, so text holding one is written bare when the lexer reads the
 * bare run as exactly that text (no `:,{<>-=`, line break, edge space or
 * keyword); otherwise no spelling exists. */
function quoted(value: string): string {
  if (typeof value !== 'string') throw new Error('Requirement strings must be text')
  // A public read normalizes CRLF once. Double the payload CR so a stored
  // CR followed by LF survives that read without changing either character.
  if (!value.includes('"')) return `"${value.replace(/\r\n/g, '\r\r\n')}"`
  const bare = tokenize(value)
  if (bare.types[0] === T.unqString && bare.texts[0] === value && bare.types.slice(1).every(type => type === T.EOF || type === T.END)) return value
  throw new Error(`Requirement string ${JSON.stringify(value)} holds a quote, which a quoted string cannot spell, and also text a bare string cannot hold`)
}
export function renderRequirement(body: RequirementBody): string {
  const problem = requirementStyleProblem(body)
  if (problem) throw new Error(problem)
  const lines = ['requirementDiagram', `  direction ${body.direction}`]
  appendAccessibilityLines(lines, body)
  for (const def of body.classDefs) if (def.styles.length) lines.push(`  classDef ${def.id} ${def.styles.join(',')}`)
  const decorate = (node: Requirement | RequirementElement): void => {
    const classes = node.classes.filter(c => c !== 'default')
    if (classes.length) lines.push(`  ${quoted(node.name)}:::${classes.join(',')}`)
    if (node.directStyles?.length) lines.push(`  style ${quoted(node.name)} ${node.directStyles.join(',')}`)
  }
  for (const node of body.requirements) {
    const keyword = TYPE_NAMES[node.type]
    if (!keyword) throw new Error(`Unknown requirement type ${node.type}`)
    lines.push(`  ${keyword} ${quoted(node.name)} {`)
    if (node.requirementId) lines.push(`    id: ${quoted(node.requirementId)}`)
    if (node.text) lines.push(`    text: ${quoted(node.text)}`)
    if (node.risk) lines.push(`    risk: ${node.risk.toLowerCase()}`)
    if (node.verifyMethod) lines.push(`    verifymethod: ${node.verifyMethod.toLowerCase()}`)
    lines.push('  }')
    decorate(node)
  }
  for (const node of body.elements) {
    lines.push(`  element ${quoted(node.name)} {`)
    if (node.type) lines.push(`    type: ${quoted(node.type)}`)
    if (node.docRef) lines.push(`    docref: ${quoted(node.docRef)}`)
    lines.push('  }')
    decorate(node)
  }
  for (const edge of body.relations) lines.push(`  ${quoted(edge.src)} - ${edge.type} -> ${quoted(edge.dst)}`)
  return lines.join('\n') + '\n'
}

function requirementStyleHasEntity(prefix: string, styles: string[]): boolean {
  // Entity markers are not tokens in the style lexer. The public prepass
  // can remove the final marker's semicolon after a property colon, so test
  // the complete emitted style line rather than rejecting safe CSS colors.
  return /#\w+;/.test(mermaidEntityPrepass(prefix + styles.join(',')).slice(prefix.length))
}

function requirementStyleProblem(body: RequirementBody, authoredStyles?: RequirementStyleDirective[]): string | undefined {
  const directives = authoredStyles ?? [
    ...body.classDefs.map(def => ({ prefix: `classDef ${def.id} `, styles: def.styles })),
    ...[...body.requirements, ...body.elements].map(node => ({ prefix: `style ${quoted(node.name)} `, styles: node.directStyles ?? [] })),
  ]
  for (const { prefix, styles } of directives) {
    if (requirementStyleHasEntity(prefix, styles)) return `Requirement ${prefix.trim()} contains an entity-like style token that pinned Mermaid cannot read, so the authored source must be preserved`
    const text = styles.join(',')
    if (!requirementStyleTextCanSerialize(text)) return `Requirement ${prefix.trim()} contains style text that pinned Mermaid's styleComponent tokens cannot spell losslessly; the authored source must be preserved`
    const problem = requirementStylePropertiesProblem(prefix, parseStyleProps(text))
    if (problem) return problem
  }
  return undefined
}

function requirementStylePropertiesProblem(prefix: string, props: Readonly<Record<string, string>>): string | undefined {
  for (const [name, value] of Object.entries(props)) {
    if (/[,;:\s]/.test(name)) return `Requirement ${prefix.trim()} property name ${JSON.stringify(name)} cannot retain its field boundary in pinned Mermaid's style lexer; the authored source must be preserved`
    if (!requirementStyleTextCanSerialize(`${name}:${value}`)) return `Requirement ${prefix.trim()} contains style text that pinned Mermaid's styleComponent tokens cannot spell losslessly; the authored source must be preserved`
    if (value.includes(',')) return `Requirement ${prefix.trim()} style value ${JSON.stringify(value)} contains a comma that pinned Mermaid splits into separate fields; the authored source must be preserved`
    if (/\s/.test(value)) return `Requirement ${prefix.trim()} style value ${JSON.stringify(value)} loses meaningful whitespace in pinned Mermaid's style lexer; the authored source must be preserved`
  }
  return undefined
}

export function requirementUnsupportedSyntaxWarnings(source: string, authoredLine?: (line: number) => string | undefined): LayoutWarning[] {
  try {
    const styles: RequirementStyleDirective[] = []
    const payload = cleanupMermaidSource(source).authoredPayloadText
    const lines = payload.split(/\r\n?|\n/)
    const warnings: LayoutWarning[] = []
    let line = 1, previous = 0
    const body = parseRequirementDiagram(payload, directive => styles.push(directive), offset => {
      line += payload.slice(previous, offset).match(/\r\n?|\n/g)?.length ?? 0
      previous = offset
      const text = authoredLine?.(line) ?? lines[line - 1]!
      if (/[^\S\r\n]+$/.test(text) && !warnings.some(warning => warning.code === 'UNSUPPORTED_SYNTAX' && warning.syntax === 'requirement_whitespace')) warnings.push({ code: 'UNSUPPORTED_SYNTAX', syntax: 'requirement_whitespace', line, message: 'Requirement whitespace before a required line break is read as a statement boundary. Pinned Mermaid consumes that break as whitespace and rejects the next statement; canonical output removes the trailing whitespace.' })
    })
    const problem = requirementStyleProblem(body, styles)
    if (problem) warnings.push({ code: 'UNSUPPORTED_SYNTAX', syntax: 'requirement_style_token', message: problem })
    return warnings
  } catch {
    return []
  }
}
function assertNode(node: Requirement | RequirementElement): void {
  if (typeof node.name !== 'string' || !node.name.trim()) throw new Error('Node name must be non-empty text')
  for (const value of [node.name, ...('text' in node ? [node.requirementId, node.text] : [node.type, node.docRef])]) quoted(value)
  if ('text' in node) {
    if (!Object.values(RequirementType).includes(node.type as never)) throw new Error('Invalid requirement type')
    if (node.risk && !Object.values(RiskLevel).includes(node.risk as never)) throw new Error('Invalid risk; use Low, Medium or High')
    if (node.verifyMethod && !Object.values(VerifyType).includes(node.verifyMethod as never)) throw new Error('Invalid verification method')
  }
}
export function mutateRequirement(body: RequirementBody, op: RequirementMutationOp): Result<RequirementBody, MutationError> {
  const next = structuredClone(body),
    nodes = [...next.requirements, ...next.elements]
  const find = (id: string): Requirement | RequirementElement => {
    const node = nodes.find(n => n.name === id)
    if (!node) throw new Error(`Requirement node ${id} not found`)
    return node
  }
  const unused = (id: string): void => {
    if (nodes.some(n => n.name === id)) throw new Error(`Requirement node ${id} already exists`)
  }
  try {
    switch (op.kind) {
      case 'set_direction':
        if (!['TB', 'BT', 'LR', 'RL'].includes(op.direction)) throw new Error('Invalid requirement direction')
        next.direction = op.direction
        break
      case 'add_requirement': {
        const node: Requirement = { type: 'Requirement', requirementId: '', text: '', risk: '', verifyMethod: '', classes: ['default'], ...op.requirement, cssStyles: [] }
        unused(node.name)
        assertNode(node)
        next.requirements.push(node)
        break
      }
      case 'update_requirement': {
        const node = next.requirements.find(n => n.name === op.id)
        if (!node) throw new Error(`Requirement ${op.id} not found`)
        Object.assign(node, op.changes)
        assertNode(node)
        break
      }
      case 'add_element': {
        const node: RequirementElement = { type: '', docRef: '', classes: ['default'], ...op.element, cssStyles: [] }
        unused(node.name)
        assertNode(node)
        next.elements.push(node)
        break
      }
      case 'update_element': {
        const node = next.elements.find(n => n.name === op.id)
        if (!node) throw new Error(`Element ${op.id} not found`)
        Object.assign(node, op.changes)
        assertNode(node)
        break
      }
      case 'rename_node': {
        const node = find(op.from)
        if (op.from !== op.to) unused(op.to)
        node.name = op.to
        assertNode(node)
        for (const e of next.relations) {
          if (e.src === op.from) e.src = op.to
          if (e.dst === op.from) e.dst = op.to
        }
        break
      }
      case 'remove_node': {
        find(op.id)
        if (!op.cascade && next.relations.some(e => e.src === op.id || e.dst === op.id)) throw new Error('Node has relations; pass cascade: true')
        next.requirements = next.requirements.filter(n => n.name !== op.id)
        next.elements = next.elements.filter(n => n.name !== op.id)
        next.relations = next.relations.filter(e => e.src !== op.id && e.dst !== op.id)
        break
      }
      case 'add_relation': {
        find(op.relation.src)
        find(op.relation.dst)
        if (!Object.values(Relationships).includes(op.relation.type as never)) throw new Error('Invalid requirement relation')
        const ids = new Set(next.relations.map(e => e.id))
        let index = 1
        while (ids.has(`relation-${index}`)) index++
        const id = op.relation.id ?? `relation-${index}`
        if (ids.has(id)) throw new Error('Relation id already exists')
        next.relations.push({ ...op.relation, id })
        break
      }
      case 'remove_relation':
        if (!next.relations.some(e => e.id === op.id)) throw new Error('Relation not found')
        next.relations = next.relations.filter(e => e.id !== op.id)
        break
      case 'define_class': {
        if (!/^\w+$/.test(op.name)) throw new Error('Class name must be a word')
        if (requirementStyleHasEntity(`classDef ${op.name} `, [op.style])) throw new Error('Requirement class style contains an entity-like token that pinned Mermaid cannot read')
        const parsed = parseMutableStyleProps(op.style)
        if (!parsed.ok) throw new Error(`Invalid style: ${parsed.reason}`)
        const problem = requirementStylePropertiesProblem(`classDef ${op.name} `, parsed.value)
        if (problem) throw new Error(problem)
        const styles = Object.entries(parsed.value).map(([name, value]) => `${name}:${value}`)
        const old = next.classDefs.find(d => d.id === op.name)
        if (old) old.styles = styles
        else next.classDefs.push({ id: op.name, styles, textStyles: [] })
        break
      }
      case 'set_node_class': {
        const node = find(op.id)
        if (op.className !== null && !/^\w+$/.test(op.className)) throw new Error('Invalid class name')
        node.classes = op.className === null ? ['default'] : ['default', op.className]
        break
      }
      case 'set_node_style': {
        const node = find(op.id)
        if (op.style === null) node.directStyles = []
        else {
          if (requirementStyleHasEntity(`style ${quoted(node.name)} `, [op.style])) throw new Error('Requirement node style contains an entity-like token that pinned Mermaid cannot read')
          const parsed = parseMutableStyleProps(op.style)
          if (!parsed.ok) throw new Error(`Invalid style: ${parsed.reason}`)
          const problem = requirementStylePropertiesProblem(`style ${quoted(node.name)} `, parsed.value)
          if (problem) throw new Error(problem)
          node.directStyles = Object.entries(parsed.value).map(([name, value]) => `${name}:${value}`)
        }
        break
      }
      default:
        throw new Error(unknownOpMessage('requirement', op))
    }
    const reparsed = parseRequirementDiagram(cleanupMermaidSource(renderRequirement(next)).authoredPayloadText)
    reparsed.relations.forEach((edge, i) => {
      edge.id = next.relations[i]!.id
    })
    return ok(reparsed)
  } catch (error) {
    return err({ code: 'INVALID_OP', message: error instanceof Error ? error.message : String(error) })
  }
}
export function verifyRequirement(body: RequirementBody, opts: VerifyOptions): LayoutWarning[] {
  const warnings: LayoutWarning[] = [],
    overflow = labelOverflowCollector(warnings, opts)
  const ids = new Set([...body.requirements, ...body.elements].map(n => n.name))
  if (!ids.size) warnings.push({ code: 'EMPTY_DIAGRAM' })
  for (const node of [...body.requirements, ...body.elements]) {
    overflow(node.name, node.name)
    if ('text' in node) overflow(node.name, node.text)
  }
  for (const e of body.relations) if (!ids.has(e.src) || !ids.has(e.dst)) warnings.push({ code: 'UNSUPPORTED_SYNTAX', syntax: 'undeclared endpoint', message: `Relation ${e.id} references an undeclared endpoint` })
  return warnings
}
