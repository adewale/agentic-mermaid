import { generatedIds, type GeneratedIdentityKey } from '../shared/generated-identity.ts'
import type { C4Body } from './types.ts'

/** Reserve authored names before allocating projection-only identities. Neither
 * a display sanitizer nor a concatenated endpoint pair defines C4 identity. */
export function planC4Identity(body: C4Body): {
  nodes: ReadonlyMap<string, string>
  relationships: ReadonlyMap<string, string>
  generated: (preferred: string, key?: GeneratedIdentityKey) => string
} {
  const nodes = new Map([...body.elements, ...body.boundaries].map(record => [record.id, record.id]))
  const relationships = new Map(body.relationships.map(record => [record.id, record.id]))
  return { nodes, relationships, generated: generatedIds([...nodes.keys(), ...relationships.keys(), ...(body.legend?.entries.map(entry => entry.id) ?? [])]) }
}
