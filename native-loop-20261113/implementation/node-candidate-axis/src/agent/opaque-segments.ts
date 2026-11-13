interface OpaqueBlockSegment { kind: 'opaque-block'; lines: string[] }

function isOpaqueBlockSegment<T extends { kind: string }>(value: T | undefined): value is T & OpaqueBlockSegment {
  return value?.kind === 'opaque-block' && Array.isArray((value as Partial<OpaqueBlockSegment>).lines)
}

/** Coalesce adjacent source-preserved lines without coupling family statement unions. */
export function appendOpaqueSegment<T extends { kind: string }>(
  statements: T[],
  lines: readonly string[],
  create: (copiedLines: string[]) => T,
): void {
  const last = statements[statements.length - 1]
  if (isOpaqueBlockSegment(last)) last.lines.push(...lines)
  else statements.push(create([...lines]))
}

/** The statements a reader would build from the same lines: an edit that
 * removes the statement between two preserved segments leaves one segment. */
export function coalesceOpaqueSegments<T extends { kind: string }>(statements: readonly T[]): T[] {
  const out: T[] = []
  for (const statement of statements) {
    if (isOpaqueBlockSegment(statement)) appendOpaqueSegment(out, statement.lines, lines => ({ ...statement, lines }))
    else out.push(statement)
  }
  return out
}
