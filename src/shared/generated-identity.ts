export type GeneratedIdentityKey = string | readonly [string, ...(string | number)[]]

/** Allocate readable names independently of structured semantic identity.
 * Authored names are reserved before any generated identity is assigned. */
export function generatedIds(authored: Iterable<string>): (preferred: string, key?: GeneratedIdentityKey) => string {
  const occupied = new Set(authored), assigned = new Map<string, string>()
  return (preferred, key = preferred) => {
    const components = typeof key === 'string' ? key : [...key]
    if (typeof components !== 'string' && components.some(component => typeof component === 'number' && !Number.isFinite(component))) {
      throw new TypeError('Generated identity key numeric components must be finite')
    }
    const semanticKey = JSON.stringify(components)
    const previous = assigned.get(semanticKey)
    if (previous !== undefined) return previous
    let id = preferred, suffix = 1
    while (occupied.has(id)) id = `${preferred}#${suffix++}`
    occupied.add(id); assigned.set(semanticKey, id)
    return id
  }
}
