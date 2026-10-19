import type { Accessibility, DiagramBody } from './types.ts'

/** Serialize universal Mermaid accessibility metadata for structured bodies. */
export function appendAccessibilityLines(
  lines: string[],
  value: { accessibilityTitle?: string; accessibilityDescription?: string },
): void {
  if (value.accessibilityTitle !== undefined) lines.push(`  accTitle: ${value.accessibilityTitle}`)
  if (value.accessibilityDescription === undefined) return
  if (!value.accessibilityDescription.includes('\n')) {
    lines.push(`  accDescr: ${value.accessibilityDescription}`)
    return
  }
  lines.push('  accDescr {')
  for (const line of value.accessibilityDescription.split(/\r?\n/)) lines.push(`    ${line.trim()}`)
  lines.push('  }')
}

/** Add envelope-owned accessibility directives to a canonical structured
 * family serialization when that body serializer does not model them. */
export function ensureAccessibilityLines(source: string, accessibility: Accessibility): string {
  const missing: string[] = []
  if (accessibility.title !== undefined && !/^\s*accTitle(?:\s*:|\s+)/im.test(source)) {
    missing.push(`  accTitle: ${accessibility.title}`)
  }
  if (accessibility.descr !== undefined && !/^\s*accDescr(?:\s*:|\s*\{)/im.test(source)) {
    appendAccessibilityLines(missing, { accessibilityDescription: accessibility.descr })
  }
  if (missing.length === 0) return source

  const trailingNewline = source.endsWith('\n')
  const lines = source.replace(/\n$/, '').split(/\r?\n/)
  const headerIndex = lines.findIndex(line => line.trim().length > 0)
  lines.splice(headerIndex < 0 ? 0 : headerIndex + 1, 0, ...missing)
  return lines.join('\n') + (trailingNewline ? '\n' : '')
}

/** The accessibility directives a family read after a statement on their
 * line (`read`) whose value differs from one the source envelope read on a
 * line of its own (`held`). Mermaid keeps whichever is written last. */
export function statementAccessibilityConflicts(read: Accessibility, held: Accessibility): Array<'accTitle' | 'accDescr'> {
  const conflicts: Array<'accTitle' | 'accDescr'> = []
  if (read.title !== undefined && held.title !== undefined && read.title !== held.title) conflicts.push('accTitle')
  if (read.descr !== undefined && held.descr !== undefined && read.descr !== held.descr) conflicts.push('accDescr')
  return conflicts
}

/** Hand the envelope (directives that start a line) the accessibility a
 * family read after a statement on its line. When the envelope holds another
 * value for that directive, Mermaid keeps whichever is written last, which
 * neither reader can tell: false, and the caller keeps the source. */
export function adoptStatementAccessibility(meta: { accessibility: Accessibility }, read: Accessibility): boolean {
  const held = meta.accessibility
  if (statementAccessibilityConflicts(read, held).length > 0) return false
  if ((read.title !== undefined && held.title === undefined) || (read.descr !== undefined && held.descr === undefined)) {
    meta.accessibility = { ...held, ...(read.title !== undefined ? { title: read.title } : {}), ...(read.descr !== undefined ? { descr: read.descr } : {}) }
  }
  return true
}

/** Accessibility-capable structured bodies mirror the universal envelope so
 * typed mutation APIs can edit it. Undefined means the body has no such
 * fields and the metadata envelope remains the sole authority. */
export function accessibilityFromBody(body: DiagramBody): Accessibility | undefined {
  switch (body.kind) {
    case 'timeline':
    case 'journey':
    case 'architecture':
    case 'xychart':
    case 'pie':
    case 'quadrant':
    case 'mindmap':
    case 'gitgraph':
    case 'c4':
      return {
        ...(body.accessibilityTitle !== undefined ? { title: body.accessibilityTitle } : {}),
        ...(body.accessibilityDescription !== undefined ? { descr: body.accessibilityDescription } : {}),
      }
    default:
      return undefined
  }
}

/** Mirror envelope metadata onto the structured body shapes that expose typed
 * accessibility mutation. Family grammar parsers never re-scan directives. */
export function attachAccessibilityToBody(body: DiagramBody, accessibility: Accessibility): void {
  switch (body.kind) {
    case 'timeline':
    case 'journey':
    case 'architecture':
    case 'xychart':
    case 'pie':
    case 'quadrant':
    case 'mindmap':
    case 'gitgraph':
    case 'c4':
      if (accessibility.title !== undefined) body.accessibilityTitle = accessibility.title
      if (accessibility.descr !== undefined) body.accessibilityDescription = accessibility.descr
      break
  }
}
