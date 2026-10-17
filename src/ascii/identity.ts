type TerminalIdentityKey = string | readonly [string, ...(string | number)[]]

/** Stable generated IDs that cannot alias an authored element in this render.
 * Composite semantic keys retain their components independently of the name. */
export function terminalIds(authored: Iterable<string>): (preferred: string, key?: TerminalIdentityKey) => string {
  const occupied = new Set(authored), assigned = new Map<string, string>()
  return (preferred, key = preferred) => {
    const components = typeof key === 'string' ? key : [...key]
    if (typeof components !== 'string' && components.some(component => typeof component === 'number' && !Number.isFinite(component))) {
      throw new TypeError('Terminal identity key numeric components must be finite')
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
