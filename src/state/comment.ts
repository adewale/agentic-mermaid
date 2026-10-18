/** Block-note boundaries are shared with the State grammar. Note bodies are
 * literal text, including whole lines beginning with %% or syntax-like text. */
export const STATE_NOTE_OPEN_RE = /^note\s+(left|right)\s+of\s+([\w\p{L}-]+)\s*$/iu
export const STATE_NOTE_END_RE = /^end\s+note$/i

/** A State comment starts outside quoted aliases and text introduced by a
 * description/transition/note colon. A style property's colon is not text. */
export function stateCommentIndex(line: string): number {
  let quoted = false
  for (let index = 0; index < line.length; index++) {
    const character = line[index]!
    if (character === '"') { quoted = !quoted; continue }
    if (quoted) continue
    if (character === '%' && line[index + 1] === '%') return index
    if (character !== ':' || line[index - 1] === ':' || line[index + 1] === ':') continue
    const prefix = line.slice(0, index).trim()
    if (/^[\w\p{L}-]+$/u.test(prefix) || prefix.includes('-->') || /^note\s+(?:left|right)\s+of\s+[\w\p{L}-]+$/iu.test(prefix)) return -1
  }
  return -1
}

export function stripStateComment(line: string): string {
  const marker = stateCommentIndex(line)
  return (marker < 0 ? line : line.slice(0, marker)).trim()
}

/** Retain physical-line correspondence for source-loss receipts while the two
 * State parsers consume the same comment and block-note interpretation. */
export function scanStateComments(lines: readonly string[]): Array<{ text: string; commentIndex: number; noteBody: boolean }> {
  let inNote = false
  return lines.map(raw => {
    const marker = stateCommentIndex(raw)
    const stripped = (marker < 0 ? raw : raw.slice(0, marker)).trim()
    const noteBody = inNote && !STATE_NOTE_END_RE.test(stripped)
    const text = noteBody ? raw.trim() : stripped
    if (inNote && !noteBody) inNote = false
    else if (!inNote && STATE_NOTE_OPEN_RE.test(text)) inNote = true
    return { text, commentIndex: noteBody ? -1 : marker, noteBody }
  })
}
