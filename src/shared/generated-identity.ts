export type GeneratedIdentityKey = string | readonly [string, ...(string | number)[]]

/** Allocation state as plain data, so an artifact that carries it (such as a
 * positioned layout a later drawing continues) stays cloneable and cacheable. */
export interface GeneratedIdentityState {
  readonly occupied: Set<string>
  readonly assigned: Map<string, string>
}

/** Authored names are reserved before any generated identity is assigned. */
export function generatedIdentityState(authored: Iterable<string>): GeneratedIdentityState {
  return { occupied: new Set(authored), assigned: new Map() }
}

/** Allocate a readable name independently of structured semantic identity. */
export function allocateGeneratedId(state: GeneratedIdentityState, preferred: string, key: GeneratedIdentityKey = preferred): string {
  const components = typeof key === 'string' ? key : [...key]
  if (typeof components !== 'string' && components.some(component => typeof component === 'number' && !Number.isFinite(component))) {
    throw new TypeError('Generated identity key numeric components must be finite')
  }
  const semanticKey = JSON.stringify(components)
  const previous = state.assigned.get(semanticKey)
  if (previous !== undefined) return previous
  let id = preferred, suffix = 1
  while (state.occupied.has(id)) id = `${preferred}#${suffix++}`
  state.occupied.add(id); state.assigned.set(semanticKey, id)
  return id
}

/** Allocate readable names independently of structured semantic identity.
 * Authored names are reserved before any generated identity is assigned. */
export function generatedIds(authored: Iterable<string>): (preferred: string, key?: GeneratedIdentityKey) => string {
  const state = generatedIdentityState(authored)
  return (preferred, key = preferred) => allocateGeneratedId(state, preferred, key)
}
