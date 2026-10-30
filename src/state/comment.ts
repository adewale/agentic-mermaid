/** Block-note boundaries are shared with the State grammar. Note bodies are
 * literal text, including whole lines beginning with %% or syntax-like text. */
export const STATE_NOTE_OPEN_RE = /^note\s+(left|right)\s+of\s+([\w\p{L}\p{M}\p{N}-]+)\s*$/iu
/** Mermaid's block-note text runs from the target to `end note`, so it may
 * start on the opening line: `note left of A first line`. */
export const STATE_NOTE_OPEN_TEXT_RE = /^note\s+(left|right)\s+of\s+([\w\p{L}\p{M}\p{N}-]+)\s+([^\s:].*)$/iu
export const STATE_NOTE_END_RE = /^end\s+note$/i

/** Where a State comment starts on a line (-1 for none), and whether the line
 * ends inside a double-quoted string; `quoted` says it starts inside one. A
 * comment starts outside quoted aliases and text introduced by a
 * description/transition/note colon. A style property's colon is not text. */
function scanStateLine(line: string, quoted = false): { comment: number; quoted: boolean } {
  for (let index = 0; index < line.length; index++) {
    const character = line[index]!
    if (character === '"') { quoted = !quoted; continue }
    if (quoted) continue
    if (character === '%' && line[index + 1] === '%') return { comment: index, quoted }
    if (character !== ':' || line[index - 1] === ':' || line[index + 1] === ':') continue
    const prefix = line.slice(0, index).trim()
    if (/^[\w\p{L}\p{M}\p{N}-]+$/u.test(prefix) || prefix.includes('-->') || /^note\s+(?:left|right)\s+of\s+[\w\p{L}\p{M}\p{N}-]+$/iu.test(prefix)) return { comment: -1, quoted: false }
  }
  return { comment: -1, quoted }
}

export function stateCommentIndex(line: string): number {
  return scanStateLine(line).comment
}

export function stripStateComment(line: string): string {
  const marker = stateCommentIndex(line)
  return (marker < 0 ? line : line.slice(0, marker)).trim()
}

export interface StateSourceLine {
  text: string
  commentIndex: number
  /** A block note's body line, kept verbatim. */
  noteBody: boolean
  /** The line opens a block note. */
  noteOpen: boolean
  /** The line ends inside a `state "…"` or `note "…"` string that a later
   *  line closes; Mermaid reads the line break as part of the string. */
  openQuote: boolean
  /** A comment follows the text with no blank between (`A --> note%%`), so
   *  no blank follows a name that ends the text. */
  commentGlued: boolean
}

/** Retain physical-line correspondence for source-loss receipts while the two
 * State parsers consume the same comment and block-note interpretation. */
export function scanStateComments(lines: readonly string[]): StateSourceLine[] {
  // Mermaid rejects a note or string that nothing closes, so a note opener
  // carries text, and a string runs on, only when a later line can close it.
  const endNoteAfter: boolean[] = []
  const quoteAfter: boolean[] = []
  for (let index = lines.length - 1, endNote = false, quote = false; index >= 0; index--) {
    endNoteAfter[index] = endNote
    quoteAfter[index] = quote
    endNote ||= STATE_NOTE_END_RE.test(stripStateComment(lines[index]!))
    quote ||= lines[index]!.includes('"')
  }
  let inNote = false
  let quoted = false
  return lines.map((raw, index) => {
    const continued = quoted
    const scan = scanStateLine(raw, !inNote && continued)
    const stripped = (scan.comment < 0 ? raw : raw.slice(0, scan.comment)).trim()
    const noteBody = inNote && !STATE_NOTE_END_RE.test(stripped)
    const text = noteBody ? raw.trim() : stripped
    let noteOpen = false
    if (inNote) {
      if (!noteBody) inNote = false
    } else if (!continued && (STATE_NOTE_OPEN_RE.test(text) || (endNoteAfter[index]! && STATE_NOTE_OPEN_TEXT_RE.test(text)))) {
      inNote = noteOpen = true
    }
    quoted = !inNote && scan.quoted && quoteAfter[index]! && (continued || /^(?:state|note)\s/i.test(text))
    const commentGlued = !noteBody && scan.comment > 0 && !/\s/.test(raw[scan.comment - 1]!)
    return { text, commentIndex: noteBody ? -1 : scan.comment, noteBody, noteOpen, openQuote: quoted, commentGlued }
  })
}
