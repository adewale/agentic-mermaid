/** Mermaid State comments consume the remainder of their line, including when
 * they follow a statement. Kept separate from the State grammar so shared
 * family routing does not pull the full State parse core into every bundle. */
export function stripStateComment(line: string): string {
  const marker = line.indexOf('%%')
  return (marker < 0 ? line : line.slice(0, marker)).trim()
}
