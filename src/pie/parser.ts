import type { PieChart, PieEntry } from './types.ts'
import { normalizeBrTags } from '../multiline-utils.ts'

// ============================================================================
// Pie chart parser
//
// Parses Mermaid pie syntax into a PieChart structure.
//
// Supported syntax:
//   pie [showData]
//   title <text>
//   "<label>" : <positive number>
//
// Faithfulness contract (see docs/project/lessons-learned.md, ER lesson):
// malformed entries ERROR LOUDLY — they are never silently dropped. A line
// that looks like a data entry (contains a `:` separator) but doesn't parse
// as `"label" : positiveNumber` throws, rather than being skipped.
// ============================================================================

/** Entry line: a quoted label, a colon, and a numeric value. */
const ENTRY_RE = /^"((?:[^"\\]|\\.)*)"\s*:\s*(.+)$/
/** Mermaid pie values: positive numbers, up to two decimal places. */
const NUMBER_RE = /^\+?(?:\d+(?:\.\d+)?|\.\d+)$/

/**
 * Parse a Mermaid pie chart from preprocessed lines (trimmed, comment-stripped).
 * The first line is expected to be the `pie [showData]` header.
 *
 * Throws on malformed input:
 *   - a header that isn't `pie`
 *   - an entry whose value is not a positive number (negative / zero / NaN)
 *   - an entry-shaped line (`... : ...`) that isn't `"label" : number`
 *   - an unquoted label
 */
export function parsePieChart(lines: string[]): PieChart {
  if (lines.length === 0) {
    throw new Error('Pie chart is empty')
  }

  const header = lines[0]!.trim()
  const headerMatch = header.match(/^pie\b(.*)$/i)
  if (!headerMatch) {
    throw new Error(`Pie chart must start with "pie", got: "${header}"`)
  }

  // Header tail may carry `showData` and/or an inline `title <text>`.
  let showData = false
  let title: string | undefined
  let tail = headerMatch[1]!.trim()
  const showDataMatch = tail.match(/^showData\b\s*(.*)$/i)
  if (showDataMatch) {
    showData = true
    tail = showDataMatch[1]!.trim()
  }
  const inlineTitle = tail.match(/^title\s+(.+)$/i)
  if (inlineTitle) {
    title = normalizeBrTags(inlineTitle[1]!.trim())
  } else if (tail.length > 0) {
    throw new Error(`Unexpected text after pie header: "${tail}"`)
  }

  const entries: PieEntry[] = []

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim()
    if (line.length === 0 || line.startsWith('%%')) continue

    // Mermaid-universal accessibility directives are valid in every family:
    // accept and skip accTitle/accDescr lines and accDescr { … } blocks
    // (sequence models them fully; pie has no aria slot to carry them yet).
    if (/^acc(Title|Descr)\s*:/i.test(line)) continue
    if (/^accDescr\s*\{/i.test(line)) {
      while (i < lines.length && !lines[i]!.includes('}')) i++
      continue
    }

    // showData may also appear as a standalone directive on its own line.
    if (/^showData\s*$/i.test(line)) {
      showData = true
      continue
    }

    const titleMatch = line.match(/^title\s+(.+)$/i)
    if (titleMatch) {
      title = normalizeBrTags(titleMatch[1]!.trim())
      continue
    }

    const entryMatch = line.match(ENTRY_RE)
    if (entryMatch) {
      const label = normalizeBrTags(decodeEscapes(entryMatch[1]!))
      const rawValue = entryMatch[2]!.trim()
      if (!NUMBER_RE.test(rawValue)) {
        throw new Error(
          `Pie slice "${label}" has invalid value "${rawValue}". ` +
            'Values must be positive numbers (greater than zero).',
        )
      }
      const value = Number.parseFloat(rawValue)
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error(
          `Pie slice "${label}" has invalid value "${rawValue}". ` +
            'Values must be positive numbers (greater than zero).',
        )
      }
      entries.push({ label, value })
      continue
    }

    // A line that has a `:` looks like a data entry but didn't match the
    // strict shape — surface it loudly instead of dropping it.
    if (line.includes(':')) {
      throw new Error(
        `Invalid pie entry: "${line}". Expected: "label" : positiveNumber`,
      )
    }

    // Anything else is unrecognized syntax for the pie family.
    throw new Error(`Unrecognized pie chart line: "${line}"`)
  }

  if (entries.length === 0) {
    throw new Error('Pie chart must include at least one "label" : value entry')
  }

  return { title, showData, entries }
}

function decodeEscapes(raw: string): string {
  return raw.replace(/\\(["\\])/g, '$1')
}
