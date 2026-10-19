import type { MermaidGraph } from '../types.ts'
import type { FlowchartMutationOp } from './types.ts'
/** Draft overlay never escapes the mutation closure: output is reparsed from
 * its canonical source. Untouched records can therefore remain shared while
 * the serializer observes them, without exposing aliases to either caller. */
class DraftMap<K, V> {
  private changes = new Map<K, V>()
  private deleted = new Set<K>()
  private reinserted = new Set<K>()
  private count: number
  private readonly parent: Map<K, V>
  constructor(parent: Map<K, V>) { this.parent = parent; this.count = parent.size }
  get size(): number { return this.count }
  has(key: K): boolean { return this.changes.has(key) || !this.deleted.has(key) && this.parent.has(key) }
  get(key: K): V | undefined { return this.changes.has(key) ? this.changes.get(key) : this.deleted.has(key) ? undefined : this.parent.get(key) }
  set(key: K, value: V): this {
    if (!this.has(key)) { this.count++; if (this.parent.has(key)) this.reinserted.add(key) }
    this.changes.set(key, value); return this
  }
  delete(key: K): boolean {
    if (!this.has(key)) return false
    this.changes.delete(key); this.deleted.add(key); this.reinserted.delete(key); this.count--; return true
  }
  *entries(): IterableIterator<[K, V]> {
    for (const [key, value] of this.parent) if (!this.reinserted.has(key) && !this.deleted.has(key)) yield [key, this.changes.has(key) ? this.changes.get(key)! : value]
    for (const [key, value] of this.changes) if (!this.parent.has(key) || this.reinserted.has(key)) yield [key, value]
  }
  [Symbol.iterator](): IterableIterator<[K, V]> { return this.entries() }
  *keys(): IterableIterator<K> { for (const [key] of this) yield key }
  *values(): IterableIterator<V> { for (const [, value] of this) yield value }
  forEach(fn: (value: V, key: K, map: Map<K, V>) => void): void { for (const [key, value] of this) fn(value, key, this as unknown as Map<K, V>) }
}
let active = false
export function withPersistentMutationDraft<T>(run: () => T): T { const previous = active; active = true; try { return run() } finally { active = previous } }
export function persistentMutationDraft(graph: MermaidGraph, op: FlowchartMutationOp): MermaidGraph | undefined {
  if (!active) return undefined
  const safe = op.kind === 'add_node' && !op.parent || op.kind === 'add_edge' || op.kind === 'set_shape' || op.kind === 'set_label' && graph.nodes.has(op.target)
    || op.kind === 'set_direction' && op.subgraph == null || op.kind === 'define_class' || op.kind === 'set_node_class' || op.kind === 'set_node_style'
  if (!safe) return undefined
  const overlay = <K, V>(map: Map<K, V>): Map<K, V> => new DraftMap(map) as unknown as Map<K, V>
  const nodes = overlay(graph.nodes)
  if (op.kind === 'set_label') nodes.set(op.target, { ...nodes.get(op.target)! })
  return { direction: graph.direction, nodes,
    edges: op.kind === 'add_edge' ? [...graph.edges] : graph.edges,
    subgraphs: graph.subgraphs, classDefs: overlay(graph.classDefs), classAssignments: overlay(graph.classAssignments), nodeStyles: overlay(graph.nodeStyles), linkStyles: graph.linkStyles }
}
