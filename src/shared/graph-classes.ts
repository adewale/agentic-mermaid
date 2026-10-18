/** Authored graph classes retain assignment order across every projection. */
export function graphClassNames(names: string | undefined): string[] {
  return names?.split(/\s+/).filter(Boolean) ?? []
}

export function appendGraphClass(assignments: Map<string, string>, id: string, name: string): void {
  const previous = assignments.get(id)
  assignments.set(id, previous ? `${previous} ${name}` : name)
}
