/** Stable generated IDs that cannot alias an authored element in this render.
 * A semantic key distinguishes elements whose preferred spellings coincide. */
export function terminalIds(authored: Iterable<string>): (preferred: string, key?: string) => string {
  const occupied = new Set(authored), assigned = new Map<string, string>()
  return (preferred, key = preferred) => {
    const previous = assigned.get(key)
    if (previous !== undefined) return previous
    let id = preferred, suffix = 1
    while (occupied.has(id)) id = `${preferred}#${suffix++}`
    occupied.add(id); assigned.set(key, id)
    return id
  }
}
