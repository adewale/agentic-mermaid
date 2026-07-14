// Mermaid-universal accessibility directives — accTitle / accDescr single
// lines and accDescr { … } blocks — are legal in every diagram family.
// Source normalization owns their grammar. Family parsers receive the
// directive-free grammar view plus this typed projection; they must not scan
// the source for the same metadata a second time.

import type { MermaidSourceAccessibility } from '../mermaid-source.ts'

export interface AccessibilityFieldProjection {
  accessibilityTitle?: string
  accessibilityDescription?: string
}

export interface AccessibilityObjectProjection {
  accessibility?: { title?: string; description?: string }
}

/** Project the normalized universal envelope onto the field shape used by
 * sequence/class/ER/timeline/journey/architecture/mindmap/gitgraph models. */
export function accessibilityFields(
  accessibility: MermaidSourceAccessibility,
): AccessibilityFieldProjection {
  return {
    ...(accessibility.title !== undefined ? { accessibilityTitle: accessibility.title } : {}),
    ...(accessibility.descr !== undefined ? { accessibilityDescription: accessibility.descr } : {}),
  }
}

/** Return a model carrying the normalized universal accessibility fields.
 * The original model is retained when the envelope is empty. */
export function withAccessibilityFields<T extends object>(
  value: T,
  accessibility: MermaidSourceAccessibility,
): T & AccessibilityFieldProjection {
  if (accessibility.title === undefined && accessibility.descr === undefined) {
    return value as T & AccessibilityFieldProjection
  }
  return { ...value, ...accessibilityFields(accessibility) }
}

/** Project the normalized universal envelope onto the object shape used by
 * XYChart and Quadrant renderer models. */
export function withAccessibilityObject<T extends object>(
  value: T,
  accessibility: MermaidSourceAccessibility,
): T & AccessibilityObjectProjection {
  if (accessibility.title === undefined && accessibility.descr === undefined) {
    return value as T & AccessibilityObjectProjection
  }
  return {
    ...value,
    accessibility: {
      ...(accessibility.title !== undefined ? { title: accessibility.title } : {}),
      ...(accessibility.descr !== undefined ? { description: accessibility.descr } : {}),
    },
  }
}

/**
 * If `lines[i]` starts an accessibility directive, return the index of its
 * LAST line (the caller's loop increment then steps past it); otherwise -1.
 * Handles single-line `accTitle:`/`accDescr:` and multi-line `accDescr {`
 * blocks terminated by a line containing `}`.
 */
export function accessibilityDirectiveEnd(lines: readonly string[], i: number): number {
  const line = lines[i]!.trim()
  if (/^acc(Title|Descr)\s*:/i.test(line)) return i
  if (/^accDescr\s*\{/i.test(line)) {
    let end = i
    while (end < lines.length && !lines[end]!.includes('}')) end++
    return end
  }
  return -1
}
