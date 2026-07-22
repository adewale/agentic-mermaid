import { syntaxError } from '../shared/syntax-error.ts'

/** Shared Timeline line grammar consumed by the renderer and agent parsers. */
export const TIMELINE_HEADER_DIRECTION_RE = /^timeline\s+(LR|TD)\s*$/i
export const TIMELINE_TITLE_RE = /^title\s+(.+)$/i
export const TIMELINE_SECTION_RE = /^section\s+([^:]+)$/i
export const TIMELINE_CONTINUATION_RE = /^:\s+(.+)$/

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
