export { USECASE_OP_KINDS, USECASE_OP_SCHEMAS } from '../usecase/ops.ts'

import { accessibilityFields } from '../shared/accessibility-directives.ts'
import { readAuthoredGrammarAccessibility } from '../shared/grammar-text.ts'
import { parseUsecase } from '../usecase/grammar/parser.ts'
import { parseUsecaseDiagram } from '../usecase/parser.ts'
import { serializeUsecase } from '../usecase/serializer.ts'
import type { UsecaseBody, UsecaseMutationOp, UsecaseNode } from '../usecase/types.ts'
import { accessibilityDescriptionText, accessibilityTitleText } from './accessibility-envelope.ts'
import { labelOverflowCollector } from './body-utils.ts'
import type { FamilyOperations } from './families.ts'
import type { LayoutWarning, MutationError, Result, SourceMap, VerifyOptions } from './types.ts'
import { err, ok } from './types.ts'

export function mutateUsecase(body: UsecaseBody, op: UsecaseMutationOp): Result<UsecaseBody, MutationError> {
  try {
    const next = structuredClone(body)
    const find = (id: string) => {
      const node = next.nodes.find(node => node.id === id)
      if (!node) throw new Error(`Unknown UseCase node ${id}`)
      return node
    }
    const exists = (id: string) => [...next.nodes, ...next.boundaries, ...next.jsonNodes].some(node => node.id === id)
    switch (op.kind) {
      case 'add_actor':
      case 'add_usecase': {
        if (exists(op.id)) throw new Error(`Duplicate UseCase identity ${op.id}`)
        if (op.parentId && !next.boundaries.some(boundary => boundary.id === op.parentId)) throw new Error(`Unknown UseCase boundary ${op.parentId}`)
        const common = { id: op.id, label: op.label ?? op.id, parentId: op.parentId, labelType: 'text' as const, business: false, classes: [], styles: [] }
        next.nodes.push(op.kind === 'add_actor' ? { ...common, kind: 'actor', type: 'normal' } : { ...common, kind: 'usecase', shape: op.shape ?? 'ellipse' })
        break
      }
      case 'add_boundary':
        if (exists(op.id)) throw new Error(`Duplicate UseCase identity ${op.id}`)
        next.boundaries.push({ id: op.id, label: op.label ?? op.id, labelType: 'text', type: op.boundaryType ?? 'rect', members: [], classes: [], styles: [] })
        break
      case 'remove_node': {
        if (!exists(op.id)) throw new Error(`Unknown UseCase node ${op.id}`)
        const removed = new Set([op.id, ...next.nodes.filter(node => node.parentId === op.id).map(node => node.id)])
        if (!op.cascade && (removed.size > 1 || next.relationships.some(edge => removed.has(edge.source) || removed.has(edge.target)) || next.notes.some(note => removed.has(note.target)))) throw new Error('Use cascade to remove a connected node or populated boundary')
        next.nodes = next.nodes.filter(node => !removed.has(node.id))
        next.boundaries = next.boundaries.filter(node => !removed.has(node.id))
        next.jsonNodes = next.jsonNodes.filter(node => !removed.has(node.id))
        next.relationships = next.relationships.filter(edge => !removed.has(edge.source) && !removed.has(edge.target))
        next.notes = next.notes.filter(note => !removed.has(note.target))
        break
      }
      case 'set_label': {
        const node = [...next.nodes, ...next.boundaries].find(node => node.id === op.id)
        if (!node) throw new Error(`Unknown UseCase label ${op.id}`)
        node.label = op.label
        break
      }
      case 'move_node':
        if (op.parentId !== null && !next.boundaries.some(boundary => boundary.id === op.parentId)) throw new Error(`Unknown UseCase boundary ${op.parentId}`)
        find(op.id).parentId = op.parentId ?? undefined
        break
      case 'add_relationship': {
        if (!exists(op.from) || !exists(op.to)) throw new Error('UseCase relationships require existing endpoints')
        let index = 0
        while (next.relationships.some(edge => edge.id === `relationship_${index}`) || exists(`relationship_${index}`)) index++
        const id = op.id ?? `relationship_${index}`
        if (exists(id) || next.relationships.some(edge => edge.id === id)) throw new Error(`Duplicate UseCase relationship ${id}`)
        const type = op.relation ?? 'association'
        next.relationships.push({
          id,
          explicitId: true,
          source: op.from,
          target: op.to,
          type,
          arrowType: 0,
          label: type === 'include' || type === 'extend' ? type : op.label,
          ...(op.label || type === 'include' || type === 'extend' ? { labelType: 'text' as const } : {}),
          minlen: 1,
          classes: [],
          styles: [],
          animate: false,
        })
        break
      }
      case 'remove_relationship':
        if (!next.relationships.some(edge => edge.id === op.id)) throw new Error(`Unknown UseCase relationship ${op.id}`)
        next.relationships = next.relationships.filter(edge => edge.id !== op.id)
        break
      case 'set_direction':
        next.direction = op.direction
        break
      case 'set_title':
        next.title = op.title ?? undefined
        break
      case 'set_accessibility_title':
        next.accessibilityTitle = op.title === null ? undefined : accessibilityTitleText(op.title)
        break
      case 'set_accessibility_description':
        next.accessibilityDescription = op.description === null ? undefined : accessibilityDescriptionText(op.description)
        break
      default:
        throw new Error('Unknown UseCase operation')
    }
    for (const boundary of next.boundaries) boundary.members = next.nodes.filter(node => node.parentId === boundary.id).map(node => node.id)
    const reparsed = parseUsecaseDiagram(serializeUsecase(next, false))
    if (next.title !== undefined) reparsed.title = next.title
    return ok(reparsed)
  } catch (error) {
    return err({ code: 'INVALID_OP', message: error instanceof Error ? error.message : String(error) })
  }
}
export function verifyUsecase(body: UsecaseBody, options: VerifyOptions): LayoutWarning[] {
  const warnings: LayoutWarning[] = []
  if (!body.nodes.length && !body.jsonNodes.length && !body.boundaries.length) warnings.push({ code: 'EMPTY_DIAGRAM' })
  const overflow = labelOverflowCollector(warnings, options)
  for (const node of [...body.nodes, ...body.boundaries, ...body.notes]) overflow(node.id, node.label)
  for (const edge of body.relationships) if (edge.label) overflow(edge.id, edge.label)
  return warnings
}
export const USECASE_SOURCE_HOOKS: FamilyOperations = {
  parse: ctx => {
    try {
      const body = parseUsecaseDiagram(ctx.source.authoredFamilyBody ?? ctx.source.familyBody)
      serializeUsecase(body, false)
      const accessibility = readAuthoredGrammarAccessibility(ctx.meta.accessibility)
      Object.assign(body, accessibilityFields(accessibility))
      ctx.meta.accessibility = accessibility
      if (typeof ctx.source.frontmatter.title === 'string') body.title = ctx.source.frontmatter.title
      return ok(body)
    } catch {
      return ok({ kind: 'opaque', family: 'usecase', source: ctx.opaqueSource })
    }
  },
  serialize: body => {
    if (body.kind !== 'usecase') throw new Error('Expected UseCase body')
    return serializeUsecase(body, false)
  },
  renderSource: () => 'serialized',
  mutate: (body, op) => (body.kind === 'usecase' ? mutateUsecase(body, op as UsecaseMutationOp) : err({ code: 'INVALID_OP', message: 'Expected UseCase body' })),
  verify: (body, options) => (body.kind === 'usecase' ? verifyUsecase(body, options) : []),
  extractLabels: source => {
    try {
      const body = parseUsecaseDiagram(source)
      return [...body.nodes, ...body.boundaries, ...body.notes].map(node => ({ text: node.label, target: node.id }))
    } catch {
      return []
    }
  },
  buildSourceMap: (body, source) => {
    const map: SourceMap = { nodes: new Map(), edges: new Map(), groups: new Map(), labels: new Map() }
    if (body.kind !== 'usecase') return map
    const first = source.indexOf('usecase-beta'),
      model = parseUsecase(source.slice(first)),
      statements = [...model.statements].reverse()
    const point = (offset: number) => {
      const prefix = source.slice(0, first + offset),
        lines = prefix.split('\n')
      return { line: lines.length, col: lines.at(-1)!.length + 1 }
    }
    while (statements.length) {
      const statement = statements.pop()!
      if (statement.group && statement.idSpan) map.groups.set(statement.group, point(statement.idSpan[0]))
      for (const node of statement.nodes ?? []) {
        if (!map.nodes.has(node.id)) map.nodes.set(node.id, point(node.idSpan[0]))
        if (node.labelSpan) map.labels.set(`node:${node.id}`, point(node.labelSpan[0]))
      }
      for (const edge of statement.edges ?? []) map.edges.set(edge.id, point(edge.span[0]))
      for (const child of [...(statement.children ?? [])].reverse()) statements.push(child)
    }
    return map
  },
}
export function usecaseUnsupportedSyntaxWarnings(_source: string): LayoutWarning[] {
  return []
}
