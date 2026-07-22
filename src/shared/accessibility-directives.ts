// Mermaid-universal accessibility directives — accTitle / accDescr single
// lines and accDescr { … } blocks — are legal in every diagram family.
// Source normalization owns their grammar. Family parsers receive the
// directive-free grammar view plus this typed projection; they must not scan
// the source for the same metadata a second time.

export interface MermaidAccessibility {
  title?: string
  descr?: string
}

export interface ParsedAccessibilityDirective {
  title: boolean
  form: 'inline' | 'block'
  value: string
  /** Index of the last physical line consumed by this directive. */
  endIndex: number
  /** A family statement authored after the closing brace on the same line. */
  suffixLine?: string
}

export interface AccessibilityScan {
  accessibility: MermaidAccessibility
  /** Original physical lines with valid universal directives removed. */
  familyLines: string[]
  /** First unterminated accDescr block, retained in `familyLines`. */
  unclosedIndex?: number
}

const ACC_TITLE_RE = /^\s*accTitle(?:\s*:\s*|\s+)(.+)$/i
const ACC_DESCR_INLINE_RE = /^\s*accDescr(?:\s*:\s*|\s+)(.+)$/i
const ACC_DESCR_BLOCK_RE = /^\s*accDescr\s*:?\s*\{(.*)$/i
/**
 * Parse one universal accessibility directive. `null` means the line is not
 * a directive; `undefined` means it opens an unclosed description block and
 * must remain family-visible so normal parse/opaque error handling still
 * applies.
 */
export function parseAccessibilityDirective(
  lines: readonly string[],
  startIndex: number,
): ParsedAccessibilityDirective | null | undefined {
  const line = lines[startIndex]
  if (line === undefined) return null

  const block = line.match(ACC_DESCR_BLOCK_RE)
  if (block) {
    const parts: string[] = []
    for (let index = startIndex; index < lines.length; index++) {
      const content = index === startIndex ? block[1]! : lines[index]!
      const closing = content.indexOf('}')
      if (closing < 0) {
        if (content.trim()) parts.push(content.trim())
        continue
      }
      const beforeClosing = content.slice(0, closing).trim()
      if (beforeClosing) parts.push(beforeClosing)
      const suffix = content.slice(closing + 1)
      const indent = lines[index]!.match(/^\s*/)?.[0] ?? ''
      return {
        title: false,
        form: 'block',
        value: parts.join('\n').trim(),
        endIndex: index,
        ...(suffix.trim() ? { suffixLine: indent + suffix.trimStart() } : {}),
      }
    }
    return undefined
  }

  const title = line.match(ACC_TITLE_RE)
  if (title) return { title: true, form: 'inline', value: title[1]!.trim(), endIndex: startIndex }
  const description = line.match(ACC_DESCR_INLINE_RE)
  if (description) return { title: false, form: 'inline', value: description[1]!.trim(), endIndex: startIndex }
  return null
}

/**
 * Remove valid universal directives and collect their last-authored values in
 * one pass. Invalid/unclosed blocks and everything after them are preserved
 * byte-for-byte for the family parser. This is the source-normalization waist:
 * registered families receive its `familyLines` automatically and never need
 * their own accTitle/accDescr grammar.
 */
export function scanAccessibilityDirectives(lines: readonly string[]): AccessibilityScan {
  const accessibility: MermaidAccessibility = {}
  const familyLines: string[] = []
  let unclosedIndex: number | undefined

  for (let index = 0; index < lines.length; index++) {
    const directive = parseAccessibilityDirective(lines, index)
    if (directive === undefined) {
      unclosedIndex = index
      familyLines.push(...lines.slice(index))
      break
    }
    if (directive === null) {
      familyLines.push(lines[index]!)
      continue
    }
    if (directive.title) accessibility.title = directive.value
    else accessibility.descr = directive.value
    if (directive.suffixLine) familyLines.push(directive.suffixLine)
    index = directive.endIndex
  }

  return {
    accessibility,
    familyLines,
    ...(unclosedIndex !== undefined ? { unclosedIndex } : {}),
  }
}

/** Apply the common strict-family policy without duplicating parser guards. */
export function requireClosedAccessibility(scan: AccessibilityScan): void {
  if (scan.unclosedIndex !== undefined) throw new Error('Unclosed accDescr block')
}

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
  accessibility: MermaidAccessibility,
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
  accessibility: MermaidAccessibility,
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
  accessibility: MermaidAccessibility,
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
