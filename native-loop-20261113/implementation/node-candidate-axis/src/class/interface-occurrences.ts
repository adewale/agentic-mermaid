import type { MarkerDescriptor } from '../scene/ir.ts'
import { generatedIds } from '../shared/generated-identity.ts'
import type { ClassStatementNode } from './parser.ts'
import type { ClassRelationship } from './types.ts'

/** Only a lone lollipop denotes a named interface. Two marked endpoints
 * remain ordinary class relationships in pinned Mermaid. */
export function classInterfaceSide(relation: Pick<ClassRelationship, 'type' | 'markerAt' | 'fromType' | 'toType'>): 'from' | 'to' | undefined {
  if (relation.markerAt === 'from' && (relation.fromType ?? relation.type) === 'lollipop') return 'from'
  if (relation.markerAt === 'to' && (relation.toType ?? relation.type) === 'lollipop') return 'to'
  return undefined
}

/** One independent occurrence per lollipop endpoint, reserved against every
 * authored class identity before replay (including future interface<N> IDs). */
export function createClassInterfaceAllocator(statements: readonly ClassStatementNode[]): () => string {
  const scan = [...statements]
  let hasInterface = false
  while (scan.length) {
    const node = scan.pop()!
    if (node.value.kind === 'relationship' && classInterfaceSide(node.value.relationship)) {
      hasInterface = true
      break
    }
    if (node.children) scan.push(...node.children)
  }
  // Ordinary class diagrams need no occurrence identity tables.
  if (!hasInterface)
    return () => {
      throw new Error('No lollipop interface occurrence was declared')
    }
  const authored = new Set<string>()
  const pending = [...statements]
  while (pending.length) {
    const node = pending.pop()!,
      value = node.value
    if (node.children) pending.push(...node.children)
    if (value.kind === 'class') authored.add(value.declaration.id)
    else if (value.kind === 'annotation') authored.add(value.annotation.id)
    else if (value.kind === 'member' || value.kind === 'note') {
      if (value.reference) authored.add(value.reference.id)
    } else if (value.kind === 'interaction') authored.add(value.interaction.id)
    else if (value.kind === 'relationship') {
      authored.add(value.relationship.from)
      authored.add(value.relationship.to)
    } else if (value.kind === 'style' || value.kind === 'assignment') for (const reference of value.references) authored.add(reference.id)
  }
  const allocate = generatedIds(authored)
  let index = 0
  return () => {
    const occurrence = index++
    return allocate(`interface${occurrence}`, ['interface', occurrence])
  }
}

/** One descriptor authority for the rendered circle and public glyph geometry. */
export function classInterfaceMarker(stroke: string): MarkerDescriptor {
  return { id: 'cls-lollipop', shape: 'circle', size: { width: 14, height: 14 }, viewBox: { x: 0, y: 0, width: 14, height: 14 }, ref: { x: 12, y: 7 }, orient: 'auto-start-reverse', overflow: 'hidden', geometry: { kind: 'circle', cx: 7, cy: 7, r: 5 }, paint: { fill: 'var(--bg)', stroke, strokeWidth: '1.5' } }
}
