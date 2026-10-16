/** Stable generated IDs that cannot alias an authored element in this render. */
export function terminalIds(authored: Iterable<string>): (preferred: string) => string {
  const occupied = new Set(authored), assigned = new Map<string, string>()
  return preferred => {
    const previous = assigned.get(preferred)
    if (previous !== undefined) return previous
    let id = preferred, suffix = 1
    while (occupied.has(id)) id = `${preferred}#${suffix++}`
    occupied.add(id); assigned.set(preferred, id)
    return id
  }
}
