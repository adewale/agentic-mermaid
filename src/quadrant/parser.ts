import type { QuadrantChart, QuadrantAxis, QuadrantPoint } from './types.ts'
import { normalizeBrTags } from '../multiline-utils.ts'
import { MermaidSyntaxError, syntaxError } from '../shared/syntax-error.ts'
import { parsePointStyleEntries, parseClassDefTail, splitPointClassSuffix } from './point-style.ts'
import { requireClosedAccessibility, scanAccessibilityDirectives } from '../shared/accessibility-directives.ts'
import { joinStatementLines, quotedTextEnds, statementText, stripTrailingComment } from '../shared/trailing-comment.ts'
import { parserObservationActive, observeParserStatement, observeParserMutation } from '../shared/parser-observation.ts'

// ============================================================================
// Quadrant chart parser
//
// Parses Mermaid quadrantChart syntax into a QuadrantChart structure.
//
// Supported statements:
//   quadrantChart                      (header)
//   title <text>
//   x-axis <left> [--> <right>]
//   y-axis <bottom> [--> <top>]
//   quadrant-1..quadrant-4 <label>
//   <Label>[:::class]: [x, y] [radius/color/stroke metadata]
//   classDef <class> <style metadata>
//
// Point styling follows upstream (merged mermaid-js/mermaid#5173): styles are
// MODELED — they flow through layout to the renderer. The grammar lives in
// point-style.ts (shared with the agent body so the surfaces cannot drift).
//
// Faithfulness contract (docs/project/lessons-learned.md, Loop 17 ER lesson):
// malformed lines ERROR LOUDLY — never silently dropped:
//   - coordinates out of [0,1]
//   - non-numeric coordinates
//   - missing / malformed brackets on a point line
//   - malformed/unknown point or classDef style metadata
//   - any unrecognized statement
// ============================================================================

const TITLE_RE = /^title\s+(.+)$/i
const AXIS_RE = /^([xy])-axis\s+(.+)$/is
const QUADRANT_RE = /^quadrant-([1-4])\s+(.+)$/is
// A point line: `Label[:::class]: [x, y] [style metadata]`. The label is
// everything before the LAST colon that precedes a bracketed coordinate pair.
const POINT_RE = /^(.+?)\s*:\s*\[\s*([^,\]]+)\s*,\s*([^,\]]+)\s*\]\s*(.*)$/s
const CLASSDEF_RE = /^classDef\s+(.+)$/i

/** Semicolons close statements, not quoted labels or functional styles.
 * Keep generous bare text such as `quadrant-1 A;B` when the suffix is not
 * another statement; the text codec reports and quotes that extension. */
function quadrantStatements(raw: string): string[] {
  if (!raw.includes(';') || TITLE_RE.test(raw)) return [raw]
  const fragments: string[] = []
  let start = 0, quoted = false, parentheses = 0
  for (let index = 0; index < raw.length; index++) {
    const char = raw[index]!
    if (char === '"') quoted = !quoted
    if (quoted) continue
    if (char === '%' && raw[index + 1] === '%') break
    if (char === '(') parentheses++
    else if (char === ')') parentheses--
    else if (char === ';' && parentheses === 0) {
      fragments.push(raw.slice(start, index))
      start = index + 1
      // A title owns the rest of its physical line, including semicolons.
      if (/^\s*title\s/i.test(raw.slice(start))) break
    }
  }
  fragments.push(raw.slice(start))
  const statements: string[] = []
  let parts: string[] = []
  for (let index = 0; index < fragments.length; index++) {
    const fragment = fragments[index]!
    if (!fragment.trim() && parts.length === 0) continue
    parts.push(fragment)
    const next = fragments[index + 1]?.trim() ?? ''
    const point = POINT_RE.test(fragment.trim())
    const complete = point || CLASSDEF_RE.test(fragment.trim()) || /^quadrant(?:Chart)?$/i.test(fragment.trim())
    const text = AXIS_RE.test(parts[0]!.trim()) || QUADRANT_RE.test(parts[0]!.trim())
    const nextStatement = POINT_RE.test(next) || CLASSDEF_RE.test(next) || TITLE_RE.test(next) || AXIS_RE.test(next) || QUADRANT_RE.test(next)
    if (complete || text && nextStatement || index === fragments.length - 1) {
      const statement = parts.join(';').trim()
      if (statement) statements.push(statement)
      parts = []
    }
  }
  return statements
}

// Mermaid's quadrant lexer reads a "…" string (no escapes) to its closing
// quote, and a point's `[x, y]`, across line breaks. A title runs to the end
// of its line.
const POINT_CONTENT_RE = /^[\d.,+\s-]*$/
const POINT_CLOSE_RE = /^[\d.,+\s-]*\]/

/** For each line, the last line of the statement that starts there. */
export function quadrantStatementEnds(lines: readonly string[]): number[] {
  const ends = quotedTextEnds(lines, { escapes: false, wholeLine: line => TITLE_RE.test(line) })
  for (let index = 0; index < lines.length; index = ends[index]! + 1) {
    const end = ends[index]!
    const text = stripTrailingComment(statementText(lines, index, end).trim()).replace(/"[^"]*"/g, '""')
    const open = text.lastIndexOf('[')
    if (TITLE_RE.test(text) || open < 0 || text.includes(']', open) || !text.slice(0, open).trimEnd().endsWith(':')) continue
    // Only coordinates come before the `]`, so each line is read once.
    let close = end + 1
    while (close < lines.length && POINT_CONTENT_RE.test(lines[close]!)) close++
    if (close < lines.length && POINT_CLOSE_RE.test(lines[close]!.trim())) ends[index] = close
  }
  return ends
}

// Mermaid's quadrant lexer reads unquoted text only from letters, digits,
// non-ASCII characters, whitespace and !#$%&'*+,-./;=?\_` (`;` ends the
// statement). Any other character is a lexical error there (`<>()[]{}|@^~`,
// control characters) or starts another token (`:`, or a `"` string once the
// text has begun). A "…" string may open the text and holds anything but `"`.
// A keyword where a word can start (`x-axis`, `quadrant-1`, `quadrantChart`,
// and `classDef` or `title` as a whole word; any case) is a token of its own,
// which ends the text. A title runs to the end
// of its line and is not text in this sense. Ours reads such text as written
// (`x-axis Low < High`); verify reports it, and the serializer writes it
// quoted, as Mermaid reads it.
const QUADRANT_STRING_RE = /^"[^"]*"/
const NOT_QUADRANT_TEXT_RE = /[<>()[\]{}|@^~:;"\n\r\x00-\x08\x0e-\x1f\x7f]/
const QUADRANT_KEYWORD_RE = /(?<![A-Za-z])(?:[xy]-axis|quadrant-[1-4]|quadrantChart|(?:classDef|title)(?![A-Za-z0-9_]))/i

/** The first character or keyword that keeps `text` from being quadrant text Mermaid reads, if any. */
function quadrantTextError(text: string, authored = false): string | undefined {
  const unquoted = authored ? text.replace(QUADRANT_STRING_RE, '') : text
  // MINUS can continue text, but cannot begin it; SEMI ends a statement.
  return unquoted.match(NOT_QUADRANT_TEXT_RE)?.[0] ?? unquoted.match(QUADRANT_KEYWORD_RE)?.[0] ?? (text.startsWith('-') ? '-' : undefined)
}

/** Quadrant text as source: bare where Mermaid reads it so, else one "…" string. */
export function quadrantTextSource(text: string, completeLabel = false): string {
  const keyword = /(?:^|[^A-Za-z])(?:x-axis|y-axis|quadrant-[1-4]|quadrantChart|classDef|accTitle|accDescr|title)/i
  // Outside a string, `%%` opens a comment that takes the rest of the line.
  return quadrantTextError(text) !== undefined || text.includes('%%') || completeLabel && (text !== text.trim() || keyword.test(text)) ? `"${text}"` : text
}

/** Whether quadrantTextSource writes `text` as source Mermaid reads back:
 * text that needs quoting cannot hold a `"`. */
export function quadrantTextWritable(text: string): boolean {
  // At the start of a quoted value, %% consumes the opening quote in the
  // pinned lexer. Entity substitution would change our stored label.
  const quoted = quadrantTextSource(text, true).startsWith('"')
  // A quoted leading backtick enters the exclusive Markdown lexer state,
  // whose token cannot contain a literal backtick. Bare backticks remain text.
  // Empty text writes nothing a reader takes as text, and the reader trims
  // the blanks beside a line break inside a quoted value.
  return text !== '' && !/[^\S\n]\n|\n[^\S\n]/.test(text) && !text.startsWith('%%') && !text.includes('%%{') && !(quoted && text.startsWith('`')) && (!quoted || !text.includes('"'))
}

/** Where Mermaid's quadrant lexer rejects unquoted text: what it rejects. */
export type QuadrantTextReport = (what: string) => void

/** A point label, axis text or quadrant label, read as written; `report`
 * hears where Mermaid's lexer rejects it. */
function quadrantText(text: string, construct: string, report?: QuadrantTextReport): string {
  const error = quadrantTextError(text, true)
  if (error !== undefined) report?.(`Quadrant ${construct} ${JSON.stringify(text)} has ${JSON.stringify(error)} outside a quoted string`)
  // A quoted first token can be followed by ordinary text. Remove only its
  // grammar delimiters, preserving whitespace and arrows inside the token.
  const quoted = /^"([^"]*)"/.exec(text)
  return normalizeBrTags(quoted ? quoted[1]! + text.slice(quoted[0].length) : text)
}

/** What Mermaid's quadrant lexer rejects in one statement line's unquoted
 * text, read by the parser's own statement grammar. */
export function quadrantTextRejections(line: string): string[] {
  const rejections: string[] = []
  try {
    parseQuadrantChart(['quadrantChart', line], what => rejections.push(what))
  } catch {
    // A statement the parser rejects fails the render; verify reports that.
  }
  return rejections
}

/**
 * Parse a Mermaid quadrant chart from preprocessed lines (trimmed,
 * comment-stripped). The first line is expected to be the `quadrantChart`
 * header.
 *
 * Throws on malformed input (see faithfulness contract above). `report`
 * hears the unquoted text Mermaid's lexer rejects (quadrantText).
 */
/**
 * One identity per point, in document order: the first point with a label
 * keeps the label as its id, and each later one gets the next free
 * `<label>#<n>` (A, A#2, A#3, ...), never a label the author wrote for another
 * point (an authored `A#2` keeps its name, so the second A becomes A#3).
 * Renderer element ids and typed point edits share this rule.
 */
export function quadrantPointIds(labels: readonly string[]): string[] {
  const authored = new Set(labels)
  const used = new Set<string>()
  return labels.map(label => {
    let id = label
    if (used.has(id)) {
      let n = 2
      while (authored.has(`${label}#${n}`) || used.has(`${label}#${n}`)) n++
      id = `${label}#${n}`
    }
    used.add(id)
    return id
  })
}

export function parseQuadrantChart(lines: string[], report?: QuadrantTextReport, onPoint?: (point: QuadrantPoint, source: { start: number; end: number }) => void): QuadrantChart {
  const lineStarts = onPoint ? [0] : undefined
  if (lineStarts) for (const line of lines) lineStarts.push(lineStarts[lineStarts.length - 1]! + line.length + 1)
  const scanned = scanAccessibilityDirectives(lines, quadrantStatementEnds(lines))
  requireClosedAccessibility(scanned)
  const physicalLines = scanned.familyLines
  lines = joinStatementLines(physicalLines, quadrantStatementEnds(physicalLines))
  if (lines.length === 0) {
    throw new Error('Quadrant chart is empty')
  }

  const firstStatements = quadrantStatements(lines[0]!.trim())
  const header = stripTrailingComment(firstStatements[0] ?? '')
  if (!/^quadrant(?:Chart)?\b\s*$/i.test(header)) {
    throw new Error(`Quadrant chart must start with "quadrant" or "quadrantChart", got: "${header}"`)
  }
  if (parserObservationActive('quadrant')) observeParserStatement('quadrant', 'header', header, { line: 1, unit: 'normalized' })

  let title: string | undefined
  const accessibility: NonNullable<QuadrantChart['accessibility']> = {
    ...(scanned.accessibility.title !== undefined ? { title: normalizeBrTags(scanned.accessibility.title) } : {}),
    ...(scanned.accessibility.descr !== undefined ? { description: normalizeBrTags(scanned.accessibility.descr) } : {}),
  }
  let xAxis: QuadrantAxis | undefined
  let yAxis: QuadrantAxis | undefined
  const quadrants: [string?, string?, string?, string?] = [undefined, undefined, undefined, undefined]
  const points: QuadrantPoint[] = []
  // Null prototype: `__proto__`/`constructor` are legal class names and must
  // become ordinary own keys, never prototype writes/reads.
  const classDefs: QuadrantChart['classDefs'] = Object.create(null) as QuadrantChart['classDefs']

  for (let i = 0; i < lines.length; i++) {
    // Mermaid's Quadrant grammar ends a statement at a `%%` comment, except a
    // title, which runs to the end of its line.
    let sourceLine = i, sourceLineAt = 0, nextBreak = onPoint ? lines[i]!.indexOf('\n') : -1
    let statementStart = i === 0 ? lines[i]!.indexOf(firstStatements[0]!) + firstStatements[0]!.length : 0
    for (const raw of i === 0 ? firstStatements.slice(1) : quadrantStatements(lines[i]!.trim())) {
      const at = onPoint ? lines[i]!.indexOf(raw, statementStart) : 0
      if (onPoint) statementStart = at + raw.length
      const line = TITLE_RE.test(raw) ? raw : stripTrailingComment(raw)
      if (line.length === 0 || line.startsWith('%%')) continue

      let m: RegExpMatchArray | null

      // classDef <name> <styles> — modeled (upstream point styling contract).
      if ((m = line.match(CLASSDEF_RE))) {
        if (parserObservationActive('quadrant')) observeParserStatement('quadrant', 'classDef', line, { line: i + 1, unit: 'normalized' })
        const parsed = parseClassDefTail(m[1]!)
        if (!parsed.ok) {
          throw new Error(`Invalid quadrant classDef: ${parsed.error}`)
        }
        classDefs[parsed.name] = parsed.style
        if (parserObservationActive('quadrant')) observeParserMutation('quadrant', 'setClassDef', { name: parsed.name, style: parsed.style }, { line: i + 1, unit: 'normalized' })
        continue
      }

      if ((m = line.match(TITLE_RE))) {
        if (parserObservationActive('quadrant')) observeParserStatement('quadrant', 'title', line, { line: i + 1, unit: 'normalized' })
        title = normalizeBrTags(m[1]!.trim())
        if (parserObservationActive('quadrant')) observeParserMutation('quadrant', 'setTitle', title, { line: i + 1, unit: 'normalized' })
        continue
      }

      if ((m = line.match(AXIS_RE))) {
        if (parserObservationActive('quadrant')) observeParserStatement('quadrant', 'axis', line, { line: i + 1, unit: 'normalized' })
        const axis = parseAxis(m[2]!.trim(), m[1]!.toLowerCase(), report)
        if (m[1]!.toLowerCase() === 'x') xAxis = axis
        else yAxis = axis
        if (parserObservationActive('quadrant')) observeParserMutation('quadrant', 'setAxis', { axis: m[1]!.toLowerCase(), value: axis }, { line: i + 1, unit: 'normalized' })
        continue
      }

      if ((m = line.match(QUADRANT_RE))) {
        if (parserObservationActive('quadrant')) observeParserStatement('quadrant', 'quadrant', line, { line: i + 1, unit: 'normalized' })
        const idx = Number.parseInt(m[1]!, 10) - 1
        quadrants[idx] = quadrantText(m[2]!.trim(), `quadrant-${m[1]} label`, report)
        if (parserObservationActive('quadrant')) observeParserMutation('quadrant', 'setQuadrant', { quadrant: idx + 1, label: quadrants[idx] }, { line: i + 1, unit: 'normalized' })
        continue
      }

      if ((m = line.match(POINT_RE))) {
        if (parserObservationActive('quadrant')) observeParserStatement('quadrant', 'point', line, { line: i + 1, unit: 'normalized' })
        const { label: rawLabel, className } = splitPointClassSuffix(m[1]!.trim())
        const label = quadrantText(rawLabel, 'point label', report)
        const styleTail = m[4]!.trim()
        const parsedStyle = parsePointStyleEntries(styleTail, `quadrant point ${label}`)
        if (!parsedStyle.ok) {
          throw new Error(
            `Unsupported quadrant point style metadata: "${styleTail}" — ${parsedStyle.error}. ` +
              'Expected comma-separated radius/color/stroke-color/stroke-width entries.',
          )
        }
        const x = parseCoord(label, m[2]!.trim())
        const y = parseCoord(label, m[3]!.trim())
        // A repeated label is another point, as in Mermaid; quadrantPointIds
        // gives each one its own identity.
        if (parserObservationActive('quadrant')) observeParserMutation('quadrant', 'addPointLabel', label, { line: i + 1, unit: 'normalized' })
        const point: QuadrantPoint = { label, x, y }
        if (parserObservationActive('quadrant')) observeParserMutation('quadrant', 'createPoint', point, { line: i + 1, unit: 'normalized' })
        if (className !== undefined) {
          point.className = className
          if (parserObservationActive('quadrant')) observeParserMutation('quadrant', 'setPointClass', { label, className }, { line: i + 1, unit: 'normalized' })
        }
        if (parsedStyle.style !== undefined) {
          point.style = parsedStyle.style
          if (parserObservationActive('quadrant')) observeParserMutation('quadrant', 'setPointStyle', { label, style: parsedStyle.style }, { line: i + 1, unit: 'normalized' })
        }
        points.push(point)
        if (onPoint) {
          // Logical statements retain line breaks but trim continuation indent.
          // Translate token boundaries back through that grammar-owned join.
          const offset = (column: number): number => {
            while (nextBreak >= 0 && nextBreak < column) {
              sourceLine++
              sourceLineAt = nextBreak + 1
              nextBreak = lines[i]!.indexOf('\n', sourceLineAt)
            }
            const indent = sourceLine === i ? 0 : physicalLines[sourceLine]!.length - physicalLines[sourceLine]!.trimStart().length
            return lineStarts![sourceLine]! + indent + column - sourceLineAt
          }
          const start = at + line.indexOf(rawLabel)
          onPoint(point, { start: offset(start), end: offset(start + rawLabel.length) })
        }
        if (parserObservationActive('quadrant')) observeParserMutation('quadrant', 'appendPoint', point, { line: i + 1, unit: 'normalized' })
        continue
      }

      // A line that has a `:` looks like a point but didn't match the strict
      // shape (missing/malformed brackets) — surface it loudly.
      if (line.includes(':')) {
        if (parserObservationActive('quadrant')) observeParserStatement('quadrant', 'invalidPoint', line, { line: i + 1, unit: 'normalized' })
        throw new Error(
          `Invalid quadrant point: "${line}". Expected: Label: [x, y] with x,y in [0,1]`,
        )
      }

      if (parserObservationActive('quadrant')) observeParserStatement('quadrant', 'unrecognized', line, { line: i + 1, unit: 'normalized' })
      throw syntaxError({
        what: `Unrecognized quadrant chart line: "${line}"`,
        expectedForm: 'a title, x-axis/y-axis, a quadrant-N label, a point (Label: [x, y]), or a classDef',
        example: 'Quick win: [0.2, 0.8]',
      })
    }
  }

  return {
    title,
    ...(accessibility.title || accessibility.description ? { accessibility } : {}),
    xAxis,
    yAxis,
    quadrants,
    points,
    classDefs,
  }
}

/** Parse an axis declaration tail (`<near> [--> <far>]`). */
function parseAxis(tail: string, which: string, report?: QuadrantTextReport): QuadrantAxis {
  const side = which === 'x' ? 'left' : 'bottom'
  let quoted = false, arrowIdx = -1, arrowLength = 0
  for (let index = 0; index < tail.length; index++) {
    if (tail[index] === '"') quoted = !quoted
    if (quoted || tail[index] !== '-') continue
    const delimiter = /^--+>/.exec(tail.slice(index))
    if (delimiter) { arrowIdx = index; arrowLength = delimiter[0].length; break }
  }
  if (arrowIdx >= 0) {
    const near = quadrantText(tail.slice(0, arrowIdx).trim(), `${which}-axis text`, report)
    const farSource = tail.slice(arrowIdx + arrowLength).trim()
    if (!near) throw new Error(`Quadrant ${which}-axis is missing its ${side} label: "${tail}"`)
    // Mermaid's grammar renders a trailing delimiter as an arrow in the one
    // near label. Keep that authored content rather than inventing a far side.
    if (!farSource) return { near: near + ' ⟶ ' }
    return { near, far: quadrantText(farSource, `${which}-axis text`, report) }
  }
  const near = quadrantText(tail.trim(), `${which}-axis text`, report)
  if (!near) throw new Error(`Quadrant ${which}-axis is missing its ${side} label`)
  return { near }
}

/** A point coordinate that is not a number in [0, 1]. The point statement is
 * modeled and Mermaid rejects the value too, so this is a parse failure of the
 * source, never a reason to preserve it as unmodeled syntax. */
export class QuadrantCoordinateError extends MermaidSyntaxError {
  constructor(message: string) {
    super(message)
    this.name = 'QuadrantCoordinateError'
  }
}

/** Parse a coordinate, enforcing the [0,1] range (loud error otherwise). */
function parseCoord(label: string, raw: string): number {
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(raw)) {
    throw new QuadrantCoordinateError(
      `Quadrant point "${label}" has non-numeric coordinate "${raw}". ` +
        'Coordinates must be numbers in [0, 1].',
    )
  }
  const value = Number.parseFloat(raw)
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new QuadrantCoordinateError(
      `Quadrant point "${label}" coordinate "${raw}" is out of range. ` +
        'Coordinates must be in [0, 1].',
    )
  }
  return value
}
