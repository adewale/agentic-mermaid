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
      if (accessibility.title !== undefined) body.accessibilityTitle = accessibility.title
      if (accessibility.descr !== undefined) body.accessibilityDescription = accessibility.descr
      break
  }
}
