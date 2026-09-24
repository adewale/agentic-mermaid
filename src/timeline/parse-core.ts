import { syntaxError } from '../shared/syntax-error.ts'

/** Shared Timeline line grammar consumed by the renderer and agent parsers. */
export type TimelineHeader =
  | { readonly kind: 'supported'; readonly direction?: 'LR' | 'TD'; readonly hasInlineComment: boolean }
  | { readonly kind: 'unsupported'; readonly suffix: string }

export function parseTimelineHeader(line: string): TimelineHeader | null {
  const match = line.trim().match(/^timeline(?=$|[\s;#%])(.*)$/i)
  if (!match) return null
  const rest = match[1]!
  // Pinned Mermaid's Timeline lexer recognizes # and % line comments even
  // when they touch the header or direction token. %{ is not a comment.
  const comment = rest.search(/#|%(?!\{)/)
  const hasInlineComment = comment >= 0
  const suffix = (comment < 0 ? rest : rest.slice(0, comment)).trim()
  if (!suffix) return { kind: 'supported', hasInlineComment }
  // Mermaid's semicolon form starts an inline statement. This renderer does
  // not model it, so treating it as a bare header would silently drop source.
  if (suffix.startsWith(';')) return { kind: 'unsupported', suffix }
  if (/^(?:LR|TD)$/i.test(suffix)) return { kind: 'supported', direction: suffix.toUpperCase() as 'LR' | 'TD', hasInlineComment }
  return { kind: 'unsupported', suffix }
}

export function unsupportedTimelineHeaderError(suffix: string): Error {
  return syntaxError({
    what: `Unsupported timeline header suffix "${suffix}"; only LR and TD are direction tokens`,
    expectedForm: 'timeline [LR|TD]',
    example: 'timeline TD',
  })
}
export const TIMELINE_TITLE_RE = /^title\s+(.+)$/i
export const TIMELINE_SECTION_RE = /^section\s+([^:]+)$/i
export const TIMELINE_CONTINUATION_RE = /^:\s+(.+)$/

/** Mermaid Timeline ignores full-line `%`/`%%` and `#` comments, not inline text.
 * `%{` is reserved for a directive-like token and is not a Timeline comment. */
export function isTimelineCommentLine(line: string): boolean {
  return /^(?:%(?!\{)|#)/.test(line.trimStart())
}

/**
 * A period with events. Capture 1 is the period label; capture 2 includes the
 * leading `: ` event separator so the shared splitter can enforce Mermaid's
 * separator grammar without treating clock times such as `10:30` as events.
 */
export const TIMELINE_PERIOD_RE = /^([^:#\n]+?)(\s*:\s+.+)$/

/**
 * Split `: Event 1 : Event 2` using Mermaid's separator rule: a colon starts a
 * new event only when followed by whitespace. Colons inside text (`10:30`,
 * URLs) remain part of the current event.
 */
export function splitTimelineEvents(raw: string): string[] {
  const events: string[] = []
  let index = 0

  while (index < raw.length) {
    while (index < raw.length && /\s/.test(raw[index]!)) index++
    if (index >= raw.length) break

    if (raw[index] !== ':') {
      throw syntaxError({
        what: `Invalid timeline event list: "${raw}"`,
        expectedForm: 'events separated by " : "',
        example: 'Launch : Beta',
      })
    }

    index++
    if (index >= raw.length || !/\s/.test(raw[index]!)) {
      throw new Error(`Timeline events must use ": " separators: "${raw}"`)
    }

    while (index < raw.length && /\s/.test(raw[index]!)) index++
    const start = index

    while (index < raw.length) {
      if (raw[index] === ':' && /\s/.test(raw[index + 1] ?? '')) break
      index++
    }

    events.push(raw.slice(start, index).trim())
  }

  return events
}
