import type { PieChart, PieEntry } from './types.ts'
import { scanAccessibilityDirectives } from '../shared/accessibility-directives.ts'
import { normalizeBrTags } from '../multiline-utils.ts'
import { syntaxError } from '../shared/syntax-error.ts'
import { decodeHTML } from 'entities/decode'

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
  lines = scanAccessibilityDirectives(lines).familyLines
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
    title = normalizeBrTags(authoredTitle)
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
      title = normalizeBrTags(authoredTitle)
      displayTitle = projectPieTitleDisplay(authoredTitle)
      continue
    }

    const entryMatch = line.match(ENTRY_RE)
    if (entryMatch) {
      const sourceLabel = decodeEscapes(entryMatch[1]!)
      if (/[\u0000-\u001f]/.test(sourceLabel)) hasEscapedControlLabels = true
      const label = normalizeBrTags(sourceLabel)
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
      const preprocessedLine = mermaidPieEntityPrepass(line)
      const preprocessedLabel = ENTRY_RE.exec(preprocessedLine)?.[1] ?? entryMatch[1]!
      const sourceKey = decodeEscapes(mermaidPieSourceKey(preprocessedLabel))
      // Normalize authored formatting before expanding entity markers. A
      // marker that produces `<br>` or `<b>` is literal visible Pie text, not
      // an authored formatting instruction.
      // Mermaid's grammar consumes source escapes while entity markers are
      // still opaque tokens. Expand those markers only afterward: a backslash
      // produced by #92; is visible text, not a new source escape.
      const displayLabel = projectPieEntityDisplay(decodeEscapes(mermaidPieSourceKey(normalizeBrTags(preprocessedLabel))))
      if (hasNewTerminalControl(label, displayLabel)) {
        throw syntaxError({
          what: 'Pie entity projection creates a terminal control character after escape decoding',
          expectedForm: 'an entity that displays printable text',
          example: '"Alpha&#35;" : 10',
        })
      }
      if (XML_DISALLOWED_CONTROL_RE.test(displayLabel)) {
        throw syntaxError({
          what: 'Pie slice display label contains an XML-disallowed control character',
          expectedForm: 'a label without XML-disallowed control characters',
          example: '"Alpha" : 10',
        })
      }
      if (seenSourceLabels.has(sourceKey)) hasDuplicateSourceLabels = true
      else {
        seenSourceLabels.add(sourceKey)
        entries.push({ label, value, ...(displayLabel === label ? {} : { displayLabel }) })
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

  if (entries.length === 0) {
    throw new Error('Pie chart must include at least one "label" : value entry')
  }

  return {
    title, showData, entries,
    ...(displayTitle !== title ? { displayTitle } : {}),
    ...(hasDuplicateSourceLabels ? { hasDuplicateSourceLabels: true } : {}),
    ...(hasEscapedControlLabels ? { hasEscapedControlLabels: true } : {}),
  }
}

function projectPieTitleDisplay(authoredTitle: string): string {
  // Mermaid's entity prepass runs before Pie grammar, but title source text
  // must remain available to the agent and serializer unchanged. Expand only
  // the renderer-facing title after authored <br> normalization so an entity
  // that produces markup-looking text is not reinterpreted as formatting.
  const normalized = normalizeBrTags(mermaidPieEntityPrepass(authoredTitle))
  const display = projectPieEntityDisplay(mermaidPieSourceKey(normalized))
  if (XML_DISALLOWED_CONTROL_RE.test(display)) {
    throw syntaxError({
      what: 'Pie title display contains an XML-disallowed control character',
      expectedForm: 'a title without XML-disallowed control characters',
      example: 'title Safe chart',
    })
  }
  return display
}

function mermaidPieEntityPrepass(line: string): string {
  // These two substitutions precede encodeEntities in pinned Mermaid. They
  // can occur inside an otherwise valid quoted Pie label, so identity must
  // observe them even though the source/display spelling remains authored.
  // The upstream greedy regex backtracks catastrophically on repeated
  // keyword/hash text. Its effect on one physical line is simply to strip
  // the last semicolon if a qualifying keyword/colon/hash chain exists.
  // JavaScript's `.` stops at all four line terminators, including U+2028
  // and U+2029 that can appear inside a quoted label without a physical LF.
  return line.replace(/[^\r\n\u2028\u2029]+/g, segment =>
    stripEntityPrepassSemicolon(stripEntityPrepassSemicolon(segment, 'style'), 'classDef'))
}

function stripEntityPrepassSemicolon(line: string, keyword: string): string {
  const lastSemicolon = line.lastIndexOf(';')
  if (lastSemicolon < 0 || !line.includes(keyword)) return line
  const viableFrom = new Uint8Array(line.length + 1)
  let nextHash = -1
  let viable = false
  for (let i = line.length - 1; i >= 0; i--) {
    const character = line[i]!
    if (/\s/.test(character)) nextHash = -1
    else if (character === '#') nextHash = i
    if (character === ':' && nextHash >= 0 && nextHash < lastSemicolon) viable = true
    viableFrom[i] = viable ? 1 : 0
  }
  for (let start = line.indexOf(keyword); start >= 0; start = line.indexOf(keyword, start + keyword.length)) {
    if (viableFrom[start + keyword.length] === 1) {
      return line.slice(0, lastSemicolon) + line.slice(lastSemicolon + 1)
    }
  }
  return line
}

function mermaidPieSourceKey(label: string): string {
  return label.replace(/#\w+;/g, token => {
    const inner = token.slice(1, -1)
    return /^\+?\d+$/.test(inner) ? `ﬂ°°${inner}¶ß` : `ﬂ°${inner}¶ß`
  })
}

/** Pinned Mermaid expands the Pie preprocessor's markers in final SVG. DOM
 * parsing resolves valid HTML references within those markers while the
 * source's leading ampersand remains literal. Keep display separate from
 * the authored label used for IDs, mutation, and source provenance. */
const windows1252 = new TextDecoder('windows-1252')
const PROJECTED_TERMINAL_CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/

function hasNewTerminalControl(authoredLabel: string, displayLabel: string): boolean {
  if (!PROJECTED_TERMINAL_CONTROL_RE.test(displayLabel)) return false
  const authoredCounts = new Uint32Array(160)
  for (const character of authoredLabel) {
    const code = character.charCodeAt(0)
    if (code < 160 && PROJECTED_TERMINAL_CONTROL_RE.test(character)) {
      authoredCounts[code] = authoredCounts[code]! + 1
    }
  }
  for (const character of displayLabel) {
    const code = character.charCodeAt(0)
    if (code >= 160 || !PROJECTED_TERMINAL_CONTROL_RE.test(character)) continue
    if (authoredCounts[code] === 0) return true
    authoredCounts[code] = authoredCounts[code]! - 1
  }
  return false
}

function projectPieEntityDisplay(label: string): string {
  return label.replace(/ﬂ°°(\d+)¶ß|ﬂ°(\w+)¶ß/g, (_token, numeric: string | undefined, named: string | undefined) => {
    const inner = numeric ?? named!
    let decoded: string
    if (numeric !== undefined) {
      const codePoint = Number(inner)
      decoded = codePoint === 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)
        ? '\ufffd'
        : codePoint >= 0x80 && codePoint <= 0x9f
          ? windows1252.decode(Uint8Array.of(codePoint))
          : String.fromCodePoint(codePoint)
    } else {
      // Mermaid expands every #name; marker as an HTML character reference
      // in the final browser SVG, including legacy prefix matches such as
      // #notit; → ¬it;. The full HTML5 table is already in our `entities`
      // dependency; unknown names remain literal.
      decoded = decodeHTML(`&${inner};`)
    }
    if (PROJECTED_TERMINAL_CONTROL_RE.test(decoded)) {
      throw syntaxError({
        what: 'Pie entity projects a terminal control character',
        expectedForm: 'an entity that displays printable text',
        example: '"Alpha&#35;" : 10',
      })
    }
    return decoded
  })
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
