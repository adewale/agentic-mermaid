import { appendNativeAccessibilityLines, parseAccessibilityDirective, scanAccessibilityDirectives } from '../shared/accessibility-directives.ts'
import type { Accessibility, DiagramBody, FamilyParsedBody, ValidDiagramMeta } from './types.ts'
import type { FamilyOperations } from './family-registry.ts'
import { getInstalledFamilyDescriptor } from './family-router.ts'

export class AccessibilityTextError extends Error {}

/** Inspect the writer's actual fields: families with an owned grammar escape
 * or JSON transport can protect text which the ordinary field cannot spell.
 * A literal opener lets pinned preprocessing consume even an unclosed directive. */
export function accessibilitySerializationProblem(source: string, statementEnds?: (lines: readonly string[]) => readonly number[]): string | undefined {
  if (!source.includes('%%{')) return undefined
  const lines = source.split(/\r?\n/)
  const value = scanAccessibilityDirectives(lines, statementEnds?.(lines)).accessibility
  return [value.title, value.descr].some(text => text?.includes('%%{')) ? 'Accessibility text contains an init-directive opener. Source is preserved for native reading; remove the literal opener before typed editing or portable export.' : undefined
}

/** JSON-comment fields have no physical-line grammar restriction. */
export function nativeAccessibilityText(value: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new AccessibilityTextError('Accessibility metadata must be non-empty text')
  return value.trim()
}

export function accessibilityTitleText(value: string): string {
  if (typeof value !== 'string' || !value.trim() || /[\r\n]/.test(value)) throw new AccessibilityTextError('Accessibility title must be non-empty single-line text')
  return value.trim()
}

export function accessibilityDescriptionText(value: string): string {
  if (typeof value !== 'string') throw new AccessibilityTextError('Accessibility description must be text')
  const text = value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .join('\n')
    .trim()
  if (!text) throw new AccessibilityTextError('Accessibility description must be non-empty text')
  return text
}

/** Canonicalize the same physical lines the envelope parser consumes before
 * publishing a mutated body or deriving comments and source locations. */
export function normalizeBodyAccessibility<T extends DiagramBody>(body: T): T {
  if (bodyAccessibility(body)?.syntax === 'native') return body
  const fields = accessibilityFromBody(body)
  if (!fields) return body
  const title = fields.title === undefined ? undefined : accessibilityTitleText(fields.title)
  // Empty parsed blocks are valid retained values; setters validate new text.
  const descr = fields.descr === undefined || fields.descr === '' ? fields.descr : accessibilityDescriptionText(fields.descr)
  return title === fields.title && descr === fields.descr
    ? body
    : {
        ...body,
        ...(title !== undefined ? { accessibilityTitle: title } : {}),
        ...(descr !== undefined ? { accessibilityDescription: descr } : {}),
      }
}

/** Serialize universal Mermaid accessibility metadata for structured bodies. */
export function appendAccessibilityLines(lines: string[], value: { accessibilityTitle?: string; accessibilityDescription?: string }): void {
  if (value.accessibilityTitle !== undefined) lines.push(`  accTitle: ${accessibilityTitleText(value.accessibilityTitle)}`)
  if (value.accessibilityDescription === undefined) return
  // Readers can retain an explicitly empty block. Its writer spelling is
  // independent of the non-empty mutation-input contract above.
  const description = value.accessibilityDescription.trim() ? accessibilityDescriptionText(value.accessibilityDescription) : ''
  if (!description) {
    // Class and C4 have no empty accDescr production. A native comment retains the
    // explicit empty value while external Mermaid keeps its empty default.
    appendNativeAccessibilityLines(lines, { accessibilityDescription: '' })
    return
  }
  if (description && !description.includes('\n')) {
    lines.push(`  accDescr: ${description}`)
    return
  }
  lines.push('  accDescr {')
  for (const line of description.split('\n')) lines.push(`    ${line}`)
  lines.push('  }')
}

/** Add envelope-owned accessibility directives to a canonical structured
 * family serialization when that body serializer does not model them. */
export function ensureAccessibilityLines(source: string, accessibility: Accessibility): string {
  const header =
    source
      .split(/\r?\n/)
      .find(line => line.trim() && !line.trimStart().startsWith('%%'))
      ?.trim() ?? ''
  const native = /^(?:zenuml|eventmodeling|block(?:-beta)?|sankey(?:-beta)?|mindmap|ishikawa(?:-beta)?)(?:\s|$)/i.test(header)
  const present = new Set<string>()
  const physical = source.split(/\r?\n/)
  for (let index = 0; index < physical.length; index++) {
    const directive = parseAccessibilityDirective(physical, index)
    if (directive) {
      present.add(directive.title ? 'title' : 'descr')
      index = directive.endIndex
    }
  }
  const missing: string[] = []
  const append = native ? appendNativeAccessibilityLines : appendAccessibilityLines
  if (accessibility.title !== undefined && !present.has('title')) {
    append(missing, { accessibilityTitle: accessibility.title })
  }
  if (accessibility.descr !== undefined && !present.has('descr')) {
    append(missing, { accessibilityDescription: accessibility.descr })
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

type AccessibilityBody<B = DiagramBody> = B extends DiagramBody ? 'accessibilityTitle' extends keyof B ? 'accessibilityDescription' extends keyof B ? B : never : never : never

/** Declare ownership where the family's reader and writer are assembled. The
 * kind is constrained to body types that actually expose both fields. */
export function ownBodyAccessibility<K extends AccessibilityBody['kind']>(kind: K, syntax: 'statement' | 'native' = 'statement'): NonNullable<FamilyOperations['bodyAccessibility']> {
  return body => body.kind === kind ? { fields: body as Extract<AccessibilityBody, { kind: K }>, syntax } : undefined
}

function bodyAccessibility(body: DiagramBody): ReturnType<NonNullable<FamilyOperations['bodyAccessibility']>> {
  return getInstalledFamilyDescriptor(body.kind)?.bodyAccessibility?.(body)
}

/** Undefined leaves the envelope as authority; an empty object deliberately
 * clears the metadata owned by this structured body. */
export function accessibilityFromBody(body: DiagramBody): Accessibility | undefined {
  const owned = bodyAccessibility(body)
  if (!owned) return undefined
  const { fields } = owned
  return {
    ...(fields.accessibilityTitle !== undefined ? { title: fields.accessibilityTitle } : {}),
    ...(fields.accessibilityDescription !== undefined ? { descr: fields.accessibilityDescription } : {}),
  }
}

/** Mirror envelope metadata only onto fields owned by the family descriptor.
 * Grammar-consumed values remain authoritative when the envelope has none. */
export function attachAccessibilityToBody(body: DiagramBody, accessibility: Accessibility): void {
  const fields = bodyAccessibility(body)?.fields
  if (!fields) return
  if (accessibility.title !== undefined) fields.accessibilityTitle = accessibility.title
  if (accessibility.descr !== undefined) fields.accessibilityDescription = accessibility.descr
}

/** Resolve all body-owned metadata through the same descriptor used to parse
 * and write it. Save and mutation commit must not restore stale envelope values. */
export function metadataFromBody(body: FamilyParsedBody, meta: ValidDiagramMeta, previousBody?: FamilyParsedBody): ValidDiagramMeta {
  if (body.kind === 'extension' || body.kind === 'preserved') return meta
  const previous = previousBody?.kind === 'extension' || previousBody?.kind === 'preserved' ? undefined : previousBody
  const accessibility = accessibilityFromBody(body)
  const mirrored = accessibility === undefined ? meta : { ...meta, accessibility }
  return getInstalledFamilyDescriptor(body.kind)?.bodyMeta?.(body, mirrored, previous) ?? mirrored
}
