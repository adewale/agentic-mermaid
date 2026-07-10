// ============================================================================
// Journey parse core — the single grammar shared by the renderer parser
// (src/journey/parser.ts), the structured agent parser
// (src/agent/journey-body.ts), and the opaque-verify scan
// (src/agent/families-builtin.ts). One grammar, one normalization: the same
// source text cannot produce different labels — or different accept/reject
// decisions — depending on which surface parsed it.
//
// Upstream lexer parity (journey.jison):
//   - taskName is [^#:\n;]+ and taskData is ":"[^#\n;]+ — a ';' terminates
//     the token and starts the next statement, so non-accessibility lines are
//     split on ';' before classification (semicolon-joined tasks are separate
//     tasks; a trailing ';' is a terminator, not actor text).
//   - '#' mid-line stays literal: upstream truncates there today but tracks
//     that as a bug (mermaid-js/mermaid#7105); the research docs pin
//     literal-text preservation for titles and accessibility text.
// ============================================================================

export const JOURNEY_MIN_SCORE = 1
export const JOURNEY_MAX_SCORE = 5
/** Finite categorical-color guarantee for derived actor dots. */
export const JOURNEY_ACTOR_COLOR_LIMIT = 256

export const JOURNEY_TITLE_RE = /^title\s+(.+)$/i
export const JOURNEY_SECTION_RE = /^section\s+(.+)$/i
export const JOURNEY_TASK_RE = /^([^:]+?)\s*:\s*([0-9]+)\s*(?::\s*(.*))?$/
const TASK_LIKE_RE = /^([^:]+?)\s*:\s*([^:]+?)(?:\s*:\s*.*)?$/
const ACC_LINE_RE = (directive: 'accTitle' | 'accDescr') => new RegExp(`^${directive}\\s*:[ \\t]*(.+)$`, 'i')
const ACC_DESCR_BLOCK_START_RE = /^accDescr\s*:?\s*\{\s*(.*)$/i

/** Inline markup normalization shared by every Journey text surface. */
export function normalizeJourneyLabel(label: string): string {
  return label
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\\n/g, '\n')
    .replace(/<\/?(?:sub|sup|small|mark)\s*>/gi, '')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(?<!\*)\*([^\s*](?:[^*]*[^\s*])?)\*(?!\*)/g, '<i>$1</i>')
    .replace(/~~(.+?)~~/g, '<s>$1</s>')
}

/** Label normalization + per-line trim: `A <br> B` and `A<br>B` are the same text. */
export function normalizeJourneyText(value: string): string {
  return normalizeJourneyLabel(value)
    .split(/\r?\n/)
    .map(part => part.trim())
    .filter(Boolean)
    .join('\n')
}

/** Actor labels are single-line: multiline markup collapses to `a / b`. */
export function normalizeJourneyActor(value: string): string {
  return normalizeJourneyText(value).split('\n').join(' / ')
}

export function isJourneyComment(line: string): boolean {
  return line.startsWith('%%') || line.startsWith('#') || line.startsWith('%')
}

export function isValidJourneyScore(score: number): boolean {
  return Number.isInteger(score) && score >= JOURNEY_MIN_SCORE && score <= JOURNEY_MAX_SCORE
}

export type JourneyIssueCode =
  | 'invalid_score'
  | 'empty_task_text'
  | 'section_colon'
  | 'empty_title'
  | 'unclosed_accdescr'
  | 'unrecognized_line'
  | 'empty_journey'

export interface JourneyParseIssue {
  code: JourneyIssueCode
  /** 0-based index into the `lines` array given to the walker. */
  lineIndex: number
  /** The offending statement, trimmed (post `;`-split). */
  statement: string
  /** Human-readable message naming the construct. */
  detail: string
}

export interface JourneyWalkEvents {
  title?(text: string, lineIndex: number): void
  accTitle?(text: string, lineIndex: number): void
  accDescr?(text: string, lineIndex: number): void
  section?(label: string, lineIndex: number): void
  task?(text: string, score: number, actors: string[], lineIndex: number): void
  /** Return 'stop' to abort the walk (first-issue mode); return void to keep scanning. */
  issue?(issue: JourneyParseIssue): void | 'stop'
}

/**
 * Walk Journey body lines from `startIndex`, emitting one event per parsed
 * statement. Blank lines and comments are skipped; accessibility text is
 * classified before `;`-splitting (block interiors are free text).
 */
export function walkJourneyLines(lines: string[], startIndex: number, events: JourneyWalkEvents): void {
  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i]!.trim()
    if (!line) continue
    if (isJourneyComment(line)) continue

    // Block-form accessibility spans lines, so it is classified before the
    // `;`-statement split; block interiors are free text.
    const accDescrStart = line.match(ACC_DESCR_BLOCK_START_RE)
    if (accDescrStart) {
      const collected = collectJourneyAccessibilityBlock(accDescrStart[1] ?? '', lines, i)
      if (!collected) {
        const outcome = events.issue?.({
          code: 'unclosed_accdescr',
          lineIndex: i,
          statement: line,
          detail: 'Journey accDescr block is missing a closing "}"',
        })
        if (outcome === 'stop') return
        return // the unterminated block consumes the rest of the source
      }
      events.accDescr?.(normalizeJourneyText(collected.text), i)
      i = collected.nextIndex
      for (const statement of splitJourneyStatements(collected.suffix)) {
        const outcome = classifyStatement(statement, collected.nextIndex, events)
        if (outcome === 'stop') return
      }
      continue
    }

    for (const statement of splitJourneyStatements(line)) {
      const outcome = classifyStatement(statement, i, events)
      if (outcome === 'stop') return
    }
  }
}

function classifyStatement(statement: string, lineIndex: number, events: JourneyWalkEvents): void | 'stop' {
  const issue = (code: JourneyIssueCode, detail: string): void | 'stop' =>
    events.issue?.({ code, lineIndex, statement, detail })

  const accTitle = matchAccessibilityLine(statement, 'accTitle')
  if (accTitle !== undefined) {
    events.accTitle?.(accTitle, lineIndex)
    return
  }

  const accDescr = matchAccessibilityLine(statement, 'accDescr')
  if (accDescr !== undefined) {
    events.accDescr?.(accDescr, lineIndex)
    return
  }

  const titleMatch = statement.match(JOURNEY_TITLE_RE)
  if (titleMatch) {
    const text = normalizeJourneyText(titleMatch[1]!)
    if (!text) return issue('empty_title', `Journey title is empty: "${statement}"`)
    events.title?.(text, lineIndex)
    return
  }

  const sectionMatch = statement.match(JOURNEY_SECTION_RE)
  if (sectionMatch) {
    const label = normalizeJourneyText(sectionMatch[1]!)
    if (!label || label.includes(':')) {
      return issue('section_colon', `Journey section labels must not contain ':': "${statement}"`)
    }
    events.section?.(label, lineIndex)
    return
  }

  const taskMatch = statement.match(JOURNEY_TASK_RE)
  if (taskMatch) {
    const text = normalizeJourneyText(taskMatch[1]!)
    if (!text) return issue('empty_task_text', `Journey task text is empty: "${statement}"`)
    const rawScore = taskMatch[2]!
    const score = Number.parseInt(rawScore, 10)
    if (!isValidJourneyScore(score)) return issue('invalid_score', invalidScoreDetail(text, rawScore))
    const actors = (taskMatch[3] ?? '')
      .split(',')
      .map(normalizeJourneyActor)
      .filter(Boolean)
    events.task?.(text, score, actors, lineIndex)
    return
  }

  const taskLike = statement.match(TASK_LIKE_RE)
  if (taskLike) {
    const text = normalizeJourneyText(taskLike[1]!)
    const rawScore = taskLike[2]!.trim()
    if (text && rawScore) return issue('invalid_score', invalidScoreDetail(text, rawScore))
  }

  return issue(
    'unrecognized_line',
    `Invalid user journey line: "${statement}". Expected title, section, accessibility metadata, or "Task name: 3: Actor"`,
  )
}

export function invalidScoreDetail(text: string, rawScore: string): string {
  return `Journey task "${text}" has invalid score ${rawScore}. Expected an integer from ${JOURNEY_MIN_SCORE} through ${JOURNEY_MAX_SCORE}`
}

const HTML_ENTITY_RE = /^&(?:[a-zA-Z][a-zA-Z0-9]{1,31}|#[0-9]{1,7}|#x[0-9a-fA-F]{1,6});$/

/** True when text contains a real Journey statement delimiter. Semicolons
 * closing HTML entities are label text, not delimiters. */
export function hasJourneyStatementDelimiter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    if (value[i] !== ';') continue
    const amp = value.lastIndexOf('&', i)
    if (amp >= 0 && HTML_ENTITY_RE.test(value.slice(amp, i + 1))) continue
    return true
  }
  return false
}

/** Split a line into `;`-terminated statements (lexer parity). A ';' that
 * closes an HTML entity (&amp; &#59; &#x3B;) is literal label text, and a
 * statement that starts like a comment after the split is a comment tail. */
function splitJourneyStatements(line: string): string[] {
  if (!line.trim()) return []
  if (!line.includes(';')) return [line.trim()]
  const parts: string[] = []
  let start = 0
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== ';') continue
    const amp = line.lastIndexOf('&', i)
    if (amp >= start && HTML_ENTITY_RE.test(line.slice(amp, i + 1))) continue
    parts.push(line.slice(start, i))
    start = i + 1
  }
  parts.push(line.slice(start))
  return parts.map(part => part.trim()).filter(part => part && !isJourneyComment(part))
}

function matchAccessibilityLine(line: string, directive: 'accTitle' | 'accDescr'): string | undefined {
  const match = line.match(ACC_LINE_RE(directive))
  return match ? normalizeJourneyText(match[1]!) : undefined
}

/** Returns null when the block never closes. */
export function collectJourneyAccessibilityBlock(
  initial: string,
  lines: string[],
  startIndex: number,
): { text: string; nextIndex: number; suffix: string } | null {
  const initialEnd = initial.indexOf('}')
  if (initialEnd !== -1) {
    return {
      text: initial.slice(0, initialEnd).trim(),
      nextIndex: startIndex,
      suffix: initial.slice(initialEnd + 1).trim(),
    }
  }

  const parts = [initial.trim()].filter(Boolean)

  for (let i = startIndex + 1; i < lines.length; i++) {
    const line = lines[i]!
    const end = line.indexOf('}')
    if (end !== -1) {
      const beforeBrace = line.slice(0, end).trim()
      if (beforeBrace) parts.push(beforeBrace)
      return {
        text: parts.join('\n'),
        nextIndex: i,
        suffix: line.slice(end + 1).trim(),
      }
    }
    parts.push(line)
  }

  return null
}
