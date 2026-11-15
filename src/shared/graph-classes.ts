/** Authored graph classes retain assignment order across every projection. */
export function graphClassNames(names: string | undefined): string[] {
  return names?.split(/\s+/).filter(Boolean) ?? []
}

export function appendClassName(previous: string | undefined, name: string): string {
  return previous && name ? `${previous} ${name}` : previous || name
}

export function appendGraphClass(assignments: Map<string, string>, id: string, name: string): void {
  assignments.set(id, appendClassName(assignments.get(id), name))
}
