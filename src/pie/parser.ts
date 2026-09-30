import type { PieChart, PieEntry } from './types.ts'
import { scanAccessibilityDirectives } from '../shared/accessibility-directives.ts'
import { syntaxError } from '../shared/syntax-error.ts'
import { stripTrailingComment } from '../shared/trailing-comment.ts'
import { mermaidEntityPrepass, TERMINAL_CONTROL_RE, toEntityMarkers } from '../shared/mermaid-entities.ts'
import { projectEntityMarkers, type EntityRefusal } from '../shared/mermaid-entity-display.ts'

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
/** These decoded characters cannot be represented in XML/Scene text or IDs. */
const XML_DISALLOWED_CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/

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
  // Mermaid's Pie grammar ends every statement at a `%%` comment.
  lines = scanAccessibilityDirectives(lines).familyLines.map(stripTrailingComment)
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
  let displayTitle: string | undefined
  let tail = headerMatch[1]!.trim()
  const showDataMatch = tail.match(/^showData\b\s*(.*)$/i)
  if (showDataMatch) {
    showData = true
    tail = showDataMatch[1]!.trim()
  }
  const inlineTitle = tail.match(/^title\s+(.+)$/i)
  if (inlineTitle) {
    const authoredTitle = inlineTitle[1]!.trim()
    title = authoredTitle
    displayTitle = projectPieTitleDisplay(authoredTitle)
  } else if (tail.length > 0) {
    throw new Error(`Unexpected text after pie header: "${tail}"`)
  }

  const entries: PieEntry[] = []
  const seenSourceLabels = new Set<string>()
  let hasDuplicateSourceLabels = false
  let hasEscapedControlLabels = false

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim()
    if (line.length === 0 || line.startsWith('%%')) continue

    // showData may also appear as a standalone directive on its own line.
    if (/^showData\s*$/i.test(line)) {
      showData = true
      continue
    }

    const titleMatch = line.match(/^title\s+(.+)$/i)
    if (titleMatch) {
      const authoredTitle = titleMatch[1]!.trim()
      title = authoredTitle
      displayTitle = projectPieTitleDisplay(authoredTitle)
      continue
    }

    const entryMatch = line.match(ENTRY_RE)
    if (entryMatch) {
      const sourceLabel = decodeEscapes(entryMatch[1]!)
      if (/[\u0000-\u001f]/.test(sourceLabel)) hasEscapedControlLabels = true
      const label = sourceLabel
      const rawValue = entryMatch[2]!.trim()
      if (!NUMBER_RE.test(rawValue)) {
        throw new Error(
          `Pie slice "${label}" has invalid value "${rawValue}". ` +
            'Values must be non-negative numbers.',
        )
      }
      const value = Number.parseFloat(rawValue)
      // Upstream parity: a zero-value slice is legal (renders as a zero-width
      // wedge whose label still appears in the legend); only negatives and
      // non-numbers are rejected.
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(
          `Pie slice "${label}" has invalid value "${rawValue}". ` +
            'Values must be non-negative numbers.',
        )
      }
      if (XML_DISALLOWED_CONTROL_RE.test(sourceLabel)) {
        throw syntaxError({
          what: 'Pie slice label contains an XML-disallowed control character',
          expectedForm: 'a label without XML-disallowed control characters',
          example: '"Alpha" : 10',
        })
      }
      // Mermaid's Pie DB is a first-wins Map keyed by the authored label.
      // Check after validating the value: even a duplicate invalid entry must
      // still fail, as it does upstream. Use the pre-display label so two
      // distinct <br> spellings do not collapse into one source identity.
      // Mermaid runs encodeEntities over source before the Pie grammar and
      // keys its DB with that preprocessed STRING. Decimal entity spellings
      // therefore collide with their literal internal-marker spelling.
      const preprocessedLine = mermaidEntityPrepass(line)
      const preprocessedLabel = ENTRY_RE.exec(preprocessedLine)?.[1] ?? entryMatch[1]!
      const sourceKey = decodeEscapes(toEntityMarkers(preprocessedLabel))
      // Mermaid's grammar consumes source escapes while entity markers are
      // still opaque tokens. Expand those markers only afterward: a backslash
      // produced by #92; is visible text, not a new source escape.
      const projectedLabel = projectEntityMarkers(sourceKey, PIE_ENTITY_REFUSAL)
      if (hasNewTerminalControl(label, projectedLabel)) {
        throw syntaxError({
          what: 'Pie entity projection creates a terminal control character after escape decoding',
          expectedForm: 'an entity that displays printable text',
          example: '"Alpha&#35;" : 10',
        })
      }
      if (XML_DISALLOWED_CONTROL_RE.test(projectedLabel)) {
        throw syntaxError({
          what: 'Pie slice display label contains an XML-disallowed control character',
          expectedForm: 'a label without XML-disallowed control characters',
          example: '"Alpha" : 10',
        })
      }
      // Mermaid keeps an escaped LF in its Pie DB and SVG text node, where
      // browser whitespace collapsing paints it as one space. Keep that LF
      // in source identity, but use the painted form on output surfaces.
      // Do this after checking entity-produced controls above: an entity must
      // not gain a route around the terminal-control safety boundary.
      const displayLabel = collapsePieEscapedNewlines(projectedLabel)
      if (seenSourceLabels.has(sourceKey)) hasDuplicateSourceLabels = true
      else {
        seenSourceLabels.add(sourceKey)
        entries.push({ label, value, ...(displayLabel === label && !needsPieLiteralText(label) ? {} : { displayLabel }) })
      }
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
    throw syntaxError({
      what: `Unrecognized pie chart line: "${line}"`,
      expectedForm: 'a title, showData, or a slice ("Label" : number)',
      example: '"Free" : 60',
    })
  }

  return {
    title, showData, entries,
    ...(displayTitle !== title || (title !== undefined && needsPieLiteralText(title)) ? { displayTitle } : {}),
    ...(hasDuplicateSourceLabels ? { hasDuplicateSourceLabels: true } : {}),
    ...(hasEscapedControlLabels ? { hasEscapedControlLabels: true } : {}),
  }
}

function needsPieLiteralText(text: string): boolean {
  // Pie writes its label/title into an SVG text node. Shared formatting tags
  // and Markdown markers belong to other families; Pie shows them literally.
  return /[<>*~]/.test(text)
}

function collapsePieEscapedNewlines(text: string): string {
  if (!text.includes('\n')) return text
  // The SVG browser paint collapses LF and its adjacent spaces or tabs. Split once
  // and trim each segment with index walks: a whitespace-prefix regex can
  // retry from every space before a non-whitespace character and go quadratic.
  const visible: string[] = []
  for (const line of text.split('\n')) {
    let start = 0
    let end = line.length
    while (start < end && (line[start] === ' ' || line[start] === '\t')) start++
    while (end > start && (line[end - 1] === ' ' || line[end - 1] === '\t')) end--
    if (start < end) visible.push(line.slice(start, end))
  }
  return visible.join(' ')
}

function projectPieTitleDisplay(authoredTitle: string): string {
  // Mermaid's entity prepass runs before Pie grammar, but title source text
  // must remain available to the agent and serializer unchanged. Expand only
  // the renderer-facing title after the source prepass. Authored markup-like
  // text is literal in Pie too; do not apply other families' <br>/Markdown
  // normalization before or after expanding entity markers.
  const display = projectEntityMarkers(toEntityMarkers(mermaidEntityPrepass(authoredTitle)), PIE_ENTITY_REFUSAL)
  if (XML_DISALLOWED_CONTROL_RE.test(display)) {
    throw syntaxError({
      what: 'Pie title display contains an XML-disallowed control character',
      expectedForm: 'a title without XML-disallowed control characters',
      example: 'title Safe chart',
    })
  }
  return display
}

/** Pinned Mermaid expands the preprocessor's entity markers in final SVG
 * (shared/mermaid-entities.ts). Keep display separate from the authored
 * label used for IDs, mutation, and source provenance. */
const PIE_ENTITY_REFUSAL: EntityRefusal = { subject: 'Pie entity', example: '"Alpha&#35;" : 10' }

function hasNewTerminalControl(authoredLabel: string, displayLabel: string): boolean {
  if (!TERMINAL_CONTROL_RE.test(displayLabel)) return false
  const authoredCounts = new Uint32Array(160)
  for (const character of authoredLabel) {
    const code = character.charCodeAt(0)
    if (code < 160 && TERMINAL_CONTROL_RE.test(character)) {
      authoredCounts[code] = authoredCounts[code]! + 1
    }
  }
  for (const character of displayLabel) {
    const code = character.charCodeAt(0)
    if (code >= 160 || !TERMINAL_CONTROL_RE.test(character)) continue
    if (authoredCounts[code] === 0) return true
    authoredCounts[code] = authoredCounts[code]! - 1
  }
  return false
}

function decodeEscapes(raw: string): string {
  // Mermaid's Pie STRING converter uses JS-style single-letter control
  // escapes; for all other characters it simply consumes the escape slash.
  // Identity must use that same decoded key before first-wins deduplication.
  const controls: Record<string, string> = {
    n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', '0': '\0',
  }
  return raw.replace(/\\(.)/g, (_, escaped: string) => controls[escaped] ?? escaped)
}
